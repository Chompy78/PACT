/**
 * PACT — AP-by-level table  (externalized from js/engine.js, feat/ap-by-level)
 * ---------------------------------------------------------------------------
 * The single editable source for the level → AP-budget ladder and the default
 * starting level. `js/engine.js` imports these and surfaces them on DATA
 * (`DATA.apByLevel` / `DATA.defaultAp`, plus the back-compat aliases
 * `DATA.levelAP` / `DATA.level1AP` that predate this file). All three tools read
 * the ladder THROUGH the engine's DATA bridge — never this file directly — so
 * editing a value here changes the default budget and the level options in every
 * tool on the shared engine, with no other code change.
 *
 * Values are the exact integer AP totals previously inlined in DATA; keep them
 * whole numbers. AP-per-level IS mechanics — if you change a value here, bump
 * `DATA.version` and refresh the REV-01 baseline (`testing/expected/`) in the
 * same PR, per docs/VERSION-SYNC.md.
 */

// level → cumulative AP budget at that level (level 1 = a fresh build's default).
export const AP_BY_LEVEL = {
  1: 50,  2: 92,  3: 134, 4: 155, 5: 176, 6: 197, 7: 218, 8: 239, 9: 260, 10: 281,
  11: 302, 12: 323, 13: 344, 14: 365, 15: 386, 16: 407, 17: 428, 18: 449, 19: 470, 20: 491,
};

// The level a fresh CharGen build starts at; DATA.defaultAp = AP_BY_LEVEL[DEFAULT_LEVEL].
export const DEFAULT_LEVEL = 1;
