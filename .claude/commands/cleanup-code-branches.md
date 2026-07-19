---
description: Scan for merged/orphaned branches and worktrees, then delete only what's approved
allowed-tools: Read, Bash(git worktree *), Bash(git branch *), Bash(git fetch *), Bash(git log *)
disallowed-tools: Edit, Write, NotebookEdit, Bash(git push *), Bash(git commit *)
---

# PACT — clean up branches and worktrees

You scan for local branches/worktrees that are safe to delete, then delete only the ones the user
explicitly approves by letter. Never touch remote branches or tags, and never touch the branch/worktree
this session is currently on, even if it looks orphaned.

## Step 1 — scan

Run the same three commands `/close-code-session` item 6 uses:
```
git worktree list
git branch -vv
git fetch origin --prune
```
Classify each local branch/worktree as:
- **merged** — its work is already on `preview`/`main` (`git log origin/preview..<branch>` /
  `origin/main..<branch>` is empty).
- **active elsewhere** — real commits ahead of `preview`/`main`, no merged PR. Leave alone.
- **orphaned** — remote counterpart was deleted (`: gone]` in `git branch -vv`) but the local ref/worktree
  wasn't cleaned up.
- **this session's** — leave alone regardless of its other classification.

## Step 2 — present

Show a table of every cleanup candidate (merged + orphaned only — skip "active elsewhere" and "this
session's" entirely) with its classification and exactly what would be run to clean it up. Lettered list
(`D1`, `D2`, ...), matching `/close-code-session`'s idiom.

## Step 3 — ask

"Delete D1, D3, D5? Say the letters or `none`. This will run `git worktree remove` and `git branch -D` —
the branches and their worktrees will be gone." Wait for the explicit letter reply. Don't delete anything
without it.

## Step 4 — execute

For each approved letter: `git worktree remove` first if it has one, then delete the branch. Try
`git branch -d` first; only escalate to `git branch -D` if `-d` refuses (unpushed/unmerged commits) *and*
the user already approved deletion for that letter — the approval in Step 3 covers the `-D` escalation,
so don't ask again mid-execution. Report what succeeded and what failed, and why.

---

$ARGUMENTS
