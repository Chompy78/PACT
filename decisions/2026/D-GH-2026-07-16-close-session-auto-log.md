# D-GH-2026-07-16-close-session-auto-log — close-session writes docs + proposes a commit, but never stages/commits

Status: Active

- **Context:** the cross-project AI-workflow standard's `close-session` step actively logs decisions/changes
  and proposes (but doesn't run) a commit. This repo's `/close-session` was **report-only** — it inspected
  the tree and told the human what to write/commit, editing nothing. The reconciliation asked to bring it up
  to the standard's "log + propose-commit" behaviour.
- **Options:** (1) keep it report-only (safe, but the human re-does the logging the skill already worked
  out). (2) Let it write the docs itself and *also* stage + commit. (3) Let it write the docs itself, but
  only *propose* a ready commit — never stage or commit.
- **Decision:** option 3, plus a carve-out on task-board writes. The skill now writes `CHANGELOG.md`, a
  `DECISIONS.md` entry when warranted, and a `docs/sessions/` note when its criteria fire, and **graduates**
  (removes) finished items from `TASK_BOARD.md`. It then prints a ready-to-run `git add <named files>` +
  `git commit` block and stops. `git add`, `git commit`, and `git push` stay in the skill's
  `disallowed-tools`.
- **Why:** two failure modes drove the shape. (a) **Single-writer rule beats the doc.** The standard says
  "log new open tasks onto the board," but `AGENTS.md` makes `TASK_BOARD.md` single-writer to stop
  concurrent sessions racing on it — so the skill may only *remove* finished items; new tasks it discovered
  are output in the house `## <title> — TODO` format for the human to fold in. (b) **Propose, don't stage.**
  This repo is explicitly multi-session/shared-checkout aware; a skill running `git add` could sweep in
  another session's in-flight changes, and a skill running `git commit` removes the human's read-the-diff
  gate. Printing the exact command keeps both the index and the commit boundary under human control while
  still delivering the standard's "propose a commit" value.
- **Consequence:** `docs/SKILLS.md`'s two "report-only" descriptions of `/close-session` were updated to
  match; the skill's frontmatter `description` and `allowed`/`disallowed-tools` changed (gains `Edit`,
  `Write`, `git diff`; keeps `git add`/`commit`/`push`/`merge`/`rebase`/`reset`/branch-delete/worktree
  disallowed).
- **See also:** D-GH-2026-07-16-agents-workflow-reconcile (the same reconciliation pass); `AGENTS.md`
  *Multiple sessions* (the single-writer rule).
- **Status:** Superseded by D-GH-2026-07-20-close-code-session-run-commit (below) — the human-reviews-
  the-diff-before-commit gate was explicitly removed at the user's request. The other mitigation this
  entry established, never `git add -A`/`.`, was kept and still applies.
