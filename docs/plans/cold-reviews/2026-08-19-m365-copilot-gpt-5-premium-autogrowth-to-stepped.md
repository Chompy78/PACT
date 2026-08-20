M365 Copilot (GPT-5 reasoning model; cold review based only on the supplied plan, with no codebase or external-file access)

# Cold Review: Premium Autogrowth to Stepped Pricing

## Executive verdict

**Recommendation: revise the plan before implementation.** The broad architecture is sound: represent each paid improvement as an ordinary one-time feature, chain steps through the existing prerequisite mechanism, and avoid complicating the generic consecutive-tier formula. That is probably the lowest-risk implementation under the stated constraints.

However, the plan is **not implementation-ready or objectively verifiable as written**. The most serious omission is that it says the “full tables” are below, but no Rage, Wild Shape, or Bardic Inspiration step table appears in the supplied plan. An implementer therefore lacks the exact step names, tiers, tracks, AP values, level gates, and prerequisite relationships needed to produce or independently verify the dataset changes.

A second material gap is that the plan proves how purchases will be priced and ordered, but does not establish how automatic level-based growth is currently represented or suppressed. Adding paid entries does not by itself guarantee that Rage damage, Rage uses, Wild Shape capability, or the Bardic Inspiration die will stop advancing automatically in every consumer of the shared data. The implementation must identify the authoritative representation of the effective ability state and prove that an unpurchased step leaves the character at the last purchased state.

## 1. Does the proposed approach achieve the stated goal?

**Mostly in principle, but not yet demonstrably.**

The proposed chain-of-one-time-features design addresses two genuine incompatibilities with the current generic stepped mechanism:

- step tiers are non-consecutive and may repeat; and
- category/band changes between steps and tracks.

Using fixed feature entries also keeps the central pricing formula unchanged. Widening an existing prerequisite check is preferable to introducing a second bespoke ordering system, provided that the check is genuinely generic and its semantics are suitable outside the current invocation category.

The approach achieves the pricing goal only if all of the following unstated conditions are true:

1. Ordinary one-time feature entries can carry independent origin and cross-class AP values without another runtime calculation overriding them.
2. They can express any required level/tier eligibility separately from AP pricing.
3. The prerequisite check is enforced in every relevant purchase path, not merely displayed by one UI.
4. Every tool consuming the shared engine treats the prerequisite result as blocking in the same way.
5. The effective mechanical state of each ability is derived from the highest purchased step, rather than continuing to derive automatically from character level.
6. Named steps have stable identifiers or otherwise cannot be confused by duplicate display names, class variants, localisation, or renamed labels.

The plan currently establishes none of points 3–6 from the supplied facts. In particular, a “blocking warning” is ambiguous: a warning that the UI can ignore is not equivalent to a rejected purchase. The plan should state the engine-level contract—such as an invalid result, validation error code, or exclusion from valid purchase options—and identify all callers that must respect it.

There is also a conceptual issue with independent tracks. If the existing Rage entry is the common unlock and both the uses track and damage track branch from it, the first paid entry in each branch should depend on the unlock; later entries should depend on the prior entry in the same branch. The plan implies this, but should specify the full graph explicitly. The same applies to Wild Shape and Bardic Inspiration if either has more than one track.

## 2. Review of the “Verified” claims

### Claims that appear reasonable but need narrower wording

The description of the current stepped mechanism is internally coherent. It supports the conclusion that the existing formula cannot directly represent skipped/repeated tiers or category changes. Still, “does not fit as-is” is the verified fact; “therefore should not be extended” is an architectural judgement and belongs under rationale, not verification.

The dataset-wide prerequisite search is useful evidence, but it proves only that all **declarations discoverable by the searched key** are in one category at the reviewed revision. It does not establish that:

- prerequisites cannot be expressed through aliases or another key;
- dynamically generated entries cannot carry prerequisites;
- all runtime consumers use that declaration consistently; or
- widening the check has no behavioural effect beyond warnings or pricing.

The safe wording is: “At revision `<commit>`, a repository-wide search for exact key `<key>` found `<count>` declarations, all in `<category>`.” Without the revision, key, and count, another reviewer cannot reproduce the claim.

The Extra Attack precedent proves that separately named one-time upgrade entries exist. It does **not** by itself prove that those entries are structurally suitable for branching tracks, fixed origin/cross prices, level gates, descriptions, or effective-state calculation. “Structurally identical” is therefore too strong unless every relevant schema field and consumer behaviour was compared.

### Claims that overreach or are incomplete

The statement that every proposed price is algebraically reproducible at 50% of the existing lookup is presented as verified, but only one hand-check is described. A full verification requires an explicit machine-checkable table of every step with:

- ability and track;
- step identifier/name;
- assigned tier;
- pricing category/band;
- full one-time lookup result;
- rounding rule and intermediate value;
- final origin AP;
- final cross AP, if distinct; and
- expected fixed constant entered in the dataset.

Without that table, “every proposed step” is not independently supportable from the plan. There is also an unresolved rounding ambiguity: “50% (rounded, floor 1)” does not say whether rounding is conventional nearest-integer, ceiling, floor/truncation, or an existing project helper. “Floor 1” appears to mean a minimum price of 1, but that must be stated explicitly.

The claim that widening the prerequisite check is “additive-only” also does too much work. Absence of declarations in other categories means no newly prerequisite-gated dataset entries at that revision, but changing the scope of central validation may still affect:

- malformed or partially constructed feature objects;
- test fixtures or user-imported/custom data not found in the static dataset search;
- callers that pass invocation-like objects under another category;
- duplicate-name resolution;
- cross-class purchases;
- error ordering or warning text; and
- features with missing, blank, inherited, or unexpected prerequisite values.

It is a plausible low-risk change, not a proven no-op outside the target data.

### Direct contradiction/omission

The introduction says “full tables below,” but the supplied plan contains no finalized AP tables. This is the clearest blocking defect. The tables are treated as external, assumed inputs while simultaneously being described as included. One of those statements must be corrected.

There is also inconsistent version terminology. Step 9 calls for bumping the “pricing dataset’s own version number,” while the file list identifies the relevant marker as the module’s “rules-version constant.” The plan must provide the exact constant name, owning file, and expected increment rule. Otherwise an implementer could reasonably bump the wrong marker.

## 3. Is there a better implementation approach?

**The proposed architecture is likely the best default**, with one refinement: make the chain metadata explicitly data-driven and identifier-based, while keeping prices as reviewed constants.

A robust implementation would use ordinary one-time entries with fields conceptually equivalent to:

- stable feature ID;
- display name;
- class/source;
- track ID;
- step ordinal;
- prerequisite feature ID;
- eligibility level or tier, if applicable;
- fixed origin AP;
- fixed cross AP; and
- mechanical state/benefit description or reference.

This is not a recommendation to build a new generic stepped-pricing subsystem. It is a recommendation to avoid using mutable display names as prerequisite keys if the existing schema permits stable IDs. If the current prerequisite mechanism only supports names, the plan should explicitly acknowledge collision/rename risk and test it.

A per-feature override table inside the central formula remains inferior here unless the engine already has a clean extension point for declarative step schedules. Based solely on the plan, no such extension point is established, so adding one would increase central complexity without a demonstrated reuse case.

The fixed constants should remain runtime constants, but the review artefact should include a small audit script or checked calculation fixture that derives them from tier/category tables. That gives maintainers traceability without making runtime pricing depend on the derivation formula.

## 4. What is missing for a competent implementer?

The plan needs the following before work begins:

### Exact source-of-truth schedule

Include the complete finalized matrix for all three abilities. For every step, state:

- stable key and exact player-facing label;
- unlock or upgrade status;
- track;
- prior-step prerequisite;
- character-level/tier eligibility;
- benefit represented by the step;
- pricing tier and category;
- origin AP and cross AP;
- derivation check; and
- whether the step is class-only or cross-buyable.

A simple directed graph per ability would remove ambiguity around branching.

### Effective-state behaviour

Document where each ability currently gets its scaling values. The plan must say whether automatic growth is encoded in engine data, UI display logic, character-sheet calculation, help text, or another rules consumer. Then specify the new rule for selecting the effective state. For example: the highest valid purchased step in a track determines that track’s capability, and character level alone does not grant unpurchased improvements.

This is essential to the stated player-facing risk mitigation. Otherwise the app could charge AP for entries while still granting the same growth automatically.

### Prerequisite semantics

Specify:

- whether prerequisites are resolved by ID or display name;
- same-class versus global resolution;
- behaviour for missing or ambiguous prerequisite targets;
- whether imported or legacy-invalid builds are tolerated, warned, or rejected;
- whether removing an earlier step is blocked when later steps depend on it;
- whether prerequisites are checked during addition, recalculation, import, and removal;
- the stable machine-readable error code/message expected; and
- whether “blocking” is enforced by the engine or only interpreted by callers.

The removal case is particularly important. Blocking purchase of step 3 without step 2 is insufficient if the user can buy both and then remove step 2 while retaining step 3.

### Dataset and consumer impact

List the exact files and symbols, not descriptions such as “the project’s single shared module.” Include the current commit/revision used for the verified searches. Identify all three UI tools mentioned in the risk section and state how each will be regression-checked.

Also document any feature sorting, grouping, filtering, duplicate-label handling, export/import serialization, and character-summary rendering affected by introducing numerous similarly named entries.

### Test matrix

The current fixture description is too broad. At minimum, test:

- unlock-only legacy price for each ability;
- every valid adjacent transition;
- every step purchased from an empty build;
- every step purchased with the unlock but with its immediate predecessor missing;
- skipped-middle-step cases;
- both directions of cross-track independence;
- the first step of each branch requiring the common unlock;
- origin and cross-class pricing for every step;
- repeated-tier steps producing distinct expected prices where categories differ;
- maximum/final step;
- attempted removal of a prerequisite that has dependants;
- exact blocking error code/result;
- unchanged behaviour for all pre-existing prerequisite-bearing invocation fixtures;
- unchanged behaviour for fixtures with no prerequisite;
- malformed/missing prerequisite target behaviour; and
- all three consuming UI tools, if their contracts are separately testable.

If level eligibility exists, add below-level, exact-level, and above-level cases for every boundary.

### Documentation transfer and release ownership

The guide-master problem cannot remain merely “out of scope” while guide synchronisation is part of “done.” Name the owner, source repository/document, destination, transfer procedure, and evidence required—such as linked commit IDs or a checklist sign-off. Otherwise completion depends on tribal knowledge.

The version bump likewise needs the exact symbol and expected old/new value, plus an assertion that the cosmetic build marker remains unchanged.

## 5. Is Verification objectively checkable?

**Not yet.** A different person could run a named regression command if it were provided, but the current plan omits:

- the test command and environment;
- the complete expected step/AP matrix;
- exact fixture names or IDs;
- the prerequisite failure contract;
- the baseline revision against which “no existing fixture changed” is measured;
- the identities of the three dependent UI tools;
- the exact guide sections/example lists to update;
- the master-guide transfer evidence;
- and the exact version constants and expected values.

“Manual check” is not intrinsically unobjective, but it needs a checklist with observable expected results. For example, the guide check should name each heading and each phrase/list to remove or replace. The additive-only check should compare machine-readable before/after outputs for the full pre-change fixture corpus, excluding only explicitly approved changed fixtures.

The verification should require a generated diff or report showing:

1. all legacy fixtures unchanged;
2. only named new fixtures added;
3. each finalized step matched to one dataset entry;
4. each prerequisite edge matched to one expected graph edge;
5. fixed AP constants matched to the finalized table; and
6. only the intended rules/data version marker changed.

## 6. Should the work be split?

**Yes across repositories/process ownership, but not into independently landable engine and dataset changes.**

The core engine widening, new dataset entries, version bump, and regression fixtures should be one atomic implementation change because none is safe or complete alone. The served guide copy should land in the same release unit if the project requires guide/engine consistency.

The master-guide update should be a linked change in its owning project, with an explicit transfer-back or publication task and cross-referenced commit/review evidence. It may be a separate pull request because it is a separate repository, but it should be release-blocking for the engine change.

The pre-existing Extra Attack gap should be a **separate follow-up**. It is independently valuable, but it changes existing purchase validity and expands the behavioural scope of a pricing change already touching a high-risk shared module. Fixing it “for free” is misleading: it still needs product acceptance, data edits, backward-compatibility consideration, guide review, and dedicated tests. The widened generic mechanism can land now; the Extra Attack entries can adopt it in a separately reviewed change. If the team deliberately includes it, the plan must add exact prerequisites, changed expected outputs, documentation impact, and acceptance criteria rather than treating it as incidental cleanup.

## Required plan revisions before implementation

1. Insert the missing finalized step/AP tables and prerequisite graphs.
2. Resolve the version-marker inconsistency with exact file, symbol, and old/new value.
3. Prove where automatic growth currently occurs and specify how effective purchased state replaces it across every consumer.
4. Define prerequisite identity, enforcement, removal, import, and error semantics.
5. Replace broad fixture language with the explicit matrix above.
6. Add reproducible repository revision, search key, hit count, test command, and baseline comparison method.
7. Make the external guide-master update a named, owned, release-blocking linked task.
8. Record Extra Attack as a separate follow-up unless its full scope and tests are deliberately added.

## Final answers

1. **Does it achieve the goal?** Architecturally, probably; as written, not demonstrably, because stopping automatic growth is not traced through consumers and the actual step tables are absent.
2. **Are verified claims suspicious?** Several are plausible but over-broad. The 50% claim, “structurally identical” precedent, and “additive-only” conclusion need reproducible evidence and narrower wording.
3. **Better approach?** Keep ordinary one-time chained entries and the generic prerequisite widening. Prefer stable prerequisite IDs and add an audit-time derivation check, not a more complex runtime formula.
4. **What is missing?** Exact tables/graphs, effective-state semantics, prerequisite enforcement details, exact file/symbol references, a complete test matrix, reproducible commands/baseline, and guide-transfer ownership.
5. **Is verification objective?** No, not yet. It lacks the source-of-truth values, commands, baseline revision, expected errors, named guide locations, and cross-repository completion evidence.
6. **Split the work?** Keep engine/data/tests/version atomic; coordinate the external guide as a linked release-blocking change; handle Extra Attack in a separate follow-up.
