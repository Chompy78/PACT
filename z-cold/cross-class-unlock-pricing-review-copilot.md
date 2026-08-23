Microsoft Copilot — settings: single-pass cold review, no codebase access, judging logic/clarity/scope/risk only.

# Review + alternatives — PACT cross-class unlock pricing

> Handoff note for the coding AI: this file contains (a) the full cold-review answering the brief's six questions, and (b) a follow-up "if not flat 10" alternatives analysis. The recommendation set uses the owner's A/B/C/D lettering convention. Canon decisions from the brief (no gate; origin discount untouched; cliff/refund bug fixed regardless) are preserved.

---

## 0. Is this framing also wrong? (answered first, as instructed)

Not wrong the way the last round was — the reframe from **gate** to **pricing** is honest and correct. But it carries a **residual false premise** the owner should hear before adopting anything.

The document bundles two different problems under one review:

- **P1 — Reachability.** The escalating 7N ladder makes the 3rd unlock need 5 buys to pay off and the 4th *never* pays off. This is a genuine defect and "punitive" is fair.
- **P2 — The permanent dabbler (magpie).** The owner's stated biggest worry: someone who takes one ability from six classes and never invests.

The proposal solves **P1 completely** and **P2 not at all** — the document says so. The residual premise is the claim underneath P2: that the magpie **escapes a breadth tax**. It does not.

**The magpie already pays a breadth tax — via the +Tier surcharge, not the ladder.** It pays `+Tier` on all six un-unlocked purchases (72 AP total) and never amortises any of it through an unlock. The system already taxes breadth two ways: the **surcharge** taxes dabblers, the **ladder** taxes investors. So "changing the unlock price does nothing to the magpie" is true, but the implied conclusion — "therefore the magpie is untaxed and we need a new lever" — is false. The magpie is taxed by the surcharge, which the review has placed **out of scope**.

Net: by scoping out the surcharge *and* choosing a flat unlock model, the review has structurally excluded the only two tools that touch the case the owner named as their top concern — while the evidence already shows one of those tools (the surcharge) is doing the work. **Decide whether P2 is even a problem before spending design effort on it.**

---

## 1. Does the proposal achieve the three stated intents?

**Verdict: yes on all three, but for reasons partly independent of the unlock price.**

- **Reachable (no hard prohibition).** ✓ Trivially. Flat 10 keeps every class buyable and, unlike 7N, keeps the 6th unlock as reachable as the 1st. This is the proposal's real win.

- **Origin rewards thematic coherence.** ✓ — but **not because of the unlock price.** Coherence is enforced by the `origin < sticker` gap: even after you unlock a class, its purchases price at *sticker* (`cross − Tier`), still dearer than your origin's price. That gap is untouched and out of scope. So intent #2 is safe under **any** unlock model; moving 7N → flat 10 doesn't affect it. Worth stating plainly so the owner doesn't credit (or blame) the unlock price for home-class feel.

- **Cross-class is a dabble, not a career.** ✓ Under flat 10, 1–2 buys from a foreign class stay cheaper via per-feature (break-even 4/3/3/3). Note flat 10 makes the **first** unlock need 4 buys vs 7N's 3 — i.e. slightly *more* attractive to dabble first than today, which is aligned with intent, not against it.

**One caveat.** "Does a dabble stay a dabble" is answered in **purchase counts**, but a dabble of two Tier-6 abilities is a bigger power grab than four Tier-2 abilities. The intent is being measured breadth-wise while power lives in Tier. See §2.

---

## 2. Which assumption is shakiest?

The document nominates the **"1–2 dabble / 3+ invest"** threshold. Reasonable as a *design* line and I wouldn't relitigate it — but it's not the shakiest thing here.

**Shakiest: "players optimise / the simulator picks the cheapest strategy."** The entire evidence base is optimal-play. If players don't compute break-evens (most won't), the unlock price is a **psychology/UX** question, not an optimisation one, and the archetype-cost tables describe *optimal* behaviour, not *actual* behaviour.

**Second-shakiest: the threshold is Tier-blind.** "1–2 = dabble" counts purchases and ignores that the pool's mean Tier is 4.38 with real spread. A two-buy dabble of high-Tier abilities may be exactly the "second career via the back door" the owner wants to prevent, yet reads as a dabble under the count-based line. If the owner cares about power creep rather than breadth per se, the threshold should be AP- or Tier-weighted, not a raw count.

---

## 3. Is there a better alternative? (the accrue question)

**No — keep accrue out, and prefer the surcharge if P2 turns out to be real.**

The **accrue** mechanism (dabbling counts toward later unlock cost) is correctly identified as the only lever that touches the magpie. But it should **not** go in this proposal:

- It **re-introduces escalation** — the exact property the owner is removing — just triggered by dabbling instead of unlocking.
- It **punishes exploration**, discouraging the low-commitment sampling that cross-class is meant to enable.
- It makes the displayed unlock price **path-dependent** (stateful per character), a real UI/comprehensibility cost — the char-gen shows a per-class unlock cost, and that number would now depend on dabble history.

If P2 is judged a genuine problem, the better lever is the **+Tier surcharge** (currently out of scope): it scales with **Tier = power**, whereas accrue scales with **count = breadth** and taxes the wrong axis. Raising or curving the surcharge taxes exactly the "cheap high-power dip" the owner fears without penalising harmless low-Tier sampling.

---

## 4. What's missing?

1. **Total AP budget of a representative build.** Builds span 14–142 AP, but without a typical total we can't judge whether **10 AP is "a dabble tax" or "a career tax."** Most important missing number.
2. **The distribution of *real/intended* builds**, not eight hand-picked archetypes. If nobody builds the "generalist," its 129–142 range is moot; if half the table builds "magpie," P2 dominates.
3. **The mirror-door pricing.** All 192 subclass abilities are duplicated into the general class-feature catalogue and buying them there "raises no warning." Does that route still charge cross-class / +Tier, or does it **leak the surcharge entirely?** If it leaks, the whole scheme (and the P2 argument) is moot before tuning a single number. Verify, don't assume.
4. **Tier sensitivity.** Every break-even rests on mean Tier 4.38. How do 4/3/3/3 figures move for a player targeting only Tier 6–7 abilities?
5. **The origin-discount magnitude.** Out of scope but load-bearing for intent #2. Can't fully answer "does origin feel like home" without knowing how big `origin < sticker` actually is.

---

## 5. Is the verification section objectively checkable?

**Mostly yes, one soft spot.**

- ✓ "Parity gate reports 0 failed," "guide-vs-engine checker reports 0 mismatches," "refund cliff gone" — objectively checkable by a third party.
- ✗ "The break-even table shows the intended **3-ish uniform** figure" is **not** objectively checkable. "3-ish" has no pass/fail boundary. Fix by stating the **exact expected break-even vector** (e.g. "1st/2nd/3rd/4th = 4/3/3/3, tolerance 0").
- Add an explicit check for #3: a fixture proving the **mirror-door route charges identically** to the primary picker.

---

## 6. Should this split into multiple decisions?

**Yes — split into three, ship one today.**

- **Now (ship regardless):** extend the cumulative table to 12 rungs, replace the missing-entry fallback with a **clamp**, kill the refund cliff. Unambiguous bug; shouldn't wait on a design debate.
- **Next (design call):** flat 10 vs flat 7 vs 5N vs capped ladder. Low-risk, pre-launch; fixtures move but no live characters.
- **Later (only if P2 is real):** the magpie / surcharge question, gated on the missing data in §4 (AP budget + mirror-door leak check).

---

## 7. If NOT flat 10 — alternatives analysis

The real fork: **do you want a breadth tax at all?**
- If **no** (origin discount is enough) → **flat 7** (D1).
- If **yes** (breadth *should* cost) → **capped ladder** (D2) — the genuinely different option the brief's menu didn't offer.

**D1 — Flat 7.** Break-even **3/3/3/3**, perfectly uniform — tightest fit to "1–2 dabble, 3+ invest." Trade-off: investing becomes so cheap a dabble nearly loses its reason to exist; surcharge route only wins for 1–2 buys. Deep fix for reachability, but flattens the dabble/invest distinction.

**D2 — Capped ladder (recommended if keeping a breadth tax).** Keep escalation but **cap it** — e.g. 7N clamped at 14 (7, 14, 14, 14…). Keeps early breadth costing more while killing 7N's fatal flaw (3rd+ unlock reachable instead of *never*). Trade-off: fuzzier break-even than a flat model, one more magic number (the cap). **Deep fix** — removes the root problem without abandoning the design philosophy the way flat models do.

**D3 — Accrue.** Only lever touching the magpie, but re-introduces escalation, taxes exploration, path-dependent UI. Keep out; tune the **+Tier surcharge** instead if the magpie is the real concern.

**D4 — Keep 7N, fix only the cliff (shallow).** Silences the refund bug, nothing else. Cheapest; leaves 3rd+ unlocks unreachable — does **not** fix "punitive." Only pick if reachability isn't actually a problem.

**Not worth it:** flat 12 (4/4/3/4 — fuzzier, no upside over 10) and "10 then +4" (reproduces 7N's "never" from the 3rd class — worst of both worlds).

---

## Bottom line (decision summary)

- **A — Unlock model:** adopt **flat 10 (A1)** as the safe deep fix; if moving off it, choose on the breadth-tax question below.
- **B — Magpie/breadth:** **do nothing to unlock pricing (B1)**; the surcharge already taxes the dabbler. Use the **surcharge**, not accrue, if P2 proves real.
- **C — Sequencing:** **split (C1)** — cliff/refund fix now, model next, magpie later.
- **D — If not flat 10:** the fork is **flat 7 (D1)** = drop the breadth tax, vs **capped ladder (D2)** = keep it but make it reachable. D2 is the recommended "something else."
- **Flag before closing:** confirm the **mirror door doesn't leak the surcharge** before trusting any of these numbers.
