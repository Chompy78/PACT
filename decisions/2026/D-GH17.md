# D-GH17 — REV-07: invite codes from `gen_random_bytes`, code length/rate-limiting deferred

Status: Active

- **Context:** `gen_invite_code()` built each of 6 characters via `floor(random()*36)` — Postgres's
  plain PRNG, not cryptographically secure. Invite codes gate `join_campaign`/`join_as_dm` and function as
  shared secrets, so a predictable generator is a soft spot even though the review rated it MEDIUM (a
  successful guess only lets an attacker create their own character in someone else's campaign; RLS still
  scopes all other data). The review's fix suggested three independent moves: (1) switch to a CSPRNG, (2)
  consider lengthening codes to 8 chars, (3) consider rate-limiting `join_campaign`.
- **Options:** (i) all three in one change; (ii) CSPRNG only, leave length/rate-limiting as follow-ups.
- **Decision:** (ii). `gen_invite_code()` now pulls 6 bytes from `gen_random_bytes()` (pgcrypto, already
  enabled) and reduces each mod 36 onto the existing alphabet — same 6-char length, same
  `^[A-Z0-9]{6}$` check regex, only the entropy source changes.
- **Why:** the review's own acceptance criteria for REV-07 only requires the CSPRNG swap (codes stay
  unique, still match the check regex, sourced from `gen_random_bytes`) — length and rate-limiting were
  phrased as "consider" / optional hardening, not required. Lengthening ripples into the `check` constraint
  and any UI that assumes 6 chars; rate-limiting needs a new attempt-tracking table or edge-function config.
  Both are real, separable follow-ups better scoped and reviewed on their own rather than folded into a
  MEDIUM entropy fix. mod-36 over the raw byte has a small bias toward earlier alphabet characters (256
  isn't a multiple of 36) — judged negligible for a 6-char invite code; rejection sampling was not worth
  the added complexity here.
- **Status:** DONE for the CSPRNG swap. Code length and `join_campaign` rate-limiting remain open,
  lower-priority hardening — not re-filed as a new roadmap item since the original REV-07 entry already
  covers them if picked up later.

---
