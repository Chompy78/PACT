# 2026-08-22 — Amble campaign: AP/award audit, test-character cleanup, v1.442 pricing check

No engine or tool code touched this session — everything ran directly against the live PACT Supabase
project (`piuprrrnaotrtxucrtsb`). Recorded here for traceability of the production-data changes, and
because the AP audit method turned out to have a real gotcha worth remembering.

## 1. DM AP / award-ledger report for Amble

Answered "how much DM AP does each character in Amble have, broken down by award event?" by querying
`campaigns`, `characters`, and `ap_awards` directly. Found the current 7-character Amble roster and their
per-event award breakdown (Creation budget / Chapter 1–3 bonuses / one-off joins).

While building that report, a naive `ap_awards.campaign_id = Amble` join also surfaced 5 extra award rows
belonging to characters **no longer bound to Amble** (`characters.campaign_id` now `null`) — `ap_awards`
rows keep the campaign_id they were stamped with at award time, so they don't disappear when a character
is later unbound. Flagged this rather than reporting inflated numbers.

## 2. Deleted 3 test characters

Owner asked to delete `Sera Valor 3rd`, `Cedric Brightblade`, and `Moss Stormspud (COPY)` — all unbound
from Amble — describing them as personal test characters tied to `jrc.chow@gmail.com`. Checking actual
ownership first (per `AGENTS.md`'s "verify before writing an absence claim" discipline, applied here to
"these are mine" before running a destructive delete) found only `Moss Stormspud (COPY)` was actually
owned by that email; `Sera Valor 3rd` and `Cedric Brightblade` were owned by `delete@test.com`. Surfaced
the mismatch via `AskUserQuestion` before deleting anything — owner confirmed `delete@test.com` is their
own other test account and to delete all three anyway.

All three deleted via direct `DELETE FROM characters ... RETURNING id, name` (first attempt hit a
connection timeout with an ambiguous outcome — re-queried to confirm the rows were still present before
retrying, rather than assuming either success or failure). `trg_characters_snapshot` means a pre-delete
snapshot of each landed in `character_backups` regardless, so this is recoverable at the DB level even
without an in-app restore UI. Their `ap_awards` rows cascade-deleted with them.

## 3. AP-cost audit against current engine pricing (v1.442 / DATA v0.358)

Owner asked to check whether each of the 7 remaining Amble characters is still built within budget under
*today's* pricing. Wrote a throwaway Node script (`/tmp` scratchpad, not committed) importing
`js/engine.js` directly — it runs as a plain ES module outside the browser with no changes needed — and
called `rebuildStateFromEvents(character.stats, [])` per character.

**First pass was wrong and worth recording why.** Comparing `characters.ap` (the DM-authoritative column)
against the fold's own `budget` showed every character "mismatched" and "OVER BUDGET" by huge margins.
The `budget` that `foldBuild()`/`rebuildStateFromEvents()` derive is **awards folded from the LOG itself**
only — DM Console's `award_ap()` grants land in `characters.ap`, a separate column that is never written
into the character's own event log (per `js/engine.js`'s own comment: `DM AP ... stored server-side only,
NEVER in the character's log`). `compute()` only combines the two when the caller passes `characters.ap`
in as `opts.dmAp` — `spendable = playerAp + drawbackGrant + dmAp`. Passing that in fixed the check
entirely; without it, *every* headless audit of a real character will read as wildly over budget, which
is a trap worth flagging for the next session (or script) that tries this. Lesson candidate for
`ai-lessons-learned`: when replaying an event-sourced total, check for state that lives outside the log
entirely before concluding the log itself doesn't reconcile.

**Result, corrected:** 6 of 7 characters fit within their granted AP under current pricing with no other
engine warnings. **Anders Pipeleaf is over budget by 4 AP** (spendable 63, build costs 67) — not acted on
this session; the owner was told and can decide whether to grant more AP or trim the build. This is a
campaign/DM-facing finding, not an engine defect, so it doesn't belong on `docs/TASK_BOARD_NOW.md`.

## Net result

No repo code changed. Three test characters removed from the live Amble campaign (owner-confirmed,
DB-recoverable via `character_backups`). One real character (Anders Pipeleaf) confirmed over budget under
v1.442/`DATA.version` v0.358 pricing — flagged to the owner, not yet resolved.
