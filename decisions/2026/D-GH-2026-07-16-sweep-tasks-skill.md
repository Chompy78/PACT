# D-GH-2026-07-16-sweep-tasks-skill — four human calls, not four defaults picked unilaterally

Status: Active

- **Context:** this session manually ran a 6-task low-effort/low-risk batch (pick → worktree → edit
  → test → `/code-review` → fix → merge, repeated) end to end, including handling a task that
  surfaced mid-batch (the `pg_temp` static-check follow-up). The user asked for this to become a
  repeatable skill: find every low/medium-effort, low-risk TODO and just do it, adding any newly
  found tasks to the board along the way, no per-task confirmation needed.
- **Options considered and decided by the user directly** (asked via `AskUserQuestion`, not decided
  unilaterally — each is a genuine judgment call about how much autonomy/structure to bake in):
  1. **Effort/Risk classification** — structured tags set by `/add-task` (chosen) vs. `/sweep-tasks`
     re-inferring effort/risk from each task's prose on every run. Structured tags mean
     classification happens once, is auditable in the task text itself, and doesn't drift between
     runs or re-litigate a judgment call on unchanged text.
  2. **Batch size** — asked once per invocation (chosen) vs. a fixed recommended default vs. no cap
     (drain the whole board). Draining the whole board risked an unbounded, unpredictable
     token/time cost in one command; the user preferred to set the size themselves each time rather
     than trust either a baked-in number or no limit at all.
  3. **Mid-run discoveries** — execute immediately within the same run if they qualify (chosen,
     matching what actually happened today with the `pg_temp` follow-up) vs. always deferring new
     discoveries to a future invocation.
  4. **Merge autonomy** — bake in "merge as you go" as a fixed default with zero per-run prompt
     (chosen) vs. asking once per run (which is what actually happened in today's manual session,
     since the user hadn't pre-committed to it). For the *skill*, the user chose to settle this
     permanently rather than re-ask every invocation.
- **Why this is logged, not just coded:** a future agent reading `sweep-tasks.md` cold could
  reasonably wonder why it doesn't ask about merge autonomy (today's actual session did), or why
  effort/risk aren't computed at sweep-time — these were explicit trade-offs the user weighed, not
  omissions or a simplification the agent chose on its own.
- **Consequence:** `/add-task`'s house format gained a required `**Effort:** ... **Risk:** ...` tag
  line (with worked classification criteria, kept in sync between the two skill files); a task with
  no tag line, or any rating above `Effort: medium`/`Risk: low`, is never eligible for `/sweep-tasks`
  regardless of how the task's prose reads. The 2 tasks open on `docs/TASK_BOARD.md` at the time were
  retrofitted with tags as the first real testbed (see `CHANGELOG.md`).
- **A worktree gotcha found while building this PR, not by the skill itself:** the worktree this PR
  was built in came out silently based on `main` instead of `preview` — `main` had just absorbed
  `preview` via the same-day promotion (PR #242), so `git merge-base --is-ancestor origin/preview
  HEAD` (the exact check `AGENTS.md`/`ai-lessons-learned` H-028 already recommend) reported `OK`
  without a reset, because `origin/preview`'s tip genuinely *is* an ancestor of `main`'s tip once
  `main` has merged it — just not because the worktree was based on `preview` directly. Caught before
  push by the rebase attempting to replay ~195 ancient commits instead of one; fixed by resetting to
  `origin/preview`'s real tip and cherry-picking just this PR's own commit back on. The existing
  ancestor-check guidance is technically correct but has a blind spot the moment `main` has recently
  merged `preview` — worth a sharper check (`git merge-base HEAD origin/preview` should equal
  `origin/preview`'s own SHA exactly, not merely be reachable from it) if this recurs.
- **Status:** Active.
