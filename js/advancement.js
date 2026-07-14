/**
 * PACT — Campaign advancement dials  (display/config-only reference tables)
 * ---------------------------------------------------------------------------
 * Three independent per-campaign dials a DM can tune, surfaced on the engine's
 * DATA bridge (`DATA.levelBudgetCurves`, `DATA.awardPaces`, `DATA.startingTierRatios`)
 * so all three tools read them the same way they read the rest of DATA.
 *
 * These are DISPLAY / CONFIGURATION reference data ONLY — never read by
 * `compute()`'s pricing math or by `_replay()`. Adding or editing a value here
 * is NOT a mechanics change: do NOT bump `DATA.version` or touch the REV-01
 * baseline for edits confined to this file. (Contrast `js/ap-by-level.js`, whose
 * `AP_BY_LEVEL` IS read by `compute()`'s creation-lock via `DATA.level1AP` — that
 * file's values are mechanics and this file deliberately does not touch it.)
 *
 * The DM's chosen values live per-campaign in the `campaigns.rules` JSONB
 * (`rules.levelBudgetCurve` / `rules.awardPace` / `rules.startingTier`); the
 * tables below are the preset defaults those pickers offer.
 */

// Level budget curve presets — how much cumulative AP a level "costs" to build.
// Cumulative AP at level N = l1 + inc × (N-1). Standard L20 = 535, Generous = 615.
// Per PACT Players Guide v0.332 §3/§18. Display-only: this does NOT change any
// actual purchase price — it only tunes the "track level" progress label a player
// sees on the Live Sheet against their own AP spent.
export const LEVEL_BUDGET_CURVES = {
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
