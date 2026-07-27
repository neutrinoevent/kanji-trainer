# Known issues

Open defects and rough edges in the shipped app, found while building the
fluency ladder (2026-07-27). Nothing here is a crash or data loss; the app works.
Ordered roughly by how much they'd bother a real user.

Expansion work (phone access, sync, hosting) is parked separately in
`PARKED-phone-access-and-sync.md` and is not on this list.

---

## 1. Synonym noise in the sense ladder — quality

**What.** A kanji's "second meaning" is sometimes just a synonym of the first,
because KANJIDIC2's gloss list is not a list of distinct senses. 大 unlocks
"Big" as a second meaning when the first is "Large"; 中 has In / Inside /
Middle; 出 has Exit / Leave / Go Out.

**Effect.** The sense ladder occasionally spends a card teaching nothing. Not
harmful — grading is lenient by default, so answering "big" for 大 is accepted —
but it is noise where the feature promises depth.

**Fix.** A curated sense file mirroring `data/spoken.json`: group synonyms,
rank genuinely distinct senses. Same editable-JSON pattern, same
`*.local.json` override story.

**Knock-on.** This is also the prerequisite for turning `strict_primary` back
on by default. It is off precisely because the gloss data can't support strict
grading (see `VISION.md` D3 revised).

## 2. ~~Goals form and Settings overflow on a phone~~ — FIXED 2026-07-27

**What.** `.form-grid` in `static/app.css` is a fixed `grid-template-columns:
200px 220px` (~438px with the gap). A 390px-wide phone with 16px page padding
has ~358px, so both the Goals form and the Settings page overflow horizontally.

**Effect.** Only on narrow screens. The rest of the layout already handles
mobile properly — viewport meta is present, the sidebar collapses to a scrolling
top bar at 760px, answer choices stack to one column.

**Fixed.** `.form-grid` collapses to a single column under 560px. Verified at
390px: no horizontal overflow on Goals, Settings or Review.

## 3. "New" count conflates new kanji with new senses — minor accuracy

**What.** `/api/state` computes `new_count` as the number of distinct kanji
across `queue["new"]`, which now includes `type: "sense"` items. A kanji that is
only appearing because it earned a second meaning is counted as "new".

**Effect.** The dashboard's "X new" figure and the sidebar badge can overstate
how much genuinely new material is waiting. Cosmetic; scheduling is unaffected.

**Fix.** Count core-facet items and sense items separately in `build_queue`;
the queue already tags them (`sense_today` and `senses_waiting` are returned but
not yet surfaced).

## 4. `JUNK_GLOSS` regex is duplicated — maintenance hazard

**What.** The same regex lives in `server.py` and `static/app.js`, with comments
in both demanding they stay in sync. The server uses it to decide how many
senses a kanji may unlock; the client uses it to render and grade. If they
diverge, the client can be asked for a sense the server thinks exists but the
client filters out (or vice versa).

**Effect.** None today — they match. It is a trap for a future edit.

**Fix.** No clean fix while the app is split across two languages. Options:
serve the pattern from one side as data, or accept it and keep the comments
loud. Worth noting that this is a *small* instance of the same hazard that
would apply to duplicating the SM-2 scheduler, which is why the parked doc
recommends against that.

## 5. ~~"Study this set" on a goal always opens batch 1~~ — FIXED 2026-07-27

**What.** The button routes to `#/study/<collection>/0` regardless of how far
the user has progressed or how many batches the goal covers.

**Effect.** Mild annoyance for a goal spanning several batches.

**Fixed.** Now opens the first batch not yet fully in rotation, bounded by the
goal's batch count.

## 6. Stale empty cards in pre-existing databases — cosmetic

**What.** 47 rare variant codepoints (jinmeiyō only, no frequency rank) have
readings but no English gloss. They used to be given meaning cards with an
undefined answer. Card creation now skips unteachable facets and `build_queue`
filters any such rows, so they can never be served — but rows created before the
fix remain in existing databases.

**Effect.** None visible. They sit inert and are excluded from the queue.

**Fix.** Optional one-time cleanup on startup, or leave them.

---

## Not issues, recorded so they aren't "fixed" by mistake

- **Batch mastery ignores sense cards.** Deliberate. Including them would make a
  batch's mastery *drop* the moment a user got good enough to unlock a second
  meaning.
- **`strict_primary` defaults off.** Deliberate — see issue 1 and `VISION.md`
  D3 revised.
- **`server.py` binds `127.0.0.1`.** Deliberate. Do not "fix" this to `0.0.0.0`
  to make the app reachable on a LAN.
- **XP is derived, never stored.** Deliberate — keeps it desync-proof across
  export/import.
- **Reading cards accept non-standalone readings with a nudge.** Deliberate —
  which reading a bare kanji takes is genuinely contested for some characters.
