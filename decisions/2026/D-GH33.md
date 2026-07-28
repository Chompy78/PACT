# D-GH33 — CharGen imports the real js/engine.js MUT/foldBuild/activeEvents/economy/baseBuild (Phase 2 step 2)

Status: Active

- **Context:** Phase 2's plan (step 2) called for replacing CharGen's two local, throwaway copies of
  `MUT`/`foldBuild`/`activeEvents`/`economy`/`baseBuild` with the real, already-exported `js/engine.js`
  versions, and explicitly flagged as a risk to check first: "behaviour parity between engine's
  `MUT`/`foldBuild`/`activeEvents`/`economy` and CharGen's local throwaway copies... if they've drifted,
  swapping them introduces regressions that look like save-format bugs."
- **The parity check found real drift** in CharGen's local copy (nested inside `_lsImportFold(LOG)`, used
  only when importing a Live-Sheet-shaped file into CharGen) — matching, byte-for-byte, a divergence this
  project had already documented for DM Console's separate local `MUT` copy: `MUT.found` had no
  else-branch for "this tradition already exists — add a second discipline to it," so a second `found`
  event for an already-founded tradition slot was silently dropped instead of appending a discipline
  (multi-discipline spellcasters lost their second discipline on import); and `MUT.dbound` (the
  discipline-bound flag) didn't exist in the local copy at all, so `dbound` events silently no-opped.
  `baseBuild()` was verified byte-identical; the local `activeEvents`/`economy`/`foldBuild` were
  behaviorally equivalent to the engine's (just index- vs array-parameterized, and only ever called with
  the full log in this specific usage, so the signature difference didn't block a direct swap here).
  A second, smaller local `MUT` subset inside `buildToLiveLog()` (export path, used only to compute
  before/after price deltas) had no drift — every category it used matched the engine's mutator exactly —
  but was still replaced with the real import as unnecessary duplication.
- **Decision:** CharGen's module bridge now imports `MUT`, `foldBuild`, `activeEvents`, `economy`,
  `baseBuild` from `js/engine.js` alongside its existing `DATA`/`compute` (D-GH26). `_lsImportFold(LOG)`
  collapses to a direct call to the real `foldBuild(LOG)` (the array-parameter engine version) — the
  bug fixes above are an automatic side effect, not separately implemented. `buildToLiveLog()`'s smaller
  local `MUT` subset is deleted in favor of the same import. CharGen's live editing state (DOM/
  `readBuild()`/`render()`/the ~75 UI handler sites) is untouched — this step only changes what backs
  the import and export paths, not how a character is built interactively.
- **Why:** this is exactly the parity check the Phase 2 plan called for before the swap, done in the
  order the plan specified (verify parity, then swap) rather than swapping first and discovering drift as
  a live regression. The bugs found were real and shipping — any multi-discipline character (or one with
  a bound discipline) exported from Live Sheet and re-imported into CharGen for further editing would have
  silently lost data. Fixing them as a byproduct of the planned engine-bridge work, rather than as a
  separate targeted patch, means there's now exactly one `MUT`/`foldBuild` implementation for this codebase
  to keep correct, not three (engine.js, CharGen's import copy, CharGen's export copy).
- **Status:** DONE. Verified in a real browser: CharGen boots clean with the expanded bridge
  (`DATA.version` v0.334 confirmed live); a synthetic two-discipline-plus-`dbound` LOG round-trips through
  `_lsImportFold` correctly (previously would have dropped the second discipline and the bound flag); a
  representative build (species, skills, racial traits) round-trips through `buildToLiveLog` →
  `foldBuild` → `compute()` at an identical price before and after. `testing/tests/engine-parity.html`
  unaffected (13/0 — this step touched no `js/engine.js` code). CharGen's `js/engine-v0-snapshot.js`
  frozen comparison copy is deliberately **not** updated to include this fix — it's meant to stay pinned
  to its original 2026-07-08 snapshot for Phase 2 before/after comparison, so this bug fix is intentionally
  only visible in the live tool, not the v0 comparison baseline.
