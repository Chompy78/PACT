# Review: Enforce Hit-Dice Requirements on Class Abilities

**Reviewer model:** GPT-5.6 Luna  
**Reasoning setting:** Not exposed in the interface available to the reviewer.  
**Review date:** 2026-08-27  
**Scope:** Logic, clarity, scope and risk of the proposed plan only; repository/code correctness was not independently verified.

## Executive judgement

**Recommendation: Approve with changes.**

The plan is fundamentally sound and should achieve the stated goal. The strongest parts are the decision to make the rule a hard engine invariant, to derive the default requirement from the existing Tier→HD mapping, to apply the check to both mirrored purchase paths, and to integrate HD blocking into the existing prerequisite fixed-point machinery.

The two areas that need explicit resolution before implementation are:

1. **R1 — test integrity:** simply raising the Hit Dice in existing fixtures is dangerous if it changes what those fixtures actually prove. The plan recognises this risk, but the mitigation should be made a hard acceptance criterion rather than an implementation note.
2. **R3 — game-design intent:** applying the effective stepped Tier means a character may need 17 HD before purchasing the final step of several otherwise legitimate ladders. This is not merely a technical consequence; it is a rules interpretation with player-facing progression implications. The plan should obtain an explicit design decision before locking it into the engine.

A smaller concern is that the proposed helper combines three concepts — Tier-derived HD, an explicit `hd` override, and `lvl` — without fully defining precedence or semantics. That should be specified before implementation.

---

## 1. Does this approach achieve the stated goal?

**Yes, with one important qualification: the subclass path and all feature representations must truly pass through equivalent blocking semantics.**

The goal is to prevent class abilities from being purchased before the character has the HD required by their Tier. The proposed design directly enforces that in `compute()`, which is the stated single source of truth. That is preferable to relying on individual UI tools.

The approach is particularly strong in these respects:

- The requirement is derived from the already-existing `DATA.tierHD` rather than duplicating 551 values.
- A hard block makes the rule enforceable regardless of which UI calls the engine.
- Folding the check into the prerequisite fixed-point loop correctly models the important semantic distinction between **blocked** and merely **warned** purchases.
- Extending the same treatment to subclass abilities addresses the identified duplicate-purchase-path problem.
- Using effective step Tier rather than base Tier is internally consistent with the existing stepped-feature pricing mechanism.
- The proposed targeted tests cover the central regression: a 1-HD Fighter must no longer be able to purchase Tier-4 Extra Attack.

The plan also correctly avoids touching the Live Sheet when that UI already applies the gate, while still making the engine authoritative.

**Qualification:** the phrase "any class feature or subclass ability" in the Done criteria needs to be reconciled explicitly with the special cases mentioned elsewhere, particularly Warlock invocation level requirements, stepped features, and any item whose explicit `hd` differs from the Tier-derived value. The implementation contract should state exactly how these requirements combine.

---

## 2. Are any assumptions shaky, and which would hurt most if wrong?

### A1 — Pre-launch status

This is worth confirming, but it is not the most dangerous assumption. If false, existing characters could become invalid under the new engine rule, creating migration/compatibility questions. The plan should confirm this rather than relying on an earlier decision record.

**Impact if wrong:** potentially high operational/product impact, but the technical design remains valid.

### A2 — Guide Tier→HD mapping

This is more important because the engine is being changed specifically to enforce published rules. T1–T3 have not been independently confirmed in the Guide according to the plan.

The plan should either verify the complete table against the Guide or explicitly record that `DATA.tierHD` is authoritative for the mapping. Otherwise there is a risk of making the engine stricter according to a data table that may itself differ from the published rules.

**Impact if wrong:** high rules correctness risk.

### A3 — Guide requires no edit

This is reasonable, but it should be confirmed as part of the implementation. The plan itself identifies the project rule that mechanics changes must land in both engine and Guide.

If the Guide already contains the rule and examples, no substantive Guide change may be necessary; however, a documentation check should still be an explicit acceptance step.

**Impact if wrong:** moderate process/documentation risk.

### A4 — Cross-class and unlocked-class purchases should be identical

This is the most defensible assumption because the stated rule is about the ability itself and the plan identifies two purchase doors. If the game design intentionally permits an exception for one acquisition route, that exception needs to be explicit in the rules.

**Impact if wrong:** potentially high rules-design risk, but easy to resolve with a decision.

### Most important assumption

**A2 and R3 together are the highest-risk rules assumptions.**

A2 asks whether the Tier→HD mapping is correct. R3 asks whether the consequences of applying that mapping to stepped features are actually intended.

Of those, **R3 is the one I would require an explicit design decision on before implementation**, because the plan has measured a concrete and potentially significant player-progression consequence: several complete ladders become inaccessible until 17 HD. That is more than a test-data inconvenience.

---

## 3. Is there a better alternative?

### Hard block vs soft warning

**Hard block is the correct choice** if the Guide's wording is authoritative.

A soft warning would leave the engine capable of producing an illegal character and would recreate the current split between rules documentation, engine behaviour and UI behaviour. The existing prerequisite mechanism also establishes a precedent for treating prerequisite violations as zero-AP, not-owned, blocked purchases.

The alternative of warning while still pricing/owning the feature is therefore inferior.

### Derived gate vs authored data

**Derived from Tier is the better default.**

The plan correctly identifies that authoring 551 values which merely restate `DATA.tierHD` would create a substantial drift surface.

However, I would tighten the proposed API. Rather than conceptually treating `item.hd` as a general override without a documented precedence rule, define the requirement explicitly:

> Required HD = the maximum of the Tier-derived HD, any explicit item HD requirement, and any applicable level requirement.

That makes the intended monotonic behaviour clear and prevents an explicit field from accidentally weakening a Tier requirement.

### Effective step Tier vs base Tier

**Effective step Tier is the better interpretation if the Guide really states that each next step requires the HD shown by its Tier.**

Using base Tier would clearly create a loophole: a character who qualifies for the first step could immediately buy the whole ladder.

However, **this is precisely where R3 matters**. The implementation should not assume that a technically consistent interpretation is necessarily the intended game design. The 17-HD result should be explicitly approved.

### Overall

I would keep the selected architecture. I would not replace it with a different enforcement model. The needed changes are primarily **decision gates and test-design safeguards**, not a different implementation strategy.

---

## 4. What is missing?

Several cases or consequences deserve explicit treatment.

### A. Test semantic preservation should be a formal acceptance criterion

R1 is correctly identified but under-specified.

For every existing fixture whose HD is raised, the reviewer should be able to answer:

> "What behaviour was this fixture originally intended to prove, and after changing HD, does it still prove exactly that behaviour?"

For the four prerequisite fixtures named in R1, this is essential. But the same principle should apply to **all 13**.

The plan should require either:

- preserving the original fixture's purpose with the minimum necessary HD change; or
- replacing/restructuring the fixture if that is impossible.

A passing test suite is not sufficient evidence here. A fixture can pass for the wrong reason.

### B. Add explicit negative tests for both acquisition paths

The parity test is good, but the suite should explicitly demonstrate that:

- feature-path purchase is HD-blocked;
- subclass-path purchase is HD-blocked;
- mirrored feature representation cannot bypass the subclass gate;
- neither route can create ownership when blocked.

The parity test should compare more than AP/warnings if the engine exposes ownership state.

### C. Define warning ordering and deterministic output

R2 identifies this but leaves it as an untested assumption.

The plan should specify whether a feature that fails both prerequisite and HD gates produces:

- one combined warning;
- two warnings;
- prerequisite first, then HD;
- or another deterministic representation.

Because `expected-warnings.json` is keyed output, warning ordering/content is part of the observable contract.

### D. Define `hd`/`lvl` precedence precisely

The helper proposal implies:

`max(Tier HD, item.hd, item.lvl)`

but the semantics should be documented.

In particular:

- Can `item.hd` ever intentionally be lower than the Tier-derived requirement?
- Is `lvl` numerically interchangeable with HD, or merely equivalent for the relevant invocation rule?
- Does an explicit item requirement augment Tier, or override it?

The proposed `max()` strongly suggests "augment, never weaken", which is sensible, but it should be an explicit rule.

### E. Undo/decrement behaviour needs a design decision

R4 is real.

If a previously legal purchase becomes illegal after HD is reduced, what should happen?

Possible behaviours include:

- the ability becomes blocked and disappears from ownership;
- the ability remains grandfathered but cannot be newly purchased;
- lowering HD is itself prevented while dependent purchases exist;
- the Live Sheet automatically rolls back dependent purchases.

The current plan does not need to solve this if undo is outside the scope of `compute()`, but it should explicitly state the intended invariant. Otherwise the new hard-block semantics may interact unpredictably with the Live Sheet's history model.

### F. Missing boundary tests

Add explicit tests for:

- exactly-at-threshold HD: allowed;
- one below threshold: blocked;
- Tier 7 at 16 HD: blocked;
- Tier 7 at 17 HD: allowed;
- repeated/stepped feature at each transition;
- an explicit `item.hd` requirement higher than Tier-derived HD;
- a Warlock invocation with both Tier and level requirements;
- a blocked prerequisite whose own HD requirement is satisfied;
- an HD-blocked prerequisite with a dependent feature;
- duplicate/mirrored subclass representations.

### G. Stakeholder/design ownership

The plan needs an explicit **rules/design owner** for R3 and the cross-class interpretation.

This is particularly important because the reviewer is not in a position to infer game-design intent from engine structure alone.

---

## 5. Is Verification objectively checkable?

**Mostly yes, but two items currently contain judgement or incomplete specifications.**

### Objectively checkable

These are strong:

- `engine-parity-ci.mjs` returns 0 failed.
- `tool-pricing-ci.mjs` returns 0 failed.
- 1-HD Fighter + Extra Attack produces the specified blocked result.
- 5-HD Fighter + Extra Attack is not HD-blocked.
- Transitive prerequisite blocking occurs.
- Both purchase paths produce equivalent AP/warnings.
- `compute()` produces zero AP for blocked purchases.
- Blocked purchases are not owned and are itemised.
- `DATA.version` is changed and expected files are updated.

These can all be turned into deterministic automated assertions.

### Not fully objective as currently written

**"Manual: open CharGen ... confirm high-Tier abilities show their HD requirement and warn if selected."**

This is testable, but "confirm" is underspecified. It should identify at least one concrete feature, expected displayed text, and expected selected/rendered state.

More importantly:

**"expected/ re-baselined with each changed total explained"**

The first half is objective; "explained" is a review judgement unless the required explanation format/location is defined.

I would add a fixture-impact report or comments/decision record identifying for each changed fixture:

- previous HD;
- new HD;
- reason the fixture needs that HD;
- expected rule under test;
- why the test still proves that rule.

That directly addresses R1.

---

## 6. Should this be split into multiple plans?

**I would not split engine enforcement from fixture re-baselining into separate implementation plans.**

They are tightly coupled: changing the engine necessarily changes fixture expectations, and the fixtures are part of proving the rule. Splitting them could make it easier to land enforcement without adequate regression coverage.

However, I **would split the work into phases within the same plan**:

### Phase 0 — Rules/design decisions

Resolve before coding:

1. Confirm the complete Guide Tier→HD mapping.
2. Confirm that cross-class/unlocked-class purchases have no exception.
3. Decide whether effective stepped Tier really produces the intended 17-HD ladder consequence.
4. Decide the semantics of HD reduction/undo.
5. Specify warning precedence and `hd`/`lvl` requirement semantics.

### Phase 1 — Engine

Implement the helper and both blocking paths, with deterministic blocked-state semantics.

### Phase 2 — Regression tests

Add new tests first where practical, especially:

- direct HD block;
- exact threshold;
- transitive HD + prerequisite;
- stepped thresholds;
- mirrored subclass paths;
- requirement-combination cases.

### Phase 3 — Existing fixture preservation

Update the 13 fixtures **only after documenting what each fixture is supposed to prove**. Treat R1 as a test-quality review, not merely data maintenance.

### Phase 4 — UI/documentation/versioning

Update CharGen, expected outputs, version, changelog and decision records.

This preserves one coherent change while reducing the risk that fixture churn obscures a rules-engine regression.

---

## Specific recommendations before implementation

I would amend the plan with the following acceptance gates:

1. **Rules gate:** explicitly approve the complete Tier→HD table and the 17-HD stepped-ladder consequence.
2. **Requirement semantics:** document that the effective requirement is the maximum applicable requirement and cannot be weakened by an item-level value.
3. **R1 gate:** every changed fixture must retain its original behavioural purpose; no fixture may pass solely because of the new HD gate.
4. **Boundary coverage:** add exact-threshold and one-below-threshold tests for representative Tiers, including a stepped feature.
5. **Path coverage:** explicitly test both mirrored subclass acquisition paths as independent enforcement points.
6. **Undo policy:** document what happens when HD is reduced below a previously purchased ability's requirement, even if implementation is deferred.
7. **Warning contract:** define deterministic ordering/content for simultaneous prerequisite and HD failures.
8. **UI test:** specify concrete expected CharGen text/state rather than relying on a general manual confirmation.

## Final verdict

**Approve with changes.**

The architectural choice is good. The plan correctly identifies the major technical trap — treating an HD violation as a hard block and therefore incorporating it into prerequisite propagation — and it correctly recognises the duplicate subclass/feature purchase paths.

The biggest concern is not whether the engine can implement the gate; it is whether the fixture re-baselining and stepped-ladder interpretation accidentally turn a valid regression suite or intended progression rule into something different.

**R1 should be elevated from a risk note to a hard test-quality acceptance criterion. R3 should be resolved as an explicit game-design decision before implementation.**

Once those are resolved, I would consider the plan sufficiently precise to implement without splitting it into separate plans.
