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

---

## Addendum (same night, v0.355) — the contract was a trap, and it broke CharGen

**The claim "EV-019 pins the whole thing end to end" above is wrong, and the way it is wrong is the
point of this addendum.** `engine-parity` asserts `total`, the warning count, the exact warning text,
and the **sign** of `remaining`. It never asserts the **value** of `budget` or `remaining`. So EV-019 —
added specifically to pin the drawback grant — passes identically whether a drawback is worth double,
single, or nothing at all. All 38 fixtures do. The gate suite could not see the income side of
`compute()` at all.

**What that hid.** v0.354 delivered the grant through `b.budget`, documented as a caller contract:
*"`b.budget` is EARNED AP including drawback grants — exactly what `foldBuild()` produces. Every real
caller folds, so every real caller satisfies this."* That last sentence was false. **CharGen does not
fold.** `readBuild()` reads the form, where `budget` is the award field alone. So in the tool where
characters are actually created, v0.354 made drawbacks worth **zero** — strictly worse than the
double-count it replaced, and it shipped to `preview` and was one merge away from `main`.

It was caught by driving the real CharGen in a headless browser before merging the promotion: 79 AP
award, two drawbacks worth 6 AP, budget still 79.

### Decision

Model (b) is unchanged — a drawback is income. What changes is **where the income enters**.

`compute()` now derives the grant itself from `b.drawbacks` (it already computed `drawGain`/`_dGranted`
for the ledger line and the cap warning) and adds it to `spendable`. `b.budget` goes back to meaning
exactly one thing: **awards only**.

```
v0.354:  spendable = b.budget(awards + grants) − withheld + dmAp     ← caller must supply the grant
v0.355:  spendable = (b.budget(awards) + _dGranted) + dmAp           ← compute() derives it
```

Both folding entry points now pass awards only: `foldBuild()` sets `earned − drawbackEarned`, and
`rebuildStateFromEvents()` the same. The cap is applied by capping `_dGranted`, not by clawing back from
the budget. The grant sits **inside** the `ignorePlayerAp` bracket, because it is player-side income — a
campaign that ignores a player's own AP ignores what their drawbacks earned too, exactly as before.

### Why not just fix CharGen

The obvious one-line patch is to have `readBuild()` sum `DATA.drawbacks` into its `budget`. That is
re-implementing rules logic in a tool, which `AGENTS.md` forbids outright — and it would leave the same
trap armed for the next non-folding caller. A contract a caller can quietly violate is not a contract.
Deriving the grant where the rules live makes the bad state unrepresentable: no caller can get it wrong
because no caller is asked.

### The gates that were missing, now added

1. **`log-fuzz` — the income invariant.** `compute().budget === economy().earned` on every fuzzed log
   (excluding logs whose drawback cost differs from the current table value, where the frozen ledger and
   the live table legitimately disagree — the same carve-out the existing `repriceDrift` check makes).
   Stated against the frozen ledger, so it holds under any pricing model.
   **It paid for itself immediately:** it failed on the first run, on `rebuildStateFromEvents()`, which
   also set `b.budget = economy().earned` and so double-granted every drawback. That is a second folding
   entry point — the one the parity runner uses for event fixtures — and nothing else was checking it
   against `foldBuild()` on this axis.
2. **`chargen-flows-e2e` — a real drawback click in the real CharGen.** Ten checks: the budget rises by
   exactly the grant, `total` is untouched, AP-left rises once, the on-screen status line agrees with
   `compute()`, the ledger heading and its itemised rows survive, and un-ticking returns every point.
   56 → **66** checks.

Both were verified by re-introducing each bug and watching them fail: with the grant removed,
`chargen-flows` fails 2 checks and `log-fuzz` reports `incomeDrift`; with the double-count restored,
`log-fuzz` reports `incomeDrift` and **parity still passes 38/0** — which is the measurement that
justifies both new gates existing.

### Fixture correction

`CG-002` goes back to a budget of **50** (v0.354 had raised it to 51 purely to satisfy the contract).
Its intent — a 50 AP award, 1 AP from `Geas of the Road`, all 51 spent, remaining 0 — is now expressed
directly again.

### Found but deliberately not fixed tonight

**The campaign drawback cap is DM-view-only.** `drawbackCap` appears in `DM-Console.html` and in neither
player tool, so a player in a capped campaign sees the full grant in CharGen and the Live Sheet while
their DM sees the capped figure. Pre-existing since v0.351 and unrelated to this change, but it matters
more now that the grant is real income rather than a cancelling pair. Needs the campaign rules wired
into both player tools — too wide to do unreviewed. Recorded in the morning review.

### Status

All gates green at v0.355: parity 38/0, tool-pricing 134/0, chargen-flows **66/66**, dm-console-ui
94/94, sw-cache pass, log-fuzz 500/500 (and 3000/3000 on a second seed), four sync gates 54/0,
verify-guide 9/9. CharGen verified by hand in a headless browser: 79 award + 6 AP of drawbacks → budget
85, total 0, AP left 85, ledger row `Drawbacks (refund) −6` with both itemised rows intact.
