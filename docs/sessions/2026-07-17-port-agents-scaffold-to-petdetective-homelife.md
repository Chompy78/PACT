# 2026-07-17 — port the AGENTS.md/skills scaffold to two sibling repos

## What happened

The user asked how to reuse PACT's `/add-task` → `/pick-task` → `/run-task` → `/sweep-tasks` skills
(and eventually the whole `AGENTS.md`/`.claude/` scaffold) in other repos they own. After walking through
the options (copy-as-is vs. copy-and-adapt vs. rebuild-from-scratch), the user picked "copy and adapt" and
asked for it to actually be done, first against `chompy78/petdetective`, then against `chompy78/homelife`.
No PACT files were read into a plan or edited — this was entirely cross-repo work, done via `add_repo` +
clone against the two target repos, from inside this PACT session.

**PetDetective** (`docs/agent-scaffold` branch, PR #4, not yet merged): a small solo PWA prototype with no
existing `AGENTS.md`, no test suite, no CI, and a single (oddly-named) branch. Built the scaffold from
scratch: `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, `.claude/settings.json` + hook, and
all 8 skills, each scaled down from PACT's originals — no automated-test gate (none exists there), no
`preview`/`main` split, no task-batching. Deliberately left `TASKS.md` (in-game design content, not an
engineering roadmap) untouched and pointed the new roadmap doc at `docs/TASK_BOARD.md` instead so the two
don't collide.

**Homelife** (pushed directly to `main`, commit `ede0496`): a much more mature repo — it already had its
own real `AGENTS.md`, `CHANGELOG.md` (234 lines), `DECISIONS.md` (713 lines), and `docs/TASK_BOARD.md`.
Read all of it before touching anything, then added only the missing pieces (`CLAUDE.md`,
`.github/copilot-instructions.md`, `.claude/` skills/hook) plus small additive notes in the three existing
governance docs — never rewrote or regenerated any of them. The bigger adaptation: homelife's own
`AGENTS.md` already states "commit and push straight to `main` — no feature-branch workflow," which
directly contradicts PACT's worktree/branch/PR model that `run-task`/`sweep-tasks`/`cleanup-branches` are
built around. Rewrote those three skills to work straight against `main` with no worktree/branch/PR step
at all, rather than importing PACT's model wholesale — logged as
`D-2026-07-17-agent-workflow-scaffold` in homelife's own `DECISIONS.md`. Also flagged, and got explicit
confirmation for, one extra risk before pushing: homelife has no PR gate, so a push to `main` there
triggers an immediate live GitHub Pages deploy — unlike PetDetective's PR, there was no review buffer.

## Why this is worth a note

Two genuinely different "target repo shapes" came up back to back — a blank slate with no conventions at
all, and a mature repo whose existing conventions actively conflict with the source scaffold's assumptions
(branches vs. branch-less). A future session asked to do this again for a third repo shouldn't assume
either extreme: it needs to read the target repo's actual state first (existing governance docs? test
setup? branch model?) before deciding whether to build fresh or adapt-in-place, and should treat "this repo
already has a documented convention that conflicts with the source pattern" as a reason to follow the
target repo's convention, not override it for consistency's sake. The homelife decision entry captures the
reasoning for that specific case; this note is the cross-repo pattern for the next time it comes up
elsewhere. A candidate `ai-lessons-learned` entry was drafted from this (see Part 2 item 9 of this
session's `/close-session` report) but not yet approved/written.

## Status

Both target-repo changes are live in their own repos (PetDetective's via an open PR, homelife's via a
direct push already merged into `main`). Nothing in PACT itself changed as a result of this session —
this note exists purely as PACT-side institutional memory of the cross-repo work, since neither target
repo's own session-log convention (homelife has one; PetDetective's is brand new) is a place a future PACT
session would think to look.
