# Cold Review — Premium Auto-growth → Stepped Pricing

**Reviewer model:** Microsoft Copilot (Claude Opus 4.8)
**Settings/constraints:** No access to the codebase, the design-decision record, the finalized AP tables, or any other project file. Everything below is judged purely from the plan text as written. Where the plan says "full tables below," no tables were actually present in the material supplied to me — see G3.

---

## Bottom line (upfront)

The plan is unusually honest and well-structured — it cites a real precedent, flags its own highest-risk file, and separates verified from assumed better than most. But it has **one load-bearing gap that could sink the stated goal** (does buying a step actually *gate* the mechanical benefit, or is this purely an AP-budget/label change?), and **one "Verified" claim that is an assumption in disguise** (the 50%-of-lookup relationship generalised from a single hand-check). Fix those two and it's implementable. My recommendation is to **split the work** (see F) and to **add a formula-consistency test** for the hand-entered constants (see C, D2).

---

## 1. Does the proposed approach actually achieve the stated goal?

**Partially — with one unresolved dependency that determines the answer.**

The mechanics of *pricing* are sound: modelling each ability's growth as chains of ordinary one-time-purchase entries reuses a shipped precedent (Extra Attack 2nd/3rd), needs zero new pricing-formula code, and the prereq-chain widening is a small, precedented change. As a way to make the steps *cost AP* and *require ordering*, the approach works.

**But the goal is stronger than "make the steps cost AP."** The goal says these abilities "keep growing in power **for free** as the character levels" and the change should make players "buy again at named tiers **to keep pace**." That only has teeth if the *mechanical benefit* (uses/rest, damage bonus, known-forms count) is actually **gated on the purchase**. The plan then lists under **Out of scope**: "Any change to how the three abilities' in-game mechanical effects work." Those two statements are in tension:

- **If** the app is *only* an AP-budget/character-build calculator that never computes the mechanical effect (the effect lives in the human-read guide), then gating is enforced socially by the guide + the AP cost, and the approach is complete. **This is the likely case** given it's repeatedly called a "pricing engine" — but the plan never says so explicitly.
- **If** the engine *does* compute or auto-scale the effect by level, then adding priced entries changes nothing mechanically: the free auto-growth continues, the new entries become an optional tax nobody is forced to buy, and the goal fails. In that world the "out of scope" line is wrong and there's missing work.

**This ambiguity must be resolved in the plan before implementation.** It's a one-sentence fix ("the engine does not compute mechanical effects; enforcement is by AP cost + guide, not by code") but everything downstream depends on which world we're in.

Secondary point: the plan describes an out-of-order purchase producing a **"blocking warning."** A *warning* and a *block* are different things. If the engine only warns and still lets the purchase through, "must buy the prior step" is advisory, not enforced. Whether the mechanism prevents the purchase or merely annotates it needs to be stated — it changes both the test fixtures (item 8) and whether the goal is actually met.

---

## 2. Suspicious / over-claimed "Verified" facts

**B1 — The 50%-of-lookup claim is n=1 generalised to "every."** *(Most significant.)*
The plan states: "**Every** proposed step's price *is* algebraically reproducible as exactly 50% (rounded, floor 1) of what the existing pricing-table lookup would produce … **Checked by hand for one step**." That is an assumption wearing a verified badge. One confirmed data point across roughly 3 abilities × up to 7 steps ≈ 21 prices does not establish "every." Either verify all of them (cheap — it's arithmetic) or downgrade the wording to "spot-checked one; the design record asserts the relationship holds for all."

**B2 — The 50% relationship quietly undercuts the plan's own rejection of the formula route.** If every step price really is exactly `floor(0.5 × lookup(tier, category))`, then the numbers *do* fit a formula — a per-step `(tier, category)` override plus a halve flag. The plan simultaneously argues "the finalized tables do **not** fit that mechanism" (because tiers skip/repeat and category changes) **and** "every price is exactly reproducible by that mechanism's own lookup, halved." Both can be literally true (the *auto-increment* doesn't fit; the *lookup* does), but the plan presents them as if they point the same way when they actually cut against each other. See Q3.

**B3 — "Rounded, floor 1" is under-specified for a claim asserting *exact* reproducibility.** Round-half-up, round-half-even, or truncate? An exactness claim that hinges on a rounding rule must state the rule, or "exactly reproducible" isn't checkable.

**B4 — Genuinely solid verified items** (no complaint): the prereq check being scoped to one category and *every* prereq-declaring feature living in that category (searched the whole dataset — checkable and additive-relevant); and the Extra Attack 2nd/3rd having no prereq link (read from code). These read like real verification, not dressed-up assumptions.

**B5 — Minor:** "the highest-risk file … its public behavior must stay stable for three separate UI tools" is sourced to the contributor guide — fine — but "verified additive-only against the *current* dataset" is time-bounded and the plan itself admits it must be re-checked at implementation time. That's honest; just note the "verified" here has a shelf-life.

---

## 3. Is there a better implementation approach?

The chosen approach (data-only chains + one small widening) is a **reasonable and low-code-risk choice**, and the rejection of "generalise the shared formula" on risk grounds is defensible. My critique is narrower:

**C — Recommendation: keep the data-chain approach, but make the derived prices self-checking rather than hand-frozen.**

- **C1 (recommended, deeper fix):** Since B1/B2 establish the prices *are* `floor(0.5 × lookup(tier, category))`, add a **regression test that recomputes each step price from the lookup and asserts equality**, rather than only trusting ~21 hand-typed constants. This is the deep fix to the real risk the data approach introduces: 21 free-floating magic numbers that can silently drift from the formula they were derived from. It costs one test, documents the relationship, and catches typos on day one. The plan's fixtures (item 8) do **not** currently include this.
- **C2 (shallow alternative):** Ship the constants as-is with only the ordering/pricing fixtures in item 8. Tradeoff: less code, but a mistyped constant looks "green" and only surfaces when a player complains. Cheaper now, more fragile later.
- **C3 (middle path, schema-dependent):** Store each step as `{tier, category, halve:true}` and compute at load — single source of truth, still essentially data-only. Only viable if the entry schema can carry a computed price; may be more intrusive than C1 for no extra benefit. Mention, don't default to it.

**Recommendation: C1.** It's low/moderate risk, durable, and directly neutralises the one weakness the data-chain approach adds over a formula.

I would **not** switch to generalising the shared formula (the plan's rejected alternative) — the risk argument against touching the central function is correct.

---

## 4. What's missing that an implementer would need to not go off track?

- **D1 — The actual tables.** The plan says "full tables below" but supplies only Rage's tier *pattern* (1,3,4,4,5,6,7). Wild Shape and Bardic Inspiration step counts, per-step AP, tier assignments, category per step, and track membership are **not enumerated** in the review copy. An implementer cannot build entries from this document alone.
- **D2 — Rounding rule** for the 50% relationship (see B3), needed for C1's test.
- **D3 — Block vs warn semantics** (see Q1) — does the mechanism *prevent* the purchase or annotate it? Determines fixtures and whether the goal is met.
- **D4 — Effect-gating linkage** (see Q1) — explicit statement that the engine does not compute mechanical effects (or, if it does, the extra work to gate them).
- **D5 — How "independent tracks" are represented in data.** Steps 3 says a "uses" track and a "damage" track don't gate each other. What field distinguishes tracks? How does the prereq check know two chains are independent so it doesn't cross-gate them? Rage has repeated tier 4 (steps 3 and 4) — is that two steps on one track or one step on each of two tracks? The reviewer can't tell, and the prereq-ordering test (the very thing item 8 worries about firing "on the wrong track") depends on it.
- **D6 — Stable ordering when tiers repeat** (Rage 4,4): with equal tiers, prereq order can't be inferred from tier; it must be an explicit predecessor pointer, and the plan should say the pointer — not the tier — is authoritative.
- **D7 — Entry-schema confirmation** that a one-time entry can carry an arbitrary fixed price with a mid-chain category change, without needing the "band" field the stepped mechanism relies on.
- **D8 — UI impact.** Three UI tools consume this engine. Turning "one Rage entry" into "up to seven Rage entries" changes what those tools render (list length, grouping, search). The plan treats this as "not a UI change," but the data shape change is visible to UI. At minimum, confirm the tools render a 7-entry chain sensibly.
- **D9 — Test-baseline regeneration process** — item 8 adds fixtures and an "expected output baseline"; who regenerates the baseline and how it's reviewed isn't stated.

---

## 5. Is the Verification section objectively checkable by a third party?

**Mostly yes, with two exceptions that require information this document doesn't contain:**

- **E1 — Not independently checkable:** "Done when #2 — all finalized steps exist with the **exact AP numbers from the design decision**." A reviewer without the design-decision record (explicitly the reviewer's situation) cannot confirm the numbers are correct — only that *some* numbers exist. This is tribal knowledge the plan depends on. C1's formula-consistency test partly rescues this: a third party *can* check `price == floor(0.5 × lookup(tier,category))` without the design record, which is a stronger, self-contained correctness criterion than "matches the design doc."
- **E2 — Time-bounded, not statically checkable:** "the widening was truly additive" is only provable against the dataset *at implementation time*, and the plan admits this. So this verification step can't be signed off from the document alone; it requires re-running a dataset search at merge time. Fine, but call it what it is — a step, not a fact.
- **E3 — Checkable:** zero test failures, version marker bumped exactly once and nothing else touched, guide prose updated — all objectively verifiable by anyone with the repo.

Net: the "done when" list is checkable **except** where it defers to the external design record (E1) and the external guide master (see F/risks). Those two are outside this repo by the plan's own admission, so "done" is genuinely not confirmable within this repo alone.

---

## 6. Should this be split into more than one piece of work?

**Yes — recommended.** The plan bundles a high-blast-radius engine change with a large data change, a cross-repo doc change, and an optional unrelated bug fix. Suggested split:

- **F1 — Engine widening (own PR, lands first).** Widen the prereq check to any prereq-declaring feature; prove additivity against the current dataset with a test showing zero new warnings on existing fixtures. Small, isolated, reviewable against the "highest-risk file" bar on its own. Because no non-invocation feature declares a prereq today, this PR is behaviourally inert until data uses it — ideal for isolating risk.
- **F2 — Data + guide + version bump (own PR, depends on F1).** All step entries, the C1 consistency test, the ordering fixtures, the rules-version bump, and the guide prose. This is where behaviour actually changes.
- **F3 — Extra Attack (2nd)/(3rd) gap** (step 6 decision). Genuinely separate; recommend **explicitly deferring to its own follow-up** unless F1 is already merged and adding two prereq pointers is trivial. Bundling a pre-existing unrelated gap into a rules-pricing change muddies the changelog and the version-bump semantics.
- **F4 — Guide master transfer** is *inherently* separate work (different repo, manual verified transfer). By the plan's own "guide and engine must land together" rule, F2 is **not "done"** until F4 happens elsewhere — which this repo cannot confirm. This is a real release-coordination hazard, not just paperwork.

---

## Strengths worth preserving

- Honest verified/assumed split, and it names its own highest-risk file rather than hiding it.
- Reuses a shipped precedent instead of inventing a mechanism.
- Correctly rejects generalising the central pricing function on risk grounds.
- Flags the cross-repo guide-master dependency as a process risk rather than pretending the repo is self-contained.
- Treats the Extra Attack gap as a live scope decision, not a silent inclusion.

## Highest-value changes before implementation

1. **Resolve the effect-gating question** (Q1/D4) — one sentence, but it decides whether the goal is met.
2. **Nail down block-vs-warn** (Q1/D3).
3. **Verify all step prices, not one** (B1), and **add the formula-consistency test** (C1) so the ~21 constants can't drift and so correctness is checkable without the design record (E1).
4. **State the track-representation and repeated-tier ordering rules** (D5/D6) so the ordering fixtures test the right thing.
5. **Split per F**, landing the engine widening first and inert.
