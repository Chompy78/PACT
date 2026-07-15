# PACT — Testing

## Test harnesses

- **`scripts/audit.py`** (AUD-1) — dependency-free static health check (Python stdlib only, runs in
  seconds): service-worker `PRE_CACHE` integrity, PWA icon/manifest correctness, the engine-symbol
  drift guard, and build-version mirror sync. **The default (non-`--rls`) checks run automatically in
  CI** on every PR touching the files they cover (see `.github/workflows/static-audit.yml`) and fail
  the build on any `FAIL` (warnings don't fail the run). Run locally: `python3 testing/scripts/audit.py`.
  The optional **`--rls` live-proof mode** (confirms Supabase RLS rejects a player writing
  `characters.ap` or binding to a campaign they haven't joined) is **intentionally NOT wired into
  CI** — it needs real credentials against a dedicated test Supabase project, which this repo doesn't
  have set up. It stays manual-only for now; run it by hand with the env vars `check_rls()` expects
  (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `PACT_PLAYER_JWT`, `PACT_TEST_CHARACTER_ID`,
  `PACT_FOREIGN_CAMPAIGN_ID`) set: `python3 testing/scripts/audit.py --rls`. See
  `D-GH-2026-07-15-wire-audit-py-into-ci` in `DECISIONS.md` for the reasoning.
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

- **`scripts/log-fuzz.mjs`** (Phase 2 of the D-GH-2026-07-13-random-e2e-real-oracle plan) — a
  pure-Node, LOG-direct fuzzer for `js/engine.js`. Unlike `random-manual-e2e.mjs` (which drives
  the real browser UI and can only reach LOG shapes a DOM click path can produce),
  `log-fuzz.mjs` constructs LOG event objects directly — the exact shape `MUT`'s handlers
  expect (`{type:'buy',cat:<MUT key>,payload:{...}}` for every one of the 44 mutation
  categories, plus `award`/`buyoff`/`name`/`names`/`creationLocked`/`campaignBound`) — and feeds
  them straight into `foldBuild()`/`compute()`/`rebuildStateFromEvents()`. No browser, no
  Chromium install, so it runs thousands of iterations in ~1-2 seconds (measured: 2000-3000
  iterations/~1-2s). It checks: the engine never throws (including a non-deterministic throw on
  a repeat call), never produces a `NaN` anywhere across every object it computes, `compute()`
  doesn't mutate its input, `foldBuild()` is pure (same LOG twice → identical build), `compute()`
  is pure (Phase 1's purity check, reused), and `foldBuild()+compute()` agrees with
  `rebuildStateFromEvents(null, LOG)` on `.result` (the two
  documented engine entry points — see the in-file comment for why this compares `.result`, not
  the raw `.build`). On any failure it shrinks the failing LOG down to a minimal reproducer
  (single-event delta-debug to a fixpoint) before printing it. It is not trying to generate
  *legal* characters — budget/rules legality is already covered by `engine-parity-ci.mjs`'s
  fixed fixtures and `random-manual-e2e.mjs`'s independent oracle; this tool's job is narrower:
  does the engine ever misbehave on *any* MUT-shaped LOG. **Not yet wired into CI** — its first
  real run found a genuine (if low-severity, display-only) bug in `compute()`'s known-spell
  over-cap surcharge math (a negative `knownCap` for a very-low-ability-score caster reads past
  an empty array, producing `NaN`); wiring this into `.github/workflows/engine-parity.yml` is
  a fast follow-up once that fix lands on its own branch (`js/engine.js` is high-risk — see
  AGENTS.md — so it isn't bundled into this tool-only change). To run locally:
  ```
  node testing/scripts/log-fuzz.mjs [--iterations N] [--events N] [--seed N]
  ```

Fixtures in `fixtures/`; expected engine output in `expected/`.
