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
}

# ---------------------------------------------------------------- data

with open(DATA_FILE, encoding="utf-8") as f:
    KANJI_LIST = json.load(f)
KANJI_INDEX = {row["k"]: i for i, row in enumerate(KANJI_LIST)}

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


def build_queue(settings):
    conn = db()
    now = iso(now_utc())
    due = [
        {"k": r["kanji"], "facet": r["facet"], "type": "review"}
        for r in conn.execute(
            "SELECT kanji, facet FROM srs WHERE state!='new' AND due<=? ORDER BY due",
            (now,),
        )
    ]
    introduced = conn.execute(
        "SELECT COUNT(DISTINCT kanji) AS n FROM srs WHERE introduced_on=?",
        (today_local(),),
    ).fetchone()["n"]
    budget = max(0, int(settings["new_per_day"]) - introduced)
    new_items = []
    if budget:
        new_rows = conn.execute(
            "SELECT kanji, facet FROM srs WHERE state='new'"
        ).fetchall()
        by_kanji = {}
        for r in new_rows:
            by_kanji.setdefault(r["kanji"], []).append(r["facet"])
        ordered = sorted(by_kanji, key=lambda k: KANJI_INDEX.get(k, 1 << 30))
        for k in ordered[:budget]:
            for facet in ("meaning", "reading"):
                if facet in by_kanji[k]:
                    new_items.append({"k": k, "facet": facet, "type": "new"})
    return {"due": due, "new": new_items, "introduced_today": introduced}


def start_batch(cid, index, settings):
    size = int(settings["batch_size"])
    chars = collection_chars(cid, settings)[index * size : (index + 1) * size]
    conn = db()
    added = already = 0
    for ch in chars:
        # one SRS record per kanji+facet, shared across all collections
        cur = conn.execute(
            "INSERT OR IGNORE INTO srs(kanji, facet) VALUES(?, 'meaning')", (ch,)
        )
        conn.execute(
            "INSERT OR IGNORE INTO srs(kanji, facet) VALUES(?, 'reading')", (ch,)
        )
        if cur.rowcount:
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
    per_kanji = {}
    for r in srs_rows:
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

    return {
        "days": days,
        "total_reviews": totals["n"] or 0,
        "total_correct": totals["c"] or 0,
        "streak": streak,
        "hardest": hardest,
        "modes": modes,
        "hours": hours,
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
        if path.startswith("/static/") or path == "/data/kanji.json":
            return self.serve_file(path)

        settings = get_settings()
        if path == "/api/state":
            rows = [dict(r) for r in db().execute("SELECT * FROM srs")]
            queue = build_queue(settings)
            return self.send_json({
                "settings": settings,
                "srs": rows,
                "due_count": len(queue["due"]),
                "new_count": len({i["k"] for i in queue["new"]}),
                "introduced_today": queue["introduced_today"],
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
