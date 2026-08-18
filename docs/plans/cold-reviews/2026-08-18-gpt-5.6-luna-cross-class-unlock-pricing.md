# Cold review — PACT cross-class access and the class-unlock ladder

**Reviewer model:** GPT-5.6 Luna  
**Settings:** reasoning-focused; no codebase access; review limited to the supplied design document.

## 1. Does the proposal achieve the three stated intents?

**Mostly, but not completely. I would approve flat 10 AP as a better pricing model than 7N, with one important qualification: it does not solve the permanent-magpie problem.**

### 1.1 It makes a dabble remain a dabble

Yes, broadly.

The supplied simulation shows that under flat 10:

- one dab remains a dab;
- two dabs remain dabs;
- a light dip remains a dab;
- a real dip and larger investment trigger an unlock;
- the first/second/third/fourth-class break-even points are 4/3/3/3 purchases.

That is a much more coherent curve than the current 7N ladder. The current model becomes increasingly punitive because later unlocks require increasingly large investments, with the fourth unlock never paying back within the tested range. Flat 10 removes that discontinuity and makes the same decision rule apply regardless of which foreign class is being entered.

The important caveat is that the proposed 10 AP is not actually a clean implementation of “1–2 purchases = dabble, 3+ = investment”. The measured break-even is 4 purchases for the first class and 3 thereafter. That is close enough to the intended boundary to be defensible, but the design should acknowledge that the actual economic rule is “around three purchases”, not exactly “three”.

### 1.2 It keeps the origin class feeling like home

Probably yes, and the proposal correctly leaves the origin discount alone.

The cross-class system is not the only source of thematic differentiation. Origin purchases remain cheapest, while foreign purchases incur either the unlock cost or the cross-class surcharge. Nothing in the supplied evidence suggests that the origin discount is too weak.

However, this has not really been demonstrated by the simulation. The simulation is primarily measuring **cross-class breadth/depth strategy**, not whether players perceive their origin class as their character's home. That is a design conclusion supported by the pricing structure, rather than an experimentally demonstrated result.

### 1.3 It supports “cross-class is for a dabble”

Only partially.

Flat 10 makes *unlocking* behave sensibly: a player is encouraged to unlock a class when they want several abilities from it, rather than being punished into avoiding later classes altogether.

But it does not make cross-class access itself scarce. The permanent magpie remains unchanged at 72 AP under every tested model because that character never unlocks anything.

That is not necessarily a failure of flat 10. It means there are actually **two different design questions**:

1. How should the system price depth within a foreign class?
2. How should the system price broad access across many foreign classes?

Flat 10 solves the first substantially better than 7N. It does nothing to the second.

## 2. Which assumption is shakiest?

The shakiest assumption is the **1–2 / 3+ purchase boundary**.

It is explicitly an owner-defined intent rather than a measured player behaviour, so the simulation cannot establish that three purchases psychologically or mechanically constitute an “investment”.

More importantly, the boundary may not be the right unit at all.

A Tier 7 purchase and a Tier 1 purchase are both counted as one purchase in the break-even tables, despite the system explicitly making Tier a measure of power. The current cross-class surcharge scales by Tier, while the unlock price is a fixed class-level cost. Therefore, “number of purchases” is only a proxy for investment.

I would not reject the proposal on this basis, but I would test the design against **AP value and Tier-weighted access**, not just purchase count.

The owner should decide what “dabble” actually means mechanically:

- a small number of abilities;
- a small AP investment;
- a small amount of power;
- or simply touching a class without making it a major character identity.

Those are not equivalent.

## 3. Is there a better alternative? Should the ladder accrue?

### My recommendation: do not make dabbling accrue into the unlock ladder yet.

The idea is attractive because it is the only proposal that actually attacks the magpie case. But it changes the meaning of the system in a potentially undesirable way.

Under an accruing ladder, the player would effectively be told:

> “Every foreign class you sample makes future foreign classes more expensive.”

That creates a **breadth tax**, rather than merely pricing depth.

That may be exactly what PACT wants, but the supplied evidence does not establish that breadth should be penalised. The document itself identifies this as an assumption: that breadth should cost more than depth.

There is also a behavioural concern. If the player knows that an early dabble increases the price of later unlocks, the optimal behaviour may become counterintuitive:

- either commit early to the few foreign classes you expect to use;
- or deliberately avoid harmless exploratory purchases because they have future pricing consequences.

That can make character construction feel punitive rather than expressive.

The current 7N ladder already demonstrates the danger of making later access too expensive: the fourth class becomes effectively unreachable. I would be reluctant to reintroduce a similar effect indirectly.

### A better two-axis model

I think the document has uncovered a more useful conceptual model than the proposed alternatives:

**Depth should determine whether you unlock a class. Breadth should determine whether there is a separate cost for being broadly cross-class.**

Flat 10 handles depth.

If the magpie problem proves undesirable in playtesting, I would add a modest, explicitly separate breadth mechanism rather than making individual dabbles increase future unlock costs.

For example, a future test could examine a small “cross-class breadth” surcharge after a character has sampled several foreign classes. But I would not implement such a mechanism from this simulation alone.

The key point is that the magpie should not be accidentally solved by making every later unlock punitive. That would be fixing one extreme by recreating the flaw of 7N.

## 4. What's missing?

I would want four additional measurements before treating the pricing decision as fully settled.

### A. Tier-weighted break-even

The current analysis counts purchases, but the actual surcharge is `+Tier`.

Test break-even for:

- all low-Tier purchases;
- all high-Tier purchases;
- mixed purchases;
- equal AP-value investments with different numbers of purchases.

This will show whether flat 10 produces sensible behaviour across the actual power curve.

### B. Full-build optimisation across more shapes

The eight archetypes are useful, but they are still hand-selected shapes.

I would run a much larger generated population of builds and measure:

- number of foreign classes touched;
- number of purchases per foreign class;
- AP spent on foreign abilities;
- number of unlocked classes;
- total cross-class surcharge;
- difference between optimal and second-best strategy.

The last metric matters. If two strategies are separated by only 1–2 AP, the nominal optimiser result may not translate into meaningful player behaviour.

### C. Sensitivity to the flat price

The document tests 7, 10 and 12, but I would explicitly plot the transition points across a wider range, perhaps 6–15 AP.

The question is not simply “is 10 good?” It is:

> “Is there a stable design region in which the desired behaviour persists?”

If 9–11 all behave similarly, 10 is a robust choice. If behaviour changes dramatically at 9/10/11, the exact number is fragile.

### D. A deliberate magpie comparison

The magpie should be tested as a first-class design target rather than only reported as an incidental result.

Compare at least:

- one class × six abilities;
- two classes × three abilities;
- three classes × two abilities;
- six classes × one ability.

Keep total foreign AP roughly comparable where possible.

That would expose whether the system's desired distinction is really **depth versus breadth**, rather than simply “unlock at three purchases”.

## 5. Is the verification section objectively checkable?

**Mostly yes, but it needs more precise acceptance criteria.**

The strongest parts are the explicit zero-mismatch requirements:

- parity gate: 0 failed;
- simulator re-run;
- guide-vs-engine checker: 0 mismatches.

Those are objectively testable by someone other than the author.

The weaker part is:

> “break-even sits at the intended threshold”

“Intended threshold” is not sufficiently formal for an independent verifier. The document should specify the exact expected break-even range or expected table.

For example, if the design decision is flat 10, the acceptance criterion could state that the measured break-even for the first four foreign classes must be **4/3/3/3 purchases**, assuming the same test methodology used to produce the supplied table.

Likewise, “engine and guide state the same unlock cost” is clear only if the verifier knows whether the guide is expected to describe the cumulative price, per-class price, or both.

I would therefore rate the verification section **objectively checkable after one small tightening pass**, rather than fully specified as written.

## 6. Should this split into multiple decisions?

**Yes.**

I would split it into at least two decisions.

### Decision A — fix the live cliff immediately

The missing-entry behaviour that makes the fifth unlock free/refund prior unlock costs is plainly a defect in the supplied rules engine. The document already says it will be fixed regardless of the pricing outcome.

That should be isolated and fixed independently of the design debate.

The cumulative table should cover all 12 classes, and the missing-entry behaviour should be replaced with an explicit clamp/fallback that cannot create a negative or refunding unlock cost.

### Decision B — choose the intended unlock model

Then decide between:

- current 7N;
- flat 7;
- flat 10;
- flat 12;
- another model.

My vote is **flat 10**, based on the supplied evidence.

### Decision C — separately decide whether breadth needs a tax

I would explicitly leave the magpie question open for a separate design decision.

That avoids contaminating the much clearer conclusion that 7N is too punitive for later depth investments.

## Overall judgement

The corrected framing is sound. The important discovery is that the previous review was asking the wrong question: the per-feature cross-class route is explicitly part of the intended design, and the current issue is not whether that route should exist but whether the unlock price creates the right incentive to move from a dabble into an investment.

On that question, **flat 10 AP is a credible improvement over 7N**.

The strongest argument is not that it makes builds cheaper — the simulations show that total build costs often move only modestly. The stronger argument is that it changes the *shape of the decision*:

- one or two foreign purchases remain a dabble;
- sustained investment makes unlocking rational;
- later classes do not become effectively unreachable;
- the same economic rule applies to every foreign class.

I would therefore recommend:

1. **Fix the refund/cliff bug now, independently.**
2. **Adopt flat 10 AP as the leading design candidate.**
3. **Remove the provisional cross-class gate**, as the supplied §11 text explicitly supports the per-feature route.
4. **Keep the origin discount unchanged.**
5. **Tighten the verification acceptance criteria.**
6. **Run Tier-weighted and generated-build simulations before locking the number.**
7. **Do not add accruing breadth costs yet.** Treat the magpie as a separate design question and test whether that behaviour is actually undesirable.

The one thing I would *not* claim from the current evidence is that flat 10 “solves cross-class dabbling”. It solves the **depth/unlock incentive**. The evidence shows that broad, one-feature-per-class dabbling is structurally unaffected by unlock pricing, and that distinction should remain explicit in the design record.

**Decision recommendation: PROCEED WITH FLAT 10, SUBJECT TO THE ADDITIONAL MEASUREMENTS ABOVE; SEPARATE THE MAGPIE/BREADTH QUESTION.**
