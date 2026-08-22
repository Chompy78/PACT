# D-GH-2026-08-22-audit-batch-mechanical-fixes — 10 low-risk playability/usability fixes from the 2026-08-22 audit, batched

## Context
The 2026-08-22 full-tool audit produced 22 findings across `js/engine.js` and the three tools. The
esc()/stored-XSS subset (5 findings, 8 sites counting duplicates) was fixed and merged first (PR #448,
`D-GH-2026-08-22-esc-gap-chargen-livesheet`) as the highest-severity, highest-reachability category. The
remaining 15 non-security findings were filed to the task board in PR #449, then triaged for this batch:
which ones are safe to fix directly, in one sweep, without a design decision or dedicated review, versus
which ones genuinely need their own pass.

**Triage, and why each finding landed where it did:**

| Finding | Disposition | Why |
|---|---|---|
| Live Sheet cloud-save budget gate re-pricing (L1) | **Fixed here** | One-line swap to an already-proven formula used everywhere else in the same file |
| Live Sheet JSON import no confirm (L6) | **Fixed here** | `confirm()` addition matching an existing pattern (`resetAll()`) in the same file |
| Live Sheet HP/Temp HP/Hit Dice cross-device sync (L5) | **Shallow fix only** | Shallow (a visibility hint) is mechanical; the deep fix is a real LOG-schema decision — see below |
| DM Console roster-card staleness after an award (D1) | **Fixed here** | Existing `_dmReloadRoster()` bridge already does the right thing, just needed to always run |
| DM Console downtime-declare no confirm (D2) | **Fixed here** | `confirm()` addition matching several existing patterns in the same file |
| DM Console dead `viewAt` variable (D6) | **Fixed here** | Dead-code removal, zero behavior change |
| DM Console touch-target sizing (D7) | **Fixed here** | CSS-only |
| CharGen ledger escaping consistency (C3) | **Fixed here** | Swap a bespoke partial-escape for the file's own real helper |
| CharGen budget field negative clamp (C4) | **Fixed here** | `Math.max(0, …)`, matching the field's own declared `min` |
| CharGen name maxlength (C5) | **Fixed here** | Attribute addition |
| Engine: uncapped Attunement/Ki/Sorcery ladders (E1) | **Deferred — own branch** | Touches `js/engine.js`, changes `compute()` output, needs a `DATA.version` bump + `testing/expected/` update shared with E2/E3 |
| Engine: no ability-score upper bound (E2) | **Deferred — own branch** | Same reason as E1 — bundled together for one version bump |
| Engine: duplicate class-unlock double-charge (E3) | **Deferred — own branch** | Same reason |
| Engine: `activeEvents()` null-guard (E4) | **Deferred — own branch** | Bundled with the other three for one PR, even though it alone needs no version bump |
| DM Console co-DM revoke UI (D3) | **Deferred — own branch** | Real feature work (new list UI + wiring to existing `removeDm`/`getCampaignDms`), not a one-line fix |
| Archived-campaign RPC enforcement (D4) | **Deferred — not scheduled in this sweep** | Production RLS/RPC change on the app's only real security boundary — this project's own standing rule requires `/make-code-cold-plan-review` before implementing this class of change, and that review hasn't happened |

## Decision
Shipped the 10 mechanical fixes in one batch/branch/PR (`fix/tool-mechanical-fixes`), each still logically
independent and individually described in `CHANGELOG.md`. The two genuinely deferred items (D3, D4) stay
on the task board as their own tasks. E1-E4 move to a dedicated `fix/engine-pricing-edge-cases` branch
(tracked separately — this record covers only the batch above).

**On L5 (HP/Temp HP/Hit Dice sync) specifically — the fix-depth call, made explicit rather than silently
defaulted:** AGENTS.md's own working-discipline section requires presenting both a shallow and a deep fix
with a recommendation, not silently shipping the cheap one. The deep fix (moving these three fields into
the LOG-backed path, mirroring how `appearance` was migrated) would close the gap outright, but it is a
real schema/behavior decision: it changes what every future character write contains, needs a migration
story for values that are currently local-only, and interacts with undo/redo and the time-travel scrub
semantics, which don't currently expect combat-tracking noise in the append-only log. That is squarely the
kind of decision this project's cold-review trigger describes (multi-file implications, a real design
trade-off) — not something to decide unilaterally inside a mechanical-fix sweep. The shallow fix (a
"this device only" visibility hint) ships now: it's low-risk, ships immediately, and converts the hazard
from *silent* (a player has no idea their HP reset because of a device switch) to *visible* (the player
can see the field is local-only and knows not to trust it blindly). The deep fix is **not** filed as a
task — filing it would imply a decision that hasn't actually been made; it's recorded here as an open
question for the owner to pick up if/when it's worth the schema-migration cost.

**On the `tool-pricing-ci.mjs` fixture rewrite (two tests):** the Live Sheet budget-gate fix required
updating two existing tests that had stubbed `window.compute` to force a fake `{remaining}` value —
`_lsOverApBudget()` no longer reads `compute().remaining` at all (that was the whole point of the fix), so
the stub no longer exercised the code path the tests meant to cover. Rewrote both to build a real
over/under-budget LOG (`award` + `buy` events with real `cost` values) instead of stubbing the engine,
which is a strictly better test anyway — it also exercises `apCeiling()`/`economy()`, not just the gating
branch logic in isolation.

## Why
This batch exists as a deliberate middle tier between "trivial enough to not need a task at all" and "big
enough to need its own dedicated review": each of these 10 findings, taken alone, would have been a
one-line PR not worth the review overhead of its own branch/CI cycle; taken together, batching them kept
the fix-to-process-overhead ratio sane while still giving each finding its own CHANGELOG line and its own
row in this record's triage table, so nothing is buried inside an opaque "misc fixes" commit. The two
findings held back (D3, D4) and the one held to its shallow half (L5) are the control case for that
judgment: this batch is not "everything that was easy to type," it's "everything that was actually safe to
ship without a design call or a security review" — a distinction worth keeping visible, since the
temptation in a large sweep like this is to let scope quietly creep into the judgment-call items too.

## Status
Implemented on `fix/tool-mechanical-fixes`, off `preview` at the `docs/audit-remaining-findings-tasks`
merge commit (PR #449). `engine-parity-ci.mjs`: 52/0 (untouched — no engine changes in this batch).
`tool-pricing-ci.mjs`: 163/0, including the two rewritten budget-gate fixtures. `docs/TASK_BOARD_NOW.md`/
`_NEXT.md`/`_LATER.md` graduated for all 10 fixed findings; D3 and D4 remain open; the L5 deep-fix
question is recorded here, not on the board.
