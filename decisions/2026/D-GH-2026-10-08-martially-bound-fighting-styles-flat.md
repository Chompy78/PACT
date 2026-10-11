# D-GH-2026-10-08-martially-bound-fighting-styles-flat — Martially Bound does not discount Fighting Styles

**Status:** DONE on branch `fix/martially-bound-fighting-styles-flat` (PR left open for the owner's merge decision); `DATA.version` bumped **v0.371 → v0.372**. The Players Guide needed no change — it already said this.

## Context

Players Guide §14: "Fighting Styles are not discounted by this — they are priced flat regardless of class." The engine disagreed: a bound Fighter paid 11 AP for `Fighter: Fighting Style` (12 unbound), a bound Ranger or Paladin 12 (13 unbound). Found 2026-10-07 while making Martially Bound discount subclass abilities ([[D-GH-2026-10-07-martially-bound-subclass-discount]]) and filed as a board task for the owner.

## Options

- **A. The guide is right: exempt Fighting Styles in the engine (chosen).** One explicit data flag, `noMB`, read by the one function that applies the discount.
- **B. The engine is right: change the guide sentence.** Rejected by the owner (2026-10-08, "engine should not discount it").
- **C. Exempt by name in the engine** (`/fighting style/i`). Rejected: a rule hidden in a string match. The flag is visible in the data, and the test below can check every copy of it.

## Decision

- `noMB:true` on the four Fighting Style features (`Fighter`, `Paladin`, `Ranger: Fighting Style`; `Fighter: Additional Fighting Style`) and on the two data copies of the one that is also a Champion ability (`subAbilMap` and `subclasses`). The data is held in three places, so all three carry it.
- `_mbAdj(cls, c, item)` in `compute()` returns the price unchanged when `item.noMB`; both callers (the feature loop and `_subPriceOf`) pass the item.
- CharGen's and Live Sheet's Martially Bound wording no longer lists fighting styles among the discounted things, and says they are priced flat.

## Why

- The guide is what players read, and the owner confirmed it. Leaving it would keep a live engine-vs-guide mismatch (the "engine AND the guide" rule in `AGENTS.md`).
- Measured on the live database 2026-10-08 before the change: 55 characters, 4 Martially Bound (all Rogue), 0 Fighting Style purchases in any event log (positive control: the same pattern finds 6 Sneak Attack purchases). Query shape (read-only, run through the Supabase connector): characters with `stats->>'martiallyBound'` set and not `(none)`, grouped by `originClass`; and a count of LOG events whose JSON text matches `Fighting Style`. **No live character's total moves.** Frozen ledgers never move either way.
- Rules version bump: `compute()` output changes for a bound Fighter, Ranger or Paladin who buys a Fighting Style.

## Known limits (from review, left as is)

- The flag lives in three data copies by hand, as the rest of a mirrored ability's data does; the node check asserts all three agree. Deriving them from one source is the unscheduled `refactor/subclass-purchase-unify`.
- The coverage check finds Fighting Styles by name; a differently named style would need the flag added by hand.

## Consequences

- `DATA.version` v0.372; fixtures CG-066 (bound Fighter, flat 12), CG-067 (bound Ranger, flat 13), CG-068 (control: bound Fighter + Action Surge still takes the 1 AP off).
- `subclass-double-purchase-ci.mjs`: the all-192 check expects bound == unbound for a `noMB` ability; 7 new checks (flag present on every Fighting Style in all three copies, flat price for Fighter/Paladin/Ranger/Additional, ordinary-feature control). Mutation-checked: ignoring the flag fails 5 checks.
- The `noMB` flag is an engine-data concept now: a new feature that is to be excluded from Martially Bound is flagged, not special-cased in `engine.js`.
