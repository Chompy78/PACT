# D-GH45 — A stale roadmap bug-fix entry survived two independent "doesn't reproduce" findings before being removed

Status: Active

- **Context:** `docs/PACT_ROADMAP.md` carried `fix/chargen-feature-autocomplete-scroll-position`, describing
  `_featAC`'s `place()` function (`tools/PACT-CharGen-Webtool.html`) double-counting `window.scrollY` on a
  `position:fixed` autocomplete menu. On 2026-07-10, a session investigating a secondhand report of this
  same bug live-reproduced it and could not confirm the symptom — the code already computed position
  correctly on every scroll event — and logged that finding to `chompy78/ai-lessons-learned`'s inbox
  (`inbox/2026-07-10-verify-secondhand-bug-reports.md`, as of that repo's commit `4f5cf7b` — cited with a
  commit pin since that repo's curation workflow deletes inbox files once folded into `topics/`), but
  didn't touch PACT's own roadmap entry. On
  2026-07-11, a separate `/pick-task` session picked the same roadmap item up fresh (unaware of the prior
  investigation), read the actual code, and independently reached the identical conclusion: `place()`
  computes `top` purely from `getBoundingClientRect()`, and `git log -S"scrollY"` shows this pattern has
  never existed in the file's history.
- **Decision:** Remove the roadmap entry with no code change — there's nothing to fix. Do not wait for a
  third session to re-derive the same "doesn't reproduce" result.
- **Why:** the entry survived one full "found it's stale, didn't clean up" cycle already, which is exactly
  the kind of drift a roadmap-as-task-queue is supposed to prevent. A dropped/skipped task in a batch is
  correctly left untouched for human review the *first* time (per `/run-task`'s own rule — don't force a
  fix that isn't needed), but once a second independent investigation reaches the same conclusion, "leave
  it for review" has already happened and the entry is just recurring cost with no new information left to
  gather. Removing it here also fixes the actual mechanism that let it survive round one: the finding from
  2026-07-10 lived only in `ai-lessons-learned` (a separate repo, not consulted by `/pick-task` when
  scanning `docs/PACT_ROADMAP.md`), so it never had a path back into this file.
- **Status:** DONE. Entry removed from `docs/PACT_ROADMAP.md`; no `tools/PACT-CharGen-Webtool.html` change,
  no `DATA.version` bump, `testing/tests/engine-parity.html` unaffected (docs-only). The removed entry's
  second "Done when" clause (an e2e-harness scroll-to-0/oversized-viewport workaround, "removable once
  this landed") was also checked retroactively, during a `/code-review` pass on this change: no such
  workaround exists in `testing/scripts/random-manual-e2e.mjs` on `preview` — its only occurrence in git
  history is on an unrelated, unmerged branch (`origin/claude/character-gen-testing-improvements`, commit
  `81d3f2b`), so that second claim was equally stale and needed no action either.
- **Addendum (2026-07-11):** originally logged as `D-GH44`, colliding with the "CharGen campaign-rules
  awareness" entry above (PR #151), which merged into `preview` first. Kept that earlier-merged entry at
  `D-GH44`; renumbered this one to `D-GH45` (next free at time of fix) per `AGENTS.md`'s documented
  renumber-on-merge fallback (D-GH43) — caught before merge this time, so no cross-file references needed
  updating beyond this file and `CHANGELOG.md`.
