# Session: Proficiency-bonus re-pricing, and three back-to-back collisions with concurrent sessions

**Date:** 2026-09-05 · **Decision:** `D-GH-2026-09-03-proficiency-bonus-pricing` (full record:
`decisions/2026/D-GH-2026-09-03-proficiency-bonus-pricing.md`)

Why this note exists: the actual pricing work (one `DATA` constant, one Guide table) was small. What
makes it worth narrating is that landing it required navigating **three separate collisions** with other
concurrent Claude Code sessions actively working the same `preview` branch — a pattern this repo's own
docs/sessions notes have flagged before ("four sessions touching preview at once") but that this session
hit *three times in under three hours*, each with a different shape.

## The pricing work itself

Asked to review the proficiency-bonus AP ladder (`DATA.profCum`, `+2→+6`) and suggest revised prices.
Comparison against `js/ap-by-level.js`'s budget curve showed the old ladder (`4/7/10/13`, cum `34`)
priced a purchase that touches nearly every proficient skill/save/spell stat as if it were as narrow as
a single skill proficiency — cheaper, at every unlock tier, than a single one-time Premium-band class
feature (`DATA.MASTER[tier][4]`) despite outclassing any one feature in breadth. Iterated through several
candidate curves with the owner (flatter, steeper, income-relative) before landing on anchoring the new
prices directly to `DATA.MASTER`'s Premium band: `18/38/62/90`. See the decision record for the full
options table and reasoning — recorded here only because it's the *cause* of everything below, not
because the design conversation itself needs repeating.

## Collision 1 — a second session was already promoting while this one planned to

Implemented the engine change (`js/engine-data.js`, PR #507), caught and fixed a CI miss of its own (three
version-label fallback literals not mirrored — `version-label-ci.mjs` 3 failed/7 passed, fixed and
re-verified 10/0), merged. Asked to add a follow-up task for the Players Guide sync; `/add-code-task`
wasn't usable (no `.claude/commands/` in this checkout), so gave paste-ready task text per `AGENTS.md`'s
documented fallback rather than hand-editing the board.

User then said to do the Guide sync now, and afterward to promote `preview` → `main`. Mid-preparation,
checking for an existing promotion PR turned up **PR #511, already open**, from a different session
(`session_01JiX9aj1JLZt7susAsYCoji`) — carrying #507 plus two other PRs (#508, #509) that had landed on
`preview` in the ~15 minutes since this session's own PR #507 merged. Stopped rather than opening a
duplicate/racing promotion; subscribed to #511 and held per the owner's explicit call, rather than
guessing. This is the first appearance of the pattern this note is really about: **another session's
promotion PR is not visible from "I'm about to do X" — it has to be checked for, every time, right before
acting**, because between deciding to promote and actually opening the PR, someone else can already have
started.

## Collision 2 — the Guide-sync PR's base moved out from under it while waiting

PR #510 (the Guide sync) was opened against `preview` at a commit that #511 later carried. While waiting
for #511 to clear, `preview` moved twice more (#508, #509 merged; #511's own `BUILD` sync commit landed
directly on `preview`). By the time #511 merged, #510 showed `mergeable_state: dirty` — a genuine
conflict, not a bug: GitHub's squash-merge history for #507 didn't share ancestry with what #510 was
based on. Resolved with a merge commit into #510's own branch (never a rebase/force-push on it), re-ran
`guide-price-check.mjs` and `verify-guide.mjs`, pushed, went green, merged.

**A second, harness-level lesson landed here too.** Following the "already-merged branch → restart it
from the current default and keep going" convention, the original branch
(`claude/proficiency-bonus-pricing-jzdn8x`) had been reset to `origin/preview` and reused for the Guide
work. Pushing that back to its own remote name failed non-fast-forward (expected, since its old commits
were squashed into `preview` under a different SHA), and the auto-mode permission classifier correctly
**blocked** a `--force-with-lease` push as a hard-to-reverse action. Rather than fight the guard: renamed
the local branch to `docs/proficiency-bonus-guide-sync` and pushed it as a genuinely new branch — which,
on reflection, is also just the *correct* shape per this repo's own one-task-per-branch convention (the
Guide sync was always a distinct task from the engine change). **Lesson for next time:** don't try to
reuse an already-promoted branch name at all — start the follow-up task on its own branch from the outset,
and treat a force-push rejection as a design smell, not an obstacle to route around.

## Collision 3 — the next promotion PR absorbed two more PRs mid-review

Once #510 merged, opened PR #513 (`preview` → `main`) for the Guide-sync follow-up promotion, having
first confirmed no other promotion PR was already open (learned from Collision 1). While #513's CI ran,
`preview`'s head moved **twice more** — #512 (a `search_path` security hardening fix, unrelated file
surface) and #515 (its own follow-up doc noting the fix reached production) — both from a third
concurrent session (`session_01RDjeCFVg1F7A3qhX6juGNu`), both explicitly stating in their own commit
messages that `DATA.version`/`BUILD` were untouched. Re-verified CI green and `mergeable_state: clean` on
the final head rather than trusting the earlier read, updated #513's description to name what it now
carried (rather than pretending it was still just the Guide sync), then merged with a regular merge
commit — confirmed after the fact to have two parents, matching this repo's own past promotions.

Even after that merge, `preview` kept moving (three more docs-only commits landed within the next few
minutes, per `git log`) — none of it this session's concern to chase further, since the promotion this
session was asked to drive had already landed cleanly.

## What the pattern actually is

None of these three were the same kind of collision:
1. **Same goal, parallel start** (two sessions both decided to promote around the same time).
2. **Base drift under an open PR** (a PR's target moves while it waits on something else, here another
   PR clearing).
3. **A PR absorbs new content mid-flight** (unrelated commits land on the same base branch while CI runs).

The common defence across all three was the same: **re-check actual current state from the API
immediately before acting, every single time** — never act on a status read more than a few tool calls
old, because in an actively multi-session repo it can already be stale. A `mergeable_state` or check-run
list fetched even one exchange ago is not a fact to merge on; fetch it again right before the merge call.

## Outstanding (not this session's to close)

- The Players Guide's `documents-rules:` reconciliation stamp — this repo's own
  `docs/TASK_BOARD_NEXT.md` already tracks this generically ("Reconcile guide↔engine rules-version
  drift... MOSTLY DONE, one step left") and correctly notes it needs a `pact-guide`-side session with
  shell access to run `stamp_guide_rules.mjs`; this session confirmed the same gap independently while
  syncing the proficiency-bonus numbers and has nothing to add beyond that confirmation.
- No fixture in `testing/fixtures/` exercises `profBonus > 2` — the new ladder is provably invisible to
  `engine-parity`. Not yet on any task board; handed to the user as a new task candidate in this
  session's closing report rather than added directly (single-writer discipline).
- Tagging `main` at `v1.513` — cloud sessions cannot push tags; left for a local/terminal session or the
  GitHub web UI, and whether this docs+security promotion warrants one at all is the owner's call.
