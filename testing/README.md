# PACT — Testing

## Test harnesses

- **`tests/engine-parity.html`** — regression gate for `js/engine.js`. Run in a browser; expect **20 passed / 0 failed** (check `testing/expected/expected-results.csv`'s row count — don't assume a fixed number). See `docs/HOW-TO-WORK.md` for instructions.
- **`campaign-test.html`** — end-to-end harness for `js/campaign.js` and `js/dm.js` (requires Supabase sign-in).
- **`sync-test.html`** — end-to-end harness for `js/sync.js` (requires Supabase sign-in).
- **`scripts/random-manual-e2e.mjs`** — headless Playwright harness for character generation +
  advancement (progress on **REV-11**, the "no headless runner yet" gap). Drives the real CharGen
  and Live Sheet UI — species/class selects, ability +/- steppers, skill checkboxes, the "Open in Live
  Sheet" / "Open in CharGen" switch buttons, "+ Award AP" / "Level up" / buy-panel tiles — with its own
  randomization; it never calls the app's built-in `randomizeBuild()`. Also drops the finished
  character onto **DM Console**'s real file-drop roster import and cross-checks the rendered row
  (species/class/HP/AC/AP-available) against the source tool's own numbers — DM Console's cloud/
  campaign features (sign-in, award AP, campaign rules) aren't exercised, since they need a live
  Supabase session, not just the CDN stub. Runs automatically in CI (see
  `.github/workflows/character-gen-e2e.yml`) on PRs touching any of the three tools or `js/engine.js`/
  `js/character-store.js`. To run locally:
  ```
  cd testing && npm install && npx playwright install --with-deps chromium
  node scripts/random-manual-e2e.mjs [--iterations N] [--levels N] [--seed N] [--headed] [--keep-open]
  ```
  `testing/package.json` is dev/CI-only tooling — the app itself still needs no npm install.

Fixtures in `fixtures/`; expected engine output in `expected/`.
