# D-GH22 — `/run-task` uses native Claude Code worktrees (`EnterWorktree`), superseding the "Option A" sibling `pact-worktrees/` folder layout

Status: Active

- **Context:** `/next-task`'s manual worktree code (`git worktree add -b <slug> <worktrees-root>/pact-worktrees/<slug> origin/preview`, plus `-C <path>` on every later git call) had a path-arithmetic bug — `worktrees-root` was already defined as ending in `pact-worktrees`, so the `git worktree add` line doubled it into `.../pact-worktrees/pact-worktrees/<slug>`. Fixing that bug was itself an open question at the same time Claude Code's native `--worktree` flag / `EnterWorktree` tool (v2.1.50+) became available, which does the create/branch/cleanup automatically instead of via ~30 lines of manual prompt logic.
- **Options considered:** (A) fix the doubled-path bug in place, keeping the sibling
  `<repo-parent>/pact-worktrees/<slug>` folder layout previously agreed as the intended structure
  ("Option A" — one `pact-worktrees/` folder next to the PACT folder, each task inside it); (B) adopt
  native `EnterWorktree`/`--worktree`, which always creates worktrees under `.claude/worktrees/<name>/`
  inside the repo itself — there is no setting to redirect that location short of a `WorktreeCreate` hook,
  which replaces the tool's git logic entirely and was ruled out of scope for this change.
- **Decision:** (B). **This explicitly supersedes the earlier "Option A: sibling `pact-worktrees/` folder"
  decision** — worktrees now live at `.claude/worktrees/<slug>/` (added to `.gitignore`), not next to the
  repo. `EnterWorktree` sanitizes `/` out of its `name` argument (`feat/foo` → directory
  `feat+foo`, branch `worktree-feat+foo`), so `/run-task` Step 4 renames the branch with `git branch -m`
  immediately after creation — verified working directly in-session (see `run-task.md` Step 4 for the
  exact caveats). Worktrees branch from the repository's actual GitHub default branch, confirmed to be
  `preview` (`git remote show origin` → `HEAD branch: preview`), so no `worktree.baseRef` override is
  needed.
- **Why:** the automation/safety wins (trust handling, automatic branch creation, cleanup on exit,
  project-scoped plugin inheritance) outweigh the cosmetic location change, and there's no way to keep
  both the native tooling and the old sibling-folder layout without adding a new hook, which this change
  was scoped to avoid.
- **Status:** DONE.
