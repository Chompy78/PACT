# D-GH-2026-08-19-drawback-single-count — a drawback is income, not negative spending (model b)

**Status:** Settled and implemented (`DATA.version` v0.354).

## Context

Drawbacks were worth **double**. `foldBuild()` sets `b.budget = economy().earned`, and `earned` already
includes `drawbackEarned`; `compute()` then *also* subtracted the grant from `total`, because each
drawback's `cost` is negative. So a drawback both raised the ceiling and lowered the spend.

Measured on a level-1 Fighter awarded 79 AP:

| Drawbacks | Grant | AP actually available | vs 79 |
|---|---|---|---|
| 0 | 0 | 79 | — |
| 2 | 14 | **107** | +35% |
| 4 | 26 | **131** | +66% |
| 6 | 37 | **153** | +94% |

Two players at one table, one taking four drawbacks, built on 131 AP and 79 AP. Live on `main` at the
time this was found, the week the first real characters were being made.

## Options

Both are arithmetically correct and both produce the right `remaining`. They differ in what the ledger
*displays*.

- **(a)** `total` nets the drawback out (stays negative), `budget` excludes the grant.
  → *"Budget 79. Spent −11. Left 90."*
- **(b)** `total` counts positive purchases only, `budget` includes the grant. ← **chosen**
  → *"Budget 93. Spent 3. Left 90."*

## Decision

**(b).** `compute()` no longer nets drawbacks into `total`; the grant reaches the character through
`b.budget` alone, and a campaign cap is applied by withholding the excess from the budget side.

## Why

1. **It is what the guide already promises.** *"Each drawback below grants AP up front"* describes a
   budget going up, not a cost going down. (a) would have made the guide describe something the engine
   does not do.
2. **(a) produces "spent −11".** Any character whose drawbacks outweigh their purchases — every level-1
   character who takes one before buying anything — would show a negative total. That is not a number to
   put in front of a player.
3. **`economy()` already worked this way.** It reports `earned 93` (79 award + 14 drawback) and
   `spent 3`. (b) makes `compute()` agree with the frozen ledger; (a) would have introduced a third view.

## Two things the change turned up that were not in the plan

**The `b.budget` contract had to be stated.** Under (b) the grant arrives on the budget side and nowhere
else, so `b.budget` must be earned AP *including* drawback grants — exactly what `foldBuild()` produces.
Every real caller folds. Three hand-authored fixtures did not, and would silently have granted nothing;
their budgets are corrected and the contract is now written at the site.

**Legacy characters would have lost AP.** `economy()` counted `drawbackEarned` only from
`buy`/`cat:'drawback'` events. Older CharGen exports delivered drawbacks as a coalescing **patch** —
`LS-001` carries one worth 1 AP. Under the old model that worked by accident, because the grant reduced
`total` directly and it did not matter which side it sat on. Under (b) it would have vanished.
`_economyFrom` now also recognises a patch that changes drawbacks and nothing else with a negative cost.
This is the third time this project has nearly lost saved-character data to a shape nobody migrated.

## Status / verification

- **`EV-019`** pins the whole thing end to end: 79 awarded, two drawbacks worth 14, one 3 AP feature →
  budget 93, total 3, remaining **90** (was 104). Parity 37 → **38**.
- `LS-001` proves the legacy patch shape still grants: budget 81, total 79, remaining 2.
- Five existing fixtures moved, every one a correct consequence: `CG-002` 50 → 51, `CG-016` −26 → 0,
  `CG-017` −12 → 0, `LS-001` 78 → 79, `EV-017` 4 → 6.
- The ledger keeps showing `Drawbacks (refund) −14` with its itemised rows, via a new display-only line
  that does not touch `total` — so the invariant that itemised rows sum to their heading still holds,
  which `tool-pricing-ci` asserts.
- `log-fuzz`'s draft-reconciliation invariant changed from `spent − drawbackEarned === total` to
  `spent === total`; the subtraction existed only to cancel the double-count.
- All twelve gates green: parity 38/0, tool-pricing 134/0, chargen-flows 56/56, dm-console-ui 94/94,
  sw-cache pass, log-fuzz 500/500, four sync gates 54/0, verify-guide 9/9.
