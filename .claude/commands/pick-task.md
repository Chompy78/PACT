---
description: Fetch live roadmap state, pick the next task, and pre-flight it — no editing, no worktree
argument-hint: [task title or code]
allowed-tools: Read, Grep, Glob, Agent, AskUserQuestion, Skill, Bash(git fetch *), Bash(git ls-remote *), Bash(git branch --list *)
disallowed-tools: Edit, Write, NotebookEdit, Bash(git push *), Bash(git commit *), Bash(git worktree add *), Bash(git worktree remove *)
---

# PACT — pick the next roadmap task

You help pick the next task from the PACT roadmap and pre-flight it. Other Claude Code sessions might be
working on this same repo at the same time. This command only reads and reports — it never edits a file
or creates a worktree itself. Once you're done, Step 4 asks whether to hand off into `/run-task` (a
separate command that does the actual work) right away, via a clickable confirmation.

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

**Batch candidates (only when the difficulty-filter branch above was used):** after picking the primary
task, scan the *rest* of NOW/NEXT/LATER for up to 2 more items that independently pass the same
"looks small/quick" test, are not blocked, and — best effort, from each item's stated file scope in the
roadmap text — don't touch any file the primary pick or each other already touch. Skip a candidate that
overlaps files rather than guessing whether the overlap is safe. Cap the batch at 3 tasks total (the
primary pick + up to 2 more); more than that stops being a quick session. If no such candidates exist,
say so plainly — the single-task flow continues as before. This step is skipped entirely for an
exact-name pick or the no-argument default, since those are explicit single-task requests.

## Step 3 — pre-flight checks

Run both checks below for the primary pick, **and separately for each batch candidate from Step 2** (if
any). A candidate that fails either check drops out of the batch rather than blocking the primary pick —
say so plainly and continue with a smaller (or zero) batch.

**Check 1 — is someone already doing this?**
Work out the branch name (`type/short-slug`) this task would use, then run:
```
git ls-remote --heads origin <type/short-slug>
git branch --list <type/short-slug>
```
If that branch already exists, say so plainly — don't pick a different task instead, and don't touch
that branch. It means someone (possibly another session) is already on it. For a batch candidate, this
just drops it from the batch; for the primary pick, it stands as before (don't substitute a different
primary task).

**Check 2 — effort & model calibration**
Assume `/run-task` will run at **High** reasoning effort and on **Sonnet** — that's the floor and the
default for a full roadmap task (multi-file edits, running `engine-parity.html` to a pass count, rebasing
against `preview`, opening a PR). Don't verify this or ask me to confirm it.

Instead, judge each task (primary pick, and every surviving batch candidate) against two escalation
triggers, and only speak up if one fires:
- **Effort above High** (`xhigh`/`max`): only for a genuinely ambiguous judgment call, not routine roadmap
  work.
- **Model to Opus**: only if the task has real rework risk on Sonnet — a genuine architectural trade-off,
  a change that's expensive to get wrong (e.g. touches `js/engine.js` rules logic, data-model/migration
  decisions, or cross-tool contracts), or something you're not confident can be gotten right in one pass.

A batch candidate that fires either trigger contradicts its own "quick" classification from Step 2 — drop
it from the batch instead of escalating it; a batch is only worth its token savings when every member
stays at the routine High/Sonnet floor.

## Step 4 — hand off

Tell me which task you picked and why, the result of both pre-flight checks, and whether either
escalation trigger fired. If a batch survived Step 3, list each surviving member with its own one-line
reason. Don't edit anything, don't create a worktree yet — that's `/run-task`'s job, gated on the
confirmation below.

Then, instead of ending with plain text to copy-paste, ask with **`AskUserQuestion`** (one question,
`multiSelect: false`). Build the option list from whichever of these apply — always at most 4 options,
so if a batch survived, the two "run" options below replace each other's slot rather than both appearing
alongside a 5th:

- **Question:** "Start work now?"
- **Options (no surviving batch):**
  1. **"Run `/run-task <type/short-slug>` now"** (Recommended) — invoke the `run-task` skill
     immediately, in this same turn, passing `<type/short-slug>` as its sole argument.
  2. **"Not yet"** — stop here. Don't touch anything else; tell me I can run
     `/run-task <type/short-slug>` myself whenever I'm ready.
  3. **"Choose a different task"** — go back to the roadmap items already gathered in Step 1 (NOW, then
     NEXT, then LATER) and list the remaining TODO candidates as plain text (skip the one just
     pre-flighted). Ask which one to try instead — another `AskUserQuestion` if 4 or fewer reasonable
     candidates remain, otherwise plain text. Once I name one, go back to **Step 3** for it (re-run both
     pre-flight checks — don't assume they still hold), then repeat this Step 4 hand-off for the new pick.
- **Options (batch survived — replace option 1 above with two run variants, keep 2 and 3 as-is):**
  1. **"Run just `<primary slug>`"** — invoke `run-task` with only the primary pick's slug, ignoring the
     batch.
  2. **"Batch `<primary slug>` + N more"** (Recommended) — invoke `run-task` in this same turn, passing
     *all* surviving slugs (primary first, then each batch member) as separate space-separated arguments
     in one call, e.g. `docs/qa-checklist docs/rules-review-note`.
  3. **"Not yet"** — same as above.
  4. **"Choose a different task"** — same as above; dropping into this discards the current batch too.

The click itself is the confirmation — whichever "run" option comes back, invoke `run-task` right away
without asking again.

---

$ARGUMENTS
