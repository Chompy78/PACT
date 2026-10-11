# D-GH-2026-10-07-martially-bound-subclass-discount — Martially Bound discounts subclass abilities of the bound class

**Status:** DONE on branch `fix/martially-bound-subclass-discount`; `DATA.version` bumped **v0.370 → v0.371**; Players Guide §14 sentence clarified in both guide files.

## Context

Martially Bound (+2 AP, a gain) lets a character pick one class they can access; the Players Guide (§14) says "from then on every non-spell purchase that class trains you in costs 1 AP less (floor 1 each): the class's own features. Fighting Styles are not discounted … Feats and spellcasting are never touched." The engine applied that to `DATA.features` entries of the bound class (the feature loop in `compute()`) but not to subclass abilities (the subclass loop), although every subclass ability is also sold as a mirrored feature. So the same ability cost 1 AP less through the class-feature picker than through the subclass picker — the 7-vs-8 AP gap that surfaced when one character bought one ability through both pickers (`D-GH-2026-10-05-anders-double-purchase-repair`). The question was filed as a rules decision on 2026-10-05; the owner decided **yes** on 2026-10-07.

## Options

- **Yes: the subclass door takes the same -1.** ← chosen. Matches the guide's wording ("every non-spell purchase that class trains you in"), and makes the two doors price one ability identically.
- No: remove the discount from the feature door's mirrored copies, or document the difference as deliberate. Rejected: it would contradict the guide and take a discount away from every Martially Bound character who bought a subclass ability as a feature.

## Decision

`_subPriceOf(a)` (the one price helper for the subclass door, introduced by `D-GH-2026-10-05-subclass-double-purchase-guard`) applies `Math.max(1, c - 1)` when `a.cls` is the bound class. Spells are untouched (spell bundles are not priced through it). The feature door is unchanged. The guide's sentence now reads "the class's own features and its subclass abilities" (it already said "every non-spell purchase", this removes the ambiguity), edited identically in the `pact-guide` master and the served copy.

## Why

- **The guide already promised it.** The engine was short of the guide, not the other way round.
- **One price per ability.** With one helper and one rule, a node gate asserts for all 192 abilities that the bound price is `max(1, unbound - 1)` and identical through both doors, and that the unbound doors agree too — so the pair can never drift again.
- **Measured blast radius (2026-10-07, live):** exactly one character is Martially Bound and holds a subclass ability of the bound class — one ability, frozen at 8 AP in a sealed ledger. Its recomputed price becomes 7; the frozen ledger (`economy()`, what "AP left" shows) is unchanged, so nothing the player sees moves. A dated snapshot, not a fact — re-measure before relying on it.

## Consequences

- `DATA.version` v0.371; fixtures CG-062 (subclass door, 21), CG-063 (feature door, 21), CG-064 (both doors, counted once at 21), CG-065 (an unlocked class, 54); 5 new checks in `subclass-double-purchase-ci.mjs`.
- A Martially Bound character's *recomputed* totals fall by 1 AP per subclass ability of the bound class; frozen ledgers do not move.
- **Found, not changed — Fighting Styles.** The engine discounts `Fighter: Fighting Style` by 1 AP for a Martially Bound Fighter (a probe: 50 → 47 with the 2 AP gain), but the guide says Fighting Styles are "priced flat regardless of class". An existing engine-vs-guide mismatch, independent of this change; filed as a board task for the owner (fix the engine or change the guide). **Resolved 2026-10-08:** the owner chose the engine fix — see [[D-GH-2026-10-08-martially-bound-fighting-styles-flat]].
- Not changed: whether the 15 AP "open another subclass" unlock is a "purchase the class trains you in"; the guide does not say, and no discount was added.
- `verify-guide.mjs` is red at baseline (`feature prices`, pre-existing, see the board task); before and after this edit it reports the identical failure and the other 10 checks pass.
