
**Three findings the owner did not expect:**

1. **The permanent dabbler is immune to unlock pricing.** The "magpie" — one ability from each of six classes —
   costs **72 AP under every model** and always chooses to dabble. Changing the unlock price does nothing to the
   case the owner is most worried about, because a permanent dabbler never buys an unlock.
2. **The current ladder does not make later unlocks expensive — it makes them unreachable.** Under 7N the 3rd
   unlock needs 5 purchases from that class to pay for itself, and the 4th **never** does (tested to 12
   purchases). That is the concrete sense in which "punitive" is true.
3. **Total costs barely move between models** — the generalist ranges 129–142 across all six. This is a change
   to *which strategy is optimal*, not a rebalance of what anything costs.

---

## Proposed approach

1. **Replace the escalating ladder with a flat cost per unlocked class.** Working proposal: **10 AP**.
   Break-even lands at 4/3/3/3 purchases — close to the stated "1–2 dabble, 3+ invest" line and, unlike 7N,
   *uniform*, so the 6th class is as reachable as the 1st.
2. **Extend the cumulative table to 12 rungs and replace the missing-entry fallback with a clamp**, so the
   refund cliff cannot recur. (A flat model makes the table trivial but the clamp is still wanted.)
3. **Do not gate cross-class purchases.** §11 blesses the route; remove the provisional ⛔ warning.
4. **Leave the origin discount untouched.** It is what rewards thematic coherence, and no evidence here
   suggests it is mispriced.
5. Update §11's prose and the engine together, and bump the rules version.

## Documents and components involved

- The rules engine's class-access pricing block and its cumulative unlock table.
- The Players Guide's §11 prose and its class-access table.
- The engine's fixture/expected-output test set (any fixture combining an unlocked class with cross-class
  purchases moves).
- The character-generator UI, which displays the unlock cost per class.

## Out of scope

- Whether to gate cross-class purchases (settled: no).
- The pricing of the three tiers themselves (origin / sticker / cross-class), and the +Tier surcharge formula.
- The duplicate-purchase bug where the same ability can be bought through two different pickers and charged
  twice. Tracked separately.
- Spell-economy pricing (Foundations, Ranks, slots, spells known), which §13 exempts from the class tax.

## Alternatives considered

- **Flat 7** — break-even a uniform 3 buys, the cleanest match to intent, but makes the first unlock cheaper
  than today and may make dabbling pointless.
- **Flat 12** — 4/4/3/4; preserves more of a breadth cost, at the price of a fuzzier line.
- **5N** — keeps escalation but gentler; still hits "never" at the 4th class.
- **10 then +4** — a compromise that in practice reproduces 7N's worst property ("never" from the 3rd class on).
- **Keep 7N, fix only the cliff.** Cheapest change; leaves the 3rd-and-beyond unlock unreachable.
- **Make the ladder accrue** — count classes you *dabble in* toward the ladder, so dabbling raises the price of
  later unlocks. This is the only candidate that touches the magpie, and it is *not* in the proposal above. The
  owner should hear whether you think it belongs there.

## Risks

- A flat cost **abandons the breadth tax entirely**. Unlocking all 11 non-origin classes would cost 110 AP flat
  versus an escalating cost that today is unbounded in principle. Is a "knows every class" character something
  the system should price against, or is the origin discount enough?
- **The magpie problem survives every proposal here.** If the owner's real concern is the permanent dabbler, none
  of these models addresses it and the review should say so plainly.
- Changing unlock pricing changes existing characters' costs. PACT is pre-launch, so no live characters are at
  risk, but the test fixtures move.

## Verification

- The rules engine's parity gate must report **0 failed** after the change, with expected outputs updated in the
  same change and the rules version bumped.
- The simulator above is re-run and the break-even table shows the intended 3-ish uniform figure.
- A guide-vs-engine price checker must report 0 mismatches, proving §11's prose and the engine agree.

## Done when

Engine and guide state the same unlock cost; break-even sits at the intended threshold at **every** rung, not
just the first; the refund cliff is gone; and the provisional cross-class warning is removed.

---

## Reviewer instructions

**Begin your response with your model name and any relevant settings**, on the first line.

Judge **logic, clarity, scope and risk** — not code correctness, which you cannot verify from this text.

Answer these, in order:

1. **Does the proposal achieve the three stated intents?** Specifically: does a flat 10 AP unlock keep a dabble
   a dabble, and does it still make the origin class feel like home?
2. **Which assumption is shakiest?** The "1–2 dabble / 3+ invest" threshold is the owner's, not measured — is it
   the right line?
3. **Is there a better alternative?** In particular: should the ladder *accrue* — i.e. should dabbling in a class
   count toward the cost of later unlocks? That is the only lever identified that touches the magpie case, and
   it was deliberately left out of the proposal.
4. **What's missing?** What would you want measured that this simulation does not show?
5. **Is the verification section objectively checkable** by someone who did not write it?
6. **Should this split into multiple decisions** — e.g. fix the cliff now, decide the model later?

One more, specific to this document: **the previous review round was built on a false premise and wasted four
reviewers' time.** If you think *this* framing is also wrong — that the real problem is somewhere else entirely —
say so first and answer the rest afterwards.

Output your response as a Markdown file named
`cross-class-unlock-pricing-review-<your-model-name>.md`.

---

## Review outcome

*(to be filled in after the round returns — one line per reviewer, then the triage decisions)*

---

## 2. First Review Response (DeepSeek R1 – approving flat 10)

**DeepSeek R1** (default settings, no additional configuration)

## Review of PACT cross-class unlock pricing proposal

### 1. Does the proposal achieve the three stated intents?

Yes, the flat 10 AP unlock cost aligns with the stated intents significantly better than the current escalating ladder.

- **Reachable** – A flat 10 AP per class makes all 11 non‑origin unlocks equally accessible in principle; the “never” break‑even for the 4th class disappears. This removes the de facto hard cap that 7N imposed.
- **Origin class feels like home** – The origin discount remains untouched. A character who stays within their origin class pays the cheapest price forever, so thematic coherence is still rewarded.
- **Cross‑class as a dabble** – The break‑even table for flat 10 shows that unlocking is worthwhile only after 3–4 purchases from that foreign class. Since “dabble” is defined as 1–2 purchases, a player who wants just a taste will always choose the per‑feature surcharge (no unlock). That cleanly matches the 1‑2 / 3+ threshold. The flat cost does not force unlocks; it merely makes the decision uniform and predictable.

The proposal also correctly removes the provisional gate, which was inconsistent with §11 and with the whole dabble‑vs‑invest philosophy.

### 2. Which assumption is shakiest?

The assumption that **“dabble” means 1–2 purchases and “investment” means 3+** is reasonable given the average Tier of 4.38, but it is a _global_ threshold that doesn’t account for Tier‑specific variance.

- A single Tier 7 ability is a much bigger “taste” than two Tier 2 abilities. The break‑even for unlocking is actually driven by the _sum_ of Tier savings, not by the count of purchases. For a class with unusually low‑Tier abilities, you might need 4‑5 purchases to recoup a 10 AP unlock; for a high‑Tier class, 2 might suffice.
- The owner’s intent is stated in terms of number of features, but the pricing mechanism already uses Tier to adjust cost. The threshold could be more accurately expressed in terms of _total AP saved_ rather than number of picks. I’d recommend that the guide’s language avoid a rigid “1–2 / 3+” numeric rule and instead describe the economic incentive: “Unlocking pays for itself once you want enough from that class that the sum of Tier surcharges exceeds the unlock cost.”

That said, the 1–2 / 3+ heuristic is a useful shorthand and the flat 10 model places the break‑even right at that boundary for average Tier, so the assumption is not dangerously shaky.

### 3. Is there a better alternative?

The proposal’s flat 10 is the best among the considered alternatives. It is simple, predictable, and matches the intended break‑even. The escalating models (7N, 5N, 10+4) all retain a “never” break‑even for later unlocks, which contradicts “reachable”. Flat 7 makes unlocking too attractive even for 2‑pick dips (break‑even at 3), blurring the dabble/invest line. Flat 12 shifts the line slightly higher but is less clean.

**The ladder‑accrual idea** (counting dabbled classes toward the unlock ladder) is the only lever that affects the “magpie” permanent dabbler. However, I do **not** recommend including it in the current proposal for two reasons:

1. It would penalise _dabbling_ itself by making later dabbling more expensive, contradicting the stated “taste, not second career” – if every taste increases the cost of future tastes, then breadth becomes disincentivised even when each individual taste is shallow.
2. The magpie case is not demonstrated to be a balance problem. The simulation shows it costs 72 AP regardless of unlock pricing, but we don’t know whether 72 AP is too low relative to a focused build. If the owner is genuinely worried about magpies, the solution should be based on actual play data or a separate analysis of overall AP budgets, not on a pricing change that affects all cross‑class interactions.

If the magpie _is_ proven to be over‑effective later, a targeted tax on the number of distinct classes accessed (e.g., a surcharge on the 4th+ dabbled class) would be more precise than an accruing unlock ladder. But that is a separate decision, not needed now.

### 4. What’s missing?

Several things would strengthen the evidence and inform the final choice:

- **Typical total AP budgets** – The simulation shows absolute build costs, but we don’t know what a “normal” character spends. Is 72 AP for a magpie a large or small fraction of the total? Without context, we cannot judge whether the magpie cost is too cheap.
- **Distribution of Tier across classes** – The break‑even table uses the global mean. For each class, the average Tier may vary; if some classes have mostly low‑Tier abilities, the break‑even for unlocking them could be higher than 3‑4, making flat 10 less consistent.
- **Origin discount usage** – The proposal assumes the origin discount is correctly priced, but we haven’t seen data on how often players choose origin vs. cross‑class features. A measurement of actual build choices (even from playtests) would validate whether the discount is strong enough to keep class identity.
- **Spell‑list bundles** – The 21 subclass spell‑list bundles are mentioned but not included in the simulation. Are they priced the same way? If they have different Tier distributions, the break‑even could shift.
- **Player behaviour** – The simulator assumes optimal cost‑minimising behaviour. Real players may unlock for convenience or flavour, or may avoid unlocks because they don’t do the math. That is a risk, but not fatal.

### 5. Is the verification section objectively checkable?

Yes, the verification steps are well‑defined and objective:

- “Parity gate must report 0 failed” is a clear pass/fail criterion.
- “Simulator re‑run and break‑even table shows the intended 3‑ish uniform figure” – as long as the intended figure is specified (e.g., break‑even at 3‑4 for all classes), this is checkable.
- “Guide‑vs‑engine price checker reports 0 mismatches” is a concrete consistency test.

These are sufficient for an engineer to verify. The only potential ambiguity is the exact “intended 3‑ish uniform figure” – it should be codified in a test assertion, not left as a subjective interpretation.

### 6. Should this split into multiple decisions?

**Yes, partially.**

- The bug fix (clamping the cumulative table to 12 rungs and removing the refund cliff) is **completely independent** of the pricing model and should be implemented immediately. It is a pure defect fix.
- The removal of the provisional gate is also independent and should be done (since it was never meant to be permanent and is bypassable).
- The choice of flat 10 vs. another model can be decided in parallel, but it’s reasonable to bundle it with the above to avoid multiple rule‑version bumps.

I would recommend splitting the engineering fixes into a separate quick change (clamp + gate removal) and then apply the flat 10 pricing as the policy decision. That way, if the flat 10 decision needs more debate, the cliff is already fixed.

---

### Final assessment

The proposal is **logically sound, clearly scoped, and addresses the core problem** – the escalating ladder made later unlocks unreachable, and a flat 10 AP cost restores uniformity and aligns with the intended 1‑2/3+ threshold. It abandons the breadth tax, but that is an acceptable trade‑off because the origin discount and the per‑feature surcharge already create a strong incentive to stay coherent.

The only significant unresolved concern is the magpie, and the proposal honestly acknowledges that. I recommend adopting flat 10, but with a commitment to monitor magpie builds after launch and consider a separate breadth tax only if they become dominant. The review should not be delayed for that.

**Recommendation:**  
Approve the proposal as written, with the addition that the verification section should explicitly test break‑even for _each_ class (or at least for a representative set) to ensure the flat 10 threshold holds across the Tier distribution. Fix the cliff and remove the gate as part of the same change.

---

## 3. Follow‑up Response – Alternatives to Flat 10

**DeepSeek R1** (default settings)

You asked: *what about not using the flat 10 and doing something else?*

Below I lay out the full alternative space – **not just the flat costs already tabled** – and evaluate each against the three intents. I also separate *pricing models* from *structural levers* because the magpie case requires a different kind of fix.

---

## Alternative families (beyond flat 10)

### A. Other flat costs (7, 12, 15, etc.)

| Model | Break‑even (avg Tier 4) | Pros | Cons |
|-------|-------------------------|------|------|
| Flat 7 | 3 buys (uniform) | Makes unlocking slightly more attractive; still clean | First unlock cheaper than today – may encourage unnecessary unlocks for 2‑pick dips (break‑even at 3, but if you *think* you might buy 3, you’ll unlock early) |
| Flat 12 | 4/4/3/4 | Keeps a slightly higher breadth tax | Fuzzier line; for low‑Tier classes break‑even can be 5+ |
| Flat 15 | 5 buys | “Investment” becomes 5+; dabble is safe | Unlocking becomes a real commitment – but for high‑Tier classes (Tier 6‑7) break‑even is still 3, so it’s inconsistent |

**Verdict on flat costs:** flat 10 sits in the middle. Flat 7 tilts too far toward unlock; flat 12 is acceptable but less crisp. The document already covers these well.

---

### B. Escalating with a cap (not “never”)

Instead of 7N unbounded, use **7N capped at some maximum** – e.g., 7, 14, 21, 28, 35, 35, 35… or 7, 14, 21, 28, 28, 28…

| Model | Behaviour | Why it’s different |
|-------|-----------|-------------------|
| 7N capped at 28 | 1st=7, 2nd=14, 3rd=21, 4th+=28 | Later unlocks become reachable (break‑even for 4th class: 28/4=7 buys, which is high but not “never”). Still punishes breadth more than flat 10. |
| 7N with diminishing increments (e.g., +7, +5, +3, +3…) | Soft ceiling | Keeps the escalation flavour but avoids the cliff. |

**Pros:** Retains the *principle* that breadth should cost more than depth – a tax on being a “know‑it‑all”.  
**Cons:** Break‑even still varies by class order; later classes require more investment to justify unlock, which contradicts “reachable” for the 6th class if the cap is high.  
**My take:** A cap is a compromise. If the owner insists on a breadth tax, this is better than unbounded 7N, but it’s more complex than flat 10 and still doesn’t solve the magpie (who never unlocks).

---

### C. Unlock cost based on *Tier* of the class (not flat)

Instead of a uniform unlock cost, set unlock = **sum of Tiers of all abilities you buy from that class** (i.e., a discounted bulk rate) – or a fixed cost that varies by class’s average Tier.

Example: unlock cost = **class’s average ability Tier × 2**. A high‑Tier class (avg 5.5) costs 11; a low‑Tier (avg 3.5) costs 7.

**Pros:** More granular; aligns unlock cost with the value you’re unlocking. If a class has mostly low‑Tier abilities, the surcharge is small anyway, so paying a lower unlock makes sense.  
**Cons:** Adds complexity; players need to look up class averages; break‑even isn’t uniform across classes, making the “dabble/invest” line fuzzy. Also, the simulation didn’t test this, so we have no data.

**My take:** Over‑engineered. The existing per‑purchase surcharge already uses Tier, so the unlock cost doesn’t need to duplicate that – it’s a fixed hurdle.

---

### D. Remove unlocks entirely – only origin discount and cross‑class surcharge

This is the most radical alternative: **no unlock ladder at all**. Every non‑origin purchase always pays the cross‑class surcharge (+Tier). No sticker price.

**Break‑even:** none – you never save AP by unlocking.  
**Impact on intents:**
- Reachable? Yes, trivially.
- Origin feels like home? Yes, still cheaper.
- Dabble? Yes, dabbling costs exactly what it does today (no unlock needed).

**Pros:** Simplest possible rule; no ladder to maintain; matches §11’s “skip the unlock” route as the *only* route.  
**Cons:** Loses the strategic choice of “invest in a class to reduce future costs”. The guide’s §11 currently frames unlock as a trade‑off – removing that removes a meaningful decision point. Also, players who want 4+ abilities from a foreign class are penalised every time, which may feel bad (no bulk discount).

**My take:** This is a coherent alternative, but it abandons the “second career” possibility. The owner explicitly said cross‑class is for a dabble, not a second career – so this might actually *fit* that intent perfectly. However, the guide already promises unlock as an option, and removing it would be a bigger change than flat 10. I’d keep unlock for flexibility.

---

### E. Ladder accrual (the magpie lever) – two flavours

This was mentioned in the proposal. Let me flesh it out:

**Flavour E1 – Dabbling counts toward unlock ladder:**  
Every class you make at least one cross‑class purchase from (without unlocking) increments a counter. Unlocking your 2nd non‑origin class costs 7×2 = 14, but if you dabbled in 3 other classes first, that counter is 4, so unlocking the 5th class costs 7×5 = 35 – even if you never unlocked those dabbles.

**Effect on magpie:** The permanent dabbler who takes one ability from six classes would pay the cross‑class surcharge for each (no unlock), but their *dabble count* would raise the cost of any future unlock they might attempt. If they never unlock, it doesn’t affect them – so **E1 does not affect the magpie** who never unlocks.

**Flavour E2 – Each dabble after the first incurs a surcharge:**  
A separate tax on breadth: your 3rd, 4th, etc., distinct class you dabble in costs an extra `N` AP per ability (e.g., +2 AP per distinct class beyond 2). This directly targets the magpie without touching unlocks.

**Effect:** Magpie cost goes from 72 to 72 + (extra surcharges) – e.g., 6 classes × avg Tier 4 = 24 base surcharge; if you add +2 per class beyond 2, that’s +8 AP, total 80. Still small.

**My take:** Ladder accrual (E1) is a red herring – it punishes dabblers who later want to invest, which is a narrow case. E2 is a more direct tax but adds complexity and moves away from the simple “per‑purchase surcharge” model. Neither is better than flat 10 unless the magpie is proven to be a balance problem. I would not adopt E1; I’d consider E2 only after collecting playtest data.

---

### F. Unlock cost as a percentage of total AP spent so far

e.g., unlock costs **10% of your total AP** (rounded up). A high‑level character pays more to unlock a new class than a low‑level one.

**Pros:** Scales with character progression; later unlocks are more expensive but not unreachable (since total AP grows).  
**Cons:** Extremely complex; players can’t plan easily; break‑even depends on when you unlock; introduces per‑character variance; not tested.

**My take:** Reject – too opaque and untested.

---

### G. Subscription / rental model

Instead of a permanent unlock, pay a **per‑adventure or per‑session fee** to access a class’s abilities. Not a point‑buy cost – a meta‑currency.

**Pros:** Could solve the magpie (they pay each time they use any foreign ability).  
**Cons:** Fundamentally changes the resource economy; out of scope for this pricing review.

---

## Which alternative would I pick over flat 10?

If I were forced to reject flat 10, I would choose **Option B – 7N with a cap** (say, max 28 or 35 AP per unlock).

**Why:**  
- It preserves the *intent* that breadth should cost more than depth – a principle the owner explicitly stated (“breadth should cost more than depth at all”). Flat 10 abandons that principle entirely.
- The cap ensures that later unlocks are *reachable* – break‑even for the 4th class at 28 AP means you need 7 purchases (avg Tier 4) to recoup, which is high but not impossible for a true generalist.
- It requires minimal change to the existing 7N ladder – just extend the table with a clamp.
- It addresses the owner’s unspoken fear that a “knows every class” character should pay *some* escalating price, even if not unbounded.

**Drawback:** Break‑even for the 4th class is 7 purchases – that’s more than “3+ invest”, so it shifts the dabble/invest line for later classes. If the owner insists that *every* unlock should pay off after 3‑4 purchases, then flat 10 is better.

---

## What about a completely different structural change?

The document’s proposal assumes the unlock ladder is the only knob. But another lever is: **make the cross‑class surcharge itself steeper** (e.g., +2×Tier instead of +1×Tier) and reduce the unlock cost. That would make dabbling more expensive and unlocking more attractive – but the owner wants dabbling to be cheap, so that’s backwards.

Alternatively, **make the origin discount larger** (e.g., origin price = Tier×0.5 instead of Tier×0.75 – the formula isn’t given in detail, but the document says origin is “cheapest”). That would strengthen class identity without touching unlocks. But the document explicitly says origin discount is not under review.

---

## Summary recommendation

| Model | My rank | Reasoning |
|-------|---------|-----------|
| Flat 10 | **1st** | Clean, uniform, matches break‑even exactly, simple to explain. |
| 7N with cap (max 28) | **2nd** | Preserves breadth tax, fixes the cliff, but makes later unlocks require deeper investment. |
| Remove unlock entirely | **3rd** | Simplest, but removes strategic choice – would require guide rewrite. |
| Ladder accrual | **4th** | Doesn’t solve magpie, adds complexity, penalises future investment. |

**Final answer to your question:**

If you don't use flat 10, I would advocate for **a capped escalating ladder (7, 14, 21, 28, 28, ...)** as the best “something else”. It keeps the owner’s breadth‑tax philosophy alive, makes all unlocks reachable, and requires only a small tweak to the existing table. However, it does *not* achieve the “uniform 3‑4 break‑even at every rung” that flat 10 does – so you trade philosophical consistency for practical reachability. If the owner values the 3‑4 break‑even more than the breadth tax, stick with flat 10. If they value the breadth tax more, pick the capped escalation.

The one alternative I strongly **reject** is any form of ladder accrual – it’s a solution in search of a problem and doesn’t touch the magpie, which is the only unaddressed case.

---

## End of conversation

This Markdown file contains the complete review exchange. Use it as the source of truth for implementing the chosen pricing model (flat 10 is recommended, with a fallback to capped 7N if the breadth tax is non‑negotiable). The cliff fix and gate removal are independent and should be done in any case.