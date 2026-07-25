# 2026-07-21 — port the AGENTS.md/skills scaffold to a third repo, family-hub

## What happened

Same request as `docs/sessions/2026-07-17-port-agents-scaffold-to-petdetective-homelife.md`, a third
time: replicate PACT's `AGENTS.md`/task-board/`DECISIONS.md`/`CHANGELOG.md`/`docs/sessions/`/skill
scaffold to `chompy78/family-hub`, a React/Vite/TypeScript household-management PWA at Milestone 1
(local interactive mock, Supabase prepared but not live). Done via direct local access to the target
repo's clone (`C:/Users/user/dev/family-hub`), not `add_repo`/clone-from-scratch — both repos live on
the same machine in this session type.

Presented the same "options + recommendation" framing the two prior ports established (manual
copy-and-adapt now vs. build a general `/port-agents-scaffold` skill first) before starting — the user
picked manual-copy-and-adapt (option A), same as both priors, reinforcing that PACT's own open
task-board item for a general port skill is still speculative rather than validated: three real ports
have now happened without it, each different enough in shape that a fixed skill would have needed
per-target judgment calls anyway.

## The target repo's shape — a third, genuinely different case

- **PetDetective:** blank slate, no `AGENTS.md`, no docs, no CI, no test suite → built the full scaffold
  fresh, scaled down.
- **Homelife:** mature, already had its own real `AGENTS.md`/`CHANGELOG.md`/`DECISIONS.md`/task board,
  and an explicit stated convention (commit straight to `main`) that conflicted with PACT's branch/PR
  model → additive merge only, adapted the conflicting skills to match homelife's own convention.
- **family-hub:** neither. No AI-workflow governance layer existed (no `AGENTS.md`/`CHANGELOG.md`/
  `DECISIONS.md`/real task board), but it wasn't a blank slate either — a rich set of product-planning
  docs already existed from an earlier Microsoft 365 Copilot session (`PRD.md`, `DATA_MODEL.md`,
  `TEST_PLAN.md`, etc.), including a `docs/sessions/` convention already in active use, plus two thin
  "what to do next" files (`NEXT_TASK.md`, `CLAUDE_START_HERE.md`) that predated and informally
  overlapped with what `TASK_BOARD.md`/`AGENTS.md` would become.

This confirms the generalization the homelife/petdetective note already flagged — "read the target's
actual state first, don't assume either extreme" — needed a third data point to become a real pattern
rather than a coincidence of two: the shape space has (at least) three axes that can vary independently
(governance layer present/absent, product-planning docs present/absent, branch model established/not),
not just the two-point "blank vs. mature" spectrum the first two ports suggested.

## Decisions made and logged in family-hub's own DECISIONS.md (not duplicated here)

- Branch model: commit straight to `main`, explicitly logged as revisit-when (CI added / second
  contributor / a change feels too risky), not a permanent architectural choice — this is the same
  outcome homelife reached, but for a different reason (nothing to protect yet, vs. an explicit stated
  conflicting convention).
- What happens to `NEXT_TASK.md`/`CLAUDE_START_HERE.md`: folded into the new `TASK_BOARD.md`/`AGENTS.md`
  and deleted, per the user's explicit choice, rather than left alongside as competing sources.

## Why this is worth a note

Same reason as the prior port note: a future PACT session asked to do this a fourth time shouldn't
assume the shape from memory of the *last* port — it should read this note's "three genuinely different
cases" list as the actual range observed so far, and still read the *new* target's real state before
choosing an approach. Also worth carrying forward: fixing broken cross-references. Deleting
`NEXT_TASK.md`/`CLAUDE_START_HERE.md` left three files in family-hub silently pointing at now-gone
files (`README.md`, `docs/START_HERE.md`, `docs/PROJECT_DIRECTORY.md`) — caught and fixed in the same
session, but a checklist item worth stating explicitly for next time: **after removing any file as part
of a port, grep the target repo for references to it before calling the port done.**

## Status

family-hub's own scaffold is live in that repo's working tree, not yet committed there — the user
reviews before it lands (see family-hub's own `docs/sessions/2026-07-21-agent-scaffold-port.md` for the
target-side detail). Nothing in PACT itself changed as a result of this session; this note exists purely
as PACT-side institutional memory of the cross-repo work.
