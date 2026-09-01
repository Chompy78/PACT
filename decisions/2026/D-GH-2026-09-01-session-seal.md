# D-GH-2026-09-01-session-seal — the session seal AMENDS the existing lock, it does not add a second one

**Status:** Phase 1 implemented · branch `claude/everything-on-main-kx82ur` · **migration written and
tested against a local Postgres, NOT applied to production** · Phase 2 (tool UI) not started.
Plan + three cold reviews: `docs/plans/2026-09-01-session-seal-cold-review.md`.
Builds on `D-GH-2026-09-01-undo-barrier-shared` (step 1).
Amends `D-GH-2026-08-10-campaign-ap-log-integrity`.

## Context

The owner wanted a per-session lock: *"each session, there is an undo lock put in place… it must apply
to both sheets so anything already bought can't be unselected."*

### The correction this record exists to make

**The first draft of this work was built on a false premise, and the premise survived three cold
reviews because none of the reviewers had repo access.** That draft — and the plan, changelog and
migration comments written alongside it — asserted that no server-side protection of character history
existed, and that the browser was therefore the integrity boundary.

That was wrong. `pact_enforce_locked_history()` has existed since 2026-08-10
(`sql/migrations/2026-08-10-campaign-ap-log-integrity.sql`, also in `sql/rls-policies.sql`). For a
campaign-bound character it already freezes everything at or before the last non-discretionary,
non-`noLock` `award` event, comparing a projection of the protected events and rejecting any write
that shortens or rewrites them.

It was found by a read-only pre-flight against the live schema immediately before applying the
migration — listing existing triggers on `characters` — which is the one check that would have caught
it at any point. The research gap was mine: greps targeted `award_ap` and `dm_edit_character_log`, and
never asked "what triggers already exist on this table".

**Two consequences beyond the embarrassment.** First, the original design would have added a *second*
prefix-protection trigger beside the first — precisely the hand-written-mirror drift `AGENTS.md` names
as this project's recurring failure. Second, and worse, that second trigger compared **raw JSONB
events** where the existing one deliberately compares a **six-field projection**; the original earned
that projection through three review-found bugs (see its revision note). A raw comparison rejects a
save merely because an event gained a cosmetic field. It would have shipped to production and started
refusing legitimate saves.

### What was still genuinely missing

The existing lock does not cover what the owner asked for:

1. **The DM Console's "Award AP" writes only `characters.ap`** plus a ledger row — never a LOG event.
   So the actual award button locks nothing at all, then or now.
2. **The award boundary skips solo characters** (`if NEW.campaign_id is null then return NEW`), which
   owner decision I2 requires.
3. **The boundary moves and is implicit.** It is wherever the last qualifying award happens to sit; a
   seal is placed deliberately, at a moment the DM chooses, and stays there.

## Options

- **A1 — the AP award itself is the seal.** Rejected: AP already reaches a character by two paths
  feeding the same spendable total, so an award in the log too would double it.
- **A2 — seal the Undo button only.** Fails the un-select requirement outright.
- **A3 — CharGen read-only once sealed.** Blocks forward progress; wrong product.
- **A4 — a `sealed_through_event_id` column.** Raised by two reviewers, recommended by neither. Stores
  derived state beside an event-sourced log.
- **A5 — a new `sessionSeal` event with its own new trigger.** *(drafted, then withdrawn)* — a second
  overlapping trigger, with a stricter comparison than the one it sat beside.
- **A6 — a `sessionSeal` event that AMENDS the existing trigger.** *(chosen)*

## Decision

Three surgical changes to what already exists, rather than anything new:

1. **`sessionSeal` joins the protected projection** (`pact_ap_ledger_protected`), so a seal cannot
   itself be deleted or reordered.
2. **The boundary becomes the later of** the existing award boundary and the last seal.
3. **The seal half applies to solo characters too.** The award half keeps its campaign-only scope
   exactly as before.

Plus the entry points that had no equivalent: `seal_character_history()` (DM for a campaign character,
owner for a solo one), atomic and idempotent `award_ap_and_seal()`, and `sessionSeal` on
`dm_edit_character_log()`'s allow-list with any smuggled AP value stripped.

**The owner's three rulings still collapse into one invariant** — *the protected prefix may not be
altered; anything may be appended after it* — because J1 corrections append, K3 description edits can
be made to append (the engine replays `name` and appearance patches as last-wins assignment), and the
rule names no author, so it covers both tiers. That is what makes an amendment sufficient where an
exception list would not be.

## Why this is safe against the 35 live characters

Measured 2026-09-01: **zero** characters carry a `sessionSeal`. So change (1) alters no existing
protected set, and (2) and (3) are no-ops until somebody deliberately places the first seal. The award
boundary's behaviour is byte-for-byte unchanged — asserted directly by regression tests, not argued.

`js/engine.js` carries two floors, deliberately. `undoFloor()` is the client's, and is broader: it also
treats `dmEdit` and `creationLocked` as barriers and (matching the Live Sheet's original hand-written
check) does not exempt `noLock` awards. `sealedFloor(events, opts)` mirrors the server exactly,
including the campaign-only scope of the award half. `sealedFloor <= undoFloor` for every shape — the
client always refuses at least as much as the server, which is the safe direction; the reverse would
mean rejecting a save the UI had called legal.

## Verification

- `engine-parity-ci.mjs` **73/0** · `undo-barrier-ci.mjs` **37/0** · `tool-pricing-ci.mjs` **184/0**.
- `testing/sql/session-seal-test.sql` — **32 assertions, exit 0**, against a real Postgres 16. Its
  first section is the one that matters: **regression tests proving the 2026-08-10 award boundary is
  unchanged** — pre-award history still unrewritable, still unable to shrink, `cat:'patch'` still
  exempt, appends still allowed, solo characters still outside the award half. Then the new behaviour:
  both authorisation tiers, a sealed solo character protected, the seal itself unremovable, J1 and K3
  appends allowed, the later-of-award-and-seal boundary, idempotent retries.
- The **rollback** was applied to a live test database and verified to restore the 2026-08-10 bodies
  **without removing the pre-existing award protection** — the failure mode that matters most, since a
  naive rollback that dropped `trg_pact_locked_history` would strip protection older than this work.

### Two harness defects found and fixed rather than left standing

- Identity was set with `set_config(..., true)` — transaction-local — so two authorisation cases ran
  with a NULL user and reported PASS while testing nothing.
- The allow-list rejection case was being refused by the authorisation check, not the allow-list.

## Known-unstable, unrelated

`tool-pricing-ci.mjs` intermittently reports `harness — CharGen never became ready for the version
check` and aborts early. Seen three times today, once *before* any change was made; passes on re-run. A
readiness race in the harness, not a product defect. Worth its own task.

## Still open

Phase 2 (the tool UI), the DM Console control, and the offline conflict UX (L1). The data is safe
without them; what is missing is a human-readable experience when a save is refused.
