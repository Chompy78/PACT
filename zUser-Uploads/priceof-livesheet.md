<!-- File: priceof-whole-build-delta-review-gpt-5.5-default.md -->

# Model

GPT-5.5 (default settings)

# Review findings

1. **(blocking, high)** The proposed classification assumes every purchase belongs cleanly to either "item purchase" or "context change", but the plan itself already documents at least one counterexample.
   
   - **Gap:** Risk 3 acknowledges that some purchases are legitimately context-dependent (for example, class features priced differently depending on whether the class is the origin). That means "changes context" and "is priced from current context" are orthogonal concepts, not the same axis.
   - **What breaks:** If implementers use "context-sensitive" as the criterion instead of "changes future pricing", they will incorrectly bypass valid dynamic pricing. The plan explains the distinction conceptually but never states the actual invariant the classification should satisfy.
   - **Suggested improvement:** Define the classification in terms of **whether purchasing X changes the pricing context for pre-existing purchases**, not whether X itself has a context-dependent price.

2. **(moderate, high)** The plan relies on the existence of "the purchase's own rules table", but does not establish that every affected category actually has one.
   
   - **Gap:** Species packs, class unlocks and hit-die ladders apparently do. Proficiency bonus, ability-score changes, epic boons and similar categories are asserted to have direct lookups, but the plan never distinguishes verified from assumed availability.
   - **What breaks:** If one category derives its cost algorithmically rather than from a reusable table, the proposed architecture ("never by diff") may require engine work beyond the "ideally untouched" claim.
   - **Suggested improvement:** Add an inventory listing every context-changing purchase and whether its standalone pricing source has been verified.

3. **(moderate, high)** The corpus replay verification does not actually verify the new pricing behaviour.
   
   - **Gap:** Replaying existing saved characters without re-quoting purchases only proves that loading characters remains stable.
   - **What breaks:** A misclassified purchase type could continue producing incorrect quotes while every replay passes.
   - **Suggested improvement:** Include at least one automated purchase-generation test for every classified category, not only replay of historical data.

4. **(moderate, high)** The plan's central verification ("price independence") is necessary but not sufficient.
   
   - **Gap:** Equal prices on bare and loaded characters prove absence of contamination, but they do not prove the quoted price is the correct one.
   - **Example:** An implementation that always returns zero for every species purchase would satisfy independence.
   - **Suggested improvement:** Pair every independence assertion with an assertion against the expected listed price.

5. **(moderate, low)** The "context-change list is complete" risk is larger than the plan suggests because the failure mode is silent.
   
   - **Gap:** The plan proposes a corpus test, but that only exercises known purchase types.
   - **What breaks:** Future contributors can introduce a new pricing-affecting purchase without adding it to the classification.
   - **Suggested improvement:** Make the classification live alongside purchase definitions (or otherwise require explicit categorisation) rather than relying on a manually maintained list.

6. **(minor, high)** The migration section correctly identifies the product decision but omits one technical consequence.
   
   - **Gap:** Mixed ledgers (old pricing basis plus new pricing basis) may become impossible to distinguish later.
   - **Suggested improvement:** Record which pricing algorithm produced an event (or otherwise document why this is intentionally ignored) if future auditing matters.

7. **(minor, high)** The statement that `compute()` should ideally remain untouched is more aspirational than justified.
   
   - **Gap:** Nothing in the review text demonstrates that all required standalone prices are already externally accessible.
   - **Suggested improvement:** Rephrase this as a goal rather than an expectation, since the need for an accessor depends on implementation details the reviewer cannot verify.

8. **(minor, high)** The alternatives section convincingly rejects the contamination-subtraction approach.
   
   - **Assessment:** The argument that pack price and repricing effects are numerically inseparable is logically sound given the stated model.
   - **No change suggested.**

9. **(minor, high)** The rejection of the previous "recorded cost == compute() delta" decision is internally consistent.
   
   - **Assessment:** The plan clearly explains why that previous invariant formalises the observed bug rather than fixing it.
   - **No change suggested.**

10. **(minor, low)** The verification section assumes the regression gate becomes "25 passed / 0 failed", but does not explicitly require that the new test fail before the implementation.
    
    - **Gap:** A regression intended to catch this bug is stronger if demonstrated to fail on the existing behaviour.
    - **Suggested improvement:** State that the new test should reproduce the current defect before the fix, then pass afterwards.

# Overall assessment

The core diagnosis appears substantially stronger than the superseded "ledger should equal `compute()` delta" framing. The plan correctly distinguishes purchase-time pricing from whole-build repricing and consistently follows that principle.

The weakest part is not the diagnosis but the proposed architectural boundary. The binary split between "item purchases" and "context changes" is only safe if it is defined by **whether a purchase mutates future pricing context**, not by whether its own price depends on context. The document hints at this distinction several times but never elevates it to the governing rule. Tightening that definition would remove the largest source of implementation ambiguity.

I do not see a convincing argument, from the information available, that simply adding a fourth escape would be preferable. Given that three existing escapes already represent the same underlying defect, generalising that rule appears proportionate rather than over-engineered.
