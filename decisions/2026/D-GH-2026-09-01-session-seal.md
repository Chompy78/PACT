# D-GH-2026-09-01-session-seal — a session seal the database enforces, not the browser

**Status:** Phase 1 implemented · branch `claude/everything-on-main-kx82ur` · **migration written and
tested locally, NOT yet applied to production** · Phase 2 (tool UI) not started.
Plan + three cold reviews: `docs/plans/2026-09-01-session-seal-cold-review.md`.
Builds on `D-GH-2026-09-01-undo-barrier-shared` (step 1).

## Context

The owner wanted a per-session lock: *"each session, there is an undo lock put in place… it must apply
to both sheets so anything already bought can't be unselected."*

Step 1 centralised the undo-barrier rule into `undoFloor()`. That was groundwork. Four things still
blocked the feature, all verified in code rather than assumed:

1. **"Award AP" never touches the LOG** — it writes `characters.ap` plus a ledger row, so there was
   nothing in the history for a seal to attach to.
2. **AP arrives by two independent paths** that both feed the same spendable total, so an award written
   to both would double it.
3. **Un-ticking a checkbox in CharGen splices the purchase out of the LOG** — no undo involved, no
   barrier check on that path at all.
4. **Whole-build paths rebuild the LOG from the form** and can drop events outright.

Three cold reviewers (GPT-5.6 Luna, M365 Copilot/GPT-5, one self-identifying as GPT-4) then converged
on a fifth that revision 1 of the plan had underweighted: the plan treated the browser as the integrity
boundary, so a stale or offline client's ordinary save could erase a seal.

**That finding was accepted, but its stated basis was wrong and was corrected before acceptance.** All
three implied no concurrency control existed. One does: `pushCharacter()` in `js/sync.js` compare-and-
swaps on a server-maintained `updated_at`. It is nonetheless insufficient, in three specific ways — it
was **opt-in** (an entirely unguarded branch when the client had no base value), the predicate lives in
the **client's own query** rather than a server policy, and it is **row-level last-write-wins** with no
check that the new LOG preserves the old prefix. It has already failed in production once: 2026-08-07,
a character went 43 AP spent → 47 → back to 43 across two browser profiles *with the guard active*
(`docs/HOW-TO-WORK.md`).

## Options

- **A1 — the AP award itself is the seal.** Rejected: doubles AP, or forces a rewrite of a deliberately
  DM-only authoritative field. All three reviewers agreed with the rejection.
- **A2 — seal the Undo button only.** Fails the un-select requirement outright.
- **A3 — CharGen read-only once sealed.** Blocks forward progress; wrong product.
- **A4 — a `sealed_through_event_id` column** instead of a marker event. Raised by two reviewers, neither
  recommending it. Rejected: stores derived state beside an event-sourced log, creating a second
  synchronisation obligation. With 25 characters, deriving the floor during validation is cheap.
- **A5 — a zero-AP `sessionSeal` event plus a database trigger.** *(chosen)*

## Decision

**One invariant, enforced by a `BEFORE UPDATE` trigger on `characters`:**

> Once a `sessionSeal` event is in the authoritative LOG, no write may alter the events at or before it.
> Anything may still be appended after it.

**The owner's three rulings collapse into that one sentence, which is the whole reason this is
affordable.** Each looked like it needed its own exception and none does:

- **J1** (a DM may still correct a mistake after a seal) — corrections *append*.
- **K3** (name / appearance / backstory stay editable) — under a seal those edits append instead of
  replacing, and the engine replays both as last-wins assignment (`name` is a plain assignment;
  appearance patches are an `Object.assign`), so a later event supersedes an earlier one with the sealed
  prefix untouched.
- **I2** (a solo player may seal their own character, as well as a DM sealing a campaign one) — the
  invariant says nothing about *who* sealed, so one rule covers both tiers.

No per-event-type exception list, no author test. That is what makes a single trigger sufficient.

**A trigger, not a check inside one function**, because the reviewers' procedural point was the right
one: naming a few UI paths is not durable. A trigger covers every path that exists — including the two
CharGen mid-log paths and the Live Sheet Import that revision 1 of the plan had *missed* — and every
path nobody has written yet.

## Why the trigger enforces `sessionSeal` ONLY

This is the load-bearing safety decision, and it is the reason the migration is safe against 25 live
characters. `undoFloor()` also treats `dmEdit`, non-discretionary `award` and `creationLocked` as
barriers. Enforcing *those* in the database would break every existing character on its next save:
editing a name or appearance currently filters the old event out of the log from wherever it sits, and
on any character carrying an `award` event — which is all of them — that legitimately rewrites history
sitting behind a barrier. Harmless today, because those barriers are only consulted by undo. Enforced
in the database, an ordinary rename becomes a hard save failure.

So `js/engine.js` now has **two** floors, deliberately: `undoFloor()` (client, all four barrier types)
and `sealedFloor()` (server-enforced, seals only). `sealedFloor <= undoFloor` always — asserted in the
gate, because a server floor *above* the client's would mean rejecting a save the UI believed legal.

Restricting enforcement to a brand-new event type makes the migration non-retroactive **by
construction**: no character has a seal until somebody deliberately adds one, so nothing that works
today can begin to fail. That is stronger than "the migration writes no seals", which is also true but
would not by itself stop existing saves breaking.

## What shipped in Phase 1

- `js/engine.js` — `sessionSeal` recognised by `isUndoBarrier()`; new `sealedFloor()`.
- `sql/migrations/2026-09-01-session-seal.sql` — `pact_sealed_floor()`, the enforcing trigger,
  `seal_character_history()` (DM or solo owner), atomic and idempotent `award_ap_and_seal()`, and
  `sessionSeal` added to `dm_edit_character_log()`'s allow-list with any smuggled AP amount stripped.
- `js/dm.js` — `sealHistory()`, `awardApAndSeal()`.
- `js/sync.js` — the permanently-unguarded save branch closed by adopting the server's current
  `updated_at` rather than skipping the guard (refusing outright would strand legacy records forever).
- `testing/sql/session-seal-test.sql`, `testing/scripts/undo-barrier-ci.mjs` extended.

**Deliberately NOT in Phase 1: any UI.** Nothing can create a seal through the tools yet, which is
exactly what makes Phase 1 safe to deploy alone. Between the phases, a sealed character opened in
CharGen and saved would be *rejected* by the trigger — correct, but a hard error with no explanatory
UI. Do not surface a seal control until Phase 2 lands.

## Verification

- `engine-parity-ci.mjs` **73/0**; `undo-barrier-ci.mjs` **29/0** (was 19, extended for the seal);
  `tool-pricing-ci.mjs` **184/0**.
- `testing/sql/session-seal-test.sql` — **38 assertions, exit 0**, run against a real Postgres 16, not
  reasoned about. Covers: the floor function; that an unsealed character is completely unaffected;
  authorisation for both tiers; the stale-client truncation; altering a sealed event; removing the seal;
  J1 and K3 appends being allowed; idempotent retry of both seal and award-and-seal; and that a seal
  carries no AP however it arrives.
- **A false PASS in that harness was found and fixed rather than left standing.** Identity was being set
  with `set_config(..., true)`, which is transaction-local, so each `rejects()` case ran with a NULL
  user — "the owner cannot seal their own campaign character" was actually being refused for having no
  identity at all, and the allow-list case was refused by the authorisation check rather than the
  allow-list. Both reported PASS while testing nothing. Identity is now set at session level.

## Known-unstable, unrelated

`tool-pricing-ci.mjs` intermittently reports `harness — CharGen never became ready for the version
check` and aborts early. Seen twice this session, once *before* any change was made, and it passes on
re-run. A harness readiness race, not a product defect — worth its own task.

## Still open

Phase 2 (the tool UI), the DM Console control, and the offline conflict UX (L1). The trigger already
makes the data safe without them; what is missing is a human-readable experience when a save is refused.
