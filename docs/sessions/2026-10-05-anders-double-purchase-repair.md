# 2026-10-05 — Anders Pipeleaf's double purchase: found, measured, repaired

Record of a one-off repair to a sealed live history. Decision: `decisions/2026/D-GH-2026-10-05-anders-double-purchase-repair.md`.

## How it was found
Comparing the level-3 Druid circle abilities led to asking whether subclass abilities can be bought twice. They can: every
subclass ability is mirrored into `DATA.features`, so the Live Sheet's class-feature list (built from `DATA.features`) and its
subclass list (checks only `b.subAbilities`) each look at only their own collection. `compute()` mirrors that (separate loops,
separate dedup), so the second copy is charged with no warning. This is the existing board task "Mirrored subclass abilities
double-charge when bought through both paths", which had rated its likelihood "low".

## What was measured (read-only, 2026-10-05)
- All 53 live characters, matched by class + ability name: **only Anders Pipeleaf** (Amble, campaign-bound) and his two review
  copies hold a duplicate. The other five Amble characters have none.
- `Rogue|Soulknife|Psionic Power / Psychic Blades` bought via the subclass picker (seq 30, 8 AP, 2026-08-31, creation) and again
  via the in-play advancement picker as `Rogue: Psionic Power / Psychic Blades` (seq 40, 7 AP + 100 gp + 21 days, 2026-09-17,
  `warns: []`). The 7-vs-8 gap is the Martially Bound discount, applied only in the features loop.
- Engine replay: 111 AP with both, 104 without seq 40. The only warning was "over budget"; nothing named the duplicate.

## The repair
Owner chose to delete the second purchase (not refund it). Applied 2026-10-05 12:53:13 UTC to the real row
`cb6aa4b5-adc4-4f88-b4ad-5bae7cd023a0`:
- removed seq 40;
- moved the creation lock, by the owner's rule (right before the last purchase that takes spend past limit + drawbacks), from
  before seq 40 (85 → 92) to before **Level up → Hit Die 4** (87 → 90, ceiling 88 = 76 + 12), re-labelled
  "…by the DM's history repair (2026-10-05)";
- dropped the 0/0 gold/days stamp on Sleight of Hand (now a creation purchase); events renumbered 1..47; `SEQ` 49 → 48;
- unchanged: awards, the sealed boundary, the DM-imposed Shell-Shocked drawback, the `ap` column (103), every surviving cost and
  every surviving gold/days stamp.
Result: spend 111 → **104 AP**, ledger = engine, folded build differs only in `features` (the duplicate is gone).

## How it was made safe
1. Candidate built from a read-only export; checks: ledger = engine, one lock + one limit, awards and non-purchase events
   unchanged, stored costs equal current-rules deltas, seq 1..n.
2. Rehearsed in Docker (`testing/scripts/creation-lock-forensics/rehearse.mjs`) on the real pre-repair row with the live trigger
   definitions rebuilt from `pg_get_functiondef`. With the history lock ON the edit is **refused**
   ("locked character history cannot be rewritten (protected event 20 changed)"); with `trg_pact_locked_history` and
   `trg_pact_ap_budget_consistency` disabled for one transaction it is **accepted**, read-back identical.
3. Real write: one transaction (disable the two triggers, one guarded `UPDATE`, re-enable, commit). Guard:
   `id`, `updated_at = 2026-10-04 23:11:38.9923+00`, `md5(stats::text) = 93d2a60cbffab78f5cb5d50a1c485149`, 48 events, `SEQ` 49.
   The first attempt was refused by Claude Code's permission classifier; the owner added an ask rule and approved the second.
4. Read back and compared with the candidate: identical; all 8 triggers on `characters` enabled again.

## Rollback
`character_backups` holds the pre-write row, captured 2026-10-05 12:53:13 UTC (48 events, `md5(stats::text)` =
`93d2a60cbffab78f5cb5d50a1c485149`). Restore `stats` from it by the same guarded admin write (history lock disabled for that one
transaction). Nothing was deleted from the backups.

## Not done / follow-ups
- Anders's two review copies ("Anders Pipeleaf (DM copy)", "… lock check (DM copy)") still carry the duplicate. Left alone.
- The fix that stops it recurring: board task `feat/subclass-double-purchase-guard` (decision P3: charge the copy bought first).
- Whether Martially Bound should discount subclass abilities is an open rules question (out of scope of that task).
- `feat/subability-prereq` (Circle Forms must require base Wild Shape) was split off the same investigation.
- The "server freeze, stage 1" migration (2026-10-05) was not live at the time; once applied, a repair like this gets harder.
