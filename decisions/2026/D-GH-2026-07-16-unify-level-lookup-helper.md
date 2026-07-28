# D-GH-2026-07-16-unify-level-lookup-helper — one shared scan in ui-helpers.js, threshold source passed in

Status: Active

- **Context:** the same "highest level L in 1..20 whose per-level threshold ≤ value" loop existed in three
  places — CharGen's `apLevel` (fixed `DATA.levelAP` ladder), and Live Sheet's + DM Console's `trackLevel`
  (tuned `l1+inc*(L-1)` curve; DM Console's added in D-GH-2026-07-15-dm-console-roster-tuned-curve, which
  deliberately left the extraction to *this* task). The roadmap said "4"; post-that-fix the live count is 3.
- **Options — where the shared scan lives:** (A) `js/engine.js`, exported + bridged; (B) a new small `js/`
  module; (C) the existing `js/ui-helpers.js` shared plain-script. **Options — CharGen:** (1) fold its
  fixed-ladder `apLevel` into the same shared thing; (2) keep it wholly separate.
- **Decision:** C + 1-at-the-loop-only. Added `levelForThreshold(value, thresholdAt)` to `js/ui-helpers.js`;
  each tool's `apLevel`/`trackLevel` became a thin wrapper passing its own `thresholdAt` (CharGen → the
  `DATA.levelAP` entry; Live Sheet/DM Console → `l1+inc*(L-1)`). Names/signatures/call sites unchanged;
  `_levelCurve()` curve-resolution left tool-local.
- **Why:** (C over A) D-GH-2026-07-14-shared-ui-helpers already established `ui-helpers.js` as the home for
  cross-tool *pure* helpers, and the scan is display-only — AGENTS.md says touch `js/engine.js` only when a
  task targets the engine, so keeping its API fixed is the lower-risk, precedent-matching choice; the scan
  also has no engine dependency (the threshold source is injected). (C over B) a whole new module for one
  4-line function is more bridge/wiring surface than reusing the script all three tools already load.
  (1-at-loop-only) CharGen's fixed-ladder tiering is a *legitimately different concept* from the tunable
  advancement curve (the task flagged this) — sharing the *loop* doesn't conflate them, because the
  concept-specific part (which threshold) stays at each call site. `_levelCurve()` differs per tool by how
  it *resolves* the curve (Live Sheet `resolveRules()` vs DM Console LOG snapshot) — merging that would drag
  in auth/campaign resolution, out of scope; only the scan was duplicated identically, so only it moved.
- **Verification:** 147/147 old-vs-new equivalence in Node across edge cases (negatives, 0, NaN, null,
  strings, boundaries) for the fixed ladder and 6 tuned curves incl. `inc=1`; browser-confirmed the shared
  global resolves and returns correct levels in all three tools (CharGen over http with real bridged
  `DATA`, 0 mismatches / 0 page errors); parity 20/0. Display-only — no `DATA.version` bump.
- **Status:** In force.
