Model: OpenAI GPT-4 (May 2025)

# Review of "Cold Review Plan: Convert Rage / Wild Shape / Bardic Inspiration die to Stepped pricing"

## Overall Assessment
The plan is logically coherent and proposes a minimally invasive implementation that leverages existing mechanisms (one‑time purchases and a prerequisite check) rather than rewriting the core pricing engine. It correctly identifies that the generic stepped‑purchase formula is unsuitable because of non‑consecutive tiers and changing price categories. However, several details are omitted, and some “verified” claims are weaker than presented. The plan would likely work if filled in, but it would benefit from being split into independent phases and from providing the missing concrete data.

---

## 1. Does the proposed approach actually achieve the stated goal?
**Yes, in principle.**  
Creating new one‑time‑purchase entries for each step and linking them with prerequisites will force players to buy upgrades to keep pace, while keeping the existing entry as the first step preserves the initial purchase. The prerequisite check is already present (though scoped narrowly) and widening it is a small, additive change. If the new entries are correctly added with the exact AP numbers and the ordering logic works, the goal is achieved.

**Caveat:** The plan does not include the actual AP tables or the step definitions, so an implementer cannot act without external data. Also, it does not specify whether the *first step* (existing entry) should be renamed or re‑described to reflect that it no longer scales for free – that is a required user‑facing change but is only lightly mentioned.

---

## 2. Are any of the "Verified" claims suspicious, self‑contradictory, or doing more work than a genuinely verified fact should?
Yes, a few claims are questionable:

- **“Checked by hand for one step”** – This is presented as evidence that all proposed prices are algebraically reproducible, but extrapolating from a single sample is insufficient. A genuine verification would require checking every step (or at least documenting that the table was algorithmically generated). Without that, this claim should be demoted to an assumption.

- **“No feature outside that one category declares a prerequisite today”** – Searching the dataset for a specific key is plausible, but the plan does not mention *which* key was searched, nor whether the search accounted for nested objects or alternative spellings. If the dataset is large, a manual search could miss cases. This is a strong claim that should be re‑verified at implementation time (the plan itself acknowledges that risk, which is good).

- **“The Extra Attack (2nd)/(3rd) gap is a live, pre‑existing gap surfaced (not caused) by researching this change”** – This is not contradictory, but it is a bit of a distraction. It is used to justify adding prerequisites to those upgrades, yet the plan leaves the decision open. That is fine, but calling it “verified” doesn’t add much to the core change.

- **“Verified (read directly from the current code)”** – The phrasing is sometimes ambiguous (e.g., “the engine’s existing stepped purchase mechanism works like this”) – that is a factual description of the current behavior, not a verification of anything beyond code inspection. That is acceptable, but the distinction between “observed code behavior” and “verified by manual check” is blurred in a few places.

Overall, the “verified” label is applied somewhat liberally, but the plan does include a mitigation (“re‑verify at implementation time”) for the most critical risk.

---

## 3. Is there a better implementation approach than the one proposed, given the constraints stated?
The proposed approach is reasonable and probably the best fit for the stated constraints:
- It avoids touching the central pricing engine’s formula, which is explicitly high‑risk.
- It reuses an existing, already‑shipped prerequisite mechanism (though narrowly scoped) – widening it is low‑risk because of the additive‑only claim.
- It keeps all pricing logic in the dataset, which aligns with the project’s likely architecture.

An alternative would be to extend the stepped‑purchase system with a per‑step override array (tiers, categories, prices). That could keep the number of entries smaller and avoid creating many standalone feature records. However, it would require modifying the core pricing function – a permanent change for a one‑off need. The plan’s rejection of that is justified.

Another alternative would be to *not* use prerequisites at all and instead rely on the player to buy steps in order (like Extra Attack currently does). But that would leave the same gap that the design decision wants to close, so prerequisites are necessary. Therefore, the chosen path is sound.

---

## 4. What's missing from this plan that a competent implementer would need to not go off track?
Several critical details are absent:

- **The finalized AP tables, tier assignments, and track breakdowns** – These are only referenced as external inputs. The plan must either include them inline or provide a specific, versioned reference (e.g., “see design document v2.3, tables 4–6”) so the implementer knows exactly what to code.

- **Step names and descriptions** – For each new entry (e.g., “Rage: 3 uses/long rest”, “Rage: +2 damage”, etc.), the exact display name, internal ID, price, and prerequisite reference must be specified. The plan says “new step entries” but gives no examples.

- **How the first step is treated** – The existing entries remain as the unlock step, but do their descriptions change? Should they be renamed to clarify that they now provide only the base version (e.g., “Rage: 2 uses/long rest”)? The plan does not address this.

- **Code location and exact change for widening the prerequisite check** – The plan says “the project’s single shared pricing/rules module” but doesn’t name the file or function. A competent implementer would need to know where the check currently lives and what condition to change (e.g., from `if (feature.category === 'invocation')` to `if (feature.prerequisite)`).

- **UI implications** – Although the plan states “not a UI change”, adding new purchasable entries will affect the UI that lists available features. The plan should verify that the UI automatically picks up new entries (which it likely does) and that it handles prerequisites gracefully (e.g., disabling out‑of‑order purchases). This is not mentioned.

- **Test fixture details** – “Add new regression‑test fixtures” is vague. What format? What are the exact inputs and expected outputs? The plan should include a sample test case.

- **Guide update specifics** – Which sections of the player‑facing guide need to change? The plan only says “description of all three abilities and any short example‑list mentioning them” – this should be more precise (e.g., “remove Rage from the list of flat‑purchase examples, update the Rage section to list the new upgrade chain”).

- **Version bump procedure** – The plan says “bump this pricing dataset’s own version number exactly once” but does not specify the current version or the new value, nor where the constant is located.

- **Extra Attack decision** – The plan leaves it as a decision point, but the “Done when” criteria list do not include a decision record. It should explicitly state that either the gap is fixed in this change or a follow‑up issue is created.

- **Rollback plan** – Not required, but given the risk of breaking the core engine, a simple rollback strategy (e.g., reverting the prerequisite change) would be prudent.

---

## 5. Is the Verification section objectively checkable by someone other than the plan’s author?
Mostly yes, but with dependencies:

- **“Regression test suite must report zero failures”** – Checkable, provided the test suite exists and is runnable. The plan does not state whether such a suite currently exists, but if it does, this is objective.

- **“Manual check: confirm the widened prerequisite check produces no new warnings on any existing regression fixture”** – This is checkable by running the suite and comparing output; it requires access to the codebase but is objective.

- **“Manual check: the player‑facing guide’s description … is updated”** – This is subjective to the extent that the exact desired text is not specified. However, with a clear list of changes, it could be verified.

- **“Version marker is bumped exactly once”** – Objective.

The verification criteria are reasonable, but they rely on the existence of a regression test suite that includes the new fixtures. The plan does not specify how to verify that the new fixtures cover all edge cases (e.g., buying steps from different tracks independently). That is a gap, but not fatal.

---

## 6. Should this plan be split into more than one independent piece of work?
**Yes, strongly recommended.**  
The plan combines three distinct changes that can be separated:

1. **Prerequisite‑check widening** (and optionally fixing Extra Attack) – This is a core engine change with potential cross‑feature impact. It should be implemented and tested in isolation, with the verification that no existing behavior changes.

2. **Adding the new step entries for Rage, Wild Shape, and Bardic Inspiration** – This is a pure data addition that depends on (1) being in place. It can be reviewed independently and does not affect other features.

3. **Player‑facing guide update** – This is content work that can be done in parallel with (2) but is best handled as a separate commit or pull request to keep the code changes focused.

Splitting would reduce risk, make each change easier to review, and allow the prerequisite widening to be rolled back independently if it causes issues. The plan already acknowledges scope creep (Extra Attack gap), which further supports splitting.

---

## Final Recommendation
The plan is sound in its high‑level strategy but incomplete in execution details. I recommend:

- **Before implementation**, supplement the plan with the missing data (AP tables, step definitions, exact file/function locations).
- **Split the work** into at least two phases: (a) widen prerequisite check and decide on Extra Attack, (b) add new entries and update the guide.
- **Re‑verify all “verified” claims** at implementation time, especially the list of prerequisite‑bearing features and the price reproducibility.
- **Define test cases explicitly** (e.g., “buy step 2 without step 1 → warning”, “buy step 1 → price X”, “buy step 2 after step 1 → price Y”) and include them in the regression suite.
- **Clarify the guide update** with a concrete diff or list of changes.

With these additions, the plan is ready to be executed safely. The core idea of using ordinary one‑time purchases plus a widened prerequisite check is the right trade‑off given the constraints.