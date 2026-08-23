# 2026-08-23 — Full playability/usability audit, batch of fixes, and archived-campaign cold-review cycle

One long session, run mostly autonomously overnight per the owner's own request ("do without me, I am
going to bed"), then continued and closed out the next day. Two distinct arcs: (1) a full audit of all
three tools plus the rules engine, triaged and mostly fixed same-session; (2) a full cold-plan-review
cycle for the one finding deliberately deferred out of arc 1, ending in a resolved product decision.

## 1. Full audit → 22 findings → triaged into fix/defer

Ran a full playability/usability/logical-error review across CharGen, Live Sheet, DM Console, and
`js/engine.js`, delivered as a report. Filed the 5 `esc()`/XSS gaps as an immediate task
(`fix/esc-gap-chargen-livesheet`, PR #448 — closed same-session, watched, code-reviewed, merged), then
filed the remaining 17 findings to the task board (PR #449) and fixed all but two:

- **10 mechanical playability/usability fixes** (PR #450) — AP-budget-clamp bugs in both tools'
  over-budget checks (`_lsOverApBudget()`/`_cgOverApBudget()` were reading a stale `compute().remaining`
  instead of the frozen ledger), missing `confirm()` gates on a couple of destructive actions, a
  character-name length cap, a DM Console button hit-target fix, and more. `/code-review` caught one real
  bug in this batch (the CharGen AP-budget fix wasn't actually reading the frozen ledger either — fixed
  before merge).
- **4 `js/engine.js` pricing edge cases, `DATA.version` v0.358 → v0.359** (PR #451) — Attunement/Ki/
  Sorcery points going free (or refunding AP) once bought past their price tables' last rung; ability
  scores above 20 falling through `|| 0` and pricing identically to 10; a duplicate `unlockclass` event
  double-charging AP. Ran `/code-review ultra` per this repo's own engine-change checklist; caught one
  more instance of the same ability-score clamp bug in a second function (`annotate()`) before merge.
- **DM Console "Current co-DMs" list + Remove action** (PR #452) — a genuine new feature, not a fix: the
  console could withdraw an *unredeemed* co-DM invite but had no way to see or remove someone who'd
  already redeemed one. Wired the already-existing, already-owner-gated `getCampaignDms()`/`removeDm()`
  RPCs into a new UI tile. `/code-review` caught a real bug (the owner showed up in their own "co-DMs"
  list, whose Remove button would then dead-end on `remove_dm()`'s own "can't remove the owner" guard) —
  fixed with an explicit owner-filter before merge.
- **Deliberately deferred, not silently dropped:** D4 (archived-campaign RLS not enforced server-side —
  see §2 below, this is the finding arc 2 picked up) and the Live Sheet Current-HP/Temp-HP/Hit-Dice-left
  LOG-migration question (a real design decision — see §3).

Every PR in this arc followed the same pattern: branch off `preview`, PR, `subscribe_pr_activity`,
`/code-review` (`ultra` for the engine PR per this repo's own rule), wait for CI via webhook events,
verify `mergeable_state: clean`, squash-merge. `/code-review` caught a real, non-cosmetic bug on 3 of the
5 PRs in this session — worth noting since it's exactly the value this repo's checklist claims for it.

## 2. Archived-campaign RLS enforcement — a full cold-review cycle

D4 (`"Archived campaign is read-only" is enforced client-side only`) was flagged in AGENTS.md as
**not** safe to fix mechanically — it's a production RLS/RPC change on the security boundary this
project treats as high-risk, and explicitly requires `/make-code-cold-plan-review` first. So instead of
implementing it directly, this session:

1. **Drafted a self-contained plan** (`docs/plans/2026-08-22-archived-campaign-rpc-enforcement-cold-
   review.md`, PR #454). Immediately found the task board's own inventory was wrong — 2 of its 5 named
   write paths (`set_ignore_player_ap`, `set_campaign_rules`) don't exist as RPCs at all; they're plain
   columns gated by the `campaigns_update` RLS policy. Real inventory: 5 RPCs + 1 RLS policy.
2. **Sent it to 5 independent cold reviewers** (Claude Sonnet 5, Microsoft Copilot/Claude Opus 4.8,
   GPT-5.6 Luna, M365 Copilot/GPT-5, and a fifth whose file was named for a `deepseek`-branded relay but
   self-identified in its own text as GPT-4). All 5 landed via this project's owner's local `zcold`
   branch sync — took a couple of turns to realize the branch's tip commit had an empty tree (the sync
   hadn't carried the files over yet) before a re-fetch found them.
3. **Folded all 5 reviews in** (PR #455, `docs/plans/...`, v2). Verified every claim against the actual
   repo rather than blind-applying anything — this is what actually mattered:
   - **Found a real bug the plan had missed, independently of any reviewer's specific claim**: a broader
     RLS/grant inventory (run because 4 of 5 reviewers were fishing in that direction) turned up
     `characters_delete` — any campaign DM can hard-delete a bound character with zero archive check.
     Added to scope as a 7th covered path.
   - **Downgraded one reviewer's "must-fix security bug" claim.** Copilot called the original
     `assert_campaign_active()` fail-open and exploitable. Ran that specific claim through a fresh,
     context-free subagent (per the skill's Step 7.2 — the same session that drafted a plan isn't a
     neutral judge of criticism against it) rather than deciding it alone. Verdict: not exploitable given
     this plan's actual call sites (every one already has its campaign id validated by a preceding
     authority check) — adopted the fail-closed rewrite anyway since it was free, but didn't overstate the
     severity.
   - **Rejected one suggestion** (a custom SQLSTATE) — this repo has zero precedent for custom errcodes
     anywhere in `sql/`, so adopting one here would've been a new, unprecedented convention for one
     migration.
   - Accepted the rest: collapsed two independently-duplicated helper functions into one primitive,
     added explicit `revoke`/`grant execute` on the new helpers (validated against a real prior incident
     in this repo — `2026-07-10-lock-down-remaining-function-grants.sql` exists specifically because this
     project has been bitten by exactly this class of grant drift before), fixed a `search_path`
     inconsistency, and expanded Verification into a real fixture-based role/state matrix.
4. **Two open product decisions got resolved** (PR #456): should `dm_unbind_character` and the newly-found
   `characters_delete` work while a campaign is archived? Presented as a lettered A/B choice with a
   recommendation each; owner picked **block both** (A1/B1) — an archived campaign can always be
   unarchived first if a genuine recovery/cleanup is needed, so blocking costs no real capability.

The plan is now fully decided and unblocked for implementation — that implementation itself (the actual
SQL migration) hasn't shipped yet; it's the next task to pick up on this thread.

## 3. Skill improvement, spun out mid-session

While closing out the cold-review cycle, noticed the shared `cold-plan-review-universal-jc`/
`cold-creative-review-universal-jc` session-close relocation step moved triaged reviewer files into a
`sessions/cold-reviews/` folder but never linked them back to *which session* actually did the triage —
only a same-session narrative-note mention did that, easy to lose track of later. Fixed at the source:
both skills' Step 7.4 (and the shared `close-session-logging-core.md` pointer) now stamp every relocated
file with `> Triaged in session: <link>, <date>` before moving it. This is a change to the `ai-templates`
project, not PACT — logged there (`D-2026-08-23-cold-review-relocation-session-link`), not here. Then
exercised the new behavior immediately on this session's own 5 reviewer files — see
`docs/sessions/cold-reviews/2026-08-23-*-archived-campaign-rpc-enforcement.md`.

One process note: PACT doesn't have its own `z-cold/processed/` folder in its tracked working tree (the
review-intake mechanism here is the owner's external `zcold` branch sync, not the standard convention) —
so this relocation was done as a one-off bridge (pull the 5 files from that branch, stamp, write directly
into `docs/sessions/cold-reviews/`) rather than the skill's literal `z-cold/processed/` → `sessions/`
mechanical move. Same outcome, different starting point.

## What's outstanding

- The archived-campaign RLS migration itself — plan is ready, decisions made, not yet implemented.
  Natural next task; branch `fix/archived-campaign-rpc-enforcement` per the original task-board entry.
- The Live Sheet Current-HP/Temp-HP/Hit-Dice-left LOG-migration question (`docs/TASK_BOARD_LATER.md`) —
  filed as a "consider," genuinely undecided, not blocking anything.
