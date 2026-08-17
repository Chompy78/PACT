# D-GH-<date>-drawback-ap-double-count

**Status:** Decided — implement model (a).
**Task:** `fix/drawback-ap-double-count` (TASK_BOARD_NEXT.md).
**Touches:** `js/engine.js` (`foldBuild`/`compute`) + the AP display in Live Sheet
and CharGen. **Changes `compute()` output → bump `DATA.version`.**

---

## Problem

A drawback is currently worth its points **twice**:

- `foldBuild()` sets `b.budget = economy().earned`, and `earned` is
  awards **plus** `drawbackEarned`.
- `compute()` then does `playerAp = b.budget` and
  `spendable = (ignorePlayerAp ? 0 : playerAp) + dmAp`.
- But `total` **already** nets the drawback (its cost is negative).

So a single drawback both **reduces the build cost** *and* **raises the
spendable ceiling**. It is counted on both sides of the equation.

### Two internally-consistent models — the engine currently does half of each

```
(a) cost NETS the drawback (total 50), budget EXCLUDES the refund (37) -> remaining -13  CORRECT
(b) cost IGNORES it        (total 54), budget GAINS  the refund  (41) -> remaining -13  CORRECT
    current: total 50 (a)  AND  spendable 41 (b)                      -> remaining  -9  WRONG
```

Verified against **Moss Stormspud (COPY)**: positive purchases 54, drawback
refunds −4, net total 50, DM AP 37. With `ignore_player_ap` **TRUE** the engine
drops `playerAp`, lands on model (a), and correctly reports "OVER BUDGET by 13
AP". With it **FALSE**, remaining is −9.

### Blast radius
- **Amble is the only campaign with `ignore_player_ap` on**, so it is
  unaffected — it already lands on model (a).
- Every character **not** in such a campaign — including all 8 unbound ones —
  currently gets **double value** from drawbacks.

### Also a labelling bug
`engine.js:476` documents `playerAp = b.budget` as "folded from the character's
own award events", which is not what it holds. Under `ignore_player_ap` the UI
then says "4 player AP ignored" — wrong twice: it is not player AP, and it is
not being ignored (it is already applied as a discount on `total`).

---

## Decision

**Adopt model (a): a drawback affects the COST side only.**

Rationale for cost-side over budget-side:

1. **`total` already nets drawbacks** — the negative-cost path in `compute()` is
   the existing, tested mechanism. Model (a) leaves that untouched and only
   *stops the second application* on the budget side. Model (b) would instead
   have to strip the netting out of `total` and re-add it to the budget, a
   larger and riskier change to the pricing core.
2. **It makes `playerAp` mean what the code already claims it means**
   (`engine.js:476`: award events only). Model (b) would keep `playerAp`
   holding a mix of awards + drawback credit, i.e. it would *entrench* the
   labelling bug rather than fix it.
3. **A drawback is conceptually a discount on what you bought, not a pool you
   spend from.** Presenting it as a cost-line reduction matches the mental model
   a player has ("this build is cheaper because I took a flaw"), whereas a
   spendable-pool line invites the "drawback as cheap AP loan" gaming the 3×
   buy-off rule already exists to deter.

---

## Implementation

1. **Engine.** Stop `b.budget` / `playerAp` folding in `drawbackEarned`.
   `playerAp` must mean award events only, exactly as `engine.js:476` already
   documents. The drawback's negative cost continues to net into `total`
   unchanged — do **not** touch that path.
2. **Display split by side of the equation.** Drawback AP is a discount on cost,
   not a pool to spend from:
   - Show it on the **cost line**, e.g. `Build cost 50 (54, less 4 from
     drawbacks)`.
   - Reserve **"Player AP"** for actual awards.
   - No new engine export is needed — `economy()` already returns
     `drawbackEarned` separately from `earned` (D-GH41 exposed it for exactly
     this).
3. **Check every consumer of `playerAp` / `b.budget` before changing it** —
   Live Sheet, CharGen, DM Console — and confirm none of them re-derive the
   drawback credit themselves, or it will be dropped **twice** instead of once.
4. **Fix the label** at `engine.js:476` and anywhere the UI says "N player AP
   ignored" for drawback-derived AP.

---

## Version / testing

- This **changes `compute()` output** → **bump `DATA.version`** and update
  `testing/expected/` in the **same PR**.
- Add a fixture with **drawbacks and no award events** (the Moss Stormspud case
  that exposed this), asserting the **same `remaining`** whether `ignorePlayerAp`
  is `true` or `false`.
- `engine-parity` must report **0 failed**.

## Done when
- A drawback affects the build's cost **exactly once**.
- A character with drawbacks and no awards reports the same `remaining` whether
  `ignore_player_ap` is on or off.
- No UI calls drawback-derived AP "player AP".
- `testing/expected/` updated and `DATA.version` bumped in the same PR.
- `engine-parity` = **0 failed**.
