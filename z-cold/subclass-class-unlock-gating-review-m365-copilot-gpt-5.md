# Subclass–Class Unlock Gating Review

**Model:** M365 Copilot, based on the GPT-5 reasoning model  
**Relevant settings:** Australian English; cold design review; no codebase access; engine behaviour and measurements supplied by the review brief are treated as verified facts. The attached source reviewed is *PACT Player’s Guide v0.333*. No web research was used.

**Date:** 2026-08-17  
**Project:** PACT  
**Review status:** Recommendation ready

## Executive judgement

**Recommendation: do not keep the provisional gate in its current all-or-nothing form. Split the decision.**

- **Subclass abilities should require class access for now** (AC1 for abilities), because they are downstream components of a subclass and the guide already describes subclasses as belonging to classes “you can build from”. This also closes the worst ladder dodge until the economy can be reconsidered.
- **Expanded spell-list bundles should not require class access** (AC3 for bundles), because the guide expressly establishes direct, class-tax-free spell access as a system principle, and the current bundle price has no unlocked discount. Requiring a 7+ AP class unlock that changes neither bundle price nor spell mechanics is presently a pure toll with no economic or mechanical payoff.
- **Long term, replace the ability gate with an explicit dabbling price or access licence**, rather than forcing a full class unlock. That is the best fit for PACT’s point-buy identity, but it is a pricing decision and is therefore outside this brief’s implementation scope.

This means **AC3 is the best immediate choice**, paired with a separately tracked pricing redesign. AC1 is a defensible temporary containment measure, but weak as the permanent design. AC2 leaves a clear dominant strategy. AC4 identifies the right design layer but is underspecified and, as written, risks making one-off character concepts unreasonably expensive merely to ensure that unlocking always wins.

## 1. Does the proposed approach achieve the stated goal?

**Partly.** It answers the binary access question operationally: a subclass ability or bundle attached to a class that is neither origin nor unlocked receives a blocking warning. It therefore marks both purchase types as requiring class access and closes the stated ladder-dodge route for rules-valid builds.

It does **not** repair the inverted incentive. It suppresses the cheaper route by declaring it invalid rather than making the intended route economically preferable. The underlying prices still say that no-access buying is cheaper for 169 of 192 abilities and that unlocking provides no bundle discount at all. The validation rule and the price model would therefore communicate opposing design stories.

The phrase **“blocking warning—not a refusal”** also needs firmer semantics. If a blocking warning prevents a character from being considered valid, exported, advanced or approved, it functions as a prohibition even if the purchase can technically remain on the sheet. The review should judge it by that player-facing effect, not by the UI label.

**Verdict:** the approach achieves **enforcement of AC1**, but it does not fully achieve the broader goal of determining whether that rule belongs in PACT or of aligning price signals with the chosen philosophy.

## 2. Which assumptions look shaky?

### 2.1 The unlock ladder was intended to price all breadth

This is plausible but not established. Section 11 clearly prices ownership of additional class menus, yet the existence of a `cross` price for purchases made without the origin discount can also be read as deliberate permission to buy outside owned classes. The spell rules then expressly create at least one form of cross-class reach that bypasses the class tax. The ladder unmistakably prices **class ownership**; the document has not yet proved that it was meant to price **every isolated purchase associated with a class**.

### 2.2 “Each class you can build from” is a precondition

This is the shakiest textual assumption. Grammatically, it can be a domain restriction, but the surrounding sentence then says the buyer may take abilities at normal prices, including a cross-class surcharge. Without definitions for **build from**, **class access**, and the conditions under which `cross` applies, readers can reasonably infer either:

- only owned classes expose subclasses; or
- every priced item remains purchasable, while ownership determines discounts and free subclass accounting.

The current text cannot safely carry a blocking rule without an explicit prerequisite sentence.

### 2.3 The `cross` price was intended to carry the entire access cost

Also shaky. The measured inversion suggests that `cross`, `sticker`, and the unlock ladder were designed independently or for different purposes. It is not safe to infer intent backwards from a cost table whose incentives contradict the apparent access model.

### 2.4 The escalating ladder is necessarily being “dodged”

“Dodged” presupposes the conclusion. If a class unlock buys broad, continuing access and a single cross purchase buys only one isolated feature, declining the bundle is not necessarily an exploit; it may be ordinary à-la-carte purchasing. It becomes a leak only if the rules intend all subclass components to depend on class ownership, or if repeated à-la-carte purchases reproduce most of the class’s value without paying the breadth cost.

### 2.5 Tightening is migration-free because PACT is pre-launch

Reasonable, but pre-launch does not mean consequence-free. Ready heroes, worked examples, test characters and balance spreadsheets may embody the old interpretation. Those should be audited even if no public saved characters require migration.

## 3. Is there a better alternative than AC1–AC4?

Yes: **an à-la-carte subclass access licence**, which sits between unrestricted cross-buying and a full class unlock.

### Proposed alternative: AC5 — Price access to the subclass, not the whole class

A character without class access may buy a foreign subclass’s components after paying a one-off **dabbling licence** for that subclass. The licence should:

1. permit purchases from that subclass only;
2. not grant the class’s `sticker` prices;
3. not grant the class’s free subclass slot;
4. count towards a separate breadth measure, or towards the class-unlock ladder when later converted; and
5. be fully or partly credited if the character later unlocks the parent class.

This resolves the most important structural problem without saying “no”: breadth has a price, isolated concepts remain possible, and full class access still has a reason to exist. It also creates a meaningful distinction between **dabbling in one subclass** and **owning a class menu**.

A simpler variant is a **recoverable access deposit**: the first no-access subclass ability carries an additional fee; later unlocking that class credits the fee against the unlock cost. That avoids double-charging and prevents the first purchase from being cheaper solely because the character avoided the intended door charge.

This alternative needs modelling before adoption. It is better design than an unexplained prohibition, but it is not a safe same-day patch.

## 4. Does gating fit or fight point-buy’s spirit?

It can fit a point-buy system, but only when the gate protects a genuine dependency rather than compensating for prices that send the wrong signal.

Point-buy does not mean universal availability. Prerequisites, mutually exclusive choices and origin-only traits can preserve identity, progression or fiction. PACT’s Tier 2+ origin-species restriction proves that priced construction and hard boundaries can coexist. That precedent is strongest where the rule protects an intrinsic identity that cannot sensibly be purchased later.

Subclass abilities are somewhat different. A subclass is a specialisation inside a class, so requiring access has a coherent dependency rationale: one opens the parent discipline before its specialisation. On that reading, a gate fits. But if individual abilities already have explicit cross prices, readers will reasonably treat those prices as the cost of crossing the boundary. Gating then feels like charging an entry fee on top of a price that already claims to cover foreign access.

**Core verdict:**

- A **structural subclass prerequisite** can fit PACT.
- Using that prerequisite **only to hide an inverted price relationship** fights PACT’s point-buy spirit.
- The durable solution should allow players to buy past the boundary at a transparent cost unless class access is genuinely required for the feature to function or for identity protection.

The species precedent supports the legitimacy of some gates, but it does not establish that this particular gate is justified. Species origin is immutable in the stated model; class access is explicitly purchasable. That makes subclass gating more naturally a priced prerequisite than an absolute exclusion.

## 5. Does class-tax-free spell access extend to expanded subclass lists?

The best current reading is **yes for access, but not necessarily for subclass identity or benefits**.

The guide states a broad principle: a Spellcasting Foundation opens a spell list directly, without paying the Section 11 class unlock merely to cast from it. An expanded spell-list bundle is still spell access, but it may include additional value: curated spells, automatic preparation, access outside the ordinary list, or other bundle-specific privileges. Those extras justify a bundle price; they do not by themselves justify buying an unrelated class unlock that produces no bundle discount and may supply no required casting machinery.

The counterargument is textual: the bundle is presented alongside the abilities of a subclass from a class “you can build from”. That supports treating it as a subclass component rather than a generic spell-access product. However, the present mechanics weaken that reading:

- bundles have no `sticker` tier;
- unlocking does not reduce their price;
- buying the bundle already claims the free subclass for that class; and
- the spell chapter deliberately separates spell access from class ownership.

Those rules make an access gate look less like a meaningful dependency and more like a redundant toll.

**Recommendation:** treat the bundle as a direct spell-access purchase and do not require class access. If the design wants the subclass identity itself to matter, define a separate **subclass attunement/opening** requirement rather than importing the full class tax.

## 6. What is missing from the decision document?

1. **Normative design principles.** State what each charge is meant to buy:
   - class unlock;
   - `cross` surcharge;
   - `sticker` discount;
   - subclass unlock; and
   - expanded spell-list bundle.

2. **Precise validation semantics.** Define what a blocking warning prevents and whether a GM override produces a rules-valid character.

3. **Definitions.** Define “class you can build from”, “own”, “unlock”, “access”, “open a subclass”, and “cross-class”.

4. **The intended unit of breadth.** Is breadth counted by owned classes, touched classes, subclasses opened, individual foreign purchases, or effective capability? The current ladder only observes one of these.

5. **A target behaviour matrix.** For abilities and bundles separately, show whether origin, unlocked and no-access characters may buy; what they pay; whether a free subclass is consumed; and whether the purchase affects future unlock costs.

6. **Representative build tests.** Include at least:
   - one-off thematic dabble;
   - repeated purchases from one foreign class;
   - one purchase from many classes;
   - several expanded lists;
   - later conversion from dabbling to class ownership; and
   - a Tier 7 equality case.

7. **Budget context.** Express 7, 15, 35 and 70 AP as fractions of typical creation and advancement budgets. A mathematically visible gap may still be trivial or severe in play depending on AP cadence.

8. **Functional dependency analysis.** Identify subclass features that rely on parent-class resources, scaling rules, spellcasting ability or prerequisites. An access rule may be necessary for some features even if it is unnecessary for all.

9. **Free-subclass accounting rationale.** Explain why buying only a bundle claims a free subclass and whether no-access purchases should receive that benefit.

10. **Audit scope.** Name the ready heroes, worked builds, quick-reference text and appendix entries affected by each outcome.

11. **Decision criteria and weights.** For example: conceptual freedom, class identity, optimisation resistance, learnability, backwards compatibility and economic coherence.

## 7. Is the verification section objectively checkable?

**The arithmetic is checkable; the acceptance criterion is not yet complete.**

Two specified builds can be costed reproducibly, and their AP difference can be calculated. But “in the direction the rules intend” is circular until the owner records the intended relationship. AC2 intentionally permits the cheap route; AC1 declares it invalid; AC3 gives different answers for abilities and bundles; AC4 changes the prices. A single delta test cannot validate all four policies.

Replace the present statement with policy-specific assertions such as:

- **If abilities require class access:** every rules-valid subclass ability purchase has origin or unlocked access; override cases are clearly marked invalid or GM-exception.
- **If ability dabbling is allowed:** for each tier and purchase count, the expected cheapest route is declared in advance, then verified.
- **If bundles remain class-tax-free:** bundle totals are identical with and without class ownership unless some separately approved discount applies.
- **For breadth:** touching foreign classes by the allowed cheap route must affect future breadth cost in the expressly chosen way.

Also verify **state**, not just AP: owned-class count, next unlock price, subclass slots consumed, warnings, validity status and later conversion behaviour.

## 8. Should this split into more than one decision?

**Yes—at least three decisions.** Combining them risks using one philosophical answer to settle mechanically distinct products.

1. **Subclass ability access:** must the parent class be origin/unlocked, or may the ability be bought à la carte?
2. **Expanded spell-list access:** is the bundle governed by subclass ownership or the class-tax-free spell-access principle?
3. **Breadth accounting:** if no-access purchases remain possible, do they count towards future class-unlock costs, subclass opening costs, or a separate dabbling measure?

A fourth, later decision should set the price relationship among `cross`, `sticker`, unlock and any dabbling licence. That deserves a rules-version bump and quantitative modelling. The current review can choose the interim validation policy without pretending the economy is thereby fixed.

## Assessment of the listed alternatives

### AC1 — Keep the gate

**Strength:** immediately closes the ladder dodge and follows the strongest reading of “class you can build from”.  
**Weakness:** turns an economic contradiction into a prohibition and conflicts most sharply with direct spell access.  
**Use:** acceptable as a temporary containment rule for abilities; not recommended for bundles or as the final design.

### AC2 — Remove the gate

**Strength:** maximises point-buy freedom and makes `cross` mean what players will expect it to mean.  
**Weakness:** preserves a dominant breadth strategy, lets purchases avoid future ladder costs, and makes class ownership unattractive for many concepts.  
**Use:** reject unless the owner explicitly decides that class ownership is optional convenience rather than the mechanism pricing breadth.

### AC3 — Gate abilities, not bundles

**Strength:** best reconciles the two quoted principles and respects the actual bundle economy.  
**Weakness:** requires a clear explanation of why two components of the same subclass follow different access rules.  
**Use:** **recommended immediate policy**.

### AC4 — No gate; fix pricing

**Strength:** solves the problem in the idiom of point-buy and aligns incentives rather than forbidding choices.  
**Weakness:** “unlock-then-buy must always be cheaper” is too crude. A full menu unlock need not beat a one-off purchase; it should beat repeated commitment at a deliberately selected point. It also does not by itself fix future ladder accounting.  
**Use:** recommended as a separate economic redesign, not as the complete decision today.

### AC5 — Subclass dabbling licence with conversion credit

**Strength:** prices narrow access, preserves creative builds, distinguishes dabbling from class ownership, and avoids double payment when the character later commits.  
**Weakness:** adds another rule and currency-like concept and needs balance testing.  
**Use:** preferred long-term direction if AC4’s repricing cannot express the desired curve cleanly.

## Final recommendation

Adopt **AC3 now**:

- keep the class-access warning for subclass abilities;
- remove it for expanded spell-list bundles;
- rewrite the guide so both rules are explicit rather than inferred;
- make clear that a blocking warning defines rules validity even if the engine permits an override; and
- open a separate breadth-and-pricing decision covering AC4 versus AC5.

Do **not** describe the provisional gate as fixing the inverted penalty. It only prevents players from taking the cheaper route. The final economy should make the intended choices intelligible from their prices and accounting, with gates reserved for genuine dependencies or protected identity.

## Suggested wording direction

> **Subclass abilities.** You may buy a subclass ability only if its parent class is your origin class or a class you have unlocked. Cross-class prices apply when the parent class is unlocked but is not your origin class.
>
> **Expanded subclass spell lists.** You may buy an expanded spell-list bundle without unlocking its parent class. This is spell access and does not incur the Section 11 class-unlock cost. Buying the bundle opens or records that subclass only for the expressly stated subclass-accounting purpose.

The final sentence should be completed only after the owner decides whether a no-access bundle should consume a free subclass slot; that behaviour is currently consequential enough to require an explicit rule.

## Review outcome row

| Reviewer | Date | Findings accepted | Rejected | Deferred |
|---|---|---|---|---|
| M365 Copilot (GPT-5 reasoning model) | 2026-08-17 |  |  |  |
