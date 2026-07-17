---
description: Autonomously work through every low/medium-risk TODO on the roadmap — pick, execute, review, merge, repeat — adding any newly-surfaced tasks to the board along the way
argument-hint: [batch size, e.g. 6]
---

# PACT — sweep the roadmap's quick, safe work

This is the unattended version of `/pick-task` → `/run-task` → `/code-review` → merge, run in a
loop over every eligible task instead of one at a time with a human confirming each step. It exists
for exactly one shape of request: *"go do the safe stuff without asking me each time."* If the
board has nothing tagged eligible (see Step 2), say so plainly and stop — this is a legitimate
outcome, not a failure to route around.

**Requires `/add-task`'s Effort/Risk tags** (see that file's "Effort / Risk tags" and "Risk — three
named factors" sections — this skill and that one must stay in sync on the classification criteria).
A task with no Effort/Risk line, or `Risk: high`, is **never** eligible, no matter how low Effort
is — Risk is the only safety gate, and `high` is an absolute veto with no exception. Effort doesn't
filter eligibility at all; it's used for queue ordering and review-tier sizing (Step 2, Step 4). This
skill does not re-derive judgment about a task's safety from its prose; it only trusts the explicit
tags `/add-task` (or this skill's own Step 5, for newly-discovered tasks) already assigned.

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
line at all).  If `git show` fails, fall back to local files and say so.

## Step 2 — build the eligible queue

Filter to tasks where `Risk:` is `low` or `medium` — **`Risk: high` is never eligible, full stop,
regardless of Effort.** Effort is not filtered (a `high`-effort task with `Risk: low`/`medium` is
still eligible), but does affect ordering below.

Untagged tasks are excluded — don't infer a rating for them, don't ask the user to supply one
inline, just skip them (they're for a human, or a future `/add-task` pass, to tag). List them in the
final report (Step 6) rather than silently dropping them from view.

**Order:** priority first (NOW → NEXT → LATER, same as `/pick-task`'s default), then within the same
priority tier, Effort ascending (`low` before `medium` before `high`) as a tiebreak — this fits more
completed tasks into a fixed batch-size cap and keeps one large task from eating a whole run's budget
before smaller ones get a turn.

**Batch size:** use `$ARGUMENTS` as the cap only if, after trimming whitespace, it is a **bare
positive integer and nothing else** (e.g. `6`). Any other shape — free-form text that happens to
contain a digit (a version number, a PR reference), multiple numbers, zero, or a negative number —
does **not** count as "includes a number"; treat it the same as no number given. If not, ask once
via `AskUserQuestion` — "How many tasks should this sweep attempt?" with a recommended default
around 5-8 and an option for a custom number — before doing anything else. This is the only prompt
this skill makes to the user; everything after this point runs unattended.

If zero tasks are eligible, report that plainly (list what's on the board and why each is excluded —
untagged, or `Risk: high`) and stop. Don't lower the bar to manufacture work.

## Step 3 — pre-flight each candidate

For each candidate, in queue order, until you have `cap` surviving candidates or run out of eligible
tasks:
```
git ls-remote --heads origin <type/short-slug>
git branch --list <type/short-slug>
```
If the branch already exists, someone (possibly another session) is already on it — drop this
candidate (don't touch that branch) and move to the next eligible one down the list; don't stop
early just because one candidate was taken. Report which candidates got skipped this way, if any.
**This kind of skip doesn't count toward the circuit breaker in Step 4** — it means the task is
unavailable, not that anything went wrong.

Use `TaskCreate` to log the surviving queue (one task per roadmap item) so progress is visible and
survives a context compaction mid-sweep; mark each `in_progress` when you start it. On any
**terminal** outcome — merged, parked, or dropped — mark it `completed` regardless of which one
happened, and record the actual outcome and reason in the task's own note/description (e.g. prefix
it `MERGED:`, `PARKED:`, or `DROPPED:`). Never leave a resolved task sitting at `in_progress` — that
status must mean "still being worked," full stop, so a resumed sweep can tell a genuinely-interrupted
task apart from one that was already resolved before the interruption. **If resuming an interrupted
sweep** (context compaction, session restart mid-run), check `TaskList` first — pick up the existing
queue's state rather than re-picking and potentially re-attempting an already-resolved task from
scratch.

**Backfilling drops/parks:** the queue built above has exactly `cap` candidates, but a pre-flight
drop (this step) or a mid-run park/drop (Step 4) removes one without necessarily tripping the
circuit breaker. When that happens, pull the next eligible candidate (in the same priority/Effort
order from Step 2) from the full eligible list and add it to the queue with `TaskCreate`, so the
number of tasks actually *attempted* stays at or near `cap` rather than silently shrinking. Do this
before moving to the next queue slot, not after the whole queue drains. Note in Step 6 whenever a
backfill happened and which task it replaced.

## Step 4 — execute each task in the queue, in order

Track a **consecutive-failure counter**, starting at 0. A "failure" for this purpose is: `/run-task`
dropping a task as bigger-than-expected, an unresolvable rebase conflict, a code-review finding that
required parking rather than fixing, or a failed CI check that couldn't be fixed and re-pushed.
Reset the counter to 0 on every successful merge. **If the counter reaches 2, stop the sweep
immediately** — don't attempt the rest of the queue. A string of consecutive failures almost always
means something is wrong *outside* any one task (broken CI, a shared file everyone's touching, a
miscalibrated classification), not that the next task will happen to succeed. Report clearly in
Step 6 that the sweep stopped early, list the failures, and don't guess at a root cause beyond what's
directly observable — that's for the human to look at.

For each surviving candidate:

1. **Invoke `/run-task <type/short-slug>`** (single-slug form) via the `Skill` tool. This handles
   the worktree, the edit, the parity/audit gate, the rebase, and opening the PR. If `/run-task`
   itself determines mid-work that the task is bigger than it looked (its own Step 5 escape hatch),
   let it drop the task and leave the roadmap entry alone — record that outcome, count it toward the
   circuit breaker, and move on to the next queued task. Don't attempt to force it through yourself.
   **Capturing the PR number `<n>`** (needed by items 2 and 4 below): `/run-task`'s own final step
   states the PR it opened, including its number/URL — read that from its output. If it isn't
   clearly stated there, call `list_pull_requests` filtered to head branch `<type/short-slug>` and
   take the number from that instead of guessing.

2. **Diff-size sanity check.** Call `pull_request_read` (method `get_files`) on the PR `/run-task`
   just opened. Compare the actual changed-file count against what the task's `Effort` tag implies
   (`low` → expect ~1-2 files; `medium` → expect ~2-5; `high` has no fixed expectation). **Exception:**
   a uniform, one-line change repeated identically across many call sites — the "mechanical batch"
   pattern `/add-task`'s own Effort:medium examples call out (e.g. the same hardening line applied to
   every `SECURITY DEFINER` function) — is expected to touch more files than the band without
   signaling misclassification; judge the diff's *shape* (is every hunk the same one-line pattern?),
   not just its file count, before flagging. If the real diff is notably larger *and* shaped
   differently than the tag implied, or touches `js/engine.js`/`sql/` when the task's own text never
   mentioned either, that's a signal the classification may have been wrong — **don't auto-park** (the
   work is done and may be fine), but treat it as if the task's Risk were one tier worse than tagged
   for the purposes of step 3 below, and say so explicitly in the final report so the classification
   can be corrected for next time.

3. **Determine the review tier from Risk, not file path** (bumped one tier if step 2 flagged a
   size mismatch): `Risk: low` → `/code-review low`. `Risk: medium` → `/code-review medium`. A
   `Risk: medium` task bumped a tier by step 2 has no higher named tier to bump *to* under this
   skill's two-tier scale — treat that case the same as the hard override below: use the
   higher-scrutiny `ultra` tier (or this environment's max-effort fallback). Any PR that touches
   `js/engine.js` or `sql/` gets at least that same higher-scrutiny tier regardless of its Risk tag —
   that's a hard rule from `AGENTS.md` independent of this skill's own scoring, not a suggestion this
   step can downgrade.

4. **Run `/code-review <tier> PR #<n>`** via the `Skill` tool against the PR `/run-task` just opened.

5. **If real (CONFIRMED, or a genuinely load-bearing PLAUSIBLE) code-review findings survive:**
   re-enter that branch to fix them — `/run-task`'s own Step 8 already tore the worktree down, so
   this is a fresh entry, not a continuation. `/run-task`'s own Step 4 already verifies a fresh
   worktree's base correctly, and the `reset --hard origin/<type/short-slug>` below fully overwrites
   whatever base `EnterWorktree` silently picked — nothing further to check on that front here:
   ```
   EnterWorktree(name: "<type/short-slug>")
   git fetch origin <type/short-slug>
   git reset --hard origin/<type/short-slug>
   git branch -m <type/short-slug>
   ```
   **If that last rename fails ("a branch named ... already exists"):** the stray local branch is
   `EnterWorktree`'s own auto-generated `worktree-<slug>` name from an earlier worktree/session (see
   `run-task.md`) — this happened twice in the session this skill was built from. Don't fight it:
   `git checkout <type/short-slug>` directly instead (skip the rename), and once you're safely
   checked out on the real branch, `git branch -D worktree-<slug>` (using that same auto-generated
   name) if it's now pointless.

   Apply the fix, re-run the parity gate (and `audit.py` if the change is code, not docs), commit,
   `git fetch origin preview && git rebase origin/preview`.

   **If the rebase reports a non-trivial conflict, don't resolve it silently** — same rule
   `/run-task`'s own Step 6 already follows (this mirrors that file's rebase-conflict-abort rule
   directly; if that rule ever changes, check this reference too). Abort the rebase
   (`git rebase --abort`), park this task (leave its roadmap entry alone, don't merge its PR), count
   it toward the circuit breaker, note the conflict in the final report for a human to resolve, then
   `ExitWorktree(action: "keep")` — **do not remove it**, so the human resolving the conflict has the
   actual conflicted state to look at instead of having to reconstruct it; name the worktree's path
   in the final report so it's a visible, tracked leftover rather than a silent one — and move on to
   the next queued task.

   Otherwise, re-verify, `git push` (use `--force-with-lease` if the rebase replayed commits — check
   `git rev-parse HEAD` against `origin/<branch>` first, same caution `/run-task`/`/cleanup-branches`
   already use elsewhere). Then `ExitWorktree(action: "remove", discard_changes: true)` once you've
   confirmed the tip is pushed and reflected in the PR.

   **If a finding needs a genuine redesign, not a small fix — park it, don't force it.** Note the
   finding in the sweep's final report as something for a human to look at; still merge the rest of
   the PR if the finding isn't a real correctness bug (a cleanup/altitude finding can wait) — in that
   case `ExitWorktree(action: "remove", discard_changes: true)` as usual once merged. If it is a real
   bug, park the whole task (leave the roadmap entry alone, don't merge, count toward the circuit
   breaker) and `ExitWorktree(action: "keep")` for the same reason as the conflict case above — a
   human needs the actual state, not a torn-down worktree, to pick the redesign up.

6. **Live/real-verification requirement for anything above `Risk: low`** — done last, against
   whatever actually ends up merging (after any step-5 fix), not before. A task tagged `Risk: medium`
   or flagged up to it by step 2 must have some form of real verification beyond the parity gate
   before merging — a real-browser check for UI, a direct query against the live DB for a SQL change,
   or equivalent for whatever the task actually touches (match the method to the task, the way
   today's `gen_random_bytes` fix was verified with a real `INSERT INTO campaigns` and the iOS hint
   was verified with a spoofed-UA Playwright run). If `/run-task` already did this as part of its own
   work *and* step 5 made no fix that would invalidate it, that's sufficient — otherwise do it
   yourself now, against the final code, before moving to the merge step. If no practical
   live-verification method exists for this particular task, say so explicitly in the final report
   rather than silently skipping the requirement.

7. **Check CI status, then merge.** Call `pull_request_read` (method `get_status`, or
   `get_check_runs` for per-workflow detail) on the PR. If any check is still running, poll briefly
   (this repo's CI finishes in seconds to low minutes — not worth a long wait loop) before deciding;
   if a check has genuinely failed, treat that the same as a real code-review finding (fix and
   re-push, or park — and count toward the circuit breaker). If there are no checks configured for
   this PR at all (common in this repo today — several existing workflows only trigger on specific
   file paths), that's not a blocker, just nothing to wait on. Once clear, merge
   (`merge_pull_request`, method `merge`), mark the `TaskCreate` entry `completed`, and reset the
   consecutive-failure counter to 0.

## Step 5 — new tasks discovered mid-sweep

If executing a task (or reviewing it) surfaces a genuinely new, separate piece of work — same as
`D-GH-2026-07-16-audit-search-path-pg-temp-check` spinning out of the `pg_temp` hardening PR earlier
this session — format it in `/add-task`'s exact house format, **including the Effort/Risk tag line,
with the three-factor Risk breakdown named in the "why" clause** (classify it yourself using that
file's criteria), and commit it directly to `preview` the way `/add-task`'s own Step 4 does — but
**skip that skill's Step 2 (clarifying questions) and Step 3 (wait for human approval)**: this skill
runs unattended by design, so the add-and-classify step must not block on a prompt. This is a
deliberate, documented divergence from `/add-task`'s normal interactive flow, not an oversight —
don't "fix" it back to asking. Before committing, `git fetch origin preview && git rebase
origin/preview` first (same care Step 4 item 5 gives feature branches) — if the push is rejected as
non-fast-forward, re-fetch/rebase and retry once; if it still fails, note in the final report that
this new task's roadmap entry didn't land, rather than losing it silently.

If the newly-added task itself clears the same `Risk: low`/`medium` bar, run it through Step 3's
pre-flight branch-existence check exactly like any other queued candidate before trusting it as
available (a concurrent session could have independently claimed the same auto-derived slug), then
fold it into *this run's* queue (append it, respecting the batch-size cap from Step 2, ordered the
same way) rather than waiting for a future invocation to pick it up — this is what actually happened
with PR #239 today. If it doesn't clear the bar, it just sits on the board for a human or a future
`/pick-task` to handle normally.

## Step 6 — final report

A short table: task · branch · PR # · effort/risk (and whether the diff-size check flagged a
mismatch) · outcome (merged / parked / dropped at pre-flight) · any new tasks discovered and whether
they were also executed this run. Explicitly list any untagged tasks Step 2 skipped over, so they
don't stay invisible to the whole sweep process forever. If the circuit breaker triggered, say so
plainly and don't speculate about a root cause beyond what's directly observable. State plainly:
`preview` is now ahead of `main` by N commits (or unchanged, if nothing merged) — promoting is a
separate call, not something this skill does on its own. If anything was parked with a real finding
attached, surface it clearly enough that a human can pick it up without re-deriving context.

## Step 7 — log the run

Append one entry to `docs/sweep-log.md` (create it, following the header/format convention of
`CHANGELOG.md`/`DECISIONS.md` — newest on top, if it doesn't exist yet) summarizing this run: date,
batch size requested, tasks attempted with outcomes, whether the circuit breaker triggered, and any
diff-size-mismatch flags — condensed from Step 6's report, not a duplicate of it. `git fetch origin
preview && git rebase origin/preview` first, then commit directly to `preview` (docs-only, same
direct-commit convention this skill's own Step 5 above uses, mirroring `/add-task`'s Step 4) as
`docs(sweep-log): record sweep run <date>`. If the push is rejected as non-fast-forward, re-fetch/
rebase and retry once; if it still fails, surface that in your final reply to the user so the run
record isn't silently lost. This is a durable record of what was *attempted*, not just what shipped
— `CHANGELOG.md` only ever shows successful merges, so a pattern of repeated parks/drops on a
particular kind of task (a signal the classification criteria need retuning) would otherwise leave
no trace anywhere.

---

$ARGUMENTS
