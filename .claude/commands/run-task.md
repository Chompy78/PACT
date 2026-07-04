---
description: Do the work for a roadmap task picked by /pick-task — worktree, edit, test, rebase, PR (requires Claude Code v2.1.50+)
argument-hint: <type/short-slug>
---

# PACT — work the roadmap task

`$ARGUMENTS` is the `<type/short-slug>` that `/pick-task` handed off. This command does the actual work:
worktree, edit, test, rebase, push, PR. **Requires Claude Code v2.1.50 or later** (native `--worktree` /
`EnterWorktree` support). If `/pick-task` hasn't been run yet this session, ask for its output first —
this command doesn't re-derive the task or re-run the pre-flight checks itself.

## Step 4 — enter your own worktree

Don't work inside the shared PACT folder for this task. Use the native worktree tool instead of manual
`git worktree` commands:

```
EnterWorktree(name: "<type/short-slug>")
```

**This does not produce the branch name you'd expect — verify before moving on.** `EnterWorktree`
sanitizes `/` out of `name`: passing `feat/short-slug` creates the worktree at
`.claude/worktrees/feat+short-slug` on a branch called `worktree-feat+short-slug`, not `feat/short-slug`.
(Verified directly: `EnterWorktree(name: "verify/branch-rename")` produced worktree directory
`verify+branch-rename` and branch `worktree-verify+branch-rename`.) After entering, rename the branch to
the real slug:

```
git branch -m <type/short-slug>
```

This rename is reliable — `git branch -m` accepts the slash-containing name fine even though the
directory it's renaming *from* had `+` in it (verified: `git branch -m verify/branch-rename` succeeded
cleanly, `git status` came back empty, and the resulting `git worktree list` showed the correct branch
name against the `+`-named directory). The worktree **directory** keeps its `+`-form name — that's
cosmetic and fine, since pushes/PRs key off the branch name, not the directory path. Confirm with
`git branch --show-current` that it now reads `<type/short-slug>` before proceeding to Step 5.

From here on, all reading, editing, and testing happens inside the worktree session — no `-C <path>`
needed on any git command, since the session's working directory is already there.

## Step 5 — do the work

Be efficient: read each file once, use search instead of reading whole files when you can, and make your
edits in one clean pass rather than going back and forth. Only touch `js/engine.js` if this specific task
is about the game engine — otherwise leave it alone.

Before calling it done:
- Run the test suite (`testing/tests/engine-parity.html`) and check it matches the pass count
  `/pick-task` reported — not a hardcoded number.
- Add a line to `CHANGELOG.md` (always). Add a note to `DECISIONS.md` too, if this change involved a
  non-obvious reason behind a choice you made.
- Remove the task from `docs/PACT_ROADMAP.md` and move it into `CHANGELOG.md`, in this same change.

## Step 6 — catch up before opening the PR

Other work may have landed on `preview` while you were busy. Bring your branch up to date:
```
git fetch origin
git rebase origin/preview
```

**If the rebase reports a non-trivial conflict, stop and show the affected files/hunks before
continuing.** Don't resolve it silently and don't treat `/pick-task`'s earlier hand-off as authorization
to push through a conflict — that's exactly the kind of judgment call that needs a human look. Once
resolved (by you, trivially, or by the user's direction), re-run the tests.

## Step 7 — push and open the pull request

Push your branch and open a PR targeting `preview`. Use your `CHANGELOG.md` entry as the starting point
for the PR description.

## Step 8 — clean up

Once the PR is open, exit and remove your worktree (leave the branch itself — cleaning up old branches is
a separate task, see `/cleanup-branches`):

```
ExitWorktree(action: "remove")
```

---

$ARGUMENTS
