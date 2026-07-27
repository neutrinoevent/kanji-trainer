# Handoff — 2026-07-27, immediately before Option C (static PWA) development

Written at a deliberate stopping point, before any code moves toward the PWA.
Audience: whoever picks this up next, including a future agent instance with no
memory of how we got here. Everything needed to resume is in this file or
pointed at from it.

Companion documents:

- `VISION.md` — the running idea log (V-001 shipped, V-002/V-003 analysis)
- `README.md` — what the app is and how a user runs it
- This file — state, reasoning trail, and the plan for what comes next

---

## 1. Where the project stands right now

**Working, shipped, on `main`.** A local kanji-learning app: Python standard
library server + vanilla JS frontend + SQLite, launched by double-clicking
`run.bat` on Windows. 3,122 kanji, SRS scheduling, 8 games, a guided path,
badges/charms/XP, and — new today — the fluency ladder (V-001).

**Git state at time of writing.** `main` is **5 commits ahead of
`origin/main` and has not been pushed.** Nothing is on GitHub yet from today's
work; github still serves the v1.0 app.

```
060ace5  VISION: record V-003, the full phone-access option space
177f5cc  VISION: record V-002, phone access over Tailscale
e527613  Filter non-sense glosses; don't mark correct-but-secondary wrong
3087453  Merge branch 'fluency-and-senses'
1f0885a  Teach the fluency ladder: goals, sense progression, read-aloud readings
b4c4cb8  ← v1.0-baseline / v1.0-main-snapshot  (last pushed commit)
```

**Every recovery point.** Nothing has been deleted or rewritten at any stage:

| Kind | Name | Points at |
|---|---|---|
| tag | `v1.0-baseline` | pre-fluency-ladder (`b4c4cb8`) |
| tag | `v1.1-fluency-ladder` | the merge, before doc commits |
| tag | `v1.2-pre-pwa` | this handoff — the Option C starting line |
| branch | `v1.0-main-snapshot` | pre-merge `main` |
| branch | `fluency-and-senses` | the feature branch, unmerged copy |
| folder | `../kanji-trainer-ARCHIVE-v1.0-20260727/` | full standalone repo |
| folder | `../kanji-trainer-ARCHIVE-v1.1-20260727/` | full standalone repo |
| folder | `../kanji-trainer-ARCHIVE-v1.2-pre-pwa-20260727/` | full repo + git bundle + checksums |

**Authorship policy (non-negotiable).** Every commit is authored *and* committed
solely as `neutrinoevent <214048666+neutrinoevent@users.noreply.github.com>`.
No `Co-Authored-By` trailers, no "Generated with" lines, no reference to any AI
tool in commit messages or in any shipped file. Verified clean across all
history. Alexander attributes the AI collaboration himself when he speaks about
the project; the repo stays his.

---

## 2. The reasoning trail — what drove us to Option C

Worth preserving because the destination is not obvious from the starting point.

**Step 1 — the fluency ladder (V-001).** Alexander described a concrete
attainable competence: see a kanji, know its most common meaning, say it aloud
as a Japanese reader would, and pick up further meanings later once the first is
solid. The audit found the app had the raw material but taught none of it
properly. Shipped as sense-ladder SRS facets, curated read-aloud readings, and a
Goals page.

**Step 2 — a mid-course correction worth remembering.** The plan was to grade
meaning cards strictly against the primary sense. Checking the actual dataset
before shipping killed that: KANJIDIC2's gloss list is not a ranked list of
distinct senses. It mixes real ones (月 Month/Moon) with plain synonyms
(大 Large/**Big**) and with metadata that isn't a meaning at all
(一 "One Radical (no.1)"). Strict grading would have marked "big" wrong for 大.
Default flipped to lenient; junk glosses filtered out entirely.

> **The lesson, which generalises:** verify a pedagogical rule against the real
> data before shipping it. The design was coherent and wrong, and only the data
> showed it.

**Step 3 — phone access, and the Tailscale collision.** Alexander already uses
`./run.sh phone` on the Polaris project to publish to his tailnet. Auditing
that revealed a live collision risk: Polaris uses plain
`tailscale serve --https=443`, claiming `/` on this machine's *single* tailnet
identity (`polaris.tail467397.ts.net`). A naive copy into kanji-trainer would
overwrite Polaris's mapping on start, and Polaris's exit trap would kill
kanji-trainer's. Solvable (own HTTPS port, port-scoped teardown), but it
prompted the step back.

**Step 4 — stepping back to the full option space (V-003).** Rather than
optimise the Tailscale approach, we asked the question that actually picks the
architecture: *whose data is on whose machine?* Four options emerged — Tailscale
(A), Cloudflare Tunnel + Access (B), static PWA (C), hosted multi-tenant with
quir3-style invite auth (D).

**Step 5 — why C, and why now.** Two reasons, and the second is Alexander's:

1. **C is the only option that removes the awake-laptop dependency without
   taking on hosting, accounts, or anyone else's data.** It also makes the
   brother's install *simpler* — a URL instead of installing Python — which
   dissolves the Windows-deployability constraint that has shaped this entire
   project.
2. **Cross-development experience.** quir3 is already a Type-D project: hosted,
   multi-tenant, Supabase, invite-gated auth, RLS, rate limiting. Building D
   here would rehearse a muscle already trained. C is a genuinely different
   discipline — local-first, offline-capable, storage-constrained,
   no-server — and the intuitions it builds do not overlap. Choosing the
   architecture that teaches something new, when both are viable, is a good
   reason.

---

## 3. What Option C actually is

Port the app to a **static, offline-capable PWA**: all logic client-side, all
storage in IndexedDB, hosted as static files (GitHub Pages or equivalent).
Always available, no host machine, no accounts, costs nothing, data never
leaves the device.

### 3.1 What `server.py` currently does that must be replaced

The frontend is already ~90% of the app. The server does five jobs:

| Job | Endpoints | Port difficulty |
|---|---|---|
| Serve static files | `/`, `/static/*`, `/data/*` | trivial — static hosting |
| Derive collections | `/api/collections` | trivial — pure function of `kanji.json` + `top_n` |
| Persist + read state | `/api/state`, `/api/settings`, `/api/export`, `/api/import` | easy — IndexedDB |
| SRS scheduling | `/api/answer`, `/api/queue`, `/api/batch/start`, `/api/srs/start` | **medium — the algorithm must match exactly** |
| Stats aggregation | `/api/stats` | **medium — ~100 lines of SQL to rewrite** |

### 3.2 Storage model

Three SQLite tables → three IndexedDB object stores:

- `settings` — key/value. Small. Could be a single record.
- `srs` — composite key `[kanji, facet]`. Currently ~2 rows per studied kanji,
  plus sense cards. Bounded by ~3,122 × 4 ≈ 12k rows worst case.
- `reviews` — autoincrement, needs indexes on `day` and `kanji`. Grows without
  bound; a daily user over years might reach 10⁵ rows.

**Simplest viable approach:** load everything into memory on boot and compute
stats in JS, writing through to IndexedDB. At ~100 bytes/review, 100k reviews is
~10 MB — acceptable. If it ever isn't, roll up `reviews` older than ~120 days
into a daily-aggregate store (the stats only need per-day counts beyond the
heatmap window anyway).

### 3.3 The two things most likely to go wrong

**A. Duplicate SRS implementations drifting apart.** If `server.py` stays alive
alongside the PWA, the SM-2 scheduler exists twice — once in Python, once in
JS — and any divergence silently corrupts progress for anyone using both. We
already have a smaller instance of this hazard (`JUNK_GLOSS`, duplicated in
`server.py` and `app.js`, with a comment demanding they stay in sync). The SRS
core is a far worse candidate for duplication.

> **Decision required before writing code:** is the PWA an *additional* build
> that must stay behaviourally identical to `server.py`, or the *successor*,
> with `server.py` eventually retired? Recommended: build the PWA as the
> successor, but keep `server.py` untouched and shipping until the PWA has
> proven itself. Do not try to keep two schedulers in lockstep indefinitely.

**B. iOS storage eviction — a genuine data-loss risk.** Safari's tracking
prevention has historically cleared script-writable storage (IndexedDB
included) for ordinary websites after a period of no interaction, with
home-screen–installed web apps treated more favourably. Exact current behaviour
is version-dependent and **must be verified on a real iPhone before anyone
relies on it**, not taken from this document. Mitigations to design in from the
start regardless:

- request `navigator.storage.persist()` and surface the result honestly
- make "Add to Home Screen" a first-class onboarding step, not a footnote
- keep the existing JSON export prominent and prompt for periodic backups
- never present the PWA as the sole copy of someone's progress until this is
  measured

### 3.4 The migration path already exists

`/api/export` and `/api/import` produce and consume a versioned JSON document
(`version: 1`) containing settings, all `srs` rows, and all `reviews`. That is
already the bridge: export from the Python app, import into the PWA. **Do not
break this format.** It is the only thing standing between a user and losing
their history when they switch, and it is also how desktop↔phone sync works
manually until something better exists.

### 3.5 Suggested sequence

1. Spike only: port the SRS scheduler and `get_stats` to JS, and verify against
   the Python implementation by replaying a real exported review history through
   both and diffing the resulting card states. **Cheapest possible answer to
   "does this port cleanly?"** — do this before committing to the rest.
2. IndexedDB storage layer behind the same shape as the current `api()` helper,
   so `app.js` route code barely changes.
3. Service worker + manifest; offline; add-to-home-screen flow.
4. Import/export parity test both directions.
5. Measure iOS persistence on a real device.
6. Only then decide what happens to `server.py`.

---

## 4. Invariants that must survive Option C

From `VISION.md` and the project's founding constraints:

- **No LLM generation in the app. No drawing/handwriting input modes.** Hard
  product rules from the owner.
- **No pip packages / no build step** was a *proxy* for "must be trivially
  runnable by a non-technical Windows user." Option C satisfies that goal by a
  different route (a URL), so a JS build step is no longer automatically
  disqualifying — but every added dependency should still be justified.
- **The user's data stays the user's.** No telemetry, no accounts, nothing
  leaving the device. This is in the README as a selling point and is the main
  reason Option D was not chosen.
- **`data/spoken.local.json`** — the user's own read-aloud overrides. Preserved
  by `update.py`, gitignored. Whatever the PWA does about it, user edits must
  not be silently discarded.
- **Export format `version: 1`** — see 3.4.
- **Batch mastery counts only `meaning`/`reading` facets**, never sense cards,
  or mastery drops when a user earns a second meaning.
- **XP is derived, never stored.**

---

## 5. Ideas raised and not yet built

Carried from `VISION.md` and this session. None are commitments.

- **Curated sense file** mirroring `spoken.json` — group synonyms (大 Large =
  Big), rank genuinely distinct senses. This is the prerequisite for turning
  strict primary-meaning grading back on by default.
- **Per-kanji example vocabulary** — would make the on/kun split concrete and
  show *why* readings change in compounds. Strong companion to V-001's D4.
- **Compound-reading drill** — given 日本, is 日 read にち, じつ, or ひ?
- **Visually-similar distractors** (士/土, 未/末) instead of frequency-neighbour ones.
- **Radical/component quiz mode.**
- Double-XP combo for perfect runs; weekly quests; charm rarities.
- **Mobile CSS gap (concrete, known):** `.form-grid` is a fixed `200px 220px`
  grid, so the Goals form and the Settings page overflow a phone screen. Must be
  fixed for any phone-facing work. The rest of the layout already collapses
  correctly at 760px and the viewport meta is present.
- **Sync between devices** — out of scope for C's first cut; JSON export/import
  covers it manually. If ever built, it is the point at which Option D's
  questions (accounts, whose server) come back.

---

## 6. Open questions for the owner

1. **Push to GitHub?** `main` is 5 commits ahead and unpushed. The archives are
   all on this one machine — pushing is the only genuinely off-machine backup.
2. **PWA as successor or as second build?** See 3.3.A. Affects everything.
3. **Does the brother move to the PWA, or stay on the Python app?** If he moves,
   the Windows/`run.bat` constraint stops driving design decisions.
4. **Where does the PWA get hosted?** GitHub Pages is free and already where the
   repo lives; it makes the app public (fine — no secrets, data stays local).
5. The machine's tailnet name is `polaris`, so a Tailscale URL for this app
   would read `https://polaris.tail467397.ts.net:8443/`. Only matters if A or B
   is ever revisited.

---

## 7. How to work on this project

- **Test loop.** Run `python3 server.py 7791` in the background, curl the API,
  then drive the UI over CDP: chromium at
  `~/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-x64/chrome-headless-shell`
  with `--remote-debugging-port=9222`, plus Node's native `WebSocket`. Write
  `.mjs` driver files to a scratchpad — heredocs mangle `${}` inside template
  literals. Screenshot and actually look at the images.
- **Before every commit:** kill the test server and delete `data/trainer.db*`.
  The repo must ship with no progress DB, and the first-run tour only fires when
  `total_reviews == 0 && in_rotation == 0`, so a stale local DB hides it.
- **`kanji-trainer-revisit-prompt.txt`** in the repo root is Alexander's own
  working file. Leave it untracked.
- **`VISION.md` is append-only.** Revisions go *underneath* the original entry
  (see D3 vs "D3 revised"), never replacing it. The trail of thinking is the
  point.
