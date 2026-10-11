# D-GH-2026-10-05-subclass-double-purchase-guard — one subclass ability held through both purchase doors is one purchase

**Status:** DONE on branch `feat/subclass-double-purchase-guard`; `DATA.version` bumped **v0.368 → v0.369** (`compute()` output changes for any build holding the same ability through both doors).

## Context

All 192 subclass abilities are sold twice: as `DATA.subAbilMap["Class|Sub|Name"]` (kept in `b.subAbilities`) and as a mirrored `DATA.features["Class: Name"]` (kept in `b.features`). The two loops in `compute()` deduplicated only within their own collection, and the two pickers each tested ownership against their own collection only. So one ability bought through both was charged twice with no warning. Measured on the live database on 2026-10-05 (all 53 characters): one real case, Anders Pipeleaf (Amble) — `Rogue|Soulknife|Psionic Power / Psychic Blades` at 8 AP through the subclass picker and again at 7 AP (Martially Bound discount) + 100 gp + 21 days through the in-play advancement picker. His history was repaired separately (`D-GH-2026-10-05-anders-double-purchase-repair`); this record is the cause.

## Options

Which copy is charged when both exist (owner decision, 2026-10-05):
- **P1 — the subclass copy.** The door that also feeds subclass-unlock accounting and the class-access check.
- **P2 — the cheaper (feature) copy.** Kinder to the player, but keeps the door that bypasses those checks.
- **P3 — whichever was bought first.** ← chosen

How deep the fix goes:
- **Shallow — detect the duplicate in `compute()` and in the pickers.** ← chosen (this change)
- **Deep — `refactor/subclass-purchase-unify`:** collapse the two purchase paths into one. Still the real cure, but high effort/risk (about 56 references in CharGen, 18 in the Live Sheet, 30 in the engine; 3 of 52 build fixtures buy a subclass ability) and unscheduled. The shallow fix does not obstruct it.

## Decision

P3, shallow. In `js/engine.js`:
- `abilityIdent(key)` — the one shared identity (the mirrored feature label) for either key shape; `ownsAbility(b, key)` — owned through either door.
- `MUT.feature` / `MUT.subabil` stamp the FIRST door used on `b._abilDoor` (an underscore key: derived ordering state, never saved or compared, like `_raceTraitLocked`). A build handed in without it falls back to the FEATURE copy: CharGen's live state is read off two independent page lists (no order), and its save emits every `feature` event before any `subabil` event, so the live view and the saved-then-reloaded log must agree about which copy counts. `_noteDoor` also drops a stamp whose door no longer holds the ability, and credits an older unstamped copy in the other door as first (a base snapshot or legacy `patch` bundle).
- `compute()` detects the same ability in both collections. The later copy costs nothing, raises one `⛔ … duplicate: already owned as …, bought first (this copy is not counted)` warning, and is listed once under "Blocked purchases". If the counted copy is itself Hit-Dice-blocked, the duplicate is not listed a second time or priced a second time.
- `purchaseLegality()` already refuses any new `⛔` warning, so both tools refuse the second purchase with no tool-side rule.
- The Live Sheet's class-feature, cross-class and unlocked-class lists and its subclass list show an ability owned through either door as owned.

## Why

- **First-bought wins, not a fixed door.** A fixed preference would charge a different copy depending on nothing the player did; P3 matches what they would say ("I bought it first"), and EV-030/EV-031 pin both orders.
- **Price and warning only; ownership sets are untouched.** The logical ability is owned through the counted copy, so effects keyed on the feature label still apply exactly once. Marking the duplicate "not owned" would have removed an effect the character legitimately holds.
- **One refusal point.** `purchaseLegality()` is the existing single place both tools ask "may this be bought"; adding a hard warning there reaches CharGen (post-lock) and the Live Sheet with no duplicated rule. CharGen's feature menu is built once at start-up and cannot be marked per character (its own comment says the engine warning is the safety net), so it needs no picker change; before the lock a CharGen draft simply shows the warning.
- **Mutation-checked.** With the guard disabled, 8 of the original 20 checks in `subclass-double-purchase-ci.mjs` fail (including 42 vs 34 AP, the original bug); with the stamp's reset/credit rules and the unstamped fallback put back, 7 of the review-driven checks fail; with the Live Sheet's old ownership tests restored, the "every tile is owned" browser checks fail.
- **Reviewed four ways before merge** (`docs/plans/2026-10-05-subclass-double-purchase-guard-cold-review.md`, raw files in `docs/plans/cold-reviews/`): three free-tier API reviewers (Nemotron 3 Super, Groq gpt-oss-120b, Gemini 3.1 flash-lite) and the repo's own `/code-review high`. The code-review run found the real defects (CharGen save order, base-snapshot stamping, stale stamp, repeated key); the API reviewers were mostly agreement plus one refuted HIGH claim and one false alarm.

## Consequences

- `DATA.version` v0.369; `testing/expected/` gains seven fixtures (CG-053..056, EV-030..032); no existing fixture's output changed (parity 89/0, legality 61,431/0, price-of 6,161/0, the new node gate 33/0).
- A saved log that already holds a duplicate now shows the warning and recomputes cheaper. `economy()` (the frozen ledger) is unaffected. The only live case (Anders) was repaired first, so no live character changes.
- **Latent, pinned by test:** `compute()`'s prerequisite gate reads `b.features` only, while `ownsAbility()` reads both doors. No data row has a feature whose prerequisite is a mirrored subclass ability, so they cannot disagree today; `subclass-double-purchase-ci.mjs` fails the day one is added.
- **Not fixed here:** a subclass key repeated within `b.subAbilities` alone (no feature copy) is still charged twice — the feature loop guards its own repeats (`already bought`), the subclass loop never did. Pre-existing and independent of the two-door problem; filed as a follow-up.
- **Not fixed here:** the Martially Bound discount applies in the feature loop but not the subclass loop — this is why the two copies priced 7 vs 8 AP. Whether it should apply to subclass abilities is an open rules question for the owner.
- **Guide:** no player-facing rule text changed. The guide never said an ability could be bought twice; the engine now refuses what the guide never allowed, so no reconciliation edit was made. Flag if a sentence is wanted under §13/§14.
- **Browser checks not run here:** the Live Sheet cross-class and unlocked-class lists got the same one-line change as the origin-class list but are not exercised by the new browser test (it covers the origin-class and subclass lists).
