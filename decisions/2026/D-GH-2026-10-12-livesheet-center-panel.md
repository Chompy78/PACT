# D-GH-2026-10-12-livesheet-center-panel — skill totals come from the engine; the drawback-count advice is a DM switch

Status: Active. Engine + Live Sheet + CharGen + DM Console + `js/campaign.js`. No `DATA.version` bump: no price, gate or
existing `compute()` output changes. The new `opts.drawbackCountAdvice` only removes an advisory warning when a campaign asks.

## Context

Owner request, 2026-10-12: make the Live Sheet's center panel more useful — every skill, owned or not, with its ability and
total bonus in a vertical list on the left; an (i) after each boon and drawback showing its effect; name the blank spells and
languages in the "not filled in" notice; and a way to switch off "N drawbacks chosen — most DMs cap this at 2–3".

## Options (owner chose B1, C1, D = DM Console, E1)

- Skill totals: **B1** a new engine export; B2 compute them in the Live Sheet (rules logic outside the engine).
- Effect icon: **C1** tap/click opens a small box (also hover); C2 hover-only `title` (does nothing on phones).
- Switching the advice off: D1 automatic when a campaign sets a drawback cap; D2 a per-character "hide" in Needs review;
  **owner's answer: a DM Console setting** — the DM decides for the campaign.
- Boons: **E1** there is no boon equivalent; only the drawback count is "most DMs cap" advice.

## Decision

1. `skillMods(b, r)` in `js/engine.js` returns each `DATA.skillList` skill's ability, modifier, proficiency (0/1/2) and total.
   Initiative follows `compute()`'s rule (DEX unproficient, WIS + proficiency proficient), so its row equals `r.init`.
2. Campaign rule `rules.drawbackCountAdvice` (absent = on), a DM Console checkbox under the drawback cap.
   `drawbackCountAdviceFromRules()` in `js/campaign.js` turns it into `compute()`'s `opts.drawbackCountAdvice`, alongside
   `drawbackCapFromRules()`, and all three tools pass it. `purchaseLegality()` gained an optional `opts` so the check run on a
   purchase sees the same campaign settings as the sheet.

## Found on the way

- Drawbacks' hover text was always blank: the sheet read `.fx` off `DATA.drawbacks[x]`, which is a price. Effects live in
  `DATA.drawbackFx`.
- The Live Sheet's Needs review ran `compute(b)` with no campaign options, so it ignored the campaign's drawback cap. It now
  uses `_dmOpts()`.
- The DM Console roster passed `_dmCampaignApRules` (a wrapper: `{ignorePlayerAp, campaignId, customFields, rules}`) to
  `drawbackCapFromRules()`, which reads `.drawbackCap` — so the DM's roster never applied the cap the player tools did. Now
  `_apr.rules`. A DM sees the same capped figure as the player for characters whose drawbacks exceed the cap.

## Why

The engine is the only place rules live, and a skill bonus is a rule — CharGen can reuse the export. A DM switch matches how
every other campaign-wide judgement (bans, caps, post-lock drawbacks) is already made, and it needs no schema change: rules is
free-form JSON.

## Verification

`testing/scripts/livesheet-center-panel-e2e.mjs` (new, 23 checks, desktop and phone). engine-parity 104/0, engine-legality
76974/0, engine-priceof 7701/0, tool-pricing 189/0, dm-console-ui 119, dm-console-unlock 19/0, economy-ui 155, Live Sheet e2e
suites, post-lock fuzz 0 mismatches, static audit 0 failed. Not browser-tested: ticking the DM Console checkbox and saving.
