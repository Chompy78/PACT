# Review of "Plan for cold review — Enforce Hit-Dice requirements on class abilities"

**Reviewer:** DeepSeek (default inference settings, no explicit reasoning effort configured)  
**Date:** 2026-08-27  
**Decision ID:** `D-GH-2026-08-27-feature-hd-gate`

---

## Overall assessment

This is a well‑structured, internally consistent plan that directly addresses a real gap between the published rules and the engine. The proposed technical strategy—folding HD checks into the existing prerequisite‑blocking loop and extending the same logic to the subclass‑ability path—is sound and minimises future drift. The risk inventory is thorough, and the alternatives are fairly considered.

That said, several assumptions and open questions need stronger treatment before implementation, especially around the **pre‑launch assumption**, the **undocumented HD‑lowering undo behaviour**, and the **verification of R1/R2**. I also recommend an explicit game‑design sign‑off for the stepped‑ladder consequences (R3).

---

## Response to the six review questions

### 1. Does this approach achieve the stated goal?

**Yes, provided the open issues are resolved.**

The plan will make `compute()` block any class ability (via both the feature list and subclass‑ability path) whose effective tier requires more HD than the character currently owns. It correctly treats blocked features as “not owned” and includes them in the “Blocked purchases” line, while also propagating the block through prerequisite chains. This matches the stated goal of bringing the engine into compliance with the Guide’s absolute rule.

The inclusion of a helper that uses `DATA.tierHD` by default but permits per‑item overrides is pragmatic and avoids manual data entry across 551 entries. The stepped‑feature logic (gating on the *effective step tier*) also follows the Guide’s wording.

---

### 2. Which Assumptions are shaky, and which would hurt most if wrong?

The plan lists four assumptions. Three of them are moderately risky; one is potentially **high‑impact**.

| Assumption | Risk level | Comment |
|------------|------------|---------|
| **App is pre‑launch: no real player characters exist** | **High** | If this assumption is false, the change will break existing characters, causing serious user‑facing issues. The plan says the assumption is based on a prior decision record but was not independently confirmed. I would require a definite confirmation (e.g., checking the production database or confirming with stakeholders) before proceeding. |
| **Guide’s Tier→HD table matches `DATA.tierHD` exactly** | Medium | The reviewer verified T4–T7 but not T1–T3. If the Guide has different values for low tiers, the engine’s gating will diverge from the published rules for abilities like T2 or T3 (e.g., a T2 ability requiring 2 HD when the Guide says 1). This would create a new inconsistency. An explicit cross‑check of all tiers is needed. |
| **Guide needs no rules edit** | Medium | If the Guide’s text is ambiguous or the Tier→HD table differs, the project rule (“both engine and Guide must match”) would expand the scope beyond this plan. The plan should include a step to verify the Guide’s wording for all seven tiers and, if necessary, defer Guide edits as a separate task. |
| **Blocking is desirable for cross‑class and unlocked‑class purchases identically** | Low | This is a design preference, and the plan’s parity across paths is sound. No strong objection. |

---

### 3. Is there a better alternative than the one chosen?

**Hard block vs. soft warning** — Hard block is the correct choice given the Guide’s absolute language (“You can never buy…”). A soft warning would be inconsistent with the rule and would likely lead to accidental rule violations in tools that do not display warnings prominently.

**Derived gate vs. authored data** — The derived approach is far superior to manually adding `hd` to 551 entries. It reduces maintenance and prevents data drift. The per‑item override remains available for genuine exceptions.

**Effective step tier vs. base tier** — Gating on the effective step tier is logically required by the Guide (“the next step only once you own the Hit Dice shown”). Using the base tier would allow a character to buy an entire ladder at once, which contradicts the published rule. The plan’s choice is correct, though it carries significant gameplay consequences (see R3).

---

### 4. What is missing – a case, a consequence, a stakeholder, a failure mode not listed?

Several elements are under‑addressed:

- **Undo / retroactive invalidation (R4)**  
  The plan correctly identifies that the Live Sheet’s undo can lower HD, but it does not propose a solution. This is a real failure mode: a player could legally buy a T6 ability at 13 HD, then undo HD to 12, leaving the ability blocked but still paid for and perhaps still visible in the UI. The plan should either:
  - Prevent lowering HD below the maximum HD required by any currently owned ability, or
  - Automatically refund/remove blocked abilities during recompute, with a clear warning.

- **Verification of R1 and R2**  
  The plan mentions R1 (fixtures that currently test prerequisites may pass for the HD reason instead) and R2 (warning priority when both gates fire), but these are not reflected in the Verification section. I recommend adding explicit checks:
  - For each of the four affected fixtures, after raising HD, the warning text should indicate the prerequisite failure, not the HD failure.
  - For a build where both gates fire, confirm that the warning mentions the prerequisite first.

- **UI/UX detail for CharGen**  
  The plan says CharGen’s `<select>` will show an annotation with the HD requirement and surface the engine’s warning. However, it does not say whether the dropdown will still allow selection of a blocked ability. If it does, users may be confused when the ability appears under “Blocked purchases” instead of being counted. Consider adding a visual indicator (e.g., strikethrough or colour) or a confirmation tooltip before the build is applied.

- **Subclass/feature path parity**  
  The parity check is mentioned but not detailed. I would add a test that verifies the same ability purchased via both paths generates identical warnings and the same blocked status, especially when a subclass ability is a prerequisite for another feature.

- **DATA.version bump and downstream dependencies**  
  Bumping `DATA.version` changes `compute()` output for every build. The plan mentions regenerating expected results, but it should also ensure that any other tools that read `DATA.version` or rely on stable output (e.g., analytics, import/export) are accounted for.

---

### 5. Is the Verification section objectively checkable?

Mostly yes, but with some subjective elements:

- The commands `node testing/scripts/engine-parity-ci.mjs` and `tool-pricing-ci.mjs` returning 0 failed are objective and reproducible.
- The targeted checks (1‑HD Fighter, 5‑HD Fighter, transitive block) are specific and can be automated.
- The parity check is objective if the expected output is defined.
- The manual step “open CharGen… confirm” is somewhat subjective, but as a final UX sanity check it is acceptable. However, it should be supplemented with an automated UI test or at least a written acceptance criterion (e.g., “the dropdown displays the required HD next to each option”).
- “Re‑baselined with each changed total explained” relies on human judgement to ensure the explanation is accurate. I recommend adding a step to document, for each changed fixture, *why* the new total is correct (i.e., which HD increase and which ability prices changed).

---

### 6. Should this be split into multiple plans?

**Not necessary, but a mild split could reduce risk.**

The plan is coherent: engine enforcement, UI annotation, fixture updates, and re‑baselining are all tied together. Splitting them would create dependencies and likely increase overhead.

However, the fixture re‑baselining (especially the 13 affected builds) is a significant change that touches many tests. If the team is risk‑averse, they could implement the engine changes first with a temporary “soft block” that warns but does not change AP totals, then run a second plan to enable the hard block and update fixtures. But given the Guide’s absolute rule, a single plan is acceptable.

---

## Key risks and recommendations

| Risk | Recommendation |
|------|----------------|
| **R1 – fixtures may pass for wrong reason** | Add an explicit verification that the four prerequisite‑testing fixtures still fail due to the prerequisite, not the HD gate, after HD is raised. This can be done by checking the warning text. |
| **R2 – warning priority when both gates fire** | Add a test case that triggers both gates and verify that the prerequisite warning appears first (as proposed). |
| **R3 – stepped‑ladder design impact** | Request a formal sign‑off from the game designer or rules owner that a full ladder (e.g., Extra Attack progression) genuinely requires up to 17 HD. If not, the effective‑step tier logic may need revision. |
| **R4 – undo lowers HD** | Decide on a handling strategy (prevent undo or auto‑refund) and include it in the plan. Do not leave it as an open question. |
| **Pre‑launch assumption** | Confirm that no existing character data exists. If this cannot be confirmed, add a migration plan that either grandfathers existing characters or forces them to comply. |
| **Guide consistency for T1–T3** | Perform a full cross‑check of the Guide’s Tier→HD table against `DATA.tierHD` for all seven tiers. If mismatches exist, expand the scope to include Guide edits. |

---

## Conclusion

The plan is technically sound and addresses the core issue effectively. With the additions recommended above—especially handling the undo case, verifying the R1/R2 warnings, and confirming the pre‑launch status—the plan can be executed with confidence. I approve the overall direction and suggest the author incorporate these clarifications before merging.

**Review outcome:** Accepted with requested amendments.  
**Reviewer:** DeepSeek  
**Date:** 2026-08-27