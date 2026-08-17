# Subclass/Class Unlock Gating Review

**Model:** GPT-5.6 Luna  
**Relevant settings:** Australian English; design-review / cold-review mode.

**Date:** 2026-08-17  
**Project:** PACT  
**Decision recommendation:** **Do not keep the proposed class-access gate as a universal blocking prerequisite. Split the decision between subclass abilities and subclass expanded spell-list bundles, and resolve the pricing contradiction separately. My preferred outcome is a no-gate, price-based model for subclass abilities, with explicit clarification that subclass spell-list bundles are spell access and therefore inherit the §13 class-tax exemption. If the owner wants subclasses to be a distinct fictional permission, that should be stated as a deliberate exception rather than inferred from “each class you can build from”.**

---

## Executive judgement

The provisional gate **does achieve one narrow objective**: it closes the demonstrated route in which a character can buy a subclass ability from a class they have never unlocked. It also makes the phrase “Each class you can build from gives you one subclass for free” operate as a genuine precondition.

However, I do **not** think it is the best fit for the PACT economy as currently written.

The strongest reason is not merely philosophical. The existing guide explicitly establishes a price-based mechanism for cross-class features:

- a character may unlock another class and buy its features at sticker price; **or**
- skip the class unlock and buy individual cross-class features at the surcharge. fileciteturn2file0L13-L14
- The guide describes the latter as the cheaper route for a one-off feature and says the two routes “mirror how subclasses are bought”. fileciteturn2file2L38-L42
- It also repeatedly describes PACT's basic assumption as “a purchase is simply available to anyone with the AP”, while reserving gating for deliberate DM/story restrictions. fileciteturn2file9L164-L168

That makes a universal subclass-class gate feel less like the completion of an existing design and more like the introduction of a new category of prerequisite.

There is also an important distinction between **class access**, **subclass access**, and **spell access** that the current wording has blurred.

The guide is unusually explicit that spell access is separated from the class economy: a Foundation can open another class's spell list without unlocking that class, while non-spell class features remain subject to the class economy. fileciteturn2file0L13-L14

So I would make this a **two-part decision**, not one.

---

# 1. Does the proposed approach achieve the stated goal?

### Yes mechanically; only partially as a design solution.

If the stated goal is:

> prevent purchases of subclass abilities and subclass spell bundles unless the character has access to that class

then the blocking warning does exactly that, assuming the stated engine behaviour.

It closes:

1. subclass purchases from completely foreign classes;
2. the ability to acquire a subclass's free first-subclass slot without class access;
3. the demonstrated “three foreign subclass spell lists for 35 AP” route;
4. the permanent avoidance of the class-unlock ladder through those subclass purchases.

But it does **not** solve the underlying pricing problem.

The measured result is particularly revealing: for 169/192 subclass abilities, the cross purchase is cheaper than unlock + sticker, with the remainder equal at T7. That means the system's existing economics already say:

> “If you only want one or two things, don't unlock the class.”

That is not inherently a bug. It is exactly how the guide describes cross-class dabbling for ordinary class features. The problem is therefore not simply “the cheap route exists”. The problem is that the subclass system appears to introduce a **different access rule** from the base-class system.

That distinction may be intentional, but the document has not yet established why.

---

# 2. Which assumptions look shaky?

## Assumption A — “The escalating unlock ladder is intended as the mechanism that prices breadth”

**Mostly supported, but the interpretation is too strong.**

The guide plainly intends class unlocking to make deeper investment attractive: unlock costs escalate, while individual cross-class purchases carry a surcharge. fileciteturn2file2L38-L42

But the guide also explicitly says that the surcharge route is legitimate for a single dip. The worked Paladin/Warlock example is particularly strong evidence: the Paladin buys Warlock magic without unlocking Warlock, and the text then says a single invocation can also be cheaper via surcharge than by unlocking. fileciteturn2file4L70-L72

Therefore:

**Breadth is priced, but not every form of breadth must trigger the unlock ladder.**

The ladder is a route to cheaper repeated access; it is not universally a prerequisite for touching a class.

### Verdict: **supported, but overstated.**

---

## Assumption B — “Each class you can build from” was written as a precondition

**This is plausible, but not safe to assume.**

The literal wording supports it:

> “Each class you can build from gives you one subclass for free…”

and immediately says the character may then buy the subclass's spell list and abilities. fileciteturn1file1L26-L34

The phrase “you can build from” therefore naturally reads as an eligibility condition.

But there is competing evidence.

Section 11 describes two routes to cross-class features and says the approach mirrors subclass purchasing. fileciteturn2file2L38-L42

The guide also defines a class as a **menu that you unlock**, then buy features from one at a time; it does not describe ordinary cross-class feature purchases as forbidden until the menu is unlocked. fileciteturn2file3L53-L58

So the wording is genuinely ambiguous because the surrounding economic model points in two directions.

### Verdict: **shaky enough that it should not carry the entire decision.**

---

## Assumption C — “Cross price alone was intended to carry the whole cost of reaching outside your class”

**Not supported by the guide.**

This one is particularly weak.

The guide explicitly says that a cross-class feature can be obtained either by:

- paying the class unlock and then sticker price; or
- skipping the unlock and paying the cross-class surcharge per feature. fileciteturn2file0L13-L14

So the cross price is not merely an emergency fallback. It is a designed route.

The fact that it is cheaper for one-off purchases is explicitly celebrated in the guide.

### Verdict: **reject this assumption.**

---

## Assumption D — “The ladder dodge is a leak rather than an intended dabbling route”

**This is the shakier assumption in the entire document.**

For ordinary class features, avoiding the unlock is explicitly intended.

The guide says:

> “the surcharge is cheaper for a one-off.”

and gives an actual worked example of a Paladin taking Warlock features without unlocking Warlock. fileciteturn2file4L70-L72

So the mere existence of an unlock-free route is **not evidence of a leak**.

The real question is narrower:

> **Should subclass features be treated as ordinary cross-class features, or should “subclass access” be a separate prerequisite?**

That is the design decision that needs answering.

### Verdict: **very shaky.**

---

# 3. Is there a better alternative than AC1–AC4?

Yes.

## AC5 — No prerequisite; make subclass access a priced feature of the existing cross-class economy

This is my preferred design.

Treat a subclass ability exactly as the guide already treats a cross-class class feature:

- origin subclass → origin price;
- unlocked foreign class → sticker price;
- locked foreign class → cross price;
- no separate class-access prohibition.

The subclass's own **15 AP unlock** remains the mechanism for taking a second subclass within a class.

This produces a clean hierarchy:

**Class access**  
→ optional investment that changes the economics of repeated class-feature purchases.

**Subclass access**  
→ first subclass is free within an available class; additional subclasses cost 15 AP.

**Individual feature access**  
→ buy the feature at the appropriate class/subclass price.

This is much closer to the existing “pay the price, take the thing” philosophy.

### But it leaves the inverted penalty.

That should be fixed as a pricing problem, not hidden behind a prohibition.

The owner has excluded repricing from this review, but I think this is the most important conclusion to carry into the next design decision:

> If PACT wants “unlock class → sticker” to be the economically sensible route once a character invests deeply, the current cross-price formula is doing that only after several purchases. That is fine. What is not fine is deciding that the subclass route alone suddenly needs a hard prerequisite without explaining why.

In other words, **don't use a gate to repair an economic asymmetry that the base-class system intentionally tolerates.**

---

# 4. Core question: does gating fit or fight PACT's point-buy spirit?

## My answer: it fights it more than it fits it — unless subclass identity is explicitly intended to be a prerequisite-bearing category.

PACT's strongest design identity is visible throughout the guide:

> effects are normally converted into things you can buy individually.

The guide explicitly says a subclass is “not a single purchase”; it is a menu where you buy only the pieces you want. fileciteturn1file1L26-L30

That is extremely important.

“Taking Life Domain” does not mean buying a complete package. The player can buy its expanded spell list, Preserve Life, or both. The guide is deliberately building a point-buy system around **à la carte acquisition**. fileciteturn1file3L62-L68

A hard class prerequisite cuts against that model:

> You have enough AP to buy this ability, and the price is explicitly calculated, but you cannot buy it because you haven't purchased a different permission first.

That is a different design language.

### However, PACT is not purely “everything is purchasable”.

The guide already contains genuine barred options. It removes certain features where the system wants the underlying effect purchased separately, and it explicitly gives the DM authority to restrict or gate purchases. fileciteturn2file7L118-L127

So the existence of gates is not philosophically forbidden.

The key distinction is **what kind of gate it is**.

A species-origin restriction can be understood as an identity/heritage rule: the thing is inherently tied to what the character is.

A class-unlock prerequisite is different because PACT already has a **price mechanism for representing class distance**.

If class distance already has a price, adding a prerequisite risks charging the same conceptual cost twice:

1. “you are outside this class, so pay the surcharge”; and
2. “you are outside this class, so first buy permission to purchase the thing.”

That is why I would resist AC1.

### My test would be:

> **If the existing cross-class surcharge is insufficient to express why a subclass ability is inaccessible, what property of subclass abilities makes them fundamentally different from other class features?**

The review document does not yet answer that.

---

# 5. Does “spell access is free of the class tax” extend to a subclass's expanded spell list?

## I think yes — with one important qualification.

The guide's §13 language is unusually broad.

It says that buying into a Discipline's spells does not trigger the section 11 class-unlock cost; a Foundation opens the spell list directly. It then explicitly distinguishes spell purchases from class features. fileciteturn2file0L13-L14

The guide's worked example makes the principle concrete: the Paladin buys Warlock spell access without unlocking Warlock. fileciteturn2file4L70-L72

A subclass expanded spell list is still fundamentally a **spell-access mechanism**. The guide itself describes the bundle as a purchase of the spells granted by the subclass, with the normal spell costing logic. fileciteturn1file1L27-L30

Therefore I would not make a subclass spell bundle require class unlock.

### The qualification

The subclass bundle has a second identity: it is also a **subclass purchase**.

That creates the ambiguity.

The cleanest resolution is to define the bundle by its economic category:

> **The expanded spell-list bundle is a spell purchase, not a class-feature purchase. It therefore follows §13's spell-access rules and does not require class unlock.**

Then subclass abilities remain in §11's class-feature economy.

This would make AC3 attractive **if** the project insists on treating subclass abilities as class-gated.

But I would go one step further and recommend:

- **Subclass abilities:** no hard class gate; cross-class surcharge handles distance.
- **Subclass spell bundle:** no class gate; §13 spell-access rules apply.
- **Subclass unlock:** 15 AP applies only when selecting a second/third/etc. subclass within an already available class.

That is the cleanest separation.

---

# 6. What is missing from this document?

Several things.

## A. A precise definition of “class access”

This is the most important omission.

Does “class you can build from” mean:

- origin class only?
- origin classes?
- formally unlocked classes?
- any class from which you have bought one feature?
- any class whose spell list you have accessed?
- a class whose subclass has been opened?
- something else?

The review assumes “origin or explicitly unlocked”, but the guide itself uses “unlock a class's menu” language and separately permits cross-class purchases without unlocking it. fileciteturn2file3L53-L58

The final rule needs a glossary-level definition.

---

## B. The relationship between class unlock and subclass unlock

The document treats these as separate currencies, but the interaction is the heart of the problem.

It needs an explicit matrix:

| Class status | First subclass | Additional subclass |
|---|---|---|
| Origin class | ? | 15 AP |
| Unlocked class | ? | 15 AP |
| Locked class | ? | ? |

Until that matrix is filled in, “first subclass free” is not operationally clear.

---

## C. Whether the subclass's expanded spell list is a spell purchase or a subclass feature

This is currently the central ambiguity.

The guide calls it an expanded spell list and gives it spell-economy treatment, but places it under “Buying a subclass”. fileciteturn1file1L26-L34

That dual classification needs to be resolved explicitly.

---

## D. The reason subclass abilities would be different from base-class abilities

The review needs a design rationale, not just a textual observation.

If the answer is:

> “Because a subclass represents a coherent tradition/patron/domain and therefore cannot be accessed without entering the class.”

then say that.

If the answer is:

> “No, subclass abilities are just another set of priced class features.”

then remove the gate.

At present the document is effectively asking the implementation to infer this philosophy.

---

## E. The expected player behaviour

Give three or four concrete builds:

1. **one foreign subclass ability**;
2. **three foreign subclass abilities from the same subclass**;
3. **one foreign subclass spell bundle**;
4. **deep investment in a foreign class and its subclass**.

Then state which route PACT wants each player to choose.

That would expose whether the economy is actually producing the intended behaviour.

---

## F. The distinction between “breadth” and “coherence”

The guide says the 15 AP subclass unlock is “what stops cherry-picking” and that “breadth is available; idle dabbling is not.” fileciteturn1file3L65-L68

That is directly relevant.

If a player can buy one ability from several different subclasses, the subclass unlock is no longer stopping that form of cherry-picking.

If that is undesirable, the document should say **why subclass cherry-picking is uniquely undesirable when class-feature cherry-picking is explicitly allowed**.

---

# 7. Is the verification section objectively checkable?

## Partly, but it needs a better test suite.

The existing statement:

> “a character built by the cheap route and one built by the legitimate route should differ in total AP in the direction the rules intend”

is not objectively checkable until “the direction the rules intend” is defined.

That is a normative conclusion, not a measurable criterion.

### Replace it with explicit invariants.

For example:

### Test A — One-off class feature

A locked-class feature should be cheaper or equal via cross purchase than unlock + sticker when the number of purchases is below the stated break-even.

This validates the intended dabbling route.

### Test B — Deep class investment

Once the number of purchases reaches the break-even point, unlock + sticker should be no more expensive than repeated cross purchases.

This validates the class-unlock economy.

### Test C — Subclass ability

For a foreign subclass ability, specify whether the intended result is:

- cross purchase permitted;
- class unlock required;
- or some separate subclass gate required.

This is the actual design decision.

### Test D — Expanded spell list

A foreign subclass spell bundle should either:

- remain legal without class unlock under §13; or
- explicitly be declared an exception.

Do not leave this implicit.

### Test E — Subclass unlock

A second subclass in an already-accessible class should cost exactly 15 AP before its purchased abilities.

### Test F — No accidental double tax

If a character buys a subclass spell bundle, verify that they do **not** also incur a class unlock solely because the bundle is associated with that class.

That is the test most likely to expose a conceptual contradiction.

---

# 8. Should this split into more than one decision?

## Yes. Definitely.

I would split it into **three decisions**.

### Decision 1 — Are subclass abilities class-gated?

This is the philosophical question.

My recommendation: **No.**

Treat them as cross-class features and let the existing pricing model do the work.

---

### Decision 2 — Are subclass expanded spell lists class-gated?

My recommendation: **No.**

They are spell access and should inherit §13's explicit class-tax exemption.

The guide already makes this separation unusually clear. fileciteturn2file0L13-L14

---

### Decision 3 — What does the 15 AP subclass unlock actually unlock?

My recommendation:

> It unlocks an additional subclass **within a class you can otherwise access**, not the ability to buy the first subclass's individual effects.

That preserves the purpose of the 15 AP cost:

**“I want a second subclass identity from this class.”**

It does not turn the subclass unlock into a prerequisite for individual purchases.

---

# Recommended final design

I would choose a modified **AC2**, but with an explicit clarification rather than simply “remove the gate”.

### Recommended rule

**Class access is not a prerequisite for buying an individual subclass ability.**

A subclass ability uses the same class-feature pricing model as any other feature:

- origin class → origin price;
- unlocked class → sticker price;
- locked class → cross price.

**The first subclass is free for each class the character has access to, and additional subclasses cost 15 AP.**

However, if the system retains the existing concept that a subclass can only be *selected* from an accessible class, distinguish **selecting/opening a subclass** from **buying one of its effects**. A player buying a cross-class subclass ability is not thereby declaring that subclass as their formal subclass identity unless the 15 AP subclass unlock has been paid where applicable.

### For expanded spell lists

State explicitly:

**A subclass's expanded spell-list bundle is spell access and does not require class unlock. It follows the §13 spell economy.**

This is the least surprising interpretation of the guide's existing “spell access is free of the class tax” rule. fileciteturn2file0L13-L14

---

# Why I prefer this

It preserves all three of PACT's useful economic signals:

**1. Origin matters.**  
Your origin class remains the cheapest place to buy class features.

**2. Class breadth has a real cost.**  
Unlocking a class remains valuable when you want repeated access because it converts repeated surcharge payments into sticker prices.

**3. Dabbling remains possible.**  
A character can buy one foreign feature without first paying a large unlock cost — exactly as the guide currently intends. fileciteturn2file2L38-L42

And it avoids introducing a fourth, less PACT-like rule:

**4. “You have enough AP, but you are not allowed to buy this particular feature.”**

That fourth rule is not inherently bad, but it should be reserved for things that are genuinely identity- or fiction-dependent, not used to compensate for a pricing relationship.

---

# One important caution about AC4

AC4 is attractive in principle, but I would **not** implement it as:

> “Make cross always more expensive than unlock + sticker.”

That would destroy an intentional feature of the current class economy: cheap one-off dabbling.

The current guide explicitly uses that behaviour as a feature. The Paladin/Warlock example demonstrates exactly this pattern. fileciteturn2file4L70-L72

If the owner wants a different economic curve, that deserves a **separate class-economy review**, not a subclass-specific pricing patch.

---

# Final verdict

| Question | Verdict |
|---|---|
| Keep current blocking gate? | **No, not as a universal rule.** |
| Does it achieve its immediate goal? | **Yes.** |
| Does it fit PACT's broader point-buy philosophy? | **Only weakly.** |
| Is “ladder dodge = leak” established? | **No.** |
| Is “cross price carries the whole cost” established? | **No; the guide explicitly supports cross-class dabbling.** |
| Should subclass abilities be treated like other class features? | **Yes, preferably.** |
| Should subclass spell bundles require class unlock? | **No.** |
| Should the 15 AP subclass unlock remain? | **Yes.** |
| Should this be one decision? | **No — split abilities, spell bundles, and subclass selection/access.** |
| Best current option | **Modified AC2 / AC5: no class gate; clarify the three layers explicitly.** |

## Bottom line

**The provisional gate fixes a real inconsistency, but it fixes it by adding a prohibition where the rest of PACT normally uses price. I would not keep it.**

The deeper problem is not “players can reach across classes”; PACT deliberately allows that. The deeper problem is that the subclass wording currently does not clearly state whether a subclass is a **permission boundary** or merely a **menu of individually priced effects**.

The guide's overall architecture strongly favours the latter. It says subclasses are à la carte, class features can be bought cross-class via surcharge, and spell access deliberately bypasses the class tax. fileciteturn1file1L26-L34 fileciteturn2file0L13-L14

So I would remove the gate, explicitly classify subclass abilities as class features under §11, explicitly classify subclass expanded spell lists as spell access under §13, and leave the 15 AP subclass unlock as the cost of acquiring an additional **subclass identity**, not as a toll booth before buying any individual effect.

That gives PACT one coherent language:

> **AP buys effects. Unlocks make repeated access cheaper. Subclass unlocks buy additional identities. Spell access remains its own economy.**

That is a much stronger design boundary than the provisional gate.
