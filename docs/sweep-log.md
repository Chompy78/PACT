# PACT — Sweep log

> One entry per `/sweep-tasks` run, **newest first**. Records what was *attempted*, not just what
> shipped — `CHANGELOG.md` only ever shows successful merges, so this is the only place a pattern of
> repeated parks/drops (a signal the `Effort`/`Risk` classification criteria need retuning) leaves a
> trace. Written by `/sweep-tasks` Step 7 itself, committed directly to `preview` (docs-only, no
> approval-wait, same convention as `/add-task`'s own direct-commit flow).

Entries land here starting with the first real `/sweep-tasks` run.

## 2026-08-10 — sweep run

Batch size requested: 10, filtered to `Effort: medium` (later widened, see below), `Risk: low`/`medium`
(`Risk: high` excluded, no exception, per `/sweep-code-tasks-jc`'s own veto).

`docs/TASK_BOARD_NEXT.md`/`_LATER.md` held ~23 open `TODO` tasks combined. Of those, 8 carried an
`Effort: medium` (or, for one, `Effort: medium`/`Risk: low`) tag with `Risk` at low/medium. Reading each
task's own body (not just its tag) before queuing anything eliminated half of them:

- `feat/custom-fields-player-display` — already completed earlier this session (not a sweep pick).
- `Password reset is broken end-to-end` — the task's own text says **"Not sweep-eligible"** (needs a
  real end-to-end test against a live recovery email; no mechanical check exists).
- `CharGen quotes a locked character's context changes as a whole-build delta` — the task's own plan
  flags step 2 as **"the part worth getting reviewed"**: a genuine, unresolved design call (price a
  patch slot field-by-field vs. split the context-bearing fields out), not a mechanical fix despite the
  medium/medium tag. Excluded as out of scope for an unattended run.
- `Randomize (and shared links) build in canonical order` — ~30 individual randomizer-mutation-to-
  event-shape mappings, each needing independent verification against `MUT` in `js/engine.js` (a wrong
  one mis-prices a character, per the tag's own damage note), plus an explicit "decide and say so"
  design call on shared-link/legacy-import behaviour. Too large/judgement-dependent for a blind sweep.
- `Rate limiting / abuse protection for invite generation and redemption` — self-tagged **"not sweep-
  eligible given the unresolved platform-verification step"**.
- `Supabase Edge Function running the real engine.js for AP-budget validation` — step 1 of its own plan
  says it "exists to be revisited, not built reflexively" once its prerequisite is confirmed insufficient
  in practice — a judgement call, not a mechanical trigger.

That left 3 genuinely eligible: `chore/supabase-keep-alive`, `feat/banned-2nd-origin-class`,
`fix/autosave-flush-latest-push`. Flagged the gap (3 of the requested 10) to the user before running
anything; asked whether to also widen the effort filter to the two `Effort: low`/`Risk: medium` tasks
that were otherwise clean (`fix/reconcile-push-inflight-tracking`, `fix/dm-edit-boon-amount-check`) —
approved, bringing the queue to 5.

Execute order: `Effort: low` first (the skill's own ascending-effort tiebreak), then `medium`.

| Task | Branch | Effort/Risk | Outcome |
|---|---|---|---|
| `reconcile()`'s `pushCharacter()` bypasses `_pushInFlight` tracking | `fix/reconcile-push-inflight-tracking` | low/medium | **PUSHED** |
| `dm_edit_character_log` doesn't cross-validate a boon grant's buy/award amounts | `fix/dm-edit-boon-amount-check` | low/medium | **PUSHED** |
| Prevent Supabase free-tier auto-pause | `chore/supabase-keep-alive` | medium/medium | **PUSHED** (workflow's own `workflow_dispatch`/schedule registration unverifiable from a non-default branch — see `D-GH-2026-08-10-supabase-keep-alive`) |
| Support banning a class as a 2nd-origin-only pick | `feat/banned-2nd-origin-class` | medium/medium | **PUSHED** |
| Cloud-autosave flush doesn't wait for the freshest edit | `fix/autosave-flush-latest-push` | medium/medium | **PUSHED** |

All 5 pushed to `claude/tools-uni-improvements-ut88sr` (this session's designated branch — no worktree-
per-task, no PR per task; a standing session constraint, not this skill's normal per-task branch model)
— **not yet merged into `preview`**, so none of the five show up in `preview`'s own copy of
`docs/TASK_BOARD_NEXT.md`/`CHANGELOG.md` until that branch merges. Each commit carries its own
CHANGELOG/task-board-graduation/decision-record bookkeeping in the same commit as its code, per the
per-change checklist, ready to travel with the branch on merge.

Circuit breaker: not triggered (0 consecutive failures across all 5 — every task verified: `engine-
parity-ci.mjs` 30/0 and `tool-pricing-ci.mjs` 134/0 unaffected throughout; two new differential
regression tests written and confirmed to fail on a hand-reverted pre-fix copy before trusting them
(`sync-state-machine-ci.mjs`'s new case, `testing/scripts/autosave-flush-latest-push-ci.mjs`); one
overclaimed verification line (the keep-alive workflow's `workflow_dispatch` result) was caught and
corrected in a same-run follow-up commit rather than left standing).

Untagged tasks: not enumerated individually — the board's untagged items are mostly `Risk: high` (an
absolute veto regardless) or explicitly-noted "no fix scheduled" maintainability notes, none bordering
eligibility closely enough to need a per-item callout this run.

## 2026-07-19 — sweep run

Batch size requested: 8. Filter: `Risk: low`/`medium` (Risk-high excluded, no exception).

Board had 6 TODO tasks total; 3 were `Risk: high` (excluded, never eligible) and 3 were
`Risk: low` (eligible). Of the 3 eligible, 2 (`fix/chargen-live-rules-version`,
`docs/agents-version-refresh`) already had open PRs (#254, #255) from another
run/session — dropped at pre-flight per the branch-already-exists rule, not touched. No
backfill possible (no further `Risk: low`/`medium` candidates existed on the board).

| Task | Branch | PR | Effort/Risk | Diff-size flag | Outcome |
|---|---|---|---|---|---|
| Inline feedback-widget anon checkbox with its note | fix/feedback-anon-checkbox-inline | #267 | low/low | none | **MERGED** |
| Fix CSS specificity hiding the anon checkbox | fix/feedback-anon-hidden-specificity | #269 | low/low | none | **MERGED** |

**New task discovered mid-sweep:** while verifying the first task in a real browser, found the
signed-out anon checkbox wasn't actually hidden (pre-existing CSS specificity collision,
independent of that PR). Filed directly to `preview` per Step 5, cleared the `Risk: low` bar, and
was folded into this same run's queue — executed and merged as the second task above.

Circuit breaker: not triggered (0 consecutive failures — both tasks merged clean, no code-review
findings, no CI configured on either PR).

Untagged tasks: none on the board.

`preview` is now 4 commits ahead of where this run started (2 task commits + 2 roadmap-doc
commits); ahead of `main` by all outstanding `preview` work — promoting `preview` → `main` is a
separate, human-initiated call.
