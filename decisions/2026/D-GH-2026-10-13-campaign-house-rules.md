# D-GH-2026-10-13-campaign-house-rules — house rules are set campaign-wide by the DM, with per-character DM overrides

Status: **accepted by owner 2026-10-13.** Engine half (PR1, `feat/campaign-house-rules-engine`) lands with this record;
`DATA.version` v0.376 → v0.377. Tools, server migration, DM Console editor, reworked #642 and the Players Guide follow as
PRs 2–6 (board entry `feat/campaign-house-rules`). Full plan, cold-reviewed: `docs/plans/2026-10-13-campaign-house-rules.md`
(its ADDENDUM overrides its body).
**Server migration APPLIED to production 2026-10-20** (with the v1.684 release, owner decision AE1) and folded into
`sql/rls-policies.sql` the same day — see the last addendum, *Applied to production 2026-10-20*.

## Context

House rules (the DM Calls Bound / Boons / Drawbacks / Non-core, custom or repriced boons and drawbacks, and a disabled list)
lived only in each character's own CharGen `houseRules` patch. Since #638 a player can't change them on a confirmed campaign
character, but no DM could either: DM Console's `campaigns.rules.houseRules` is an unrelated free-text label map. PR #642 drafted
a per-character DM editor. Two facts shape everything below:

- **Only drawbacks move "AP left".** AP left = `compute().spendable − economy().spent` (D-GH30). Spend is frozen per purchase, so
  repricing a held boon never changes it; but the drawback grant is derived from the drawback's CURRENT value, so repricing a held
  drawback does. The server ledger (`pact_ap_ledger_spend`) only ever sees the frozen numbers, so a drawback reprice would split
  browser and server unless both sides move by the same delta.
- **The server already under-counts some grants.** CharGen stamps drawbacks at cost 0 (F4a) and ignore-mode campaigns drop
  drawback grants server-side (F4b). A redesign that takes the grant from the frozen cost would zero real characters' grants.

Live measurement (owner-approved, 2026-10-13): 37 characters, 31 with a houseRules patch, every one the all-on default with no
overrides; 5 campaigns, one with characters (10, ignore-mode), and no campaign has character house rules. Nobody is repriced on
rollout.

## Options and owner decisions

| Question | Options | Decision |
|---|---|---|
| Where house rules live | P1 per character only · **P2 campaign-wide (Calls, custom/repriced boons & drawbacks, disabled)** | **P2** |
| #642's per-character editor | drop it · **R1 keep it as overrides on top** | **R1** |
| Precedence | **U1 DM per-character override > campaign > the character's own patch; own applies only when solo, returns on leaving; no history rewrite** | **U1** |
| Turning a Call off | removes owned items · **stops new purchases only (default)** | default |
| Removing owned items | **T2 DM opt-in checkbox (default off): remove from owners with refund — a boon refunded, a drawback's grant taken back; may go over budget** | **T2** |
| Repricing a held drawback | freeze everyone · **S2 DM ticks which holders it applies to; unticked keep their old value; browser and server must agree** | **S2** |
| Over budget after a removal (plan §7.3) | A1 auto-cover with DM AP · A2 skip the holder · **V1 allow below 0; tools keep cloud-saving and refuse only NEW spending while negative (match the server)** | **V1** |
| Buy-off base value | frozen grant · **W1 3× (unchanged rate) of the drawback's CURRENT EFFECTIVE value for this character** | **W1** |
| Server ignore-mode drop of drawback grants (F4b) | leave · **X1 fix it (split award/drawback earned) AND cap drawback_earned at the campaign's DM-set drawback cap, else `DATA.drawbackCap`** | **X1** |
| CharGen cost-0 drawbacks (F4a) | fix here · **Y1 separate task** (`fix/chargen-drawback-cost-zero`) | **Y1** |

Orchestrator decisions (from the verified cold review, same day): key name `campaigns.rules.charHouseRules`; the three AP-moving
DM events only via a new RPC, `dmHouseRules` via the RPC and `dm_edit_character_log`; **M1** the server freezes DM-only event
types as well as dmEdit-flagged events for non-DM writers, and the ledger counts those types only when `dmEdit = true`;
**§6.5(a)** `repriceDraft` skips dmEdit buys; **M3** the RPC checks each reprice's `to` against the rule and `from` against the
target's −cost + ΣΔ; **M4** `dmRemoveDrawback.grantBack` = −cost + ΣΔ; **M5** previews model the drawback cap; **M6** PR1 is not
behaviour-neutral for solo characters (said and fixtured); **M7** the offline rules snapshot is player-written — the server cap
is the backstop; a DM-RPC vs stale player save race surfaces as a sync.js optimistic-concurrency conflict.

## Decision — the engine (this PR)

1. **Context.** `houseRulesCtx = {campaignId, rules: charHouseRules|null, bans:{boons,draws}}` or null (solo). `compute()` reads
   `opts.houseRulesCtx`, else the build's stamp `b._hrCtx` (set by the new `withHouseRulesCtx(b, ctx)` at each tool's single fold
   entry point; derived, never saved). Solo prices byte-for-byte as before (the build's own `houseRules` is used untouched).
2. **`resolveHouseRules(b, ctx)`** implements U1. Campaign "disabled" = the campaign's existing ban lists plus the override's own
   `disabled`. The override layer is the LAST DM-stamped `dmHouseRules` event for the character's current campaign (snapshot
   semantics; an override for another campaign is ignored); its `pins.draws` (S2's "keep old value") win over its `draws`.
3. **Pricing.** `priceOf()`'s drawback pricer and the hd-step strip use the effective rules; new `drawbackValue()` and
   `drawbackBuyoffQuote()` (W1). `repriceDraft(events, {houseRulesCtx})` prices a campaign draft at campaign prices, with the
   final override in force for the whole walk, and never re-costs a dmEdit buy (§6.5(a)).
4. **New events** (`dmHouseRules`, `dmRefundBoon`, `dmRemoveDrawback`, `dmRepriceDrawback`) count only when `dmEdit === true` and,
   for the three AP-moving ones, only when they match a still-open earlier target by `targetSeq` + name (ambiguous seq → nothing).
   A refunded boon / removed drawback leaves the fold; the refund's negative cost is spend (net zero with the original, as the SQL
   sums); a reprice adds ΣΔ to that purchase's ledger grant; a removed drawback's grant (cost + ΣΔ) leaves `drawbackEarned`.
   `compute()` itemises them on a display-only "DM adjustments" line.
5. **Tasha in a campaign:** an OWNED non-core item gets "non-core — barred for new purchases by your campaign (kept: you owned it
   before)" with no ⛔; a NEW one is still refused — `purchaseLegality()` re-labels it with a ⛔.
6. **`houseRulesImpact(rows, oldCtx, newCtx)`** — the DM Console's S2/T2 preview (per held purchase: old/new effective value, AP
   effect with the cap, imposed / DM-granted / locked flags, T2 candidates, and the event the RPC would stamp) and
   **`serverApLedger()`**, a model of the server ledger as PR3 will leave it, used by the preview and the gates.
7. **Effective tables** `effectiveBoonTable` / `effectiveDrawbackTable` (CharGen's `effBoons`/`effDraws`, context-aware, with
   allowed / disabled / reason) for the PR2 pickers.

### Engine-level choices made in this PR (technical, not owner-level)

- **The reprice amount is the raw per-purchase ledger gap, not a capped delta.** M5 reads "Δ recorded = the change the browser
  actually sees (capped)". Recording a capped Δ breaks agreement: cap 12, held A=10 and B=4 (browser 12); B 4→6 records 0 (browser
  still 12); then A 10→2 records −4 (browser 8 − 12), and the server sums 10+4+0−4 = 10 against the browser's 8. Recording the
  raw per-purchase change and capping the SUM on both sides (X1) keeps them equal in every case. So `houseRulesImpact` reports
  `apDelta` (the capped change the browser sees — what the DM is shown, satisfying M5's intent) and `ledgerDelta` (the raw amount
  the event records).
- **`ledgerDelta` = new effective value − the ledger's current grant for that purchase** (−cost + ΣΔ), which is M3's `to − from`.
  For a holder whose ledger already disagrees (a CharGen cost-0 drawback, F4a) a tick therefore lands both sides in agreement.
- The Tasha re-labelling for a new purchase lives in `purchaseLegality()` so the refusal text reads as a refusal.

## Why

- Campaign-wide rules with per-character overrides is the owner's model (P2/R1/U1); the context-stamp keeps the ~120 `compute()`
  call sites untouched, and solo characters are unaffected by construction.
- Moving browser and server by the same delta (S2 events) is the only design compatible with F4: grants stay derived from current
  values in the browser and frozen numbers on the server.
- Seq-targeting, dmEdit-only counting and "matched only" make a STALE or MIS-AIMED DM event inert in the engine (a bad seq, a wrong
  type, a target already bought off / removed / refunded, an ambiguous seq, a non-finite amount). They do **not** make a FORGED one
  inert: `dmEdit` is set by the client, and until PR3 the server neither freezes nor refuses the new event types for a player
  writer. Today a player could write their own `dmEdit:true` `dmRefundBoon` / `dmRepriceDrawback` / `dmHouseRules` and the engine
  would count it (the server ledger does not count them yet, so the browser would merely show AP the server won't honour; but
  `dmHouseRules` reprices in the browser). PR3's DM-family guard (M1) is what makes them unforgeable. **Therefore this engine change
  must not reach `main` before PR3's migration is applied.** (No tool emits or reads a context yet, so preview is unaffected in
  practice.)

## Known gaps / open questions (for the owner)

1. **X1 fallback vs the browser.** *(Resolved 2026-10-13 by owner decision Z1 — see the PR3 addendum below.)* When a campaign's drawback cap is switched OFF, `compute()` grants drawbacks uncapped (rules
   v0.351, AZ1: the cap is enforced only when a campaign supplies one), but X1's server falls back to capping at `DATA.drawbackCap` (12).
   A campaign character with the cap off and more than 12 AP of drawbacks would see more AP than the server allows — a purchase
   can pass the client gate and be refused on save. The gate `house-rules-ledger-ci.mjs` asserts the direction (server stricter)
   and counts these cases. Before PR3: either the browser caps at 12 in a campaign whose cap is off, or the server is uncapped when
   the DM switched the cap off. Owner call.
2. *(Resolved 2026-10-13 in PR3 — see the addendum: a buy-off carrying `targetSeq` is netted exactly.)* A player buy-off: the SQL keeps a bought-off drawback's grant (its documented, accepted approximation), so the server is more
   lenient; M4 asks PR3 to net out ΣΔ too, which needs the server to know which purchase a buyoff cancelled. Asserted (server ≥
   browser) in the gate.
3. **M6:** `priceOf('drawback')` now returns a SOLO character's own house-ruled value (was the printed value, 0 for a custom
   drawback). Intended; fixture EV-039.

### What PR3's RPC must refuse (so the server never counts what the engine ignores)

*(PR3, after the PR #654 review: the server ledger now ALSO counts such an event only when it matches — see the PR3 addendum; the RPC refusals below stay as a second line.)* The server ledger counts a DM-stamped AP event UNCONDITIONALLY; the engine counts it only when it matches. The RPC must therefore
refuse exactly the events the engine ignores, or the two diverge: a `targetSeq` no purchase has; a target of the wrong type or name
(a boon event at a drawback purchase and vice versa); a target already bought off, removed (dmRemoveDrawback / dmRemoveBoon) or
refunded; a target whose seq+name is shared with another purchase (ambiguous — `houseRulesImpact` flags it `ambiguousSeq` and the
console must pin it instead); a non-finite amount; and a target that does not PRECEDE the event. `house-rules-ledger-ci.mjs`
generates every one of these and asserts the engine ignores them. Two more PR3 rules (orchestrator, after the PR #648 review):
- **M3 `to` check:** accept the printed-value fallback — when a campaign DELETES a custom/repriced entry, the new effective value is
  the printed `DATA` value (0 for a custom drawback), not an entry in `charHouseRules`.
- **M4 buy-off netting:** a buy-off must record the exact purchase it cancels (`targetSeq`), so the server can net out that
  purchase's grant including ΣΔ instead of keeping it (today's accepted approximation).

## Tests

`engine-parity-ci` 115/115 (11 new fixtures CG-071..075, EV-034..039; the runners gained an optional per-fixture `_expect` and
`_apOpts` on event fixtures, both runners in lockstep); new `testing/scripts/house-rules-ledger-ci.mjs` (unit cases + a fuzz over
random campaign histories asserting browser AP left == an independent port of the server ledger), wired into `engine-parity.yml`;
`log-fuzz.mjs` generates the new event types. Every existing fixture's output is unchanged.

## Addendum — PR2, the tools (`feat/campaign-house-rules-tools`, 2026-10-13)

Technical choices made while wiring the context into the three tools (none is an owner-level question):

- **Where the pure helpers live.** `houseRulesCtxFromRules()` and `latestRulesSnapshot()` are `js/campaign.js` API (it re-exports
  them) but are defined in a new dependency-free `js/campaign-rules.js`. `campaign.js` imports the Supabase client and loads in each
  tool's CLOUD module, which can fail or arrive after the first render; the context is needed by every fold from the first render and
  fully offline, so the tools import the helpers in their ENGINE bridge. The service worker precaches it and serves it network-first
  (a network-first module imports it), cache `pact-v10`.
- **Context source per tool.** Live Sheet: live rules when `_rulesStatus==='active'`, else the LOG's snapshot (the same source
  `resolveRules()` already uses for bans). CharGen: a campaign context only for a campaign-BOUND character (confirmed or pending) —
  live rules when they are confirmed and belong to its campaign, else its snapshot; an unbound character is solo even if its LOG
  still holds a snapshot (it may have left, and CharGen never writes the "leave" snapshot), and the campaign-rules preview picker never
  applies. DM Console: the selected campaign's live rules for each roster row; a locally imported file uses its own snapshot.
- **Snapshot campaign id.** New `rulesSnapshot` events carry `campaignId`, so a DM override resolves offline (PR5). An existing
  snapshot is not rewritten to add it (dedupe stays on the rules only) — that would append an event to every bound character's LOG.
- **CharGen own vs effective.** In a campaign the own customisation controls are hidden (not just disabled: they show rules that do
  not apply) and a read-only panel lists the effective rules with their source; the HOUSE_RULES patch slot never syncs there; `HOUSE`
  is never written from the effective rules. Covered by an e2e that the own patch is byte-identical after a campaign session.
- **V1 gate.** The client cannot see the server's OLD row, so `_lsOverApBudget()`/`_cgOverApBudget()` compare against the spend of the
  last copy the page knows the server holds (a clean cloud load, or the page's own accepted push). Unknown = treated as an increase
  (the pre-V1 rule), so the gate never lets through what it cannot judge; the server stays the authority. The purchase gates refuse
  only a purchase with a positive cost while below 0 (a free one adds no spend), matching the server.
- **Escaping.** Live Sheet `ib()`/`ibOwned()` now `esc()` the tile label (custom boon/drawback names are DM/player-typed); no caller
  passed markup.
- **After review of #655:** (a) a campaign context is given only to a character KNOWN to be bound (Live Sheet `_lsCampaignId`,
  CharGen `_cgCampaignId`/pending binding, DM Console a file's envelope `campaignId`), in all three tools alike; an unbound one is solo
  even with an old snapshot. A bound one with no usable snapshot (offline / unconfirmed — 8 of 10 live bound characters have none) gets
  `houseRulesCtxFromRules({}, campaignId)`: own rules ignored (U1), CharGen's own editor hidden, rather than solo. (b) V1's server-spend
  base is persisted per character in `localStorage` (`pactCloudSpent:<id>`, shared by both player tools) when learned, so a reload
  keeps it; when it is truly unknown the spend of the local copy the page restored is the base (a push that adds nothing goes through;
  the server still decides). (c) No user-typed value goes inside an `onclick` handler's JS — the browser decodes `&quot;` before
  parsing it — values ride in `data-*` attributes. (d) Share links strip every `_`-prefixed (derived) key.
- **Not fixed here (reviewer's note):** a DM refund (`dmRefundBoon`) returns the boon's AP but not the gold/downtime `wealthLedger()`
  charged for it.
## Addendum 2026-10-13 — PR3, the server half (`feat/campaign-house-rules-server`)

Migration `sql/migrations/2026-10-13-campaign-house-rules-server.sql` + `-rollback.sql`, rehearsed in Docker by
`testing/scripts/creation-lock-guard-test/run-house-rules.sh` (191 cases). **NOT applied** to the live database by merging;
`sql/rls-policies.sql` and the baseline tests are deliberately unchanged until it is (sql/migrations/README.md; precedents
#580 -> #598, #600 -> #608).

### Owner decision Z1 (2026-10-13) — the drawback cap when the DM switched it off

Resolves open question 1 above. **When a campaign's drawback cap is switched OFF (`rules.drawbackCap.enabled === false`) the
server applies NO cap to drawback grants; when it is on, it caps at `rules.drawbackCap.ap`; when the setting is absent it uses
the same default `js/campaign.js` `drawbackCapFromRules()` uses.** That default is *no cap* (an absent key means off; a present
object with `enabled` unset means on), so the X1 fallback to `DATA.drawbackCap` (12) is gone and the browser and the server
now apply one rule. `pact_hr_drawback_cap(rules)` mirrors the JS function including its `Number()` coercion of `ap` (string,
boolean, null, array) and compute()'s `Math.max(0, cap)`; 45 shapes generated from the real JS function are checked against
the SQL in the harness and against the JS in `house-rules-ledger-ci.mjs`. The engine's `serverApLedger()` model and the CI port
follow, so the fuzz's former "cap-off, server stricter" bucket is now strict equality.

### Orchestrator decision M4 — implemented

A buy-off may carry `targetSeq` = the seq of the purchase it cancels. Because js/engine.js's buy-off match is FIFO by name
(the oldest open purchase), "the purchase it cancels" is that FIFO purchase — the engine is unchanged; `activeEvents()` only
gains an additive `buyoffTarget` map (buyoff index -> purchase index) so the model can read it. The server
(`pact_hr_resolve()`, a SQL port of the parts of `activeEvents()` it needs) nets out that purchase's grant — `−cost + ΣΔ` of
the DM reprices aimed at it before the buy-off — **only when the buy-off's `targetSeq` equals the FIFO purchase's seq**. A
buy-off without one (every existing one) keeps the old approximation (the grant stays): more lenient, never a mint, since the
buy-off itself cost 3× the value. **PR2 must make the Live Sheet stamp `targetSeq`** on every buy-off (it already finds the
FIFO purchase in `_openDrawbackEvent()`); nothing else needs to change for M4.

### Technical choices made in PR3 (not owner-level)

- **`campaigns.rules.charHouseRules` guard carries the key over silently** instead of refusing the save, so DM Console's
  existing whole-blob "Save rules" keeps working and simply cannot erase or forge it. Writers: `dm_apply_house_rules_change()`
  (transaction-local GUC `pact.hr_rpc`, set around its one UPDATE and cleared) and admin sessions.
- **RPC action kinds:** `override` (alias `pin`) carries a whole `dmHouseRules` override snapshot; `reprice`, `refundBoon`,
  `removeDrawback` target one purchase by `targetSeq` + `name`. `p_char_house_rules` SQL NULL = unchanged, JSON null = remove.
  At most 500 actions, processed in order against the log as the earlier actions left it, all or nothing.
- **"Creation-locked" for the AP-moving kinds is the explicit-event test** (last `creationLocked` after last
  `creationUnlocked`), as #642 used. The engine's `creationLockState()` also counts a threshold auto-lock; such a character is
  refused by the RPC (the safe direction) — PR4 must show it as not tickable, like a draft.
- **M3 printed-value fallback:** the database has no copy of `js/engine-data.js` (and must not get one), so when no pin,
  override or campaign entry names the drawback, `to` is accepted within 0..1000. Everything else about the event is checked.
- **DM-granted boons are refused for `refundBoon`** (plan §7.2): removing one is `dmRemoveBoon` via `dm_edit_character_log`,
  which is FIFO by name in the engine — PR4 must only offer it when the DM-granted copy is the oldest open one of that name.
- **History protection:** a DM-stamped AP-moving event is a locked-history boundary for a campaign character **even after
  creation is reopened** — re-costing a purchase under a refund would pay the refund twice. To keep honest saves accepted, the
  engine's `sealedFloor()` (which `repriceDraft()` and both tools' undo use) now also floors at such an event.
- **M1 guard compares the WHOLE events** of the DM family (truthy `dmEdit`, or a DM-only type), labels and `ts` included,
  for non-DM non-admin writers on campaign characters. `testing/scripts/dm-family-roundtrip-e2e.mjs` loads characters carrying
  every family type into the real Live Sheet and CharGen and proves an honest save (and a buy-off / a harmless edit) leaves
  the family byte-identical; `roundtrip-audit.mjs` now checks the same on a live export.

### PR #654 security review — changes (2026-10-13)

- **BLOCKING 1 (seq rewrite):** a player could renumber a purchase inside the frozen prefix (the protected projection
  stripped `seq`), so the engine stopped matching a DM refund while the SQL still counted it — refund kept AND boon kept.
  Fixed both ways: (a) `pact_ap_ledger_protected()` keeps `seq` on buy and buyoff events (no client renumbers one — checked in
  both tools by `dm-family-roundtrip-e2e.mjs`, and on live data by `roundtrip-audit.mjs`, which now mirrors the rule); (b) the
  SQL ledger counts a DM AP event only when `pact_hr_resolve()` matches it to its target exactly as `activeEvents()` does
  (`dmMatched`), and the engine's `serverApLedger()` model and the CI port do the same. The CI fuzz no longer leaves
  non-matching or duplicate-seq histories out of the browser-vs-server comparison: they are compared strictly.
- **CharGen dead-end:** 🎲 Randomise and loading a file over the character now refuse, with a message naming the DM, while the
  log holds any DM-family event; unticking a purchase the DM made (a granted boon, an imposed drawback) is refused instead of
  retracting the DM's event. A small CharGen hunk (`_cgIsDmFamily`, `_cgBlockedBySeal`, `retractFlatEvent`).
- **Draft re-price relaxation:** in a creation draft the guard lets a DM-stamped boon buy's cost RISE (never fall, nothing else
  changed). Finding while testing it: a DM boon GRANT is always followed by its matched `award`, which is a locked-history
  boundary TODAY — so `main`'s CharGen re-costing a DM grant in a draft is already refused by the live database (a
  pre-existing stuck-save, fixed by PR1's engine), and this migration adds no new refusal there. **The "apply together with
  the promotion" constraint is withdrawn**: the migration may be applied before the promotion, which PR1's security gate
  requires anyway.
- **RPC:** archived characters are refused (as `dm_bind_npc` treats them); a DM's own NPC is accepted, like
  `dm_edit_character_log` and `award_ap`. Ledger and RPC amounts read as `Number(x) || 0` (`pact_num`), so a malformed cost
  string counts 0 instead of raising and blocking every save of that character.
- **Atomic apply:** neither file carries BEGIN/COMMIT (Supabase `apply_migration` already runs one transaction, and a COMMIT
  inside would end it early); a manual apply must use `psql -1`, which the harness now does.
- **Rollback header corrected:** after a rollback the server ignores the DM events while the browser counts them — STRICTER
  for refunds and positive reprices, but MORE LENIENT for a removal or a negative reprice.
- **Owner decision AB1 (2026-10-13) — see the next section.** *(Was: "Open, owner decision AB (BLOCKING 2)".)* with X1 + Z1 an ignore-player-AP player can append a forged
  `{buy, drawback, cost:-1000}` and spend it (the server has no drawback price table). Pinned as a "KNOWN GAP" case in the
  harness; X1/Z1 behaviour unchanged pending the owner's answer.

### Owner decision AB1 (2026-10-13) — the server gets its own drawback price list

Closes the review's BLOCKING 2: with X1 + Z1 a player in an ignore-player-AP campaign could append `{buy, drawback,
cost:-1000}` and spend it, because the server counted `−cost` and had no idea what any drawback is worth.

- **Price list.** `public.pact_drawback_printed(name)` is GENERATED from `js/engine-data.js` (`DATA.drawbacks`, 109 entries at
  rules v0.377) by `testing/scripts/gen-drawback-prices-sql.mjs` into a marked block of the migration. `--check` runs in
  engine-parity and sql-guards CI and fails with "re-run the generator" on drift. Once applied, a drawback price change ships
  as a NEW migration started from `--stdout` (docs/VERSION-SYNC.md, rules-bump steps).
- **Grant.** Per player drawback purchase the server credits `least(−cost + ΣΔ of its matched DM reprices, effective value)`,
  effective = DM pin > DM override for the character's current campaign > campaign `charHouseRules` > printed > 0 —
  `pact_hr_drawback_effective()`, the same precedence as `resolveHouseRules()` / `drawbackValue()`, including the engine's
  quirk that an `Object.prototype` property name ("toString", "constructor"…) reads as 0. DM-imposed (dmEdit, cost >= 0):
  0. DM-removed and targeted-bought-off: 0. Untargeted-bought-off: kept (the accepted approximation). Still capped by Z1.
- **A held custom drawback the DM deletes from the campaign** falls back to its printed value, or 0 if it has none. That is
  what the engine already does (`_drawVal`: no house-rule entry -> `DATA.drawbacks[name]`, `_fin(undefined)` = 0), so no
  engine change was needed for agreement; the RPC's M3 `to` check now uses the same function (it can verify the printed
  fallback instead of accepting any `to`).
- **Engine changes made for it (no `compute()` change for any valid log, rules stay v0.377):** `serverApLedger()` models the
  per-purchase grant and takes `opts.houseRulesCtx` (`houseRulesImpact()` passes old/new ctx); `activeEvents()`'s name-keyed
  maps are now null-prototype objects — a drawback or boon named "constructor"/"toString" previously CRASHED every fold of
  that character (`_openDraws[v].push is not a function`), found by the new fuzz.
- **Blast radius vs today's server:** a player drawback stored above its printed value (a later rules bump lowered it, or a
  name no longer in the rules) now grants the printed value — the browser already showed exactly that, so this is agreement,
  not a new loss to the player's visible AP; header query Q5 lists them. A CharGen cost-0 drawback (F4a) grants
  min(0, value) = 0, as today. A DM-imposed drawback with a positive cost now counts 0 instead of a negative amount (gain).
  No other legitimate shape loses AP.

### PR #654 round-2 review — changes (2026-10-13)

- **F1 (introduced by AB1/X1, blocking): one grant per drawback name.** 20 copies of "Slow to Mend" minted 100 AP in an
  uncapped ignore-mode campaign. Verified first that no drawback can legitimately be held twice at once: `MUT.drawback` just
  pushes a name; CharGen's drawback picker is a checkbox; the Live Sheet lists an owned drawback as "Active drawback" instead of
  for sale; the guide never lets a drawback stack (its only stacking line forbids Frail + Glass Frame together); an imposed copy
  grants 0 anyway; a bought-off copy has left the fold before a retake. So: of two OPEN player copies of a name only the oldest
  earns — in `compute()`'s grant (the second is listed "held twice — counted once" at 0), `economy()`, `serverApLedger()`, the CI
  port and `pact_ap_ledger_split`. A `compute()` change only for logs holding duplicates (no tool makes one); every parity fixture
  is unchanged; `DATA.version` stays v0.377 (unreleased). A copy closed by an untargeted (legacy) buyoff keeps its old lenient
  grant on the server and does not use up the name.
- **New server refusals** (`pact_enforce_player_grants`, non-DM non-admin writers of campaign characters, NEW events only —
  stored ones are grandfathered): a player drawback buy after the creation lock unless the campaign set
  `rules.postLockDrawbacks` (`postLockAllowance()`, as the Live Sheet's `_lsBarGrant()`); a buyoff without `targetSeq` (R2-5;
  the Live Sheet stamps it since PR2), one that cancels nothing, and one cheaper than rate × the purchase's effective value
  (W1). The DM's buy-off rate IS known server-side — it is on the imposed purchase (`dmRemovalCost`: 'expensive' = 3, else 1) —
  so that check is in. Bindings after the lock (the other half of `_lsBarGrant`) stay client-side; not in this review item.
- **F3:** seq/targetSeq are keyed as the engine keys them (`pact_js_key`: JavaScript `String()` of the number, so 5.0 is "5").
- **F4:** server-stamped seqs come from `pact_next_seq()` (whole-number SEQ, else max seq + 1) in the RPC and
  `dm_edit_character_log`; a garbage SEQ no longer blocks every DM write. (`seal_character_history` / `award_ap_and_seal` keep
  their own cast — not redefined here.)
- **F5:** `houseRulesImpact()` emits no reprice event whose `ledgerDelta` is 0 (the RPC refuses amount 0).
- **Generator:** the no-argument mode rewrites only a file carrying a `-- STATUS: NOT APPLIED` line; the PR that records the
  apply flips it to `-- STATUS: APPLIED <date>`. A later price change uses `--stdout` or `--write <new migration>`.
- **Board:** `fix/server-negative-cost-after-lock` extended with F2 (a negative cost on any other non-drawback buy or a
  `names` event still lowers server spend in every campaign mode — pre-existing, pinned as allowed in the harness; a clamp must
  keep Martially/Magically Bound's legitimate negative costs); the campaignId/adjustments-table follow-up gains R2-6 (a pin
  forged while solo with the target campaign's own id survives joining — pinned as a KNOWN GAP case).

### PR #654 round-3 review — changes (2026-10-13)

- A new buy-off's `targetSeq` must equal the seq of the purchase it actually cancels (the oldest open copy). Before, a
  `targetSeq` naming nothing (999, `true`) or a closed copy passed the price check while the ledger kept the cancelled
  purchase's grant.
- `pact_next_seq()` = greatest(whole-number SEQ, max seq in the LOG + 1): a stale SEQ can't reuse a seq.
- The generator's `--write` without a file prints usage.
- Board (PR4): the tools should be strict when a bound character's campaign rules are unknown (offline, no snapshot); and the
  ledger label of a removal aimed at a second, non-granting copy.

### Constraints for applying it (owner)

1. The read-only blast-radius queries in the migration header (Q1–Q4), and `roundtrip-audit.mjs` on a fresh export (it now
   checks the DM family and buy/buyoff `seq`, which this migration freezes).
2. AB1 is in the migration; Q5 in its header lists who loses drawback AP against today's server (expected: few or none).
3. Apply with `apply_migration` (or `psql -1`), then `get_advisors` (security + performance) and `get_logs`; then, in the
   PR that records the apply, flip the migration's `-- STATUS: NOT APPLIED` line and fold it into `sql/rls-policies.sql` and
   the baseline tests.

### Residual risk (plan §6.7, corrected by the review)

A player cannot leave a campaign (`dm_unbind_character` is the only way out). The real paths into campaign X with DM-stamped AP
events no DM of X wrote: (1) forge them on a solo character (no guard) before its first join; (2) create a campaign Y, bind
their own character to it with `dm_bind_npc`, write the events as Y's DM, `dm_unbind_character` it, then join X with X's invite
code. Follow-up on the board: count AP-moving DM events only when their stamped `campaignId` equals the character's current
`campaign_id` — on BOTH sides (the engine has no campaign in `economy()`, so doing it server-only would split browser and server
for every legitimately moved character; not cheap, so not done here) — or have the RPC record the amounts in a server-side
table that the ledger reads instead of the player-writable log.

## Addendum 2026-10-13 — PR4, the DM Console campaign editor (`feat/campaign-house-rules-dm-editor`)

Technical choices (none owner-level unless listed under "Open"):

- **One review dialog, two sections.** S2 and T2 are one modal (old → new, AP left before → after per holder, recomputed per
  tick) followed by ONE `dm_apply_house_rules_change()` call. "AP left after" is the engine's `compute().spendable −
  economy().spent` over the log PLUS the events the server will stamp (override snapshot with pins, reprices, refunds,
  removals, DM-grant removals), so it is the figure the player's tools will show.
- **Ticks are per (character, drawback name), not per purchase.** A pin changes the effective value of every copy of that
  name for the character, so a name is either pinned or repriced as a whole; the RPC's M3 `to` check would refuse a mix.
- **Who is tickable.** Explicit lock (the RPC's own test, mirrored as a raw-log scan — not a rule; since the automatic
  threshold lock was retired it is also exactly the engine's `creationLockState()`) and every copy uniquely targetable.
  Drafts: listed, nothing sent (plan §5.4). A shared or non-targetable seq: pinned. A tick whose `ledgerDelta` is 0
  (`houseRulesImpact()` emits no event) records nothing — the server already counts the new value.
- **T2.** Applies to what THIS save switches off (`barredNew`: a call turned off, a custom entry deleted). Bans are edited by
  Save rules and keep their "stop new purchases only" behaviour. Order inside the RPC: override → reprices → refunds /
  removals; DM-granted boons go through `dm_edit_character_log` AFTER the RPC (a separate, non-atomic call; a failure is
  reported and the rules stay saved), offered only when every older open copy of that name is being removed too
  (`dmRemoveBoon` is FIFO by name). A second open copy of a drawback is removed with a "0 AP" label (F1).
- **Server detection.** A no-op probe (campaign id only — the RPC changes nothing) when the section is first opened per
  campaign, plus the same check on the save error (`PGRST202` / "could not find the function").
- **`charHouseRules` is never sent by the whole-blob saves** (Save rules, Save notes, the enforce toggle): stripped before
  sending and re-attached to the cached copy, so the roster keeps pricing with it.
- **Effective pickers.** Grant-boon lists the character's effective boon table (campaign customs, override prices; a barred
  item stays grantable but says why) and the grant's buy/award pair uses the effective cost; the impose picker lists the
  effective drawback table with a "Campaign drawbacks" group.
- **Client strictness (round-3 finding 4).** A bound character whose campaign rules are unknown (no live rules of ITS
  campaign, no snapshot of it) is strict: Live Sheet `_lsBarGrant()` refuses boons, drawbacks and buy-offs; CharGen
  `_cgPostLockAppend()` refuses in-play boons / drawbacks (a draft re-prices boons once the rules are known); both
  tools' post-lock gates read `{}` instead of `null` ("solo").
- **Proof against the real server.** `run-dm-house-rules-replay.sh` replays the e2e's captured calls on the PR3 migration
  in Docker: every call accepted; server AP left = engine AP left for every finished holder.

### Owner questions from PR4 — answered 2026-10-13 (both DEFERRED to board tasks)

1. **AC — draft holders of a repriced drawback** (found while building PR4): `repriceDraft()` never re-stamps drawback costs
   and the RPC refuses AP-moving events on drafts, so when a held drawback's value RISES a draft's browser shows the new grant
   while the server credits the old one (replay: Bo 15 vs 13). **Deferred** to the board task `feat/house-rules-draft-reprice`;
   until then PR4 keeps the plan's behaviour (drafts listed, not tickable, nothing sent).
2. **AD1 — T2 for bans:** the owner chose to offer the same opt-in "Also remove from characters who own it (refund)" when the
   DM saves campaign BANS (default off; the same review, V1 below 0 allowed, refunds / removals through the RPC and
   `dmRemoveBoon` for DM-granted oldest copies). **Deferred** to the board task `feat/house-rules-ban-removal`; not built in
   PR4 — a ban still only stops new purchases.

### PR #658 review — changes (2026-10-13)

- **Two DMs at once (A2, deep fix).** `dm_apply_house_rules_change()` gains `p_expected` (`{"charHouseRules": X}`; JSON null =
  none stored) and refuses "another DM changed this campaign's character house rules since you loaded them" when the stored
  rules differ; an `override` action may carry `expected` (the snapshot it was built from) with the same effect for one
  character. Edited in PR3's still-UNAPPLIED migration (signature now `(uuid, jsonb, jsonb, jsonb)`, the 3-argument one
  dropped; rollback drops both); 8 new harness cases (199, before / after / rollback all as predicted). DM Console re-reads
  the campaign (`getCampaign`) at save time, refuses if its rules differ from what the editor loaded, previews against the
  fresh rules and sends them as `expected`; the campaign save's pin overrides carry `expected` too. `null`/absent = no check,
  so the server stays callable by older clients; every console call sends it.
- **Non-targetable purchases.** `houseRulesImpact()` flags a seq that is not a whole JSON number, or a cost present but not a
  number, as `ambiguousSeq` (pinned / left alone) — the RPC would refuse it and fail the whole call. No `compute()` change.
- **0 is a value.** The shared `esc()` blanks 0; the new console code now escapes numbers as `esc(String(n))` (review AP left 0,
  "3 → 0", refund 0, the grant picker's `data-ap`, which made a boon repriced to 0 grant at its printed price).
- **Live Sheet `loadCloudChar`** resolves the campaign with `getCampaign()` (as startup does): `listMyCampaigns()` leaves out
  archived campaigns, which left such a character strict until a reload. (The read-only DM view path still uses the list; it
  buys nothing.)
- The "Also remove" tooltip now says only boons and drawbacks are removed (never Bound bindings). The unreachable
  threshold-lock branch is removed.

## Addendum 2026-10-13 — PR5, per-character overrides (`feat/campaign-house-rules-overrides`, reworks #642)

- **The card editor** ("DM edit — house rules for this character") edits the character's override layer for the selected
  campaign: a call can be left on the campaign's setting or forced on/off for them; boons/drawbacks set for them (each row shows
  the value it replaces — the campaign's, else the printed one); items disabled for them (added to the bans); S2 pins listed
  with "Apply the current value". Every change sends the WHOLE next snapshot as an `override` action of
  `dm_apply_house_rules_change()` (no campaign rules), never `dm_edit_character_log`, so one call can carry the override AND a
  reprice (the RPC checks a reprice's `to` against the override written by the earlier action of the same call).
- **Engine (additive, no `compute()` change):** `houseRulesImpact()` rows take an optional `overrides` — the snapshot about to be
  written for newCtx's campaign — so the console previews an override change with the engine's own arithmetic (same ctx both
  sides). Unit cases in `house-rules-ledger-ci.mjs`.
- **Single-holder S2** reuses PR4's dialog and holder builder: a held drawback whose value changes is ticked (reprice after the
  override) or left unticked (the old value pinned in the same snapshot); a draft takes the new value (PR4 owner question 1
  applies here too); "Apply the current value" left unticked changes nothing and sends nothing.
- **#642's refusals:** draft and held-drawback refusals removed (above); kept: deleting an override-only custom boon the character
  holds (it would orphan the purchase), named out-of-limit entries, no negative AP.
- **Tests:** `dm-house-rules-e2e.mjs` (#642's e2e, adapted — 48), shared fake server `testing/scripts/lib/house-rules-fake-server.mjs`,
  and the replay harness now replays both editors' calls against the real migration (all accepted; finished characters agree).
- **PR #659 review:** the card editor sends the snapshot it was drawn from; the submit re-reads the roster and refuses ("another DM
  changed this character's overrides since this card was drawn") when the fresh snapshot differs, redrawing the roster, and the
  `override` action carries `expected` so the server refuses a race in between. A pin row's "now" is the value applying it
  would give — the character's own override for that drawback when there is one, else the campaign's / printed.



## Addendum 2026-10-13 — merge with `preview` / #649 (DM AP discount)

**Context.** #649 (`feat/dm-ap-discount`) merged to `preview` and its migration `2026-10-13-dm-ap-discount.sql` was APPLIED to
production the same day. It redefined three functions this feature's unapplied migration also redefines
(`dm_edit_character_log`, `pact_ap_ledger_protected`, `pact_enforce_ap_budget_consistency`) and added
`pact_ap_ledger_discount()` plus the authorship trigger. Applying this feature's migration as it stood would have
stripped live discount support (the 2026-09-02 failure class in `sql/migrations/README.md`); the #649 session raised the same warning.

**Decision.**
- The integration branch merges `preview` (a merge, keeping history). The migration's three shared functions are rebuilt on
  #649's applied definitions, keeping every `dmDiscount` part verbatim. The rollback restores the post-#649 definitions,
  i.e. what is live. The SQL harness BASE is `schema.sql` + the current `rls-policies.sql` (which carries #649) + the live
  09-03 and 10-12 files; the rollback is checked byte-identical against that BASE.
- **Discount × refund:** a boon the DM refunds (a matched `dmRefundBoon`) loses its #649 discount, whichever came first. The
  refund already returns the full frozen cost, so keeping the discount would credit the discounted AP twice. Engine
  (`activeEvents().refundDiscount`, `_economyFrom` reading `ae.discounts`), `serverApLedger()` and the SQL
  (`pact_ap_ledger_discount()` skips a refunded target) agree. A discount aimed at an already-refunded boon is refused by the RPC.
- `_economyFrom(evs, boughtOff, ae)` takes the whole `activeEvents()` result; passing a bare discounts Map would silently drop
  every house-rules term.
- Fixture EV-034 (ours) renumbered EV-040.

**Before applying (owner):** re-read the three live functions with `pg_get_functiondef` and confirm they still match
`rls-policies.sql` on `preview`. If they don't, rebuild the migration on the live text first.

**Status:** merged into the integration branch; migration still NOT APPLIED.

## Addendum 2026-10-20 — second merge with `preview`; server migration rebuilt on the live notes definitions

`preview` had moved 39 commits (v1.676 and v1.678 releases) since the 2026-10-13 sync. Three collisions were recorded on the
board in advance, and all three are resolved in this merge:

- **Rules version.** `feat/livesheet-armour-ac` (#670) shipped `v0.377` first, so house rules is now **`v0.378`** at every
  display site. The combined engine needed no change to `testing/expected/` (128/0).
- **Parity fixture ids.** House rules' CG-071..075 became **CG-083..087**. Its EV-035..040 did not collide with anything.
- **The server migration.** `2026-10-15-boon-drawback-notes.sql` was applied to production on 2026-10-19 and redefined
  `dm_edit_character_log`. Applying this file as written would have silently removed the description lock. The function
  was rebuilt by a three-way merge (base: the 2026-10-13 baseline; ours: the live notes text; theirs: this file's
  2026-10-13 text). The only textual conflict was the event-type allow-list, which is now the union of both. Two more
  changes: `pact_dm_family()` counts `dmApproveNote` and `dmUnlockNote` as DM events, and the rollback restores the notes
  definition. `pact_enforce_item_note_lock()` is untouched, because it also freezes the player's own approved `itemNote`,
  which the DM-family guard does not cover.
  - **Why a merge and not a hand edit.** Both definitions are long, and every block of each is load-bearing. A
    mechanical three-way merge whose only conflict is one line can be checked line by line. A hand-written union of two
    250-line functions can't. The diff of the result against each parent is exactly the other parent's additions.
  - **Proof.** `run-house-rules.sh` gives 209/209 after the apply, and its rollback is byte-identical to the new BASE
    (the notes definition). A new step runs the 54 notes cases on top of house rules, and all 54 pass. The rehearsal
    prints the BASE md5 of `dm_edit_character_log`. Compare it with production immediately before applying.

Not done here, by design. #644's applied award migration (`2026-10-12-server-player-award-after-lock.sql`) is still not
folded into `sql/rls-policies.sql`. That fold goes in the post-apply PR together with house rules' own fold, so the
baseline changes once. Owner decision AE1 still stands: the migration is applied in the same step as the release that
ships these tools.

### Second part (same day): #681 landed first, and the Players Guide

`feat/heroic-inspiration-boons` (#681) merged into `preview` while #680 was in review. It also claimed `v0.378` and the
fixture ids CG-083..086, so house rules is now **`v0.379`**, and its fixtures are CG-087..091. `js/engine-data.js` was merged key
by key against the common ancestor. House rules changes no `DATA` key, so the result is #681's data with the version raised.

**A real interaction, fixed.** #681 gives boons an optional `prereq`, read from the effective boon entry. A house-rules
re-price of a printed boon (`houseRules.boons[label] = {hd, ap, fx}`, written by CharGen's customiser and the DM editor) has no
`prereq`, so re-pricing Threefold Inspiration removed its Twofold requirement. The prerequisite is part of what the boon is,
not of its price, so `compute()` now falls back to the printed `prereq` when the house entry has none (`_boonPrereq`). Fixture
CG-092 pins this: without the fallback the re-priced boon is priced and silent; with it, it is blocked with the same warning
as CG-083.

**PR6, the Players Guide.** §17 "Dials you can turn" gains the paragraph "House rules for the whole table". It covers: the DM
sets the rules once for the table, with per-character exceptions; a player's own CharGen customisations apply only while solo;
taking something off the menu stops new purchases unless the DM opts to remove it (boon refunded, drawback AP taken back);
re-pricing a held drawback applies only to the holders the DM ticks; a buy-off costs three times the current value; and a
character can go below 0 AP left, but then can't spend. It is committed to the `pact-guide` master as one paragraph only.
That project's working copy also has unrelated, uncommitted edits from another session dated 2026-10-17, which were left
untouched and uncommitted. It is also in the served copy, and `verify-guide` passes all 11 checks.

## Addendum 2026-10-20 — Applied to production 2026-10-20

**What was applied.** `campaign_house_rules_server` (03:27Z) = `sql/migrations/2026-10-13-campaign-house-rules-server.sql`,
then two follow-ups that only re-created `public.pact_js_number()`: `campaign_house_rules_js_number_trim` (03:31Z) and
`campaign_house_rules_js_number_ascii` (03:37Z). The final trim line spells the four non-ASCII JavaScript whitespace characters
by code point — `btrim(p #>> '{}', E' \t\n\r\f\u000b' || chr(160) || chr(65279) || chr(8232) || chr(8233))` — and the
migration file now carries exactly that line, so production and the file are byte-identical. Released as v1.684 (PR #684,
tagged), rules `v0.379`.

**Verified.** `md5(pg_get_functiondef())` of all 23 functions the migration defines equals a scratch Postgres 17 built from
`schema.sql` + `rls-policies.sql` + `2026-09-03-dm-zero-player-ap.sql` + `2026-10-12-server-player-award-after-lock.sql` + this
file. Before the apply, two production functions (`pact_ap_ledger_spend`, `pact_enforce_locked_history`) differed from that
baseline only in comments; both were replaced by the apply, so this is moot. Advisors: one new item —
`dm_apply_house_rules_change` executable by `authenticated`, which is intended (it is the RPC); the three new trigger functions
are not executable by `authenticated`. No Postgres errors. A rolled-back live spot-check as real users passed 8/8: an honest
save accepted; a buy-off without `targetSeq` refused; a 3 AP buy-off of Hunted refused ("costs 12 AP (3 × its value)"); the
proper 12 AP buy-off accepted; a forged `dmRefundBoon` refused by the DM-family guard; a DM whole-blob Save rules that forged
`charHouseRules` was silently carried over (nothing stored); the DM RPC set campaign rules plus a per-character override; a
player calling the RPC was refused. Afterwards production had 0 campaigns with `charHouseRules` and 0 house-rules events.

**Blast radius (measured before the apply).** All 10 campaign characters are in one campaign (Amble: `ignore_player_ap`,
`drawbackCap` 12, `enforceApBudget`). X1 raised server-side AP left only: Anders +12, Caspian +9, Fenwick / Moss / Skylar +4
each. Nobody lost AP — no stored drawback grant exceeds its printed value.

**Lesson: the transport mangled invisible characters.** The first apply carried the trim set as literal NBSP / BOM / LS / PS
characters. The SQL went through an MCP tool call, whose JSON encoding decodes `\uXXXX` escapes and can turn invisible Unicode
into plain spaces — so the live function trimmed the wrong set, although the file was right. Rule: SQL that will be sent through
an MCP/JSON tool call must spell every non-ASCII character with `chr()` (or another pure-ASCII form), never as a literal; then
the md5 comparison against a scratch build is what proves the transport did not change anything.

**Fold (this PR, `docs/house-rules-fold`).** `sql/rls-policies.sql` now carries the migration verbatim: its helpers and
`pact_ap_ledger_split()` before the AP-ledger section, the six redefined functions replaced in place (marked `[HOUSE RULES]`),
and the DM-family / player-grants / `charHouseRules` guards, `dm_apply_house_rules_change()` and the grants after the notes
section. The same PR folds the two earlier applied-but-unfolded migrations: `dm_zero_player_ap()` (2026-09-03) and
`pact_enforce_player_ap_ceiling()` as 2026-10-12 redefined it, with its trigger, revoke and comment. A database built from
`schema.sql` + the new `rls-policies.sql` has the same function definitions, ACLs and triggers (pg_get_functiondef /
pg_get_triggerdef md5) as one built from the previous baseline plus the three migrations. `testing/sql/rls-baseline-test.sql`
drift-checks 47 functions (was 27) and the four triggers; the rehearsals step back with the rollbacks before their BEFORE run.

