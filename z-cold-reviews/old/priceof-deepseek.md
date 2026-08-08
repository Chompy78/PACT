```markdown

# Review: priceOf() must charge for the item bought, not the whole-build delta

**Reviewer:** GPT-5 (default)
**Review Mode:** Active refutation (seeking gaps, not rubber-stamping)
**File would be named:** `priceof-whole-build-delta-review-GPT-5.md`

---

## Summary Judgment

**Partial pass, with blocking gaps.** The plan correctly identifies the bug and the correct high-level principle (quotes must be independent from re-pricing of owned items). The classification approach is better than adding a fourth hardcoded escape. However, the plan has **two likely blocking flaws** in its classification logic and verification strategy, plus a **major unaddressed ambiguity** that makes "Done when" not objectively checkable. It also underestimates the risk of misclassifying legitimate context-dependent purchases as contamination.

---

## Findings

### 1. (blocking, high confidence) The two-way split is unsound: there are purchases that are both an "item" and a "context change"

The plan defines:

- **Item purchases** — traits, features, spells, skills, boons, ladder rungs.
- **Context changes** — species, class unlock, level, ability-score raises, etc.

**The problem:** A class unlock in many RPG systems is not just a context change — it *also* grants a set of items (class features, proficiencies, spells) that are themselves priced or priced-included. The plan states that the species pack is emitted as "one context-change event carrying the pack's listed price" and pack-included traits at 0. But for a class unlock, the plan does not specify whether the class features are priced as included items (0) or as separate item purchases. If they are included, the unlock cost must be the listed unlock ladder rung *and* the features must be recorded as 0-cost grants. If they are not included, the unlock cost plus the feature costs must equal the listed unlock price. The plan is silent on this.

**Concrete break:** If a class unlock is priced by lookup, but the UI also shows individual class features as selectable items with their own prices, the plan does not define how these interact. A user could unlock a class and then "buy" its features separately, paying twice for the same content. This is not just an edge case — it's the core of the character builder's logic.

**Suggested improvement:** Define a third category — **"grant purchases"** — where a single purchase changes context and also grants a fixed set of items at zero cost. Then specify which categories (class unlock, species, origin class) are grants, and how the item list is derived. This must be traced to actual `compute()` branches, not assumed.

---

### 2. (blocking, high confidence) The "price independence" test is not sufficient and will produce false failures

The plan's core verification test:

> "For every context-change category: buy it on a bare character and again on a heavily-loaded character ... The quoted price must be identical."

**Why this fails:** For a *legitimate* context-dependent item (e.g., a class feature that costs less if you have the origin class), the quoted price **should** differ between a bare character and a heavily-loaded one. The plan acknowledges this in Risk 3 but does not provide a mechanism to distinguish "good" context-dependence from "bad" contamination. The test as written would flag a correct price difference as a bug.

**Concrete break:** Suppose the engine has a rule: "Multiclass feature cost is reduced by 2 if you have the origin class." This is a correct purchase-time context dependence. The price-independence test would fail on this purchase, even though it's working correctly. The implementer would then have to either (a) special-case this in the test, or (b) incorrectly "fix" the pricing, breaking the legitimate rule.

**Suggested improvement:** The test must be paired with a **classification audit** that maps each buy category to exactly which context fields it reads *and* whether those reads are legitimate at purchase time. The verification should be: "For categories marked as context-change, price is independent of all *other* context fields." This is a much harder test to write and verify, and the plan does not specify how to do it.

---

### 3. (moderate, high confidence) The plan assumes the context-change list is complete, but admits it was not traced end-to-end

The plan states: "The set of 'context-changing' categories below is complete. It was derived by auditing which build fields the pricing branches read, but the mapping from UI buy category to build field was traced by inspection, not exhaustively."

**Risk:** A category like "Epic boon" is explicitly called out as **not traced end-to-end** and is therefore a live unpatched instance. If an epic boon raises an ability score, it is a context change by the plan's own definition. If it does not raise an ability score but grants a feature, it is an item purchase. The plan does not specify how to determine this, and the verification step does not include a test for epic boons.

**Concrete break:** The implementer will apply the classification to the categories they *know* about, miss an epic boon that changes Grit's cap (as the plan itself flags), and the bug persists silently.

**Suggested improvement:** Add a **discovery step** before implementation: for every buyable UI element, trace its effect on `compute()`'s output and categorize it. The verification's corpus replay should also include a **drift diff per purchase category** to catch misclassifications.

---

### 4. (moderate, high confidence) The migration question is load-bearing, not just an "open question"

The plan says "Migration is not decided here" and leaves it as a risk. However, the migration decision **changes the definition of "Done"** for this fix. If existing characters are grandfathered, the fix only needs to change the quoting function and future purchases. If a one-off correction is required, the fix must also include a migration script and a version bump. The plan cannot be considered complete without this decision.

**Concrete break:** The implementer fixes the quoting function, but the product owner later decides that existing characters must be corrected. This would require re-opening the work, and the plan's "Done when" would be invalid. The plan should either (a) make a recommendation on migration based on the stated principle ("prices freeze, never retroactively corrected") or (b) require the owner's answer before implementation begins.

**Suggested improvement:** Add a **blocker prerequisite**: "Migration decision must be documented in the decisions record before implementation starts." If the owner chooses grandfathering, the verification step must include a check that existing character ledgers are unchanged.

---

### 5. (moderate, medium confidence) The "Alternatives considered" section dismisses a better alternative too quickly

The plan rejects "add a fourth hardcoded escape" because "three escapes already exist and did not converge." However, the plan's classification approach is **also a set of special cases** — it's just a more organized set. The difference is that the classification approach has a single lookup point, while the hardcoded escapes are scattered.

**Is the classification over-engineered?** Possibly. If the only live instances are species, class unlock, and Level Up, and the three hardcoded escapes already cover two of them, adding a fourth for species and refactoring the three into a shared lookup function might be a smaller, safer change. The plan's argument that "class-unlock and Level Up would stay wrong" is true, but those could be included in the refactor without a full classification overhaul.

**Suggested improvement:** Consider a **middle ground**: refactor the three existing escapes into a single `priceContextChange(category, payload)` function that uses a lookup table, and extend it to species. This avoids the risk of misclassifying item purchases and is a smaller change. The plan does not explain why this is insufficient, other than "the set of context-changing categories is complete" — but if that set is small, the simpler approach is better.

---

### 6. (minor, high confidence) Verification step "Corpus replay" is underspecified

The plan says: "Replay every available saved character before and after and diff their totals. Require zero drift, or an explicitly enumerated accepted list."

**Issue:** If existing characters were saved with buggy prices, and the fix changes how *future* purchases are priced but does not correct the past, then the totals will **not** drift — because the fix only affects new purchases, not the replay of old logs. The "zero drift" requirement is therefore trivially satisfied and does not validate the fix. If the fix *does* change how old events are interpreted (e.g., by changing `compute()`), then drift is expected and the plan does not specify how to handle it.

**Suggested improvement:** The corpus replay should be split into two tests:

- **Replay without re-quoting:** ensures old ledgers are unchanged (if grandfathering).
- **Re-quote all purchases with the new logic:** ensures the new logic produces the correct price for each purchase in isolation, and the total matches the sum of individual corrected prices. This second test is the one that actually validates the fix.

---

### 7. (minor, medium confidence) "Ladder categories safe under item removal" is dismissed as out of scope

The plan notes that removal is out of scope but does not state whether removal is reachable in the UI. If removal *is* reachable, then a ladder purchase's marginal diff is correct only while buying; but if a user removes a later rung, the earlier rungs keep their price, and the total paid may not equal the sum of the rungs owned. This is a separate bug, but it shares the same root cause — the engine has no purchase-time model.

**Suggested improvement:** Add a note in the decisions record or the plan itself: "We assume removal is not reachable in the UI for ladder items. If it is, this fix does not address that case, and it should be logged as a separate issue."

---

## Overall Assessment

**The plan is directionally correct but incomplete.** It correctly identifies the bug, the correct principle, and a plausible classification strategy. However, it **does not adequately distinguish legitimate context-dependence from contamination**, its verification test is flawed, and it has an unresolved migration dependency that makes "Done when" not objectively checkable. These are not mere "missing details" — they are structural gaps that could cause the fix to either (a) break legitimate pricing rules or (b) silently miss the bug for some categories.

**Recommendation:** Before implementation, the plan should be revised to:

1. Define a clear third category ("grant purchases") and specify how it interacts with item pricing.
2. Replace the "price independence" test with a classification-based verification that accounts for legitimate context dependence.
3. Resolve the migration question and make it a prerequisite.
4. Add a discovery step to trace every buyable UI element to its effect on `compute()`.

If these gaps are addressed, the plan is solid. Without them, it is likely to either over-fix or under-fix, and the implementer will have to re-open the work.

---
