# D-GH-2026-10-05-subability-prereq — Circle Forms requires base Wild Shape (subclass abilities can carry a prerequisite)

**Status:** DONE — code merged (PR #588, `DATA.version` v0.370) and the Players Guide row landed 2026-10-06 (master + served copy; see *Guide*).

## Context

Circle Forms (Circle of the Moon, T3 Passive) improves Wild Shape — its source text raises the form CR cap and the temporary HP and sets the AC of a Wild Shape form — yet it could be bought without owning Wild Shape. `compute()` enforced `prereq` for ordinary features (`DATA.features[label].prereq`), but the subclass-ability loop applied only the Hit-Dice gate and no subclass ability carried a `prereq`. Circle Forms is sold through two doors (`b.subAbilities` and a mirrored `b.features` entry), and the live data stores it under the subclass key (`Druid|Circle of the Moon|Circle Forms`), so a prerequisite on the feature copy alone would have guarded nothing the real characters use.

Measured on the live database on 2026-10-05 (re-measure before relying on it): exactly one character (plus its DM copy) owns Circle Forms, and it owns **base** Wild Shape but **not** the first Capability step ("6 forms, CR 1/2").

## Options

Which prerequisite:
- **Base Wild Shape only.** ← chosen. Blocks nobody who exists.
- **Base Wild Shape + the "6 forms" step.** Closer to a bundle, but would block the one live owner (a campaign-bound character) on a locked history.

Where to enforce it:
- **Both doors, one gate.** ← chosen: the subclass loop gets the same prerequisite gate as the feature loop (shared wording, Hit Dice first), and the data carries it in all three copies (`DATA.features`, `DATA.subAbilMap`, `DATA.subclasses…abilities`).
- Feature copy only — rejected, guards nothing the live data uses.

Considered and set aside by the owner (2026-10-05, option I3): changing what Circle Forms *does* (its source text sets max CR = level/3, which overrides the paid Capability track). Accepted as-is; only the dependency is added here.

## Decision

Add `"prereq":["Druid: Wild Shape"]` to Circle Forms in all three data copies, and give the subclass loop in `compute()` a `_subWhy(a)` helper that applies the Hit-Dice gate and then the prerequisite gate, in the feature loop's own wording, joined with " & " when both fail. A prerequisite is satisfied only if it is owned **and not itself blocked** (read from `_ownedFeatSet` / `_blockedFeat`, exactly as the feature loop does). The duplicate guard from `D-GH-2026-10-05-subclass-double-purchase-guard` uses the same helper, so a prerequisite-blocked counted copy is treated as blocked there too. `purchaseLegality()` already refuses any new `⛔` warning, so both tools refuse the purchase; the Live Sheet already shows the refusal reason on the tile (verified in a real browser), so no picker code changed.

## Why

- **Both doors, one wording.** `"a rule that guards one of two doors teaches players the wrong thing about the door it does not guard"` (the repo's own §11 comment). CG-057 (subclass door) and CG-059 (feature door) produce the identical warning, and the node gate asserts it.
- **Nothing existing moves.** With Wild Shape owned the prerequisite changes neither price nor warnings: the node gate compares a build against the same build with the prerequisite stripped from all three data copies (equal), and EV-033 buys Circle Forms *before* Wild Shape and ends at the normal price (the gate reads the final owned set, never purchase order).
- **Mutation-checked.** With the prerequisite part of `_subWhy` removed, the "subclass door refused" and "both doors give the identical refusal" checks fail.

## Consequences

- `DATA.version` v0.370; `testing/expected/` gains six fixtures (CG-057..061, EV-033); nothing existing changed (parity 95/0, legality 61,431/0, price-of 6,161/0).
- A character who somehow holds Circle Forms without Wild Shape now shows it as blocked (costs nothing, listed under Blocked purchases) the next time the engine recomputes it; frozen ledgers (`economy()`) are unaffected. None exists today.
- The three data copies must stay in step; the node gate fails if they drift, and it also fails if a prerequisite names something that is not a feature.
- **Latent, still pinned by test from the previous change:** `compute()`'s prerequisite gate reads `b.features` only, so a prerequisite must be an ordinary feature (Wild Shape is). A subclass ability as a prerequisite of another would need `ownsAbility()`; the test fails the day one is added.

## Guide

A mechanics change is not finished until the engine and the Players Guide both land it. Landed 2026-10-06: the Druid / Circle of the Moon row's last cell changed from `Buy` to `Buy (needs Wild Shape)` in **both** the `pact-guide` master (through the home-server connector, which backs the old file up first) and this repo's served copy, as the same one-cell edit in each rather than a file copy (a plain copy would destroy the served copy's presentation-only additions). The Wild Shape row needed no change.

`node testing/scripts/verify-guide.mjs` before and after: **identical** — 1 of 11 checks fail (`feature prices`: ambiguous=6, unparsed-price=11, price-mismatch=1, stepped-feature=3), the other 10 pass. That check was already red at `5104a7c`, before any of the 2026-10-05 changes, and after each of them, so it is a pre-existing guide-vs-engine drift, not something this edit caused or fixed. The `documents-rules:` marker was deliberately not refreshed (it asserts a whole-guide reconciliation and is stamped by `pact-guide`'s own tool).

## Review

Reviewed before merge by three free-tier API reviewers (Groq returned 503, so two answered) and `/code-review high`; raw files in `docs/plans/cold-reviews/` (dated 2026-10-05, slug `subability-prereq`). The API reviewers agreed with the design and added one valid gap (a prerequisite that is itself blocked, and a multi-entry prerequisite list, were untested), now covered by the node gate. Triage of the ten code-review findings:

| # | Finding | Verdict | Action |
|---|---|---|---|
| 1 | Blast radius not measured | Measured 2026-10-05: one live character owns Circle Forms and has base Wild Shape | Recorded in *Context*; **re-measure before merging** (`select … where stats::text like '%Circle of the Moon|Circle Forms%'`), because the figure is a dated snapshot |
| 2 | No guide / changelog / decision / board | Timing artefact (review ran before they were written), except the guide | Guide row landed 2026-10-06 (see *Guide*) |
| 3 | A per-door gate beside the feature loop's own logic | Defer | Deep fix is `refactor/subclass-purchase-unify` (already on the board); `_subWhy` copies the feature loop's wording and the node gate asserts both doors give identical text |
| 4 | Prerequisite reads `b.features` only | Latent | Pinned: a test fails if any feature names a mirrored subclass ability as a prerequisite |
| 5, 9 | The tile stays clickable with an amber note; CharGen's pickers do not pre-block it | Defer (UX) | Same behaviour as every other prerequisite-blocked feature today (only invocations flash in CharGen); post-lock the purchase is refused by `purchaseLegality`. Follow-up task: pre-grey prerequisite-blocked tiles in both tools |
| 6 | `_inertNote` checks direct prerequisites only | Negligible | Wild Shape (T2) needs fewer Hit Dice than Circle Forms (T3), so a blocked-prerequisite chain cannot occur here |
| 7 | A string-building helper used as a boolean | Cosmetic | Left |
| 8 | E2E text truncated at 120 characters | Accept | Widened to 400 |
| 10 | EV-033 froze Circle Forms at cost 0 | Accept | Event cost set to the real 9 AP |
