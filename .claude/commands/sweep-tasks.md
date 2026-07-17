---
description: Autonomously work through every low-effort/low-risk TODO on the roadmap — pick, execute, review, merge, repeat — adding any newly-surfaced tasks to the board along the way
argument-hint: [batch size, e.g. 6] [difficulty/topic filter]
---

# PACT — sweep the roadmap's quick, safe work

This is the unattended version of `/pick-task` → `/run-task` → `/code-review` → merge, run in a
loop over every eligible task instead of one at a time with a human confirming each step. It exists
for exactly one shape of request: *"go do the easy safe stuff without asking me each time."* If the
board has nothing tagged eligible (see Step 2), say so plainly and stop — this is a legitimate
outcome, not a failure to route around.

**Requires `/add-task`'s Effort/Risk tags** (see that file's "Effort / Risk tags" section — this
skill and that one must stay in sync on the classification criteria). A task with no Effort/Risk
line, or any rating above `Effort: medium` / `Risk: low`, is **never** eligible — this skill does
not re-derive judgment about a task's safety from its prose; it only trusts the explicit tags
`/add-task` (or this skill's own Step 5, for newly-discovered tasks) already assigned.

**Merge-as-you-go is the fixed behavior of this skill** — every PR it opens gets merged once its own
checks pass, with no per-run prompt (that's a settled default, not something to re-ask each
invocation). This skill never promotes `preview` → `main` — that stays a separate, explicit, human-
initiated action every time, same as any other PR workflow in this repo.

## Step 1 — get live state

Delegate to an `Explore`-type subagent (`Agent` tool), same reasoning as `/pick-task` Step 1 — keep
this session's own context clean and avoid trusting whatever's sitting in the shared checkout right
now. Have it run:

```
git fetch origin
git show origin/preview:AGENTS.md
git show origin/preview:docs/TASK_BOARD.md
git show origin/preview:testing/expected/expected-results.csv
```

Ask it to return: the branch-naming convention, the current expected pass count (data rows in
`expected-results.csv`), and **every** `— TODO` task in NOW/NEXT/LATER verbatim, including each
one's `**Effort:** ... **Risk:** ...` tag line if present (state plainly which tasks have no such
line at all). If `git show` fails, fall back to local files and say so.

## Step 2 — build the eligible queue

Filter to tasks where **both** are true:
- `Effort:` is `low` or `medium` (never `high`)
- `Risk:` is `low` (never `medium`/`high`, regardless of how low the effort looks)

Untagged tasks are excluded — don't infer a rating for them, don't ask the user to supply one
inline, just skip them (they're for a human, or a future `/add-task` pass, to tag).

Order survivors NOW → NEXT → LATER, same priority order `/pick-task` uses by default.

**Batch size:** if `$ARGUMENTS` includes a number, use it as the cap. If not, ask once via
`AskUserQuestion` — "How many tasks should this sweep attempt?" with a recommended default around
5-8 and an option for a custom number — before doing anything else. This is the only prompt this
skill makes to the user; everything after this point runs unattended.

If zero tasks are eligible, report that plainly (list what's on the board and why each is excluded
— untagged, effort too high, risk too high) and stop. Don't lower the bar to manufacture work.

## Step 3 — pre-flight each candidate

For each candidate, in priority order, until you have `cap` surviving candidates or run out of
eligible tasks:
```
git ls-remote --heads origin <type/short-slug>
git branch --list <type/short-slug>
```
If the branch already exists, someone (possibly another session) is already on it — drop this
candidate (don't touch that branch) and move to the next eligible one down the list; don't stop
early just because one candidate was taken. Report which candidates got skipped this way, if any.

Use `TaskCreate` to log the surviving queue (one task per roadmap item) so progress is visible and
survives a context compaction mid-sweep; mark each `in_progress` when you start it, `completed` when
its PR merges (or leave it and note the park/drop reason if it doesn't).

## Step 4 — execute each task in the queue, in order

For each surviving candidate:

1. **Invoke `/run-task <type/short-slug>`** (single-slug form) via the `Skill` tool. This handles
   the worktree, the edit, the parity/audit gate, the rebase, and opening the PR. If `/run-task`
   itself determines mid-work that the task is bigger than it looked (its own Step 5 escape hatch),
   let it drop the task and leave the roadmap entry alone — record that outcome and move on to the
   next queued task. Don't attempt to force it through yourself.

2. **Determine the review tier**, per `AGENTS.md`'s own rule: if the PR touches `js/engine.js` or
   `sql/`, that's the higher-scrutiny tier (`ultra`, or this environment's max-effort fallback);
   otherwise `low` effort is enough (a small, single-purpose PR doesn't need more).

3. **Run `/code-review <tier> PR #<n>`** via the `Skill` tool against the PR `/run-task` just opened.

4. **If real (CONFIRMED, or a genuinely load-bearing PLAUSIBLE) findings survive:** re-enter that
   branch to fix them — `/run-task`'s own Step 8 already tore the worktree down, so this is a fresh
   entry, not a continuation:
   ```
   EnterWorktree(name: "<type/short-slug>")
   git fetch origin <type/short-slug>
   git reset --hard origin/<type/short-slug>
   git branch -m <type/short-slug>
   ```
   Apply the fix, re-run the parity gate (and `audit.py` if the change is code, not docs), commit,
   `git fetch origin preview && git rebase origin/preview`, re-verify, `git push` (use
   `--force-with-lease` if the rebase replayed commits — check `git rev-parse HEAD` against
   `origin/<branch>` first, same caution `/run-task`/`/cleanup-branches` already use elsewhere).
   Then `ExitWorktree(action: "remove", discard_changes: true)` once you've confirmed the tip is
   pushed and reflected in the PR.

   **If a finding needs a genuine redesign, not a small fix — park it, don't force it.** Note the
   finding in the sweep's final report as something for a human to look at; still merge the rest of
   the PR if the finding isn't a real correctness bug (a cleanup/altitude finding can wait), or park
   the whole task (leave the roadmap entry alone, don't merge) if it is.

5. **Merge the PR** (`merge_pull_request`, method `merge`) once its checks pass and any real findings
   are resolved. Mark the `TaskCreate` entry `completed`.

## Step 5 — new tasks discovered mid-sweep

If executing a task (or reviewing it) surfaces a genuinely new, separate piece of work — same as
`D-GH-2026-07-16-audit-search-path-pg-temp-check` spinning out of the `pg_temp` hardening PR earlier
this session — format it in `/add-task`'s exact house format, **including the Effort/Risk tag line**
(classify it yourself using that file's criteria), and commit it directly to `preview` the way
`/add-task`'s own Step 4 does — but **skip that skill's Step 2 (clarifying questions) and Step 3
(wait for human approval)**: this skill runs unattended by design, so the add-and-classify step must
not block on a prompt. This is a deliberate, documented divergence from `/add-task`'s normal
interactive flow, not an oversight — don't "fix" it back to asking.

If the newly-added task itself clears the same `Effort: low|medium` / `Risk: low` bar, fold it into
*this run's* queue (append it, respecting the batch-size cap from Step 2) rather than waiting for a
future invocation to pick it up — this is what actually happened with PR #239 today. If it doesn't
clear the bar, it just sits on the board for a human or a future `/pick-task` to handle normally.

## Step 6 — final report

A short table: task · branch · PR # · effort/risk · outcome (merged / parked / dropped at
pre-flight) · any new tasks discovered and whether they were also executed this run. State plainly:
`preview` is now ahead of `main` by N commits (or unchanged, if nothing merged) — promoting is a
separate call, not something this skill does on its own. If anything was parked with a real finding
attached, surface it clearly enough that a human can pick it up without re-deriving context.

---

$ARGUMENTS
