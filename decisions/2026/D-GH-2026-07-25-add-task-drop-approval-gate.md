# D-GH-2026-07-25-add-task-drop-approval-gate — /add-code-task stops pausing for approval before committing

Status: Active

- **Context:** `/add-code-task` (and the sibling draft-before-write skills it was modeled on) showed a
  formatted task block and waited for an explicit "yes"/"looks good" before committing to
  `docs/TASK_BOARD.md` on `preview`. Across this session the user consistently approved every draft
  as-shown, then explicitly asked for the gate to be removed: "Rewrite task that it doesn't need my
  approval anymore. I'll say if i don't like it rather than say i approve it."
- **Options:** (i) keep the gate as-is; (ii) remove it for `/add-code-task` specifically; (iii) remove
  approval gates across every draft-before-write skill (`/log-code-lesson`, `/make-code-cold-plan-review`,
  `/port-agents-scaffold`'s foreign-repo-push pause).
- **Decision:** (ii) — scoped to `/add-code-task` only.
- **Why:** the user's instruction named this workflow specifically; the other draft-before-write skills
  exist for different reasons with different stakes (writing to a *foreign* repo, or a plan meant for an
  external cold reviewer) that weren't part of this request — extending the change to them would be
  inferring a broader preference the user didn't state. `docs/TASK_BOARD.md` entries are also low-stakes
  to get wrong: a bad task sits on the board as text until someone (human or `/pick-code-task`) acts on
  it, and a follow-up edit/revert commit fixes it cheaply — unlike a foreign-repo push or a cold-review
  plan going out with the wrong content.
- **Status:** DONE. `.claude/commands/add-code-task.md` Step 3 rewritten: show the block, then proceed
  straight to Step 4 in the same turn.
