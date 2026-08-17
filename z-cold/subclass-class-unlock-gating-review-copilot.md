# Design Review — Should subclass purchases be gated behind unlocking the class?

**Reviewer:** Microsoft Copilot (running on the Claude Opus 4.8 model, default settings).
**Relevant setting:** I was given the complete `PACT-Players-Guide-WORKING.html` as context, so this review reads against the actual §11 (Classes: Origin, Unlock, Discount), §13 (Spellcasters), §15 (Barred Options / DM's final say) and Appendix B text — not only the excerpts quoted in the brief.
**Scope:** Design logic, clarity, scope and risk only. I have not assessed code; I treat the seven "verified facts" as given.
**Date:** 2026-08-17

---

## Bottom line up front

The provisional gate (AC1, as a blocking warning) is a reasonable stop-gap and is *tonally* consistent with PACT ("warns rather than refuses"), but it does **not** resolve the problem the brief actually uncovered. The real defect isn't "players can buy subclass pieces without access" — it's that PACT's **cross-class access is mispriced**, in two independent ways that happen to meet at the subclass menu:

1. **The ladder dodge (fact 5)** is a general cross-class-feature problem, not a subclass problem. Per-feature `cross` buying is cheaper than unlocking *and* never advances the 7×n ladder, so breadth never escalates the way §11 intends.
2. **Bundles are misclassified (fact 4).** A subclass's expanded spell list is *spell access*, which §13 deliberately exempts from the class tax. Pricing it with a Tier-based `cross` surcharge and no `sticker` tier is arguably just a classification bug, not a policy question.

My recommendation: **do not answer this with a prohibition.** Keep AC1's warning only as a non-blocking *education* nudge, and fix the economics instead — a variant of AC4 that I set out under Q3 (call it **AC5: access as a credited prerequisite**), plus reclassifying bundles under §13. And yes — **split the decision** (Q8).

---

## 1. Does the proposed approach achieve the stated goal?

**Partially, and only the narrow half of it.**

The stated goal is to *decide* whether subclass purchases should require access. As a decision instrument, AC1 makes the guide's written intent (`each class you can build from`) visible at the point of purchase, and it does so in PACT's native idiom — a warning, matching every other prerequisite. That is genuinely worth something.

But note what a *warning that changes no prices* does and doesn't do:

- It **surfaces** the intent. Good.
- It does **not** remove the inverted penalty. After the warning, the "legitimate" route (unlock, then `sticker`) is still the *more expensive* route for any single purchase (fact 2). You've nagged the player toward the dearer option.
- It does **nothing** for bundles, where unlocking buys a 0-AP price reduction for 7+ AP (fact 4). Gating a bundle behind an unlock that provides no discount is pure tax — the worst possible feel.
- Because it's a warning, it can be clicked through, so it doesn't even close the leak; it documents it.

So AC1 achieves *"make the requirement legible."* It does **not** achieve *"make the legitimate route the sensible route,"* which is the outcome the Verification section is really reaching for. If the goal is the latter, only the repricing family (AC4 / my AC5) gets there.

---

## 2. Which assumptions look shaky?

Taking the four "assumed, not verified" items in turn:

- **"The escalating unlock ladder is the mechanism that prices breadth, and dodging it is a leak."** — **Shaky.** §11 *explicitly blesses two routes* to a cross-class feature: unlock the class, or "skip the unlock and buy individual features at the cross-class surcharge (+Tier each)," and states plainly: *"the per-feature surcharge is cheaper for a single dip."* So per-feature cross-buying is, by the guide's own words, an **intended** route, not a leak. What's genuinely unintended is only that (a) it's cheaper than unlock even in bulk once you never intend to unlock, and (b) it never *counts* toward the ladder. The leak is the ladder's **non-accrual**, not the existence of the surcharge route. Framing the whole surcharge route as a "dodge" over-claims and would justify over-correcting.

- **"The `cross` price alone was intended to carry the whole cost of reaching outside your class."** — **Shaky, same root.** §11 clearly intends `cross` to carry the cost of a *one-off* reach, with the ladder carrying the cost of *breadth*. The two are meant to co-exist. The bug is that they don't compose (surcharge spend is wasted, not banked), so a breadth-buyer can live permanently on the "single dip" price.

- **"'Each class you can build from' was written as a precondition, not descriptive framing."** — **Well-supported, not shaky.** "…you can build from" is a restrictive relative clause; §11 also says "Every other subclass in that class is locked," and the 15-AP Subclass Unlock is described as "what stops cherry-picking" *within* a class. The whole subclass section reads as though the author assumed you'd only ever open subclasses inside a class you already have. Fact 1 ("nothing enforced this") is therefore an **implementation gap against a fairly clear precondition**, not a live ambiguity. This assumption is the safest of the four.

- **"Pre-launch, so no saved characters invalidated."** — **Low-risk and probably true**, but it's a project-state claim I can't verify. If any playtest characters exist that were built via the cheap route, tightening will silently change their legality/cost; worth a one-line confirmation.

**Net:** the two shaky assumptions share a single root — they treat the *surcharge route* as illegitimate when the guide treats it as legitimate-but-mis-composed. That reframing matters, because it points at "make the surcharge compose with the ladder" rather than "forbid the surcharge."

---

## 3. Is there a better alternative than AC1–AC4 — one that resolves the inverted penalty without a prohibition?

Yes. Two, addressing the two distinct root causes.

### AC5 — Access as a *credited* prerequisite (the general fix, for abilities)

Make the `cross` surcharge a **deposit toward the class unlock**, and make any class you've reached into **count toward the 7×n ladder**:

- The first time you buy a feature from a class you don't own, you pay `cross` (base + Tier) exactly as today — cheap single dips are preserved.
- That surcharge is **banked** against that class's unlock cost. Reach in again and your accrued surcharges credit toward the 7×n unlock; once they meet it, the class is unlocked and all further buys drop to `sticker`.
- Every class you've reached into **counts** for the escalating ladder (fact 5 closed).

Why this is the PACT-native answer:

- **Resolves the inversion (fact 2):** unlocking is never *dominated*, because nothing you spent on `cross` is wasted — it was always a prepayment. The legitimate route is now weakly optimal by construction.
- **Prices rather than forbids:** no warning is *required* and nothing is refused. This is squarely "pay the price, take the thing."
- **Kills the permanent dabbler (fact 7):** the three-foreign-spell-list Fighter now accrues toward three unlocks and eventually pays the breadth tax the ladder was designed to levy.
- **Fixes the same leak for ordinary class features**, not just subclasses — because the ladder dodge was never a subclass problem to begin with (see Q8).

Trade-off: it slightly complicates bookkeeping (a per-class "surcharge paid" counter). If that's unattractive, the blunter version is *"first reach-in auto-charges the current unlock and retires the `cross` tier"* — simpler, but it makes genuine single dips dearer, which throws away the §11 "single dip" affordance the author clearly valued. I prefer the credited version precisely because it keeps cheap dabbling cheap while making *breadth* pay.

### The bundle fix (spell access), for expanded spell lists — see Q5

AC5 does **not** help bundles, because unlocking saves nothing on a bundle (fact 4). Bundles need reclassification, not a ladder fix. That's a separate lever (Q5, Q8).

---

## 4. The core question: does gating fit or fight the spirit of point-buy?

**A hard prohibition fights it. A soft warning fits the letter but is toothless. The correct answer is neither — price the access.**

PACT does forbid *some* things, so "it always prices" is too strong a premise. But look at *what* it forbids: **identity and origin**, fixed at creation — dumps, drawbacks, origin class, origin race, cross-race Tier-2+ traits (Appendix B: "most higher-tier traits can't be bought cross-race at all"), Magically Bound's un-buy-off-able string. The dividing line PACT actually draws is:

> **Innate / birthright → locked. Acquirable capability → priced.**

Class sits deliberately on the *priced* side. §11 lets you unlock **any** class at **any** time for a cost, and even offers the per-feature surcharge as an alternative. There is nowhere in PACT that a *class boundary* hard-forbids a purchase. So a hard gate on cross-buying subclass pieces would be the **only** place a class line becomes a wall — importing heritage-logic into the one domain PACT chose to keep open. That's an internal inconsistency, and the species precedent *reinforces* the point rather than licensing the gate: PACT made heritage innate-and-locked and class acquired-and-open **on purpose**. Consistency argues *against* class gating.

The warning (AC1) is consistent with the *letter* — it's a prerequisite reminder, and §15 explicitly hands prerequisite/gating judgement to the DM ("warns rather than refuses, matching every other prerequisite"). But a warning that leaves the dearer route as the only legitimate route, and does nothing for bundles, satisfies the tone while missing the mechanism. The spirit of point-buy is "the price *is* the gate." Make the price right and no wall is needed.

---

## 5. Does "spell access is free of the class tax" extend to a subclass's expanded spell list?

**Yes — and I think this is the most important finding in the review.** A subclass expanded spell list is *spell access*, and §13 is unambiguous that spell access lives under the gentle spell economy, not the class tax:

> "Buying into a Discipline's spells never triggers the class economy… Nor does the +Tier feature surcharge ever touch a spellcasting purchase. Instead, the spell economy uses its own, gentler modifier: a flat ±1 AP per purchase… keyed to the class, not the Tradition."

Under that principle, a bundle from a class you haven't unlocked should cost **base + 1 (flat)**, cleared to base by unlocking (or −1 as origin) — **never base + Tier, and never the 7×n unlock.** That single reclassification dissolves fact 4 outright: unlocking a class now *does* help a bundle (it clears the +1, saving 1 AP each, exactly as §13 says it clears the un-unlocked surcharge on any Discipline). No sticker/cross mismatch, no "unlocking never pays off."

There *is* one real prerequisite, but it isn't class access — it's **spellcasting capability**. An expanded spell list is only usable if you have a Foundation (and Rank/slots) to cast it. So the fiction-correct, §13-native gate for a bundle is *"you have a Foundation for that Discipline,"* not *"you have unlocked that class."* A Foundation already exempts you from the class tax, so this threads §13 perfectly:

- **Bundle pricing:** origin −1 / unlocked base / un-unlocked +1 (flat), like every other spell purchase.
- **Bundle prerequisite:** a Foundation in the relevant Discipline (so you can actually cast it), *not* class access.
- **Result:** AC3's instinct ("drop the gate for bundles") is not merely defensible — §13 arguably *mandates* it, with the refinement that the current `cross`-Tier bundle pricing is itself the bug.

Caveat to verify with the owner: confirm that expanded-list spells are meant to behave as always-prepared additions cast from the character's own slots (2024 default). If any subclass bundle grants *free casting capacity* rather than just *list access*, that portion is a feature, not spell access, and would stay under §11.

---

## 6. What is missing from the document?

1. **The DM.** PACT is heavily DM-arbitrated (§15: "The DM's final say… may restrict, re-price, or gate any ability"). The brief frames this as a pure-engine question, but a non-blocking warning is *most* PACT-native precisely because it defers the edge case to the table. The doc should situate the choice against §15 — the warning may be the right *default* precisely because the DM is the real gate.
2. **A definition of "access."** Origin class, unlocked class, second origin class (14 AP, creation-only), or a Foundation (for bundles)? Fact 6 and the second-origin/Bound-discount rules all touch this and none are pinned down. The warning must not fire on a second origin class or on an unlocked class; confirm it doesn't.
3. **False-positive check against canon builds.** Appendix H ships five multiclass archetypes (Oathblade, Bladesinger, War Priest, Arcane Trickster, Stormsoul). Do any of them legitimately want a *cross* subclass ability or bundle? If so, the gate/tax inconveniences the book's own sample builds — a compatibility test the doc omits.
4. **Frequency/impact, not just AP delta.** "Cheap route wins by 4–58 AP" measures magnitude, not how often real players build this way or how much it warps table power. Prioritisation needs the second number.
5. **Interaction with the discounts that already touch access:** Magically Bound / Martially Bound (§14) and the origin-Discipline −1 (§11/§13). A bundle reclassified as spell access should compose with Magically Bound; the doc doesn't say whether it will.
6. **Two rules-text homes, one decision.** §11 (subclasses) and §13 (spell access) both govern this. The "Done when… the guide's wording matches the choice" line should require **both** sections to agree, and should say which is canonical for bundles (I'd say §13).
7. **Warning copy / UX.** If AC1 survives as a nudge, its text should *educate* — "you're reaching outside your class; the cheaper legitimate route is X" — not merely flag.

---

## 7. Is the Verification section objectively checkable?

**Half objective, half circular.**

- *Objective part:* "build both routes, compare total AP." The 4–58 AP differential is concrete and reproducible.
- *Circular part:* "…differ **in the direction the rules intend**." The intended direction is exactly the contested question (the shaky assumptions in Q2). You cannot verify against intent before intent is fixed, so as written the check **smuggles in its own conclusion** (that the legitimate route should be ≤ the cheap one).

Worse, the check is **coupled to which alternative wins**:

- Under **AC1 (gate)** it *degenerates* — remove the cheap route and only one route exists, so there's no A/B differential left to measure. The test becomes vacuous.
- Under **AC4 / AC5 (reprice)** it becomes meaningful — both routes still exist, and you verify the legitimate one is weakly cheaper.

So the Verification is well-formed only *after* a policy is chosen, and only *usefully* under the repricing family. Recommend restating it as: *"Given the chosen policy P, for the same set of abilities, no reachable build undercuts the P-legitimate cost by more than 0 AP,"* and generate the build pairs programmatically across tiers rather than citing a hand range.

---

## 8. Should this split into more than one decision?

**Yes — into three, only one of which is really a "gating" decision.**

- **D1 — Subclass *abilities* (non-spell features).** Root cause is the **ladder dodge (fact 5)**, which is a *general* cross-class-feature issue, not a subclass one. Fix with **AC5** (credited surcharge + ladder accrual). This also repairs the same leak for ordinary class features — so scoping it to subclasses under-treats it.
- **D2 — Subclass *expanded spell lists* (bundles).** Not a gating decision at all; a **classification decision** (Q5). Reclassify as §13 spell access (flat ±1, Foundation prerequisite). Low-risk; arguably a bug-fix rather than a policy change.
- **D3 — The warning itself (UX).** Keep AC1's warning as a *non-blocking educational nudge* regardless of D1/D2, because §15 wants the DM as the ultimate gate. This is orthogonal to the economics.

Bundling all three as "should subclass purchases be gated" mixes a general economy bug (D1), a spell-taxonomy fix (D2), and a UX affordance (D3) under one prohibition-shaped question — which is exactly why "gate: yes/no" felt like the frame and why every AC option is partly right and partly wrong.

---

## Recommendation

| # | Decision | Recommended resolution | Risk |
|---|---|---|---|
| D1 | Cross-class **abilities** (subclass *and* base) | **AC5** — `cross` surcharge banks toward the unlock; every reached-into class counts on the 7×n ladder. Prices breadth, keeps single dips cheap, no prohibition. | Moderate (adds a per-class counter); durable |
| D2 | Subclass **expanded spell lists** | Reclassify as §13 spell access: flat ±1, gated on a **Foundation**, not class access. Retire the `cross`-Tier bundle price. | Low; likely just corrects a misclassification |
| D3 | The warning | Keep AC1 as a **non-blocking** educational nudge that names the cheaper legitimate route; defer hard gating to the DM per §15. | Very low |

**Do not adopt a hard prohibition (the strong reading of AC1).** It's the one option inconsistent with PACT's own price-don't-forbid treatment of class, it leaves the inverted penalty intact, and it makes bundles feel worst of all.

Shallow vs deep, explicitly:
- **Shallow fix:** keep AC1's blocking warning as-is. Silences the symptom, changes no prices, leaves facts 4 and 5 live. Fine as a 5-minute hold, not as the answer.
- **Deep fix (recommended):** D1 + D2 above. Removes the root causes — the ladder that doesn't accrue, and spell access taxed as a feature — so the "cheap route vs legitimate route" gap closes by construction and no wall is needed. Low/moderate risk, durable, and it fixes the same leak for ordinary class features as a bonus.

**Done-when (revised):** owner picks a resolution for D1, D2, D3 independently; **both §11 and §13** are edited to agree, with §13 canonical for bundles; the Verification test is restated as a policy-relative, programmatically generated build-pair check; rules-version bumped once after D1/D2 land together.

---

## Suggested review-outcome row

| Reviewer | Date | Findings accepted | Rejected | Deferred |
|---|---|---|---|---|
| Copilot (Claude Opus 4.8) | 2026-08-17 | Split into D1/D2/D3; bundles are §13 spell access; ladder-accrual (AC5) over prohibition; Verification is circular as written | Hard-prohibition reading of AC1 | Whether to keep AC1 warning as UX nudge (owner + DM call) |
