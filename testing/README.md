# PACT — Testing

## Test harnesses

- **`tests/engine-parity.html`** — regression gate for `js/engine.js`. Run in a browser; expect **20 passed / 0 failed** (check `testing/expected/expected-results.csv`'s row count — don't assume a fixed number). See `docs/HOW-TO-WORK.md` for instructions.
- **`scripts/engine-parity-ci.mjs`** (**REV-11**) — headless Node port of `tests/engine-parity.html`: same
  fixtures, same `expected-results.csv`, same assertions, no browser needed. Runs automatically in CI (see
  `.github/workflows/engine-parity.yml`) on PRs touching `js/engine.js` or `testing/**`; a CLI agent should
  run it directly (`node testing/scripts/engine-parity-ci.mjs`) rather than opening the browser page.
- **`campaign-test.html`** — end-to-end harness for `js/campaign.js` and `js/dm.js` (requires Supabase sign-in).
- **`sync-test.html`** — end-to-end harness for `js/sync.js` (requires Supabase sign-in).
- **`scripts/random-manual-e2e.mjs`** — headless Playwright harness for character generation +
  advancement (a second, complementary REV-11 harness — this one is randomized/UI-driven, `engine-parity-ci.mjs`
  above is fixed-fixture/pure-engine). Drives the real CharGen
  and Live Sheet UI — species/class selects, ability +/- steppers, skill checkboxes, the "Open in Live
  Sheet" / "Open in CharGen" switch buttons, "+ Award AP" / "Level up" / buy-panel tiles — with its own
  randomization; it never calls the app's built-in `randomizeBuild()`. Also drops the finished
  character onto **DM Console**'s real file-drop roster import and cross-checks the rendered row
  (species/class/HP/AC/AP-available) against the source tool's own numbers — DM Console's cloud/
  campaign features (sign-in, award AP, campaign rules) aren't exercised, since they need a live
  Supabase session, not just the CDN stub. **Independent oracle (D-GH-2026-07-13-random-e2e-real-oracle):**
  because all three tools bridge the same `js/engine.js` onto `window`, a check like "the displayed AP
  equals `economy().available`" is self-referential — a bug in `compute()`/`economy()` itself would pass.
  This harness also freshly `import()`s `js/engine.js` into this Node process (a separate module instance
  from the browser's) and, on the real random LOG each iteration generates, cross-checks Node-vs-browser
  agreement, the two engine entry points (`foldBuild()+compute()` vs `rebuildStateFromEvents()`) against
  each other, a hand-written spec-derived spend reconciliation (not calling `economy()`), `compute()`
  purity, an undo/redo round-trip identity, and a ~20-field tool-switch diff. Failures are prefixed
  `[oracle:...]`. Runs automatically in CI (see
  `.github/workflows/character-gen-e2e.yml`) on PRs touching any of the three tools or `js/engine.js`/
  `js/character-store.js`. To run locally:
  ```
  cd testing && npm install && npx playwright install --with-deps chromium
  node scripts/random-manual-e2e.mjs [--iterations N] [--levels N] [--seed N] [--headed] [--keep-open]
  ```
  `testing/package.json` is dev/CI-only tooling — the app itself still needs no npm install.

Fixtures in `fixtures/`; expected engine output in `expected/`.
