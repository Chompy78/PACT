# D-GH-2026-08-18-flat-class-unlock — class unlock becomes a flat 8 AP, and the ladder table is read with a clamp

**Status:** Settled and implemented (`DATA.version` v0.352).

## Context

Unlocking a non-origin class cost **7 × the classes you already own** — a cumulative table
`[0, 7, 21, 42, 70]`. Three separate problems.

**It contradicted the guide's own stated parallel.** §11 says the class unlock *"mirrors how subclasses
are bought."* The guide's actual subclass rule is: *"every subclass beyond your first costs a **flat 15
AP** to open, **however many you already have**"* — flat, and explicitly non-escalating. The engine
escalated where the published parallel deliberately does not.

**It contradicted §1's pitch.** PACT sells itself on *"any feature from any of the twelve classes is on
the menu, so a holy duellist or a spell-slinging scout is just a shopping list, not a multiclass
puzzle"*, and *"your character grows in the direction you steer it, one purchase at a time."* A price
that depends on what you already own is a puzzle, and one that depends on when you bought it penalises
steering as you go.

**The table had five rungs for twelve classes, read with `|| 0`.** Indexing past the end returned
`undefined`, which `|| 0` turned into *free*: a **fifth** unlock deleted the whole class-access line and
refunded the 70 AP paid for the first four. With a second origin class the cliff came a rung earlier and
the charge went **negative**. Reachable in four clicks, and only reachable at all because the unlock
checkbox was fixed earlier the same day.

## Options

- **A1 — Keep 7N, extend the table, clamp.** Fixes the refund; leaves the guide contradicting itself and
  the 4th unlock unreachable (measured: never pays for itself within 12 purchases).
- **A2 — Capped ladder** (7N clamped at 14). Best measured abuse figure, tied with 7N; keeps escalation.
  Rejected on fit: escalation is the thing both §11 and §1 argue against.
- **A3 — Flat.** Chosen at **8 AP**.
- **A4 — Tie the price to the character's tier** (`7 + tier`). Measured as the *most* restrictive model
  once the simulator was corrected, and cheap to calculate. Rejected on fit, not on numbers: it is a
  "commit early or pay more" rule, which is what §1's *"grows in the direction you steer it"* rejects.

## Decision

**Flat 8 AP per unlocked class**, and `DATA.unlockCum` extended to 13 rungs read through a **clamp**
rather than `|| 0`.

## Why

Flat is what the guide already says twice — once for subclasses explicitly, once for classes by the
parallel §11 draws. Choosing it makes §11 true rather than aspirational, and removes the only price in
PACT's access rules that carries state.

The clamp matters independently of the number. `|| 0` converts a programming error — indexing past a
table — into *"this is free"*. A clamp under-charges at worst; `|| 0` paid the player 70 AP.

**Eight rather than seven or ten** keeps the first unlock within 1 AP of today's, so nothing already
built moves much, while sitting above the old first rung so flattening does not simply make everything
cheaper.

## Status / verification

- `CG-018` pins the fifth unlock at **40 AP** — the rung that used to refund 70. It also pins flatness:
  5 × 8, not an escalating sum.
- `CG-012`/`CG-013` moved +1 each (their single unlock, 7 → 8). Parity 36 → **37**.
- `tool-pricing-ci`'s two unlock checks now read the expected figure from `DATA.unlockCum` instead of a
  hardcoded 7, so a future price change cannot leave them asserting a stale number.
- Guide updated at **twelve** sites: seven statements of the formula, and five figures inside worked
  examples.

## The gap this exposed

Three worked examples silently stopped adding up — their unlock line item, running total, stated budget
and "Total x / y" row all had to move by 1 — and **no gate caught it**. `guide-price-check` verifies
feature prices against the engine and passed throughout. `AGENTS.md` already records that worked-example
*line items* are unverified and only running totals are checked; this is the first time that gap has bitten
a real change. A build-replay check that re-prices each worked example through `compute()` would have
caught all three, and is worth building before the next pricing change.
