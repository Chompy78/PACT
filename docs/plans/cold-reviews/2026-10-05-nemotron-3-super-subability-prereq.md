> Triaged in session: (no session link available in this environment), 2026-10-05
> Reviewer: OpenRouter `nvidia/nemotron-3-super-120b-a12b:free` (MODEL_REQUESTED). It wrote "Model: unknown" -- no self-ID given. Input: the short brief (plan + engine diff + the three data fragments).
> Triage: agreed with the design; its one useful point (a prerequisite that is itself blocked, and a multi-entry prerequisite list, were untested) is now covered by the node gate.

# subability-prereq-review-unknown.md

**Model:** unknown (API call). **Settings:** not provided to me.

## Verdict
The proposed changes achieve the goal: Circle Forms now requires base Wild Shape in both the `subAbilities` and `features` doors, incurs no cost and generates a blocked warning when the prerequisite is missing, while characters that already own both abilities see no change in total AP or warnings. This is supported by the verification suite (parity fixtures, legality sweeps, price‑of tests, node and browser gates) which showed no regression when the prerequisite is active and the expected failures when it is removed. **[HIGH, certain]**

## Shaky assumption
The analysis assumes that no existing live character possesses Circle Forms without base Wild Shape, citing a single measured character that owns both. If any character existed with Circle Forms but lacking Wild Shape, the change would block that ability (which is the intended effect), but the assumption that such characters do not exist is not verified across the whole player base. Should such a case exist, the impact would be intentional blocking rather than a regression, yet the claim of “no live character lacking the prerequisite” remains unverified. **[MEDIUM, likely]**

## Simpler or safer alternative
A simpler approach would be to introduce a single shared prerequisite‑checking helper (e.g., `_checkPrereq(a, _ownedFeatSet, _blockedFeat)`) and invoke it from both the feature loop and the subclass loop, leaving the duplicate‑guard logic unchanged because it already consults `_blockedFeat`. This would reduce duplicated code and make future prerequisite additions less error‑prone, while preserving the exact same behavior. The current solution already moves toward this by using `_subWhy`, but extracting the prereq filter into a separately named function would be marginally clearer and equally safe. **[LOW, guess]**

## Missing or wrong in the diff
The diff appears consistent: the new `_subWhy` function correctly mirrors the feature‑loop logic (Hit Dice first, then the first missing prerequisite), and all three places where the subclass ability’s eligibility is tested (the feature duplicate guard, the subclass duplicate guard, and the main subclass eligibility block) have been updated to use `_subWhy._subWhy`‑based checks. No lines are obviously missing or incorrect; the reliance on `_blockedFeat` for duplicate‑guard decisions is sound because any prerequisite failure already populates that set. **[HIGH, certain]**

## Untested aspects
Although the verification covered existing gates, legality sweeps, and price‑of tests, the following scenarios were not explicitly exercised:  
- Wild Shape itself being blocked by a Hit‑Die (level) prerequisite and ensuring that this correctly blocks Circle Forms.  
- The interaction when both doors are held and the prerequisite is missing, specifically whether the duplicate‑guard logic properly prevents double counting.  
- Edge cases where a prerequisite array contains multiple entries (though Circle Forms only has one).  
- Save/load cycles where a build lacks the `_abilDoor` stamp and falls back to the feature copy.  
These omissions mean some code paths remain unverified by the supplied evidence. **[MEDIUM, likely]**

## Possible ways to still acquire Circle Forms without Wild Shape
If the three data copies (`DATA.features`, `DATA.subAbilMap`, `DATA.subclasses…abilities`) ever drift apart—for example, if a future edit adds the prerequisite to only one or two of them—the door that lacks the prerequisite would still allow purchase or counting. Additionally, if a code path were added that bypasses the `_subWhy` check (e.g., a new validation shortcut or a modification to `purchaseLegality` that ignores fresh stop‑sign warnings), Circle Forms could be obtained without meeting the prerequisite. The current diff does not introduce such a path, but the risk of data divergence remains a realistic concern. **[MEDIUM, likely]**
