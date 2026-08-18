# D-GH-2026-08-17-subclass-features-mirror — Every subclass ability has two purchase routes with separate dedup domains; the same ability can be bought twice, and removing the mirror is deferred rather than rushed

**Status:** Identified and measured. **Not fixed** — deferred to `refactor/subclass-purchase-unify`
(NEXT board). No `DATA.version` change.

## Context

All **192** subclass abilities are stored twice at the same price:

- `DATA.subAbilMap["Class|Subclass|Name"]` — reached via `b.subAbilities`, rendered by CharGen's
  *subclass* picker.
- `DATA.features["Class: Name"]` — reached via `b.features`, and **188 of them are in `featureList`**,
  so CharGen's *feature* picker offers them too.

Nothing in `DECISIONS.md` or `decisions/2026/` explains why the mirror exists. It is systematic, not
accidental-looking, and `subAbilMap` agrees with `subclasses` everywhere (0 drift across all 192).

## The three defects it causes

Measured against `compute()`, not inferred:

1. **Double-charge, silently.** Buying `Druid: Star Map` as a feature *and* as a subclass ability
   charges **4 + 4 = 8** with no warning. The dup guard at `engine.js:291` counts occurrences within
   `b.features` only (`fcount[lab]`), so it structurally cannot see the other route.
2. **Skips subclass-unlock accounting.** The features route never registers the subclass in `subUsed`,
   so it never consumes the class's one-free-subclass slot and never triggers the 15 AP unlock for a
   second subclass.
3. **Bypasses the v0.347 class-access gate**, which loops over `subUsed`. Same item, same price, one
   route warns and the other is silent.

## Options

- **AD1 — fold it into the pending gating review.** Done: it materially changes that question.
- **AD2 — extend the gate to cover mirrored subclass abilities bought as features.** Narrow, leaves the
  double-charge.
- **AD3 — remove the 192 mirrored entries from `DATA.features`/`featureList` entirely.** One item, one
  route; the double-charge dies by construction.
- **AE3 — AD3 *plus* folding spell bundles into the same path**, so everything a subclass sells is one
  mechanism. ← the owner's choice

## Decision

**AE3 is the agreed direction, but only its pricing half shipped** (as
`D-GH-2026-08-17-bundle-three-tier-pricing`, v0.350). The structural half is **filed, not attempted**.

## Why deferred rather than done

Three things make it more than one implementation cycle, and getting any of them wrong is expensive:

- **The LOG format.** `b.subSpellBundles` is a distinct field written by both tools and stored in saved
  characters. Unifying means either keeping it (so the unification is pricing-only) or migrating entries
  into `b.subAbilities` — which breaks every existing saved character. That is a decision, not a
  refactor step.
- **Circle of the Land.** Four terrain bundles keyed `Class|Sub|Terrain` against one engine
  `spellBundle`. `subAbilMap`'s key shape is `Class|Sub|Name`, with no room for the terrain. Each must
  stay separately buyable and each must still cost the 15 AP Subclass Unlock beyond the first.
- **No gate covers the pickers.** `engine-parity` and `tool-pricing-ci` catch price drift; nothing
  catches a broken picker or a LOG that no longer round-trips.

Rushing this while the author's context was already deep in a long session is exactly the failure the
project's cold-plan-review trigger exists to prevent: *a wrong approach costing more than one
implementation cycle to undo.*

## Note for whoever picks it up

Step 1 of the filed task is a **pre-flight with no code change**: establish whether the
`DATA.features` mirror is load-bearing for anything before deleting it. If nothing depends on it,
removal is a deletion. If something does, that dependency **is** the task.
