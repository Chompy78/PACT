---
description: Fetch live roadmap state, pick the next task, and pre-flight it — no editing, no worktree
argument-hint: [task title or code]
allowed-tools: Read, Grep, Glob, Agent, Bash(git fetch *), Bash(git ls-remote *), Bash(git branch --list *)
disallowed-tools: Edit, Write, NotebookEdit, Bash(git push *), Bash(git commit *), Bash(git worktree add *), Bash(git worktree remove *)
---

# PACT — pick the next roadmap task

You help pick the next task from the PACT roadmap and pre-flight it. Other Claude Code sessions might be
working on this same repo at the same time. This command only reads and reports — it never edits a file
or creates a worktree. Once you're done, the user invokes `/run-task <slug>` (a separate command) to
actually do the work.

## Step 1 — get the latest information

Don't trust the files sitting in the shared folder right now — another session could switch branches
in that same folder while you're reading, so what you see on disk might not match what's really on the
`preview` branch. Instead, delegate to an `Explore`-type subagent (via the `Agent` tool) so this session's
own context stays clean: give it these three paths and ask it to pull them straight from GitHub —

```
git fetch origin
git show origin/preview:AGENTS.md
git show origin/preview:docs/PACT_ROADMAP.md
git show origin/preview:testing/expected/expected-results.csv
```

— and to return only compact text, not the raw files: the branch-naming convention, the current expected
pass count (the number of data rows in `expected-results.csv` — that's the live "N passed / 0 failed"
target, not a number to hardcode), every roadmap `— TODO` item in NOW/NEXT/LATER, and the highest existing
`D-GH#` decision number.

If `git show` fails (e.g. no internet), fall back to reading the local copies of these files instead —
and mention that you had to do that.

## Step 2 — pick a task

- If `$ARGUMENTS` names a specific task (a title, a short code, etc.), work on that one.
- Else if `$ARGUMENTS` expresses a difficulty/size preference instead of naming a task — words like
  "quick", "fast", "easy", "small", "simple" — treat it as a filter, not a no-op: scan **NOW, then NEXT,
  then LATER** for the topmost TODO item that looks genuinely small and low-risk, skipping over bigger
  items even if they rank higher. Say which items you skipped and why.
  - **Looks small/quick:** docs-only edits (`AGENTS.md`, `docs/*.md`, `CHANGELOG.md`), a config/manifest
    tweak, a single-file CSS/copy/UI fix scoped to one tool, a small isolated bug fix with an obvious cause.
  - **Not quick, skip it:** anything touching `js/engine.js` rules logic (`compute`, `rebuildStateFromEvents`,
    event replay), cross-tool/module-bridge migrations, data-model or migration decisions, or anything
    whose description says it needs root-cause investigation first.
  - If nothing in NOW/NEXT/LATER looks small under this test, say so plainly and fall back to the default
    rule below rather than guessing.
- Otherwise (no task name, no difficulty preference), pick the topmost task marked `— TODO` in the
  **🔴 NOW** section from the subagent's summary, skipping any that are explicitly marked as blocked or
  waiting on something else.
- If nothing in 🔴 NOW is available, move to the **🟡 NEXT** section instead and say that's what you did.

## Step 3 — pre-flight checks

**Check 1 — is someone already doing this?**
Work out the branch name (`type/short-slug`) this task would use, then run:
```
git ls-remote --heads origin <type/short-slug>
git branch --list <type/short-slug>
```
If that branch already exists, say so plainly — don't pick a different task instead, and don't touch
that branch. It means someone (possibly another session) is already on it.

**Check 2 — effort & model calibration**
Assume `/run-task` will run at **High** reasoning effort and on **Sonnet** — that's the floor and the
default for a full roadmap task (multi-file edits, running `engine-parity.html` to a pass count, rebasing
against `preview`, opening a PR). Don't verify this or ask me to confirm it.

Instead, judge the task you picked in Step 2 against two escalation triggers, and only speak up if one
fires:
- **Effort above High** (`xhigh`/`max`): only for a genuinely ambiguous judgment call, not routine roadmap
  work.
- **Model to Opus**: only if the task has real rework risk on Sonnet — a genuine architectural trade-off,
  a change that's expensive to get wrong (e.g. touches `js/engine.js` rules logic, data-model/migration
  decisions, or cross-tool contracts), or something you're not confident can be gotten right in one pass.

## Step 4 — hand off

Tell me which task you picked and why, the result of both pre-flight checks, and whether either
escalation trigger fired. Then stop with: **"Say `/run-task <type/short-slug>` to start doing work."**
Don't edit anything, don't create a worktree — that's `/run-task`'s job.

---

$ARGUMENTS
