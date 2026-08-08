```markdown
species-pack-not-charged-review-kimi-chat.md
```

---

**Kimi Chat (Moonshot AI) — default reasoning mode, no special settings.**

---

### Findings

---

**1. Step 1 cannot deliver readable ledger lines without emit-order cooperation — it is the ordering fix relocated, or it fails its own readability goal**

- **Severity:** `blocking`
- **Confidence:** `high`

The plan claims that hoisting identity first in the shared fold makes "the prefix at any trait purchase always has the species set, so each pack-included trait's prefix delta is genuinely 0 … *regardless of the order events were emitted in*." This is incorrect.

A prefix delta for an event at log index *i* is `compute(fold(L[0..i])) − compute(fold(L[0..i−1]))`. If a trait is appended at index *i* while identity resides at a later index *j* (*j > i*), then `L[0..i]` contains **no identity event**. The fold has nothing to hoist; the prefix delta prices the trait as a cross-race purchase. Hoisting identity in the *full* fold (for `compute(fold(L))`) does not retroactively inject species into earlier prefixes.

Therefore, to obtain the readable ledger the plan demands (traits at 0, identity at pack cost), the generator **must** emit identity before traits. That is precisely the rejected "narrow ordering fix" — only now it is mandatory for every UI writer, not just one. If the plan instead tolerates traits recorded at cross-race and identity recorded as a refund, it has re-derived the rejected cheaper alternative (see Finding 3) while adding the complexity of fold reordering.

**Suggested improvement:** Be explicit: either (a) mandate emit order in all writers, admitting this is the ordering fix with guardrails, or (b) abandon the readability requirement and adopt the cross-race-then-refund ledger.

---

**2. The telescoping invariant breaks across species changes — the plan only re-prices the pack, not traits**

- **Severity:** `blocking`
- **Confidence:** `high`

If a character owns traits under species A (pack-included, recorded at 0) and later changes to species B, `compute(fold(log))` under the new fold will price those traits according to species B. Their frozen recorded costs (0) will no longer match the computed build unless:

- Trait prices are locked to purchase-time species context permanently (not just a boolean "creation pricing" flag), **or**
- Species-change events emit reconciliation adjustments for every affected trait.

The plan mentions `_raceTraitLocked` but admits it is order-sensitive and its interaction with hoisting is "the shakiest assumption." A boolean ratchet is insufficient: it must record *which* species granted the discount, or the invariant fails when swapping to a species that does not include the trait.

**Suggested improvement:** Define the trait-locking semantics concretely before implementation. If traits are not re-priced on species change, specify how `compute()` knows to use historical species context per trait. If they are re-priced, specify the reconciliation event schema.

---

**3. The rejected "cross-race then refund" alternative is structurally superior to the proposed complexity**

- **Severity:** `moderate`
- **Confidence:** `high`

The plan notes this alternative "is the minimal way to satisfy the stated invariant" and rejects it solely on ledger readability. Given Findings 1 and 2, the proposed plan risks producing the same unreadable ledger (if emit order is not strictly controlled) while introducing fold reordering, pack-event splitting, species-change reconciliation, and ratchet fragility.

Readability is a UI concern; the invariant is an engine concern. If the engine records prefix deltas honestly, the display layer can render a "Heritage Adjustment" line or group cross-race trait costs under a header. The plan should re-evaluate whether readability justifies the architectural surface area, especially when the simpler approach trivially satisfies the stated mathematical goal.

**Suggested improvement:** Prototype the cross-race-then-refund ledger in the display layer before committing to the heavier engine change. If the display can be made acceptable, adopt the simpler engine design.

---

**4. Risk 5 — other ordering hazards — is identified but not investigated**

- **Severity:** `moderate`
- **Confidence:** `medium`

The plan asks: "Is 'identity' the only ordering hazard? Other fields (character level, origin class) also gate prices." If level or class change trait pricing contexts similarly, a single identity hoist is insufficient and a general dependency-order mechanism is needed. Implementing identity hoisting now and discovering a second hoist later would create technical debt.

**Suggested improvement:** Verify in `compute()` whether any fields other than `species` affect trait pricing. If they do, generalize the solution now (e.g., a topological ordering of character-state events in the fold).

---

**5. Double-charging risk is under-specified — will `compute()` still charge from the species field?**

- **Severity:** `moderate`
- **Confidence:** `high`

Step 2 splits pack costs into separate events. If `compute()` continues to charge packs based on `b.species`, then a log containing both a species-set event and a pack-purchase event will be double-charged unless `compute()` is modified to derive pack costs from events. The plan says "possibly `compute()`'s pack-charging branch if packs become event-derived rather than species-derived" but does not commit.

This decision is load-bearing: if `compute()` output changes, the rules version must bump and fixtures update. If `compute()` does not change, the invariant is achieved purely by recording, but the engine must carefully avoid charging the same pack twice.

**Suggested improvement:** Explicitly state whether `compute()` will stop charging packs from `b.species`. If yes, treat as a compute() change with version bump. If no, specify the guard that prevents double-charging when a pack event is present in the log.

---

**6. The empty-build-totals-zero assumption is foundational but has no fallback**

- **Severity:** `moderate`
- **Confidence:** `medium`

The telescoping argument requires `compute(empty) = 0`. The plan lists this as an assumption to attack and asks verification to "confirm it directly," but provides no contingency. If `compute([])` returns a non-zero default (e.g., a base character cost), the invariant `Σ recorded costs == compute(fold(L))` fails by that constant unless every character carries a synthetic "base cost" event.

**Suggested improvement:** State what the plan becomes if the assumption is false. Do not leave the telescoping argument hanging on an unverified premise without a fallback.

---

**7. Migration decision (Risk 3) is genuinely blocking for implementation**

- **Severity:** `minor` (acknowledged, but should be explicit)
- **Confidence:** `high`

The plan correctly flags migration as an open product decision. However, "Done when" says the plan is confirmed/amended before implementation, while also requiring the migration question to have "an owner decision." The two conditions are in tension: engineers cannot implement the fold or pricing helper without knowing whether existing characters are grandfathered or reconciled.

**Suggested improvement:** Add to "Done when": "Implementation is explicitly blocked until Risk 3 is resolved; no coding begins on the fold or pricing helper before the owner decides."

---

**8. The out-of-scope "AP left vs AP Ledger disagree" bug may be load-bearing**

- **Severity:** `minor`
- **Confidence:** `medium`

The plan explicitly queues this behind the current task. However, if that bug is caused by the same engine-level mismatch (frozen log vs. `compute()`), fixing the engine may not resolve user-visible disagreement until the display is also fixed. If it is purely a presentation bug, queuing it is correct; if it shares calculation logic with the pricing helper, it may need to move in-scope.

**Suggested improvement:** Verify whether the AP-left/AP-Ledger bug reads from the same pricing helper or from independent logic before finalizing scope.

---

### What is solid

- The root-cause analysis in "Verified facts" is precise: the 21 AP gap is cleanly explained by form-state pricing vs. log-prefix pricing.
- The distinction between "compute() output changes" (version bump) and "recorded costs change only" (no bump) is a correct reading of the repo rules.
- Risk 2 (double-charging) and Risk 4 (mixed-rules-version characters) are correctly identified and honestly flagged.
- The verification list is mostly objective and checkable, provided the ambiguities in Findings 1, 2, and 6 are resolved.

---

### Bottom line

The plan's core tension is that it wants **both** a readable ledger (traits at 0, pack visible as a purchase) **and** a strict prefix-delta invariant, while claiming to avoid ordering constraints on event emission. These three goals are mutually incompatible unless trait purchase events are never appended before identity is in the log — which is an ordering constraint. The plan should either own the ordering constraint explicitly or relax the readability requirement and adopt the simpler cross-race-then-refund arithmetic. Additionally, the species-change trait-pricing question must be answered before any code is written, or the invariant will break the moment a player swaps heritage.
