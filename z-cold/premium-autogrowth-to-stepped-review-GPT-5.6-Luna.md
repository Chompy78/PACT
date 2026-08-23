# Cold Review: Convert Rage / Wild Shape / Bardic Inspiration die to Stepped Pricing

**Reviewer model:** GPT-5.6 Luna  
**Review basis:** The supplied plan only. No independent access to the codebase, design decision record, or other project files.

## Executive assessment

**1. Does the proposed approach achieve the stated goal?**

**Mostly yes, subject to one important design/implementation gap: the plan has not specified enough of the data schema or purchase semantics to prove that the proposed entries will actually behave as intended.**

Conceptually, the approach is sound. The plan identifies that the existing generic stepped-purchase mechanism cannot represent non-consecutive tiers and changing pricing categories, and instead proposes ordinary one-time feature entries linked by prerequisites. That is a sensible fit for the stated constraints and avoids putting special-case pricing logic into the central pricing function.

The prerequisite-chain approach should enforce ordering, while retaining each ability's current entry as the unlock step preserves the existing first-purchase price. Independent tracks are also conceptually correct: the prerequisite graph needs to be a set of linear chains rather than one chain spanning all upgrades.

However, the plan does not actually specify the **exact feature-entry shape**, naming convention, prerequisite field/value, category/band assignment, or the precise mapping from each finalized step to an AP value. Those details are essential because the whole implementation depends on the new entries being ordinary purchases that the existing engine will price correctly.

There is also an important semantic requirement in the risk section: an unpurchased next step must leave the ability at its previous paid-for level, rather than making the feature unavailable or somehow downgrading it. The plan states this expectation, but it does not explicitly identify which engine/data mechanism determines the resulting mechanical value. That needs to be made concrete before implementation.

**Conclusion:** the architecture is appropriate, but the plan is not yet implementation-complete.

---

## 2. Are any "Verified" claims suspicious or self-contradictory?

### Verified claims 1–2: plausible, but dependent on the claimed code inspection

Claims 1 and 2 are internally coherent. The description of the existing stepped mechanism explains why it cannot directly express the proposed tables.

The strongest part is the identification of two separate incompatibilities:

- tier progression is not simply `+1` per purchase; and
- the price band can change between steps.

If those facts really were observed directly in the code/data, they are legitimate verified observations.

The statement that the proposed tables contain repeated tier 4 and skipped tier 2 is particularly useful because it demonstrates a concrete mismatch rather than merely asserting that the generic mechanism is insufficient.

### Verified claim 3: suspiciously narrow

The claim that **every proposed price is exactly 50% of the ordinary pricing-table lookup, rounded/floored to 1** is potentially legitimate, but it is the sort of claim that needs an auditable artefact.

The plan says only:

> "Checked by hand for one step"

That does **not** support the preceding universal claim that *every* proposed step was verified.

If only one step was actually checked by hand, then the wording should be narrowed to something like:

> "At least one checked step is exactly reproducible as 50% of the corresponding normal purchase price."

Or, if all steps really were checked, the plan should provide a compact audit table containing, for every step:

`ability | track | step | tier | category | normal lookup price | 50% rule | proposed AP`

Without that, this is the clearest example of a claim that may be stronger than the evidence described.

### Verified claim 4: reasonable, but should include the actual search result/count

The prerequisite search is a good verification method. The conclusion is plausible: if every existing prerequisite declaration belongs to the same category, widening the check is additive against the current dataset.

But because this is a **critical safety argument for modifying shared engine behaviour**, the implementation plan should preserve an exact reproducible check rather than merely saying a search was done.

For example:

- exact key searched for;
- number of matches;
- categories represented by those matches;
- ideally the fixture/test result demonstrating no existing behaviour changes.

The current wording is acceptable as a review note, but not strong enough as the only evidence supporting a risky shared-code change.

### Verified claim 5: definitely worth treating as a separate scope item

The Extra Attack precedent is useful, but the inference should be carefully separated:

- It is verified that the existing data permits purchasing `(3rd)` without `(2nd)` if that is what the current implementation does.
- It does **not** follow that this gap should be fixed now.

The plan correctly flags the latter as a decision.

### Overall judgement on the "Verified" section

Nothing is obviously self-contradictory, but **claim 3 is over-strong relative to the evidence described**, and claims 1/2/4 would benefit from more reproducible evidence.

---

## 3. Is there a better implementation approach?

**Probably not at the architectural level.** Given the constraints in the plan, the proposed approach is preferable to generalising the generic stepped-pricing formula.

The strongest alternative would be to introduce an explicit data-driven "upgrade chain" abstraction, where each step can specify its prerequisite and price. But that is effectively a new engine concept, and the plan's stated goal is specifically to avoid adding permanent complexity for three exceptional abilities.

Using ordinary feature entries has several advantages:

1. It reuses existing purchase/pricing behaviour.
2. It avoids special-case code for Rage/Wild Shape/Bardic Inspiration.
3. It makes each AP price explicit and inspectable.
4. It lets prerequisite ordering be handled centrally.
5. It can support independent tracks naturally.
6. It is consistent with an existing shipped precedent.

So I agree with rejecting the generalised stepped-purchase formula **for this change**.

I would, however, slightly improve the proposed implementation by making the data representation more explicit:

### Recommended data contract

For every upgrade entry, the plan should specify:

- unique feature identifier;
- player-facing name;
- parent ability/group;
- track identifier;
- step number;
- prerequisite feature identifier;
- exact AP price;
- pricing category/band, if the engine requires one;
- tier, if the dataset requires one for display/other calculations;
- mechanical effect/value represented by the step.

That gives the implementer a precise contract while retaining the simple one-time-purchase architecture.

---

## 4. What's missing that a competent implementer would need?

Several things.

### A. The actual finalized step tables

The plan says the tables are "full tables below", but the supplied document does **not actually contain them**.

This is the biggest omission.

The implementer needs the exact rows for:

- Rage;
- Wild Shape;
- Bardic Inspiration;

including AP, tier, category/track and mechanical effect at each step.

The plan explicitly says those numbers are fixed inputs, but does not reproduce them.

That makes the stated "exact AP numbers from the design decision" impossible to implement from this document alone.

### B. Exact data schema

The plan says "ordinary ... feature entries", but does not show an example entry.

A competent implementer should not have to infer:

- which fields are mandatory;
- what the prerequisite key is called;
- how prerequisite references are encoded;
- how the track is represented;
- which category/band the entry belongs to;
- how the feature's mechanical progression is represented.

At least one complete example for each structural variant would remove substantial ambiguity.

### C. Exact prerequisite semantics

The plan should explicitly answer:

- Does a prerequisite mean "must own the named feature"?
- Is the check based on feature ID or display name?
- What happens if the prerequisite is owned but subsequently removed?
- Can multiple prerequisites be declared?
- Does the check affect pricing only, warnings, purchase eligibility, or all three?
- What exact warning/blocking behaviour is expected?

The plan currently says "blocking warning", which sounds potentially contradictory. Is the purchase actually prevented, or is a warning merely displayed?

That distinction matters.

### D. Exact behaviour of independent tracks

The plan says tracks do not gate one another, which is good, but it should give an explicit example:

> Rage uses track: step 1 → step 2 → step 3  
> Rage damage: step 1 → step 2 → step 3

and state that purchasing Rage uses step 3 does not require any damage-track step beyond the shared unlock, if that is the intended rule.

This becomes especially important if the first entry is shared between tracks.

### E. Interaction with the existing mechanical feature

The plan needs to distinguish **pricing progression** from **mechanical progression**.

If "Rage: 3 uses/long rest" is a new purchase, what code makes Rage actually provide three uses?

Likewise:

- how does Wild Shape know the number of forms/uses/capability?
- how does Bardic Inspiration know the die size?
- are these values already derived from owned feature IDs?
- is additional mechanical code required?

The plan asserts that mechanical effects are out of scope, but that is only safe if the existing character engine already interprets the new entries in the desired way. The plan does not establish that.

This is the most important technical gap after the missing tables.

### F. Exact naming/ID strategy

Because prerequisites will reference entries, stable IDs matter.

The plan should define whether identifiers are:

- generated from names;
- manually assigned;
- immutable;
- case-sensitive;
- globally unique.

Using display names as prerequisite references would be unnecessarily fragile.

### G. Regression fixture expectations

The plan names three fixture classes, but not their exact expected outputs.

For each ability and track, the test matrix should specify:

- unlock only;
- each valid prefix of the chain;
- every immediate out-of-order purchase;
- cross-track purchases;
- final step;
- missing prerequisite;
- existing legacy fixture behaviour.

Without that, "add regression fixtures" remains somewhat open-ended.

### H. Version number

The plan says the version must be bumped exactly once but does not state:

- current version;
- expected next version;
- which exact constant is the dataset version;
- expected value after implementation.

A plan need not know the current version if it truly cannot access the repo, but it should explicitly instruct the implementer to identify the dataset version constant and bump it once, while leaving the unrelated build version untouched.

### I. Guide content

The plan says the guide needs updating but does not give the intended player-facing wording or exact rules structure.

Since the guide is treated as part of the live rules, the plan should at least define the required facts the guide must communicate:

- these are stepped purchases;
- which steps exist;
- what each step costs;
- that later steps require earlier steps;
- what happens if the player does not buy the next step;
- whether tracks are independent.

### J. Creation-time behaviour

The plan correctly says the "first step free" idea is out of scope. But it should explicitly state the intended current behaviour:

> The existing unlock purchase remains payable at its existing AP cost at character creation; no automatic grant is introduced.

That prevents an implementer from interpreting the deferred idea as an implicit requirement.

---

## 5. Is Verification objectively checkable?

**Partially, but not sufficiently yet.**

The existing Verification section has good categories, but several checks depend on undocumented expected values or author knowledge.

### Good and objectively checkable

- Existing regression suite has zero failures.
- New fixtures test valid ordering.
- New fixtures test invalid ordering.
- Unlock-only pricing remains unchanged.
- Existing fixtures gain no unexpected prerequisite warnings.
- Only the intended version marker changes.

### Not sufficiently objective

"All finalized steps ... exact AP numbers from the design decision" cannot be checked from this plan because the numbers are absent.

Likewise:

> "player-facing guide ... updated to match the new stepped structure"

requires knowing what the intended stepped structure actually is.

And:

> "correctly chained per track"

requires a defined list of tracks and prerequisites.

### How I would make the acceptance criteria independently verifiable

Add a compact acceptance table containing every intended purchase:

| Feature | Track | Step | Required prerequisite | AP | Mechanical outcome |
|---|---|---:|---|---:|---|
| Rage | Uses | 1 | — | … | … |
| Rage | Uses | 2 | Rage Uses 1 | … | … |
| … | … | … | … | … | … |

Then the reviewer can mechanically compare:

1. every row exists in the dataset;
2. every AP value matches;
3. every prerequisite points to the previous row in the same track;
4. no cross-track prerequisite exists;
5. fixtures cover each chain.

That turns the review from "does this look right?" into an objectively reproducible check.

---

## 6. Should this plan be split into more than one independent piece of work?

**Yes, but not necessarily into separate implementation PRs.**

I would split the work into at least these logical pieces:

### Workstream 1 — Engine prerequisite generalisation

- Widen the prerequisite check.
- Add tests proving existing behaviour is unchanged.
- Decide whether Extra Attack's existing gap is included.

This is the highest-risk code change and should be independently reviewable.

### Workstream 2 — Pricing dataset changes

- Add Rage steps.
- Add Wild Shape steps.
- Add Bardic Inspiration steps.
- Add prerequisites.
- Add exact AP values.
- Bump dataset/rules version.

This is primarily data/configuration work and can be reviewed against the step table.

### Workstream 3 — Player-facing rules

- Update the served guide.
- Update/remove the relevant examples.
- Perform the required transfer-back to the guide master.

This is operationally distinct because the master lives outside the repository.

### Workstream 4 — Regression fixtures

This could be part of Workstream 1/2 rather than a separate PR, but it should be treated as a distinct acceptance surface.

### Extra Attack decision

I would **not silently include this**.

Make it an explicit checkbox/decision:

- **Fix now:** add prerequisites to Extra Attack (2nd)/(3rd).
- **Defer:** document as a separate follow-up.

If fixed now, add dedicated regression coverage so the change is intentional rather than incidental.

---

# Overall verdict

**I would approve the architectural direction but reject the plan as implementation-ready in its current form.**

The central design decision is good: **use ordinary one-time purchase entries plus prerequisites rather than making the shared stepped-pricing formula more complicated.** The plan also correctly recognises that independent upgrade tracks and non-consecutive tiers do not fit the existing generic mechanism.

The main problem is that the document calls itself sufficiently concrete while omitting the very information the implementer needs most: **the complete finalized step tables and the exact data representation/semantics for the new entries.**

The strongest revision would therefore be:

1. include the complete Rage/Wild Shape/Bardic Inspiration tables;
2. show representative dataset entries with exact field names;
3. define prerequisite semantics precisely;
4. define how each purchased step maps to the actual mechanical outcome;
5. make the regression matrix explicit;
6. turn the Extra Attack question into a recorded decision;
7. strengthen the "Verified" evidence, particularly the universal 50%-pricing claim.

With those additions, the plan would be sufficiently concrete for an independent implementer and reviewer to execute and verify without relying on tribal knowledge.

## Suggested revised readiness status

**Current:** Design direction approved; implementation plan incomplete.

**Ready to implement after:** finalized tables + exact schema/examples + prerequisite semantics + mechanical mapping + objective acceptance matrix are added.
