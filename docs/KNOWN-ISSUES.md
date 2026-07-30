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

## 7. ~~Batch percentage doesn't move during a session~~ — FIXED 2026-07-27

**What.** Batch mastery took one flat value per fluency tier, so an evening of
study showed no movement at all. Present since before the fluency rewrite: the
old code returned a flat 0.25 for any card in `learning` state, and a card
cannot reach `review` the same night because learning step 2 is a one-day
interval. Drill answers also counted for nothing.

**Fixed.** Mastery now interpolates continuously toward the next tier using the
same evidence the tiers use, and drills count as evidence (games still don't).
The tiers themselves are unchanged and still strict.

## 8. The Path ignores the set you're studying — OPEN

**What.** `pathNodes()` walks `S.kanji.slice(u * 5, ...)` — always the top of the
frequency list, regardless of what the learner has chosen to study. Someone
working through Grade 1 who taps Path gets frequency-ordered kanji instead of
their own set.

**Effect.** The third instance of the scoping bug class, after review (V-005) and
games (V-008). Both of those were fixed; this surface never was.

**Fix.** Same shape as the other two: let the Path take a scope, carry the scope
in every route into it, and default to the set last studied.

## 9. Existing users' numbers will drop on update — OPEN

**What.** "Learned", jōyō coverage and batch mastery now mean *demonstrated*
rather than *scheduled* (V-006). A card the old code counted as learned may read
as "learning" until the learner demonstrates it properly.

**Effect.** Correct behaviour, but it looks like lost progress to anyone who
updates. No data is lost.

**Fix.** A one-time dismissible notice on first run after the update, explaining
what changed and why the numbers moved. Roughly twenty minutes of work.

## 10. Odd One Out cannot run on a narrow scope — BY DESIGN, but worth revisiting

**What.** It needs three kanji sharing an on-reading, which a 25-kanji batch
essentially never contains, so it declines scopes under 40 kanji with a reason.

**Effect.** A game the learner can't use on the set they care about.

**Possible fix.** Pick the odd-one-out *from* the scope and let the matching trio
come from outside it, showing which is which. Would need care not to reintroduce
the "why am I seeing unfamiliar kanji" complaint that V-008 fixed.

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
- **Exams don't reschedule anything.** Deliberate (V-010 D3). A nervous run must
  not be able to damage weeks of spacing, or nobody sits the exam.
- **Bonus exam questions can't lower a score.** Deliberate (V-010 D8) — they lift
  the numerator without lifting the denominator.
- **Font variety is measured, not assumed.** Deliberate (V-009 D1). Don't
  "simplify" the fingerprint check away; without it the feature silently lies.
- **The exam digest chain is not tamper-proof against the user.** Known and
  documented (V-011 D9). It catches corruption and casual editing. Real
  verifiability needs a signing authority.
