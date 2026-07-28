# D-GH-2026-07-17-engine-data-extract — move DATA to a .js module, keep its network-first propagation

Status: Active

- **Context:** `js/engine.js` was ~189 KB, almost entirely one physical line: `export const DATA = {…}`,
  the full rules dataset. REV-14 (a long-standing untagged roadmap note, unblocked once REV-01 made the
  parity gate assert real values on 2026-06-30) called for extracting `DATA` into its own file and, later,
  splitting `compute()` into named sub-pricers. A self-contained plan was drafted and sent for a **4-model
  cold review** (Claude Opus 4.7, Kimi, GPT-5.5, + one ambiguous-provenance reviewer); see
  `docs/plans/2026-07-17-engine-breakup-rev14.md`. This entry covers **REV-14a** (the `DATA` extraction)
  only; REV-14b (`compute()` decomposition) remains open.
- **Options (file format for the extracted dataset):**
  1. `js/engine-data.json`, imported with `import … with { type: 'json' }` — matches the task's literal
     wording.
  2. `js/engine-data.js` as `export const DATA = {…}`, imported + re-exported by `engine.js`.
  3. `fetch('engine-data.json')` at runtime.
- **Decision:** (2), a `.js` module. `engine.js` now does `import { DATA } from './engine-data.js'; export
  { DATA };` — every importer and the three tools' `window` bridges see a byte-identical `DATA` surface.
  Additionally, `service-worker.js` was updated: `engine-data.js` is precached and added to the
  network-first regex (cache bumped `pact-v5`→`pact-v6`).
- **Why:** all four cold reviewers independently recommended flipping `.json`→`.js`, and Kimi supplied the
  decisive concrete mechanism — **JSON modules are frozen in some engines**, so the tools' bridges doing
  `DATA.racialFx = {…}` (a display-only mutation `compute()` never reads) would throw `TypeError`. `.js`
  also sidesteps the iOS-Safari import-attributes support question and the JSON-representability
  assumption, and it matches the repo's own existing precedent (`ap-by-level.js`, `advancement.js` are
  already externalized `.js` data modules). The service-worker change preserves a property that would
  otherwise silently regress: editing `DATA` used to mean editing `engine.js`, which is **network-first**
  precisely so rules fixes reach returning users immediately; leaving `engine-data.js` on the default
  cache-first path would have made rules updates go stale until cache eviction. Option 3 was rejected
  because `DATA` is consumed **synchronously** by both `compute()` and the bridges — going async would
  ripple through every caller and the `engine-ready` timing for no benefit.
- **Status:** Active. Verified byte-identical (raw string + deep-equal), `engine-parity` 20/0 including
  warnings, all 14 named exports unchanged, `DATA` still mutable (not frozen) via a live Node check,
  `DATA.version`/`BUILD` unbumped (no rules change).
