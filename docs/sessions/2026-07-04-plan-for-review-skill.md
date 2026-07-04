# 2026-07-04 — `/plan-for-review`: build, dogfood, and a rebase-time D-GH collision

## What this is
A record of the session that added the `/plan-for-review` skill, dogfooded it on its own design,
and caught a second occurrence of a `DECISIONS.md` ID collision mid-rebase. Written so a fresh
session can see the reasoning, not just the diffs.

## What got built
`.claude/commands/plan-for-review.md` — a new skill that turns a task/idea into a written plan,
then packages it as a self-contained markdown file for a *different* AI (a separate session, a
different model, or a person with no shared context) to review cold. Follows the repo's existing
draft-then-approve convention (`/log-ai-lessons`, `/add-roadmap-task`): show the draft, wait for
approval, only then write to `docs/plans/<date>-<slug>.md`, and treat committing/pushing as
separate, later, opt-in questions.

## Dogfood test
With no other task queued, the skill was run on itself: the plan it produced was "add
`/plan-for-review` to PACT" (its own already-completed build, used as demo material since Step 1
allows mining a plan already worked out earlier in the conversation). That plan doc was sent
through **three independent cold AI reviews** and the results pasted back in. All three converged
on the same gaps:
- the workflow's commit/push status was internally inconsistent (`Done when` implied "pushed" while
  the skill's own instructions made committing optional)
- the `docs/plans/<date>-<slug>.md` filename algorithm (slug derivation, collision handling) was
  never actually defined
- no guidance existed for revisiting/superseding a prior plan on the same topic
- reviewer instructions only invited gap-finding, not structural/redesign critique
- nothing stopped secrets/credentials from being inlined into a doc explicitly designed to leave
  the repo's trust boundary (pasted into a third-party AI tool)

All of these were folded back into the skill (commit `29d47b1`), plus a new **Step 7** (`7fef3a3`)
for handling returned review feedback: format is unconstrained (prose/bullets/structured), there
may be more than one response so the skill asks "anything else to add?" before triaging, and
triage means applying low-risk/clearly-correct findings directly while surfacing anything
security-related, contradicting a `DECISIONS.md` entry, or reviewer-disputed to the user by name.

## The rebase-time D-GH collision (the actual "why write this doc" trigger)
While closing the session, `git log origin/preview..origin/main` showed `main` had moved 2 commits
ahead of `preview` — including a same-day sibling session's fix for a **prior** `DECISIONS.md`
collision (two sessions had both claimed `D-GH19` on 2026-07-03; that session renumbered one to
`D-GH20`). This branch's own new decision entry (about the plan-for-review trust boundary,
drafted against the *pre-fix* `main`) had independently claimed `D-GH20` too.

Rebasing this branch onto the updated `main` did **not** raise a conflict — git saw no overlapping
lines and silently concatenated both `## D-GH20` headers back to back, exactly reproducing the
prior day's failure mode a second time, one rebase away from landing again unnoticed. Caught only
because `/close-session`'s preview/main-sync check happened to run before this branch was pushed
further. Fixed by hand: renumbered this branch's entry to `D-GH21` (commit `479bd22`).

This is now logged as an `ai-lessons-learned` candidate (see below) — "highest existing + 1" ID
assignment from a local snapshot is inherently collision-prone under concurrent AI sessions, and a
clean git auto-merge/rebase actively hides the collision instead of surfacing it.

## Cross-project lessons pushed
Two candidates drafted and pushed to `chompy78/ai-lessons-learned` (`inbox/`, commit `e948fc6`
after rebasing onto other same-day additions from a sibling session):
1. Dogfood a new AI-facing artifact through independent cold review before shipping.
2. "Highest existing + 1" IDs collide under concurrent AI sessions (this exact D-GH slot, twice).

## Open at end of session
- `origin/preview` is still 2 commits behind `origin/main` — syncing it was blocked by the
  environment's auto-mode classifier as a direct write to a shared/protected branch, pending
  explicit user confirmation on how to do it (direct fast-forward vs. a reviewed PR).
- This branch's own PR (`claude/add-repo-s3maxs` → `preview` or `main`) had not been opened yet as
  of this note — see whether that landed in a later message in this same session.
