# PACT — Testing

## Test harnesses

- **`tests/engine-parity.html`** — regression gate for `js/engine.js`. Run in a browser; expect **9 passed / 0 failed**. See `docs/HOW-TO-WORK.md` for instructions.
- **`campaign-test.html`** — end-to-end harness for `js/campaign.js` and `js/dm.js` (requires Supabase sign-in).
- **`sync-test.html`** — end-to-end harness for `js/sync.js` (requires Supabase sign-in).
- **`scripts/random-manual-e2e.mjs`** — headless Playwright harness for character generation +
  advancement (progress on **REV-11**, the "no headless runner yet" gap). Drives the real CharGen
  and Live Sheet UI — species/class selects, ability +/- steppers, skill checkboxes, the "+ Award AP" /
  "Level up" / buy-panel tiles — with its own randomization; it never calls the app's built-in
  `randomizeBuild()`. See the file header for usage and requirements (Playwright + Chromium).

Fixtures in `fixtures/`; expected engine output in `expected/`.
