## Summary

<!-- What changed and why. -->

## Per-change checklist (AGENTS.md)

- [ ] One task, one branch — named `type/short-slug`.
- [ ] `js/engine.js` touched only if this task targets the engine; otherwise its API is unchanged.
- [ ] `testing/tests/engine-parity.html` → **N passed / 0 failed** (see `docs/HOW-TO-WORK.md`). If
      `compute()` output changed, `testing/expected/` was updated in this PR.
- [ ] `CHANGELOG.md` updated (always).
- [ ] `DECISIONS.md` updated if this involves a non-obvious *why* (security model, trust boundary,
      caching strategy, data-model trade-off).
- [ ] `docs/sessions/` updated if the session covered discussion or spanned multiple areas worth
      preserving.
- [ ] Roadmap item graduated out of `docs/TASK_BOARD.md` if done.
- [ ] Version sync checked per `docs/VERSION-SYNC.md` if `BUILD` or `DATA.version` changed.

## Review cadence

- [ ] Ran `/code-review` (low/medium effort) on this PR before merge.
- [ ] If this PR touches `js/engine.js` or `sql/` (RLS/migrations): ran `/code-review ultra` before
      merge — the engine is the single source of truth and RLS is the only security boundary.
