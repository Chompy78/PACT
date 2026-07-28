# D-GH-2026-07-13-random-e2e-real-oracle — Give the random e2e harness a genuinely independent oracle

Status: Active

- **Context:** `testing/scripts/random-manual-e2e.mjs` drives real UI clicks and checks invariants like
  "the displayed AP equals `economy().available`." All three tools bridge the SAME `js/engine.js` onto
  `window` (D-GH26/D-GH36/D-GH37), so that class of check is **self-referential**: if `compute()` or
  `economy()` itself is wrong, every UI surface reads the display, `economy()`, and the buy panel from
  the same wrong number and agrees with itself. The harness could not have caught either real bug found
  earlier this session (the empty-cloud-save bug, CharGen's randomize-ignoring-DM-AP bug) — both were
  found by `/code-review`, not this tool.
- **Options:** (A1) leave it as a DOM-consistency smoke test only. (A2) give it a genuinely independent
  oracle: a **second, freshly-imported instance of the same `js/engine.js`**, running in this Node
  process (separate from the browser's long-lived module instance), fed the browser's real
  randomly-generated LOG each iteration, cross-checked against both the browser AND against a
  hand-written, spec-derived reimplementation of the spend-accounting rule. (A3) port the engine to a
  second language/implementation for true implementation-diversity — rejected as wildly disproportionate
  to the payoff for a single-repo hobby-scale tool.
- **Decision:** **A2.** `js/engine.js` is already documented as "no Node APIs, no require(), no npm" —
  it Node-imports cleanly with zero changes, so this cost one `import()` call, not a new build/bundling
  step.
- **Why this actually catches more, concretely:** four checks, each targeting a DIFFERENT failure mode a
  self-check can't see: **(1)** Node-vs-browser agreement (`economy()`/`compute(foldBuild())` computed in
  a fresh Node import vs the browser, same LOG) — catches state that leaked into the browser's long-lived
  module instance across purchases. **(2)** dual-entry-point agreement — `foldBuild()+compute()` vs
  `rebuildStateFromEvents()`, the engine's two documented ways to replay a LOG, must agree with each
  other (both computed in the same Node process, isolating this from (1)). **(3)** spec-independent spend
  reconciliation — a LOG-cost summation hand-written from the engine's documented behaviour, never
  calling `economy()`/`_spendCost()` — the ONE check that can catch a bug in `economy()`'s own
  categorization logic, since (1) and (2) would both reproduce that bug identically (they call the same
  function). **(4)** `compute()` purity (same input twice → same output; input untouched) — catches a
  hidden shared-mutation bug.
- **Verified with two positive controls, not just "it ran green":** temporarily injected a `_spendCost()`
  doubling bug — caught immediately and precisely by check (3) (`independently-summed LOG
  cost=49 vs economy().spent=98`), before any downstream symptom (negative AP) even had a chance to fire,
  correctly localizing the fault. Temporarily injected a `redo()` drop bug — caught immediately by the
  new undo/redo round-trip check (previously zero coverage of undo/redo at all). Both reverted; the real
  app then ran clean (0 false positives) across ~10 further iterations. `git blame`-visible in the PR, not
  just asserted in this entry.
- **A real bug found while BUILDING this** (not the app, the test): the first draft of the
  Node-vs-browser check called `window.economy(LOG)` uniformly on both tools. Live Sheet shadows
  `window.economy` with its own classic-script, **index**-based wrapper (`economy(uptoIdx)`, for its
  time-travel/scrub UI — see AGENTS.md) — passing an array where that wrapper expects an index silently
  produced an empty replay, reading `spent=0` regardless of the real LOG. CharGen has no such shadow
  (`window.economy` there IS the raw engine function — AGENTS.md: "CharGen calls the engine's
  array-parameter API directly"). Fixed by resolving the raw array-parameter function explicitly per
  tool (`window._engineFold` on Live Sheet, `window` directly on CharGen) — a small, useful lesson: even
  a "fresh, independent" oracle inherits bugs from HOW you wire it into the thing under test, and needs
  its own positive-control verification, not just "it compiles and the happy path is green."
- **Status:** **In force.** `js/engine.js` was not touched by this change (test-only); `DATA.version`
  unaffected. `testing/tests/engine-parity.html`/CI parity gate unaffected (separate mechanism, static
  fixtures — this is a live-random-LOG oracle, not a replacement for it).
