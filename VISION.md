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

**D3 — The primary-meaning card names the primary sense every time.** Typing a
*real but non-primary* meaning on a `meaning` card produces feedback that says
what happened: "「Sun」 is a meaning of 日, but this card tests its most common
sense: Day. You'll meet 「Sun」 later." Whether that also counts as *wrong* is
the `strict_primary` toggle.

> **D3 revised, same day — default flipped to off.** The original decision had
> strict grading on by default, on the reasoning that rung 2 isn't real unless
> it's enforced. Checking the actual gloss lists before shipping killed that.
> KANJIDIC2's meanings are not a ranked list of distinct senses; they mix:
>
> - genuinely different senses — 月 Month/Moon, 日 Day/Sun/Japan
> - near-synonyms — 大 Large/**Big**, 中 In/**Inside**/Middle, 出 Exit/**Leave**/Go Out
> - metadata that isn't a meaning at all — 一 "One Radical (no.1)", 年 "Counter For Years"
>
> Strict grading would mark "big" wrong for 大. That teaches nothing except to
> distrust the app, and it is exactly the beginner range where it bites hardest
> (61% of Grade 1 kanji have a second gloss). Enforcement isn't worth false
> negatives on answers that are plainly correct. The nudge alone still teaches
> the ranking — the learner is told the primary sense on every such answer —
> and `strict_primary` is there for anyone who wants the harder bar.
>
> Turning strictness back on as the default is reasonable *once* there is
> curated sense data. See the backlog.

**D3b — Non-sense glosses are filtered out entirely.** The metadata category
above is junk in every context, not just under strict grading: unfiltered, the
sense ladder would unlock "One Radical (no.1)" as the second *meaning* of 一,
and quiz distractors would offer "Counter For Occurrences" as a plausible
answer. A shared regex (`JUNK_GLOSS`, duplicated in `server.py` and `app.js` —
they must stay in sync, since the server decides how many senses can unlock)
drops glosses matching radical names, counter notes, and `(no. N)` markers.
That's 121 of 10,248 glosses, and it cleans up 一, 二, 八, 年 in the first
batches.

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
  corpus, and as D3-revised found, the list isn't even a list of *distinct*
  senses. A curated sense file mirroring `spoken.json` — grouping synonyms and
  ranking real senses — is now the clear next step rather than a maybe, since
  it is the thing that would let strict grading default back on.

---

## V-002 — Phone access over Tailscale (raised 2026-07-27) — PROPOSED, NOT BUILT

### The idea

Mirror the `./run.sh phone` pattern already used by the Polaris project on this
machine: publish the local server onto the owner's tailnet over real HTTPS, so an
iPhone reaches it from any wifi or cellular connection with no port forwarding
and nothing exposed to the public internet. Then extend the same capability to
Alexander's brother — Tailscale on his Windows PC and his iPhone, reaching *his*
kanji-trainer and his own progress.

### Findings from the audit (not yet acted on)

**The collision risk is real and currently live.** Polaris uses plain
`tailscale serve --bg --https=443 http://127.0.0.1:$PORT` — no `tsnet`, no
separate node. That means it claims `/` on **port 443 of this machine's single
tailnet identity**, which is `polaris.tail467397.ts.net`. At the time of writing,
`tailscale serve status` shows that slot occupied and pointing at port 3111.

So a naive copy of the Polaris approach into kanji-trainer would:

- overwrite Polaris's mapping when kanji-trainer starts, and
- tear down kanji-trainer's mapping when Polaris exits (its trap runs
  `tailscale serve --https=443 off`), and vice versa.

The two apps would silently fight over one slot. Avoiding that is a design
requirement, not a nicety:

- Give kanji-trainer its **own HTTPS port** (`--https=8443` →
  `https://polaris.tail467397.ts.net:8443/`), never 443.
- Tear down **scoped to that port only** (`tailscale serve --https=8443 off`).
  Never `tailscale serve reset`, which would nuke Polaris's config too.
- App ports already don't collide (Polaris 3000/3111, kanji-trainer 7777).

**Serve, never Funnel.** `tailscale funnel` publishes to the whole internet.
This app has no authentication of any kind — anyone who can reach it can read
and modify progress — so Funnel must never be used. Polaris's script makes the
same call and documents it; match that.

**Do not change the bind address.** `server.py` binds `127.0.0.1`, and Tailscale
Serve proxies to it. That is exactly right: the app stays invisible to the local
wifi LAN and Tailscale is the only route in. Switching to `0.0.0.0` to "make it
reachable" would be a real regression.

**Mobile layout is mostly already there** — `index.html` has a proper viewport
meta, and `app.css` collapses the sidebar to a scrolling top bar at 760px and
stacks answer choices to one column. One known gap: `.form-grid` is a fixed
`200px 220px` grid, so the Goals form and the Settings page overflow a phone
screen. That needs a breakpoint before phone access is pleasant.

**The brother's case is separate and clean.** He would run Tailscale on his own
account, his own Windows PC, his own iPhone — his tailnet, not Alexander's. No
sharing, no cross-account access, no exposure of anyone's machine to anyone
else. The catch is the project's founding constraint: he is a non-technical
Windows user and the whole app is "double-click `run.bat`". `tailscale serve` on
Windows is a CLI call. A `phone.bat` would need to detect Tailscale, explain
signing in, handle the not-installed case, and fail gracefully back to plain
local use rather than leaving him stuck.

**Standing caveat.** Phone access only works while the host machine is awake and
running the server. This is a remote-control-your-laptop feature, not a hosted
service — worth stating plainly in the UI or the README so nobody expects
otherwise.

### Open questions

1. The machine's tailnet name is `polaris`, so kanji-trainer's URL would read
   `https://polaris.tail467397.ts.net:8443/`. Renaming the node would change
   Polaris's URL. Live with the odd name, or rename?
2. Is phone access an Alexander-only convenience, or a documented feature for
   the brother too? The second needs the `phone.bat` work and the mobile CSS fix;
   the first needs neither.

---

## V-003 — Phone access: the full option space (raised 2026-07-27) — ANALYSIS ONLY

V-002 assumed Tailscale. This entry steps back: what are *all* the ways to get
kanji-trainer onto a phone browser, including a hosted login portal with invite
codes in the style of quir3?

### The question that picks the architecture

Everything downstream depends on one answer: **whose data is on whose machine?**

1. *"I want my own progress on my own phone."* → a transport problem. No accounts.
2. *"My brother wants his progress on his phone."* → still no accounts — he runs
   his own copy with his own data. Two independent single-user installs.
3. *"People I invite sign up, and their progress lives somewhere I run."* → now
   it is a hosted multi-tenant product, and auth is the smallest part of it.

Only case 3 needs a login portal. Cases 1 and 2 are solved by transport, and
adding accounts to them buys nothing while adding a credential store to defend.

### The options

| # | Approach | Auth needed | Always-on | Keeps stdlib-only | Cost |
|---|---|---|---|---|---|
| A | Tailscale Serve (V-002) | none — the network is the boundary | no, host must be awake | yes | free |
| B | Cloudflare Tunnel + Cloudflare Access | none written by us; Access does email-OTP at the edge | no, host must be awake | yes | free tier |
| C | Static PWA — port storage to IndexedDB | none (per-device data) | **yes** | drops the server entirely | free |
| D | Hosted multi-tenant + quir3-style auth | full portal, invite codes | yes | **no** | hosting + real ongoing work |

**A — Tailscale.** See V-002. Strongest privacy story: nothing leaves the
machine, nothing is on the internet, no credentials exist to leak.

**B — Cloudflare Tunnel + Access.** Same shape as A but with a real public
hostname, and Cloudflare Access in front doing email one-time-codes against an
allow-list. Worth naming explicitly because *the most secure login portal is the
one you don't write*. An invite becomes "I add your email to the allow-list."

**C — Static PWA.** The most interesting option and the least obvious. This app
is already ~90% client-side: `app.js` is 2,000 lines of UI and quiz logic, and
`server.py` only does SQLite persistence, the SM-2 scheduler, and stats
aggregation — all of it pure logic that runs fine in a browser. Port storage to
IndexedDB and the whole thing becomes a static site on GitHub Pages: always
available, no host machine, works offline via a service worker, installs to the
home screen, costs nothing, and the data still never leaves the user's device.
The brother's install becomes a URL instead of a Python runtime — which is
*easier* than what he does today, not harder. Cost: desktop and phone become
separate stores, so cross-device sync becomes manual (the existing JSON
export/import already covers it) until someone builds sync.

**D — Hosted multi-tenant.** The quir3 pattern, transplanted. Only worth it for
case 3 above.

### What was read from quir3 (`~/PycharmProjects/quir3-vocab-dev`, 2026-07-22)

The invite mechanism there is careful and the design is portable:

- `invite_codes` table: `code UNIQUE`, `used`, `used_by`, `used_at`, `revoked`,
  `created_by`; partial index on unused/unrevoked codes; RLS restricting all
  access to admins.
- Public sign-up is **disabled at the auth-service level**. The only path to an
  account is a server action that validates an invite first — the browser never
  calls `signUp` directly.
- The invite is claimed **atomically** by a conditional update
  (`UPDATE … WHERE code=? AND used=false AND revoked=false RETURNING id`); zero
  rows means another signup won the race, and the just-created user is deleted
  to roll back. Race-safe by construction rather than by locking.
- Per-IP rate limits on login (5/15min), register (5/15min) and invite checks
  (10/15min), Redis-backed with in-memory fallback that degrades to
  per-instance limits rather than blocking sign-ins.
- Password policy (≥10 chars, letter + digit), credentials POST-only via server
  actions so they never appear in a URL, safe internal redirects.

**All of that ports to stdlib Python.** The table and the atomic conditional
claim work identically in SQLite; `hashlib.scrypt`/`pbkdf2_hmac` for password
hashing, `secrets` for codes and session tokens, `hmac.compare_digest` for
constant-time comparison, `http.cookies` for `HttpOnly; Secure; SameSite=Lax`
sessions. No pip packages required. The auth is genuinely the easy part.

### The real cost of option D is not auth — it is multi-tenancy

The current schema has **no user column anywhere**: `settings(key PK)`,
`srs(kanji, facet PK)`, `reviews(id, …)`. It is single-tenant by construction.
Going hosted means adding `user_id` to every table, to the primary keys, and to
all ~20 SQL statements in `server.py`, plus export/import, plus every stats
aggregate. That refactor is larger and riskier than the login portal, and it is
the part that would quietly leak one user's progress into another's if it were
done carelessly.

Two more hard requirements if D ever happens:

- **Never serve a login portal over plain HTTP.** `http.server` can do TLS via
  `ssl`, but certificate management makes a reverse proxy (Cloudflare, Caddy)
  the sane answer.
- **Always-on hosting contradicts the project's founding pitch** — "everything
  runs on your own machine, no accounts, no internet needed." That is currently
  in the README as a selling point. D does not modify the app; it forks it into
  a second product with a different promise. Worth deciding deliberately rather
  than drifting into.

### Recommendation

Case 1 today: **A or B**, an afternoon each. Case 2 for the brother: **C**, and
it makes his life simpler than the current Python install. Case 3: **D**, as a
deliberate separate product, and only when there is a reason for other people's
data to live on Alexander's server.

Nothing here is decided. C is the option most worth a serious look, because it
is the only one that removes the awake-laptop dependency without taking on
hosting, accounts, or anyone else's data.

---

## Backlog — ideas raised but not yet scheduled

Carried over from earlier sessions and this audit. Not commitments.

- Double-XP combo for perfect runs; weekly quests; charm rarities.
- Per-kanji example vocabulary (would make the on/kun split concrete — a strong
  companion to V-001's D4, since it shows *why* the reading changes).
- Visually-similar distractors (士/土, 未/末) instead of frequency-neighbour ones.
- Radical/component quiz mode.
- **Curated sense file**, mirroring `spoken.json` — group synonyms (大 Large =
  Big) and rank genuinely distinct senses. Promoted from "if it proves annoying"
  to a known need by D3-revised; it is the prerequisite for strict grading.
- Compound-reading drill: given 日本, is 日 read にち, じつ, or ひ?

## Open questions for the owner

1. `strict_primary` now defaults **off** (see D3 revised). The nudge still names
   the primary sense on every secondary answer, so the ranking is taught either
   way. Worth revisiting once curated sense data exists.
2. Should a goal's deadline ever *change the scheduler* (push more cards to hit
   the date), or only report pace? Currently it only reports — the SRS stays
   pedagogically honest and the user adjusts `new_per_day` themselves.
3. How far should `spoken.json` curation extend? Currently the frequent range;
   the tail falls back to the heuristic.

---

## Change log

- **2026-07-27** — V-001 raised and implemented. D3 revised the same day
  (strict grading default flipped off) after checking the real gloss data;
  D3b added to filter non-sense glosses. Merged to `main`; pre-merge `main`
  preserved as branch `v1.0-main-snapshot`. Baseline preserved as git tag
  `v1.0-baseline` and as a standalone copy at
  `../kanji-trainer-ARCHIVE-v1.0-20260727/`. Work done on branch
  `fluency-and-senses`.
