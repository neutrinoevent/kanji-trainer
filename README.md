# 字 Kanji Trainer

A local app for learning kanji with spaced repetition. It covers the full jōyō
set, JLPT levels, school grades, jinmeiyō name kanji, and a newspaper-frequency
ranking (3,122 kanji in total), studied in small batches. Everything runs on
your own machine. No accounts, no internet needed after setup.

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

## Features

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
- **Several question types, no drawing.** Multiple-choice meaning, reverse
  (meaning to kanji), reading recognition, typed meaning with typo tolerance,
  and typed reading with a live romaji-to-kana converter (type `nichi`, see
  にち). Question type adapts to how well you know the card.
- **Games.** Eight of them: Match Pairs and Reading Pairs (beat the clock),
  Memory Flip (face-down concentration), Odd One Out (three kanji share an
  on-reading, find the impostor), Snap Judgment (45 seconds of true or false),
  Lightning Round (60-second streak run), Survival (three lives, questions
  march down the frequency list and get harder), and Kanji Horde (pixel-art
  zombies advance on your gate; each correct answer cuts down the closest one).
  Games count in your stats but don't affect the review schedule.
- **Badges.** Twenty of them on the Stats page, from 初陣 (First Battle) to
  常用制覇 (Jōyō Conquest), covering streaks, volume, coverage, night-owl and
  early-riser reviews, and zombie hunting.
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
server.py        the backend (Python standard library only)
run.bat          Windows launcher
run.sh           macOS/Linux launcher
static/          the web UI (plain HTML/CSS/JS)
data/kanji.json  the 3,122-kanji dataset
data/trainer.db  your progress (created on first run; back this up)
```

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
