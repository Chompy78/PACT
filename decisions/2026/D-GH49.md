# D-GH49 — Externalize the AP-by-level ladder: file source + back-compat DATA aliases, no version bump

Status: Active

- **Context:** the roadmap's `feat/ap-by-level` asked to lift CharGen's default AP and the level→AP table
  out of `js/engine.js` into an editable `js/ap-by-level.js`, surfaced as `DATA.apByLevel`/`DATA.defaultAp`.
  On opening the code the table was already in `DATA` — but inlined in the ~200 KB single-line JSON literal
  as `DATA.levelAP` (`{1:50…20:491}`) and `DATA.level1AP` (50), so it was effectively un-editable and read
  by all three tools plus `compute()`'s racial-trait creation-lock (`_spent > DATA.level1AP`). A second,
  unused inverse copy (`DATA.benchLevels`) also sits in the literal.
- **Options:** (A) full rename — move to the file, expose only `apByLevel`/`defaultAp`, and rename every
  `levelAP`/`level1AP` usage across the three tools *and* inside `compute()`'s lock path. (B) externalize to
  the file, expose the new `apByLevel`/`defaultAp` names, and keep `levelAP`/`level1AP` as aliases pointing
  at the same imported data — no tool or `compute()` edit. (C) leave it inline (do nothing).
- **Decision:** (B). `js/ap-by-level.js` exports `AP_BY_LEVEL` + `DEFAULT_LEVEL`; `engine.js` imports them,
  removes the two inline keys from the literal, and assigns `DATA.apByLevel`/`DATA.defaultAp` (current
  names) plus `DATA.levelAP`/`DATA.level1AP` (back-compat aliases) from the imported source. Values are the
  exact old integers, so `compute()` output is byte-identical. Left the unused `benchLevels` inline copy
  untouched (out of scope; nothing reads it). Did **not** bump `DATA.version` and did **not** touch
  `testing/expected/`.
- **Why:** (A) would edit `compute()`'s racial-trait-lock path — the exact high-risk pricing logic AGENTS.md
  flags — for a pure rename, buying nothing. Aliases make `js/ap-by-level.js` the single source of truth
  (editing it now propagates everywhere) while keeping the engine's DATA shape and lock logic untouched, so
  the change is provably behavior-preserving. On the version bump: the roadmap said to bump `DATA.version`
  and refresh the REV-01 baseline, but that presumed a mechanics *change*; a verbatim externalization leaves
  `compute()` output identical (parity 20/0, no baseline delta), and AGENTS.md is explicit — bump ONLY when
  `compute()` output changes, don't over-bump. Bumping here would falsely signal a rules change and desync
  from an unchanged baseline. A future edit to a *value* in `js/ap-by-level.js` IS mechanics and must bump +
  refresh the baseline (noted in the file's header).
- **Status:** DONE. `testing/tests/engine-parity.html` → 20/0 (headless Node run). Engine public API stable
  (`DATA.levelAP`/`DATA.level1AP` preserved); `DATA.version` unchanged.

---
