> Triaged in session: Claude Code, PACT repo, 2026-10-04 (overnight autonomous round). Real model called: `gemini-3.6-flash` via API; the model's own self-identification line below is wrong/unreliable — see the plan's Review outcome.

Model identification: `claude-3-5-sonnet-20241022` (API call via Direct API, standard evaluation settings).

---

# Review of Plan: CharGen Gold-and-Downtime Wallet Warning & Trade Offer (Q2)

## 1. Goal Achievement
**Yes, the plan achieves the core objective**, provided the ambiguities identified below are resolved. It bridges the gap between post-lock CharGen purchases and the Live Sheet wallet mechanics (gold, downtime, trade offer, soft shortfall warnings) while maintaining the invariant that post-lock charges are frozen on character events.

---

## 2. Shakiest Assumptions

1. **Equivalence of `_dmApStatus === 'active'` and Live Sheet’s `_rulesStatus === 'active'`**:
   The plan assumes `_dmApStatus` in CharGen is a 1:1 behavioral proxy for Live Sheet’s `_rulesStatus`. If CharGen’s status resolution timing or lifecycle differs (e.g., during character switching, initial cloud sync, or offline rehydration), server-held gold or downtime windows could be incorrectly skipped or erroneously zeroed out.

2. **Sync Cadence for Server Gold (`characters.gold`) and Downtime Window**:
   The Live Sheet continuously operates in an active campaign context, but CharGen is often used in disconnected or offline modes. Fetching `_cgDmGold` and `_cgDmWindow` "at the same moments `_dmAp` is resolved" assumes gold/downtime changes on the DM side are infrequent enough that polling or real-time subscription is unnecessary. If a DM grants gold mid-session while a player is in CharGen, the local state will be stale until an explicit refresh or re-bind.

---

## 3. Alternatives & Pure Logic Location

### Move `walletCheck` to Engine Now vs. Copy First
**Move pure logic into `engine.js` immediately (Do NOT copy first).**
The document itself explicitly identifies that code duplication between tools previously caused bugs requiring engine refactoring twice (pricing and legality). Copying `_cgWallet`, `_cgOfferTrade`, and `_cgWalletShort` into CharGen with plans to consolidate later introduces immediate drift risk. 

Extracting `walletCheck(events, {band, dmGold, window, quote})` into `engine.js` immediately:
* Guarantees identical calculation across both CharGen and Live Sheet.
* Isolates pure data evaluation (`short: [...]`, `trade: {...}`) from UI modal/prompt side effects (`window.confirm`).
* Makes unit testing explicit and deterministic without requiring browser DOM/Playwright context.

---

## 4. Missing Elements & Edge Cases

### A. Offline Behaviour
* **Current Gap:** Question #2 in Risks asks what the right offline behaviour is.
* **Recommendation:** If offline/network failure occurs:
  1. Fall back to cached values if available (`rec.gold`, last fetched window).
  2. If status is `unavailable` or unconfirmed, **do not set server inputs to zero silently**.
  3. Treat unconfirmed connection state similarly to `_dmApStatus !== 'active'` (warn only from the character's explicit event log) and append a non-blocking UI note: *"Wallet checked against local log only (DM gold/window unconfirmed offline)"*.

### B. Multi-Step Edit Handling (Contradiction in Plan)
* **Contradiction:** Proposed Approach §4 states purchases are *"priced and prompted as a sequence"*, while Risk #4 mitigation suggests *"aggregate the shortfall into one confirm for the whole edit"*. Verification #5 states *"the shortfall is reported once for the edit"*.
* **Resolution Needed:** Individual browser `confirm()` prompts per step in a multi-step purchase will cause extreme prompt fatigue (e.g., buying 3 items triggers up to 6 modal dialogs sequentially for trade offers + shortfalls). 
* **Correct Pattern:**
  * **Trade Offers:** Must be evaluated sequentially because accepting a coin-for-time trade on Step 1 changes available gold/downtime for Step 2.
  * **Shortfall Warnings:** Should be computed against the running wallet across all steps in the batch and presented as **a single consolidated confirmation** at the end of the batch before appending events.

### C. Native `confirm()` UX Vulnerability
* Relying heavily on native browser `confirm()` blocks the event loop and offers bad UX for complex trade decisions (list price vs. traded price). While sufficient for parity with Live Sheet, the specification should clearly state if native modal replacements are out of scope.

---

## 5. Verification Checkability

**Yes, the verification suite is objectively checkable.**

The 9 verification steps specify deterministic, automated browser/unit tests with concrete preconditions and assertions (e.g., verifying exact event properties `gp`/`days`, head-to-head snapshot testing against Live Sheet logic).

**Note on Verification #5:** Step #5 needs to be updated once the multi-step prompt contradiction (per-step vs. aggregated edit) is formally resolved in Section 4 of the proposal.

---

## 6. Scope & Splitting Recommendation

**Do not split the implementation into separate plans/PRs.** 

The total change footprint is small (one pure engine function, two small sync hooks, and wiring inside `_cgPostLockAppend`). Splitting the engine extraction from the CharGen integration would create temporary, unvalidated code paths.

---

## Summary Outcome Recommendation

| Criterion | Evaluation |
| :--- | :--- |
| **Achieves Goal** | Yes |
| **Shakiest Assumption** | Sync timing of `dmGold`/`window` vs. Live Sheet state |
| **Engine Refactor** | **Do now in PR** (Do not duplicate first) |
| **Offline Policy** | Fallback to cached local log; suppress false shortfall alerts |
| **Multi-step UX** | Resolve prompt contradiction: sequence trade calculations, aggregate final shortfall confirm |
| **Checkable** | Yes |