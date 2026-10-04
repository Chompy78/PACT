# D-GH-2026-10-04-dm-unlock-drawback — a DM can release a drawback they imposed locked

**Status:** code DONE on the branch; **the SQL migration is written and tested but NOT yet applied to production** —
applying it is a separate, owner-approved step (see *Deploy order*). `DATA.version` **not** bumped.

## Context

A DM can impose a drawback on a campaign character through `dm_edit_character_log` (`D-GH-2026-08-10-dm-edit-events`),
recorded at `cost:0` with two flags stamped on that immutable buy event: `dmLocked` (the player may not buy it off) and
`dmRemovalCost` (`flat` or `expensive` 3×). The owner's permanent-wounds design (2026-09-30) has wounds imposed
**locked** and bought off only after a **story beat**, with the DM unlocking when it happens (owner decision H1). Today
nothing can clear `dmLocked`: it is read in exactly one place (the Live Sheet's buy-off) and the event is append-only.

## Options

- **A. Key the unlock by drawback name.** Rejected: a character can hold a player-taken and an imposed purchase of the
  same name, and the engine's buy-off match is by name (FIFO). A name-keyed unlock releases the wrong one.
- **B. Rewrite `dmLocked` on the original event.** Rejected: breaks the append-only log, and that event sits inside the
  locked-history prefix the database refuses to let change.
- **C. A DM-only removal of the drawback.** Rejected: DM edits are add-only by design; the player must still pay.
- **D. A new `dmUnlockDrawback` event, keyed to the imposed purchase's `seq`.** Chosen.
- **E. Enforce the lock server-side now.** Deferred to its own task — see *Known limit*.

## Decision

New event `{type:'dmUnlockDrawback', refVal:<name>, targetSeq:<seq>, note:<story beat>}`, appended through the existing
RPC (so the server stamps `seq/ts/dmEdit/dmId`). Four moving parts:

1. **SQL** (`sql/migrations/2026-10-04-dm-unlock-drawback.sql`, folded into `sql/rls-policies.sql`). The RPC accepts the
   new type and validates it against the **stored** log: exactly one `buy`/`drawback` event with that `seq` and name that
   is `dmEdit:true` **and** `dmLocked:true` (jsonb equality, not casts, so a hand-edited log cannot make it throw); not
   already unlocked; a trimmed note of 1–200 characters. The event is **rebuilt from a whitelist** — nothing else the
   client sent (`cost`, `amount`, `disc`, `payload`…) can ride along, so it moves no AP. `dmUnlockDrawback` also joins
   `pact_ap_ledger_protected`'s types, as `dmRemoveBoon` did.
2. **Engine** (`activeEvents().unlocked`, additive): the set of indices of imposed, locked purchases a later,
   DM-stamped unlock released. Keyed by `seq` — the one place the engine uses it; the FIFO buy-off match is untouched.
   Two imposed purchases sharing a `seq` and name are ambiguous and release **nothing** (fail-safe).
3. **Live Sheet:** `buyoffDrawback()` and the ledger row both consult it; an unlocked drawback shows 🔓 with the DM's
   note (escaped) and the buy-off button at the rate the DM chose.
4. **DM Console:** an Unlock control listing only imposed + locked + still-locked purchases, a required story-beat
   box, behind the same archived-campaign peek guard as every other DM write.

## Why

- **`seq`, not name.** The same-name pair is real, not hypothetical; the engine, the SQL and both UIs are tested on it.
- **Validated in the database, not trusted from the client.** The DM Console only offers valid targets, but the server
  re-checks against the stored log, so the control is a convenience, not the safeguard.
- **Not checked in SQL: "has the target been bought off?"** That is the engine's by-name FIFO match; re-implementing it in
  SQL would duplicate a rules decision in a second place (the AP-ledger SQL already documents an accepted approximation of
  it). It is also unreachable in honest use: a locked drawback cannot legitimately be bought off, so a locked, not-yet-
  unlocked purchase is still open. A forged buy-off plus an unlock yields a harmless no-op row. Both external reviewers
  asked for the SQL check; this reasoning is why it was not added.
- **Undo barrier for free.** Any `dmEdit` event is already a barrier, and `undoFloor` then covers the original imposed
  buy too (asserted).
- **Protected projection.** Adding the type means that once an AP award or session seal follows an unlock, the owner can no
  longer strip it out of the log (asserted against Postgres). Events after the last award/seal are not compared by
  `pact_enforce_locked_history` — the same limit `dmRemoveBoon` has.

## Known limit — stated plainly

**The lock and this unlock are advisory against a hostile character owner.** A character's owner can already write their
own `stats`, so they can forge any event in their own log, including an unlock or a buy-off. This change makes the DM's
unlock a validated, DM-stamped, audited record; it does not make the lock tamper-proof. The suite pins this with a named
`KNOWN LIMIT` assertion that must flip to a rejection when enforcement lands. Real enforcement needs an unforgeable
DM-authorship signal this schema lacks (a DM-only column/table or a database-held stamp), a whole-log diff trigger and a SQL
replay of the FIFO match — roughly 2–3× this change — and is tracked as `feat/server-enforced-drawback-lock`. The DM
Console tooltip says so.

## Process

Two external cold reviews (Gemini `gemini-3.6-flash`, Groq `openai/gpt-oss-120b`) plus a fresh no-history agent for the one
finding they disagreed on; outcomes are in `docs/plans/2026-09-30-dm-unlock-drawback.md` (*Review outcome*). Both reviewers'
self-ID was false; every finding was checked against the code or live data before use. One gap found in triage, not by
either reviewer: the Live Sheet's ledger row also rendered "🔒 locked" from the event flags and needed the same change.

## Verification

- **SQL, real Postgres 16** (`testing/sql/rls-baseline-test.sql`, run in a throwaway container and by CI's `sql-guards`): 77
  assertions, 0 failed, including refusals for a player-taken / already-unlocked / missing / wrong-name target, missing or
  non-integer `targetSeq`, empty or >200-char note, the same unlock twice in one call, an atomic mixed batch, the owner
  and a DM of another campaign as callers, an archived campaign; the happy path (server-stamped, trimmed note, no smuggled
  fields, **no AP movement**); the protected-history strip refusal; and the drift guard (baseline = migrations). The drift
  guard was run first with the migration unregistered and went red (`DIVERGED: dm_edit_character_log
  pact_ap_ledger_protected`), proving it would have caught a forgotten fold.
- **Baseline = production, hashed 2026-10-04** with the drift guard's own normalisation: `dm_edit_character_log`
  `f6476a61e4d504cfb50b14119420641c`, `pact_ap_ledger_protected` `60b099bb2e1b1b8e263ee3bc48bbd6c9`, live == pre-change
  baseline, so the migration starts from the real definitions (the 2026-09-02 mistake was building from a stale file).
- **Engine:** `dm-unlock-drawback-ci.mjs` 20/20 (seq matching, ambiguity, ordering, stamp, no AP/build effect, FIFO
  untouched, undo floor); parity fixture EV-024; `engine-parity-ci.mjs` 77/0.
- **Browser:** `live-sheet-unlock-e2e.mjs` 19/19, `dm-console-unlock-e2e.mjs` 16/16 (the peek-guard checks were shown to
  fail when the guard is removed); existing `dm-console-ui-e2e` 101/101, `tool-pricing-ci` 189/189,
  `protected-events-roundtrip-ci` 8/8. `cloud-e2e` needs a local Supabase stack and ran only in CI.
- Live data (dated snapshot, 2026-09-30): 42 characters, **0** DM-imposed drawbacks ever, so no existing log carries the
  new event and nothing in production changes until a DM uses it.

## Deploy order

1. Re-verify production against the hashes above, then **apply the migration first**. Until it is applied the server
   rejects `dmUnlockDrawback` as an unsupported event type, so the DM Console's Unlock would fail with that error.
2. Run `get_advisors` and skim `get_logs`; check the four guard markers in the migration header.
3. Ship the client. An older cached client is safe: it ignores the unknown event and keeps showing the drawback locked.
Rollback: `sql/migrations/2026-10-04-dm-unlock-drawback-rollback.sql`.

## Found on the way (not fixed here)

`compute()` credits a DM-imposed drawback's **table value** as income although the DM paid the player 0 AP: with one imposed
Peg Leg `compute().remaining` is 83 against 79 earned, and with four imposed wounds it is 95 and warns "Drawbacks grant 16 AP
— the guide caps them at 12" and "4 drawbacks chosen". The frozen ledger (`economy()`) is correct (79), so the Live Sheet's
AP-left is right, but the DM Console's "Granted by drawbacks" row reads `compute()`. It will matter as soon as wounds are
imposed, and the `_imposedDrawbackIdx` marker from `D-GH-2026-09-30-imposed-drawback-cap-bypass` is the hook for fixing it.
Proposed as its own task; changing it alters `compute()` output, so it needs a `DATA.version` bump and fixture updates.
