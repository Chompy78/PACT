# PACT — Sweep log

> One entry per `/sweep-tasks` run, **newest first**. Records what was *attempted*, not just what
> shipped — `CHANGELOG.md` only ever shows successful merges, so this is the only place a pattern of
> repeated parks/drops (a signal the `Effort`/`Risk` classification criteria need retuning) leaves a
> trace. Written by `/sweep-tasks` Step 7 itself, committed directly to `preview` (docs-only, no
> approval-wait, same convention as `/add-task`'s own direct-commit flow).

Entries land here starting with the first real `/sweep-tasks` run.

## 2026-10-20 — sweep run (unattended, user away)

Batch size: the user asked for "the top 10–15 items" of the board and to be told which could not be done. Of 11
tasks tried across three parallel batches, **3 shipped**, **1 was stopped by a permission block mid-rebase**, and
**7 were skipped**. Circuit breaker never tripped. Nothing was merged by the sweep itself (user instruction); the
user separately approved merging #697.

| Task | Outcome | Effort / Risk |
|---|---|---|
| `feat/livesheet-buy-fullpage` | **Shipped — PR #697, merged by the user's go-ahead after all 25 checks passed.** ⤢ Expand on Buy / progress; hidden on phones; +11 e2e checks. | small / low |
| `feat/dm-rules-lock-bars` | **Shipped — PR #701** (open). Pinned 🔒 lock bar on each locked Campaign Rules section; +7 e2e checks. | low / low |
| `widen-protected-projection.sql` edited after apply | **Shipped — PR #699** (open). Header comment now says the file stands for both applied migrations; comments only. | small / low |
| `chore/racialfx-single-source` | **Done, not pushed — blocked.** Two commits rebased onto `preview` conflicted in `js/engine-data.js` (one giant line, also changed by #696) and the Live Sheet. The mechanical fix (`git checkout --ours js/engine-data.js`, re-run the move script, resolve one hunk) was refused by the auto-mode classifier as a destructive overwrite, so it waits for the user. Commit `ed4fd1f` on `chore/sweep-small-ui-2026-10-20`. | low / low |
| `fix/tool-pricing-tab-flake` | **Skipped — not reproducible again** (11 of 11 passes on an unmodified tree, second sweep in a row). Side finding: each gate run leaks a `/tmp/pact-cdp-*` Chromium profile. | small / low |
| `test/seal-roundtrip` | **Skipped — ineligible again.** Needs a real PostgREST error body (production write or a PostgREST image not installed here). | small–medium / low |
| `test/sql-drift-guard-auto-discovery` | **Skipped — ineligible again.** Board text is stale (the guard now loads ~20 migrations and checks 47 functions of 77 files); auto-discovery needs an owner rule for which files count. | medium / low |
| `ui/show-granted-proficiencies` | **Skipped — risk understated.** CharGen reads its tick boxes back as the build, so ticking/locking a granted proficiency would write a derived flag into the log and could silently refund AP. A "from Warden" note beside the box is the safer variant, a different design. | low / low |
| DECISIONS record for PR #503's SQL commits | **Skipped.** Written for the commits' author; reconstructing it would be invention. | small / none |
| Which of D1/D2 governs a pre-lock level-up | **Skipped.** Owner picks the stated rule. | low / low |
| `check/server-freeze-stage2-after-apply` | **Skipped (partly checked).** Needs an owner export of live characters; the log window is 24 hours. Read-only: 0 freeze refusals in the last 24 h, no advisor findings on the freeze functions. | low / low |
| Reconcile the `documents-rules:` pointer | **Skipped.** Spans the `pact-guide` project. | low / low |

Pattern worth acting on: three of the same tasks (`tool-pricing-tab-flake`, `seal-roundtrip`,
`sql-drift-guard-auto-discovery`) have now been parked on two sweeps in a row. Their `Effort`/`Risk` tags say
"small / low", but each needs something the sweep cannot supply (a flake that will not reproduce, a PostgREST
image, an owner rule). They should be re-tagged or rewritten, or they will keep being re-queued.

Not queued: every `Risk: high` task (the skill's absolute veto), every `DECISION NEEDED` task, the Edge Function
task (conflicts with "no custom backend code in the repo"), `chore/character-images-orphan-sweep` (deletes files
with the service role), and `docs/reconcile-pact-guide-primal-order` (work in another project).

## 2026-10-19 — sweep run

Batch size: asked once (recommended 3) — user picked **5**. Of ~10 tagged low-risk tasks, **1 shipped**; the
rest were parked, found stale, or ineligible on a read of their bodies. Circuit breaker never tripped.

| Task | Outcome | Effort / Risk |
|---|---|---|
| `fix/random-fighter-int-priming` | **Shipped — PR #679.** Reproduced deterministically (seed 51, `battlecaster`, Tiefling Fighter INT 20 / STR 16): the roller spreads random +2 bumps over every ability and adds species-preferred stats, so INT can legitimately lead. The *assertion* was wrong, not the roller; it now requires the Fighter's own STR ≥ 16 over 200 fixed-seed rolls and prints a replay seed. Proven both ways (2,400 seeded rolls pass; reverting the `trad&&` guard fails 135/200). | low–medium / low |
| `fix/tool-pricing-tab-flake` | **Parked — not reproducible.** 11 of 11 consecutive runs passed (191/0) on an unmodified tree, so the one-tab-per-tool refactor of a 2,255-line harness could not be measured against a failing baseline. Confirmed instead that every run leaks a `/tmp/pact-cdp-*` user-data dir (the task's second hypothesis is still open). Note the task text is stale: the readiness poll is already 60s, not 30s. Retry in an environment where it fails. | small / low |
| `docs/fix-phb-jsonl-bundled-entries` | **Dropped — already done.** All four bundles are separate entries in `docs/phb-rules-final.jsonl` (Tactical Mind / Shift / Master; Empowered Strikes / Self-Restoration; Perfect Focus / Body and Mind; Roving / Tireless). The file has one commit, so it was created already split. The board entry is stale and should be removed by the owner. | low / low |
| `test/sql-drift-guard-auto-discovery` | **Skipped — ineligible.** The task says it "needs a design decision"; `psql` cannot glob `\ir`, so auto-discovery means restructuring the harness. The hardcoded list in `rls-baseline-test.sql` is also now 18 migrations, not the 4 the task describes. | medium / low |
| `test/seal-roundtrip` | **Skipped — ineligible.** Needs a REAL PostgREST error body captured from the live trigger; plain Postgres gives only the raw fields, and the task forbids a hand-built body. Also needs a design call on the stub-server seam. | small–medium / low |

Not queued, with reasons: `feat/livesheet-buy-fullpage` and the pre-grey-tiles task (UI layout is a taste
call); *Fold the player-award-after-lock migration* (live-DB re-measure, `Risk: medium`, another session is
editing `rls-policies.sql`); *Reconcile guide↔engine rules-version drift* (open step lives in `pact-guide`);
the favicon task (touches other projects); the two decision-needed guide-vs-engine rows and the
`DECISIONS.md`-record tasks (owner's call / author's reconstruction); the `~/.claude/skills/` sync check
(outside this repo). No untagged tasks were encountered in the queue.

## 2026-08-24 — sweep run

Batch size requested: unspecified, so asked once via `AskUserQuestion` (recommended 3; offered "All 6" and
"1 — just the safest one" as alternatives) — user picked **All 6**.

`docs/TASK_BOARD_NEXT.md`/`_LATER.md` held a mix of tagged and untagged open `TODO` tasks. Reading each
task's own body (not just its Effort/Risk tag) before queuing anything found 6 genuinely eligible —
every one carrying a mechanically-verifiable "Done when" and no `Risk: high` — and excluded 11+ others
despite some carrying low/medium tags on their own: several needed a genuine design/taste call (CharGen
random-generator tuning, the context-pricing whole-build-delta question), several were explicitly
self-scoped "not sweep-eligible" in their own task text (password reset, invite rate-limiting, the
Edge-Function AP-validation prerequisite), one spanned a project outside this repo's scope
(`pact-guide`'s own drawback cap-wording reconciliation), and the rest were `Risk: high` (an absolute
veto per this skill's own gate) or open-ended audits with no single mechanical pass/fail.

Execute order: ascending effort/risk, per the skill's own tiebreak.

| Task | Branch | PR | Effort/Risk | Outcome |
|---|---|---|---|---|
| 7 CI gates never trigger on a `js/engine-data.js`-only change | `ci/engine-data-path-filters` | #458 | low/low | **MERGED** |
| Cache Chromium in the browser CI jobs + step-level install timeout | `ci/cache-chromium` | #459 | low/low | **MERGED** |
| `guide-price-check.mjs` has zero drawback-price coverage | `test/guide-drawback-price-check` | #460 | low/low | **MERGED** |
| Purge the "pace curve" mislabel from 5 historical records | `docs/pace-curve-terminology` | #461 | low/medium | **MERGED** |
| Live Sheet drawback purchases bypass `legalCheck()` entirely | `fix/livesheet-drawback-legalcheck` | #462 | medium/medium | **MERGED** (2 code-review findings fixed pre-merge: `buy()`'s default pricer would have wrongly zeroed drawback cost; routing through `legalCheck()` would have newly hard-blocked an advisory-only cap warning — both fixed and verified before push) |
| Warn when `compute()` hits a rules-table reference no longer in DATA | `feat/warn-missing-data-refs` | #463 | medium/medium | **MERGED** (audit found 7 sites at first pass, an 8th — `racialSpells`/lineage — caught by `/code-review ultra` after; the same review also caught a real stored-XSS regression the change introduced, since these are the first `compute().warnings` entries to carry attacker-controlled free text rather than a curated `DATA` key — both fixed and verified before push) |

**Bookkeeping gap found and fixed mid-sweep, not a 7th task:** PRs #458–460 merged without their
`CHANGELOG.md` entry or task-board graduation (a violation of `AGENTS.md`'s own per-change checklist step
5/7) — caught by cross-checking each merged PR's actual diff against live GitHub state before writing
this entry, rather than trusting an in-progress record that claimed they were fully bookkept. Backfilled
in a same-day follow-up, `docs/graduate-458-459-460-task-board` → **PR #464, MERGED**. Also caught and
fixed live: PR #462 had genuinely not been merged despite an in-progress record claiming it was — it
still had 6/6 green CI and a clean merge state, so it was merged as part of closing out this run, not
re-executed. Two merge conflicts arose from the resulting PR sequencing (#463 against #462, then #463
against #464, both from CHANGELOG.md's newest-first insertion point) — both resolved by merging `preview`
into the PR branch and re-verifying (`engine-parity-ci.mjs` 59/0 each time), no rebase/force-push, per
`AGENTS.md`'s own merge-conflict handling rule.

Circuit breaker: not triggered (0 consecutive failures across all 6 tasks — every task verified against
its own "Done when" before push: `engine-parity-ci.mjs` 59/0 and `tool-pricing-ci.mjs` 174/0 by the end of
the run; 2 new tool-pricing regression tests for the XSS fix were confirmed to fail red against the
reverted fix before being trusted green; the guide-price-check gate was live-tested by deliberately
mispricing one drawback on a scratch copy and confirming it failed loud before restoring it).

Untagged tasks: not enumerated individually — the boards' untagged items were either `MOSTLY DONE`
entries with an already-scoped remaining step spanning `pact-guide` (out of this repo's sweep scope) or
maintainability notes with no "Done when" to check against, none bordering eligibility closely enough to
warrant a per-item callout this run.

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
