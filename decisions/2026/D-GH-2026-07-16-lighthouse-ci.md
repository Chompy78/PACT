# D-GH-2026-07-16-lighthouse-ci — measured baseline, not an arbitrary target

Status: Active

- **Context:** `docs/TASK_BOARD.md`'s "A7" backlog note recommends "Add a Lighthouse CI GitHub
  Action to auto-catch perf regressions," with the harder "85→90 via engine splitting/lazy-loading"
  explicitly flagged as a separate, riskier, lower-priority follow-up.
- **Options:** (1) `treosh/lighthouse-ci-action` with hand-picked/guessed thresholds. (2) same
  action, but measure the actual current score first and set thresholds with headroom below it.
  (3) collect-only (report/artifact, no failing assertions) until a baseline naturally emerges from
  a few runs.
- **Decision:** (2). Ran `npx lighthouse`/`@lhci/cli` against a locally-served copy of `index.html`
  (desktop preset) to get real numbers before writing any threshold: performance 100, accessibility
  98-100 (fluctuates slightly run-to-run), best-practices 96, seo 100. Set every category's
  `minScore` to 0.85 in `lighthouserc.json` — `error` (blocks the build) for performance and
  accessibility, `warn` (advisory only) for best-practices and seo.
- **Why:** a guessed threshold is either too loose (catches nothing) or too tight (flaky/false-
  positive blocks from Lighthouse's inherent run-to-run variance, observed firsthand: accessibility
  moved between 0.98 and 1.0 across otherwise-identical runs). Measuring first and leaving ~10-15
  points of headroom below today's near-perfect scores catches a real regression (a large blocking
  script, a broken alt-text sweep) without blocking on normal noise. `error` only on the two
  categories a landing page most directly controls user-facing quality with (perf, a11y); `warn` on
  best-practices/seo keeps the gate from blocking a PR over something more subjective/less critical.
- **A serving trick, not a symlink:** `testing/scripts/random-manual-e2e.mjs`'s local-dev harness
  needs a `PACT`-named symlink because a workstation checkout's directory name is arbitrary. In
  GitHub Actions, `actions/checkout`'s default path is always `.../work/<repo>/<repo>` — so the
  checkout's parent directory already contains a subdirectory literally named `PACT`. Serving that
  parent directly (`python3 -m http.server 8080 --directory ..`) reproduces the app's `/PACT/` URL
  prefix (required for the manifest scope/service-worker registration to behave correctly) with zero
  extra setup, a CI-only shortcut not available to the local-dev harness.
- **Verification:** ran the full pipeline locally end-to-end (`@lhci/cli collect` + `assert` against
  the real served page and the real `lighthouserc.json`): passes cleanly with today's scores; a
  deliberately-impossible forced threshold correctly failed with exit code 1 and a readable
  per-category pass/fail report, confirming the gate mechanism itself (not just the collection step)
  actually works.
- **Status:** Active.
