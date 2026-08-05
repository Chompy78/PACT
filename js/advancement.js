/**
 * PACT — Campaign advancement dials  (display/config-only reference tables)
 * ---------------------------------------------------------------------------
 * Three independent per-campaign dials a DM can tune, surfaced on the engine's
 * DATA bridge (`DATA.levelBudgetCurves`, `DATA.awardPaces`, `DATA.startingTierRatios`)
 * so all three tools read them the same way they read the rest of DATA.
 *
 * MOSTLY display/configuration reference data — with ONE mechanics exception, added
 * by fix/ap-budget-curve-standard (2026-08-03). `LEVEL_BUDGET_CURVES.standard` is now
 * the source `js/ap-by-level.js` expands into `AP_BY_LEVEL`, which reaches `compute()`
 * and `_replay()` as `DATA.level1AP` (the creation lock's fallback threshold) and
 * `DATA.defaultAp` (a fresh build's starting budget). So:
 *   * editing `LEVEL_BUDGET_CURVES.standard` IS a mechanics change — bump `DATA.version`
 *     and refresh the REV-01 baseline (`testing/expected/`) in the same PR;
 *   * editing anything else here (`generous`, `AWARD_PACES`, `STARTING_TIER_RATIOS`) is
 *     NOT — do not bump `DATA.version` for those.
 * The dependency runs advancement.js → ap-by-level.js → engine.js, one way only; never
 * import ap-by-level.js from here.
 *
 * The DM's chosen values live per-campaign in the `campaigns.rules` JSONB
 * (`rules.levelBudgetCurve` / `rules.awardPace` / `rules.startingTier`); the
 * tables below are the preset defaults those pickers offer.
 */

// Level budget curve presets — how much cumulative AP a level "costs" to build.
// Cumulative AP at level N = l1 + inc × (N-1). Lean L20 = 455, Standard = 535, Generous = 615;
// at N=0 all three give 55, the Guide's optional Level 0 prelude tier. That shared level-0
// figure is the design property a new curve must satisfy — it falls out of the formula rather
// than being special-cased, so a curve whose l1 − inc ≠ 55 would silently disagree with the
// Guide's prelude tier.
// PROVENANCE DIFFERS, and matters when reconciling against the rules text:
//   * `standard` and `generous` are the Guide's own two tracks — PACT Players Guide v0.332
//     §3/§18 ("Level 1 = 79 standard or 83 generous; optional Level 0 prelude = 55"), and §3
//     states the increments and endpoints separately (24/+535, 28/+615) as a cross-check.
//   * `lean` (2026-08-05) is a HOUSE addition, not in the Guide. Same concept, tighter budget,
//     for tables wanting characters a little short of a complete build for their level.
// `standard` is ALSO the engine's fixed default ladder (js/ap-by-level.js expands it
// into AP_BY_LEVEL → DATA.level1AP / DATA.defaultAp) — see the mechanics note in this
// file's header before editing it. `generous` and `lean` remain per-campaign presets only:
// picking it tunes the Live Sheet's "track level" label and a character's
// creationLockConfig threshold, never a purchase price.
export const LEVEL_BUDGET_CURVES = {
  lean:     { l1: 75, inc: 20 },   // L20 = 75 + 19×20 = 455
  standard: { l1: 79, inc: 24 },   // L20 = 79 + 19×24 = 535
  generous: { l1: 83, inc: 28 },   // L20 = 83 + 19×28 = 615
};

// Award pace presets — the DM's documented baseline AP-per-session rate. Purely a
// reference number for the DM; nothing auto-grants AP (the DM still awards it via
// the existing "+ Award AP" button).
export const AWARD_PACES = {
  slow:    { apPerSession: 5 },
  average: { apPerSession: 7 },
  fast:    { apPerSession: 10 },
};

// Starting tier presets — a multiplier of the campaign's tuned level-1 budget,
// used to pre-fill the "starting budget" field when a DM generates a new-player
// invite. Prelude ≈ the guide's optional apprentice tier.
export const STARTING_TIER_RATIOS = {
  prelude:   0.7,
  standard:  1.0,
  veteran:   1.3,
  legendary: 1.6,
};
