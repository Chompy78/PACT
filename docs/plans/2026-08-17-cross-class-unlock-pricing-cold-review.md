# Cold review — PACT cross-class access and the class-unlock ladder

**Supersedes** the four reviews filed under `docs/plans/cold-reviews/2026-08-17-*-subclass-class-unlock-gating.md`.
Those answered a question built on a **false premise** (see *The corrected premise*). Do not read them first;
they will bias you toward a question the owner is no longer asking.

Reviewers have **no access to the codebase**. Everything needed is in this document.

---

## Goal

Decide how PACT should price **access to another class's abilities**, so that the owner's stated intent holds:

1. Abilities from other classes stay **reachable** — no hard prohibition.
2. Your **origin class** rewards staying thematically coherent.
3. Cross-class is **for a dabble** — a taste, not a second career.

The owner's proposal to test: **the current escalating unlock ladder is too punitive; replace it with a flat
cost, maybe 10 AP per class.**

---

## Context — the rules you need (self-contained)

PACT is a point-buy tabletop RPG system. Characters spend **AP** (Advancement Points) on everything: hit dice,
skills, spellcasting, class features, subclass abilities. There are no levels in the D&D sense; a character is
whatever their AP bought.

**Every purchase has a Tier (1–7)** reflecting its power. A Tier 5 ability is a bigger deal than a Tier 2 one.

**Every class-gated purchase has three prices:**

| Price | When it applies | Formula |
|---|---|---|
| **origin** | the purchase belongs to your origin class | cheapest |
| **sticker** | you have paid to *unlock* that class | `cross − Tier` |
| **cross-class** | you have done neither | `sticker + Tier` |

So **unlocking a class saves exactly its Tier in AP on every subsequent purchase from it.** Across the pool a
cross-class buyer actually reaches for (192 subclass abilities + 21 subclass spell-list bundles), the mean Tier
is **4.38**, median **4**. Unlocking therefore saves roughly 4 AP per purchase.

**The unlock ladder today.** Unlocking your Nth non-origin class costs **7N AP** — 7, then 14, then 21, then 28.
There are **12 classes**.

**§11 of the Players Guide, quoted verbatim** (this is the part that matters most):

> "Or you can **skip the unlock** and buy individual features at the cross-class surcharge (+Tier each)."
>
> "Unlocking pays off once you want several features from a class; **the per-feature surcharge is cheaper for a
> single dip.**"
>
> "This **mirrors how subclasses are bought**."

---

## The corrected premise — read this before anything else

A previous round of cold review was sent out on 17 August built on the claim that the cross-class per-feature
route was a **defect**: a "ladder dodge" and an "inverted penalty" that let players avoid the escalating unlock
cost. Four reviewers were asked whether to *gate* it — forbid buying another class's subclass abilities unless
you own that class.

**That framing was wrong.** §11 blesses the per-feature route explicitly, in the three lines quoted above. The
measured break-even (unlocking pays from ~3 purchases) *confirms* the guide's stated curve rather than exposing
a fault. Three of the four reviewers caught this; the error was the author's, not theirs.

A gate was nonetheless shipped as a ⛔ warning. It is **provisional and contested**, and it is also
**bypassable** — all 192 subclass abilities are mirrored into the general class-feature catalogue, and buying one
through that route raises no warning at all. So today the gate guards one of two doors.

**You are not being asked whether to gate.** You are being asked whether the *pricing* achieves the three
intents above, and if not, what pricing would.

---

## Assumptions vs. verified facts

**Verified** (measured against the live rules engine on 17 Aug 2026, engine rules version v0.350):

- Unlocking saves exactly `Tier` per subsequent purchase. Cross-class buy pool mean Tier **4.38**, median 4.
- The unlock ladder is 7N, with a cumulative table of only **5 entries for 12 classes**.
- **The ladder has a live bug.** Past the end of that table the engine reads a missing entry as **free**, so
  unlocking a **5th** class does not cost more — it *refunds* the 70 AP paid for the first four. With two origin
  classes the cliff arrives a rung earlier and the charge goes **negative**. This will be fixed regardless of
  this review's outcome; it is stated so you know the current table's shape is not load-bearing.
- All simulation figures below come from pricing **real builds made of real subclass abilities** through the
  actual engine, with candidate models swapped in as the cumulative table the engine already reads. There is no
  second pricing implementation that could disagree with the first.

**Assumed** (your judgement is wanted on these):

- That "a dabble" means **1–2 purchases** from a foreign class, and "an investment" means **3+**. This threshold
  is the owner's stated intent, not a measured fact.
- That players optimise. The simulator always picks the cheapest strategy available. Real players may not.
- That breadth *should* cost more than depth at all. The escalating ladder assumes so; a flat cost abandons it.

---

## The evidence

**Total build cost by archetype** (AP; the whole build, so these numbers *are* what breadth costs):

```
archetype       shape                               current 7N  flat 7  flat 10  flat 12  5N   10 then +4
one dab         one ability from one foreign class  14          14      14       14       14   14
two dabs        one from each of two                25          25      25       25       25   25
light dip       two from one class                  25          25      25       25       24   25
real dip        four from one class                 63          63      66       68       61   66
two-class main  six from one class                  94          94      97       99       92   97
scattered       one from each of four               47          47      47       47       47   47
generalist      three from each of three            137         129     138      142      133  140
magpie          one from each of six                72          72      72       72       72   72
```

**What the optimiser actually chooses:**

```
archetype       current 7N  flat 7    flat 10   flat 12   5N        10 then +4
one dab         dabble      dabble    dabble    dabble    dabble    dabble
two dabs        dabble      dabble    dabble    dabble    dabble    dabble
light dip       dabble      dabble    dabble    dabble    unlock 1  dabble
real dip        unlock 1    unlock 1  unlock 1  unlock 1  unlock 1  unlock 1
two-class main  unlock 1    unlock 1  unlock 1  unlock 1  unlock 1  unlock 1
scattered       dabble      dabble    dabble    dabble    dabble    dabble
generalist      unlock 1    unlock 3  unlock 2  unlock 1  unlock 2  unlock 1
magpie          dabble      dabble    dabble    dabble    dabble    dabble
```

**Break-even — purchases from one foreign class before unlocking it wins:**

```
model       1st class  2nd     3rd     4th
current 7N  3 buys     4 buys  5 buys  never
flat 7      3 buys     3 buys  3 buys  3 buys
flat 10     4 buys     3 buys  3 buys  3 buys
flat 12     4 buys     4 buys  3 buys  4 buys
5N          2 buys     3 buys  4 buys  never
10 then +4  4 buys     4 buys  never   never
```

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

**Round returned 18 Aug 2026. Three genuine reviews; a fourth file in the drop folder was a byte-identical
duplicate of the superseded round and was discarded.** Filed under `docs/plans/cold-reviews/2026-08-18-*`.

| Reviewer | Model verdict | Accrue the ladder? | Split the decision? |
|---|---|---|---|
| GPT-5.6 Luna | flat 10, subject to more measurement | **no** — re-creates 7N's flaw indirectly | yes, three ways |
| M365 Copilot | flat 10; **capped ladder** if a breadth tax is wanted | **no** — use the surcharge instead | yes, ship the cliff fix today |
| DeepSeek R1 | flat 10 1st, **7N capped at 28** 2nd | **no** — ranked last of four | yes, cliff fix is independent |

**Unanimous, unprompted, on the question deliberately excluded from the proposal: do NOT make the ladder
accrue.** Three independent reviewers reached it by three different arguments — it re-introduces the
escalation being removed; it taxes exploration; it makes the displayed unlock price path-dependent per
character, which is a real UI cost in the character generator. Copilot added the sharpest version: accrue
scales with **count = breadth** while the surcharge scales with **Tier = power**, so accrue taxes the wrong
axis. **That question is now settled in the negative.**

**Unanimous on sequencing:** the refund cliff is a defect, is independent of the pricing model, and should
ship on its own without waiting for the design call.

### Claims verified against the engine before acceptance

- **Copilot: "the mirror door may leak the surcharge entirely — verify, don't assume."** **Refuted.** Both
  routes charge identically: 11 AP locked, 15 AP unlocked (7 unlock + 8 sticker), for the same ability on
  the same character. The mirror differs only in raising no warning. Copilot correctly flagged that this
  would have mooted every number here if true; it isn't.
- **DeepSeek: "the 21 spell bundles are not in the simulation."** **Confirmed** — the archetypes used
  subclass abilities only. **Impact measured as nil:** break-even is identical for bundles and abilities at
  every price tested (3/3 at flat 7, 4/4 at flat 10, 3/3 at 7N), because the unlock decision turns on
  cumulative Tier saved and bundles sit close enough to the pool mean not to move it.
- **All three: the verification section's "3-ish uniform figure" is not objectively checkable.**
  **Accepted** — it needs to name an exact expected break-even vector with zero tolerance.
- **Luna and Copilot: the "1–2 dabble / 3+ invest" line is Tier-blind.** **Accepted as a real gap.** Two
  Tier-7 purchases are a larger power grab than four Tier-2 ones, yet the count-based rule reads both as
  the same shape. Not yet measured.

### Contested, and therefore NOT settled here

**Flat 10 versus flat 7.** All three reviewers rank flat 10 first. A separate direction file in the same
drop folder instructs flat 7 instead, on the grounds that its uniform 3/3/3/3 break-even matches the stated
boundary exactly where flat 10's 4/3/3/3 does not. Luna's own text concedes the point in passing — flat 10's
real rule is "around three purchases", not exactly three. **This is the owner's call and is deliberately
left open.** Note the reviewers were shown flat 10 as the proposal, so their agreement is partly an
artifact of anchoring — which is exactly the risk raised before the round was sent.

**A capped ladder was proposed independently by two reviewers and was NOT on the original menu.** Copilot's
D2 (7N clamped at 14) and DeepSeek's Option B (7N capped at 28) are the same idea: keep escalation, remove
the "never". It is the only candidate that preserves a breadth tax while fixing reachability, and it
deserves a place in the decision that the original document did not give it.
