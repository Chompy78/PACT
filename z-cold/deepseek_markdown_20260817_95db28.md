# Review: Subclass Class-Unlock Gating Decision

**Reviewer:** Claude Sonnet 3.7 (Analysis mode)  
**Date:** 2026-08-17  
**Model:** Claude 3.7 Sonnet (analytical reasoning, design logic focus)

---

## 1. Does the proposed approach achieve the stated goal?

**Yes, with one qualification.**

The proposed blocking warning achieves the stated goal of enforcing that subclass purchases require class access. It correctly identifies the gap where a character could buy subclass features without any connection to that class, and it blocks that route while leaving a clear path (unlock the class or have it as origin) to access the content legitimately.

The warning mechanism is well-chosen—it matches PACT's existing pattern of informing rather than silently rejecting, allowing the GM to override when appropriate. This maintains the system's flexible ethos while closing a clear loophole.

**The qualification:** The warning alone does not fix the **inverted penalty** problem (where cross-buying is cheaper than unlocking). It only prevents the no-access route. The underlying pricing imbalance remains for characters who actually do unlock a foreign class—they're still penalized for taking the "legitimate" path. This suggests the fix is incomplete, though it does address the most immediately exploitative case.

---

## 2. Which assumptions look shaky, and why?

**The shaky ones:**

1. **"The cross price alone was intended to carry the whole cost of reaching outside your class."**
   - This *cannot* be the intended reading given the data. If cross-price was meant to represent the full cost of reaching outside, then the unlock system is redundant (or actively punitive) for anything but bulk purchases. The unlock ladder exists as a *pricing mechanism for breadth*—it's meant to make dabbling cheap but collecting expensive. Cross-price plus unlock cost should *together* represent reaching outside, not cross-price alone.

2. **"Each class you can build from was written as a precondition."**
   - This holds up. The phrase "each class you can build from" grammatically implies that you first need a class to build from. The fact that the guide separately describes "unlocking more classes" (you can buy features without unlocking at a surcharge) creates a tension, but the subclass text is unambiguous that access is required.

3. **"The system is pre-launch, so no saved characters would be invalidated."**
   - This is an assumption, not a fact. The document doesn't know if any playtest characters have been built using the no-access route. Even pre-launch, invalidating character sheets mid-campaign is disruptive. This should be verified with actual playtest data before implementing any change that invalidates existing characters. If there are saved characters using the no-access route, a grandfathering rule or AP refund mechanism may be needed.

---

## 3. Is there a better alternative than AC1–AC4?

**Yes—AC4 with a refinement.**

The best solution is to **fix the pricing** rather than introducing a prohibition, because prohibition is the least PACT-like tool in the box. But AC4 as stated is under-specified.

A refined AC4 would:

1. **Re-express the cross-class feature cost** as something like:  
   `cross_price = sticker_price + tier` (as it currently is) **PLUS**  
   `+ (unlock_cost / 3)` for the first `n` features from that class.  

   This would make the total cost of taking features from a foreign class converge to the unlock-then-buy path without requiring the player to pre-pay the unlock. It preserves the "pay as you go" ethos while ensuring the ladder isn't gamed.

2. **For bundles specifically:**  
   The un-unlocked surcharge should apply (+1 per purchase) to mimic the spell economy's pattern. A bundle should cost `base_cost + 1` if you haven't unlocked the class.

This approach keeps the system **pricing, not forbidding**, and makes the legitimate unlock path genuinely cheaper for any plausible use case (as the original intent likely was). The fact that the inverted penalty exists at all suggests the pricing was never balanced correctly—fixing it is the more robust solution.

---

## 4. Does gating subclass purchases behind class access fit or fight the spirit of a point-buy system?

**It fits, but only just.**

PACT's spirit is *"pay the price, take the thing"*—pricing rather than forbidding. The system already has gates (Tier requirements, Hit Dice, ability minimums, prerequisites), and those are consistent with point-buy. A prerequisite isn't fundamentally different from a cost—it's just a cost you pay once rather than per item.

However, **class access is a special case** because it's a *knowledge* requirement, not a resource one. A subclass isn't just a technique you can learn from anywhere—it represents a specialisation within a tradition. You can't be a College of Lore bard without being a bard first. This is more like a *narrative gate* than a mechanical one.

The strongest argument for keeping the gate is **consistency**—the text already states it clearly, and players have built expectations around it. Removing it now would contradict explicit guidance and suggest the text was wrong.

The counter-argument: point-buy systems typically let you buy any ability if you pay the cost. Gating abilities behind "you must be this class" is the old model that PACT was meant to escape. A wizard who's studied enough could theoretically master a paladin's oath techniques—it's just very expensive.

**The compromise:** The gate should exist, but the warning should be *advisory*, not a hard block, with the GM empowered to waive it for fictionally appropriate cases. This preserves both the rules-as-written and the flexibility ethos.

---

## 5. Does the guide's "spell access is free of the class tax" principle extend to a subclass's expanded spell list?

**No—a subclass's expanded spell list is a different thing.**

The principle applies to **Foundation → Rank → Slots → Spells Known**, which is the *engine* of casting. Buying a Foundation opens a class's spell list directly. This is deliberate: the system wants any character to be able to learn magic from any class without unlocking the class first.

A subclass's **expanded spell list** is not "spell access"—it's a *bundle of always-prepared spells* that comes with a subclass package. It's a class feature by a different name (it's literally listed alongside subclass abilities in the class tables). The expanded list is:

- Always prepared (doesn't count against your prepared limit)
- Fixed (you can't swap them)
- Tied to the subclass identity

If the principle applied to bundles, you'd be able to buy a Life Domain cleric's expanded list without being a cleric, which would let a wizard snag *Bless*, *Cure Wounds*, *Aura of Vitality*, *Revivify*, etc., as always-prepared spells—far more powerful than just being able to *learn* Cleric spells. This would undermine the entire subclass economy.

**Verdict:** Bundles are a subclass feature and should require class access, following the same rule as any other subclass feature.

---

## 6. What is missing from this document?

1. **Impact assessment on valid multiclass builds.**  
   The document only measures the "exploitative" case. It doesn't show what happens to a legitimate build that *does* unlock a class and then buys subclass features—is that build now too expensive relative to the no-access route? The data suggests the no-access route is cheaper, but the document doesn't provide a side-by-side comparison that demonstrates the problem in practical terms. A worked example would strengthen the case.

2. **How the warning interacts with the "free first subclass" rule.**  
   If you unlock a class and get one free subclass, can you buy that subclass's abilities without paying a 15 AP unlock? The current text suggests yes, but the warning triggers based on class access, not subclass access. This should be explicitly confirmed and illustrated.

3. **Grandfathering consideration.**  
   Even pre-launch, there may be playtest characters that used the no-access route. The document doesn't address whether those characters would be invalidated or how a GM would handle this mid-campaign.

4. **The "Tier 2+ species traits" analogy.**  
   The document notes that Tier 2+ species traits are origin-species-only but doesn't analyse the analogy. This is actually the closest parallel: both are cases where the system forbids rather than prices. The existence of this precedent strengthens the case for gating, and the document should make this argument explicitly.

5. **Why the warning level was chosen.**  
   A "blocking warning" is unusual—it neither accepts nor rejects. The document doesn't explain why a warning rather than a hard block was selected, or how a GM should handle an override. This needs more justification.

---

## 7. Is the verification section objectively checkable?

**Yes, mostly.**

The verification section proposes a clear, objective test: compare the total AP of a character built via the cheap route versus one built via the legitimate route. This is:

- **Measurable:** You can calculate the exact AP totals for any given build.
- **Binary:** Either the legitimate route is cheaper, or it isn't.
- **Specific:** The document even gives a range (4–58 AP difference).

**The only issue:** The verification test assumes the *intended* direction is that unlocking should be cheaper or break-even. This is an interpretation, not an objective fact. If the designer's intent was actually that dabbling should be cheaper than deep investment (and breadth is the penalty), then the current behaviour might be correct. But the existence of the escalating unlock ladder suggests breadth *is* meant to be penalised.

The verification test would be stronger if it stated the *expected result* explicitly: "After the change, a character who unlocks the class should be able to buy the same number of features for equal or lower total AP than one who uses the no-access route."

---

## 8. Should this split into more than one decision?

**Yes—at least two.**

| Decision | Description | Resolution |
|----------|-------------|------------|
| **D1: Gate on abilities** | Should subclass *abilities* require class access? | This is the core question and the data is clear—yes. The guide already says this, the pricing inversion is a bug, and enforcing it is the simplest fix. |
| **D2: Gate on bundles** | Should subclass *expanded spell lists* require class access? | This is separable. The "spell access is free" principle applies to Foundations, not bundles. The bundle is a class feature, and the same reasoning applies as for abilities—yes, it should require class access. |

**But there's also a hidden third decision:**

| Decision | Description | Resolution |
|----------|-------------|------------|
| **D3: Fix the pricing** | Should the cross-price be rebalanced so that unlock-then-buy is always cheaper than no-access? | This is the real structural fix. The current gate only addresses the most obvious abuse. If the pricing remains inverted, characters who *do* unlock the class are still penalised. A pricing fix would make the guide's guidance (unlock then buy) genuinely the optimal path, not just the mandatory one. |

**Recommendation:** Address D1 and D2 immediately (the gate), and add a separate issue for D3 (pricing rebalancing). D3 is larger and may require broader analysis, but it's necessary for the system to be internally consistent.

---

## Summary of Review

| Question | Answer |
|----------|--------|
| **Does the proposed approach achieve the stated goal?** | Yes, but it doesn't fix the underlying pricing imbalance. |
| **Shaky assumptions?** | The assumption that cross-price was intended to carry the full cost of reaching outside a class is contradicted by the data. |
| **Better alternative?** | AC4 (fix pricing) with a refined formula would be more PACT-like. |
| **Does the gate fit point-buy?** | It fits with the system's existing prerequisites, though it's a departure from pure "pay and play." |
| **Bundles vs. spell access?** | Bundles are a different thing—they're class features, not the casting engine. |
| **Missing from the document?** | Impact on valid multiclass builds, grandfathering, explanation of the warning level. |
| **Verification checkable?** | Yes, but needs an explicit expected result. |
| **Split the decision?** | Yes—separate decisions for abilities, bundles, and pricing rebalance. |

---

## Recommendation

**Adopt AC1 (the gate)** with the following modifications:

1. **Keep the blocking warning** but clarify that it's a gate, not a flexible suggestion—it's a prerequisite check, not a recommendation.
2. **Make the warning actionable:** If triggered, show the GM the exact cost of unlocking the class as an alternative path.
3. **Separate D3 (pricing fix)** as a separate issue to be addressed later, with a note in the rules that this is pending.
4. **Document the grandfathering policy:** If the change invalidates existing characters, provide an AP refund or a one-time class-unlock discount.

The gate is the right immediate fix—it enforces what the rules already say. But it's incomplete without addressing the pricing imbalance. The system should be internally consistent, and right now, unlocking a foreign class is strictly worse than not unlocking it in many cases. That's a larger design issue that deserves its own analysis.