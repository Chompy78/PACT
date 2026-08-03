/**
 * PACT — level → AP-budget ladder  (externalized from js/engine.js, feat/ap-by-level)
 * ---------------------------------------------------------------------------
 * DERIVED, not hand-typed. The ladder is generated from the STANDARD level-budget
 * curve in `js/advancement.js` (`LEVEL_BUDGET_CURVES.standard`), so the engine's fixed
 * default ladder and the DM-facing "Standard" campaign preset cannot drift apart —
 * they are literally the same two numbers (`l1`, `inc`).
 *
 * `js/engine.js` imports these and surfaces them on DATA (`DATA.apByLevel` /
 * `DATA.defaultAp`, plus the back-compat aliases `DATA.levelAP` / `DATA.level1AP` that
 * predate this file). All three tools read the ladder THROUGH the engine's DATA bridge
 * — never this file directly — so editing the standard curve changes the default budget
 * and the level options in every tool on the shared engine, with no other code change.
 *
 * WHAT THIS CURVE IS — and the two it is not. PACT has three different AP numbers and
 * conflating them is a documented trap (see D-GH-2026-07-14-advancement-tracks):
 *   * BUDGET curve (this file) — cumulative AP a COMPLETE level-N build is expected to
 *     have SPENT. Players Guide: "Starting AP budget / track chosen (Level 1 = 79
 *     standard or 83 generous; optional Level 0 prelude = 55)."
 *   * AWARD PACE — AP granted per SESSION (`AWARD_PACES`, default ~7). The Guide is
 *     explicit that "PACT's default is to award AP by the session, not by the level."
 *     There is no AP-earned-per-level schedule in the rules at all.
 *   * The PREGEN ROSTER — the twenty sample Emberwatch characters in the Guide's
 *     appendix, running "from a 1st-level recruit (50 AP) to a 20th-level archmage
 *     (491 AP)". A cast list, not a curve.
 * Until fix/ap-budget-curve-standard (2026-08-03) this table held that roster's totals
 * hand-typed as a ladder — 50, 92, 134, then a flat +21/level — which is why
 * `DATA.level1AP` (the creation lock's fallback threshold, and CharGen's default
 * starting budget) read 50 when a complete level-1 build is 79.
 *
 * Values stay whole numbers. AP-per-level IS mechanics — changing `l1`/`inc` on the
 * STANDARD curve moves this ladder, so bump `DATA.version` and refresh the REV-01
 * baseline (`testing/expected/`) in the same PR, per docs/VERSION-SYNC.md.
 */

import { LEVEL_BUDGET_CURVES } from './advancement.js';

/* budgetLadder(curve): expand a {l1, inc} budget curve into a level → cumulative-AP table.
   Cumulative AP at level N = l1 + inc × (N − 1), the same formula the tools' tuned
   trackLevel() already uses, so a tuned campaign curve and this fixed ladder agree by
   construction rather than by coincidence.

   Levels run 0..20. Level 0 is the Guide's optional apprentice/prelude tier and needs no
   special case — it falls straight out of the formula at N=0, and both presets land on the
   Guide's stated 55 (79 − 24 = 55 standard; 83 − 28 = 55 generous). Callers that scan for a
   level (`levelForThreshold` in js/ui-helpers.js) deliberately scan 1..20 and never read
   key 0, so adding it changes no level label. */
export function budgetLadder(curve) {
  const l1 = Number(curve && curve.l1), inc = Number(curve && curve.inc);
  if (!Number.isFinite(l1) || !Number.isFinite(inc)) {
    throw new Error('budgetLadder: curve must be {l1:number, inc:number}');
  }
  const table = {};
  for (let L = 0; L <= 20; L++) table[L] = l1 + inc * (L - 1);
  return table;
}

// level → cumulative AP budget at that level (level 1 = a fresh build's default).
// Standard: 0:55, 1:79, 2:103 … 20:535.
export const AP_BY_LEVEL = budgetLadder(LEVEL_BUDGET_CURVES.standard);

// The "Generous" preset's ladder — 0:55, 1:83, 2:111 … 20:615. Exported for completeness
// and so both presets expand through the one code path; the engine's fixed default stays
// STANDARD. A campaign that picks Generous carries it as `rules.levelBudgetCurve` and gets
// it applied per-character (see creationLockThreshold() in js/engine.js and the tools'
// trackLevel()), not by swapping this module-level default.
export const AP_BY_LEVEL_GENEROUS = budgetLadder(LEVEL_BUDGET_CURVES.generous);

// The level a fresh CharGen build starts at; DATA.defaultAp = AP_BY_LEVEL[DEFAULT_LEVEL].
export const DEFAULT_LEVEL = 1;
