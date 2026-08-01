# 字 Kanji Trainer

A local app for learning kanji with spaced repetition. It covers the full jōyō
set, JLPT levels, school grades, jinmeiyō name kanji, and a newspaper-frequency
ranking (3,122 kanji in total), studied in small batches. Everything runs on
your own machine. No accounts, no internet needed after setup.

Its sibling program, [Hiragana Trainer](https://github.com/neutrinoevent/hiragana-trainer),
covers the two kana syllabaries that come before this one.

## Quick start

**Requirement: Python 3.9+** (standard install from [python.org](https://www.python.org/downloads/);
on Windows, tick *"Add python.exe to PATH"* during install). Nothing else. No
pip packages, no Node, no database server.

| OS | How to run |
|---|---|
| **Windows** | Double-click `run.bat` |
| macOS / Linux | `./run.sh` (or `python3 server.py`) |

Your browser opens at `http://127.0.0.1:7777` automatically. To use a different
port: `python server.py 8080`.

## What you're aiming at

For any set you pick — say the first batch of Grade 1 — the app treats "I know
this kanji" as four specific things, in the order you climb them:

1. **You recognise it** on sight.
2. **You know its most common meaning** — that one specifically. Answer a
   meaning card with a real but secondary sense and the app accepts it *and*
   tells you which sense ranks first, so the ranking gets taught either way.
   (There's a setting to make only the primary sense count; it's off by default
   because the underlying meaning lists mix distinct senses like 月 Month/Moon
   with plain synonyms like 大 Large/Big.)
3. **You can read it aloud** the way a Japanese reader would say it seeing the
   bare character on a sign or a book cover. That is often *not* the first
   reading in the dictionary: 日 alone is ひ, not にち.
4. **Its further meanings arrive later.** The second and third senses unlock by
   themselves once the first one is genuinely solid, then come back as review
   rather than as new material.

Set a **goal** — a set of kanji and a date that matters to you — and the app
reports where you stand on each rung and whether your current pace reaches the
date. It won't quietly reschedule reviews to make the number look better.

Rungs 1–3 are a real, finishable destination. Rung 4 keeps going; so does
everything else in the app.

## Features

- **Your own lists.** Group kanji however you like — the ones you keep missing, a
  set for a trip, whatever. A list can be reviewed, drilled, played as a game or
  sat as an exam exactly like a built-in set. Add a kanji to one from wherever you
  happen to be: mid-review, on the batches grid, from your stats, from an exam
  report. Optional templates can seed a new list from your most-missed kanji or by
  copying a batch. Adding a kanji to a list doesn't start it studying, and
  deleting a list never touches your progress.
- **A mastery exam to crown a batch.** When you've finished a set, sit an exam on
  it. One question per kanji on meaning and one on reading, with the question
  types spread so every paper contains recognition, reverse recall and unaided
  typing — about fifty questions for a batch of twenty-five, no timer. Feedback
  comes at the end, nothing is re-asked, and it leaves your review schedule
  completely alone, so a bad day costs nothing but the time. Pass at 80% overall
  *and* 70% in each section, so you can't pass on meaning alone while unable to
  read any of them. Second meanings appear only where you've already unlocked
  them, as bonus marks that can add to your score but never subtract. The result
  itemises every miss and offers to drill exactly those kanji.
- **Review what you're actually studying.** The Review page lets you review
  everything at once, or narrow it to one set, one batch, or one goal. Sets
  overlap — a kanji can be in Frequency, Grade 1 and N5 at the same time — so
  studying "Grade 1, batch 1" no longer means being quizzed on everything else
  you've ever started. Every set and batch also has a **Drill** button: practise
  it whenever you like, as many times as you like, without disturbing the review
  schedule.
- **Goals.** Name a set (a whole track, or its first N batches), a target date,
  and how firmly you want to know it — *operative* or *solid*. You get a
  per-rung readout and an honest pace check:
  "18 kanji left to start, 40 days out, that's 2/day — within your 10/day
  setting."
- **The sense ladder.** Each kanji starts with one meaning card, for its most
  common sense. Once you've actually demonstrated that one — produced it from
  memory, in more than one kind of question, on more than one day — a
  second-meaning card unlocks on its own and turns up as a review of a kanji you
  already know.
  Extra meanings have their own daily budget so depth never crowds out new
  kanji, and answering with a *different* sense tells you exactly that instead of
  just "wrong". Which meanings are genuinely distinct is curated in
  `data/senses.json` across the beginner range, so "big" and "large" both count
  as 大 while "sun" is understood as a different sense of 日 — and radical names
  and counter notes never turn up as a "meaning" to learn.
- **Real words, so the readings make sense.** A kanji's reading changes in
  compounds, and being told that is far less use than seeing it: 日 is shown in
  **日**本 (に), 三**日** (か) and 毎**日** (に), each tagged 音 or 訓, with the kanji
  picked out inside the word. Shown on the card, after every answer and in the
  detail view — never tested, because it's there to explain, not to memorise.
- **Reading aloud, not reading recital.** Reading cards ask what you'd *say*
  looking at the bare character. Those readings are curated in
  `data/spoken.json` (editable — see below), labelled 音読み or 訓読み, and the
  app still accepts the kanji's other real readings while nudging you to the
  standalone one.
- **Tracks and batches.** Study by frequency rank, JLPT level (N5 to N1),
  school grade (1 to 6 plus secondary), or jinmeiyō name kanji. Within every
  track, kanji are ordered most common first. Batch size is configurable.
- **A guided path.** A step-by-step road through a set of your choosing — the
  most common kanji, a school grade, a batch, or one of your own lists — five
  at a time: a learn step, a quiz step, a match round every third unit, and a
  checkpoint every fifth. Steps earn one to three stars and unlock in order.
  It feeds the same review schedule as the rest of the app, so you can mix
  the path with batches freely.
- **Shared progress across sets.** A kanji that appears in several sets (日 is
  in the frequency, Grade 1, and N5 sets at once) has exactly one meaning card
  and one reading card. Starting a batch adds only the kanji you don't already
  have, and progress made in one track counts in every other.
- **Spaced repetition.** Each kanji has a meaning card and a reading card,
  scheduled SM-2 style: 10 minutes, 1 day, 3 days, then growing intervals.
  Misses reset the card and lower its ease.
- **Fluency is earned, not waited out.** A kanji counts as *operative* when
  you've demonstrated it: produced from memory rather than picked out of four,
  in more than one kind of question, on more than one day, at decent accuracy.
  *Solid* means every question type, repeatedly, across several days. A long
  gap since the last review proves nothing on its own, so it isn't used as the
  measure — and the app tells you exactly what a card still needs.
- **Cards that fight you get named.** Some kanji just won't stick, and repeating
  them harder doesn't help — they also can't count toward your totals until they
  come good, which is part of why a batch can feel stuck. Those are listed on the
  dashboard with three ways out: park it (out of your queue *and* out of the
  figures, so it stops dragging them down), start it over from scratch, or write
  yourself a mnemonic. Notes show up on the card itself and after every answer.
- **Misses ask for the answer back.** Get one wrong and you're shown what the
  answer was and why, then asked to produce it before moving on. Answering with
  a real but secondary meaning is accepted and says so — but it doesn't count
  toward knowing the primary sense.
- **Distractors that are actually hard.** When you're asked to pick the kanji for
  a meaning, the wrong options are the ones you'd genuinely mistake it for — 待
  against 持 and 時, not against whatever happened to sit nearby in the frequency
  list. Confusing similar-looking characters is the dominant failure in real
  reading, so it's what the questions test. Curated in `data/similar.json`.
- **Several question types, no drawing.** Multiple-choice meaning, reverse
  (meaning to kanji), reading recognition, typed meaning with typo tolerance,
  and typed reading with a live romaji-to-kana converter (type `nichi`, see
  にち). Question type adapts to how well you know the card. Second-meaning
  cards skip the reverse question, since several kanji can carry the same
  secondary sense.
- **Kanji shown in more than one typeface.** Print uses 明朝, signage uses
  ゴシック, schoolbooks use 教科書体, and the shapes differ enough to catch out a
  learner who has only met one. Quiz prompts rotate through whatever Japanese
  faces your computer actually has — *actually*, because each one is measured
  rather than assumed, and any that renders identically to another is dropped.
  Teaching surfaces stay in one font for legibility. Settings shows you every
  face it found and lets you turn the whole thing off.
- **Games follow the set you're studying.** Pick a set on the Games page — a
  goal, a track, a single batch, or everything — and a game only ever asks about
  kanji from it. Nothing is silently substituted: if a set is too small for a
  game, it says so and offers to widen rather than quietly pulling in characters
  you've never seen. The general, everything-in-rotation modes are all still
  there.
- **Compound readings.** 日 is ひ on its own but に in 日本 and か in 三日. Given a
  real word, pick how the kanji is read inside it — then see the same character
  read differently elsewhere. This is the gap between recognising a kanji and
  actually reading one.
- **Games.** Nine of them: Match Pairs and Reading Pairs (beat the clock),
  Memory Flip (face-down concentration), Odd One Out (three kanji share an
  on-reading, find the impostor), Snap Judgment (45 seconds of true or false),
  Lightning Round (60-second streak run), Survival (three lives, questions
  march down the frequency list and get harder), and Kanji Horde (pixel-art
  zombies advance on your gate; each correct answer cuts down the closest one),
  and Compound Readings.
  Games count in your stats but don't affect the review schedule.
- **XP, levels, and ranks.** Every answer and path star earns XP. Levels climb
  through ten Japanese-flavored ranks, from 見習い (Apprentice) to 漢字王
  (Kanji King), with a progress bar on the dashboard and daily goals that
  reset at midnight.
- **Badges and charms.** Thirty-four badges on the Stats page, from 初陣 (First
  Battle) to 常用制覇 (Jōyō Conquest), covering streaks, volume, coverage,
  path progress, night-owl reviews, and zombie hunting. Treasure chests along
  the path hold twelve collectible charms (招き猫, 鳥居, 折鶴, ...).
- **Stats.** Daily activity, a 4-month heatmap, per-batch mastery, jōyō
  coverage, accuracy, day streak, and your most-missed kanji.
- **Persistence.** Everything is stored in a local SQLite database
  (`userdata/trainer.db`), with JSON export/import to back up or move progress
  between computers.
- **Backups that survive the app.** Everything you own lives in `userdata/`,
  which the updater cannot reach. The app takes timestamped, compressed
  snapshots as you use it — thinned to the recent ones, then one a day, then one
  a month — and keeps a copy in your operating system's own user-data folder,
  outside the app entirely. Delete this folder, re-clone it, or reinstall from
  scratch and the app will notice it has no progress, find that copy, and offer
  to put it back.
- Dark mode by default, with a light theme toggle.

## Keyboard shortcuts (during review)

- `1`–`4` picks an answer
- `Enter` checks a typed answer / continues to the next card

## Files

```
server.py               the backend (Python standard library only)
run.bat                 Windows launcher
run.sh                  macOS/Linux launcher
static/                 the web UI (plain HTML/CSS/JS, no build step)
  js/                   the frontend in eight plain scripts — see js/README.md
data/kanji.json         the 3,122-kanji dataset
data/senses.json        curated meanings, grouped by sense (editable, see below)
data/similar.json       kanji that look alike, for harder multiple choice
data/vocab.json         example words showing how readings change
data/spoken.json        curated read-aloud readings (editable, see below)
userdata/               everything you own — updates never touch this
  trainer.db            your progress (created on first run)
  snapshots/            automatic timestamped backups
  spoken.local.json     your own reading overrides (optional)
  senses.local.json     your own meaning overrides (optional)
  similar.local.json    your own look-alike groups (optional)
  vocab.local.json      your own example words (optional)
  exam-log.jsonl        your exam records, in plain text
VISION.md               where the design ideas and decisions are written down
```

### Correcting a meaning or a reading

Both the senses a kanji is taught and the reading you'd say aloud are judgment
calls, curated in `data/senses.json` and `data/spoken.json`. To change either,
don't edit those — updating replaces them. Put your version in
`userdata/senses.local.json` or `userdata/spoken.local.json`, which live where
updates can't reach:

```json
{ "senses": { "安": [["Cheap", "Inexpensive"], ["Peaceful", "Calm", "Safe"]] } }
```

Each group is one sense; the first wording is the one taught, and any wording in
the group counts as fully correct for it.

### Correcting a read-aloud reading

Which reading a bare kanji takes is sometimes a judgment call, and
`data/spoken.json` is one person's answer. To change one, don't edit that file —
updating the app replaces it. Make `userdata/spoken.local.json` instead:

```json
{ "overrides": { "後": "あと", "側": "がわ" } }
```

Same shape, wins over the shipped file, and lives in `userdata/` where updates
can't reach it. Restart the app to pick up changes.

## Updating

Close the app, then double-click `update.bat` (Windows) or run `./update.sh`
(macOS/Linux). It fetches the latest version from GitHub and replaces the app
files. Your progress is not touched: `data/trainer.db` is left alone and a
backup is written to `data/trainer.db.bak` first. It works for git clones
(via `git pull`) and plain downloaded folders (via a zip download) alike.

## Sharing with someone else

Zip the folder (leave out `data/trainer.db` so they start fresh) and send it.
They install Python, double-click `run.bat`, done.

## About

Kanji Trainer was made by Alexander Nichols (Old Dominion University). It began
as a way to help my brother prepare for his move to Japan and his studies in
Waseda University's JCulP program: he needed to learn a couple thousand kanji
in a sensible order, on Windows, without a pile of dependencies.

You don't need a plane ticket for it to work for you, though. Whether you're
studying for the JLPT, planning a trip, or just want to read a menu someday,
the plan is the same one: learn the most common characters first, in small
batches, and show up for a few minutes of review each day.

## Data attribution

Kanji readings/meanings derive from **KANJIDIC2** © EDRDG, licensed
CC BY-SA 4.0, via the [davidluzgouveia/kanji-data](https://github.com/davidluzgouveia/kanji-data)
compilation. Frequency ranks come from newspaper corpus counts.
