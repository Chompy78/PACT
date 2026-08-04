# D-GH-2026-08-04-dm-console-dm-ap-budget — DM Console priced every roster AP figure against player AP only

Status: Active

## Context

Reported by the owner from the live Amble campaign: the roster flagged Anders Tealeaf and Cedric
Brightblade as over budget "by the 27 and 36", and correctly identified that the deficit was measured
against player AP alone rather than the DM-awarded pool.

Reproduced against the real production rows before changing anything, which mattered — the first
mechanism I reached for was wrong. Cedric's `-36` looked like it came from the roster card's "AP left"
cell (`economy().available`), and for Cedric it coincidentally does, because his log has no awards. But
Anders' `economy().available` is `-15`, not `-27`. Running the real engine over both logs produced the
reported figures exactly:

| character | `characters.ap` | `economy()` earned / spent | `compute(b)` total / spendable / remaining |
|---|---|---|---|
| Anders Tealeaf | 33 | 6 / 21 | 33 / 6 / **−27** |
| Cedric Brightblade | 36 | 0 / 36 | 36 / 0 / **−36** |

`js/engine.js:423` — `if(remaining<0) W.unshift("OVER BUDGET by "+(-remaining)+" AP")`. The reported
numbers are that warning string, surfaced as the ⚠ badge on the roster card. So the observation was
right and the number was right, but "the AP-left cell is wrong" would have been the wrong fix target:
**two different figures were wrong, for one shared root cause.**

## The root cause

DM AP is stored **only** on `characters.ap` and is deliberately never written into the character's log
(the two-pool model on `compute()` in `js/engine.js`; `characters.ap` is server-authoritative and
DM-only). `dmAnalyze()` called `compute(b)` with **no opts** and reported `economy()`'s totals, and
`economy()` can only see the log. So every AP figure DM Console displayed was player-log-only:

- the card's "AP left" stat and the table view's "AP Avail" column (`economy().available`)
- the ⚠ **OVER BUDGET by N AP** warning (`compute().remaining`, with `dmAp` defaulted to 0)
- the AP Ledger's `total / budget` line (`36 / 0` for Cedric)
- the party-total "N AP available across the party" line

Amble runs `ignore_player_ap = true` with the entire budget granted as DM AP, so for that campaign the
player pool is *zero by design* and the whole budget was invisible. Every character read as deeply
overspent, and the roster contradicted what those same players saw on their own Live Sheets.

## Decision

Thread compute()'s `{dmAp, ignorePlayerAp}` through `dmAnalyze(exported, apOpts)` →
`analyzeAug(raw, apOpts)` → `cloudAnalyze(row)`, which supplies `{dmAp: row.ap, ignorePlayerAp:
window._dmCampaignApRules.ignorePlayerAp}`. The campaign's switch reaches the roster IIFE through a
window seam set by `selectCampaign()` before the roster is fetched — the same cross-closure pattern as
`_dmRenderCloudRoster`.

`available` becomes `r.spendable - eco.spent`.

## Why

**Why not just add `dm.ap` to the AP-left cell.** That is the shallow fix and it is wrong three ways:
it leaves the OVER BUDGET warning, the AP Ledger line and the table column still showing player-only
figures — three different AP truths in one screen — and it ignores `ignore_player_ap`, so it would
*over*-count on a campaign that counts both pools. The mutation test for this is explicit: forcing
`ignorePlayerAp: false` yields 18 where 12 is correct, and that check fails.

**Why `spendable − economy().spent`, not `compute().remaining`.** These disagree: for Anders,
`compute().remaining` is 0 but `spendable − eco.spent` is 12, because `compute().total` reprices the
build at today's numbers (33) while the frozen ledger records what was actually paid (21). `AGENTS.md`
is explicit — any UI showing "AP left" for an event-sourced character must use the frozen ledger, not a
retroactive recompute (D-GH30). This is also character-for-character the Live Sheet's own
`_apRemaining(spendable, spent)`, so the DM and the player now read the same number from the same
formula. The AP Ledger panel keeps showing `total` because repricing is that panel's actual subject.

**What was deliberately NOT changed.** `apLevel` still uses `trackLevel(eco.earned)`, so a fully
DM-funded character reports Earned Lv 0. That is wrong in the same family of ways, but it is wrong
*identically in the Live Sheet* (its "Earned Lv" reads `eco.earned` too), so fixing it here alone would
replace a shared bug with a new divergence between the two tools. It belongs to the open
`feat/ap-model-reconcile` task, and is noted there rather than silently half-fixed.

**Toggling ignore-player-AP now re-fetches the roster.** That switch is half of every character's
ceiling; its own tooltip promises it "can change several players' budgets at once". Leaving the roster
showing pre-toggle budgets would make the promise unverifiable at the moment it is made.

## Verification

Reproduced before and after through the real page with the real Amble logs:

| | before | after |
|---|---|---|
| Anders "AP left" | −15 | **12** |
| Cedric "AP left" | −36 | **0** |
| ⚠ badge | OVER BUDGET by 27 / 36 AP | none |

`dm-console-ui` 73 → **79 checks**. Four mutants, all killed: reverting `available`, dropping the opts
from `compute()`, hardcoding `ignorePlayerAp: false`, and zeroing `dmAp` each fail with a distinct
signature. One check deliberately asserts that a character with **no** DM AP still shows −15 and still
warns OVER BUDGET — the fix must not paper over a genuinely overspent character.

UI-only. No `DATA.version` bump (`compute()` untouched — it already had the correct model; only its
caller was passing nothing). `engine-parity` 24/0, `audit` 29/0, `log-fuzz` 500/500,
`chargen-flows` 27/27.
