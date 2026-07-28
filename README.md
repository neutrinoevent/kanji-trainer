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
  kanji, and typing a real-but-secondary meaning tells you exactly that instead
  of just "wrong". Radical names and counter notes ("One Radical (no.1)") are
  filtered out, so they never turn up as a "meaning" to learn.
- **Reading aloud, not reading recital.** Reading cards ask what you'd *say*
  looking at the bare character. Those readings are curated in
  `data/spoken.json` (editable — see below), labelled 音読み or 訓読み, and the
  app still accepts the kanji's other real readings while nudging you to the
  standalone one.
- **Tracks and batches.** Study by frequency rank, JLPT level (N5 to N1),
  school grade (1 to 6 plus secondary), or jinmeiyō name kanji. Within every
  track, kanji are ordered most common first. Batch size is configurable.
- **A guided path.** A step-by-step road through the most common kanji, five
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
- **Misses ask for the answer back.** Get one wrong and you're shown what the
  answer was and why, then asked to produce it before moving on. Answering with
  a real but secondary meaning is accepted and says so — but it doesn't count
  toward knowing the primary sense.
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
- **Games.** Eight of them: Match Pairs and Reading Pairs (beat the clock),
  Memory Flip (face-down concentration), Odd One Out (three kanji share an
  on-reading, find the impostor), Snap Judgment (45 seconds of true or false),
  Lightning Round (60-second streak run), Survival (three lives, questions
  march down the frequency list and get harder), and Kanji Horde (pixel-art
  zombies advance on your gate; each correct answer cuts down the closest one).
  Games count in your stats but don't affect the review schedule.
- **XP, levels, and ranks.** Every answer and path star earns XP. Levels climb
  through ten Japanese-flavored ranks, from 見習い (Apprentice) to 漢字王
  (Kanji King), with a progress bar on the dashboard and daily goals that
  reset at midnight.
- **Badges and charms.** Thirty badges on the Stats page, from 初陣 (First
  Battle) to 常用制覇 (Jōyō Conquest), covering streaks, volume, coverage,
  path progress, night-owl reviews, and zombie hunting. Treasure chests along
  the path hold twelve collectible charms (招き猫, 鳥居, 折鶴, ...).
- **Stats.** Daily activity, a 4-month heatmap, per-batch mastery, jōyō
  coverage, accuracy, day streak, and your most-missed kanji.
- **Persistence.** Everything is stored in a local SQLite database
  (`data/trainer.db`), with JSON export/import to back up or move progress
  between computers.
- Dark mode by default, with a light theme toggle.

## Keyboard shortcuts (during review)

- `1`–`4` picks an answer
- `Enter` checks a typed answer / continues to the next card

## Files

```
server.py               the backend (Python standard library only)
run.bat                 Windows launcher
run.sh                  macOS/Linux launcher
static/                 the web UI (plain HTML/CSS/JS)
data/kanji.json         the 3,122-kanji dataset
data/spoken.json        curated read-aloud readings (editable, see below)
data/spoken.local.json  your own reading overrides (optional; survives updates)
data/trainer.db         your progress (created on first run; back this up)
VISION.md               where the design ideas and decisions are written down
```

### Correcting a read-aloud reading

Which reading a bare kanji takes is sometimes a judgment call, and
`data/spoken.json` is one person's answer. To change one, don't edit that file —
updating the app replaces it. Make `data/spoken.local.json` instead:

```json
{ "overrides": { "後": "あと", "側": "がわ" } }
```

Same shape, wins over the shipped file, and `update.bat` leaves it alone along
with your progress. Restart the app to pick up changes.

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
