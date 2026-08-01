# Handoff

**Current as of 2026-07-31.** This is the single living handoff — update it in
place rather than adding another dated file. (`HANDOFF-2026-07-27-pre-option-c.md`
is kept as a historical artifact of the parked PWA decision, not as state.)

Read in this order: this file → `VISION.md` (the design log, V-001 … V-015) →
`docs/KNOWN-ISSUES.md` → `docs/IDEAS.md`.

---

## 1. What this is

A local kanji trainer. Python-standard-library server + vanilla JS + SQLite,
double-click runnable on Windows, 3,122 kanji. Built for Alexander's brother
ahead of a move to Japan and study at Waseda; useful to anyone learning kanji.

`main` is pushed and clean. 42 commits. Roughly 1,600 lines of `server.py`,
4,570 of frontend across eight files in `static/js/`, 727 of CSS.

Sibling project: `neutrinoevent/hiragana-trainer`, built from
`hiragana-trainer-kickoff-prompt.txt` in this repo root (untracked). It found and
fixed a real bug here — unbounded SRS intervals overflowing `datetime` on the
14th review of a card.

## 2. Shipped

Each has a numbered `VISION.md` entry with the reasoning, the rejected
alternatives, and what was deliberately left out.

| | | |
|---|---|---|
| V-001 | Fluency ladder: sense progression, read-aloud readings, goals | shipped |
| V-005 | Scoped review + drill mode | shipped |
| V-006 | Demonstration-based fluency; feedback you can't miss | shipped |
| V-007 | Batch mastery that moves during a session | shipped |
| V-008 | Games scoped to the set being studied | shipped |
| V-009 | Typeface variety, measured rather than assumed | shipped |
| V-010 | Mastery exam | shipped |
| V-011 | Exam brief + certification-grade records | shipped |
| V-012 | Lists — user-made groupings of kanji | shipped |
| V-013 | Data that survives the app: `userdata/`, snapshots, offsite copy | shipped |
| V-014 | Numbers-moved notice, scoped Path, refreshed tour, leech handling | shipped |
| V-015 | Curated senses; strictness follows the data; frontend split | shipped |
| V-016 | Look-alike distractors, example vocabulary, exam readiness | shipped |
| V-017 | Compound reading drill; adaptive practice exams | shipped |
| V-002/3/4 | Phone access, hosting, durable sync | **parked** — see `docs/PARKED-…` |

## 3. The load-bearing ideas

If you understand nothing else, understand these six.

**Scopes are the spine.** A scope is `null` (everything), `{cid, from, to}` (a
built-in track, optionally a batch range), or `{list: id}` (a user list). Review,
drill, all eight games, the mastery exam and the Path all take one. Any new
surface that asks a question needs a scope, and every route *into* it must carry
that scope. **Three separate bugs came from forgetting this** — review (V-005),
games (V-008), the Path (V-014). All fixed; the lesson isn't.

**Fluency is demonstrated, not waited out.** `demo_tier()` computes a card's tier
from the review log: distinct question types answered on target, at least one
*produced from memory*, a minimum count, across distinct days, at accuracy.
Scheduling intervals don't enter into it.

**"Correct" and "on target" differ.** Answering with another sense may be
accepted, but never counts toward demonstrating the primary one — the `on_target`
column carries that. Since V-015 strictness applies *only* to kanji with curated
groupings in `data/senses.json`, because "big" for 大 is the same sense worded
differently and marking it wrong would be a false negative.

**Don't trust, measure.** Typefaces are fingerprinted and any that render
identically are dropped, because CSS falls back silently (V-009). Games refuse to
substitute kanji from outside a scope (V-008). Backups are restored in a test,
not assumed to work (V-013).

**Progress must be visible while it's being made.** A number that can't move
during a session teaches the learner that effort is invisible (V-007). Keep the
bars strict; keep the distance to them legible.

**Nothing the user owns is ever taken away.** Not their data — `userdata/` is a
boundary, not a list — and not what they've earned. When a ninth game was added
in V-017 it was deliberately kept out of `GAME_MODE_IDS`, because that list
drives a badge and extending it would un-earn a badge people already held.

**Nothing the user owns is ever deleted or overwritten.** `userdata/` is a
boundary, not a list — it's gitignored, so it isn't in the repo, so it isn't in
the download, so an update can't reach it. Restores snapshot first. Parking a
card, deleting a list, adopting an older database: all reversible.

## 4. Conventions

- **`VISION.md` is append-only.** Numbered entries with the idea, the audit, the
  decisions *and their reasoning*, what shipped, what was skipped and why.
  Revisions go **underneath** the original (see "D3 revised"), never replacing it.
- **`docs/IDEAS.md`** is the running idea list. Add to it as things come up
  rather than carrying them in conversation.
- **`docs/KNOWN-ISSUES.md`** has a *"not issues, don't fix these by mistake"*
  section for deliberate choices. Read it before "fixing" anything.
- **Commits: sole author `neutrinoevent`.** No `Co-Authored-By`, no "Generated
  with", no mention of any AI tool anywhere in the repo — commit messages, code
  comments, README, repo description. Verified clean across all history.
  Alexander attributes the collaboration himself when he talks about the project.
- **Commit messages are prose paragraphs** explaining reasoning and rejected
  alternatives, not bullet lists.
- **Delete `userdata/` before every commit** so the repo ships clean and
  first-run flows stay testable.
- **The frontend is eight plain scripts** in `static/js/`, loaded in dependency
  order, no bundler. Read `static/js/README.md` before adding to it.

## 5. How to test

Run `python3 server.py 7791` in the background, curl the API, then drive the UI
over CDP: chromium at
`~/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-x64/chrome-headless-shell`
with `--remote-debugging-port=9222`, plus Node's native `WebSocket`. Write `.mjs`
driver files to a scratch dir — heredocs mangle `${}` in JS template literals.
Screenshot and actually look at the images.

**Test the thing, not the appearance of the thing.** Three worth copying: the
typeface work pixel-hashes glyphs rather than trusting font names; the exam's
marking was extracted into a pure `scoreExam()` so thresholds could be checked
without a browser; the backup work *performs the disaster* rather than reasoning
about it. All three caught real bugs — including one where the harness itself was
wrong in exactly the way the feature guards against.

**Seed before judging a regression.** Games decline an empty rotation by design,
so a run against a fresh database reports six "failures" that aren't. Seed a
batch first.

**Known-stale assertions:** `game:odd` "fails" because Odd One Out now correctly
declines narrow scopes, and one old driver depends on a removed `__lastSess`
hook. Don't chase them.

## 6. Two traps this project has already fallen into

Worth naming because both were invisible until tested.

**Curating "what's wrong" and gating on "what's curated" are different sets.**
The first sense pass covered only kanji whose glosses needed fixing, skipping
ones already correct — including 日, the most frequent kanji in the language. But
the strictness gate keys off *curation*, so those were silently graded leniently.

**Docs and onboarding rot without any signal.** The first-run tour drifted three
features out of date. Re-read it whenever a nav item is added.

## 7. Recovery points

Tags `v1.0-baseline`, `v1.1-fluency-ladder`, `v1.2-pre-pwa`; branches
`v1.0-main-snapshot`, `fluency-and-senses`; sealed read-only archives at
`../kanji-trainer-ARCHIVE-v1.0-20260727/`, `-v1.1-`, and `-v1.2-pre-pwa-`
(that last has a git bundle, tarball and SHA-256 manifest — see its
`RESTORE.md`). Everything is on GitHub.

`kanji-trainer-revisit-prompt.txt` and `hiragana-trainer-kickoff-prompt.txt` in
the repo root are Alexander's own files. Leave them untracked.

## 8. What to do next

Detail and reasoning in `docs/IDEAS.md`.

1. **Practice-exam follow-ons** — the machinery is built (V-017), so these are
   changes to *selection*, not new systems: readiness informed by practice
   results; a paper generated from a failed mastery exam; a full-length mock with
   no adaptation; spaced weekly practice.
2. **Extend the four curated data files** — `senses`, `similar`, `vocab`,
   `spoken`. Each improves the app just by growing, with no code change and no
   decision. Good work to chip away at.
3. **Auto-lists** — a live "everything I missed this week" that maintains itself.
4. **Leech follow-through** — parking and notes exist; nothing yet checks whether
   a parked card ever comes back or whether notes actually help.
5. **Radical / component quiz mode.**
