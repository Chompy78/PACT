Kimi (Moonshot AI) — default reasoning mode, no codebase access, cold review.

Review posture: actively attempting to refute the plan. Assumptions are treated as unproven and the goal is treated as unmet until the plan demonstrates it cannot be circumvented.

---

## Findings

1. **Hybrid purchases break the binary item/context split.**
   - **Severity:** blocking
   - **Confidence:** high
   - **Gap:** Purchases such as Epic Boons or certain feats simultaneously grant a new item (feature/spell) and alter an ability score (context change). A strict binary classification forces an incorrect categorization: treated as context, the item's marginal cost is lost or bundled opaquely; treated as item, the ability-score reprice contaminates the diff.
   - **Suggested improvement:** Define atomicity rules. Force hybrid purchases to emit two ledger events—one context-change event at the listed price, plus one item event priced by marginal diff against the post-context build—or define a hybrid pricing rule that sums the listed context price with a diff restricted to newly added items only.

2. **The context-change list is claimed complete but was derived by inspection, not exhaustive tracing.**
   - **Severity:** blocking
   - **Confidence:** high
   - **Gap:** The plan admits the mapping from UI buy category to build field was "traced by inspection, not exhaustively." A single missed category (e.g., a hidden auto-grant, a house-rule override purchased through a non-standard path, or a future feature) silently preserves the bug because the diff path remains the default.
   - **Suggested improvement:** Add a defensive guard in `priceOf`: if a mutation touches any build field tagged as contextual in a central schema or metadata table, block diff-based pricing and require an explicit listed-price lookup. Make diff pricing opt-in per field rather than opt-out.

3. **Transaction boundaries between context changes and item purchases are undefined.**
   - **Severity:** moderate
   - **Confidence:** high
   - **Gap:** If a player buys a context change and an item in rapid succession—or if the UI batches them—the "before" snapshot for the item diff may capture a build state that includes a pending context change, or vice versa. This reintroduces contamination even with correct per-purchase classification, because the diff's `before`/`after` snapshots are not isolated from adjacent events.
   - **Suggested improvement:** Explicitly state whether the engine processes purchases sequentially (one atomic event at a time) or in batches. If batched, apply all context changes first, then price items by diff against the final post-context build.

4. **Event log semantics for context overrides (e.g., species A → species B) are unspecified.**
   - **Severity:** moderate
   - **Confidence:** high
   - **Gap:** The ledger is append-only. If a player pays for species A, then later pays to switch to species B, the ledger contains both charges plus both sets of pack-included traits at 0. Without removal events, override semantics, or a "latest context wins" filter, the ledger becomes ambiguous and the "paid total" displayed to the player becomes incorrect.
   - **Suggested improvement:** Specify how context replacements are recorded. Options: (a) emit a negative-cost removal event for the old context, (b) add a "superseded by" field to events, or (c) define that `paid total` is computed by filtering to the latest context-change event per category. State the chosen rule explicitly.

5. **The "price independence" test may false-negative if the loaded build lacks contamination-sensitive items.**
   - **Severity:** moderate
   - **Confidence:** moderate
   - **Gap:** The test requires that a context change quote identically on a bare build and a heavily-loaded build. However, if the loaded build does not own, for example, Vigor/Grit stacks, a Level Up quote may appear independent even though the bug still affects builds that do own them.
   - **Suggested improvement:** Parametrize the test: for each context-change category, the loaded build must explicitly own every item type known to be sensitive to that change (e.g., for Level Up, must own Vigor and Grit; for species, must own traits that species would re-price).

6. **The generator tool's coalescing identity-patch writer is under-specified.**
   - **Severity:** moderate
   - **Confidence:** high
   - **Gap:** The plan states the second writing tool applies the same classification, but it does not describe how the coalescing writer transitions from old species to new species, how it prices that transition, or how it emits the pack as a single priced event. This is a distinct code path with the same bug; "apply the same classification" is hand-wavy without architectural detail.
   - **Suggested improvement:** Include a specific audit step and a reproduction fixture for the generator tool. The "Anders" fixture should be reproduced through the generator path, not only the live-play tool.

7. **Corpus replay's definition of "drift" is ambiguous.**
   - **Severity:** minor
   - **Confidence:** moderate
   - **Gap:** The plan intends no change to `compute()` output, but recorded costs will change. "Diff their totals" could mean ledger totals (which will drift) or `compute().total` (which should not). This makes the gate hard to interpret and may cause false failures.
   - **Suggested improvement:** Split the corpus replay into two explicit assertions: (a) `compute().total` must show zero drift for all saved characters, and (b) ledger-sum drift, if any, must match an explicitly enumerated list of expected changes (or be zero under a grandfather policy).

8. **Migration as a "Done when" criterion creates an unbounded block on implementation completion.**
   - **Severity:** minor
   - **Confidence:** high
   - **Gap:** The plan correctly leaves migration as a product decision, but then requires that decision in "Done when." If the owner is unavailable, the code fix cannot be signed off even if it is correct and tested.
   - **Suggested improvement:** Split the work. "Done when" should cover the code fix, tests, and the reversal of the superseded decision in the decisions record. Migration execution should be a separate, explicitly product-gated follow-up.

9. **The decisions record file is not named in "Files involved."**
   - **Severity:** minor
   - **Confidence:** low
   - **Gap:** The plan says to reverse the superseded decision but does not identify which file contains the decisions record.
   - **Suggested improvement:** Add the decisions record file path to "Files involved."

10. **Ladder removal reachability is questioned but not answered.**
    - **Severity:** minor
    - **Confidence:** low
    - **Gap:** If the UI allows removing a ladder rung (e.g., undoing a skill purchase), the refund should be the highest rung owned, not the marginal cost of the next rung. The plan notes this is out of scope but does not confirm whether removal is reachable.
    - **Suggested improvement:** State explicitly whether ladder removal is reachable in the UI. If it is, either fix the refund logic now or ticket it separately before users exploit it.

---

## What is solid

- The core diagnosis is correct: the bug is in the quoting basis (`priceOf`), not in `compute()`. Rejecting the superseded plan ("recorded cost == `compute()` delta by construction") is the right call.
- The decision not to decompose `compute()` or add a purchase-time model is appropriately scoped for the stated goal.
- The rejection of a fourth hardcoded escape in favor of a systematic rule is justified; three ad-hoc patches have already failed to converge.
- The verification strategy (price independence + named fixture + ladder counter-test) is directionally sound and, if tightened per the findings above, should catch the defect.

## Summary

The plan is logically coherent and correctly identifies the root cause, but it is **not safe to implement as written** because the binary classification is not provably exhaustive and hybrid purchases break its assumed mutual exclusivity. Before implementation, the plan needs: (1) a defensive guard that makes diff pricing opt-in by field, not opt-out by category; (2) atomicity rules for hybrid purchases; and (3) explicit event-log semantics for context overrides. The verification section needs tighter parametrization to avoid false negatives. Split the migration decision from the code-fix "Done when."
