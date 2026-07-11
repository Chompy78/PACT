# 2026-07-11 — "simple" quick-filter batch: pre-release QA checklist + Level-up cap fix

## What happened
`/pick-task simple` found 🔴 NOW empty and moved to 🟡 NEXT, applying the quick/low-risk filter. The
topmost quick item was "Add a pre-release manual QA checklist to docs/HOW-TO-WORK.md" (primary pick).
Scanning the rest of NEXT for non-overlapping quick candidates surfaced two more: the CharGen
feature-search autocomplete scroll-position fix and the Live Sheet "Level up" buy-tile cap fix. The user
approved the 3-task batch via `/pick-task`'s confirmation flow; `/run-task` executed on
`docs/batch-pre-release-qa-checklist-plus2`.

Session also flagged an engine-tier mismatch before starting: `/pick-task` suggested Haiku/High for all
three quick-filter tasks, but the session was running Sonnet 5. Per `/run-task`'s own rule this should
have paused for a `/model` switch; the user's reply ("batch primary plus 2 more") was read as approval to
proceed on Sonnet rather than switch models, so the batch ran on the session's existing tier.

## Root cause differed from roadmap assumption — one task dropped
The CharGen autocomplete scroll-position task's roadmap entry described a specific bug (`_featAC`'s
`place()` function double-counting `window.scrollY` on a `position:fixed` menu). Once in the code, the
described pattern didn't exist: `place()` computes `top` purely from `getBoundingClientRect()`, with no
`scrollY` addition anywhere. `git log -S"scrollY"` across the file's full history confirmed this pattern
has never existed in `tools/PACT-CharGen-Webtool.html`. The task was dropped from the batch rather than
"fixing" a bug that doesn't reproduce; its roadmap entry was left untouched for human review (possibly
already resolved elsewhere, or the original diagnosis was off).

## What landed
Two tasks, each its own commit on the shared branch, PR #152 → `preview`:
- **docs** — pre-release manual QA checklist added to `docs/HOW-TO-WORK.md`, pointed to from `AGENTS.md`'s
  per-change checklist.
- **fix(live-sheet)** — the "Level up" buy-panel tile now blocks past Hit Die 20 instead of granting free
  levels indefinitely, by passing the already-computed `levelDelta()` value through as the tile's block
  reason (a value the code computed but never used before this fix).

Verified via a headless Node re-implementation of `testing/tests/engine-parity.html`'s exact fixture logic
(no browser available in this environment): **20 passed / 0 failed**, matching the live
`testing/expected/expected-results.csv` row count — checked both before and after rebasing onto `preview`.

## `/code-review medium` on PR #152 — 7 verified findings, none blocking
Two candidates that looked serious on the surface were fully refuted with evidence gathered during
verification, worth recording since they're easy mistakes to make on a quick re-review:
- A "this batch violates AGENTS.md's one-task-per-branch rule" finding misread the batching carve-out —
  its scope-setting clause is "the same class `/pick-task`'s quick filter identifies," and that filter
  explicitly includes "a small isolated bug fix with an obvious cause," not just docs/config/CSS as the
  parenthetical examples might suggest.
- An "edge case at Hit Die 0/undefined" finding contained an arithmetic error: `levelDelta(0)` evaluates
  to 50 (a real, positive AP delta), not 0 as the finding assumed — `DATA.levelAP[1]||DATA.levelAP[0]||0`
  resolves to `DATA.levelAP[1]=50` since `hd+1=1` is a valid key.

The most notable surviving finding: the Level-up fix only gates the rendered tile's `onclick` — calling
`buy('hd',{to:9999})` directly (e.g. devtools console) still grants a free, unbounded level, since
`buy()`/`priceOf()`/`MUT.hd` have no independent ceiling. Verified as a real, reproducible mechanism, but
scoped down to PLAUSIBLE rather than CONFIRMED-blocking: it's a pre-existing, whole-file pattern (every
other numeric `MUT` setter has the same characteristic), the roadmap task's own "Done when" was explicitly
scoped to the clickable tile, and the project already carries an open, deferred roadmap item ("Feature B —
Save-file integrity") that documents this exact class of client-side-tamper risk as accepted and deferred
project-wide, not something this one-line PR should be blocked on closing.

Full finding list (5 CONFIRMED, 2 PLAUSIBLE) is in the review tool output on PR #152; none were judged
merge-blocking.

## Why this note exists
Two triggers: (1) the scroll-position task's actual state contradicted its roadmap diagnosis, and (2) two
roadmap items graduated together in one sitting/branch/PR.

## Why no DECISIONS.md entry
Neither landed task involves a non-obvious architectural *why* — the QA checklist is a stated-outcome docs
addition, and the Level-up fix is a straightforward bug fix whose cause was already root-caused in the
roadmap entry itself. The batching itself follows an already-documented, routine AGENTS.md process (not a
fresh judgment call needing its own justification record — confirmed during the code-review verify pass
above).

## Cross-project lesson (candidate for `ai-lessons-learned`)
**Trigger:** a roadmap bug-fix task's diagnosis (`window.scrollY` double-counted on a `position:fixed`
autocomplete menu) didn't match the code at all — the described pattern had never existed in the file's
git history.
**Generalized rule:** before implementing a fix for a bug described in an issue/roadmap entry, verify it
still reproduces against current code (read the actual function, or `git log -S"<suspect pattern>"`)
rather than trusting the diagnosis — the issue may already be stale, especially if it references an older
PR or an external test run.
