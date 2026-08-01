# Ideas

A running list. Add to it as things come up rather than carrying them in
conversation — long sessions lose context, and a good idea recorded badly is a
good idea lost.

Nothing here is a commitment. Shipped ideas move to a numbered `VISION.md` entry;
open defects live in `docs/KNOWN-ISSUES.md`.

**Rough sizes:** `S` an afternoon · `M` a day or two · `L` a project.

---

## Next up — highest value first

### 1. Scope the Path — `S`
The last unscoped surface. `pathNodes()` always walks the top of the frequency
list, so a learner working through Grade 1 who taps Path gets frequency-ordered
kanji instead of their own set. Third instance of a bug class already fixed for
review (V-005) and games (V-008); the fix has a known shape. `KNOWN-ISSUES` #8.

### 2. Curated sense data — `M`
`data/senses.json`, mirroring `spoken.json`'s editable + `.local.json` override
pattern. Group synonyms and rank genuinely distinct senses, at least across the
frequent range. **This is the blocker for defaulting `strict_primary` back on** —
it is off only because KANJIDIC2's gloss list mixes real senses (月 Month/Moon)
with synonyms (大 Large/**Big**). Would also stop the sense ladder spending a
card teaching "Big".

### 3. "Your numbers moved" notice — `S`
Existing users' *learned* count, jōyō coverage and batch mastery all drop on
update, because those now mean *demonstrated* rather than *scheduled* (V-006).
Correct behaviour that looks exactly like lost progress. One dismissible card on
first run after the update. `KNOWN-ISSUES` #9.

### 4. The first-run tour is three features out of date — `S`
It covers Dashboard, Path, Batches, Goals, Review, Stats, Settings — and never
mentions **Lists, Exams or Games**, three of the ten nav items and two of them
the newest and least discoverable things in the app. A new learner is introduced
to a program that no longer matches what's in front of them. Also worth revisiting
now that review is scoped: the tour still describes review as "your daily queue"
without mentioning that it can be narrowed to exactly what you're studying.

### 5. Leech handling — the data is already there, unused — `M`
`srs.lapses` has been recorded since v1 and **nothing reads it**. A card the
learner keeps failing just comes back forever. Demonstration-based fluency makes
this worse than it used to be: such a card can never reach operative, so it also
permanently suppresses batch mastery, goal progress and jōyō coverage, with no
way to intervene and no explanation of why the number is stuck.

Wants: surface them ("these six are fighting you"), and offer real choices —
park it, relearn it deliberately from the intro card, or add a note/mnemonic.
Anki suspends leeches; parking plus a nudge is probably gentler and fits this
app's voice better.

### 6. Visually-similar distractors — `M`
Multiple choice currently draws distractors from frequency neighbours, which is
plausible but not *hard*. Confusion pairs — 士/土, 未/末, 待/持, 開/閉 — are what
actually catch a reader out. Needs a similarity source: shared radical +
stroke-count proximity is computable from the existing dataset; a curated pair
list would be better for the frequent range. The sibling hiragana-trainer likely
has confusable-pair machinery worth reading first.

### ~~7. Example vocabulary per kanji~~ — DONE (V-016)
Makes the on/kun split concrete: showing 日本 / 日曜日 / 今日 is *why* 日 is ひ
alone but にち in compounds. Needs a vocabulary source (JMdict, CC BY-SA, same
attribution treatment as KANJIDIC2). Also unlocks idea 6.

### 8. Compound-reading drill — `M` — now unblocked
Given 日本, is 日 read にち, じつ or ひ? Tests exactly what the read-aloud cards
deliberately simplify away. `data/vocab.json` (V-016) is the dataset it needed,
so this is ready to build.

---

## Exams and certification

- **Shareable, verifiable certificates.** Records are already sealed and chained
  for this (V-011). What's missing is an authority to *sign* them — a local app
  has no secret, so the current chain detects corruption and casual editing but
  is not proof against a determined user. Needs the hosting decision in
  `docs/PARKED-phone-access-and-sync.md`. `L`
- **Exam variants** — a timed paper; reading-only or meaning-only; a
  recertification exam sampling across every batch already passed. `M`
- **Bring exam misses forward in the schedule.** Considered and rejected in
  V-010 D3 because it gives the exam a cost. Worth revisiting once we know
  whether the drill-the-missed button actually gets used. `S`
- ~~**Exam readiness signal.**~~ Done (V-016) — ready/nearly/passed on the batch
  page, the Batches grid, the review hub and a ranked exam picker.

## Study mechanics

- **Radical / component quiz mode.** `M`
- **Auto-lists** — a live "everything I missed this week" that maintains itself.
  Deliberately not built in V-012 (a list is currently a deliberate act, which is
  easier to reason about), but this is the obvious next step. `M`
- **List ordering and notes.** Lists sit in creation order with no reordering. `S`
- **Leech handling.** A card missed many times keeps coming back forever with no
  intervention. Anki suspends them; we should at least surface them and offer to
  park or relearn deliberately. `M`
- **Per-kanji notes / mnemonics.** User-written, stored alongside progress. `S`

## Interface

- **Odd One Out on narrow scopes.** It needs three kanji sharing an on-reading,
  which a batch rarely contains, so it declines. Could take the odd one *from*
  the scope and the matching trio from outside, clearly marked.
  `KNOWN-ISSUES` #10. `S`
- **Keyboard-only review.** Number keys and Enter cover most of it; the list
  popover, drill and exam are mouse-dependent in places. `S`
- **A 教科書体 face.** The most pedagogically useful typeface and the least likely
  to be installed — but a Japanese font is 5–20 MB against a 500 KB repo, so
  bundling is rejected on size. Could detect and *suggest* installing one. `S`
- **Print a batch** as a study sheet. `S`

## Data and durability

- **Sync between devices.** Out of scope until the hosting question is settled;
  JSON export/import covers it manually. See the parked doc. `L`
- **Selective import / merge.** Import replaces everything. Merging two machines'
  progress needs answers to real conflict questions (which card state wins, how
  review histories union). Snapshots make this safer to attempt now, since any
  attempt is undoable. `M`
- **Prune snapshots by size, not just count.** Retention is count-based; a heavy
  user with a long review history could accumulate more on disk than intended.
  Add a total-bytes ceiling. `S`
- **Surface backup health on the dashboard** — a quiet line if the external
  mirror hasn't been writable for a while, since that is the copy that survives
  losing the folder and its failure is currently silent. `S`

## Maintenance and debt

- **`static/js/` — split from one 4,300-line file into eight in V-014.** No build step is a hard
  constraint, but that doesn't require a single file — several plain `<script>`
  tags in dependency order would work with no tooling at all. Worth doing before
  it gets bigger; edits to a file this size are already error-prone, and this
  session lost time to patches failing to match in it. Suggested split: core/state,
  scopes+lists, review/session, games, exam, pages. `M`
- **The dashboard is accumulating cards** — recovery, fluency ladder, goal
  spotlight, daily goals, activity chart, next-batch hint. Fine for now, but it
  needs an editor's pass before the next thing is added to it. `S`
- **Two known-stale test assertions** (`game:odd`; a removed `__lastSess` hook).
  Harmless but they cost attention every regression run. `S`

## Data files worth extending

Four curated files now drive quality, all following the same pattern: shipped in
`data/`, overridable in `userdata/*.local.json`, merged server-side. Each one
improves the app just by growing, with no code change and no decision:

- `senses.json` — 149 kanji. Growing it tightens strict grading automatically.
- `similar.json` — 200 kanji. Growing it makes multiple choice harder.
- `vocab.json` — 145 kanji. Growing it explains more readings.
- `spoken.json` — 76 kanji. Growing it fixes more read-aloud answers.

Good work to chip away at rather than schedule.

## Rejected, and why — so they aren't re-proposed

- **LLM generation in the app** — standing product rule.
- **Drawing / handwriting input** — standing product rule. For kana this rules
  out stroke-order practice; raised in the sibling's brief rather than worked
  around.
- **Binding the server to `0.0.0.0`** to reach it on a LAN. Would expose an app
  with no authentication to whatever network the machine is on. Tailscale or a
  tunnel is the answer (parked doc).
- **A shared design-system package across the two trainers.** Two programs is too
  few to justify the abstraction; the class names are deliberately identical
  instead.
