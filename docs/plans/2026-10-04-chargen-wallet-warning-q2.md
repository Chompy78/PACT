# Plan — CharGen shows the gold-and-downtime wallet warning and the coin-for-time trade offer after the lock (Q2)

> **Status: DRAFT for cold review (2026-10-04).** Owner decision **Q2** (reinstated). Written to be read with **no access to the repository**.
> Related: `docs/plans/2026-10-04-chargen-post-lock-purchases.md` §9–10.

## Goal

When a locked character buys something in the character-creation tool (CharGen), the player should see the same **gold and downtime** information the play tool (Live Sheet) gives: what the purchase costs
in gold and days, whether the wallet covers it (a *soft* warning, never a block), and — when it would genuinely help — the rulebook's **coin-for-time trade offer**. The charge frozen onto the purchase must be
whatever the player agreed to (list price or the traded price), exactly as in the Live Sheet. No behaviour change when the campaign economy is off or the character is still in creation.

## Context (all inline)

**The app.** PACT is a static vanilla-JS tabletop-RPG toolkit; Supabase (Postgres + auth + row-level security) is the only backend. A character is an event log (a list of events); `engine.js` is the single source of
truth for rules and exports pure functions. Before a character's creation is "locked" purchases cost AP only. **After the lock, if the campaign's economy is on, each purchase also costs gold and downtime** (rulebook
section "Gold, Downtime and Starting Wealth"). The cost is computed from the purchase's AP by the engine's `purchaseCost(ap, rules)` → `{gp, days, time}`, and is **frozen onto the event** (`gp`, `days`) so a later change of economy band
never re-prices history. Amble (the live campaign) has band "standard", no gold awards at all, and one party-wide downtime window, so every charge is a debt.

**What CharGen does today after the lock (released).** It stamps `gp`/`days` on each in-play purchase (same helper as the Live Sheet) and says nothing about the wallet. **What the Live Sheet does (verified by reading its code):**
1. A **wallet** = the character's own log of gold/downtime *granted and spent* (`wealthLedger(events, {band})`), composed with two server-side inputs via `wealthWithDm(ledger, {dmGold, window})`:
   **`dmGold`** — gold the DM holds for the character, the `characters.gold` column, written only by the server function `award_gold()` (a player's save never writes it); and **the downtime window** — a single party-wide
   declaration for a campaign character (read through the RPC `get_downtime_window(campaign, character)` → `{days, declaredAt}`), or the character's own declared window if solo. Both server inputs are used **only when the campaign
   state is "active"** (`_rulesStatus === 'active'`), because an unconfirmed campaign must not have its gold silently counted as zero.
2. **Quote** on each buy: `_lsQuote(cost)` returns `purchaseCost(cost, rules)` only when the economy is on and the character is past creation (`chargesGoldAndTime`).
3. **Trade offer** `_lsOfferTrade(quote)`: offered **only** when the player is short of exactly one currency while holding enough of the other and the trade would actually close (`tradeCoinTime(quote, mode)` returns the traded
   figures: pay ~3× the gold to halve the downtime, or accept ~3× the downtime to halve the gold). A confirm box shows list vs traded price and says the DM has the final say. `OK` → the traded figures are what get frozen; `Cancel` → the purchase is abandoned.
4. **Shortfall warning** `_lsWalletShort(quote)`: if the (possibly traded) price still exceeds the wallet, a confirm says how short ("short 200 gp", "short 3 weeks") and "Buy anyway? Your DM can waive or defer the cost". It never blocks.
5. Drawbacks are excluded (they give AP). The event carries the frozen `gp`/`days`.

**What CharGen has and lacks (verified).** It already imports `purchaseCost`, `chargesGoldAndTime`, `wealthLedger`, `formatDowntime` and others onto a `window._engineEcon` object. It does **not** have: `wealthWithDm`, `tradeCoinTime`, `resolveDowntimeWindow`;
the DM gold pool (`characters.gold`); the downtime window (it never calls `get_downtime_window`); or an "active campaign" flag named like the Live Sheet's — but it **does** resolve an equivalent: `window._dmApStatus` ('none' | 'unavailable' | 'active') and
`window._cloudCampaign` from the loaded character's campaign (`_cgResolveDmApStatus`), and its sync layer already caches the server's `gold` on the local character record (the Live Sheet reads it as `rec.gold`). CharGen's cloud-refresh helper
`refreshServerAp(id)` reads only the `ap` column.

## Proposed approach

1. **Engine, no logic change:** export `wealthWithDm`, `tradeCoinTime`, `resolveDowntimeWindow` onto CharGen's import list and onto `window._engineEcon` (they are already exported by `engine.js`; the Live Sheet already uses them).
2. **Inputs, same sources as the Live Sheet:** (a) `window._cgDmGold` — read the server's `gold` for the loaded character at the same moments `_dmAp` is resolved (on cloud load, after a campaign bind, on an explicit refresh), via a small helper next to
   `refreshServerAp` that selects `gold` (the owner can read their own row); (b) `window._cgDmWindow` — call `get_downtime_window(campaignId, characterId)` through the existing `js/dm.js` helper when a campaign character is loaded;
   non-fatal on error (keep the previous value, as the Live Sheet does). Reset both when the character changes or unbinds. **Gate both on `_dmApStatus === 'active'`** exactly as the Live Sheet gates on `_rulesStatus`.
3. **Port the three small functions** (`_cgWallet`, `_cgOfferTrade`, `_cgWalletShort`) from the Live Sheet verbatim in behaviour, reading CharGen's own `LOG` and the two inputs above. To prevent the two copies drifting, **move the pure parts into the engine** as
   one function `walletCheck(events, {band, dmGold, window, quote})` → `{short:[…], trade:{mode,traded}|null}` (no UI), used by both tools; each tool keeps only its own prompts (`confirm`) around it. *(Open question for the reviewer: do the move now, or copy first and move later?)*
4. **Wire into `_cgPostLockAppend`** (the single place every post-lock purchase passes through): per step, after pricing and legality: `quote = _cgPostLockQuote(cost)` → if `quote` and the step is not a drawback or a free `wornArmour`: run the trade offer → (cancel ⇒ refuse the whole edit, nothing appended) →
   shortfall confirm → freeze the (possibly traded) figures on the event. The multi-step edit is **priced and prompted as a sequence against a running wallet** (each step spends from what the previous one left), so a 2-step edit cannot double-spend the same wallet. A refusal at any step appends nothing.
5. **No change** to what is stored beyond what the Live Sheet already stores (`gp`, `days`; traded figures are simply different numbers).

## Files involved

`tools/PACT-CharGen-Webtool.html` (imports, `window._engineEcon`, `_cgPostLockAppend`, the sync/campaign-resolve code that sets `_dmAp`); `js/sync.js` (a tiny `refreshServerGold`, or extend `refreshServerAp` to also return `gold`); possibly `js/engine.js` (`walletCheck`, if the reviewer agrees) and
`tools/PACT-Live-Char-Sheet.html` (delegate to it); `testing/scripts/chargen-flows-e2e.mjs`; `CHANGELOG.md`. No server change, no schema change, no `DATA.version` change.

## Out of scope

Any change to the economy rules, band choice, or who may grant gold; the DM Console; recording gold/downtime grants in CharGen; the server freeze.

## Alternatives considered

- **A. Warn from the character's own log only** (no DM gold, no window) — smallest, but wrong for any campaign character whose DM awards gold via the server: it would invent shortfalls. Rejected by the owner's own question ("wrong for DM-held gold").
- **B. Drop Q2** (CharGen only stamps the charge) — the owner first chose this, then reinstated Q2.
- **C. Show only the price chip, never prompt** — informative but loses the trade offer, which the rulebook gives players.
- **D. Duplicate the Live Sheet's three functions and never share** — fastest, but it is exactly the drift the project has been burned by twice (pricing and legality each had to be moved into the engine to fix a divergence).

## Risks

1. **Wrong wallet inputs → false "short" warnings** (highest). Mitigation: same sources and the same `active` gate as the Live Sheet; a test with DM-held gold present proves no false shortfall; a test with the status 'unavailable' proves the server inputs are NOT composed (no false zero).
2. **Network dependence**: fetching `gold`/window can fail offline. Mitigation: non-fatal, keep previous values; offline ⇒ warn from the log only and say the figure is unconfirmed? *(reviewer: what is the right offline behaviour?)*
3. **Double-spending a wallet within a multi-step edit** — handled by the running-wallet design; needs its own test.
4. **Prompt fatigue**: the confirm dialogs fire per step of a multi-step edit. Mitigation: aggregate the shortfall into one confirm for the whole edit; the trade offer only when it would help, as in the Live Sheet.
5. **Drift between two prompt wordings** — the engine function returns data, tools own the text.

## Verification (objectively checkable)

Browser tests, economy on: (1) a locked character with wallet 0 buys a priced purchase → the shortfall confirm appears with the right figures and, on OK, the event carries the list price; on Cancel, nothing is appended; (2) short of gold but rich in downtime → the trade offer appears
and, on OK, the event carries the **traded** gold/days (equal to `tradeCoinTime`'s answer); (3) DM-held gold ≥ the price → **no** warning (the false-shortfall case); (4) `_dmApStatus` ≠ 'active' → server inputs are not composed; (5) a 3-step edit against a wallet that covers only two steps → the shortfall is reported once for the edit and the
wallet is spent step by step; (6) economy off or still in creation → silent, no prompts, no `gp`/`days`; (7) **head-to-head with the Live Sheet**: the same purchases with the same wallet produce identical events (including the traded figures) — Playwright `confirm` is auto-answered per scenario; (8) engine unit gate for `walletCheck` against a frozen copy of the Live Sheet's original logic
over many wallets and quotes (the same method used for `priceOf` and `purchaseLegality`); (9) the existing browser suite still passes.

## Done when

The nine checks pass in CI, the Live Sheet behaves identically (its own tests unchanged), and the plan docs and CHANGELOG are updated.

---

## Reviewer instructions (part of this document)

1. **First line of your reply: state which model you are and any settings.**
2. Judge **logic, clarity, scope and risk**; you cannot run code — do not claim a test passes or fails.
3. Answer: (a) Does this achieve the goal? (b) Which assumptions are shakiest (especially where the server-held gold and window come from, and the `active` gate)? (c) Is there a better alternative to the approach, including whether to move the pure logic into the engine now? (d) What is missing — offline behaviour,
   multi-step edits, flows that could be blocked by mistake? (e) Is the verification objectively checkable? (f) Should this split?
4. Output a Markdown file: `chargen-wallet-review-<model>.md`.

## Review outcome

**Reviewed 2026-10-04 by two API reviewers** (`gemini-3.5-flash`/`gemini-3.6-flash` and `openai/gpt-oss-120b` — both self-identified wrongly; logged by real model id). Archived in `docs/sessions/cold-reviews/2026-10-04-*-chargen-wallet-q2.md`.

**Accepted (resolves the plan's own open questions):**
- **Move the pure logic into the engine NOW** (both reviewers): `walletCheck(...)` first, with a differential gate against a frozen copy of the Live Sheet's original (same method as `priceOf` and `purchaseLegality`), the Live Sheet delegating —
  **a first PR**; the CharGen wiring is a **second PR**. (Approach step 3 becomes "engine first".)
- **Offline / unconfirmed policy:** never silently count server inputs as zero. If the DM gold or window cannot be confirmed (offline, RPC error, status not 'active'), use the cached `rec.gold` and last window if present; otherwise warn **from the
  character's own log only** and say so in a non-blocking note ("wallet checked against your local log; DM gold/downtime unconfirmed"). Never block.
- **Multi-step edits, contradiction resolved:** trade offers are evaluated **per step against a running wallet** (accepting a trade on step 1 changes step 2); the **shortfall confirm is aggregated into ONE confirm for the whole edit**; the edit is
  **all-or-nothing** — a cancel anywhere appends nothing. Verification #5 updated to match.
- **Verification additions:** confirm `_dmApStatus === 'active'` is the same predicate as the Live Sheet's `_rulesStatus === 'active'` for the same character and campaign (a sanity check, not an assumption); a test that RPC/RLS failure
  does not produce a false zero.

**Rejected / deferred:** a shared prompt-string constants file (the engine returns data; each tool owns its wording — drift is in the data, not the text); a concurrent two-tab test (the existing sync conflict handling owns that); replacing native
`confirm()` (parity with the Live Sheet is the goal; out of scope). Verified in code: the owner already reads its own `gold` column (the existing push selects `ap, gold, autosave_enabled`), so no RLS change is assumed.
