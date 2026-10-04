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
- **`tests/engine-parity.html`** — regression gate for `js/engine.js`. Run in a browser; expect **0 failed** (check `testing/expected/expected-results.csv`'s row count for the pass total — don't assume a fixed number). Asserts each fixture's exact warning-text array (`testing/expected/expected-warnings.json`), not just a warning count — a warning changing wording, firing for the wrong reason, or silently disappearing while another appears now fails the gate. See `docs/HOW-TO-WORK.md` for instructions.
- **`scripts/engine-parity-ci.mjs`** (**REV-11**) — headless Node port of `tests/engine-parity.html`: same
  fixtures, same `expected-results.csv` + `expected-warnings.json`, same assertions, no browser needed. Runs automatically in CI (see
  `.github/workflows/engine-parity.yml`) on PRs touching `js/engine.js` or `testing/**`; a CLI agent should
  run it directly (`node testing/scripts/engine-parity-ci.mjs`) rather than opening the browser page.
- **`scripts/undo-barrier-ci.mjs`** — gate for `isUndoBarrier()`/`undoFloor()`/`sealedFloor()`, the one
  "this history can no longer be taken back" rule both player tools rely on. Pure Node. Runs in CI as the
  `undo-barrier` job of `.github/workflows/engine-parity.yml`: `node testing/scripts/undo-barrier-ci.mjs`.
- **`scripts/dm-unlock-drawback-ci.mjs`** (`feat/dm-unlock-drawback`) — gate for `activeEvents().unlocked`:
  a `dmUnlockDrawback` event releases exactly the DM-imposed, locked purchase it names by `seq` (never a
  same-named player-taken one), is ignored if unstamped / out of order / ambiguous, moves no AP, is an undo
  barrier covering the original imposed buy, and leaves FIFO buy-off resolution untouched. Pure Node. Runs in
  CI as the `dm-unlock-drawback` job of `.github/workflows/engine-parity.yml`:
  `node testing/scripts/dm-unlock-drawback-ci.mjs`. Note the lock and unlock are client-honoured, not
  server-enforced — see `feat/server-enforced-drawback-lock`.
- **`scripts/imposed-drawback-grants-ci.mjs`** (`fix/imposed-drawbacks-grant-no-ap`) — gate for "a DM-imposed drawback
  grants no AP in `compute()`": four imposed drawbacks leave `compute().remaining` equal to the frozen ledger (no phantom
  AP), fire neither the "Drawbacks grant N AP" nor the "N drawbacks chosen" warning, list each row at 0 labelled
  "(DM imposed)", do not raise `creationCeiling`'s bonus, and do not consume a campaign cap — each case with a
  player-taken control that must still pay and still warn. Pure Node. Runs in CI as the `imposed-drawback-grants` job of
  `.github/workflows/engine-parity.yml`: `node testing/scripts/imposed-drawback-grants-ci.mjs`. Parity fixtures
  EV-025/EV-026 pin the warning lists.
- **`scripts/wounds-ci.mjs`** and **`scripts/wounds-ui-e2e.mjs`** (`feat/permanent-wounds`) — gates for the DM-only Wounds
  section. `wounds-ci.mjs` (pure Node) pins `DATA.wounds` (tier ↔ price: minor 2 AP, moderate 3–4; no Grievous tier; the four
  Grievous drawbacks are not wounds), the **wound-only split** (the four new entries are in `DATA.drawbacks` but NOT in
  `DATA.drawbackList`, which is what hides them from players; appended at the end of `DATA.drawbacks`; no stat cap), and the two
  `compute()` rules — a wound-only entry that is not DM-imposed is a hard ⛔, and two wounds in one body location is a soft
  warning — each with a control. `wounds-ui-e2e.mjs` (browser, no Supabase) proves CharGen's grid and the Live Sheet's panel do
  not offer the four (while CharGen still lists one a character already holds), and the DM Console's impose dropdown offers all
  of them grouped as Wounds, defaults to Locked + flat on choosing a wound, and sends exactly that. Parity fixtures
  EV-027/028/029 pin the warning lists. Run in CI as the `wounds` job of `.github/workflows/engine-parity.yml` and a step of
  `.github/workflows/dm-console-ui.yml`.
- **`scripts/dm-impose-picker-e2e.mjs`** (`feat/dm-impose-picker`) — the DM Console's "Impose a drawback" pop-up (browser, no
  Supabase; bridge stubbed). Proves the card has an opener button with the old controls kept hidden as the single send path; the window
  lists every drawback once, wounds first, and search narrows it; the detail pane is read from `DATA` (effect text, tier, place, flat and
  tripled buy-off, "cap not applied", caster warning) and warns about a same-place wound or a second copy the character already has;
  choosing a wound defaults Locked + flat while moving between wounds leaves the DM's changes alone; Escape/Cancel close it, send
  nothing and return focus; Impose sends one cost-0 purchase carrying the window's own Locked / removal-cost choices (checked with values
  that differ from the card's defaults, after a mutation showed the first version could not tell). Run as a step of
  `.github/workflows/dm-console-ui.yml`.
- **`scripts/live-sheet-unlock-e2e.mjs`** and **`scripts/dm-console-unlock-e2e.mjs`**
  (`feat/dm-unlock-drawback`) — the two tools' halves of the DM unlock, driven in a real browser with no
  Supabase and no sign-in (a seeded `localStorage` character; stubbed + recorded bridge calls). The Live
  Sheet gate proves a locked imposed drawback shows 🔒 and cannot be bought off, an unlocked one shows 🔓
  with the DM's note (HTML-escaped) and can be, and that a same-named player-taken drawback keeps its own
  3× path. The DM Console gate proves which purchases the Unlock control offers (imposed + locked +
  still-locked only, identified by seq), what the button sends (one `dmUnlockDrawback`, trimmed required
  note, nothing that could move AP), and that the archived-campaign peek blocks it. Both run in CI as steps
  of `.github/workflows/dm-console-ui.yml`. Needs Playwright (`cd testing && npm ci`).
- **`campaign-test.html`** — end-to-end harness for `js/campaign.js` and `js/dm.js` (requires Supabase sign-in).
- **`sync-test.html`** — end-to-end harness for `js/sync.js` (requires Supabase sign-in).
- **`scripts/sync-state-machine-ci.mjs`** — gate for `getSyncState()`/`noteEdit()`/`checkFreshness()`
  (the six-state sync-status chip's state machine, `docs/plans/2026-08-08-shared-sync-chip-part-b.md`
  Part B1). Pure-Node, no Supabase project needed. **Not yet wired into CI** — run locally:
  `node testing/scripts/sync-state-machine-ci.mjs`.
- **`scripts/sync-concurrency-ci.mjs`** — gate for `js/sync.js`'s optimistic-concurrency guard
  (`base_updated_at`), including a differential leg (fails on a deliberately reverted copy of the fix,
  proving the test isn't vacuous). Stubs the Supabase client and gives each simulated browser profile
  its own `localStorage` rather than needing a real project. **Not yet wired into CI** — run locally:
  `node testing/scripts/sync-concurrency-ci.mjs`.
- **`scripts/sync-autosave-toggle-ci.mjs`** — gate for `setAutosaveEnabled()`
  (`D-GH-2026-08-08-universal-autosave-toggle`, Part B3): a false-conflict bug (an unrelated toggle
  bumping `updated_at` via the DB trigger and invalidating the concurrency pin) and a discarded-
  preference bug (toggling a never-cached character silently no-opping), both caught by
  `/code-review ultra` before merge. Differential against the pre-fix commit, same principle as
  `sync-concurrency-ci.mjs`. **Not yet wired into CI** — run locally:
  `node testing/scripts/sync-autosave-toggle-ci.mjs`.
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

## Chromium can't reach the internet through a sandboxed session's proxy? `scripts/lib/chromium-relay.cjs`

Found 2026-08-04 (usability/QoL review session, `docs/reviews/2026-08-04-usability-qol.md`): in some
Claude Code sandboxed sessions, Chromium gets `net::ERR_CONNECTION_RESET` on **every** external
HTTPS host it tries — not a Supabase-specific problem, confirmed against `https://example.com` too
— while `curl`/Node's `fetch()` reach the exact same hosts through the exact same
`HTTPS_PROXY`/`127.0.0.1:<port>` address without issue. Root cause: Chromium's BoringSSL always
sends GREASE values in its TLS ClientHello (unrelated to and not disableable via the
`EncryptedFlags`/`PostQuantumKyber` feature flags — verified those flags *did* reach Chromium's
network-service subprocess via `ps`, and the reset still happened), and this particular session's
policy-enforcing TLS-terminating egress proxy resets the connection on that ClientHello shape
rather than tolerating the unrecognized values. Not fixable from the Chromium side.

`scripts/lib/chromium-relay.cjs` + `scripts/lib/chromium-relay-shim.cjs` work around it: a tiny
loopback relay that terminates Chromium's TLS locally (where Node's TLS stack tolerates GREASE
fine) and re-issues the request as a normal `fetch()` — which, run with `NODE_USE_ENV_PROXY=1`,
goes through the real sanctioned proxy with full certificate validation against the real
destination. Nothing here disables TLS verification for the actual destination or bypasses the
org's egress policy — only the local, loopback-only leg to Chromium is unverified (Chromium is
launched with `--ignore-certificate-errors` to accept the relay's throwaway self-signed cert).

Only relevant inside a sandboxed session with this exact incompatibility — on a normal machine or
CI runner with direct internet access, don't use it; nothing here is otherwise wired into any
script by default. To use it with an existing Playwright script with no edits to that script:

```
NODE_USE_ENV_PROXY=1 node --require ./testing/scripts/lib/chromium-relay-shim.cjs <script.mjs> [args...]
```

Requires `openssl` on `PATH` (self-signed cert generation, once per relay start) and Node ≥ 22.21
(for `NODE_USE_ENV_PROXY`). See the header comment in `chromium-relay.cjs` for the full mechanism
and the diagnostic evidence.
