# FULL PLAN: Campaign-wide house rules for PACT (cold-review edition)

Date: 2026-10-13 · Author: planning agent (read-only exploration) · Status: DRAFT for cold review · Owner decisions P2/R1/U1/T2/S2 are final; everything marked **[ASSUMPTION]** or **[DECISION NEEDED]** is not.

## 0. Background a cold reviewer needs (how PACT works today)

**The app.** PACT is a vanilla-JS, static (GitHub Pages) tabletop-RPG character tool suite with an optional Supabase backend (Postgres + row-level security; no custom server code — logic on the server is SQL functions/triggers only). Three UI tools: **CharGen** (character creation), **Live Sheet** (play-time sheet, buying upgrades with AP), **DM Console** (campaign management). One rules module, `js/engine.js` (+ `js/engine-data.js` = `DATA`), is the single source of truth for all rules; tools must not re-implement rules.

**Event sourcing.** A character is stored as an append-only `LOG` of events: `{type:'award', amount}`, `{type:'buy', cat, payload, cost}`, `{type:'buyoff', refVal, cost}`, DM events (`dmRemoveBoon`, `dmUnlockDrawback`, `sessionSeal`), etc. `foldBuild(LOG)` replays it into a build `b`. `compute(b, opts)` prices the build and derives everything (HP/AC/warnings/AP). Derived values are never stored. `cost` on a buy event is **frozen at purchase**.

**Two AP views (important).**
- `economy(LOG)` = the *frozen ledger*: `spent` = sum of frozen buy/buyoff/names costs (patch costs excluded); `drawbackEarned` = −cost of each drawback buy not bought off.
- `compute(b, opts)` = *retroactive* pricing: `total` re-prices every owned item at today's prices; `spendable = playerAwards (unless opts.ignorePlayerAp) + drawbackGrant + opts.dmAp`, where **`drawbackGrant` is derived from the names of held drawbacks × their CURRENT value** (house-rule override, else `DATA.drawbacks`), capped by `opts.drawbackCap`. DM-imposed drawbacks (dmEdit and cost ≥ 0) grant 0.
- **"AP left" shown and gated in every tool = `compute().spendable − economy().spent`** (decision D-GH30: never use `compute().remaining` for AP left). Consequence: **repricing a held boon never changes AP left** (spend is frozen), but **repricing a held drawback DOES**, because the grant side is derived from current values.
- **Server ledger** (`pact_ap_ledger_spend`, used by the BEFORE UPDATE trigger `pact_enforce_ap_budget_consistency` on campaign characters): spent = frozen non-patch buy/buyoff/names costs; player_earned = awards + (−cost of every drawback buy). Refuses a save only if spent *increases* and exceeds `characters.ap + (ignore_player_ap ? 0 : player_earned)`.

**House rules today (per character).** CharGen writes a patch event `{type:'buy', cat:'patch', _slot:'houseRules', payload:{patch:{houseRules:{boons:{name:{hd,ap,fx}}, draws:{name:{ap,fx}}, disabled:{boons:[],draws:[]}, dmAllows:{bound,boons,drawbacks,tasha}}}}}`. `MUT.patch` folds with `Object.assign` (last houseRules patch wins wholesale); a `tasharule` event can set `dmAllows.tasha`.
- `compute()` reads `houseRules.boons` (price/HD of boons), `houseRules.draws` (drawback grant), and `dmAllows.tasha===false` (a ⛔ hard warning on owned non-core items).
- `dmAllows.bound/boons/drawbacks` and `disabled` are **picker gates only** (CharGen UI), never read by `compute()`.
- Since #638, a confirmed campaign character's player cannot change houseRules (client-side refusal only).

**Campaign options today.** Tools build `compute()`'s `opts` from `campaigns.rules` via helpers in `js/campaign.js` (`drawbackCapFromRules`, `drawbackCountAdviceFromRules`) plus `campaigns.ignore_player_ap` and `characters.ap` (DM AP). They are gated on the campaign being reachable (`_rulesStatus==='active'`). DM Console does this per roster row in `cloudAnalyze()`. Campaign bans (`bannedBoons`, `bannedDrawbacks`, …) are validation + picker-hiding only (`validate(b, rules)`, `cloudRuleBarred`); already-owned items are kept and reported ("grandfathered").

**Offline carry.** The Live Sheet writes a `rulesSnapshot` event (a whole copy of `campaigns.rules`, or `null` on leave) into the LOG. It is inert to the engine and lets bans apply offline. CharGen does not read or write it; DM Console reads it.

**Other pricing paths.**
- `priceOf(cur, cat, payload)` prices a new purchase. Its drawback pricer reads `DATA.drawbacks` only and **ignores house rules**.
- `purchaseLegality(cur, cat, payload, opts)` does the same, with opts.
- `repriceDraft(events)` re-stamps every non-drawback buy cost while the character is still a creation draft (before the creation lock). It takes no campaign opts.

**Server write paths.**
- Players UPDATE their own `characters.stats` directly under RLS.
- DMs append to a player's log only via `dm_edit_character_log(p_character, p_events)`. It is SECURITY DEFINER, whitelists event types, and stamps `seq/ts/dmEdit:true/dmId` server-side.
- Triggers on `characters`:
  - budget consistency (above).
  - `pact_enforce_locked_history`: freezes the "protected" projection of events up to max(last sessionSeal, last non-discretionary award, last creationLocked if currently locked). houseRules-only patches are exempt via `pact_patch_exempt_keys() = {appearance, houseRules, gold}`.
  - `pact_enforce_creation_lock`.
- Campaign rules are saved by a plain whole-blob `UPDATE campaigns SET rules = …` from DM Console.

**Open PR #642 (not merged; its migration NOT applied):**
- Adds a DM Console per-character house-rules editor. It sends a `buy/patch` event carrying only `houseRules` through `dm_edit_character_log`, which a migration extends to accept it.
- The server forces cost 0, validates the shape strictly, and refuses characters still in creation (because `repriceDraft` would turn cost 0 into a refund). It refuses any change to a drawback the character holds (because browser and server would diverge).
- Known follow-ups: (a) a DM's event keeps applying after the character leaves the campaign; (b) a player can still rewrite their own houseRules server-side (exempt list; task `feat/server-freeze-houserules-gold`).

**Live measurement (2026-10-13, owner-approved read):**
- 37 characters; 31 carry a houseRules patch (21 solo, 10 campaign-bound). Every one is the all-on default, with no overrides and no disabled list.
- 5 campaigns; only one has characters (10). It has `ignore_player_ap=true`.
- That campaign's `rules.houseRules` is `{}` (this key is DM Console's free-text "house rules" labels map `{label: bool}`, unrelated). `rules.bannedDrawbacks` lists 10 names; `bannedBoons` is empty.
- Conclusion: with a campaign default of "all calls on, no overrides", nobody is repriced on rollout.

## 1. Owner decisions (final, restated)
- **P2.** House rules are set CAMPAIGN-WIDE by the DM. Scope: the DM Calls (bound/boons/drawbacks/tasha=non-core), custom/repriced boons (`boons`), drawbacks (`draws`), and the `disabled` list.
- **R1.** Keep #642's per-character DM editor as OVERRIDES on top. Its migration may still be changed.
- **U1.** Precedence: DM per-character override > campaign rules > the character's own CharGen patch. The own patch applies only when solo; it is ignored while in a campaign and comes back if the character leaves. No history rewrite.
- **Turning a call off (default):** it does NOT remove owned items; it only stops new purchases.
- **T2.** The DM may opt in (checkbox, default off) to remove the item from everyone who owns it, with refund. A boon is refunded; a drawback's grant is taken back. This may push a character over budget.
- **S2.** The DM may reprice a drawback that characters already hold. DM Console lists each holder with the AP effect; the DM ticks who it applies to. Unticked holders keep their old value. Browser and server must agree on AP.

## 2. Findings that shape the design (with evidence)

**F1. Name collision.** `campaigns.rules.houseRules` is already DM Console's free-text label map (`currentHouseRules`, saved in the rules blob; `validate()`'s doc also lists it). The live `{}` is that map. → Store character house rules under a **new key**, proposed `campaigns.rules.charHouseRules`. **[DECISION NEEDED: key name.]**

**F2. Overlap of "disabled" with bans.** Campaign `bannedBoons`/`bannedDrawbacks` already do exactly what `houseRules.disabled` does at campaign level: hide from pickers, keep owned, report in `validate()`. `RULE_BAN_FIELDS` even aliases `draws → bannedDrawbacks` "(e.g. HOUSE.disabled.draws)". → **Campaign-level "disabled" = the existing ban lists. No new campaign `disabled` field.** The per-character override keeps its own `disabled` (adds to the bans). v1 has no per-character un-ban. **[ASSUMPTION]**

**F3. Only drawbacks move AP left.** See section 0. A campaign reprice of a boon changes only `compute().total`'s display line for existing holders, which is the already-accepted D-GH30 display divergence. It also re-stamps the cost for holders still in a creation draft at their next save, which is intended draft semantics. A reprice of a drawback changes `spendable` in the browser for every holder, and the server never sees it. S2 exists because of this.

**F4. Existing browser/server disagreement on drawback grants (pre-existing, flagged).**
- (a) CharGen's pre-lock checklist prices a purchase as `compute(cand).total − compute(cur).total`. Drawbacks never move `total` (they are income in model (b)), so **CharGen-drafted drawback events are stored at cost 0**. Verified in node: delta 0, while `priceOf(…,'drawback',{v:'Peg Leg'})` = −4. The server therefore counts 0 grant for those characters; the browser counts the full grant.
- (b) The server's `v_spendable = ap + (ignore_player_ap ? 0 : player_earned)` drops drawback grants in ignore-mode campaigns. The engine deliberately keeps them (v0.356, `D-GH-2026-08-19-drawback-grant-vs-ignore-player-ap`). The one live campaign is ignore-mode.
- Both make the server *stricter* than the browser: a purchase can pass the client gate and then be refused on save. **Consequence for this plan:** a frozen-cost-based engine redesign, where compute takes the grant from the event cost, is NOT viable, because it would zero the grants of every CharGen-made character. S2 must instead move both sides by the same **delta**.

**F5. Live Sheet is house-rule-blind.**
- Boon/drawback pickers list `DATA` only (no custom items, no `dmAllows.boons/drawbacks`, no `disabled`).
- Drawback tile price and buy-off refund read `DATA.drawbacks[v]`, so a custom drawback's buy-off costs 0.
- `priceOf`'s drawback pricer ignores `houseRules.draws`, so a custom drawback is stamped at cost 0 in the Live Sheet.
- Campaign-wide custom items are useless until this is fixed.

**F6. DM-event integrity gap.**
- No trigger stops a player writing an event with `dmEdit:true` into their own row, or deleting a DM event that lies after the protected boundary. The client's undo treats `dmEdit` as a barrier; the server does not.
- Today the worst a forged or deleted DM event does is cosmetic or small. Once refund events exist (T2), a forged `dmRefundBoon` would be an AP mint.
- → New server guard required (Phase 3).

**F7. `compute()` call-site count.**
- CharGen ~69, Live Sheet ~39, DM Console ~12, plus internal engine calls (`priceOf`, `purchaseLegality`, `repriceDraft`, level-up pricing).
- Threading a new opt through all of them is high-risk. But every tool has ONE fold entry point: Live Sheet and DM Console `foldBuild(uptoIdx)` wrappers; CharGen `readBuild()` = `foldBuild(LOG)`; DM Console `analyzeAug`. The engine's `clone()` is a JSON deep copy, so underscore keys survive into candidate builds.
- → Stamp the context on the folded build (same pattern as the existing derived, never-saved keys `b._lostPurchases`, `b._raceTraitLocked`, `b._imposedDrawbackIdx`).

**F8. Overlap with `feat/server-freeze-houserules-gold`.** Under U1, a campaign character's own houseRules patch is ignored by `compute()`, so a player rewriting it server-side stops mattering while bound. It matters again only when solo, where there is no server budget. That task's risk shrinks; coordinate, don't duplicate.

## 3. Data model

**3.1 Campaign layer.** In `campaigns.rules`:
```
charHouseRules: {
  schema: 1,
  dmAllows: { bound?: bool, boons?: bool, drawbacks?: bool, tasha?: bool },   // absent = true
  boons:  { [name]: { hd: int 1..20, ap: int 0..1000, fx?: string<=500 } },  // custom or repriced built-in
  draws:  { [name]: { ap: int 0..1000, fx?: string<=500 } }
}
```
- Campaign "disabled" = existing `bannedBoons` / `bannedDrawbacks` (F2).
- Absent key = all calls on, no overrides. Today's live state is therefore unchanged.

**3.2 Per-character override layer (reworked #642).** A new **non-buy** event type, written only via the DM RPC:
```
{ type:'dmHouseRules', overrides:{ dmAllows?:{…partial}, boons?:{…}, draws?:{…}, disabled?:{boons:[],draws:[]}, pins?:{draws:{[name]:{ap, reason, at}}} },
  campaignId:<uuid stamped by server>, label, seq, ts, dmEdit:true, dmId }
```
- **Snapshot semantics:** the last `dmHouseRules` event *for a given campaignId* is the whole override layer for that campaign. This is simple and auditable, and makes "remove an override" just the next snapshot.
- Non-buy means: `repriceDraft` never touches it (removes #642's Q4b draft refusal); the server ledger ignores it; the client undo treats it as a barrier (dmEdit).
- `pins.draws` are the S2 "keep old value" records. In effect they are draws overrides; they are kept as a separate key so the UI can explain them.
- **Campaign-scoped:** it applies only while the character is in the campaign whose id it carries. This fixes #642 follow-up (a).

**3.3 New AP-moving DM events** (all via the RPC, all server-stamped, all `dmEdit:true`, all carrying `campaignId`):
- `{type:'dmRefundBoon', refVal:name, targetSeq:int, cost:-frozenCost}`: T2 boon removal with refund. Removes the target purchase from the fold; cost counts as negative spend.
- `{type:'dmRemoveDrawback', refVal:name, targetSeq:int, grantBack:frozenGrant}`: T2 drawback removal. Removes the target from the fold and from `drawbackEarned`; the server subtracts `grantBack` from earned.
- `{type:'dmRepriceDrawback', refVal:name, targetSeq:int, amount:Δ, from, to}`: S2 ticked holder. Δ = new effective value − old effective value. The engine adds Δ to `drawbackEarned` (display/track-level only; the grant itself moves through the effective rules). The server adds Δ to earned.
- Targeting is **by seq**, like `dmUnlockDrawback`, never FIFO-by-name. Precedent and reason: a character can hold two copies.

## 4. Engine API changes (additive only; `js/engine.js`)

1. **`houseRulesCtx`** object: `{ campaignId, rules: charHouseRules|null, bans:{boons:[],draws:[]} }`, or `null`/absent = solo.
2. **`withHouseRulesCtx(b, ctx)`** (new export) returns `b` with `b._hrCtx = ctx`. It is derived and never saved, like the other `_` keys. **`compute(b, opts)`** reads `opts.houseRulesCtx ?? b._hrCtx`. Fixtures can pass it via the existing `_apOpts` mechanism.
3. **`resolveHouseRules(b, ctx)`** (new export) returns the effective `{dmAllows, boons, draws, disabled, source:{…per key: 'override'|'pin'|'campaign'|'own'|'printed'}}`:
   - **Solo (no ctx):** `b.houseRules` (the player's own fold, including `tasharule`). Override events are ignored.
   - **In a campaign:** base = campaign `charHouseRules`; the player's own patch is ignored (U1). Then the overlay = the last `dmHouseRules` for `ctx.campaignId` (per-key replace for `boons`/`draws`/`dmAllows`; `pins.draws` treated as draws overrides; `disabled` = union(campaign bans, override.disabled)).
   - `_replay` collects `b._dmHouseRulesByCampaign[campaignId] = overrides` (it must handle this non-buy type before its `if (e.type!=='buy') continue`).
4. **Inside `compute()`:** at entry, `const HRx = resolveHouseRules(b, ctx)`. Every current reader of `b.houseRules` (the boon HD-block set, the boons line, the drawback grant loop, the tasha check, and the level-up `strip()` helper near the HD pricer) reads HRx instead. Simplest correct implementation: a shallow copy `b2 = {...b, houseRules: HRx}` at entry, so the many internal readers need no edits.
5. **Tasha warning wording** when the source is the campaign: keep ⛔ for a *new* purchase (`purchaseLegality` only blocks warnings that are new for the candidate). For owned items, change the text to "non-core — barred for new purchases by your campaign (kept: you owned it before)". **[ASSUMPTION; this is a compute output change → DATA.version bump.]**
6. **`priceOf(cur, cat, payload)`**: the drawback pricer uses the effective value from `resolveHouseRules(cur, cur._hrCtx)` instead of `DATA.drawbacks`. Same signature; the context rides on `cur`.
7. **`repriceDraft(events, opts)`**: new optional 2nd parameter `{houseRulesCtx}`. Its internal fold is stamped, so a campaign draft prices boons at campaign prices. Without opts, behaviour is unchanged.
8. **`effectiveBoonTable(b, ctx)` / `effectiveDrawbackTable(b, ctx)`** (new exports): CharGen's local `effBoons()`/`effDraws()` moved into the engine, with ctx-aware merging plus `allowed` / `disabled` / `reason` flags for pickers. CharGen's and Live Sheet's pickers both use them.
9. **`activeEvents()`** gains `boonRefunded`, `drawRemoved`, `drawRepriced` (indices of targets matched by seq) and `refundedBy`. **`_replay`** skips refunded/removed targets (like `boonRemoved`/`boughtOff`). **`_economyFrom`** behaves as follows:
   - a refunded boon's original cost stays in spent and the refund event's negative cost is added. Net = refund. This mirrors the server, which sums both.
   - a removed drawback's target is excluded from `drawbackEarned` (like `boughtOff`).
   - `dmRepriceDrawback.amount` is added to `drawbackEarned`.
   - Counting is **unconditional** on the server; the engine counts only matched targets. Agreement is guaranteed because these events are allowed only on creation-locked characters whose prefix the server then freezes (section 6.3), so a target can't disappear.
   - The "Lost purchases" ledger line is not used for refunds; a new "DM adjustments" display line itemises the events.
10. **`houseRulesImpact(rows, oldCtx, newCtx)`** (new pure export) is used by DM Console's S2/T2 preview. For each roster row `{id, LOG, dmAp, ignorePlayerAp, drawbackCap}` it returns:
    - affected held purchases `{kind, name, seq, frozenCost, oldEffective, newEffective, apDelta, imposed, dmGranted, locked}`;
    - the before/after AP left, both as browser AP left and as a simulated server ledger.
    - This keeps all arithmetic in the engine.
11. **`DATA.version`** is bumped once (Phase 1), because compute semantics change: ctx resolution, the drawback pricer, the new events and the tasha text. Existing fixtures' expected output should not change, since no fixture carries a ctx or the new events. Any change there is a bug signal.
12. **API doc header** in `engine.js` is updated: `compute` opts `{…, houseRulesCtx?}`, the new exports, and the new event types.

## 5. Tool changes

**5.1 `js/campaign.js`:**
- `houseRulesCtxFromRules(rules, campaignId)` returns the ctx (pure, like `drawbackCapFromRules`).
- `latestRulesSnapshot(LOG)` is a shared reader of the `rulesSnapshot` event (today a local function in the Live Sheet and DM Console).

**5.2 Live Sheet:**
- The fold wrapper stamps the ctx. Source: live rules when `_rulesStatus==='active'`; else the LOG snapshot (offline/unavailable); `null` snapshot or no campaign = solo.
- Pickers use the effective tables (custom items, calls, `disabled`/bans, campaign tasha).
- Drawback tile price = effective value.
- `buyoffDrawback` refund = the target purchase's frozen grant (`-src.cost`) when non-zero, else the effective value. **[DECISION NEEDED: frozen vs effective for buy-off; frozen recommended, as it matches the server.]**
- Read-only "House rules (set by your DM)" panel.
- The ledger renders the new events (refund/removal/reprice/override) with `esc()` on every name.
- `toggleTasha` stays refused in a campaign.

**5.3 CharGen:**
- `readBuild()` stamps the ctx. Source: `window._cloudCampaign` when active; else `latestRulesSnapshot(LOG)` (new: CharGen gains offline campaign awareness from the Live Sheet's snapshot); else solo.
- **Keep two variables:** `HOUSE` = the player's own (edited and saved only when solo) and `EFF` = the effective rules for display/pickers in a campaign.
- **Critical:** in a campaign, CharGen must never re-emit the houseRules patch slot from `EFF`. That would rewrite the player's own rules with campaign values, violating "no history rewrite".
- In a campaign, the DM-customisation panel shows the effective rules read-only, marks each row "campaign" / "DM override for you" / "kept at old value", and its refusal points to the DM.
- Pre-lock checklist pricing (`compute(cand)−compute(dom)`) gets the ctx automatically, because `dom` is the stamped fold.
- `_cgRepriceDraft` passes `{houseRulesCtx}`.

**5.4 DM Console:**
- `cloudAnalyze()` / `analyzeAug` stamp the ctx per row (campaignId = selected campaign).
- **Campaign rules panel gets a "Character house rules" section:** four call toggles; a custom/repriced boons & drawbacks table (reusing #642's validated editor widgets); a link to the existing ban lists for "disabled"; and a **"Also remove from characters who own it (refund)" checkbox, default off (T2)**.
- **On save:** compute `houseRulesImpact(roster, oldCtx, newCtx)`, then:
  - **If any held drawback's effective value changes → S2 dialog.** Per holder: name, purchase, old→new, AP left before→after, with a tick (default unticked = keep old value via a pin). Holders still in creation are listed but not tickable ("their draft picks up the change automatically").
  - **If T2 is ticked and the change disables/turns off something owned → T2 dialog.** Per holder: item, refund or grant taken back, AP left after. **Over-budget handling** (see 7.3).
  - Then ONE RPC call (6.2).
- The generic "Save rules" path must not clobber `charHouseRules` (6.1).
- **Per-character editor (reworked #642):** edits the override layer, showing the inherited campaign value beside each override. Repricing a held drawback for one character runs the same S2 logic for that one holder.
- Grant-boon / impose-drawback pickers use the effective tables. The grant-boon cost uses the effective price, so the buy/award pair stays matched.

## 6. Server / migration changes (one migration file + rollback; NOT applied without owner approval)

**6.1 Campaign rules guard:**
- New BEFORE UPDATE trigger on `campaigns`: `NEW.rules->'charHouseRules' := OLD.rules->'charHouseRules'` unless the session GUC `pact.hr_rpc = 'on'` (set by the RPC with `set_config(…, true)`, i.e. transaction-local).
- This makes the RPC the single, validated writer, and the old whole-blob save path can't erase or forge it.
- **[ASSUMPTION: GUC pattern acceptable; the repo has no prior use. The alternative is to compare-and-refuse.]**

**6.2 RPC `dm_apply_house_rules_change(p_campaign uuid, p_char_house_rules jsonb, p_actions jsonb)`** (SECURITY DEFINER):
- Checks `is_campaign_dm` and `assert_campaign_active`.
- Validates the shape (#642's validator moved here: whole-number hd 1–20, ap 0–1000, fx ≤500, ≤32 KB, boolean calls, no unknown keys).
- Writes `rules.charHouseRules` via `jsonb_set`.
- For each action `{character, kind:'pin'|'reprice'|'refundBoon'|'removeDrawback', name, targetSeq, amount?, overrides?}` it locks the character row and verifies:
  - the character is in `p_campaign`;
  - for AP-moving kinds, the character is **currently creation-locked** (#642's D2 test: last `creationLocked` after last `creationUnlocked`);
  - the target exists by seq with the right type/cat/name and is not DM-imposed (for drawbacks) and not DM-granted (for boon refunds, see 7.2).
- **The server stamps the amounts itself where it can:** `dmRefundBoon.cost = −(target.cost)`, `dmRemoveDrawback.grantBack = −(target.cost)`.
- `dmRepriceDrawback.amount` comes from the client (the server has no `DATA` table to compute printed values). It is bounded to an integer |Δ| ≤ 1000. **[ASSUMPTION: trusted to the DM, who can already `award_ap` arbitrarily.]**
- Appends via the same stamping code as `dm_edit_character_log` (seq/ts/dmEdit/dmId plus `campaignId`). All in one transaction, all-or-nothing.

**6.3 `dm_edit_character_log`:**
- Accept `dmHouseRules` (replacing #642's `buy/patch`). Allowed in drafts; it stamps campaignId.
- Accept the three AP-moving types only via the shared validation (or only through the RPC). **[DECISION NEEDED; recommend: RPC only, plus `dmHouseRules` in both.]**

**6.4 `pact_ap_ledger_spend`:**
- `dmRefundBoon` → spent += cost (negative).
- `dmRemoveDrawback` → drawback_earned −= grantBack.
- `dmRepriceDrawback` → drawback_earned += amount.
- **Also split the return into `award_earned` and `drawback_earned`,** and in the budget trigger use `v_spendable = ap + (ignore ? 0 : award_earned) + drawback_earned`. This fixes F4(b) so the live ignore-mode campaign agrees with the engine. It only ever makes the server more lenient. **[DECISION NEEDED: include this fix; recommended, because S2 agreement in the live campaign depends on it.]**

**6.5 Protection and forgery guard:**
- Add the new types to `pact_ap_ledger_protected`'s type list.
- In `pact_enforce_locked_history`, extend `v_idx` with the ord of the last AP-moving DM event. Everything before it freezes, matching the client's undo barrier; these events exist only on locked characters, so `repriceDraft` is unaffected.
- New trigger `pact_enforce_dm_family` (pattern of `pact_enforce_creation_lock`): for a campaign character written by a non-DM, non-admin session, the subsequence of events with `dmEdit=true` in NEW must equal that in OLD (no additions, edits or removals).
- **Caveat:** a DM-granted boon `buy` (dmEdit) inside a draft would be re-costed by `repriceDraft` → refused. **[DECISION NEEDED: (a) `repriceDraft` skips dmEdit buys (small engine change, recommended), or (b) exclude `buy` events from the family comparison.]**

**6.6 Unchanged:** `pact_patch_exempt_keys` (coordinate with `feat/server-freeze-houserules-gold`; F8) and the bind/unbind RPCs.

**6.7 Residual risk (flag):** a player can go solo, forge dmEdit events (no guard while solo), then rejoin. Suggested later mitigation: on a campaign move, require every AP-moving DM event's `dmId` to have been a DM of its stamped `campaignId`.

## 7. End-to-end flows

**7.1 S2 — DM reprices drawback "Hexed" from 3 to 5 in campaign C:**
1. DM edits the campaign table and presses Save. DM Console builds `newCtx` and calls `houseRulesImpact`.
2. Holders are listed per open purchase: e.g. Ana (locked; frozen cost −3; effective 3→5; AP left 4→6) and Bo (draft: info only).
3. The DM ticks Ana and leaves Cy unticked. One RPC call:
   - writes `charHouseRules.draws.Hexed={ap:5}`;
   - Ana: `dmRepriceDrawback{targetSeq, amount:+2, from:3, to:5}`;
   - Cy: a new `dmHouseRules` snapshot = Cy's existing overrides + `pins.draws.Hexed={ap:3}`.
4. **Result:**
   - Ana's browser: effective 5 → grant +2. Server: drawback_earned +2. Both +2.
   - Cy: pin → effective 3 → unchanged. Server unchanged.
   - New purchasers get 5 at purchase (`priceOf` effective).
   - A later re-tick of Cy = remove the pin + a reprice event.
5. A pin also prices a second copy for that character at the old value. **[ASSUMPTION, acceptable edge.]**

**7.2 T2 — DM turns the Boons call off and ticks "remove from owners":**
1. The preview lists every held boon of every locked character.
   - **Player-paid boons get `dmRefundBoon` (refund = frozen cost).**
   - **DM-granted boons** (dmEdit buy + matching award) get the existing no-refund `dmRemoveBoon`, because a refund would double-pay. **[ASSUMPTION]**
2. Draft holders are listed but not touched (they keep the item; the DM can repeat T2 after they finish creation). **[ASSUMPTION; H2-conservative.]**
3. Browser: spent −frozen; boon gone from the fold. Server: spent −frozen. Exact agreement, because both use the frozen cost.

**7.3 T2 with drawbacks (grant taken back) and over-budget handling:**
1. `dmRemoveDrawback` excludes the target from the fold. The browser grant drops by the *effective* value; the server earned drops by the *frozen* grant. They differ only where F4(a)'s cost-0 events exist, and the removal **shrinks** that pre-existing gap. **[Flag.]**
2. Imposed drawbacks/wounds are never removed (they grant 0 and are the DM's own).
3. **Over budget:** removal never increases spend, so the server trigger accepts it. But the Live Sheet's and CharGen's cloud-save gates (`_lsOverApBudget` / `_cgOverApBudget`) refuse **all** cloud saves while AP left < 0. A pushed-negative character would be stranded. Options:
   - **A1 (recommended):** per holder who would go negative, default "Cover the shortfall with DM AP (+N)" ticked. The same RPC calls the `award_ap` logic into `characters.ap`, which counts in browser `opts.dmAp` and server `NEW.ap`, in both modes.
   - **A2:** exclude that holder from removal (untick).
   - **A3:** allow negative, and relax the cloud-save gates to refuse only *increases* in spend while negative (a wider change; not recommended in v1).
   - **[DECISION NEEDED]**
4. The "Bound" call: T2 not offered in v1 (bonds are not boons/drawbacks). The "Non-core (tasha)" call: T2 removes non-core *boons* only; non-core features/arts are not removed. **[ASSUMPTION]**

**7.4 Join / leave (U1):**
- **Leaving:** the character becomes solo. The server has no budget trigger for solo, so there is no disagreement. Own rules return; campaign-scoped overrides/pins stop applying. Refund/reprice events stay in the ledger. The `economy().earned` display may differ from spendable by any reprice Δ. **[Flag; cosmetic.]**
- **Joining:** held drawbacks may change effective value (own → campaign). Today nobody has non-default rules, so the risk is zero. DM Console shows a "rules drift" badge on roster cards where `houseRulesImpact(own→campaign)` is non-empty and offers the S2 tick-list. Until the DM acts, the browser uses the campaign value. **[Flag: transient disagreement possible.]**

**7.5 Offline / local file:**
- Online: the ctx comes from the live campaign rules.
- Offline: from the LOG's latest `rulesSnapshot` (Live Sheet already writes it; CharGen starts reading it; DM Console already reads it).
- `rulesSnapshot:null` = left → solo.
- A local JSON export carries the snapshot, so a campaign character opened from a file still resolves campaign rules. A file with no snapshot = solo (own rules), which is acceptable because the server re-checks on the next cloud save.

## 8. Migration of #642
1. Keep the branch; rebase after Phase 1/3.
2. Replace the `buy/patch houseRules` event with `dmHouseRules` (override snapshot, campaignId stamped).
3. Remove its refusals that the new model replaces:
   - "refuse while draft" goes away (a non-buy event isn't repriced);
   - "refuse held-drawback changes" is replaced by S2 for one holder.
4. Keep its shape validator (moved into the shared SQL function), its esc() tests and its un-migrated-server message.
5. Its follow-up (a) is fixed by campaign scoping; follow-up (b) is mitigated by U1 (F8).
6. Update its decision record with an addendum pointing to the new decision `D-GH-2026-10-13-campaign-house-rules`.
7. Its 42-assertion SQL harness and 42-case e2e are adapted, not discarded.

## 9. Phased rollout (small PRs, each green on its own)
- **Phase 0 (no code; owner-approved read-only live measurement):**
  - count open drawback buys with cost 0 versus −value (F4a);
  - count characters with non-default own houseRules (re-confirm 0 in campaigns);
  - count existing dmEdit events and campaigns with an ignore flag.
  - Decide items marked DECISION NEEDED.
- **PR1 engine:**
  - ctx resolution, effective tables, the `priceOf` drawback pricer, `repriceDraft` opts, the new event types in `activeEvents`/`economy`/`_replay`, and `houseRulesImpact`;
  - DATA.version bump; new parity fixtures (with `_apOpts.houseRulesCtx`);
  - log-fuzz invariant: the browser AP left equals a JS port of `pact_ap_ledger_spend` over logs with the new events (excluding the F4 baseline offset).
  - No tool behaviour change, because no tool passes a ctx yet.
- **PR2 tools read campaign rules (read-only):** campaign.js helpers; ctx stamping in all three fold paths; Live Sheet pickers/prices/buy-off fix (F5); CharGen `EFF` vs `HOUSE` split + snapshot reading; read-only panels. Live effect is nil (no campaign has `charHouseRules`).
- **PR3 server migration + rollback + Docker SQL harness:** 6.1–6.5. **Not applied until the owner approves;** then `get_advisors`, logs, and fold into `sql/rls-policies.sql`.
- **PR4 DM Console campaign editor + S2/T2 dialogs**, feature-detecting an un-migrated server like #642 does.
- **PR5 reworked #642** (per-character overrides on the same RPC/validator).
- **PR6 Players Guide** (master in the separate `pact-guide` project, then the served copy; run `verify-guide.mjs`), plus CHANGELOG/DECISIONS/board.
  - Guide text: "In a campaign your DM sets boon/drawback house rules for the whole table; your own CharGen customisations apply only to solo characters; things you already own keep their price unless your DM applies a change, in which case boons are refunded and drawback grants adjusted."
- Promotion to `main` only after PR3 is applied.

## 10. Blast radius
- **Characters:** 0 repriced on rollout (measured: all-default; the live campaign has no `charHouseRules`).
- **Engine:** compute semantics (ctx, the drawback pricer), so DATA.version bumps once. Expected-results CSV should not move; if it does, investigate.
- **Every tool fold path**, which the context stamping touches.
- **Server:** the ledger function signature (adds columns), 2 triggers modified, 2 new triggers, 1 new RPC, `dm_edit_character_log`.
- **Campaign:** the rules write path (guard trigger).
- **Pre-existing bugs this plan touches:** F4(b) fixed; F5 fixed; F6 closed for campaign characters. F4(a) is NOT fixed (separate task recommended: CharGen should stamp drawback events at −effective value pre-lock, plus a backfill decision).

## 11. Risks
- (1) Context-stamping misses a fold path, so that tool prices with the player's own rules. Mitigation: an e2e per tool asserting the same AP left for one character across all three.
- (2) CharGen re-emits the houseRules slot from campaign values (history rewrite). Mitigation: a dedicated e2e asserting the own patch is byte-identical after a campaign session.
- (3) The DM-family trigger refuses honest saves (e.g. a draft with a DM grant). Mitigation: the 6.5 decision plus a dry-run against all live logs (replay current stored logs as no-op saves in the Docker harness).
- (4) The guard trigger on `campaigns` blocks an unrelated rules save. Mitigation: harness cases.
- (5) The over-budget stranding (7.3).
- (6) Trusting the client-provided reprice Δ.
- (7) Transient join drift (7.4).
- (8) Two DMs editing at once: the RPC row-locks, but the old whole-blob save path is last-writer-wins on other keys (pre-existing).

## 12. Acceptance tests
- **Engine parity / CI:**
  - (a) Solo build with own custom drawback 7: compute uses 7.
  - (b) Same build with a campaign ctx without it: uses the printed value; the own patch is ignored.
  - (c) Plus an override for that campaign: override wins.
  - (d) Override under a different campaignId: ignored.
  - (e) `priceOf` drawback = effective value.
  - (f) Refund/remove/reprice events: economy and a JS port of the SQL ledger agree with the browser AP left (fuzzed).
  - (g) `repriceDraft` with ctx prices campaign boon prices; without ctx it is byte-identical to today.
  - (h) Tasha off in a campaign: owned non-core gets the new soft text; a new non-core purchase is blocked by `purchaseLegality`.
  - All existing parity tests: 0 failed.
- **SQL harness (Docker):**
  - guard trigger keeps `charHouseRules` on a plain rules update;
  - RPC shape refusals; non-DM refused;
  - draft character refused for AP-moving kinds;
  - target by seq (wrong name/type/imposed/DM-granted refused);
  - server-stamped refund/grantBack equal the frozen cost;
  - ledger sums;
  - ignore-mode spendable includes drawback_earned;
  - forged dmEdit event by a player refused; deletion refused; honest player save after DM events accepted;
  - locked prefix extends to the DM event;
  - rollback byte-identical.
- **E2E:**
  - DM sets a campaign custom drawback; a player buys it in the Live Sheet at the custom price, and the server accepts the save;
  - S2 tick/untick: the ticked holder's AP left moves in the Live Sheet AND DM Console AND a server-accepted purchase uses it; the unticked holder is unchanged;
  - T2 boon refund and drawback removal with auto-cover;
  - leave campaign → own rules return and overrides stop;
  - offline campaign character uses the snapshot in both CharGen and the Live Sheet;
  - CharGen own houseRules patch unchanged after a campaign session;
  - all names esc()'d in the DM dialogs.
- **Regression:** the existing suites listed in #642's test section.

## 13. Assumptions and decisions needed (consolidated)

**Decisions needed:**
- Key name `charHouseRules`.
- Buy-off refund basis (frozen vs effective).
- AP-moving events via the RPC only.
- Include the F4(b) ignore-mode server fix.
- The 6.5 draft/DM-grant handling.
- The 7.3 over-budget option (A1 recommended).

**Assumptions:**
- Campaign "disabled" = the existing ban lists; no per-character un-ban in v1.
- The tasha owned-item wording becomes a soft warning in campaigns.
- The client-provided reprice Δ is trusted within bounds.
- The GUC writer pattern.
- DM-granted boons are removed without refund.
- Draft holders are excluded from T2 and from S2 ticks.
- T2 does not cover Bound; covers non-core boons only for Tasha.
- A pin also prices further copies for that character.
- Join drift is handled by a DM Console badge, not automatically.
- The cosmetic `earned` mismatch after leaving is accepted.
- The F4(a) cost-0 drawback baseline is out of scope (separate task).
- No new live measurements were taken for this plan beyond `hr-measure.md`.

### Critical Files for Implementation
- /data/projects/creative/pact/js/engine.js
- /data/projects/creative/pact/js/campaign.js
- /data/projects/creative/pact/sql/rls-policies.sql
- /data/projects/creative/pact/tools/DM-Console.html
- /data/projects/creative/pact/tools/PACT-Live-Char-Sheet.html
- /data/projects/creative/pact/tools/PACT-CharGen-Webtool.html

**Also relevant:**
- Branch `origin/feat/dm-house-rules-editor` (PR #642): `sql/migrations/2026-10-12-dm-house-rules-edit.sql` and `decisions/2026/D-GH-2026-10-12-dm-house-rules-editor.md`
- `/data/projects/creative/pact/testing/scripts/engine-parity-ci.mjs`
- `/data/projects/creative/pact/testing/fixtures/`
- `/data/projects/creative/pact/docs/TASK_BOARD_NEXT.md`: the `feat/server-freeze-houserules-gold` and `feat/dm-house-rules-editor` entries
---
# ADDENDUM 2026-10-13 — FINAL decisions (owner + orchestrator) after cold review. These OVERRIDE the plan body where they differ.

## Owner decisions
- V1 (7.3 over budget): ALLOW a character to go below 0 AP after a DM removal; the tools must keep cloud-saving and refuse only NEW spending (spend increases) while AP left < 0 — relax `_lsOverApBudget` / `_cgOverApBudget` gates to match the server (which only refuses spend increases). No auto-cover, no skipping holders.
- W1 (buy-off basis): buy-off still costs 3× (unchanged rule); the base value is the drawback's CURRENT EFFECTIVE value for this character (resolveHouseRules incl. campaign value, DM override, pins), not the printed DATA table. Fixes free buy-off of custom drawbacks (Live Sheet ~1064 `DATA.drawbacks[v]||0`).
- X1 (F4b): fix the server ignore-mode drop of drawback grants (split award_earned / drawback_earned) TOGETHER WITH a server-side cap: drawback_earned capped at the campaign's DM-set drawback cap (campaigns.rules.drawbackCap.ap when enabled — the same setting DM Console edits and campaign.js drawbackCapFromRules reads), else DATA.drawbackCap (12). Cap is the DM's setting, never hard-coded beyond the fallback.
- Y1 (F4a CharGen cost-0 drawbacks): OUT of scope — separate board task.

## Orchestrator decisions (from verified cold-review findings)
- Key name: `campaigns.rules.charHouseRules`.
- AP-moving DM events (dmRefundBoon, dmRemoveDrawback, dmRepriceDrawback) ONLY via the new RPC; `dmHouseRules` via RPC and dm_edit_character_log.
- M1: the forgery guard must freeze DM-only event TYPES (dmRefundBoon, dmRemoveDrawback, dmRepriceDrawback, dmHouseRules, and existing dmRemoveBoon, dmUnlockDrawback, sessionSeal) as well as dmEdit-flagged events, for non-DM non-admin writers on campaign characters; AND the ledger counts those types only when dmEdit=true.
- 6.5: (a) `repriceDraft` skips dmEdit buys (also fixes today's DM-grant buy/award pair breakage).
- M3: RPC validates each reprice action's `to` == p_char_house_rules.draws[name].ap (or the per-character override value) and `from` == target's −cost + ΣΔ of earlier dmRepriceDrawback on the same targetSeq; record reprice/refund AP visibly (note ap_awards is bypassed — show in DM Console ledger).
- M4: dmRemoveDrawback.grantBack = −target.cost + ΣΔ(earlier reprices on that targetSeq); a player buy-off of a repriced drawback must likewise net out ΣΔ server-side, or document the residual as accepted leniency — prefer closing it.
- M5: houseRulesImpact and the S2 preview model drawbackCap: Δ recorded = the change the browser actually sees (capped); server cap (X1) keeps agreement.
- M6: PR1 is NOT behaviour-neutral for solo characters (priceOf now reads own custom drawback values) — say so, add a fixture.
- M7: offline rulesSnapshot is player-written; server cap is the backstop — note it.
- Concurrency: sync.js optimistic concurrency (.eq updated_at) turns a DM-RPC vs stale player save race into a conflict — note in risks.

## Post-review notes (2026-10-13, after PR #648's review — orchestrator)
- PR1's engine counts client-set `dmEdit` events; they are forgeable until PR3's DM-family guard is applied. Do not promote to
  `main` between PR1 and PR3.
- PR3's RPC must refuse every AP-moving event the engine ignores, because the server counts them unconditionally: unknown
  targetSeq; wrong target type/name; a target already bought off / removed / refunded; an ambiguous (duplicated) seq; a target that
  does not precede the event; a non-finite amount. `houseRulesImpact` flags an ambiguous holder `ambiguousSeq` (pin it).
- M3's `to` check accepts the printed-value fallback when a campaign deletes a custom/repriced entry.
- M4 (decision): a buy-off records the exact purchase it cancels (`targetSeq`), so the server can net out its grant including ΣΔ.

