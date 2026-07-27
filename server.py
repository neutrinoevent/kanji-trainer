#!/usr/bin/env python3
"""Kanji Trainer — self-contained local server.

Runs on the Python standard library only (no pip installs).
Serves the web UI, persists everything to a local SQLite database,
and implements the SM-2-style spaced-repetition scheduler.

Usage:  python server.py [port]     (default port 7777)
"""

import json
import os
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
    "strict_primary": True,   # a 'meaning' card wants the *most common* sense
    "goals": [],         # user-declared fluency goals; see /api/goals
}

# ---------------------------------------------------------------- data

with open(DATA_FILE, encoding="utf-8") as f:
    KANJI_LIST = json.load(f)
KANJI_INDEX = {row["k"]: i for i, row in enumerate(KANJI_LIST)}
MEANING_COUNT = {row["k"]: len(row.get("meanings") or []) for row in KANJI_LIST}

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

# The bar for "operative fluency with the most frequent significance".
SENSE_UNLOCK_DAYS = 7.0
SENSE_UNLOCK_REPS = 4

# Named fluency tiers, used by goals and the per-kanji rubric. 'solid' matches
# the pre-existing "mature" statistic so the two never disagree.
OPERATIVE_DAYS = 7.0
SOLID_DAYS = 21.0


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
        return len(row.get("meanings") or []) > SENSE_MEANING_INDEX[facet]
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
    added = 0
    for r in conn.execute(
        "SELECT kanji, facet, interval, reps FROM srs "
        "WHERE state='review' AND facet IN ('meaning','sense2')"
    ).fetchall():
        nxt = NEXT_SENSE[r["facet"]]
        if (r["kanji"], nxt) in have:
            continue
        if r["interval"] < SENSE_UNLOCK_DAYS or r["reps"] < SENSE_UNLOCK_REPS:
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


def build_queue(settings):
    conn = db()
    unlock_senses()
    now = iso(now_utc())
    today = today_local()
    due = [
        {"k": r["kanji"], "facet": r["facet"], "type": "review"}
        for r in conn.execute(
            "SELECT kanji, facet FROM srs WHERE state!='new' AND due<=? ORDER BY due",
            (now,),
        )
        if teachable(r["kanji"], r["facet"])   # skips any empty card from an older db
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

    new_rows = [r for r in conn.execute("SELECT kanji, facet FROM srs WHERE state='new'")
                if teachable(r["kanji"], r["facet"])]
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

def strength(row):
    if row["state"] == "new":
        return 0.0
    if row["state"] == "learning":
        return 0.25
    return min(1.0, 0.4 + (row["interval"] / 40.0))


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
    # Batch mastery is about the two core cards only. Folding freshly unlocked
    # sense cards in would make a batch's mastery *drop* the moment the user got
    # good enough to earn a second meaning, which is exactly backwards.
    per_kanji = {}
    for r in srs_rows:
        if r["facet"] in CORE_FACETS:
            per_kanji.setdefault(r["kanji"], []).append(strength(r))

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

    learned = conn.execute(
        "SELECT COUNT(DISTINCT kanji) n FROM srs WHERE state='review'"
    ).fetchone()["n"]

    review_chars = {r["kanji"] for r in srs_rows if r["state"] == "review"}
    joyo_learned = len(review_chars & JOYO_CHARS)
    in_rotation = len(per_kanji)

    mature = conn.execute(
        "SELECT COUNT(DISTINCT kanji) n FROM srs WHERE state='review' AND interval>=21"
    ).fetchone()["n"]

    # The fluency ladder, counted. A kanji is "operative" on a rung when that
    # card is in review with a week-plus interval; "solid" at three weeks.
    def tier(r):
        if r["state"] == "new":
            return 0
        if r["state"] != "review":
            return 1
        if r["interval"] >= SOLID_DAYS:
            return 3
        return 2 if r["interval"] >= OPERATIVE_DAYS else 1

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
            rows = [dict(r) for r in db().execute("SELECT * FROM srs")]
            return self.send_json({
                "settings": settings,
                "srs": rows,
                "due_count": len(queue["due"]),
                "new_count": len({i["k"] for i in queue["new"]}),
                "introduced_today": queue["introduced_today"],
                "sense_today": queue["sense_today"],
                "senses_waiting": queue["senses_waiting"],
                "tiers": {"operative": OPERATIVE_DAYS, "solid": SOLID_DAYS},
            })
        if path == "/api/queue":
            return self.send_json(build_queue(settings))
        if path == "/api/collections":
            return self.send_json([
                {**c, "count": len(collection_chars(c["id"], settings)),
                 "chars": collection_chars(c["id"], settings)}
                for c in COLLECTIONS.values()
            ])
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
            db().execute(
                "INSERT INTO reviews(kanji, facet, mode, correct, ms, srs, ts, day)"
                " VALUES(?,?,?,?,?,?,?,?)",
                (kanji, facet, body.get("mode", "?"), correct,
                 int(body.get("ms") or 0), 1 if affects else 0,
                 iso(now_utc()), today_local()),
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
                    "INSERT INTO reviews(kanji,facet,mode,correct,ms,srs,ts,day)"
                    " VALUES(?,?,?,?,?,?,?,?)",
                    (r["kanji"], r["facet"], r["mode"], r["correct"],
                     r.get("ms"), r.get("srs", 1), r["ts"], r["day"]),
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
