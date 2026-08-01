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

> **V-002, V-003 and V-004 are PARKED** (2026-07-27, owner's call: other things
> get fixed first). They are consolidated into a single self-contained document,
> `docs/PARKED-phone-access-and-sync.md` — read that when picking the thread
> back up. The entries below stay for the reasoning trail.

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

> **Revised 2026-07-27 (same day), see V-004.** This section is right about
> *row-level* multi-tenancy and wrong to treat it as unavoidable. If the cloud
> stores **one opaque document per user** rather than shared tables, no
> `user_id` is needed on `srs`, `reviews` or `settings` at all — the local app
> stays single-tenant by construction and the server holds a blob it never
> interprets. That is what quir3 already does for vocabulary profiles
> (`vocab_profiles`: one JSONB `state` per `user_id`, with `revision` and
> `state_version`). The refactor described below is therefore **not** required,
> which makes a synced option far cheaper than this entry claims.


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

## V-004 — Durability: the browser must never be the only copy (raised 2026-07-27)

### The problem, stated plainly

A user should be able to study on desktop and on their phone, over wifi or
cellular, and **never lose their history to a storage wipe they didn't ask
for**. Browser storage is not durable: Safari has historically cleared
script-writable storage (IndexedDB included) for sites after periods of
non-interaction, the exact rules change between OS versions, and a user who has
been away for a fortnight is precisely the user with the most to lose.

Mitigations exist — `navigator.storage.persist()`, installing to the home
screen — and they help. **They are not a fix and must never be described as
one.** They reduce the probability of a wipe; they do not bound the damage.

> **The design rule this yields:** the copy in the browser is a *cache*. It may
> be destroyed at any moment without warning, and destroying it must cost the
> user nothing but a re-sync. Any design where the browser holds the only copy
> is wrong regardless of how unlikely the wipe is.

### What this does to Option C

It does not kill it. A local-first PWA is still the right client. It adds a
requirement: **a durable record somewhere the browser cannot evict.**

### Prior art, already built and running: quir3 `vocab_profiles`

`~/PycharmProjects/quir3-vocab-dev/supabase/migrations/20260722223000_vocab_cloud_profiles.sql`
(2026-07-22) solves the identical problem for that project:

- one row per user: `user_id PRIMARY KEY`, `state JSONB`, `state_version`, `revision BIGINT`
- a size cap enforced in a CHECK constraint (`pg_column_size(state) <= 2.5 MB`)
- RLS restricting select/insert/update/delete to `user_id = auth.uid()`
- `anon` revoked entirely

That is the shape to copy. It is proven, it is Alexander's own, and reusing it
keeps two of his projects architecturally consistent.

**The important consequence** (and the correction to V-003): because the cloud
stores *one opaque document per user*, the local schema needs no `user_id`
anywhere. `srs`, `reviews` and `settings` stay exactly as they are. The
multi-tenancy refactor V-003 treated as the main cost of going hosted simply
does not arise. Sync is document-level, not row-level.

### Proposed architecture

**Local-first PWA + revisioned cloud document.**

- IndexedDB is the working copy — fast, offline, disposable.
- The cloud holds the durable record: one JSON document, the same shape as the
  existing `version: 1` export.
- Writes go to IndexedDB immediately and are queued for the cloud; the queue
  drains on reconnect. Offline use is unaffected.
- On open: pull, compare `revision`, reconcile, carry on.

**Two honest modes, chosen by the user:**

| Mode | Account | Durability promise the UI may make |
|---|---|---|
| Local only | none | "Progress lives in this browser. The OS can clear it. Export regularly." |
| Synced | invite-gated sign-in | "Progress is saved to your account. Losing this device costs nothing." |

Local-only must remain available — it preserves the project's original promise
(no accounts, nothing leaves your machine) for anyone who wants it. It just may
never *claim* durability it doesn't have.

**Auth** is the quir3 pattern, already analysed in V-003: `invite_codes` with
atomic conditional claim, public signup disabled at the auth-service level,
per-IP rate limits, password policy, POST-only credentials.

### Conflict handling

Two devices editing the same document need a rule. In rough order of preference:

1. **`revision` guard (compare-and-swap).** Write only if the server's
   `revision` still matches what was pulled; on mismatch, pull and merge.
   This is what the quir3 schema's `revision BIGINT` is for.
2. **Merge is mostly free**, because `reviews` is an append-only event log —
   union by `(ts, kanji, facet)` and the histories combine cleanly.
3. **The genuinely conflicting parts are small**: `srs` card state and the
   `settings` blobs (`path`, `goals`). For `srs`, prefer the row with more
   `reps` / later `due`. For settings, last-write-wins with a visible notice
   is acceptable for a single-user-two-devices scenario.

**Known wrinkle to fix regardless:** `settings.path` and `settings.goals` are
currently read-modify-write of a whole object held in client memory
(`pathMark()`, `saveGoals()`). With two devices live, last-write-wins can lose a
path star. Single-client today, so latent — but sync makes it reachable.

### Non-negotiables for whatever gets built

- **Never present browser storage as durable.** Say where the data lives, in
  plain words, on first run.
- **Keep JSON export prominent and working.** It is the user-owned third copy
  and the migration path off this app entirely. Format stays `version: 1`.
- **A wipe must be a non-event**: reopen, sign in, pull. Nothing lost.
- **If sync is encrypted client-side**, be explicit that a lost key means
  unrecoverable data, and think hard about whether that is acceptable for a
  non-technical user before choosing it over recoverable accounts.

### Open question

Encrypted sync-code (no accounts, server sees only ciphertext, lost code =
lost data) versus invite-gated accounts (recoverable via email, server can read
the blob, matches quir3)? The privacy story favours the first; a non-technical
brother losing a 30-character code favours the second. Not yet decided.

---

## V-005 — Scoped review: study what you're actually studying (raised 2026-07-27)

### The problem, found in testing

A learner working through jōyō Grade 1 batch 1 hit **Review** and was quizzed on
kanji from well outside that batch. Review was all-or-nothing: `/api/queue`
returned every due card in the rotation, with no way to narrow it. Anything ever
started — a few path steps, a batch opened out of curiosity — came back forever,
diluting the set the learner had actually chosen.

Reproduced before fixing: with Grade 1 batch 1 started plus eight unrelated
kanji, the review queue served cards from outside the batch, and the proportion
grows as more due cards accumulate.

### Design decisions

**D1 — A scope is a collection plus an optional inclusive batch range.**
Not a list of characters: the URL stays short and the server remains the
authority on what a batch contains. A *range* rather than a single index is what
lets a goal ("the first three batches of Grade 1") be reviewed as one scope.
`null` means everything, which stays the default and is one click away.

**D2 — Daily budgets stay global.** `new_per_day` and `sense_per_day` limit the
learner's pace, not the scope. A scoped session draws its new cards from within
the scope but does not get a fresh allowance per set — otherwise picking a
narrow scope would be a way to bypass the pacing that makes the SRS work.

**D3 — Review and Drill are different things, and both are needed.**
*Review* follows the schedule and moves cards along. *Drill* practises a set
whenever you like, regardless of what's due, and never touches the schedule
(logged with `srs: false`, exactly as games are). Drill is most useful precisely
when nothing is due — which is when plain review has nothing to offer and a
learner who wants to practise is told to go away.

**D4 — Only show batches that are at least half in rotation.** Sets overlap by
design: 日 is in Frequency, Grade 1 and N5 simultaneously. Listing every
collection containing a started kanji produced 11 collections and 21 batch rows
for someone who had started two batches. A batch appears only once it is ≥50% in
rotation, which cleanly separates "I worked through this" from "overlap brushed
against it", and the collection list is capped at five with an explicit
"show more" for the rest.

**D5 — The headline number is what you owe now.** An early version showed
`due + not-yet-started`, promising a 116-card session when the daily budget
would deliver far fewer. The big number is now the due count; not-yet-started
cards are mentioned separately, and the button still works when only new cards
are available.

### What shipped

- `scope_chars()` and a scope-aware `build_queue()`; `/api/queue` accepts
  `collection`, `from`, `to`.
- A **Review hub** at `#/review` — everything first, then by set, then by goal.
  The old behaviour is `#/review/all`.
- Scoped sessions at `#/review/c/<cid>[/<from>-<to>]`, drills at `#/drill/...`.
- Entry points on the batch detail page, each collection on Batches, every goal
  card, and the hub. The last scope used is remembered in `review_scope`.
- Session header names the scope and marks drills "schedule untouched".

Verified: scoped sessions leak zero out-of-scope kanji; a drill answer leaves
`due` and `reps` byte-identical.

### Also fixed in passing

- `.form-grid` collapses to one column under 560px — the Goals form and Settings
  page no longer overflow a phone screen (`KNOWN-ISSUES` #2).
- A goal's "Study" button now opens the first batch not yet fully in rotation
  rather than always batch 1 (`KNOWN-ISSUES` #5).

---

## V-006 — Fluency by demonstration; feedback you can't miss (raised 2026-07-27)

### What the learner reported

After extensive drilling of jōyō batch 1: the program "essentially told him
*good enough!*" and pointed at the exit after relatively minimal review. Also,
pressing Enter mid-review sometimes showed no visible feedback, and it wasn't
clear whether an answer was right, wrong, or why.

### The Enter bug — root cause

Not intermittent, and not a double-registration. `finishAnswer()` called
`$("#next-btn").focus()` **during** the Enter keydown that submitted the answer.
Focus moved to the Continue button, and the browser's own default action for
Enter then activated it — advancing past the feedback on the *same keypress*.
It fired on **every** Enter on a typed card. It looked intermittent only because
multiple-choice cards are answered with number keys and never hit that path, and
typed questions appear mainly on cards the scheduler considers mature — exactly
what someone drilling one batch heavily would be seeing.

Proven by isolation: answering with a mouse click kept the feedback; neutralising
`HTMLElement.prototype.focus` kept the feedback; restoring it lost the feedback
again, with `nextCard()` called once per single Enter.

Fixed three ways, because auto-repeat and impatient double-presses would have
caused the same symptom independently: never focus the button during a key
event, ignore `e.repeat`, and swallow presses that arrive before Continue is
armed.

### D1 — Fluency is demonstrated, not waited out

The old bar was the scheduling interval: operative at 7 days, solid at 21. That
measures how long the scheduler has left a card alone, not what the learner can
do. Someone could clear a card by picking the right option out of four, three
times, and be told they knew it.

Fluency is now computed from the review log:

| Tier | Requires |
|---|---|
| operative | ≥2 distinct question types on target, ≥1 **produced from memory**, ≥4 on-target answers, on ≥2 distinct days, ≥70% accuracy |
| solid | **every** question type the facet has, ≥2 produced, ≥8 on target, ≥4 days, ≥80% accuracy |

Producing an answer is weighted above recognising it, because typing it from
memory and picking it out of four are not the same act. The distinct-days
requirement is *diversity of encounter*, not a waiting period: it stops one
intense session certifying a kanji that won't survive to tomorrow. Everything
else is pure evidence — no clock.

Verified: six correct multiple-choice answers in one day leaves a card at
*learning*. Adding the reverse question: still learning. Adding a typed answer:
still learning, because it's all one day. Spread the same evidence over two
days: operative.

**Knock-on effects, all deliberate.** "Learned" on the dashboard now means both
rungs demonstrated rather than "the scheduler graduated it"; jōyō coverage and
batch mastery use the same evidence; sense unlocking is gated on demonstrated
fluency with the more frequent sense rather than on an interval. The numbers got
smaller and honest.

### D2 — Correct and on-target are different things

Typing a real but secondary meaning is still accepted (marking "big" wrong for
大 would be a false negative — see D3 revised in V-001). But it no longer counts
toward demonstrating the primary sense. A new `on_target` column on `reviews`
carries the distinction; existing rows are backfilled from `correct` so no
history is lost. This is what the learner asked for: producing the second-most
frequent meaning shouldn't certify fluency with the first.

### D3 — A miss asks for the answer back

Feedback is now a full-width coloured banner with ✓/◐/✗, what you answered, and
what the card wanted. Getting it wrong — or answering off-target — no longer
offers a Continue button. It asks you to produce the right answer: retype it for
typed questions, tap the highlighted option for multiple choice. Retrieval, not
nodding at a correction, and it makes drilling-at-speed impossible to do
mindlessly. Clean hits still move on in 400ms, so flow is preserved.

### D4 — A session is a lap, not a finish line

The end screen led with "Excellent session!" and a Dashboard button. It now
reports what the scope has actually demonstrated (operative / solid bars), names
what's still missing in plain words — "seeing them again on another day, and
typing them rather than picking from four, is what moves them" — and offers
three *varied* next steps drawn at random from drills, games and the path.
Dashboard is still there, last.

The kanji detail modal shows the same thing per card: evidence so far, and the
specific gaps remaining. The bar should be legible, not mysterious.

---

## V-007 — The batch percentage that wouldn't move (raised 2026-07-27)

### The report

The learner said their jōyō batch-1 percentage didn't seem to move despite a lot
of work the previous night. They were not misremembering. Reproduced exactly:
**200 correct answers across four question types, plus 100 drill answers, and the
number sat at 35.0% the entire time.**

### Two causes, one of them older than this session's work

**1. `strength()` was a step function.** Batch mastery took one flat value per
tier, so nothing between tier boundaries showed up at all.

This predates the fluency rewrite. At tag `v1.1-fluency-ladder` the old code was:

```python
if row["state"] == "learning":
    return 0.25          # flat, no matter how much work
```

and a card cannot reach `review` state the same night anyway, because learning
step 2 sets a **one-day** interval. So under the old code an evening of study
pinned the batch at 25% and left it there. The rewrite in V-006 changed the
number (0.35) but kept the same flat shape — it did not fix the bug and did not
cause it.

**2. Drill answers counted for nothing.** `demonstration_map()` filtered on
`srs=1`, on the reasoning that drills are practice rather than assessment. But a
drill asks the same questions in the same formats and requires the same
retrieval; refusing to count it made a long practice session look like nothing
had happened, which is precisely the complaint.

### The fix

**Continuous progress within a tier.** `demo_progress()` and `solid_progress()`
return how far a card is toward the next bar — the mean of its capped component
ratios (question types, productions from memory, on-target answers, distinct
days). `strength()` interpolates: `0.75 × progress` below operative,
`0.75 + 0.25 × progress` above it. Verified monotonic and bounded 0..1.

The same night's work now reads 0 → 23.4% → 46.9% → 60.9% → 65.6%, and 95.3%
after one round on a second day. The plateau at ~66% is meaningful rather than
broken: every component except *distinct days* is maxed, so the number is saying
"the only thing left is to come back tomorrow".

**Drills count as evidence, games do not.** `demonstration_map()` now selects by
question type (`QUIZ_MODES`) rather than by whether the answer moved the
schedule. Drills use the real quiz modes and count; games use their own mode
names (`horde`, `snap`, `match-meaning`) and stay out of the fluency bar, since
they are a different kind of practice. Verified both directions.

**The tiers themselves stay binary and unchanged.** After a full night the rungs
still read `meaning: 0, reading: 0` — the bar has not moved, and should not have.
What changed is that the learner can now see the distance they covered toward it.

### The principle worth keeping

A progress number that cannot move during a session teaches the learner that
effort is invisible. The bar can stay strict — it should — but the *distance to
the bar* has to be legible while it is being closed. Strictness and visible
progress are not in tension; conflating them was the mistake.

---

## V-008 — Games follow the set you're studying (raised 2026-07-27)

### The report

After a jōyō batch-1 session the learner accepted the app's own invitation to
try a game, reasonably expecting it to cover batch 1, and was immediately shown
plenty of kanji from outside it.

### Two causes, and one of them was self-inflicted

**1. `activePool()` was global — with a silent fallback.**

```js
const pool = S.kanji.filter((r) => kanjiStarted(r.k));
return pool.length >= 8 ? pool : S.kanji.slice(0, 50);   // <- silently substitutes
```

Every game drew from every started kanji, and if the learner had started fewer
than eight, it quietly substituted the top fifty by frequency — characters they
had never seen. A silent widening like that is worse than an empty game: the
learner cannot tell it happened, and concludes the app is confused about what
they're studying.

**2. The invitation itself was unscoped.** The "Keep going, differently"
suggestions added in V-006 linked to `#/games/odd`, `#/games/match` and
`#/games/horde` with no scope at all. The app finished a scoped session and then
handed out global links — this session created the exact path the learner fell
down. Worth recording plainly: adding a feature (scoped review) without auditing
every route into the adjacent feature (games) left a seam right where a learner
would walk.

### Design decisions

**D1 — Scope rides in the hash, as it does for review.**
`#/games/<id>/c/<cid>/<from>-<to>`, or `/all`. Quit, Done and Play-again all
keep the set. Same `parseScope`/`scopeSuffix` vocabulary as review, so the two
features stay one idea rather than two.

**D2 — A bare `#/games/<id>` inherits the set you were last studying.** That is
what "try a game" immediately after a batch session obviously means, and it is
what fixes the reported path even for links that carry no scope.

**D3 — No silent widening, ever.** `gamePool()` has no fallback. When a set is
too thin for a game, the game says so, names the number it needs, and offers
three real choices — play with everything, choose another set, or add more
kanji. The hub also dims and annotates a game *before* it's clicked.

**D4 — Some games honestly need a wide net, and should say so rather than
pretend.** Odd One Out has to find three kanji sharing an on-reading; a
twenty-five kanji batch almost never contains such a trio. It declines a narrow
scope with the reason, rather than quietly reaching outside the set — which is
what the old code did.

**D5 — The general modes are retained unchanged.** This was explicit in the
request. Unscoped Survival still marches down the whole frequency list and
deliberately runs past what you know, because that is the game. Scoped, it
marches down that set instead, still in frequency order.

**D6 — Pick the set before the game, not after.** The hub leads with a chip row
of candidate sets — everything, each goal, each set in progress, and its started
batches — each showing how many kanji it would actually supply. The choice
persists, shared with the review hub via `review_scope`.

### Verified

Every one of the eight games, scoped to Grade 1 batch 1 with twenty unrelated
kanji also in rotation: **zero out-of-batch kanji shown**. Odd One Out declines
with its reason. All eight still play unscoped. A bare `#/games/lightning`
inherits "Grade 1 · Batch 1", and the end-of-session suggestions now carry the
scope they came from.

---

## V-009 — Typeface variety (raised 2026-07-28)

### The idea

A kanji met only ever in one typeface is half-learned. Print uses 明朝, signage
uses ゴシック, school material uses 教科書体, and the shapes differ enough to
stop a learner cold — 直, 心, 令 and 永 are drawn noticeably differently between
faces. Quiz prompts should rotate through whatever faces the machine has, on by
default, with a settings toggle to pin everything back to one font.

### The actual difficulty: CSS lies about fonts

The feature is trivial to *appear* to build and easy to get silently wrong.
`font-family` falls back without complaint: ask for a face that isn't installed
and the browser renders the default one. You get a program that claims variety,
shuffles font names, and shows the same glyph in the same typeface every time —
the learner is told they're being challenged and they aren't.

That is the same failure as the games' silent pool substitution in V-008, and it
gets the same answer: **don't trust, measure.**

**D1 — Faces are fingerprinted, not assumed.** Each candidate is measured on a
canvas (`width`, `actualBoundingBoxAscent/Descent/Left/Right` over a probe
string of shape-diverse kanji, 永国鬱曜線令直心) and kept only if its fingerprint
differs from a deliberately-absent font *and* from every face already in the
set. Detection being imperfect then stops mattering: what is guaranteed is that
no two entries in the list render identically.

**D2 — Width alone would not have worked.** CJK glyphs are full-width, so the
same string in Hiragino Sans, Hiragino Mincho and Hiragino Maru Gothic measures
`300.00 × 100.00` in all three. Verified. The classic width-comparison font
detection trick silently fails for Japanese; the bounding-box metrics are what
separate them.

**D3 — One representative per style, not per family.** The catalogue lists
candidates grouped into ゴシック体 / 明朝体 / 丸ゴシック体 / 教科書体 / UD体, each
with cross-platform alternatives (macOS Hiragino, Windows Yu / MS / BIZ UD /
UD Digi Kyokasho, Linux Noto / IPA / Takao). The first family that resolves in
each style wins. Twelve near-identical gothics would be variety on paper only.

**D4 — Vary the question, not the teaching.** Prompts rotate; the intro card,
the answer reveal, the kanji grids and the detail modal stay in the interface
font. When a learner is *being taught* the character, clarity wins; when they
are being *tested* on it, the unfamiliar face is the point. Verified both ways.

**D5 — One face per question, not per glyph.** On the reverse question and in
Odd One Out all four kanji choices share a face, so the learner is telling
kanji apart rather than telling typefaces apart. Match Pairs is the exception:
there each tile gets its own face, because matching a character across faces is
exactly the skill.

**D6 — Name the face in the feedback.** "shown in 明朝体 Mincho" after each
answer. The variety is then legible instead of mysterious, and the learner
picks up the names of the styles as a side effect.

**D7 — Say what was actually found.** Settings renders a live sample of every
detected face with its Japanese name, English name and real family name. If
fewer than two distinct faces exist, it says so plainly and notes that the
setting can't do anything — rather than pretending.

### Verified

On this machine three faces resolve (Hiragino Sans / Mincho ProN / Maru Gothic
ProN). Canvas pixel hashes of 令 in each: three distinct values. Twelve
consecutive prompts drew all three; with the toggle off, twelve consecutive
prompts drew only the interface font, and the setting persisted. All routes and
games unaffected.

A note on the testing: the first pixel-proof run reported all three faces
identical, which was the *test* being wrong — it passed `var(--jp)` inside a
canvas `font` string, which canvas cannot parse, so every measurement fell back
to the default. Worth recording because it is the exact failure the feature
guards against, reproduced accidentally in the harness.

---

## V-010 — The mastery exam (raised 2026-07-28)

### The idea

A capstone for a batch. Alexander's brother has finished jōyō Grade 1 batch 1
and wants something that crowns it — a comprehensive assessment hitting the
kanji from many angles at once: visual recognition, most common meaning,
pronunciation. "Formidable enough but not punishing", highly diverse, and
applicable to *any* batch rather than hand-built for one.

Crucially: he has **not** learned every secondary meaning, and the exam must not
require them.

### What makes it an exam rather than another review session

Review is study. It re-asks what you miss, tells you immediately, walks you
through a correction, and nudges the schedule. An exam is assessment, so it
inverts several of those on purpose:

**D1 — Feedback is deferred to the end.** No per-question verdict. Immediate
feedback would let a learner absorb the answer mid-test and then be scored on
it, which measures the test rather than the learner. Verified: 50 questions
driven end to end with zero per-question verdicts rendered.

**D2 — Nothing is re-asked, and there is no correction step.** Both are right
for study and wrong for measurement.

**D3 — It does not touch the review schedule.** A nervous run must not be able
to damage weeks of spacing — fear of that would stop anyone sitting it. Answers
still count as *evidence* (`on_target`, same as drills since V-007), because
they are real retrieval in real question types. The diagnosis comes from the
report, not from silently rescheduling.

> Alternative considered: bring missed items forward in the schedule. Rejected
> for now — it makes the exam something with a cost, and the report plus a
> one-tap drill of exactly the missed kanji is more actionable than an invisible
> schedule change.

### Diversity, and how it is enforced rather than hoped for

**D4 — Two required sections, one bonus.** *Recognition and meaning* and
*Reading aloud* each ask one question per kanji; *Further meanings* is bonus.

**D5 — Question types are spread, not sampled at random.** Within the meaning
section the modes cycle `mc-meaning` → `mc-kanji` → `type-meaning` across the
kanji and are then shuffled; the reading section alternates `mc-reading` and
`type-reading`. Random picking would leave a 25-question section that happened
to be all multiple choice. Every exam therefore contains recognition, reverse
recall, and unaided production.

**D6 — A section floor, so breadth is a pass condition.** 80% overall *and* at
least 70% in each required section. Without the floor a learner could pass on
meaning alone while unable to read any of them. Verified: 25/25 meaning with
15/25 reading is exactly 80% overall and is correctly refused.

**D7 — Length is bounded by the kanji, not multiplied by the modes.** One
question per kanji per axis, so a 25-kanji batch is 50 questions plus bonus —
about ten minutes. Asking every kanji in every mode would have been 100+, which
is punishing. Scopes larger than 30 kanji are sampled down and say so, which is
what makes the feature work for any batch, track or goal.

### Secondary meanings can only add

**D8 — Bonus questions appear only for kanji whose `sense2` card the learner has
actually been given**, and they lift the numerator without lifting the
denominator. Arithmetically, getting one wrong is identical to never having been
asked; getting it right can pull a borderline paper up. Verified: 78% + six
bonus all wrong stays 78%; 78% + six bonus all right becomes 90%; a perfect
paper plus bonus stays capped at 100%.

That is the direct answer to "he hasn't learned all the alternative meanings" —
they are reachable credit, never a hurdle.

### The report is the point

Per-section bars with the failing section coloured red, a per-question-type
breakdown (typed versus multiple choice is the useful split — it separates
"can't recall" from "can't recognise"), and every miss itemised with the kanji,
the question type, what the learner answered and what the answer was. Then one
prominent action: **drill the kanji you missed** — an ad-hoc in-memory set at
`#/drill/missed`, deliberately not a saved scope since it is a one-off list.

Results are kept as history per scope rather than overwritten: improving from
72% to 91% is worth seeing. Stored in `settings`, so export/import carries them.

**D9 — The marking is a pure function.** `scoreExam()` takes sections, answers
and the flat index and returns the verdict, with no DOM and no persistence. The
thresholds are the part most likely to be quietly wrong, so they are checked
directly rather than through a browser.

### Flavour

A stamp on the result: 優 Distinction / 合格 Passed / 未だ Not yet. Three new
badges — 初試験 First Certification, 満点 Full Marks, 十冠 Ten Crowns. Entry
points on the batch detail page, each batch row in the review hub (with a ✓ once
passed), goal cards, and a new Exams tab.

---

## V-011 — The exam brief, and records built to be certified later (raised 2026-07-29)

### The brief

The exam opened straight onto its own mechanics. It now opens on a page that
explains what the exam is, primes the learner honestly, names the topic, and
says what passing will let them claim.

**D1 — The encouragement has to be true to be worth anything.** The line doing
the real work is *"Nothing in it is new. Every question asks something you have
already practised, in a form you have already seen."* That is a factual
statement about how the exam is built — it draws only on the scope's kanji and
only on question types the learner has already met in review — and it is far
more settling than any amount of "you can do it!". Empty encouragement is
already banned by this project's copy rules; accurate encouragement is not.

**D2 — Name the claim they'll earn.** *"Clear this and you'll be able to say, and
mean it: 'I can recognise every one of the 25 kanji in Grade 1 · Batch 1, give
the most common meaning of each, and read each one aloud.'"* Built from the live
scope and count, so it is specific rather than generic. Then, plainly: that's a
checkable claim, not a participation mark. A goal you can state in a sentence is
worth more than a percentage.

**D3 — Remove the stakes explicitly.** No timer, the review schedule is
untouched, retake freely, a miss costs a line in the report. Learners avoid
assessments they think can hurt them, and this one genuinely can't — so say so
before they start rather than hoping they infer it.

**D4 — Say what happens if they fail, before they begin.** The report names the
kanji and the question type, and offers to drill exactly those. Knowing the
failure path is gentle is part of being willing to try.

### Records built to be certified later

Shareable certificates are coming. Whatever they end up looking like, they will
need to certify exams sat *before* that system existed, so every attempt is now
recorded with enough context to be judged retroactively.

**D5 — Store the resolved kanji, not just the scope name.** `c/g1/0` resolves to
different characters if `batch_size` changes. A record naming only the scope
could not later prove *what* was examined. Each record carries the actual
character string.

**D6 — Store the rubric in force.** Thresholds may change between versions. A
certificate should be able to say which bar was cleared, so `thresholds` and a
`rubric` tag (`exam-v1`) travel with the record rather than being assumed from
whatever the code says at certification time.

**D7 — Three copies, deliberately different in kind.** `settings.exams` holds a
compact summary for the UI; an append-only `exam_log` table holds the sealed
records; `data/exam-log.jsonl` holds the same records as plain text outside the
database entirely. The file survives a corrupt or deleted `trainer.db` and can be
read by anything. It is in the updater's PRESERVE set and gitignored.

**D8 — Chain the records.** Each carries a SHA-256 digest of its own contents
and the digest of its predecessor, so editing, deleting or reordering history is
detectable. Verification *walks the chain* by `prev` rather than trusting stored
order, which is what makes it meaningful across an import from another machine
where the sequence numbers were different.

> **Bug found while testing this, in my own chain.** `last_exam_digest()`
> originally ordered by `ts DESC, id DESC`. Several attempts can land in the same
> second, and the id's hash suffix does not sort chronologically — so two
> records ended up claiming the same predecessor and the chain forked
> immediately. Fixed with an autoincrementing `seq` as the authoritative local
> order. Timestamps are not an ordering.

**D9 — Be honest about what "confirmable" can mean here.** This is a local app
with no secret. The chain detects corruption and casual tampering, and gives a
future signing service something meaningful to attest — verified: forging a 0.72
into a pass directly in the database is caught immediately, and the plain-text
copy still holds the truth. But it is **not** proof against a determined user
editing their own files, and it must never be presented as such. Real
verifiability needs an authority to sign, which is a hosting decision — see
`docs/PARKED-phone-access-and-sync.md`. Building the chain now costs almost
nothing and means the history will be worth signing when there is something to
sign it with.

---

## V-012 — Lists: kanji the user groups themselves (raised 2026-07-29)

### The idea

Custom sets, creatable and manageable by the user, addable from anywhere in the
flow — mid-review a learner may want to file a particular kanji away — with
optional templates during creation that must not push themselves on anyone.

### D1 — Called "lists", not "collections"

`collection` already means the built-in tracks throughout this codebase:
`COLLECTIONS`, the `collection=` API parameter, `colById`, `collection_chars()`.
Overloading it would have made every scope-resolving function ambiguous about
which kind of thing it held. "Lists" is unused, unambiguous, and reads naturally
in the place it matters most — *add 日 to a list*.

### D2 — A list is just another scope

This is the decision that made the feature small instead of large. Review, drill,
the eight games and the mastery exam already accept a scope. Teaching
`parseScope` / `scopeSuffix` / `scopeChars` / `scopeLabel` a fourth form
(`l/<id>`), and teaching the server's `scope_chars()` to resolve a list id, made
every one of those work on a list without any of them knowing lists exist.

Verified: review, drill, exam, match and lightning all scoped to a six-kanji list
show zero kanji from outside it, and the list appears as an option in the review
hub, the games hub and the exam picker.

### D3 — A list is a grouping and nothing more

Adding a kanji to a list does not start it in the rotation. Deleting a list does
not delete anything else. This is the property that makes lists safe to
experiment with, and it was worth proving rather than assuming: create, add,
remove, wholesale replace, rename and **delete** were run in sequence, and every
SRS row came back byte-identical with the review count unchanged. The delete
confirmation says so in as many words.

### D4 — Templates are opt-in and quiet

A dropdown defaulting to **Start empty**, sitting as one control among several
rather than a wizard step you have to clear. Nothing suggests using one. They
exist because "the twenty I keep missing" is tedious to assemble by hand — not
because a list ought to come from a template. The set: start empty, most-missed
kanji, in rotation but not yet operative, copy a set or batch, copy another list.
The extra control a template needs (which set? which list?) appears only when
that template is chosen, and a live preview shows what you'd get before you
commit.

### D5 — Adding works wherever a kanji is on screen

A `＋ List` control on the review/drill feedback panel, on the first-meeting intro
card, in the kanji detail modal (which is itself reached from the batch grid, the
stats most-missed list, the exam miss report and a list's own members), and on
every cell of the batch grid. One popover, one binding helper, no per-screen
special cases.

**The subtlety worth recording:** the popover contains a text input for naming a
new list, and it can be opened mid-card. Typing a name and pressing Enter would
otherwise have advanced the review card underneath — the same class of bug as
V-006's focus-during-keydown. The popover sets `S.pickerOpen`, the quiz's Enter
handlers stand down while it is true, the input stops propagation, and navigating
away closes it. Verified: with the picker open mid-review, Enter does not advance
the card.

### Not done yet

- No list ordering or nesting; lists sit in creation order.
- No sharing or export of a list on its own — the whole-progress JSON export
  carries them, which is enough for moving between machines.
- No auto-lists (e.g. a live "everything I missed this week"). A list is a
  deliberate act right now, which is easier to reason about.

---

## V-013 — Data that survives the app (raised 2026-07-30)

### The ask

Persistence that doesn't vanish with a cache clear, and doesn't get clobbered by
dramatic app development or a `git pull`.

### What was actually at risk

Browser storage was never the exposure — `localStorage` only ever held a theme
and a tour flag, both mirrored in server settings. The real risks were:

1. **A hand-maintained preserve list.** User files lived in `data/` beside
   shipped files, protected by a `PRESERVE` set in `update.py`. That list had
   already been forgotten twice as new user files appeared (`spoken.local.json`,
   then `exam-log.jsonl`). A rule you must remember is a rule that will be
   forgotten.
2. **One copy, inside the app folder.** Delete it, re-clone the repo somewhere
   else, or reinstall, and everything is gone. No snapshots, no history — the
   updater made a single `.bak` and that was all.

### D1 — A boundary, not a list

Everything the user owns now lives under `userdata/`, and nothing else does.
`userdata/` is gitignored, so it is not in the repo, so it is not in the download,
so an update **cannot** reach it — by construction rather than by remembering.
New user-data files are safe by default. Legacy installs are migrated on first
run: files are *moved*, never copied, and never over an existing target.

### D2 — Snapshots, thinned over time

Timestamped gzipped snapshots in `userdata/snapshots/`, in the existing export
format with a header — so anything that can read a backup can read a snapshot,
and restoring runs the import path that has been exercised since v1. Taken at
startup and every fifteen minutes while running, but only when the state
fingerprint has actually changed and at most hourly. Retention keeps the recent
eight, then one a day for a month, then one a month.

### D3 — One copy outside the app entirely

The newest snapshot is mirrored into the OS user-data folder
(`%APPDATA%`, `~/Library/Application Support`, `$XDG_DATA_HOME`). This is the
layer that survives deleting the app folder, re-cloning it, or reinstalling.
Best-effort: a read-only or missing home directory must never stop the app.

### D4 — Recovery is offered, never automatic

On startup, if the store is empty *and* a snapshot holds real work, the dashboard
offers to restore it, naming the date, the number of answers and where the copy
was found. It is an offer because someone who has just deliberately reset their
progress must not have it silently resurrected.

### D5 — Restoring is itself undoable

Restore and import both take a snapshot of the current state first. There is no
action in this feature that cannot be walked back.

> **A dangerous bug, found by testing the disaster rather than reasoning about
> it.** The first working version wiped `userdata/`, restarted, and restored —
> and came back with zero reviews. The startup snapshot had run on the *empty*
> store, written a snapshot containing nothing, and mirrored it. The mirror keeps
> a fixed number of copies, so an empty install writing snapshots would steadily
> evict the very backups that could rescue it. Now: an empty state is never
> snapshotted and never mirrored, and pruning always keeps the newest snapshot
> that actually holds work. Re-tested end to end — destroy `userdata/`, restart,
> accept the offer, all 37 answers came back.

### Deliberately not done

- **No cloud anything.** That is the parked hosting question, not this.
- **No automatic restore.** See D4.
- **No merge on restore** — it replaces. Merging two machines' histories needs
  answers to real conflict questions and is in `docs/IDEAS.md`.

---

## V-014 — Four things a long-running learner would have hit (raised 2026-07-30)

Grouped because they share a cause: features shipped over several sessions, each
correct on its own, that together left gaps only visible to someone who had been
studying for a while.

**The numbers-moved notice.** Anyone updating across V-006 watches their learned
count and coverage drop, which looks exactly like lost work. The dashboard now
shows both figures side by side — what the old rule said, what the new one says —
with the reason, once, dismissed permanently. It appears only when the learner's
own numbers actually moved, so a new user never sees it. Telling someone
"nothing was lost" is worth less than showing them the arithmetic.

**The Path, scoped.** It always walked the top of the frequency list regardless
of what the learner had chosen — the third instance of the class fixed for review
(V-005) and games (V-008), and the last surface carrying it.

> The care needed: path node ids double as the settings keys holding star
> progress, so they could not change for the path people are already walking. The
> original frequency path keeps its bare `u0-learn` keys; every other scope gets
> a namespace. Each path keeps separate progress and switching never appears to
> lose stars. Verified against a database with existing path progress.

Scope is remembered rather than inherited from `review_scope`, because path
progress is stateful and silently switching sets would read as loss.

**The tour, refreshed.** It introduced seven screens and never mentioned Lists,
Exams or Games — three of ten nav items, two of them the newest features. A new
learner was walked through a program that no longer matched what was in front of
them. A tour is a thing that rots silently; worth re-reading whenever a nav item
is added.

**Leeches.** `srs.lapses` had been recorded since v1 and read by nothing. A card
the learner keeps failing simply returned forever — and demonstration-based
fluency made that *worse*, because such a card can never reach operative, so it
also permanently suppressed batch mastery, goal progress and coverage with no
explanation of why a number was stuck. Invisible, and demoralising in a way that
only surfaces after weeks.

They are now named on the dashboard, by lapses or by a poor enough record over
enough attempts, with three ways out:

- **Park it** — out of the queue *and* out of the mastery denominator. Someone
  who deliberately set a kanji aside is not failing at it, and a permanently
  suppressed figure is noise. The parked count is shown alongside, so the smaller
  denominator is visible rather than silently assumed.
- **Start it over** — re-introduced from scratch, but lapses are kept: forgetting
  that it had been a problem would lose the signal that flagged it.
- **Write a note** — per-kanji, surfaced on the intro card and after every answer.
  A mnemonic is usually what actually breaks a leech, and having to leave the app
  to write one elsewhere is how it doesn't get written.

---

## V-015 — Curated senses, honest strictness, and eight files instead of one (raised 2026-07-30)

### The sense data

KANJIDIC2's gloss list was never a list of senses. It mixes genuinely different
meanings (月 = Month, Moon) with plain synonyms (大 = Large, **Big**) and with
wordings nobody would type (対 = "Vis-a-vis"). Two problems followed, and one
file fixes both.

`data/senses.json` groups the wordings of each sense with the one to teach first,
across the beginner range — the top 150 by frequency plus all of Grade 1, which
is 149 multi-sense kanji, all covered. **114 collapse to a single sense**, which
stops the ladder spending a card teaching "Big" as the second meaning of 大;
**35 keep genuinely distinct senses** and unlock properly.

### D1 — Strictness follows the data, not a global switch

`strict_primary` was off because marking "big" wrong for 大 is a false negative
that teaches a learner to distrust the app rather than to distinguish senses.
With groupings, every reasonable wording of a sense is fully correct, so being
strict about *which sense* is fair — and it now defaults on.

But only where the data supports it. Strictness applies to kanji with curated
groupings and stays forgiving elsewhere, because without groupings the app
genuinely cannot tell a different sense from the same one worded differently.
It tightens by itself as curation extends, and asks the user for no decision.

> **A gap worth recording.** The first pass curated only kanji that needed
> *fixing*, leaving out ones whose glosses were already correct — including 日,
> the most frequent kanji in the language. But the strictness gate keys off
> *curation*, so those were graded leniently. Curating "what's wrong" and gating
> on "what's curated" are not the same set, and the mismatch was invisible until
> tested. Both are in now.

### D2 — Eight files, still no build step

`static/app.js` had reached 4,300 lines. "No build step" is a hard constraint of
this project; a *single file* is not. It is now eight plain `<script>` tags in
dependency order — `core`, `shell`, `lists`, `session`, `games`, `progress`,
`pages`, `boot` — with no bundler and no module system, and
`static/js/README.md` explaining the two rules that keep that working.

Not cosmetic: several patches in recent sessions failed to apply against a file
that size, and each failure was a chance to half-write a change. Verified after
the split by loading every route, every game, a review session, an exam and the
detail modal, with no load-order or runtime errors.

---

## V-016 — Harder questions, real words, and telling people when to sit the exam (raised 2026-07-31)

Three features, one theme: the app knew things it wasn't saying.

### Distractors a learner would actually confuse

Multiple choice drew wrong options from the frequency neighbourhood. Plausible,
but not difficult — nothing about 待 against 会 tests whether you can read 待.
Mistaking similar-looking characters is the dominant failure in real reading, and
it was the one thing never asked about.

**D1 — Curated, not computed.** The dataset has no radical or component
decomposition, and stroke count is a poor proxy: 一 and 乙 share a count and look
nothing alike. `data/similar.json` holds 84 groups over 200 kanji, covering both
near-identical shapes (土/士, 未/末) and a shared dominant element (待/持/特,
晴/清/静).

**D2 — Mix, don't replace.** Look-alikes are offered first, the frequency
neighbourhood fills the rest, and look-alikes are capped at one fewer than the
number of options. That cap matters more than it looks: if every wrong option
were a look-alike, the answer would stand out as the odd one, and the question
would test shape-spotting rather than reading. Verified — 100 reverse questions
for 待 all included one of 持/時/特, and no round in 200 was entirely look-alikes.

Because it lives in the shared picker, review, drill, games and the exam all got
it at once.

### Example words

The reading cards teach one standalone reading. Right for a beginner, but it
leaves them unable to say why 日 is ひ alone and に in 日本 — the first thing that
confuses anyone reading real Japanese.

`data/vocab.json`: 316 words across 145 kanji, 107 of which show both an on and a
kun reading. Each word records how the *target* kanji is read inside it, so 日
appears as 日**本** (に), 三**日** (か), 毎**日** (に), tagged 音/訓, with the kanji
picked out inside the word. 今日 きょう and 大人 おとな are marked irregular rather
than forced into a category they don't belong to.

**D3 — Contrast first.** If a kanji is read differently across its examples, the
list leads with words that differ. Three words all using the same reading
demonstrate nothing about why readings change, which is the entire point.

**D4 — Shown, never tested.** Nothing new to memorise. This explains something
the app was silent about; it isn't more material.

**D5 — Curated over generated.** A handful of well-chosen words teaches the
contrast; dozens from a dictionary dump would bury it. 31 KB against a repo that
has to stay small enough to hand someone as a zip.

### Exam readiness

The exam existed and nothing pointed at it. A learner had to think of it
themselves — which mostly meant not sitting it, or sitting it far too early and
reading a bad score as a verdict on themselves rather than on the timing.

**D6 — The bar sits below the pass mark.** Ready at 70% of the set demonstrated
on both rungs, against a pass mark of 80%. An exam you're certain to pass teaches
nothing; the signal says "this is worth your time now", not "you will pass".

**D7 — Silence below 40%.** A set at 0% demonstrated is not "nearly ready", and
saying so is exactly the hollow encouragement this project bans elsewhere. It
also devalues the real signal.

> Caught in testing: the first version had `soon` spanning 0–70%, so a batch with
> **nothing** demonstrated displayed "Nearly exam-ready". Plainly false, and it
> would have taught learners to ignore the badge entirely.

Surfaced on the batch detail page (a card), the Batches grid and review hub (a
chip), and the exam picker — which now ranks sets by readiness, so the one worth
examining is the one you see first. After a pass, the language changes to
retaking rather than sitting.

---

## V-017 — Compound readings, and practice exams that adapt (raised 2026-08-01)

### The compound reading drill

Reading cards teach the standalone reading — what you'd say seeing a bare 日 on a
sign. A deliberate simplification, and this is where it gets paid back: given
三日, is 日 read にち, か or ひ? A learner who can only produce the isolated
reading cannot read a newspaper, and nothing asked.

**D1 — The dataset needed one field.** `vocab.json` knew each word's full reading
and whether the kanji took an on or kun reading, but not *which slice* belonged
to the kanji: 日本 にほん says nothing about 日 alone. Slices are now derived by
matching the kanji's known readings at the word's start or end, accounting for
rendaku and gemination. That settled 309 of 313 automatically; four were filled
by hand. Sixteen spot checks pass, including 学校 (がっ) and 上手 (じょう/ず).
113 kanji have two or more distinct readings across their examples.

**D2 — Distractors are the kanji's own other readings.** The interesting error is
confusing にち with ひ, not with something unrelated.

**D3 — The answer is the prompt, not the lesson.** After answering, the same
character is shown read differently in its other words. That's the teaching.

**D4 — Not added to `GAME_MODE_IDS`.** That list drives the "Jack of All Trades"
badge; adding a ninth game would un-earn a badge people already hold. A badge is
theirs once earned. New games get their own — 熟語読み.

### Practice exams

The mastery exam means something: a pass mark, a permanent record, the same shape
every time. Anything sharing those properties would dilute it. So practice is
built to be a rehearsal, deliberately different in three ways.

**D5 — Shorter.** ~28% of the real length, capped at 16 questions. Long enough to
diagnose, short enough to sit on a whim.

**D6 — Adaptive, where the real exam is uniform.** The real exam samples the set
evenly, because that is what makes it a fair assessment. Practice does the
opposite: it weights by leech status, lapses, accuracy, tier and whether the card
has ever been revisited on another day — then picks a *question type the card has
never been answered in*, preferring production over recognition. That last part
is the granular bit: the difference between "can pick it from four" and "can
produce it" is exactly what the demonstration map already knows.

**D7 — Diagnostic, not graded.** No pass mark at all. The result groups questions
by *why each was chosen* — keeps slipping / barely met / never asked this way /
you know this one — so the output is a list of what to work on rather than a
number. Every miss carries its reason.

**D8 — Weakness, but not only weakness.** A quarter of questions come from solid
cards. A paper made entirely of your worst cards is demoralising and can't show
improvement, because nothing in it was ever going to be right.

**D9 — Leeches are guaranteed a slot.** There are usually only a handful, so a
weighted draw can miss them — and a diagnostic paper that skips the cards
actively fighting the learner has failed at its one job.

> **Two bugs found in testing.** The eligibility check excluded cards at tier 0,
> which sounds right — nothing demonstrated, nothing to test — but tier is about
> *demonstrated evidence*, not about whether a card is in rotation. It silently
> excluded every leech. Eligibility now keys off SRS state. And "never asked this
> way" was being claimed for cards never asked *at all*, where every mode is
> trivially untested; that finding is now labelled "barely met yet", which is the
> real one.

### Where this goes

Practice results are logged as evidence (like drills) and never touch the
schedule, which leaves room for things worth building later:

- **Readiness informed by practice.** The signal currently reads demonstrated
  fluency alone. Practice performance is a second, sharper input.
- **Post-failure practice.** After a failed mastery exam, generate a practice
  paper from exactly what was missed.
- **Mock mode.** Full length, exam conditions, no adaptation — pure rehearsal for
  someone who wants to know how the real thing will feel.
- **Spaced practice.** A weekly paper that tracks whether the weak set is
  shrinking.

The selection function is a single pure `practiceWeight()` plus `practiceMode()`,
so any of those is a change to selection rather than to the machinery.

---

## Backlog — ideas raised but not yet scheduled

Carried over from earlier sessions and this audit. Not commitments.

- **Shareable, verifiable certificates** for passed exams. Records are already
  sealed and chained for exactly this (V-011); what's missing is an authority to
  sign them, which is a hosting decision.
- **A one-time "your numbers moved" notice** for users updating across the
  demonstration-based fluency change (`docs/KNOWN-ISSUES.md` #9).
- **Scope the Path** — the last unscoped surface (`docs/KNOWN-ISSUES.md` #8).
- **Exam variants**: timed mode; reading-only or meaning-only papers; a
  recertification exam sampling across every batch already passed.
- **Bring exam misses forward in the schedule** — considered and rejected in
  V-010 D3. Worth revisiting once we know whether the drill-the-missed button
  actually gets used.
- **Bundle a 教科書体 face?** The most pedagogically useful typeface and the least
  likely to be installed. Rejected for now on size: a Japanese font is 5–20 MB
  against a 500 KB repo.
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
