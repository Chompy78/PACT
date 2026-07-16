---
description: Report-only wrap-up check for docs, tests, working tree, worktrees, and sync status
allowed-tools: Read, Grep, Glob, Bash(git status *), Bash(git log *), Bash(git branch *), Bash(git worktree list *), Bash(git fetch *), mcp__github__pull_request_read, mcp__github__list_pull_requests, mcp__github__search_pull_requests
disallowed-tools: Edit, Write, NotebookEdit, Bash(git push *), Bash(git commit *), Bash(git merge *), Bash(git rebase *), Bash(git reset *), Bash(git branch -d *), Bash(git branch -D *), Bash(git worktree add *), Bash(git worktree remove *)
---

# PACT — close off this session

You check whether this session is safe to wrap up, and report anything left dangling. This is a
**report-only** pass — don't delete, merge, or push anything without asking first. Other Claude Code
sessions may have their own worktrees and branches in flight; don't touch those.

## What to check

**1. Docs for the change(s) made this session**
- `CHANGELOG.md` — every change from this session has a one-line entry. This one is always required,
  even for small/docs-only changes.
- `DECISIONS.md` — only needed if a change involved a non-obvious *why* (a trust boundary, a data-model
  trade-off, something a future agent would wonder about). Say clearly if you judge this isn't needed and
  why.
- `docs/sessions/<date>-<topic>.md` — write one if **any** of these are true, otherwise skip it and say so:
  - the actual root cause differed from what the task's diagnosis/roadmap entry assumed
  - you picked between multiple valid approaches in a way a future agent could reasonably second-guess
  - the plan changed mid-session — blocked, pivoted, or scope grew because it had to, not because it was
    a nice-to-have
  - work collided with another session's work (duplicate PR, merge conflict, race)
  - two or more roadmap items got done together in one sitting

  None of these are about task complexity or tool-call count — a fiddly but uneventful task still skips
  the note; a one-line fix that uncovered a surprise still gets one.
  **If a note for this session already exists, don't just confirm it exists — re-read its content against
  everything that's happened since it was last written.** A note written mid-session goes stale the moment
  more work happens after it (e.g. this same `/close-session` pass surfacing a decision that gets acted on,
  a rebase, a merge). Check its content, not just its presence, every time this step runs.

**2. Roadmap graduation**
If a `docs/TASK_BOARD.md` task was completed this session, confirm it was actually moved into
`CHANGELOG.md` in the same change, not just left checked off or forgotten in the roadmap.

**3. Test gate**
First check whether this session's changes are docs-only: `git status` and classify every touched path.
If everything touched is under `docs/`, or is `CHANGELOG.md`, `DECISIONS.md`, or `TASK_BOARD.md`, skip
the check and report: "3. Test gate — skipped, this session was docs-only." Otherwise, confirm
`testing/tests/engine-parity.html` was run this session and passed the *current* baseline (read
`testing/expected/expected-results.csv` — don't assume a fixed pass count). If you can't confirm it was
run, say so rather than assuming it passed.

**4. Working tree state**
`git status` — confirm nothing is uncommitted or unstaged that belongs to this session's work. Anything
created this session that isn't committed yet is at risk in a shared checkout — commit it now rather than
leaving it as an untracked/uncommitted file.

**5. This session's branch/worktree**
If this session used a `.claude/worktrees/<slug>` worktree (per `/run-task`), confirm it was exited and
removed (`ExitWorktree(action: "remove")`) after its PR opened. If it's still there, say so and ask
whether to remove it now.

**6. Repo-wide branch and worktree sweep**
This is separate from #5 — it looks at *all* worktrees and local branches, not just this session's:
```
git worktree list
git branch -vv
git fetch origin --prune
```
For each local branch/worktree, report:
- **Merged & safe to clean up** — its PR has merged (check with the `pull_request_read` /
  `list_pull_requests` MCP tools for `state: merged, head: <branch>`, or `git log origin/main..<branch>`
  / `origin/preview..<branch>` being empty) but the local branch/worktree still exists. Flag these as
  cleanup candidates.
- **Active elsewhere** — has real commits ahead of `preview`/`main` and no merged PR. Leave alone, just
  note it exists (likely another session's in-flight work).
- **Orphaned** — local branch whose remote counterpart was deleted (shows `: gone]` in `git branch -vv`)
  but the local ref/worktree wasn't cleaned up. Flag as a cleanup candidate.

Never delete or remove anything in this step without the user explicitly saying to — just report.

**7. preview / main sync status**
```
git fetch origin
git log origin/main..origin/preview
```
If `preview` has commits not yet on `main`, say so and ask whether to promote now or leave it queued for
later.

**8. Open PRs from this session**
Any PR opened this session that's still unmerged — list it and ask if it needs a decision now.

**9. Cross-project hints**
Did this session surface a lesson general to AI-assisted coding, not specific to PACT (e.g. a
cross-platform gotcha, a git/worktree pattern, a prompting/agent-design lesson)? If yes, draft a
candidate entry — a one-line trigger (the concrete scenario) plus a one-line generalized rule —
and list "push it to `ai-lessons-learned`" as one of the lettered follow-up actions. Don't write
it anywhere without approval, same as every other action in this skill. If nothing general came
up, say so and skip this.

## Output format

Give a short punch list, grouped by the numbers above — done / not needed / needs action.

For anything that needs a decision, use the tiered format from `AGENTS.md`'s Communication conventions —
don't ask yes/no one at a time. By default, group every actionable follow-up (merges, branch cleanup,
pushing a drafted note, etc.) under **one** top-level lettered question — e.g. "**A.** What should we run
to close out?" — with options **A1**, **A2**, **A3**… underneath. If a genuinely separate decision doesn't
fit that "run this action" shape (e.g. *when* to promote `preview` → `main` is a scheduling call, not a
checklist item), give it its own letter (**B**, **C**…) instead of folding it into the same list.

**Tag every option Recommended or Not recommended — with a reason, every time**, using the same bar as
`AGENTS.md`: default to Recommended; withhold only when the action is destructive/hard to reverse, is a
judgment call only the user can make, or depends on information not yet available. A clean, already-tested
PR waiting on a merge, an already-merged branch waiting on cleanup, or an already-drafted note waiting on
a push are exactly the kind of thing that defaults to Recommended — don't hold them back "to be safe" once
they've already cleared their own gate (tests passed, review done, merge confirmed).

Recommending an action never means running it unprompted — this skill stays report-only. Ask once which
letters to run, e.g. "Run A1 and A3? Say the letters, or 'none'," and wait for that single reply rather
than confirming each item separately. If the `AskUserQuestion` tool is used for this instead of plain
text, follow `AGENTS.md`'s rule for it: retry once on a tool error before assuming anything, and restate
which letters were chosen before acting on them.

End with a one-line verdict: clear to close, or not yet (and why).

---

$ARGUMENTS
