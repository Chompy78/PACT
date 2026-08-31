> Triaged in session: docs/sessions/2026-08-27-feature-hd-gate.md, 2026-08-27
> Reviewer: M365 Copilot, based on the GPT-5 reasoning model
> Plan reviewed: docs/plans/2026-08-27-feature-hd-gate-cold-review.md

# Cold Review: Enforce Hit-Dice Requirements on Class Abilities

**Model:** M365 Copilot, based on the GPT-5 reasoning model  
**Relevant settings:** Cold review; high scrutiny; no repository access; assessment limited to the inline evidence; Australian English  
**Review date:** 2026-08-27  
**Plan branch:** `feat/feature-hd-gate`  
**Decision ID:** `D-GH-2026-08-27-feature-hd-gate`

## Executive assessment

**Recommendation: approve with required changes before implementation.**

The plan is directionally strong and should achieve the stated engine-enforcement goal. Its best decisions are centralising the rule in `compute()`, treating an illegal purchase as not owned, folding the HD condition into prerequisite closure, and covering both purchase paths. The plan also identifies the most important regression risk: existing prerequisite fixtures could continue to pass while no longer testing prerequisites.

Two matters should block implementation until resolved:

1. **R3 is not merely a sanity check.** Applying the escalated effective tier to every repetition appears to introduce or formalise a substantial progression rule. The quoted Guide sentence supports it, but the consequences are large enough that this requires an explicit game-design ruling, ideally with concrete ladder examples. It should not be accepted solely as an implementation inference.
2. **The fixture strategy needs test-intent controls, not just higher HD and regenerated snapshots.** Raising HD is necessary but insufficient. Each affected fixture needs an explicit assertion or documented invariant showing which gate is expected to fire, which gate must not fire, and why. Otherwise R1 remains real even if the parity suite reports zero failures.

I would not split engine enforcement from its tests or expected-output updates. They are one atomic behavioural change. I would, however, separate the unresolved stepped-ladder design ruling from implementation if the project cannot settle it immediately.

## Findings by severity

### Blocking findings

#### F1. Effective-tier gating for stepped features needs an explicit design decision

The plan treats step escalation as settled because pricing already uses `min(7, baseTier + n - 1)` and the Guide says the next step requires the Hit Dice shown. That is plausible and internally consistent, but it is not yet conclusive from the supplied evidence.

There are at least three interpretations of a repeated feature:

- each repetition is a distinct step with its own effective Tier for both price and eligibility;
- `tier` defines eligibility while repetition escalation affects price only;
- named or authored milestones, rather than purchase count, define eligibility.

The proposed plan chooses the first interpretation. That may be correct, but it causes a 5-HD character to wait until 17 HD to complete some common ladders. This is a significant progression outcome, not a minor implementation detail. If the Guide has a table or worked example showing a full ladder's HD cadence, quote it in the decision record. If it does not, obtain a rules-owner decision before coding this part.

**Required change:** add a decision checkpoint that explicitly approves the following statement:

> For a repeated feature, the effective Tier used for AP price is also the Tier used for HD eligibility, including the Tier-7 cap.

Record at least one complete example, such as a base-T4 five-step ladder, showing effective Tier and required HD for each purchase. This makes the rule reviewable and prevents future disagreement about whether price escalation was accidentally reused as an eligibility escalation.

#### F2. Snapshot re-baselining does not adequately preserve fixture intent

R1 is correctly identified, but the mitigation as written is incomplete. Raising `hd` enough to clear the HD gate protects prerequisite fixtures only if all of the following are true:

- the raised value clears the effective HD gate for every selected purchase in the fixture;
- no other selected item becomes newly legal or changes warning order;
- the fixture still lacks exactly the intended prerequisite;
- the warning assertion distinguishes prerequisite blocking from HD blocking;
- the AP total cannot pass merely because both failure paths cost zero;
- the expected warning list is specific enough that a reason change fails the test.

A zero-failure snapshot suite can conceal semantic weakening if expected files are regenerated from current output and reviewed only as bulk diffs. This is especially dangerous because both the old and new gates produce the same high-level economic result: zero AP and not owned.

**Required change:** create a fixture-impact manifest for all 13 changed fixtures. For each fixture, record:

- original test purpose;
- purchases involved;
- maximum effective Tier selected;
- old HD and new HD;
- expected blocking reason after the edit;
- blocking reason that must be absent;
- expected ownership state;
- AP delta attributable solely to added HD;
- expected warnings added, removed, or unchanged.

For `CG-022`, `CG-027`, `CG-030`, and `CG-031`, add direct reason assertions if the harness supports them. If it does not, add narrowly scoped regression fixtures or enhance the harness. Merely checking an exact warning string in a regenerated snapshot is weaker than a named semantic assertion, but it is still acceptable if the expected file is hand-reviewed and the reason is unambiguous.

### Major findings

#### F3. The proposed helper has unresolved data-contract and type semantics

`_hdNeededFor(item, effectiveTier)` is concise, but its proposed expression embeds several assumptions:

```js
max(DATA.tierHD[effectiveTier], item.hd || 0, item.lvl || 0)
```

Questions not answered by the plan include:

- whether `effectiveTier` is represented as `4`, `"T4"`, or both;
- what happens if the Tier lookup is absent or malformed;
- whether `hd` and `lvl` are guaranteed numbers rather than numeric strings;
- whether `0`, `null`, negative values, or non-integers are legal data;
- whether `lvl` elsewhere means character level exactly, or a class-specific level concept;
- whether an explicit `hd` value below the derived Tier requirement is intended to override or only raise the minimum.

The use of `max` means `item.hd` is not truly an override. It is an additional floor. That is probably safer, but the plan should call it a floor rather than an override. An actual override could lower a requirement, whereas this design cannot.

**Required change:** define the helper contract and failure behaviour. Prefer fail-closed with a diagnostic for invalid feature data, or validate all entries in a data-integrity test before runtime. Rename the concept from “override” to “additional minimum” unless lowering the Tier-derived requirement is deliberately supported.

#### F4. Duplicate subclass representation needs identity and deduplication analysis

The plan says all subclass abilities are mirrored into `DATA.features` and are purchasable through two code paths. It proposes parity across those paths, which is necessary, but it does not state whether the same logical ability can be present through both paths in one build.

Potential failure modes include:

- double pricing of one logical purchase;
- one path blocked while the other establishes ownership;
- duplicate blocked itemisation or warnings;
- prerequisite resolution using path-specific identifiers;
- warning text differing because labels or Tier calculation differ;
- a blocked copy coexisting with a priced copy.

**Required change:** add a targeted case where the same mirrored subclass ability is represented through both purchase collections in a single build. Define whether this input is invalid, deduplicated, or charged twice. The HD gate must not introduce a new answer accidentally.

#### F5. Reporting precedence should not discard useful simultaneous causes

The proposal says prerequisite first and HD second, but it is unclear whether this means ordering two reasons or reporting only one. Reporting only the prerequisite can be reasonable for transitive blocking, but it can also hide the fact that adding the prerequisite would still leave the purchase illegal due to HD.

A warning should ideally distinguish:

- **direct HD block:** the item itself is above the character's HD;
- **direct prerequisite block:** its prerequisite is absent;
- **transitive prerequisite block:** its prerequisite was selected but is itself blocked;
- **multiple direct causes:** both the HD minimum and prerequisite condition fail.

**Required change:** define a deterministic reason model. A good default is to report all direct causes on the selected item, then state when a prerequisite is itself blocked. If only one user-facing reason is allowed, preserve structured internal reason codes so tests can distinguish the causes and the UI can evolve later.

#### F6. Warning-string formatting should not become the only machine-readable contract

The plan relies heavily on warning text. Exact strings are useful for parity, but business logic becomes brittle if consumers or tests infer cause from prose.

**Required change:** if `compute()` cannot return structured diagnostics without excessive scope, at least keep internal reason codes during computation and generate strings at the output boundary. Suggested concepts include `FEATURE_HD_REQUIRED`, `FEATURE_PREREQ_MISSING`, and `FEATURE_PREREQ_BLOCKED`. This can be implemented later if changing the public output shape is too large, but the plan should avoid adding new string parsing.

### Moderate findings

#### F7. Undo is a general recomputation case, not necessarily a special exception

R4 asks whether undo lowering HD could strand a formerly legal feature. If `compute(build)` is the source of truth and builds may be edited retroactively, stranding is the expected consequence of an invariant: the current build is invalid, the feature is blocked, and AP is recalculated. The key issue is user experience and data preservation, not rules correctness.

The plan should decide whether the UI:

- prevents reducing HD below owned-feature requirements;
- permits it but shows affected purchases as blocked and retained;
- automatically removes illegal purchases, which would be risky and surprising.

**Recommendation:** permit the edit, retain the selections, recompute them as blocked, and show a clear warning. Do not silently delete purchases. Test direct build edits as well as Live Sheet undo because imported or hand-edited builds can produce the same state.

#### F8. CharGen annotation may not be enough to describe predictable behaviour

Annotating dropdown options is useful, but “surface the engine's warning on render” is underspecified. A user may select an illegal feature, see AP unchanged, and not understand why unless the blocked itemisation is prominent and associated with the selected option.

A disabled option would prevent constructing invalid test states and may interfere with importing older or manual builds. Allowing selection is therefore defensible, but the UI should make the result obvious.

**Required change:** define an objective manual check for annotation text, blocked item display, AP behaviour, and persistence of the selected value after recomputation.

#### F9. Fixture HD increases may introduce budget warnings or change unrelated branches

The plan notes that HD costs AP, but the consequence is broader than changed totals. Raising HD can add, remove, or reorder over-budget warnings, unlock other conditions, and alter fixture meaning beyond the intended gate clearance.

**Required change:** for each re-baselined fixture, explain not only the total delta but every warning-list delta. Where raising HD causes unrelated behaviour, prefer a new focused fixture and retire or narrow the old fixture rather than accepting a noisy re-baseline.

#### F10. Boundary and malformed-data cases are missing

Add targeted coverage for:

- exactly one HD below the requirement;
- exactly at the requirement;
- one HD above the requirement;
- Tier 1 and Tier 7 boundaries;
- escalation capped at Tier 7 for purchases beyond the cap;
- missing or invalid Tier data;
- an item with `lvl` higher than the Tier-derived minimum;
- an item with `hd` higher than the Tier-derived minimum;
- if supported, an item where `hd` or `lvl` is a numeric string;
- zero or missing character HD;
- duplicate selections and repeated-feature count calculation when an earlier step is blocked.

The last case is particularly important: define whether effective Tier is based on requested purchase ordinal or legal owned-step ordinal. Using only legal owned steps could accidentally lower later-step gates after an earlier step blocks.

#### F11. The guide-data equivalence assumption should be resolved, not carried into implementation

The unconfirmed T1 to T3 values are low risk because `{1,2,3}` is intuitive and existing Live Sheet behaviour apparently already uses `DATA.tierHD`. Still, the Guide is cited as the authority for an absolute rule, so partial confirmation weakens the change record.

**Required change:** verify the complete published table or explicitly state that engine data is authoritative for numeric mapping while the Guide is authoritative for the existence of the gate. If those responsibilities are not already defined, that is a documentation-governance gap.

### Minor findings

#### F12. “Class ability” terminology should be normalised

The plan alternates among class ability, feature, subclass ability, invocation, and repeated feature. That reflects the data model, but the done criteria should define the exact covered entity sets and exclusions. This reduces the risk that a future maintainer interprets “class ability” more narrowly than `DATA.features` plus `DATA.subAbilMap`.

#### F13. Versioning impact should state exactly what changes

The plan says `DATA.version` changes `compute()` output. Include the expected old and new version values in the implementation record and verify that version-only snapshot diffs are separated from rules-result diffs where practical.

## Answers to the six review questions

### 1. Does this approach achieve the stated goal?

**Yes, subject to the supplied architecture being accurate and the blocking loop being extended correctly.**

The approach enforces the rule at the engine level rather than relying on UI filtering, sets illegal purchases to zero AP, excludes them from ownership, propagates prerequisite blocking, and addresses both known purchase paths. Those choices align with the goal and with the stated hard-block semantics.

The largest qualification is stepped features. If effective price Tier is also intended to be eligibility Tier, the approach achieves the goal. If not, the plan would go beyond the stated goal and impose a stricter progression system than intended.

### 2. Are any assumptions shaky, and which would hurt most if wrong?

All four assumptions deserve resolution, but they have different impacts:

1. **Most consequential: stepped-feature interpretation, although it is listed under R3 rather than Assumptions.** If wrong, many legal character progressions become illegal, five fixtures move to 17 HD, and the engine would encode an unintended balance rule.
2. **Guide and `DATA.tierHD` equivalence.** If wrong, the project must decide whether data or publication is authoritative and update one or both. The engine change could otherwise deepen existing drift.
3. **Cross-class and unlocked-class equivalence.** If wrong, the proposed universal gate will enforce policy more broadly than intended. The supplied Guide wording sounds universal, so this assumption is plausible, but it should be backed by the rules owner or a quoted scope statement.
4. **Pre-launch status.** If wrong, existing saved builds may become invalid. This affects migration notes, backwards compatibility, import behaviour, support communications, and possibly whether warnings should be introduced before hard blocking.
5. **No Guide edit required.** Even if the rule text is already correct, the Guide may still need a clarification for repeated steps, additional minimums from `lvl` or `hd`, and blocked-purchase behaviour. A mechanics change may not be needed, but an explanatory edit may be.

The assumption most damaging to release operations is pre-launch status. The assumption most damaging to game design is the stepped-ladder interpretation.

### 3. Is there a better alternative than the chosen design?

#### Hard block versus soft warning

**The hard block is the better default.** It matches the absolute wording, keeps all tools consistent through the engine, and prevents illegal ownership from satisfying prerequisites. A soft warning would knowingly preserve the engine-guide mismatch.

A temporary soft-warning migration could be justified only if real saved characters exist and compatibility is important. That would be a rollout strategy, not a better final rule.

#### Derived gate versus authored data

**The derived gate is better than authoring 551 duplicate values.** It avoids bulk data duplication and drift. Optional per-item fields should be treated as additional minimums, with validation and documented precedence.

A stronger variant is to expose a single canonical function such as “required HD for purchase” and have both engine and UIs call it, rather than duplicating `b.hd >= DATA.tierHD[tier]` in Live Sheet. The plan leaves Live Sheet untouched because it already behaves correctly, but duplicated eligibility calculations remain a future drift risk. This does not need to block the current change if importing an engine helper into that tool is awkward, but it should be recorded as follow-up technical debt.

#### Effective step tier versus base tier

**No unconditional approval yet.** Effective-tier gating is the most internally consistent interpretation and prevents buying an entire ladder at its entry HD. However, the resulting cadence must be explicitly accepted as game design. If it is not accepted, the better alternative is not silently using base Tier. It is to author a clear progression rule for repeated features, possibly a separate eligibility progression distinct from AP-price escalation.

### 4. What is missing?

The principal missing items are:

- explicit acceptance criteria for repeated ladders, including a complete example;
- semantic assertions that preserve each fixture's original purpose;
- duplicate-path behaviour when the same subclass ability appears through both collections;
- invalid or missing Tier-data handling;
- a precise definition of `hd` and `lvl` precedence and meaning;
- direct versus transitive versus multiple blocking reasons;
- exact-boundary tests;
- requested-step versus legally-owned-step calculation for repeated features;
- imported, legacy, or manually edited builds if pre-launch status is wrong;
- UI behaviour when HD is reduced after purchase;
- possible over-budget-warning changes caused by raising fixture HD;
- a named rules owner or game-design stakeholder to approve R3;
- a migration or release-note decision if persisted builds exist;
- protection against two implementations drifting again, especially Live Sheet's local gate versus the engine helper.

### 5. Is Verification objectively checkable?

**Mostly, but not entirely.**

Objectively checkable items:

- both CI commands exit successfully with zero failed;
- the 1-HD Extra Attack case returns a specific HD diagnostic, charges zero AP, excludes ownership, and itemises the purchase as blocked;
- the 5-HD boundary case prices normally without an HD diagnostic;
- a dependent of an HD-blocked prerequisite is also blocked;
- both purchase paths yield identical AP and diagnostics;
- changed fixtures have explained AP and warning deltas.

Items currently containing judgement or ambiguity:

- “prices normally” needs an exact expected AP amount and ownership/itemisation result;
- “identical warnings” needs a defined ordering and identity policy, especially if path labels differ;
- “high-Tier abilities show their HD requirement” needs exact formatting and representative options;
- “warn if selected” needs an exact UI location and expected state;
- “appears under Blocked purchases” needs a defined count and label if duplicates exist;
- transitive blocking needs verification of the reason, not only blocked status;
- `0 failed` is objectively observable but not sufficient evidence that fixture intent survived re-baselining.

The manual CharGen check should be converted into a short script of observable steps and expected results. If browser automation is impractical, it can remain manual while still being objective.

### 6. Should this be split into multiple plans?

**Do not split engine enforcement from fixture and expected-output updates.** They form one atomic behavioural change. Landing engine logic without its regression coverage or landing re-baselines separately would make review harder and could leave the branch knowingly red or under-tested.

A sensible structure is one plan with clearly separated commits:

1. tests and focused fixtures that demonstrate the currently missing gate;
2. engine implementation for features and subclass abilities;
3. existing-fixture preservation edits with an impact manifest;
4. CharGen annotation and rendering behaviour;
5. expected-output re-baseline, version bump, changelog, and decision record.

There is one justified split point: **if R3 cannot be approved now, separate repeated-feature eligibility into a follow-up decision and implementation.** The first plan could enforce base feature Tier and explicit `lvl` or `hd` floors for non-repeated purchases while leaving repeated-step behaviour unchanged or explicitly unsupported. That is less elegant and may temporarily leave a gap, so resolving R3 before implementation is preferable.

## Focused assessment of R1

R1 is a high-probability, high-impact test-quality risk. The plan recognises it, which is good, but “raise HD enough” only removes one masking condition. It does not prove the original prerequisite mechanism remains under test.

For the four named prerequisite fixtures, the acceptance standard should be:

- all selected features pass their direct HD gates;
- the intended prerequisite is absent or blocked for the original reason;
- the resulting diagnostic explicitly identifies the prerequisite failure;
- no HD-failure diagnostic appears on the subject feature;
- ownership closure matches the intended chain;
- the AP result is asserted but is not the sole proof;
- warning order does not allow an unrelated warning to satisfy a loose comparison.

For the transitive fixture, additionally prove that the deepest feature is blocked because its selected prerequisite is blocked, not because the deepest feature independently fails HD. Set HD high enough for every feature in the chain, ideally 20 if doing so does not activate other fixture behaviour. The purpose is isolation, not minimal character realism.

The safest pattern is to preserve old scenario fixtures for end-to-end coverage and add small gate-specific unit or micro-fixtures. Snapshot totals should remain a secondary safety net, not the only evidence.

## Focused assessment of R3

R3 is acceptable only if the project explicitly wants price escalation and eligibility escalation to be the same progression axis.

The proposed cap mapping implies this purchase sequence for a base-T4 repeated feature:

| Purchase | Effective Tier | Required HD |
|---:|---:|---:|
| 1 | T4 | 5 |
| 2 | T5 | 9 |
| 3 | T6 | 13 |
| 4 | T7 | 17 |
| 5+ | T7 | 17 |

That sequence is orderly and easy to explain. It also means a character cannot rapidly stack repetitions at 5 HD. Whether that is desirable depends on how Rage, Wild Shape, Sneak Attack, and Martial Arts repetitions correspond to familiar class progression. The plan provides no progression comparison, playtest evidence, or rules-owner sign-off.

Before approval, compare at least the affected ladders against the intended level cadence in the Players Guide. The question is not merely “does the sentence permit T7 at 17 HD?” It is “does each repeated purchase represent a higher-Tier ability in the game's design, or is escalating Tier only a price-control mechanism?”

If the answer is the former, retain effective-tier gating. If the answer is the latter, introduce a separate eligibility rule rather than overloading the pricing function.

## Recommended amendments to the plan

1. Add an explicit R3 design decision and a full stepped-ladder example.
2. Replace “`hd` override” with “additional HD floor”, unless lower overrides are intentionally permitted.
3. Specify helper input types, missing-data behaviour, and Tier-key normalisation.
4. Add a 13-fixture impact manifest with original intent and expected reason deltas.
5. Add semantic reason assertions for the four prerequisite regression fixtures.
6. Add duplicate mirrored-subclass selection coverage in a single build.
7. Define deterministic multiple-cause and transitive-cause reporting.
8. Add boundary, invalid-data, repetition-cap, and purchase-ordinal tests.
9. Define behaviour when HD is reduced: retain selections, recompute as blocked, never silently delete.
10. Make CharGen manual verification objective with exact steps and expected AP, selection, warning, and itemisation states.
11. Confirm complete Guide mapping and pre-launch status before release.
12. Record Live Sheet's duplicated local gating logic as follow-up drift risk, even if it remains untouched now.

## Proposed review outcome

**Reviewer:** M365 Copilot, based on the GPT-5 reasoning model  
**Date:** 2026-08-27  
**Outcome:** Approve with required changes  
**Accepted:** Engine-level hard block; derived Tier-to-HD gate; fixed-point prerequisite interaction; both purchase paths; zero AP and not-owned semantics; version and decision records  
**Required before implementation:** explicit R3 ruling; fixture-intent manifest and semantic assertions; helper data contract; duplicate-path and boundary coverage; deterministic blocking-reason policy  
**Deferred:** centralising Live Sheet UI gating on the engine helper; structured public diagnostics if changing `compute()` output shape is outside current scope  
**Rejected:** blind expected-output regeneration as sufficient verification; treating snapshot success alone as proof that prerequisite regressions remain tested
