# D-GH-2026-08-06-maneuver-afford-gate — a purchase `compute()` never charges for needs its own pricing escape, and its price belongs in `DATA`

Status: Active. Shipped 2026-08-06 (PR #364).

## Context

`buyManeuver()` called `emit()` directly, bypassing `buy()`'s frozen-economy affordability check — the
only purchase path in the Live Sheet that did. Measured on a Fighter holding *Combat Superiority* with
**0 AP available**: four clicks charged 4, 5, 6 and 7 AP and took the character to **−22**, with no
refusal and no warning.

The obvious fix — route it through `buy()` — does not work on its own. `buy()` prices via
`priceOf()`, which for an ordinary purchase is a whole-build `compute()` diff. But `compute()` never
reads `maneuverBuys`: `MUT.mvbuy` (`js/engine.js:545`) is its only appearance in the engine, and no
ledger line consumes it. The diff is therefore **0**, and an affordability gate built on it is a
silent no-op. The purchase needs its price quoted from somewhere else.

That collides with an Active decision. `D-GH-2026-08-05-pricing-model` **D1** says, in as many words:

> The three existing escapes are retired into that rule rather than joined by a fourth.

and its *Why* records that three of four round-2 cold reviewers independently rejected "just add
another escape" as the weaker option.

## Options

- **A — add a fourth entry to `_CTX_PRICERS`.** Smallest diff, and it works. This was shipped first and
  then reverted here. It contradicts D1 head-on with no record, and it is *miscategorised*:
  `_CTX_PRICERS` is documented as the table for purchases whose build diff is wrong **because they
  change the pricing context and drag a re-price of everything already owned into the quote**. An
  `mvbuy`'s diff is wrong for the opposite reason — nothing is charged at all.
- **B — make `compute()` price `maneuverBuys`.** The most principled: the gate, the ledger and
  `repriceDraft()` would all agree, and it would fix the refund bug noted below for free. Rejected for
  *now* — it changes `compute()` output, so it needs a `DATA.version` bump, a `testing/expected/`
  refresh, and a decision about characters whose frozen ledgers were built without it. That is the
  `feat/ap-model-reconcile` / `fix/ledger-reconciliation-pass` territory, rated high risk, and it should
  not be smuggled in behind an affordability fix.
- **C — a separate, honestly-named table, with the price moved into `DATA`** (chosen).

## Decision

**Two escapes from the build diff, kept deliberately apart, and the price lives in `DATA`.**

- `_CTX_PRICERS` keeps its existing meaning and its existing three entries: *the diff is wrong because
  this purchase changes the pricing context.* D1's plan to retire it into one general context-change
  rule is untouched.
- A new `_UNCHARGED_PRICERS` holds `mvbuy` alone: *the diff is wrong because `compute()` charges nothing
  at all.* `priceOf()` consults it only after `_CTX_PRICERS` misses.
- `DATA.maneuverBuy = {base:4, step:1}` is new. The tool computes `base + step × maneuverBuys` and falls
  back to the historical `4`/`+1` if an older dataset lacks the key.

`DATA.version` is **not** bumped. The value is unchanged, `compute()` never reads the new key, and
`compute()`'s output is byte-identical — engine-parity stays 27/0. This follows the same precedent as
the display-only `masteryFx`/`drawbackFx`/`racialFx` maps: a key the engine does not price from is not a
mechanics change. A bump would have been defensible on the grounds that it *is* a price; it is recorded
here as a judgement call rather than an obvious one.

## Why

**Because keeping the two tables apart is load-bearing, not tidiness.** `docs/TASK_BOARD_NEXT.md`
already instructs the next agent to port `_CTX_PRICERS` into CharGen as "the same rule already solved
once", keyed by context-change categories — and `mvbuy` is neither a context change nor has a CharGen
analogue (`maneuverBuys` appears **zero** times in CharGen and DM Console; the Live Sheet is the only
tool with a maneuver purchase path). Folding an uncharged purchase into that table would mean that the
day D1's retirement happens, maneuvers silently become free again. Separating them makes the general
rule safe to retire.

**And because D1 itself says where the price should go.** Its closing observation is that *"the two
escapes that return a hardcoded constant are precisely the two categories whose price was never in
`DATA`. The escapes exist where the data was missing."* The maneuver rung had never been in `DATA` at
all — it was an inline literal inside a tool. Moving it into the dataset is what D1's own reasoning
prescribes, and it is what makes the gate assertion meaningful: the test perturbs `DATA.maneuverBuy`
and watches the quote move, which distinguishes *reads the dataset* from *happens to agree with it*.

## Outstanding

**`repriceDraft()` refunds every `mvbuy` cost.** It re-derives each buy's frozen `cost` as a
`compute().total` delta, and `compute()` does not price `maneuverBuys` — so costs `[4,5,6]` become
`[0,0,0]` while the maneuvers are kept. Reproduced directly on this branch. This is **pre-existing**,
not introduced here, but this decision is what makes `mvbuy` a properly gated priced purchase, so the
inconsistency is now worth closing. CharGen reprices a draft on load, so a Live Sheet character opened
in CharGen and edited silently refunds the AP.

Option **B** above is the real fix and would close it. Until then the gate holds at purchase time and
only a CharGen round-trip can undo it. Tracked as its own task.

## Related

- `decisions/2026/D-GH-2026-08-05-pricing-model.md` — D1, the rule this deliberately does *not* extend.
- `feat/ap-model-reconcile`, `fix/ledger-reconciliation-pass` — where option B belongs.
