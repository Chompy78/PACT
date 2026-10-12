# D-GH-2026-10-13-campaign-house-rules — house rules are set campaign-wide by the DM, with per-character DM overrides

Status: **accepted by owner 2026-10-13.** Engine half (PR1, `feat/campaign-house-rules-engine`) lands with this record;
`DATA.version` v0.376 → v0.377. Tools, server migration, DM Console editor, reworked #642 and the Players Guide follow as
PRs 2–6 (board entry `feat/campaign-house-rules`). Full plan, cold-reviewed: `docs/plans/2026-10-13-campaign-house-rules.md`
(its ADDENDUM overrides its body).

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
- Seq-targeting, dmEdit-only counting and "matched only" make a forged or stale event inert in the engine; PR3 makes the same events
  unforgeable server-side (M1).

## Known gaps / open questions (for the owner)

1. **X1 fallback vs the browser.** When a campaign's drawback cap is switched OFF, `compute()` grants drawbacks uncapped (rules
   v0.351, AZ1: the cap is enforced only when a campaign supplies one), but X1's server falls back to capping at `DATA.drawbackCap` (12).
   A campaign character with the cap off and more than 12 AP of drawbacks would see more AP than the server allows — a purchase
   can pass the client gate and be refused on save. The gate `house-rules-ledger-ci.mjs` asserts the direction (server stricter)
   and counts these cases. Before PR3: either the browser caps at 12 in a campaign whose cap is off, or the server is uncapped when
   the DM switched the cap off. Owner call.
2. A player buy-off: the SQL keeps a bought-off drawback's grant (its documented, accepted approximation), so the server is more
   lenient; M4 asks PR3 to net out ΣΔ too, which needs the server to know which purchase a buyoff cancelled. Asserted (server ≥
   browser) in the gate.
3. **M6:** `priceOf('drawback')` now returns a SOLO character's own house-ruled value (was the printed value, 0 for a custom
   drawback). Intended; fixture EV-039.

## Tests

`engine-parity-ci` 115/115 (11 new fixtures CG-071..075, EV-034..039; the runners gained an optional per-fixture `_expect` and
`_apOpts` on event fixtures, both runners in lockstep); new `testing/scripts/house-rules-ledger-ci.mjs` (unit cases + a fuzz over
random campaign histories asserting browser AP left == an independent port of the server ledger), wired into `engine-parity.yml`;
`log-fuzz.mjs` generates the new event types. Every existing fixture's output is unchanged.
