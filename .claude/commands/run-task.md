---
description: Do the work for one or more roadmap tasks picked by /pick-task — worktree, edit, test, rebase, PR (requires Claude Code v2.1.50+)
argument-hint: <type/short-slug> [<type/short-slug> ...]
---

# PACT — work the roadmap task(s)

`$ARGUMENTS` is one `<type/short-slug>`, or several space-separated ones handed off together as an
explicitly-approved batch from `/pick-task`'s batch option. This command does the actual work: worktree,
edit, test, rebase, push, PR. **Requires Claude Code v2.1.50 or later** (native `--worktree` /
`EnterWorktree` support). If `/pick-task` hasn't been run yet this session, ask for its output first —
this command doesn't re-derive the task(s) or re-run the pre-flight checks itself.

**Single slug:** follow every step below literally, one task, one branch, as always.
**Multiple slugs:** everything through Step 5 happens *per task*; Steps 6-8 (rebase, PR, cleanup) happen
*once* for the whole batch. This is the one exception to "one task per branch" (see `AGENTS.md`) — it's
only valid because `/pick-task` already confirmed every member is independently low-risk and touches no
overlapping files.

**Engine check.** `/pick-task`'s Check 2 also worked out a suggested engine tier (Haiku/Sonnet/Opus) and
effort level per task — restate it here before starting Step 4. This command inherits whatever model the
session is already running; it does not and cannot switch it. If the running model doesn't match what
`/pick-task` suggested, stop and tell the user to run `/model <engine>` first, then re-invoke `/run-task`
— don't silently proceed on the wrong tier.

## Step 4 — enter your own worktree

Don't work inside the shared PACT folder for this task. Use the native worktree tool instead of manual
`git worktree` commands. For a single slug, name the worktree after it directly:

```
EnterWorktree(name: "<type/short-slug>")
```

For a batch of multiple slugs, there is no single natural branch name — derive one instead: take the
`type` from the primary (first) slug, and join every slug's short-slug part (the bit after `/`) with
`-`, e.g. `docs/qa-checklist` + `docs/rules-review-note` → `docs/qa-checklist-rules-review-note`. If that
would run long (more than ~50 chars), shorten to `<type>/batch-<first-short-slug>-plus<N-1>`.

**This does not produce the branch name you'd expect — verify before moving on.** `EnterWorktree`
sanitizes `/` out of `name`: passing `feat/short-slug` creates the worktree at
`.claude/worktrees/feat+short-slug` on a branch called `worktree-feat+short-slug`, not `feat/short-slug`.
(Verified directly: `EnterWorktree(name: "verify/branch-rename")` produced worktree directory
`verify+branch-rename` and branch `worktree-verify+branch-rename`.) After entering, rename the branch to
the real slug (or the derived batch name):

```
git branch -m <type/short-slug>
```

This rename is reliable — `git branch -m` accepts the slash-containing name fine even though the
directory it's renaming *from* had `+` in it (verified: `git branch -m verify/branch-rename` succeeded
cleanly, `git status` came back empty, and the resulting `git worktree list` showed the correct branch
name against the `+`-named directory). The worktree **directory** keeps its `+`-form name — that's
cosmetic and fine, since pushes/PRs key off the branch name, not the directory path. Confirm with
`git branch --show-current` that it now reads `<type/short-slug>` (or the batch name) before proceeding
to Step 5.

From here on, all reading, editing, and testing happens inside the worktree session — no `-C <path>`
needed on any git command, since the session's working directory is already there. **After every context
continuation or resumed turn, re-verify with `pwd`/`git rev-parse --show-toplevel` before the first
`Edit`/`Write` call** — don't assume a prior `EnterWorktree` call's directory context survived; absolute
paths silently write wherever they point, worktree or not.

## Step 5 — do the work

For each task slug, in order: be efficient (read each file once, search instead of reading whole files
when you can, one clean edit pass), and only touch `js/engine.js` if that specific task is about the
game engine. Add a line to `CHANGELOG.md` and remove the task's entry from `docs/PACT_ROADMAP.md` in the
**same commit** as that task's edit — don't defer either to a later combined commit, since each task
must stay independently traceable even though several share a branch. Add a `DECISIONS.md` note too if
that task's change involved a non-obvious reason behind a choice you made. Commit each task separately
(one commit per task) before moving to the next slug.

If a task turns out — once you're actually in the code — to not be as small/isolated as `/pick-task`
assumed, or its edit collides with an earlier task's in this same batch, stop and flag it rather than
forcing it through: pull it out of the batch (leave its roadmap entry alone, don't graduate it), finish
the rest, and say clearly in the hand-off which task got dropped and why.

Once every surviving task's commit is made, run the test suite (`testing/tests/engine-parity.html`) once
against the combined diff and check it matches the pass count `/pick-task` reported — not a hardcoded
number.

## Step 6 — catch up before opening the PR

Other work may have landed on `preview` while you were busy. Bring your branch up to date (once, for the
whole batch):
```
git fetch origin
git rebase origin/preview
```

**If the rebase reports a non-trivial conflict, stop and show the affected files/hunks before
continuing.** Don't resolve it silently and don't treat `/pick-task`'s earlier hand-off as authorization
to push through a conflict — that's exactly the kind of judgment call that needs a human look. Once
resolved (by you, trivially, or by the user's direction), re-run the tests.

## Step 7 — push and open the pull request

Push your branch and open **one** PR targeting `preview`. For a single task, use your `CHANGELOG.md`
entry as the starting point for the PR description. For a batch, list every bundled task as its own
bullet in the summary (title + one line each, drawn from each task's own `CHANGELOG.md` entry) so a
reviewer can see it's several independent small changes riding one branch, not one entangled change.

## Step 8 — clean up

Once the PR is open, exit and remove your worktree (leave the branch itself — cleaning up old branches is
a separate task, see `/cleanup-branches`):

```
ExitWorktree(action: "remove")
```

---

$ARGUMENTS
