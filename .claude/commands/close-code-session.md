---
description: Wrap-up that WRITES the session's CHANGELOG/DECISIONS/session-note, graduates finished tasks, then PROPOSES a ready commit — never stages, commits, pushes, merges, or deletes
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(git status *), Bash(git log *), Bash(git diff *), Bash(git branch *), Bash(git worktree list *), Bash(git fetch *), mcp__github__pull_request_read, mcp__github__list_pull_requests, mcp__github__search_pull_requests
disallowed-tools: NotebookEdit, Bash(git add *), Bash(git commit *), Bash(git push *), Bash(git merge *), Bash(git rebase *), Bash(git reset *), Bash(git branch -d *), Bash(git branch -D *), Bash(git worktree add *), Bash(git worktree remove *)
---

# PACT — close off this session

You wrap up this session in three parts: **(1) log** the session's work to the right files (you write
these entries yourself), **(2) verify & sweep** the tree/branches/PRs (report only), and **(3) propose a
ready commit** for the human to run. You **never** stage (`git add`), commit, push, merge, rebase, or
delete anything — those all wait for an explicit go from the human. Other Claude Code sessions may have
worktrees and branches in flight; never touch those.

**Before writing anything**, run `git status` / `git diff` and classify every touched path. You log against
*this* session's real work only — a shared checkout can hold another session's in-flight changes, and those
are not yours to describe, stage, or commit.

## Part 1 — Log the session's work (you WRITE these directly)

**1. `CHANGELOG.md`** — add the one-line entry (or entries) for what changed this session, newest on top,
in the surrounding format. Always required, even for small/docs-only changes.

**2. `DECISIONS.md`** — only if a change involved a non-obvious *why* (a trust boundary, a data-model
trade-off, a caching choice — something a future agent would wonder about). When it's warranted, write
**both** the Index bullet and the full `Context → Options → Decision → Why → Status` entry, newest on top,
using a `D-GH-<YYYY-MM-DD>-<branch-slug>` ID (per `AGENTS.md`'s numbering rule). If it isn't warranted,
write nothing here and say so, with the reason.

**3. `docs/sessions/<date>-<topic>.md`** — write one if **any** of these are true, otherwise skip it and
say so. Once you've evaluated the criteria, act on that conclusion immediately — write the file (or skip
it) in the same turn. Don't phrase the evaluation as a question and pause for a reply first; presenting
"here's my reasoning on whether this qualifies" as if it needs a go-ahead is the failure mode this line
rules out — items 1–2 already write directly, and this step is no different:
  - the actual root cause differed from what the task's diagnosis/task-board entry assumed
  - you picked between multiple valid approaches in a way a future agent could reasonably second-guess
  - the plan changed mid-session — blocked, pivoted, or scope grew because it had to, not because it was
    a nice-to-have
  - work collided with another session's work (duplicate PR, merge conflict, race)
  - two or more task-board items got done together in one sitting

  None of these are about task complexity or tool-call count — a fiddly but uneventful task still skips the
  note; a one-line fix that uncovered a surprise still gets one.
  **If a note for this session already exists, re-read its content** against everything that's happened
  since it was last written, and update it — don't just confirm it exists. A note written mid-session goes
  stale the moment more work happens after it (e.g. this same `/close-code-session` pass surfacing a decision
  that gets acted on, a rebase, a merge).

**4. Roadmap graduation** — if a `docs/TASK_BOARD.md` task was finished this session, **remove** its entry
from `TASK_BOARD.md` now and confirm the matching `CHANGELOG.md` line exists (graduate = move, not
duplicate). **The single-writer rule still holds** (`AGENTS.md` → *Multiple sessions*): you may only
*remove* finished items — **never append new open tasks to `TASK_BOARD.md`**. Any new task you discovered
this session gets **output in the house `## <title> — TODO` / `Done when:` format** for the human to fold
in (surface it in Part 3's report), not written into the file.

## Part 2 — Verify & sweep (report only — write nothing, change nothing)

**5. Test gate**
Classify this session's changes: `git status` every touched path. If everything touched is under `docs/`,
or is `CHANGELOG.md`, `DECISIONS.md`, or `TASK_BOARD.md`, skip the check and report: "5. Test gate —
skipped, this session was docs-only." Otherwise, confirm `testing/tests/engine-parity.html` was run this
session and passed the *current* baseline (read `testing/expected/expected-results.csv` — don't assume a
fixed pass count). If you can't confirm it was run, say so rather than assuming it passed.

**6. Repo-wide branch & worktree sweep**
Looks at *all* worktrees and local branches, not just this session's:
```
git worktree list
git branch -vv
git fetch origin --prune
```
For each local branch/worktree, report:
- **Merged & safe to clean up** — its PR has merged (check with the `pull_request_read` /
  `list_pull_requests` MCP tools for `state: merged, head: <branch>`, or `git log origin/main..<branch>` /
  `origin/preview..<branch>` being empty) but the local branch/worktree still exists. Flag as a cleanup
  candidate.
- **Active elsewhere** — has real commits ahead of `preview`/`main` and no merged PR. Leave alone, just
  note it exists (likely another session's in-flight work).
- **Orphaned** — local branch whose remote counterpart was deleted (shows `: gone]` in `git branch -vv`)
  but the local ref/worktree wasn't cleaned up. Flag as a cleanup candidate.

Never delete or remove anything in this step — just report; cleanup is `/cleanup-code-branches` or an explicit go.

**7. preview / main sync status**
```
git fetch origin
git log origin/main..origin/preview
```
If `preview` has commits not yet on `main`, say so and ask whether to promote now or leave it queued.

**8. Open PRs from this session**
Any PR opened this session that's still unmerged — list it and ask if it needs a decision now.

**9. Cross-project hints**
Did this session surface a lesson general to AI-assisted coding, not specific to PACT (a cross-platform
gotcha, a git/worktree pattern, a prompting/agent-design lesson)? If yes, draft a candidate entry — a
one-line trigger plus a one-line generalized rule — and list "push it to `ai-lessons-learned`" as one of
the lettered follow-up actions. **Draft only — never write it anywhere without approval.** If nothing
general came up, say so and skip this.

## Part 3 — Propose the commit (you do NOT run it)

After Part 1's writes, run `git status` / `git diff` again, then:
- List the exact files that belong to this session's real, finished work (the docs you just wrote, plus the
  session's code changes). **Never** propose `git add -A` / `git add .` — name each file, because a shared
  checkout may hold another session's changes you must not sweep in.
- Print a **ready-to-run** block for the human to review and run themselves:
  ```
  git add <the named files>
  git commit -m "<type(scope): summary>"
  ```
  Draft the message in this repo's Conventional-Commits style — check recent `git log --oneline` for the
  exact prefix pattern in use; don't assume one. If the session finished more than one independent task,
  propose **one commit per task** (matching the one-commit-per-task rule in `AGENTS.md`), not a bundle.
- **Stop there.** `git add`, `git commit`, and `git push` are disallowed for this skill on purpose — the
  human stages and commits after reading the diff. Never run them yourself, even if asked mid-run to "just
  commit it": say it's out of scope for this skill and hand back the command.

## Output format

Give a short punch list, grouped by the numbers above — for Part 1 say plainly **what you wrote** (each file
+ a one-line summary of the entry) so the human can eyeball it before the proposed commit; for Part 2 mark
each done / not needed / needs action.

For anything that needs a decision, use the tiered format from `AGENTS.md`'s Communication conventions —
don't ask yes/no one at a time. By default, group every actionable follow-up (running the proposed commit,
merges, branch cleanup, pushing the drafted lessons entry, etc.) under **one** top-level lettered question —
e.g. "**A.** What should we run to close out?" — with options **A1**, **A2**, **A3**… underneath. If a
genuinely separate decision doesn't fit that "run this action" shape (e.g. *when* to promote
`preview` → `main` is a scheduling call, not a checklist item), give it its own letter (**B**, **C**…).

**Tag every option Recommended or Not recommended — with a reason, every time**, using the same bar as
`AGENTS.md`: default to Recommended; withhold only when the action is destructive/hard to reverse, is a
judgment call only the user can make, or depends on information not yet available. A clean, already-tested
PR waiting on a merge, an already-merged branch waiting on cleanup, or the ready commit you just proposed
are exactly the kind of thing that defaults to Recommended — don't hold them back "to be safe" once they've
cleared their own gate.

Recommending an action never means running it unprompted — writing the Part 1 docs is the only thing this
skill does without a prompt; every side-effect (staging, committing, pushing, merging, cleanup) waits for
the human to name the letters. Ask once which letters to run, e.g. "Run A1 and A3? Say the letters, or
'none'," and wait for that single reply rather than confirming each item separately. If the
`AskUserQuestion` tool is used for this instead of plain text, follow `AGENTS.md`'s rule for it: retry once
on a tool error before assuming anything, and restate which letters were chosen before acting on them.

End with a one-line verdict: clear to close (docs logged, commit proposed), or not yet (and why).

---

$ARGUMENTS
