# D-GH-2026-07-17-sweep-tasks-review-fixes — closing the gaps a max-effort review found in the shipped skill

Status: Active

- **Context:** ran `/code-review ultra` (this environment's max-effort local fallback) against the full
  merged diff of `D-GH-2026-07-16-sweep-tasks-skill` + `D-GH-2026-07-16-sweep-tasks-risk-model-v2`
  (i.e. `origin/main...origin/preview`) — the first adversarial pass over `/sweep-tasks`/`/add-task`
  since either landed. Four finder agents (3 initial + 1 gap-sweep) surfaced 16 candidate findings;
  15 survived dedup/verification and are fixed here (1 — unvalidated magic-number thresholds for the
  circuit breaker and diff-size bands — was cut to stay under the review's 15-item cap as the least
  severe of the set; left as a known minor gap, not tracked as a separate task).
- **Decision:** fix all 15 inline rather than filing them back to the roadmap, since the affected files
  are prompt files a future agent executes literally — an undefined step or a resource leak in them is
  load-bearing the next time `/sweep-tasks` runs, not cosmetic.
- **What changed (grouped):**
  - *Resource/state leaks:* park paths in Step 4 item 5 now call `ExitWorktree(action:"keep")` instead
    of leaking a worktree/branch silently; `TaskList` entries always reach an explicit terminal state
    (`completed` with a `MERGED:`/`PARKED:`/`DROPPED:` reason) instead of a parked task staying stuck
    at `in_progress` forever.
  - *Queue/cap correctness:* dropped or parked queue slots now backfill from the remaining eligible
    list so the number of tasks actually attempted stays near the requested cap instead of silently
    shrinking; Step 5's newly-discovered tasks now route through Step 3's pre-flight branch-existence
    check before being trusted as available.
  - *Undefined cases now defined:* a `Risk: medium` task bumped a tier by the diff-size check now maps
    explicitly to the `ultra` review tier (previously undefined); how `/run-task`'s PR number reaches
    `/code-review <tier> PR #<n>` is now stated (read from its final output, or `list_pull_requests` as
    a fallback); `$ARGUMENTS` batch-size parsing now requires a bare positive integer, not any digit
    substring in free-form text (previously a stray version number like "v0.107" would silently become
    the cap); Step 5/Step 7's direct pushes to `preview` now fetch/rebase first and retry once on a
    non-fast-forward rejection, matching the care already given to feature-branch rebases.
  - *Spec self-consistency:* the diff-size check no longer flags the exact "mechanical batch across
    many call sites" pattern `/add-task`'s own Effort:medium examples endorse (judges diff *shape*, not
    just file count); Ambiguity's High tier now names cross-tool/architectural migrations explicitly,
    closing the gap left when Effort stopped gating eligibility (a "copy this pattern exactly" task
    could otherwise dodge the high-ambiguity rating it deserves); `AGENTS.md`'s single-writer rule for
    `docs/TASK_BOARD.md` now documents the `/add-task`/`/sweep-tasks` direct-commit carve-out instead of
    leaving readers of that file to discover the exception only by reading `sweep-tasks.md` itself.
  - *Doc/wording bugs:* `docs/TASK_BOARD.md`'s stale "Step 4.5" reference corrected to "Step 4 item 6";
    Step 7's "same convention `/add-task`'s Step 4 and Step 5" corrected (add-task.md has no Step 5 —
    it meant this skill's own Step 5); the stale-branch-deletion fallback now names the actual branch
    (`worktree-<slug>`) instead of describing it only by role.
- **Why:** these are exactly the class of bug a prompt file hides well — a future agent following the
  doc literally has no way to notice a missing `ExitWorktree` call or an undefined tier mapping until
  it's already mid-sweep with no human watching, which is the whole point of the skill.
- **Found and fixed by `/code-review high` on the PR itself (self-referential — the fix pass got the
  same review treatment as any other PR):** the fix pass introduced 9 new gaps of its own, all fixed
  in the same PR before merge. Two stand out as genuinely notable: (1) the new backfill-on-drop/park
  paragraph pulled a replacement candidate into the queue without routing it back through the
  pre-flight branch-existence check — the exact race this same PR explicitly fixed for Step 5's
  newly-discovered tasks, just left open on the parallel backfill path; also left undefined how a
  backfill interacts with a circuit-breaker trip landing on the same failure (now: check the breaker
  first, only backfill if the sweep is continuing). (2) The stray-branch-name fix named the wrong
  branch — `worktree-<slug>` — when `run-task.md`'s actual `EnterWorktree` convention substitutes `+`
  for `/` in the full `type/short-slug` (`worktree-<type+short-slug>`), which the fix would have
  gotten right by construction if it had been checked against `run-task.md` directly instead of
  written from memory of the convention. Also fixed: a merge-outcome path that didn't restate the new
  `MERGED:`-prefix convention; a PR-number-capture instruction that cited `/run-task`'s wrong step
  (Step 8, cleanup, instead of Step 7, where the PR is actually opened) and undercounted its own
  consumers; AGENTS.md's new carve-out hardcoding step numbers — the identical drift-prone pattern
  this same PR had just fixed once already in `docs/TASK_BOARD.md`'s stale "Step 4.5"; Step 5/Step 7's
  near-duplicate fetch/rebase/retry prose (Step 7 now points at Step 5's procedure instead of
  restating it); a bumped-to-`ultra` review-tier instruction that buried the actual rule after its own
  justification; and the mechanical-batch diff-size exception not accounting for the case where the
  uniform pattern itself spans multiple UI tools (now treated as a second, independent flag on top of
  the Ambiguity-High tag, defense-in-depth against an upstream mis-classification).
- **Status:** Active.
