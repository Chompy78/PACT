> Triaged in session: Claude Code, PACT repo, 2026-10-04 (overnight autonomous round). Real model called: `gpt-oss-120b` via API; the model's own self-identification line below is wrong/unreliable — see the plan's Review outcome.

**Model:** gpt-4 (accessed via direct API, default temperature)  

---

# chargen-wallet-review-gpt-4.md

## 1. Overall assessment

The plan is well‑structured, clearly ties the CharGen UI to the existing Live Sheet logic, and respects the constraint of **no server or schema changes**. It outlines a concrete path to make CharGen display gold/downtime warnings, short‑fall confirmations, and the rule‑book trade‑offer in a way that mirrors the Live Sheet. The document is largely self‑contained; a reviewer without repository access can understand the intended behaviour, the required code locations, and the verification strategy.

### Does the plan achieve the stated goal?

**Yes, in principle.**  
The proposed steps (exporting needed engine functions, sourcing the same DM‑gold and downtime‑window values, and wiring the UI prompts around a shared `walletCheck` routine) directly address every bullet in the Goal:

1. Show the same gold/downtime cost (`quote`) as Live Sheet.  
2. Warn when the player’s wallet (including DM‑held gold and the campaign window) cannot cover the cost (soft warning).  
3. Offer the coin‑for‑time trade when it would reduce the shortfall.  
4. Freeze the exact figures (list price or traded price) onto the purchase event.  

If implemented exactly as described, CharGen will behave indistinguishably from the Live Sheet for post‑lock purchases.

## 2. Shakiest assumptions

| # | Assumption | Why it is shaky | Mitigation / Clarification needed |
|---|------------|-----------------|------------------------------------|
| 1 | **DM gold (`characters.gold`) is always readable by the client** via the proposed helper. | The plan assumes the client can read its own `gold` column without a dedicated RPC. If row‑level security ever changes, the helper could fail silently, leading to false shortfalls. | Verify that the existing `refreshServerAp`‑style read does indeed include `gold`, and add a test that simulates an RLS denial. |
| 2 | **The downtime window RPC (`get_downtime_window`) is available in the JS helper library** (`js/dm.js`). | The document mentions “existing helper” but does not show its signature or error handling. If the helper does not expose the same return shape, the UI could mis‑interpret data. | Provide a small wrapper that normalises the RPC response and document its expected shape (`{days, declaredAt}`). |
| 3 | **The `active` gate (`_dmApStatus === 'active'`) is semantically equivalent to the Live Sheet’s `_rulesStatus === 'active'`.** | If the two flags diverge (e.g., a campaign can be “active” but economy disabled), the wallet composition could be wrong. | Add a note clarifying the exact mapping, or add a sanity check that both flags are in sync for a given character/campaign. |
| 4 | **Ported UI functions (`_cgWallet`, `_cgOfferTrade`, `_cgWalletShort`) will be kept in sync** if initially duplicated. | The plan proposes moving the pure parts to `walletCheck` *or* copying first. The timing of that move determines how much drift can occur. | Recommend implementing the engine‑level `walletCheck` **first**, then immediately replace the duplicated UI functions with thin wrappers. This eliminates drift risk. |
| 5 | **Network failures are “non‑fatal”** and the UI will simply keep the previous values. | In offline mode the player may see stale gold/window numbers without any indication, potentially leading to surprise rejections later. | Define a clear offline UI state (e.g., “Gold data unavailable – using last known value; results may be inaccurate”). |

## 3. Alternative approaches & recommendation on moving pure logic

### Alternatives evaluated by the author
- **A. Log‑only warning** – insufficient for DM‑gold scenarios.
- **B. Drop Q2** – contradicts the owner’s reinstated requirement.
- **C. Show price only** – loses the trade‑offer.
- **D. Duplicate Live Sheet functions** – risk of drift (already experienced twice).

### Suggested refinement
Given the documented history of drift, the **best alternative** is to **introduce the shared `walletCheck` engine function immediately**, before any UI code is copied. The steps would be:

1. Add `walletCheck(events, {band, dmGold, window, quote})` to `engine.js`.  
2. Export it for both CharGen and Live Sheet.  
3. Replace the Live Sheet’s internal wallet logic with a thin call to `walletCheck` (if not already).  
4. In CharGen, implement the UI wrappers (`_cgWallet`, etc.) as one‑line calls to `walletCheck`, then add the confirm dialogs.

This approach eliminates the “move now vs copy later” decision point and guarantees that any future bug‑fixes to wallet logic are automatically shared.

## 4. Missing considerations

| Area | Concern | Suggested addition |
|------|---------|--------------------|
| **Offline behaviour** | The plan says “non‑fatal, keep previous value” but does not describe user feedback. | Define a UI banner (“Offline: gold/downtime data may be stale”) and ensure the confirm dialogs still appear, possibly with a note that the figures are based on cached data. |
| **Multi‑step edit handling** | The description of “running wallet” is high‑level; edge cases (e.g., cancelling the *second* step after the first succeeded) could leave a partially applied edit. | Clarify whether the edit is transactional (all steps succeed or none) or incremental. If incremental, ensure that a cancelled later step does not roll back earlier events, or provide a “undo” path. |
| **Prompt fatigue** | Confirm dialogs fire per step; the plan mentions aggregation but does not detail the algorithm. | Provide pseudo‑code for aggregating shortfall warnings across a batch, while still offering trade offers per step where they are beneficial. |
| **Testing of race conditions** | Simultaneous edits from multiple tabs could lead to wallet desynchronisation. | Mention a test that simulates two concurrent CharGen windows editing the same character, ensuring the server‑side frozen `gp`/`days` remain consistent. |
| **Internationalisation / wording drift** | The plan relies on identical wording between tools; any future localisation could cause mismatch. | Store all prompt strings in a shared constants file, or generate them from the data returned by `walletCheck`. |
| **Error handling for RPC failures** | The plan says “keep previous value” but does not describe what happens if *both* gold and window RPCs fail on first load. | Define a fallback (e.g., treat DM gold as 0 and window as `null`) and surface a visible error to the player. |

## 5. Verification – objectively checkable?

The verification section lists nine concrete, automatable checks, many of which can be expressed as Playwright or Jest tests:

1. Short‑fall confirm appears with correct numbers.  
2. Trade‑offer appears only under the correct condition and results in the traded figures.  
3. No warning when DM‑gold covers the cost.  
4. No server‑input composition when `_dmApStatus` is not `'active'`.  
5. Multi‑step edit respects wallet balance step‑by‑step.  
6. No prompts when economy is off or character still in creation.  
7. Head‑to‑head comparison with Live Sheet events.  
8. Engine unit test for `walletCheck` against a frozen Live Sheet implementation.  
9. Existing browser suite still passes.

All of these are **objectively checkable**: they involve UI visibility, data stored on events, and pure function outputs. The only non‑deterministic element is the confirm dialog automation, but Playwright can pre‑program responses. Therefore, the verification plan is solid.

## 6. Should the plan be split?

Given the scope (adding a few imports, a small RPC wrapper, UI wiring, and optionally moving pure logic to the engine), the plan is **reasonably bounded**. However, the **engine modification** (`walletCheck`) is a cross‑cutting change that touches both CharGen and Live Sheet. If the team follows a strict separation of concerns, it may be worth creating a separate “Engine wallet utilities” sub‑plan, with its own review and testing checklist, before integrating into CharGen. This would:

- Allow the Live Sheet team to review the engine change independently.  
- Provide a clear merge‑point for future tools that need wallet logic.

Thus, a **minor split** (Engine changes vs. CharGen UI integration) is advisable but not strictly required.

---

## 7. Summary of recommendations

1. **Implement `walletCheck` in the engine first**, export it, and replace duplicated logic in both tools with thin wrappers.  
2. **Add explicit offline UI feedback** and clarify fallback values for gold/window when RPCs fail.  
3. **Document the multi‑step edit transaction model** to avoid partially applied edits.  
4. **Add a small constants module** for all confirm dialog strings to avoid future wording drift.  
5. **Create a separate short plan** for the engine change if the repo uses a “core vs. UI” review workflow.  
6. **Confirm the mapping of `_dmApStatus` to the Live Sheet’s active flag** with a small sanity test.  

With these refinements, the plan should reliably deliver the goal while minimizing risk of drift, offline surprises, or UI fatigue.