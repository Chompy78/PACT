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
- `docs/sessions/<date>-<topic>.md` — only needed if this session involved real discussion or spanned
  multiple areas worth preserving. Most single-task sessions don't need this — say so if you skip it.
  **If a note for this session already exists, don't just confirm it exists — re-read its content against
  everything that's happened since it was last written.** A note written mid-session goes stale the moment
  more work happens after it (e.g. this same `/close-session` pass surfacing a decision that gets acted on,
  a rebase, a merge). Check its content, not just its presence, every time this step runs.

**2. Roadmap graduation**
If a `docs/PACT_ROADMAP.md` task was completed this session, confirm it was actually moved into
`CHANGELOG.md` in the same change, not just left checked off or forgotten in the roadmap.

**3. Test gate**
Confirm `testing/tests/engine-parity.html` was run this session and passed the *current* baseline (read
`testing/expected/expected-results.csv` — don't assume a fixed pass count). If you can't confirm it was
run, say so rather than assuming it passed.

**4. Working tree state**
`git status` — confirm nothing is uncommitted or unstaged that belongs to this session's work. Anything
created this session that isn't committed yet is at risk in a shared checkout — commit it now rather than
leaving it as an untracked/uncommitted file.

**5. This session's branch/worktree**
If this session used a `pact-worktrees/<slug>` worktree (per `/next-task`), confirm it was removed with
`git worktree remove` after its PR opened. If it's still there, say so and ask whether to remove it now.

**6. Repo-wide branch and worktree sweep**
This is separate from #5 — it looks at *all* worktrees and local branches, not just this session's:
```
git worktree list
git branch -vv
git fetch origin --prune
```
For each local branch/worktree, report:
- **Merged & safe to clean up** — its PR has merged (check with `gh pr list --state merged --head <branch>`
  or `git log origin/main..<branch>` / `origin/preview..<branch>` being empty) but the local branch/worktree
  still exists. Flag these as cleanup candidates.
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

## Output format

Give a short punch list, grouped by the numbers above — done / not needed / needs action.

For anything that needs a decision, don't ask yes/no one at a time — list every possible further action
as a flat, numbered set (`A1`, `A2`, `A3`, ...) at the end of the report, each one line: what it does and
why it's listed. Then ask once which ones (if any) to run, e.g. "Run A1 and A3? Say the letters, or 'none'."
Wait for that single reply rather than confirming each item separately.

End with a one-line verdict: clear to close, or not yet (and why).

---

$ARGUMENTS
