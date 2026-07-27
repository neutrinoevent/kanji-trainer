#!/usr/bin/env python3
"""Kanji Trainer — self-contained local server.

Runs on the Python standard library only (no pip installs).
Serves the web UI, persists everything to a local SQLite database,
and implements the SM-2-style spaced-repetition scheduler.

Usage:  python server.py [port]     (default port 7777)
"""

import json
import os
import re
import sqlite3
import sys
import threading
import webbrowser
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, "data", "kanji.json")
DB_FILE = os.path.join(BASE_DIR, "data", "trainer.db")
STATIC_DIR = os.path.join(BASE_DIR, "static")

DEFAULT_SETTINGS = {
    "top_n": 1000,
    "batch_size": 25,
    "new_per_day": 10,
    "theme": "dark",
    "session_size": 20,
    "tour_done": False,
    "path": {},          # learning-path progress: node id -> stars (1-3)
    "sense_per_day": 4,  # extra meanings unlocked per day (own budget, see below)
    # Off by default: KANJIDIC2's gloss list mixes genuine alternate senses
    # (月 Month/Moon) with near-synonyms (大 Large/Big, 中 In/Inside), so marking
    # "big" wrong for 大 would be a false negative. The feedback names the primary
    # sense either way; turn this on to have only that sense count.
    "strict_primary": False,
    "goals": [],         # user-declared fluency goals
    # last review scope the user picked ("all", or "c/<collection>[/<from>-<to>]")
    "review_scope": "all",
}

# ---------------------------------------------------------------- data

with open(DATA_FILE, encoding="utf-8") as f:
    KANJI_LIST = json.load(f)
KANJI_INDEX = {row["k"]: i for i, row in enumerate(KANJI_LIST)}

# KANJIDIC2's gloss list mixes real senses with radical names and counter notes.
# Left in, 一's "second meaning" would be "One Radical (no.1)" and 二's would be
# "Two Radical (no. 7)" - not meanings anyone should be quizzed on. This decides
# how many senses a kanji can unlock, so it MUST stay in sync with the identical
# JUNK_GLOSS regex in static/app.js.
JUNK_GLOSS = re.compile(r"\bradical\b|^counter for\b|\(no\.\s*\d+\)|\bkokuji\b", re.I)
SENSES = {row["k"]: [m for m in (row.get("meanings") or []) if not JUNK_GLOSS.search(m)]
          for row in KANJI_LIST}
MEANING_COUNT = {k: len(v) for k, v in SENSES.items()}

# Collections are alternative orderings/subsets of the same master list. A kanji
# that appears in several collections still has exactly one SRS record per facet
# — starting overlapping batches never duplicates or reschedules cards.
def _members(pred):
    return "".join(r["k"] for r in KANJI_LIST if pred(r))  # master (importance) order

COLLECTIONS = {}
for _id, _name, _group, _desc, _pred in [
    ("freq", "Top frequency", "Frequency",
     "Most frequent kanji in newspapers, in rank order", lambda r: bool(r["freq"])),
    *[(f"g{n}", f"Grade {n}", "School grades",
       f"Jōyō kanji taught in Japanese school grade {n}",
       (lambda n: lambda r: r["grade"] == n)(n)) for n in range(1, 7)],
    ("joyo-hs", "Secondary school", "School grades",
     "Remaining jōyō kanji, taught in secondary school", lambda r: r["grade"] == 8),
    *[(f"n{n}", f"JLPT N{n}", "JLPT",
       f"Kanji for the JLPT N{n} exam level",
       (lambda n: lambda r: r["jlpt"] == n)(n)) for n in (5, 4, 3, 2, 1)],
    ("jinmeiyo", "Jinmeiyō", "Names",
     "Name-use kanji beyond the jōyō set", lambda r: r["grade"] in (9, 10)),
]:
    COLLECTIONS[_id] = {"id": _id, "name": _name, "group": _group,
                        "desc": _desc, "chars": _members(_pred)}

JOYO_CHARS = set(_members(lambda r: r["grade"] in (1, 2, 3, 4, 5, 6, 8)))


def collection_chars(cid, settings):
    col = COLLECTIONS.get(cid)
    if not col:
        return ""
    chars = col["chars"]
    if cid == "freq":
        chars = chars[: int(settings["top_n"])]
    return chars

# ---------------------------------------------------------------- db

_local = threading.local()


def db():
    if not hasattr(_local, "conn"):
        conn = sqlite3.connect(DB_FILE)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        _local.conn = conn
    return _local.conn


def init_db():
    conn = sqlite3.connect(DB_FILE)
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS srs (
            kanji TEXT NOT NULL,
            facet TEXT NOT NULL,          -- 'meaning' | 'reading'
            state TEXT NOT NULL DEFAULT 'new',   -- 'new' | 'learning' | 'review'
            step INTEGER NOT NULL DEFAULT 0,
            interval REAL NOT NULL DEFAULT 0,    -- days
            ease REAL NOT NULL DEFAULT 2.5,
            due TEXT,                     -- UTC ISO
            reps INTEGER NOT NULL DEFAULT 0,
            lapses INTEGER NOT NULL DEFAULT 0,
            introduced_on TEXT,           -- local YYYY-MM-DD
            PRIMARY KEY (kanji, facet)
        );
        CREATE TABLE IF NOT EXISTS reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kanji TEXT NOT NULL,
            facet TEXT NOT NULL,
            mode TEXT NOT NULL,
            correct INTEGER NOT NULL,
            ms INTEGER,
            srs INTEGER NOT NULL DEFAULT 1,      -- 1 = affected scheduling
            ts TEXT NOT NULL,             -- UTC ISO
            day TEXT NOT NULL             -- local YYYY-MM-DD
        );
        CREATE INDEX IF NOT EXISTS idx_reviews_day ON reviews(day);
        CREATE INDEX IF NOT EXISTS idx_reviews_kanji ON reviews(kanji);
        """
    )
    # Migration: distinguish "correct" from "on target". Typing a real but
    # secondary meaning is accepted, yet must not count as demonstrating the
    # sense the card is for. Existing rows are backfilled from `correct` so no
    # history is discarded.
    cols = {r[1] for r in conn.execute("PRAGMA table_info(reviews)")}
    if "on_target" not in cols:
        conn.execute("ALTER TABLE reviews ADD COLUMN on_target INTEGER")
        conn.execute("UPDATE reviews SET on_target = correct WHERE on_target IS NULL")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_reviews_card ON reviews(kanji, facet)")
    conn.commit()
    conn.close()


def now_utc():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def today_local():
    return datetime.now().strftime("%Y-%m-%d")


def get_settings():
    s = dict(DEFAULT_SETTINGS)
    for row in db().execute("SELECT key, value FROM settings"):
        try:
            s[row["key"]] = json.loads(row["value"])
        except ValueError:
            s[row["key"]] = row["value"]
    return s


def save_settings(patch):
    conn = db()
    for k, v in patch.items():
        if k in DEFAULT_SETTINGS:
            conn.execute(
                "INSERT INTO settings(key,value) VALUES(?,?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (k, json.dumps(v)),
            )
    conn.commit()


# ---------------------------------------------------------------- srs logic

LEARN_STEP_1 = timedelta(minutes=10)
LEARN_STEP_2 = timedelta(days=1)
GRADUATE_DAYS = 3.0

# Facets. 'meaning' teaches the most common sense of a kanji and 'reading'
# teaches how it is said aloud on its own; those two are created together when a
# kanji enters the rotation. 'sense2'/'sense3' teach the second- and third-most
# common meanings and are NOT created up front — they appear only once the more
# frequent sense is demonstrably operative, so extra meanings always arrive as a
# resurgence of a kanji you already know.
CORE_FACETS = ("meaning", "reading")
SENSE_FACETS = ("sense2", "sense3")
NEXT_SENSE = {"meaning": "sense2", "sense2": "sense3"}
SENSE_MEANING_INDEX = {"meaning": 0, "sense2": 1, "sense3": 2}

# ---------------------------------------------------------------- fluency
#
# Fluency is measured by what the learner has DEMONSTRATED, not by how long a
# card has survived. An interval of seven days only says the scheduler hasn't
# asked recently; it says nothing about whether the learner can actually produce
# the meaning, or only recognise it among four choices. So the bar is evidence:
# the same card answered on target, across different kinds of question, on
# different days.
#
# The question modes a facet can be asked in. "Solid" requires all of them,
# which is why the sets are declared rather than counted.
FACET_MODES = {
    "meaning": {"mc-meaning", "mc-kanji", "type-meaning"},
    "reading": {"mc-reading", "type-reading"},
    "sense2": {"mc-meaning", "type-meaning"},
    "sense3": {"mc-meaning", "type-meaning"},
}
# Producing an answer from memory is a stronger demonstration than picking it
# out of four. Every tier above 'learning' requires at least one production.
PRODUCTION_MODES = {"type-meaning", "type-reading"}
# The question types that constitute the bar, wherever they are answered.
QUIZ_MODES = set().union(*FACET_MODES.values())

# Thresholds. 'days' is diversity of encounter, not a waiting period: it stops a
# single intense session from certifying a kanji the learner will not recall
# tomorrow. Everything else is pure evidence.
TIER_OPERATIVE = {"modes": 2, "prod": 1, "hits": 4, "days": 2, "acc": 0.70}
TIER_SOLID = {"prod": 2, "hits": 8, "days": 4, "acc": 0.80}   # + every mode


def demonstration_map():
    """Per-card evidence from the review log, keyed (kanji, facet).

    Counted by question type rather than by whether the answer moved the
    schedule, so drilling a set builds real evidence — it is the same retrieval
    in the same question types, and refusing to count it made an evening of
    practice look like nothing happened. Games use their own mode names and stay
    out of the fluency bar; they are a different kind of practice.

    Only on-target answers count as hits: see `on_target` in /api/answer, which
    is how "you typed a real but secondary meaning" is kept distinct from "you
    produced the meaning this card is for".
    """
    out = {}
    marks = ",".join("?" * len(QUIZ_MODES))
    for r in db().execute(
        "SELECT kanji, facet, mode, day, SUM(on_target) hits, COUNT(*) n"
        f" FROM reviews WHERE mode IN ({marks})"
        " GROUP BY kanji, facet, mode, day", tuple(sorted(QUIZ_MODES))
    ):
        d = out.setdefault(
            (r["kanji"], r["facet"]),
            {"modes": set(), "prod": 0, "days": set(), "hits": 0, "n": 0},
        )
        hits = r["hits"] or 0
        d["hits"] += hits
        d["n"] += r["n"]
        if hits:
            d["modes"].add(r["mode"])
            d["days"].add(r["day"])
            if r["mode"] in PRODUCTION_MODES:
                d["prod"] += hits
    return out


def _ratio(part, whole):
    return min(1.0, part / whole) if whole else 1.0


def demo_progress(facet, d):
    """How far a card is toward *operative*, 0..1.

    Tiers are a bar, but a bar alone makes an evening of honest work look like
    nothing happened: every card sat at the same flat value until the next day
    ticked over. Progress is measured continuously so effort is visible while
    it is being made, even though the tier itself has not changed yet.
    """
    if not d or not d["hits"]:
        return 0.0
    t = TIER_OPERATIVE
    parts = (_ratio(len(d["modes"]), t["modes"]), _ratio(d["prod"], t["prod"]),
             _ratio(d["hits"], t["hits"]), _ratio(len(d["days"]), t["days"]))
    return sum(parts) / len(parts)


def solid_progress(facet, d):
    """How far an operative card is toward *solid*, 0..1."""
    if not d:
        return 0.0
    s = TIER_SOLID
    want = FACET_MODES.get(facet, set())
    parts = (_ratio(len(d["modes"] & want), len(want)), _ratio(d["prod"], s["prod"]),
             _ratio(d["hits"], s["hits"]), _ratio(len(d["days"]), s["days"]))
    return sum(parts) / len(parts)


def demo_tier(facet, d):
    """0 not started, 1 learning, 2 operative, 3 solid."""
    if not d or not d["hits"]:
        return 0
    acc = d["hits"] / d["n"] if d["n"] else 0
    t = TIER_OPERATIVE
    if not (len(d["modes"]) >= t["modes"] and d["prod"] >= t["prod"]
            and d["hits"] >= t["hits"] and len(d["days"]) >= t["days"]
            and acc >= t["acc"]):
        return 1
    s = TIER_SOLID
    every_mode = FACET_MODES.get(facet, set()) <= d["modes"]
    if (every_mode and d["prod"] >= s["prod"] and d["hits"] >= s["hits"]
            and len(d["days"]) >= s["days"] and acc >= s["acc"]):
        return 3
    return 2


def tier_gaps(facet, d):
    """What is still missing before this card counts as operative — shown to the
    learner so the bar is legible rather than mysterious."""
    d = d or {"modes": set(), "prod": 0, "days": set(), "hits": 0, "n": 0}
    t = TIER_OPERATIVE
    gaps = []
    if len(d["modes"]) < t["modes"]:
        gaps.append(f"answer it in {t['modes'] - len(d['modes'])} more question type(s)")
    if d["prod"] < t["prod"]:
        gaps.append("type it from memory once")
    if d["hits"] < t["hits"]:
        gaps.append(f"{t['hits'] - d['hits']} more correct answer(s)")
    if len(d["days"]) < t["days"]:
        gaps.append(f"come back on {t['days'] - len(d['days'])} more day(s)")
    acc = d["hits"] / d["n"] if d["n"] else 0
    if d["n"] and acc < t["acc"]:
        gaps.append("raise accuracy above 70%")
    return gaps


def apply_answer(kanji, facet, correct):
    conn = db()
    row = conn.execute(
        "SELECT * FROM srs WHERE kanji=? AND facet=?", (kanji, facet)
    ).fetchone()
    if row is None:
        return
    state, step = row["state"], row["step"]
    interval, ease = row["interval"], row["ease"]
    lapses = row["lapses"]
    now = now_utc()

    if correct:
        if state != "review":
            step += 1
            if step == 1:
                state, due = "learning", now + LEARN_STEP_1
            elif step == 2:
                state, due = "learning", now + LEARN_STEP_2
            else:
                state, interval = "review", GRADUATE_DAYS
                due = now + timedelta(days=interval)
        else:
            interval = max(interval * ease, interval + 1)
            ease = min(ease + 0.05, 2.8)
            due = now + timedelta(days=interval)
    else:
        if state == "review":
            lapses += 1
            ease = max(1.3, ease - 0.2)
        state, step, interval = "learning", 0, 0
        due = now + LEARN_STEP_1

    conn.execute(
        "UPDATE srs SET state=?, step=?, interval=?, ease=?, due=?, reps=reps+1,"
        " lapses=?, introduced_on=COALESCE(introduced_on, ?)"
        " WHERE kanji=? AND facet=?",
        (state, step, interval, ease, iso(due), lapses, today_local(), kanji, facet),
    )
    conn.commit()


def teachable(kanji, facet):
    """Is there anything to put on this card?

    A handful of rare variant codepoints in the dataset (jinmeiyo only, no
    frequency rank) carry readings but no English gloss. Creating a meaning card
    for them produces a question with no answer, so they simply don't get one.
    """
    i = KANJI_INDEX.get(kanji)
    if i is None:
        return False
    row = KANJI_LIST[i]
    if facet in SENSE_MEANING_INDEX:
        return MEANING_COUNT.get(kanji, 0) > SENSE_MEANING_INDEX[facet]
    return bool(row.get("on") or row.get("kun"))


def open_facets(kanji):
    """The core cards a kanji should start with - usually both."""
    return tuple(f for f in CORE_FACETS if teachable(kanji, f))


def unlock_senses():
    """Create the next sense card for every kanji whose current sense is operative.

    This is the sense ladder: you never meet a kanji's second meaning until its
    first meaning has graduated to review with a week-plus interval and a few
    reps behind it. The new card is created as 'new', so it then flows through
    the ordinary queue on the sense budget below.
    """
    conn = db()
    have = {(r["kanji"], r["facet"])
            for r in conn.execute("SELECT kanji, facet FROM srs")}
    demo = demonstration_map()
    added = 0
    for r in conn.execute(
        "SELECT kanji, facet FROM srs WHERE facet IN ('meaning','sense2')"
    ).fetchall():
        nxt = NEXT_SENSE[r["facet"]]
        if (r["kanji"], nxt) in have:
            continue
        # the gate is demonstrated fluency with the more frequent sense, not the
        # scheduler's opinion of how long it has been
        if demo_tier(r["facet"], demo.get((r["kanji"], r["facet"]))) < 2:
            continue
        # only if the kanji actually has a meaning at that rank
        if MEANING_COUNT.get(r["kanji"], 0) <= SENSE_MEANING_INDEX[nxt]:
            continue
        conn.execute("INSERT OR IGNORE INTO srs(kanji, facet) VALUES(?,?)",
                     (r["kanji"], nxt))
        have.add((r["kanji"], nxt))
        added += 1
    if added:
        conn.commit()
    return added


def scope_chars(settings, collection=None, b_from=None, b_to=None):
    """Resolve a review scope to a set of kanji, or None for 'everything'.

    A learner working through Grade 1 batch 1 should be able to review *that*,
    not whatever else happens to be in rotation. Scope is a collection id plus
    an optional inclusive batch range, rather than a list of characters, so the
    URL stays short and the server stays the authority on what a batch contains.
    A range (not just a single index) is what lets a goal — "the first three
    batches of Grade 1" — be reviewed as one scope.
    """
    if not collection:
        return None
    chars = collection_chars(collection, settings)
    if not chars:
        return None
    if b_from is not None:
        size = int(settings["batch_size"])
        lo = b_from * size
        hi = ((b_to if b_to is not None else b_from) + 1) * size
        chars = chars[lo:hi]
    return set(chars)


def build_queue(settings, scope=None):
    conn = db()
    unlock_senses()
    now = iso(now_utc())
    today = today_local()
    in_scope = (lambda k: True) if scope is None else (lambda k: k in scope)
    due = [
        {"k": r["kanji"], "facet": r["facet"], "type": "review"}
        for r in conn.execute(
            "SELECT kanji, facet FROM srs WHERE state!='new' AND due<=? ORDER BY due",
            (now,),
        )
        if teachable(r["kanji"], r["facet"])   # skips any empty card from an older db
        and in_scope(r["kanji"])
    ]

    # Two independent daily budgets: new kanji (widening) and newly unlocked
    # senses (deepening). Sharing one budget would let either starve the other.
    introduced = conn.execute(
        "SELECT COUNT(DISTINCT kanji) AS n FROM srs "
        "WHERE introduced_on=? AND facet IN ('meaning','reading')", (today,)
    ).fetchone()["n"]
    sense_introduced = conn.execute(
        "SELECT COUNT(*) AS n FROM srs "
        "WHERE introduced_on=? AND facet IN ('sense2','sense3')", (today,)
    ).fetchone()["n"]

    # The daily budgets stay global on purpose — they are a pace limit on the
    # learner, not on the scope. A scoped session simply draws its new cards
    # from within the scope.
    new_rows = [r for r in conn.execute("SELECT kanji, facet FROM srs WHERE state='new'")
                if teachable(r["kanji"], r["facet"]) and in_scope(r["kanji"])]
    by_kanji, sense_rows = {}, []
    for r in new_rows:
        if r["facet"] in CORE_FACETS:
            by_kanji.setdefault(r["kanji"], []).append(r["facet"])
        else:
            sense_rows.append(r)

    new_items = []
    budget = max(0, int(settings["new_per_day"]) - introduced)
    if budget:
        ordered = sorted(by_kanji, key=lambda k: KANJI_INDEX.get(k, 1 << 30))
        for k in ordered[:budget]:
            for facet in CORE_FACETS:
                if facet in by_kanji[k]:
                    new_items.append({"k": k, "facet": facet, "type": "new"})

    sense_budget = max(0, int(settings.get("sense_per_day", 4)) - sense_introduced)
    if sense_budget:
        sense_rows.sort(key=lambda r: (KANJI_INDEX.get(r["kanji"], 1 << 30), r["facet"]))
        for r in sense_rows[:sense_budget]:
            new_items.append({"k": r["kanji"], "facet": r["facet"], "type": "sense"})

    return {"due": due, "new": new_items, "introduced_today": introduced,
            "sense_today": sense_introduced,
            "senses_waiting": len(sense_rows)}


def start_batch(cid, index, settings):
    size = int(settings["batch_size"])
    chars = collection_chars(cid, settings)[index * size : (index + 1) * size]
    conn = db()
    added = already = 0
    for ch in chars:
        # one SRS record per kanji+facet, shared across all collections
        new = False
        for facet in open_facets(ch):
            cur = conn.execute(
                "INSERT OR IGNORE INTO srs(kanji, facet) VALUES(?,?)", (ch, facet)
            )
            new = new or bool(cur.rowcount)
        if new:
            added += 1
        else:
            already += 1
    conn.commit()
    return {"added": added, "already": already}


# ---------------------------------------------------------------- stats

def strength(row, demo):
    """Card strength for batch mastery, on the same evidence as the tiers, so a
    batch showing 80% means 80% demonstrated rather than 80% recently scheduled.

    Continuous, not a step per tier: a learner who spends an evening answering
    the same batch correctly in several question types has demonstrably moved,
    and the number has to show it even though the tier will not change until
    they come back another day.
    """
    facet = row["facet"]
    tier = demo_tier(facet, demo)
    if tier >= 3:
        return 1.0
    if tier == 2:
        return 0.75 + 0.25 * solid_progress(facet, demo)
    return 0.75 * demo_progress(facet, demo)


def get_stats(settings):
    conn = db()
    days = {}
    for r in conn.execute(
        "SELECT day, COUNT(*) n, SUM(correct) c FROM reviews "
        "WHERE day >= date('now','localtime','-119 days') GROUP BY day"
    ):
        days[r["day"]] = {"n": r["n"], "correct": r["c"] or 0}

    totals = conn.execute(
        "SELECT COUNT(*) n, SUM(correct) c FROM reviews"
    ).fetchone()

    # streak: consecutive days ending today/yesterday with activity
    streak = 0
    d = datetime.now().date()
    if d.strftime("%Y-%m-%d") not in days:
        d -= timedelta(days=1)
    while d.strftime("%Y-%m-%d") in days:
        streak += 1
        d -= timedelta(days=1)

    trow = conn.execute(
        "SELECT COUNT(*) n, SUM(correct) c FROM reviews WHERE day=?",
        (today_local(),),
    ).fetchone()
    today_modes = [r["mode"] for r in conn.execute(
        "SELECT DISTINCT mode FROM reviews WHERE day=?", (today_local(),)
    )]

    modes = {}
    for r in conn.execute(
        "SELECT mode, COUNT(*) n, SUM(correct) c FROM reviews GROUP BY mode"
    ):
        modes[r["mode"]] = {"n": r["n"], "c": r["c"] or 0}

    hours = {}
    for r in conn.execute(
        "SELECT CAST(strftime('%H', datetime(ts,'localtime')) AS INTEGER) h,"
        " COUNT(*) n FROM reviews GROUP BY h"
    ):
        if r["h"] is not None:
            hours[str(r["h"])] = r["n"]

    hardest = [
        {"k": r["kanji"], "wrong": r["w"], "total": r["n"]}
        for r in conn.execute(
            "SELECT kanji, COUNT(*)-SUM(correct) w, COUNT(*) n FROM reviews "
            "GROUP BY kanji HAVING w > 0 ORDER BY w DESC, n DESC LIMIT 12"
        )
    ]

    srs_rows = conn.execute("SELECT * FROM srs").fetchall()
    demo = demonstration_map()
    # Batch mastery is about the two core cards only. Folding freshly unlocked
    # sense cards in would make a batch's mastery *drop* the moment the user got
    # good enough to earn a second meaning, which is exactly backwards.
    per_kanji = {}
    for r in srs_rows:
        if r["facet"] in CORE_FACETS:
            per_kanji.setdefault(r["kanji"], []).append(
                strength(r, demo.get((r["kanji"], r["facet"]))))

    size = int(settings["batch_size"])
    collections = {}
    for cid in COLLECTIONS:
        chars = collection_chars(cid, settings)
        batches = []
        for b in range((len(chars) + size - 1) // size):
            chunk = chars[b * size : (b + 1) * size]
            vals = [sum(per_kanji[c]) / len(per_kanji[c]) for c in chunk if c in per_kanji]
            batches.append({
                "index": b,
                "started": len(vals),
                "size": len(chunk),
                "mastery": round(sum(vals) / len(chunk), 3) if vals else 0.0,
            })
        collections[cid] = batches

    in_rotation = len(per_kanji)


    # The fluency ladder, counted from demonstrated evidence (see demo_tier).
    def tier(r):
        return demo_tier(r["facet"], demo.get((r["kanji"], r["facet"])))

    tiers = {}
    for r in srs_rows:
        tiers.setdefault(r["kanji"], {})[r["facet"]] = tier(r)
    rungs = {"seen": 0, "meaning": 0, "reading": 0, "both": 0, "solid": 0}
    for t in tiers.values():
        rungs["seen"] += 1
        m, rd = t.get("meaning", 0), t.get("reading", 0)
        if m >= 2:
            rungs["meaning"] += 1
        if rd >= 2:
            rungs["reading"] += 1
        if m >= 2 and rd >= 2:
            rungs["both"] += 1
        if m >= 3 and rd >= 3:
            rungs["solid"] += 1

    # "Learned" means demonstrated on both rungs — meaning AND reading, each
    # produced from memory across several kinds of question on several days.
    # Counting cards the scheduler happened to graduate told learners they were
    # done when they were not.
    learned = rungs["both"]
    mature = rungs["solid"]
    fluent_chars = {k for k, t in tiers.items()
                    if t.get("meaning", 0) >= 2 and t.get("reading", 0) >= 2}
    joyo_learned = len(fluent_chars & JOYO_CHARS)

    senses = {
        "unlocked": sum(1 for r in srs_rows if r["facet"] in SENSE_FACETS),
        "operative": sum(1 for r in srs_rows
                         if r["facet"] in SENSE_FACETS and tier(r) >= 2),
        "eligible": sum(1 for k, t in tiers.items()
                        if t.get("meaning", 0) >= 2 and MEANING_COUNT.get(k, 0) > 1),
    }

    return {
        "rungs": rungs,
        "senses": senses,
        "days": days,
        "total_reviews": totals["n"] or 0,
        "total_correct": totals["c"] or 0,
        "streak": streak,
        "hardest": hardest,
        "modes": modes,
        "hours": hours,
        "today": {"n": trow["n"] or 0, "correct": trow["c"] or 0,
                  "modes": today_modes},
        "collections": collections,
        "learned": learned,
        "mature": mature,
        "in_rotation": in_rotation,
        "joyo_learned": joyo_learned,
        "joyo_total": len(JOYO_CHARS),
    }


# ---------------------------------------------------------------- http

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # quiet
        pass

    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def serve_file(self, path):
        full = os.path.normpath(os.path.join(BASE_DIR, path.lstrip("/")))
        if not full.startswith(BASE_DIR) or not os.path.isfile(full):
            self.send_json({"error": "not found"}, 404)
            return
        ext = os.path.splitext(full)[1]
        with open(full, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ------------------------------------------------------------ GET

    def do_GET(self):
        url = urlparse(self.path)
        path = url.path
        if path == "/" or path == "/index.html":
            return self.serve_file("static/index.html")
        if path.startswith("/static/") or path in (
                "/data/kanji.json", "/data/spoken.json", "/data/spoken.local.json"):
            return self.serve_file(path)

        settings = get_settings()
        if path == "/api/state":
            queue = build_queue(settings)   # may unlock senses, so run it first
            demo = demonstration_map()
            rows = []
            for r in db().execute("SELECT * FROM srs"):
                d = dict(r)
                d["tier"] = demo_tier(r["facet"], demo.get((r["kanji"], r["facet"])))
                rows.append(d)
            return self.send_json({
                "settings": settings,
                "srs": rows,
                "due_count": len(queue["due"]),
                "new_count": len({i["k"] for i in queue["new"]}),
                "introduced_today": queue["introduced_today"],
                "sense_today": queue["sense_today"],
                "senses_waiting": queue["senses_waiting"],
                "tiers": {"operative": TIER_OPERATIVE, "solid": TIER_SOLID},
            })
        if path == "/api/queue":
            q = parse_qs(url.query)
            cid = (q.get("collection") or [None])[0]
            if cid is not None and cid not in COLLECTIONS:
                return self.send_json({"error": "unknown collection"}, 400)

            def opt_int(name):
                raw = (q.get(name) or [None])[0]
                if raw in (None, ""):
                    return None
                n = int(raw)          # ValueError handled by the caller
                if n < 0:
                    raise ValueError(name)
                return n

            try:
                b_from, b_to = opt_int("from"), opt_int("to")
            except ValueError:
                return self.send_json({"error": "bad batch range"}, 400)
            if b_to is not None and b_from is not None and b_to < b_from:
                return self.send_json({"error": "bad batch range"}, 400)

            scope = scope_chars(settings, cid, b_from, b_to)
            out = build_queue(settings, scope)
            out["scope"] = {"collection": cid, "from": b_from, "to": b_to,
                            "size": len(scope) if scope is not None else None}
            return self.send_json(out)
        if path == "/api/collections":
            return self.send_json([
                {**c, "count": len(collection_chars(c["id"], settings)),
                 "chars": collection_chars(c["id"], settings)}
                for c in COLLECTIONS.values()
            ])
        if path == "/api/card":
            q = parse_qs(url.query)
            k = (q.get("k") or [""])[0]
            facet = (q.get("facet") or ["meaning"])[0]
            d = demonstration_map().get((k, facet))
            return self.send_json({
                "k": k, "facet": facet,
                "tier": demo_tier(facet, d),
                "gaps": tier_gaps(facet, d),
                "evidence": {
                    "modes": sorted(d["modes"]) if d else [],
                    "produced": d["prod"] if d else 0,
                    "days": len(d["days"]) if d else 0,
                    "hits": d["hits"] if d else 0,
                    "attempts": d["n"] if d else 0,
                },
            })
        if path == "/api/stats":
            return self.send_json(get_stats(settings))
        if path == "/api/export":
            dump = {
                "version": 1,
                "exported": iso(now_utc()),
                "settings": settings,
                "srs": [dict(r) for r in db().execute("SELECT * FROM srs")],
                "reviews": [dict(r) for r in db().execute("SELECT * FROM reviews")],
            }
            return self.send_json(dump)
        self.send_json({"error": "not found"}, 404)

    # ------------------------------------------------------------ POST

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            body = self.read_body()
        except ValueError:
            return self.send_json({"error": "bad json"}, 400)
        settings = get_settings()

        if path == "/api/settings":
            save_settings(body)
            return self.send_json({"ok": True, "settings": get_settings()})

        if path == "/api/srs/start":
            chars = [c for c in body.get("kanji", []) if c in KANJI_INDEX]
            conn = db()
            added = 0
            for ch in chars:
                new = False
                for facet in open_facets(ch):
                    cur = conn.execute(
                        "INSERT OR IGNORE INTO srs(kanji, facet) VALUES(?,?)", (ch, facet)
                    )
                    new = new or bool(cur.rowcount)
                if new:
                    added += 1
            conn.commit()
            return self.send_json({"ok": True, "added": added,
                                   "already": len(chars) - added})

        if path == "/api/batch/start":
            cid = body.get("collection", "freq")
            if cid not in COLLECTIONS:
                return self.send_json({"error": "unknown collection"}, 400)
            result = start_batch(cid, int(body["index"]), settings)
            return self.send_json({"ok": True, **result})

        if path == "/api/answer":
            kanji = body["k"]
            facet = body.get("facet", "meaning")
            correct = 1 if body.get("correct") else 0
            affects = bool(body.get("srs", True))
            # on_target defaults to `correct`; the client sends 0 when an answer
            # was accepted but was not the sense/reading the card teaches.
            on_target = body.get("on_target")
            on_target = correct if on_target is None else (1 if on_target else 0)
            db().execute(
                "INSERT INTO reviews(kanji, facet, mode, correct, ms, srs, ts, day, on_target)"
                " VALUES(?,?,?,?,?,?,?,?,?)",
                (kanji, facet, body.get("mode", "?"), correct,
                 int(body.get("ms") or 0), 1 if affects else 0,
                 iso(now_utc()), today_local(), on_target),
            )
            db().commit()
            if affects:
                apply_answer(kanji, facet, correct)
            return self.send_json({"ok": True})

        if path == "/api/import":
            if body.get("version") != 1:
                return self.send_json({"error": "unsupported export version"}, 400)
            conn = db()
            conn.execute("DELETE FROM srs")
            conn.execute("DELETE FROM reviews")
            conn.execute("DELETE FROM settings")
            save_settings(body.get("settings") or {})
            for r in body.get("srs") or []:
                conn.execute(
                    "INSERT OR REPLACE INTO srs(kanji,facet,state,step,interval,ease,"
                    "due,reps,lapses,introduced_on) VALUES(?,?,?,?,?,?,?,?,?,?)",
                    (r["kanji"], r["facet"], r["state"], r["step"], r["interval"],
                     r["ease"], r.get("due"), r["reps"], r["lapses"],
                     r.get("introduced_on")),
                )
            for r in body.get("reviews") or []:
                conn.execute(
                    "INSERT INTO reviews(kanji,facet,mode,correct,ms,srs,ts,day,on_target)"
                    " VALUES(?,?,?,?,?,?,?,?,?)",
                    (r["kanji"], r["facet"], r["mode"], r["correct"],
                     r.get("ms"), r.get("srs", 1), r["ts"], r["day"],
                     r.get("on_target", r["correct"])),
                )
            conn.commit()
            return self.send_json({"ok": True})

        self.send_json({"error": "not found"}, 404)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 7777
    init_db()
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}"
    print(f"Kanji Trainer running at {url}  (Ctrl+C to stop)")
    threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nBye.")


if __name__ == "__main__":
    main()
