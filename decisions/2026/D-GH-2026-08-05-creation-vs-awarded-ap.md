# D-GH-2026-08-05-creation-vs-awarded-ap — starting AP splits into creation AP and awarded AP

Status: Active. UI and derivation shipped 2026-08-05 (PR #363); the consequence for the creation lock's
`noLock` tagging is deliberately **not** built yet — see *Outstanding* below.

## Context

CharGen's AP budget was a single number entered through a **751-option `<select>`** (`numOpts(0,750)`),
which the owner called clunky. Underneath that, the creation lock always measured spend against a flat
`DATA.level1AP` (79) no matter what the character's budget actually was.

That flat threshold is what forced `_buildEventBurst` to tag every event it emits `noLock:true` (D-GH34):
without it, a legitimately high-budget starting character — someone beginning at level 5 with 175 AP —
would trip the lock before they had finished being built. The tagging solved that, and in doing so made
the lock un-fireable for CharGen characters at all, which is the reload-unlock bug filed as
`fix/creation-lock-survives-reload`.

## Options

- **A — keep one number, raise the threshold to match the budget.** Smallest change. But it makes the
  threshold mean "your whole budget", so a level-5 character spends *everything* at creation prices —
  which is wrong: they have, in rules terms, already advanced.
- **B — an explicit "finish character" action.** Clearest for the player, and it sidesteps the arithmetic
  entirely. But people forget to click it, and a character that never finishes creation never leaves
  creation pricing.
- **C — split the number in two** (owner's design, chosen).

## Decision

**Starting AP is two quantities, not one.**

- **Creation AP** — the chosen track's *level-1* figure (Standard 79, Generous 83, Lean 75, prelude 55).
  This is what the creation lock measures against, and creation prices and warnings apply while it is
  being spent.
- **Awarded AP** — everything above that. Treated exactly like AP a DM grants in play: post-creation, so
  it buys at post-lock prices.

The player picks a **building level** and a **budget track**; both numbers derive from the curve
(`total = l1 + inc × (L−1)`, level 0 = `l1 − inc`). A level-5 Standard character starts with 175 AP: 79
creation, 96 awarded. Level 0 needs no special case — its 55 total is below the level-1 figure, so
creation AP clamps to the total and the whole prelude budget is creation spending.

The threshold is written as an **appended** `creationLockConfig` event (D4 — never replaced or moved), so
it persists in the save envelope with no schema change.

## Why

**Because it makes the threshold correct instead of merely bigger.** A character who begins at level 5 has
already advanced; giving them creation pricing across all 175 AP would let them buy their entire build at
the cheapest possible rates. Option A gets the budget right and the *pricing* wrong.

**And because it removes the reason `noLock` exists.** With creation AP always equal to the track's
level-1 figure, the threshold is never wrong for a high-budget character, so the burst no longer needs to
opt every event out of the lock. That is what eventually fixes the reload-unlock bug — not by patching it,
but by deleting its cause.

Two implementation findings are recorded because both cost real time and neither is obvious:

- **The selectors must be inputs only.** A first version repainted them from the budget on every render
  and fought the user's own edit: `render()` runs mid-apply, reads a budget that has not settled, and
  snaps the level back. Measured — level 5 and level 20 both stayed at 79 until the repaint was removed.
- **"Derive the level from the budget" has no unique answer.** Lean level 6 and Standard level 5 both
  total 175 AP. Any code that tries to reverse the mapping is guessing; the budget and the threshold in
  the LOG are the truth, and the selectors are a way of setting them, not a view onto them.

## Outstanding

The `noLock` blanket tagging in `_buildEventBurst` is **still in place**. Removing it is what completes
this decision, but it needs an answer the owner has not given: the burst emits events in a fixed synthetic
order, so with the tagging gone the lock would fall at an arbitrary point in that order rather than where
the player actually crossed the threshold — which is the D-GH34 mispricing the tagging was added to
prevent. Tracked on `fix/creation-lock-survives-reload` and `feat/creation-vs-awarded-ap`.

Until that lands, a CharGen character's lock still does not survive a reload.

## Related

- `decisions/2026/D-GH-2026-08-05-pricing-model.md` — D3 describes the lock trigger this refines.
- D-GH34 — the import-burst `noLock` tagging whose cause this removes.
- `js/advancement.js` — `LEVEL_BUDGET_CURVES`, the source of the three tracks.
