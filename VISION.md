# Kanji Trainer — Vision & Working Notes

A running document. **Append, don't rewrite.** Each idea gets a numbered entry with
the date it was raised, what it asks for, what it implies for the design, and
what shipped. Superseded entries stay put with a note pointing at what replaced
them — the history of the thinking is part of the value.

Hard constraints that every entry inherits (see also `README.md`):

- Python standard library only. No pip packages, no Node build step, no external services.
- Must stay double-click-runnable on Windows (`run.bat`) for a non-technical user.
- No LLM generation inside the app. No drawing/handwriting input modes.
- User progress lives in `data/trainer.db` and must survive every update.

---

## V-001 — The attainable-fluency ladder (raised 2026-07-27)

### The idea, as stated

A user decides "OK, I'll do the jōyō batch 1, the easiest level." By whatever
goal and timeline they set for themselves *outside* the app, they should be able
to reach a specific, nameable competence:

1. **Look at the kanji and recognize it.** Visual identification.
2. **Know its most common meaning** — the *most* common one specifically, not
   just "some meaning it has."
3. **Pronounce it** as a Japanese person would say it reading aloud: a sign, a
   paper, the cover of a book.
4. **Gradually acquire its further meanings.** The second- and third-most-common
   senses arrive *later*, at subsequent resurgences of that kanji down the path,
   and only after the learner has demonstrated operative fluency with the most
   frequent sense first.

That grouping — visual identification, first meanings, reading aloud, and
staged acquisition of subsequent senses — is a valuable goal that takes a
learner far.

Crucially: this is **one** explicitly-supported destination among many, not a
ceiling. Nothing here should narrow what a more ambitious user can do with the
app. All existing capabilities stay.

### What the audit found (state at tag `v1.0-baseline`, commit b4c4cb8)

The app had the raw material but did not actually teach this ladder:

| Rung | Status before | Why it fell short |
|---|---|---|
| 1. Visual ID | Effectively covered | `mc-kanji` / recognition modes already do this |
| 2. Most common meaning | **Not enforced** | The typed-meaning check accepted *any* meaning in the kanji's list. A learner could answer 日 with "Counter For Days" forever and never learn that its primary sense is "day/sun". |
| 3. Reading aloud | **Wrong target** | `primaryReading()` was `on[0] \|\| kun[0]`, and the typed check accepted any on- or kun-form including bound stems. That tests "recite a reading," not "say this out loud." For 日 it taught にち; a Japanese reader seeing 日 alone says ひ. |
| 4. Staged extra senses | **Absent** | One `meaning` card per kanji, forever. Senses 2 and 3 were displayed on the intro card and then never tested. |

There was also no way for a user to declare a goal ("jōyō batch 1 by
September") and see whether they are on track to reach it.

### Design decisions taken

**D1 — Senses become their own SRS cards, unlocked by demonstrated fluency.**
Facets `sense2` and `sense3` join `meaning` and `reading`. A kanji's `sense2`
card is created only once its `meaning` card is in `review` state with an
interval of at least `SENSE_UNLOCK_DAYS` and enough reps — "operative fluency
with the most frequent significance first." `sense3` is gated the same way
behind `sense2`. Unlocked senses then flow through the ordinary queue, so they
naturally surface as *resurgences of an already-known kanji* rather than as new
material. This is the algorithmic core of the entry.

**D2 — Sense cards get their own daily budget.** If unlocked senses competed
with brand-new kanji for `new_per_day`, deepening would stall widening (or vice
versa). `sense_per_day` (default 4) is separate and independently tunable.

**D3 — The primary-meaning card grades strictly, and explains itself.** Typing
a *real but non-primary* meaning on a `meaning` card is marked wrong, with
feedback that names what happened: "「Sun」 is a meaning of 日, but this card
tests its most common sense: Day. You'll meet 「Sun」 later." Strictness is what
makes rung 2 real, and the explanation is what keeps it from feeling arbitrary.
Toggle: `strict_primary` (default on) — a real pedagogical judgment call, so it
is a setting rather than a one-way door.

**D4 — "Reading aloud" is a curated target, not a heuristic guess.**
`data/spoken.json` maps a kanji to the reading a Japanese person would most
likely produce reading it aloud *in isolation*. A heuristic (prefer a clean
kun-reading with no okurigana dot, else the first on-reading) covers the long
tail, but measured against the top 250 by frequency it was wrong about 18% of
the time — 十→とお, 本→もと, 三→み, 業→わざ, 円→まる, 千→ち. So the frequent
range, which is exactly the range the "batch 1" goal covers, is curated by hand.

**This table is a judgment call, and it is meant to be edited.** It is plain
JSON, separate from code, and the UI labels every answer 音 or 訓 and states
that readings change in compounds. Some entries are genuinely contested (後 is
のち or あと; 度 is ど or たび) — where two answers are both defensible, both
are accepted and the curated one is what gets taught.

**D5 — Goals are first-class and user-defined.** A goal names a set (a
collection, optionally narrowed to a batch range), a target date, and a
fluency bar. The app reports per-rung coverage against it and the daily pace
needed to arrive on time. Goals live in `settings`, so export/import carries
them for free. This is the piece that turns "I'll do jōyō batch 1" from an
intention into something the app can actually show you progress against.

**D6 — Fluency has named tiers rather than a single boolean.** Per card:
*not started → seen → operative (review, interval ≥ 7d) → solid (≥ 21d)*.
"Operative" is the bar for unlocking further senses and the default bar for
goals; "solid" is what the pre-existing "mature" stat already meant, kept
consistent so nothing on the Stats page changes meaning.

### What shipped for V-001

See the commit on branch `fluency-and-senses`. Summary:

- `data/spoken.json` — curated standalone readings + editing instructions.
- Sense-ladder SRS: `sense2`/`sense3` facets, unlock gating, separate daily budget.
- Strict primary-meaning grading with explanatory feedback.
- Reading cards retargeted at the spoken-aloud reading, labelled 音/訓.
- Goals page: create/track goals with target dates, pace, and per-rung readout.
- Fluency rubric surfaced on the dashboard, the kanji detail modal, and batches.

Two things found while building it, fixed in the same pass:

- **Empty cards.** 47 rare variant codepoints in `kanji.json` (jinmeiyō only, no
  frequency rank — 社 U+FA4C, not the everyday 社 U+793E) carry readings but no
  English gloss. They were being given a meaning card whose answer was
  `undefined`. Cards are now only created for facets that have something to
  teach, and the queue filters any such rows left in an existing database. This
  predates V-001; it surfaced because the sense ladder made me look at gloss
  counts.
- **`spoken.json` vs. the updater.** The file invites editing, but `update.py`
  replaces every non-preserved file, so edits would vanish on the next update.
  Added `data/spoken.local.json`: same shape, wins over the shipped file, listed
  in the updater's PRESERVE set and in `.gitignore`. Inviting someone to edit a
  file the updater will overwrite is a trap, not a feature.

### Deliberately NOT done (and why)

- **No audio.** Reading aloud is taught as kana, not sound. Bundling audio
  would break the stdlib-only/small-download constraints; browser speech
  synthesis is unreliable for Japanese across Windows installs. Revisit only
  with a plan for both.
- **No sense data beyond KANJIDIC2's ordering.** The "most common meaning" is
  KANJIDIC2's first gloss. That ordering is good but not a frequency-of-sense
  corpus. Where it is wrong, it is wrong. A curated override file for senses
  (mirroring `spoken.json`) is the obvious fix if this proves annoying.

---

## Backlog — ideas raised but not yet scheduled

Carried over from earlier sessions and this audit. Not commitments.

- Double-XP combo for perfect runs; weekly quests; charm rarities.
- Per-kanji example vocabulary (would make the on/kun split concrete — a strong
  companion to V-001's D4, since it shows *why* the reading changes).
- Visually-similar distractors (士/土, 未/末) instead of frequency-neighbour ones.
- Radical/component quiz mode.
- Sense-override file, mirroring `spoken.json`, if KANJIDIC2 gloss order proves
  misleading in practice.
- Compound-reading drill: given 日本, is 日 read にち, じつ, or ひ?

## Open questions for the owner

1. Is `strict_primary` the right default? It is the honest reading of V-001 but
   it will feel harsh the first time it marks a correct-but-secondary answer wrong.
2. Should a goal's deadline ever *change the scheduler* (push more cards to hit
   the date), or only report pace? Currently it only reports — the SRS stays
   pedagogically honest and the user adjusts `new_per_day` themselves.
3. How far should `spoken.json` curation extend? Currently the frequent range;
   the tail falls back to the heuristic.

---

## Change log

- **2026-07-27** — V-001 raised and implemented. Baseline preserved as git tag
  `v1.0-baseline` and as a standalone copy at
  `../kanji-trainer-ARCHIVE-v1.0-20260727/`. Work done on branch
  `fluency-and-senses`.
