# D-GH47 — AUD-1 health-check: MUT-drift check reshaped into an engine-symbol drift guard; asset-size is a warning; RLS proof uses stdlib urllib

Status: Active

- **Context:** AUD-1 (`testing/scripts/audit.py`) was specced before the engine module-bridge migration
  finished. Three of its bullets no longer match the code as written, so implementing them literally would
  be wrong or misleading.
- **Reinterpretation 1 — "MUT drift check" → engine-symbol drift guard.** The roadmap said "check CharGen's
  and DM Console's still-hand-copied `MUT` against `js/engine.js`'s export and fail on any mismatch." But as
  of D-GH26/D-GH33/D-GH36/D-GH37 all three tools import `MUT` (and `DATA`/`compute`/`baseBuild`) live from
  the engine, and CharGen's last local `MUT` subset (inside the removed `buildToLiveLog`) went away in
  D-GH40. There is **no hand-copied `MUT` left in any tool** to byte-compare — the literal check has zero
  targets and would be a green no-op. Implemented the spec's *intent* (guard against a tool's rules copy
  drifting from the engine) as a **regression guard**: assert each tool imports `DATA`/`compute`/`MUT` from
  `../js/engine.js` and locally re-defines **none** of `DATA`/`compute`/`baseBuild`/`MUT`. This fails loudly
  the moment anyone pastes a local `const MUT = {…}` back into a tool. `foldBuild`/`activeEvents`/`economy`
  are deliberately **excluded** from the "no local def" rule: Live Sheet and DM Console import them under
  `_engine*` aliases and wrap them in thin per-tool index adapters that slice `eventsUpTo()` and delegate to
  the engine (D-GH37) — legitimate adapters, not drift.
- **Reinterpretation 2 — ">100 KB asset" is a warning, not a failure.** The current tree legitimately ships
  many 100–186 KB theme `.webp` backgrounds and the ~180 KB cover; the "Done when" requires a clean run on a
  healthy tree, and its hard-fail list is explicitly (missing PRE_CACHE file / player `ap` write succeeds /
  drift mismatch) — asset size is not on it. So the size check WARNs (non-fatal, exit stays 0), scoped to
  media files under `assets/`+`icons/` (source code and `source-assets/` originals excluded).
- **Reinterpretation 3 — RLS proof uses stdlib `urllib`, not `requests`.** The task header mandates "Python
  **stdlib only**, no installs, runs in seconds"; one bullet said "Python + requests." Stdlib wins — the RLS
  PATCHes go through `urllib.request`, so there is nothing to `pip install`. It stays opt-in (`--rls`) with
  all credentials read from env vars at runtime and never committed.
- **Why:** each change keeps the audit honest against the *current* architecture instead of a stale spec —
  a check with no targets, a size gate that fails a healthy tree, or a dependency that breaks "no installs"
  would each undermine the "is the system still healthy?" purpose.
- **Status:** In force. Verified: clean tree → 20 passed / 0 failed, exit 0; planted breaks (missing
  PRE_CACHE file; reintroduced local `MUT`) → exit 1; RLS rejection logic unit-tested. `js/engine.js` and
  `DATA.version` untouched; engine-parity unaffected.
- **Addendum (same day, `/code-review high` before merge):** the drift-guard regex above required an
  object-literal RHS (`= {`), which missed a re-pasted `const compute = (b) => {...}` — the exact drift
  the guard exists to catch. Fixed by matching the declaration alone regardless of RHS shape, driven off a
  new `GUARDED_SYMBOLS` tuple (which also gave the previously-unused `ENGINE_SYMBOLS` constant a real
  purpose). Separately, the RLS proof's rejection test inferred "blocked" from "response body is non-empty"
  — a trigger that echoed the row back with the forbidden column UNCHANGED would have been misreported as
  a successful security bypass. Fixed by parsing the echoed row and checking the actual forbidden value,
  not just body emptiness. See `CHANGELOG.md`'s same-day fix-up entry for the full list of six fixes
  (these two plus a top-level-`skipWaiting` gap, a split-import-statement miss, and a manifest
  double-report). No change to this entry's other reasoning.
- **Numbering note:** this entry was originally drafted as D-GH46, on a live-highest check that correctly
  read D-GH45 as the top at the time. Before this branch merged, PR #160 ("Communication conventions")
  independently claimed D-GH46 and merged into `preview` first. Per this file's documented collision
  policy (see `AGENTS.md`'s "Multiple sessions" section): the earlier-merged entry keeps its number, so
  D-GH46 stays with PR #160's entry, and this entry is renumbered to the next free number, D-GH47, with
  this note as the addendum. No other content changed.

---
