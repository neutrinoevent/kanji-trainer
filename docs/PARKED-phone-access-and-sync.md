# PARKED — phone access, hosting, and durable sync

**Status: deferred, not being worked on.** Parked 2026-07-27 by the owner:
other things get fixed first before expansion of this size. Nothing here is
started; no code exists for any of it.

This is the single consolidated home for the whole expansion track. The
original entries (`VISION.md` V-002, V-003, V-004) remain in place for the
reasoning trail, but **this file is the one to read when picking the thread back
up** — it is self-contained.

---

## 1. What started this

The app runs on a desktop as a local Python server. The owner wanted to use it
on a phone (web, not a native iOS app), over wifi or cellular, and eventually
for his brother to do the same. That opened a much larger question than it
first appeared to.

## 2. The question that decides the architecture

**Whose data is on whose machine?**

1. *"My own progress on my own phone."* → a transport problem. No accounts needed.
2. *"My brother's progress on his phone."* → still no accounts — he runs his own
   copy with his own data. Two independent single-user installs.
3. *"People I invite sign up, their data lives on a server I run."* → a hosted
   product. Auth is the smallest part of it.

Only case 3 needs a login portal. Answer this first; everything else follows.

## 3. The four options

| | Approach | Auth | Always-on | Keeps stdlib-only | Cost |
|---|---|---|---|---|---|
| **A** | Tailscale Serve | none — the network is the boundary | ✗ host must be awake | ✓ | free |
| **B** | Cloudflare Tunnel + Access | none written by us; Access does email OTP | ✗ host must be awake | ✓ | free tier |
| **C** | Static PWA (IndexedDB) | none | ✓ | drops the server | free |
| **D** | Hosted multi-tenant | full portal + invites | ✓ | ✗ | hosting + ongoing work |

**A — Tailscale.** Strongest privacy story: nothing leaves the machine, nothing
on the internet, no credentials to leak.

> **Live hazard if A is ever revisited.** The Polaris project on this machine
> uses plain `tailscale serve --https=443`, claiming `/` on this machine's
> *single* tailnet identity (`polaris.tail467397.ts.net`). A naive copy into
> kanji-trainer would overwrite Polaris's mapping on start, and Polaris's exit
> trap (`tailscale serve --https=443 off`) would kill kanji-trainer's. They
> would silently fight over one slot.
>
> Requirements: give kanji-trainer its **own HTTPS port** (`--https=8443`),
> tear down **scoped to that port only**, never `tailscale serve reset`. Use
> `serve`, never `funnel` — this app has no authentication whatsoever. And do
> **not** change the `127.0.0.1` bind in `server.py`; Tailscale proxies to it,
> and switching to `0.0.0.0` would expose the app on whatever wifi you're on.

**B — Cloudflare Tunnel + Access.** Same shape as A, but a real public hostname
with Cloudflare Access doing email one-time-codes against an allow-list. Worth
naming because *the most secure login portal is the one you don't write*. An
"invite" becomes adding an email to a list.

**C — Static PWA.** The app is already ~90% client-side; `server.py` only does
SQLite persistence, the SM-2 scheduler, and stats aggregation — all pure logic
that runs fine in a browser. Port storage to IndexedDB and it becomes a static
site: always available, no host machine, offline-capable, installs to the home
screen, free. For the brother it is a *simplification* — a URL instead of
installing Python — which dissolves the Windows-deployability constraint that
has shaped this whole project.

**D — Hosted multi-tenant.** The quir3 pattern transplanted. Only for case 3.

## 4. Why C was chosen (before parking)

1. It is the only option that removes the awake-laptop dependency without taking
   on hosting, accounts, or anyone else's data.
2. **Cross-development experience** (the owner's reason): quir3 is already a
   Type-D project — hosted, multi-tenant, Supabase, invite-gated auth, RLS, rate
   limiting. Building D here would rehearse a trained muscle. C is a genuinely
   different discipline — local-first, offline, storage-constrained, no
   server — and the intuitions do not overlap. Choosing the architecture that
   teaches something new, when both are viable, is a good reason.

## 5. The durability problem — which C cannot ship without

Browser storage is **not durable**. Safari has historically cleared
script-writable storage (IndexedDB included) after periods of non-interaction;
the rules change between OS versions. The user with the most to lose is
precisely the one who has been away a fortnight.

Mitigations — `navigator.storage.persist()`, install-to-home-screen — reduce the
*probability* of a wipe. **They do not bound the damage, and must never be
described as a fix.**

> **The design rule:** the browser copy is a **cache**. It may be destroyed at
> any moment, and that must cost the user nothing but a re-sync. Any design
> where the browser holds the only copy is wrong regardless of how unlikely the
> wipe is.

**This must be verified on a real iPhone before anyone relies on it.** Current
iOS behaviour is past the assistant's knowledge cutoff and was never measured.

## 6. The durability answer: document-level sync

Prior art already built and running, by the same owner:
`~/PycharmProjects/quir3-vocab-dev/supabase/migrations/20260722223000_vocab_cloud_profiles.sql`

```sql
CREATE TABLE public.vocab_profiles (
  user_id UUID PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
  state JSONB NOT NULL CHECK (pg_column_size(state) <= 2500000),
  state_version SMALLINT NOT NULL CHECK (state_version BETWEEN 1 AND 100),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  ...
);
-- RLS: select/insert/update/delete restricted to user_id = auth.uid(); anon revoked
```

**The key consequence.** Because the cloud stores *one opaque document per
user*, the local schema needs no `user_id` anywhere. `srs`, `reviews` and
`settings` stay exactly as they are. Sync is **document-level, not row-level**,
so the multi-tenancy refactor originally feared (adding `user_id` to every
table, key and query, with cross-user leak risk) **does not arise at all**.
This makes a synced option far cheaper than first assessed.

### Proposed shape

- IndexedDB is the working copy — fast, offline, disposable.
- The cloud holds the durable record: one JSON document in the existing
  `version: 1` export shape.
- Writes hit IndexedDB immediately, queue for the cloud, drain on reconnect.
- On open: pull, compare `revision`, reconcile.

### Two honest modes

| Mode | Account | What the UI may promise |
|---|---|---|
| Local only | none | "Progress lives in this browser. The OS can clear it. Export regularly." |
| Synced | invite-gated sign-in | "Saved to your account. Losing this device costs nothing." |

Local-only must stay available — it preserves the project's original promise.
It just may never *claim* durability it doesn't have.

### Conflicts are mostly free

`reviews` is an append-only event log: union by `(ts, kanji, facet)` and
histories merge cleanly. `revision` gives compare-and-swap. Only `srs` card
state and the settings blobs genuinely conflict — prefer more `reps` / later
`due` for cards; last-write-wins with a visible notice is acceptable for
one-user-two-devices.

## 7. Auth, if it is ever needed (quir3 pattern, read 2026-07-27)

From `~/PycharmProjects/quir3-vocab-dev`. Portable to stdlib Python — the table
and the atomic claim work identically in SQLite; `hashlib.scrypt` for hashing,
`secrets` for codes and sessions, `hmac.compare_digest`, `http.cookies` for
`HttpOnly; Secure; SameSite` sessions. No pip packages needed.

- `invite_codes`: `code UNIQUE`, `used`, `used_by`, `used_at`, `revoked`,
  `created_by`; partial index on live codes; RLS admin-only.
- Public signup **disabled at the auth-service level** — the only path to an
  account is a server action that validates an invite first; the browser never
  calls `signUp`.
- Invite claimed **atomically** by conditional update
  (`WHERE code=? AND used=false AND revoked=false RETURNING id`); zero rows
  means another signup won the race, and the just-created user is deleted to
  roll back.
- Per-IP rate limits (login 5/15min, register 5/15min, invite check 10/15min),
  Redis-backed with in-memory fallback that degrades to per-instance limits
  rather than blocking sign-ins.
- Password policy (≥10 chars, letter + digit); credentials POST-only so they
  never appear in a URL; safe internal redirects.

## 8. Undecided when parked

- **Encrypted sync-code vs. invite-gated accounts.** Sync-code: no accounts,
  server sees only ciphertext, but a lost code means permanently lost data.
  Accounts: email-recoverable, server can read the blob, matches quir3. The
  privacy story favours the first; a non-technical brother losing a
  30-character code favours the second. **Recoverability is the entire point of
  the exercise**, which leans toward accounts.
- **Is the PWA the successor to `server.py`, or a second build kept in
  lockstep?** This must be settled before code. Keeping two SM-2 implementations
  (Python and JS) in sync indefinitely is a standing corruption risk — a worse
  version of the `JUNK_GLOSS` duplication hazard that already exists.
  Recommendation on record: build the PWA as the *successor*, but leave
  `server.py` untouched and shipping until the PWA has proven itself.
- **Hosting target** for the static build (GitHub Pages is free and the repo
  already lives there; makes the app public, which is fine — no secrets, data
  stays local).
- **Does the brother move to the PWA?** If yes, the Windows/`run.bat`
  constraint stops driving design.

## 9. If work resumes, the cheapest first move

**Spike only:** port the SM-2 scheduler and `get_stats` to JS, then replay a
real exported review history through both the Python and JS implementations and
diff the resulting card states. That answers "does this port cleanly?" for a
fraction of the cost of committing to the rewrite — and it is the same work
whichever sync model is chosen.

## 10. Constraints any of this must respect

- No LLM generation in the app. No drawing/handwriting input modes.
- The user's data stays the user's: no telemetry, no PII beyond what an account
  strictly requires.
- Export format `version: 1` must keep working — it is the migration path, the
  desktop↔phone bridge, and the user-owned third copy.
- Never serve a login portal over plain HTTP.
- `data/spoken.local.json` (user's own read-aloud overrides) must not be
  silently discarded by any new deployment model.
