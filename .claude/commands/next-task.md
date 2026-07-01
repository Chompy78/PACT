# PACT — work the next roadmap task

You are a task-execution assistant for the **PACT** project. Multiple Claude Code sessions may be running
against this repo in parallel, each in its own git worktree — never work directly in the shared checkout.

## Step 1 — read live context

**Don't trust the checked-out working tree** — another parallel session can `git checkout` a different
branch in this same shared folder between the time you read a file and the time you act on it (this has
actually happened). Read the *true* shared state straight from the remote instead:

```
git fetch origin
git show origin/preview:AGENTS.md
git show origin/preview:docs/PACT_ROADMAP.md
git show origin/preview:testing/tests/engine-parity.html
git show origin/preview:testing/expected/expected-results.csv
```

Use them for: current per-change checklist, branch naming (`type/short-slug`), and whether the parity
baseline (the CSV row count / fixture list from `engine-parity.html`) currently covers more than the
original 5 fixtures — don't assume a fixed pass count, read what's actually there right now.

Only fall back to reading the working-tree copies of these files if `git show origin/preview:...` fails
(e.g. no network) — and say so if you do.

## Step 2 — pick the task

If `$ARGUMENTS` names a specific task (title, slug, or code like `CU-4`), use that one — this lets you run
several sessions in parallel against different tasks without them colliding.

Otherwise: pick the highest-priority `— TODO` in the 🔴 NOW bucket, top to bottom, **skipping any task
explicitly marked blocked/waiting** (e.g. "after promoting preview → main"). If NOW has no unblocked task,
fall through to the top unblocked `— TODO` in 🟡 NEXT and say you did so.

Tell me which task you picked with a one-line summary. **WAIT for my OK before changing anything.**

## Step 3 — pre-flight checks (after I confirm)

1. **Collision check.** Derive the branch name `type/short-slug`. Run:
   ```
   git ls-remote --heads origin <type/short-slug>
   git branch --list <type/short-slug>
   ```
   If either shows the branch already exists, **stop and report it** — don't silently pick a different
   task or overwrite it. Someone (you, or another parallel session) is already on this.
2. **Effort check — hard stop.** This kind of investigate-and-fix task benefits from higher reasoning
   effort than routine edits. If this session isn't already running at High effort (or better), stop here
   and tell me — this is a second, separate checkpoint from Step 2's OK. Do not proceed to Step 4 until I
   explicitly reply to continue at the current effort or confirm the session has been bumped to High.

## Step 4 — set up the worktree

Never `cd` into the shared PACT checkout for this work. Use absolute paths / `git -C <path>` for every git
command so nothing depends on a persisted working directory.

```
git fetch origin
git worktree add -b <type/short-slug> C:\Users\JohnChow\pact-worktrees\<short-slug> origin/preview
```

Do ALL reading, editing, and testing inside `C:\Users\JohnChow\pact-worktrees\<short-slug>` for the rest of
this task.

## Step 5 — do the work

Work token-efficiently per `AGENTS.md`: read each file once, grep instead of reading whole files, one
editing pass, no re-reads. Don't touch `js/engine.js` unless this task targets the engine.

Follow the per-change checklist:
- Run the test gate (`testing/tests/engine-parity.html`) and confirm it matches the **current** expected
  baseline from Step 1 — not a hardcoded "5/0".
- Update `CHANGELOG.md` (always) and `DECISIONS.md` (if the change has a non-obvious *why*).
- Graduate the task out of `docs/PACT_ROADMAP.md` into `CHANGELOG.md` in the same change.

## Step 6 — sync before opening the PR

Before pushing, bring the branch up to date with the latest `preview` in case it moved during this task:
```
git -C C:\Users\JohnChow\pact-worktrees\<short-slug> fetch origin
git -C C:\Users\JohnChow\pact-worktrees\<short-slug> rebase origin/preview
```
Resolve conflicts if any appear, then re-run the test gate.

## Step 7 — push and open the PR

Push the branch and open a PR into `preview`. Draft the PR body from the CHANGELOG entry.

## Step 8 — clean up the worktree

After the PR is open, remove the worktree (leave the branch itself alone — branch pruning is CU-4's job,
not this task's):
```
git worktree remove C:\Users\JohnChow\pact-worktrees\<short-slug>
```

---

$ARGUMENTS
