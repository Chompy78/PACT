# Review — "Charge species/heritage packs as real purchases"

**Reviewer: Microsoft Copilot — Claude Opus 5 backend, high reasoning effort. Cold review, no codebase access, text only.**

Verdict up front: the goal is achievable, but **as written the plan does not achieve it**. Step 1 ("canonical ordering in the fold") is stated in a way that is either false or self-defeating depending on which of two readings you take, and the invariant is not preserved under the generator's own slot-replacement behaviour — which is exactly the operation step 4 (species swap) requires. Both are fixable, but not by clarifying wording; they change what step 1 *is*.

---

## Headline findings

### F1 — Step 1 cannot deliver both "readable lines" and "cost == prefix delta". Pick a horn. `blocking`, `high`
The plan says canonical ordering guarantees "the prefix at any trait purchase always has the species set, **regardless of the order events were emitted in**." There are only two readings of "prefix", and neither gives you that:

- **Reading A — prefix = first *i* events in emit order, then folded (canonicalised) for state.** Hoisting identity to the front of a *set* cannot insert an event that isn't in that set. If the four trait events were emitted before the identity event existed, every prefix containing those traits still has no species. They still price cross-race at 21, and the identity event still carries a large negative delta. **That is precisely Alternative 4, the option you rejected on readability** — reached by a more expensive route. Under Reading A, steps 1–3 buy you the invariant but not the readable ledger that justified them over Alternative 4.
- **Reading B — prefix = first *i* events of the *canonicalised* log.** Now identity is at index 0, every trait prefix has species, and lines read correctly. But the cost frozen at write time (when identity did not yet exist) is *not* the canonical-prefix delta computed later. The invariant then holds only if you re-freeze the trait's cost when identity arrives — which violates the frozen-price rule and the append-only property.

The only configuration where both properties hold is: **emit order is forced to equal canonical order at write time**, i.e. the identity/pack event is materialised into the log *before* any dependent purchase can be written. That is the rejected "narrow ordering fix", promoted from one tool's UI into the shared writer. That promotion is a genuinely better place for it and I'd support it — but the plan should say so plainly instead of asserting order-independence it cannot have. Answering the plan's own question directly: **yes, step 1 is the ordering fix relocated**; its added value is enforcement locus, not order-independence.

*Suggested amendment:* restate step 1 as "the shared writer refuses to price any species-dependent event against a prefix with no species; it materialises the identity/pack event first." Then state explicitly that emit order and fold order must be identical, and that canonicalisation is a *validation* of that, not a licence to reorder.

### F2 — The invariant breaks under `replacePatchSlot`'s remove-and-append. `blocking`, `high`
The plan describes the writer as pricing against `fold(log-without-this-slot)` then appending — i.e. the old slot event is **removed**. Telescoping requires that no event is ever removed or reordered relative to the sequence the sum is taken over. Worked example:

- `L = [identity_v1, trait]`. `trait` freezes at its origin price, say 2 (correct prefix delta).
- User changes species → `L' = [trait, identity_v2]`.
- `trait`'s frozen 2 is untouched (freeze rule). `identity_v2`'s delta = `compute(fold(L'))` − `compute(fold([trait]))`, where `fold([trait])` now has **no species**.
- Sum ≠ `compute(fold(L')).total`. The invariant is broken by an ordinary species edit — the case step 4 exists to handle.

"Append-only" and "coalescing slot replacement" are incompatible claims; the plan repeats both without reconciling them. This is where Risk 2 (double-charging) actually lives, and it is more structural than the plan credits.

*Suggested amendment:* make amendment a true append — an `identity-amend` / `pack-swap` event that supersedes rather than deletes, so the historical prefix sequence is never mutated. The refund of the old pack then appears as part of the amend event's delta, which is both arithmetically correct and honest as a ledger line.

### F3 — Which event mutates `b.species`? The plan never says, and everything turns on it. `blocking`, `high`
Step 2 says the pack event "carries its own cost" and the identity patch "retains only the unpriced identity fields". But species is not an unpriced field — it is *the* priced field, since `compute()` charges the pack from the species field alone.
- If the identity patch still sets `b.species`, `compute()` charges the pack there and the pack event's prefix delta is **0** — the pack is visible but priced at nothing, failing the owner's requirement.
- If the pack event sets `b.species`, then the pack event (not the identity event) is the ordering-critical one, and every reference to "identity first" in steps 1 and 4 is naming the wrong event.
- If both touch it, you double-charge.

*Suggested amendment:* state the field ownership explicitly in the plan — one event owns `b.species`, named — and define what a build with a species but no pack event (or vice versa) means, since migration will produce exactly those.

---

## Assumption audit

### F4 — "Empty build totals 0" is not the shakiest assumption, and its failure is trivial. `minor`, `high`
If `compute(empty) ≠ 0`, the invariant is simply `Σ cost == compute(fold(L)) − compute(empty)`. Worth confirming (the plan does), but it is not load-bearing. The genuinely load-bearing preconditions for telescoping are unstated: **(a)** no event is ever deleted or reordered relative to the summed sequence (see F2), **(b)** `compute()` is deterministic on every *intermediate* prefix including incoherent ones, and **(c)** `fold()` does not throw or clamp on a build with traits and no species. Add (a)–(c) to the assumptions list; drop (a) at your peril.

### F5 — Caps, discounts, or clamps inside `compute()` would poison per-line prices even though the sum stays correct. `moderate`, `low`
Telescoping survives any non-additive pricing, but attribution does not: if `compute()` applies a cap ("max N origin traits"), a bundle discount, or rounding, the *next* purchase absorbs the entire non-additive step and reads as a wrong price on its own line. Since per-line readability is the plan's stated justification for the expensive path, this needs checking, and the plan doesn't mention it.

### F6 — "The generator is the only writer that prices from form state" is asserted about two tools out of three. `moderate`, `high`
Context says three tools share the engine; the plan only accounts for two writers. Enumerate all writers, including anything that imports/creates characters. And step 3's "no writer prices from form or DOM state" is a *convention*, not a mechanism — make it structural by giving the helper a signature that can only accept the log, so form state is inexpressible rather than merely discouraged.

### F7 — Risk 5 (level/class also gate prices) should be answered *before* step 1 is designed, not after. `blocking`, `high`
If other fields gate prices, "hoist identity" is the wrong shape entirely and you need a dependency ordering over event kinds — a materially bigger design with its own cycle/ambiguity questions. This is currently filed as an open question but it determines whether step 1 is ten lines or a subsystem. Resolve it first; it may also change the estimate enough to reopen the Alternative 4 comparison.

### F8 — No mechanism stated for detecting a mixed-rules-version character. `moderate`, `high`
Risk 4 correctly says the invariant cannot hold across versions and the gate must be scoped to single-version characters. But if prices freeze *per event*, version must be stamped *per event* to detect mixing; if only the character carries a version stamp, mixed characters are undetectable and the gate's scope condition is unimplementable. Confirm which exists. Related: **refund pricing under version drift is unaddressed** — a species swap prices the refund of the old pack at *current* rules, silently refunding a different amount than was charged.

---

## Alternatives

### F9 — Alternative 4 is stronger than the plan allows, and the rejection rationale is incomplete in *both* directions. `moderate`, `high`
Two corrections to the plan's own framing:
- **In its favour:** readability is a *presentation* concern, and you already have a queued task touching ledger display. "Halfling Nimbleness −8 (reclassified: now an origin trait)" is a rendering change, not a storage change. Solving a display problem with an ordering-and-event-splitting mechanism in the shared engine is a large lever for a small screw. Under Reading A of F1, the plan converges on Alternative 4's data anyway.
- **Against it, and missing from the plan:** the play sheet's hardcoded −2 exists specifically because a full recompute diff "would retroactively discount already-owned features/spells (the refund bug)". Alternative 4 institutionalises exactly that behaviour. So it was *not* rejected on readability alone — there is a prior recorded objection to in-ledger refunds, and the plan should cite it rather than presenting readability as the sole cost. It also can't satisfy the owner's "packs visible as purchases" requirement on its own.

Net: Alternative 4 + display-layer relabelling + a separate pack event is a real contender that the plan dismisses too cheaply, and it is far cheaper than steps 1–3 if F7 resolves badly.

---

## Verification and "Done when"

### F10 — Verification tests only the property that both approaches share, and never the property that justifies the expensive one. `blocking`, `high`
Every listed check is a **sum** check. Nothing asserts that individual ledger lines carry the *intended* per-line price. Since "per-line readability" is the sole stated reason to prefer steps 1–3 over Alternative 4, the plan spends its budget on something it does not test. Add a fixture asserting the exact expected cost of each line for the reproduction character (pack-included traits at 0, own-species at origin price, pack at pack price, identity at 0), and make it fail if the ledger degenerates into charge-then-refund.

### F11 — "24 passed / 0 failed" conflicts with step 6. `moderate`, `high`
Step 6 adds a regression gate, so the count must move. State the expected post-change count and that the pre-existing 24 must all still pass — otherwise the gate criterion and the work item contradict each other and a reviewer can't tell a legitimate 25 from a broken 24.

### F12 — No before/after replay diff over real saved characters. `moderate`, `high`
Fixtures passing does not mean saved characters are unaffected: changing fold ordering can change `_raceTraitLocked` outcomes and therefore `compute().total` for real data that no fixture covers. Add: replay every available saved character before and after, diff totals, and require either zero drift or an explicitly enumerated and accepted drift list. This is cheap and is the only concrete answer to Risk 1 that isn't an assumption. Note also that the plan's version-bump rule keys on "`compute()` output changed" — a fold change that alters real characters' totals *is* an output change in every sense that matters, even if `compute()` itself is untouched; say which side of the rule that lands on.

### F13 — Step 5's condition is unfalsifiable as written. `minor`, `high`
"Retire the −2 hardcodes iff the general mechanism produces the same numbers" — same numbers on *what corpus*? Name the cases (which two categories, which scenarios) or the step will be resolved by whoever is holding the keyboard.

### F14 — "Done when" is a plan-review gate, but "Goal" is a code fix. `minor`, `high`
The Goal says "fix the mechanism"; Done when says "the plan is reviewed and the migration question has an owner decision". Both are legitimate, but a reader can't tell whether merging code is in scope for this task. Label the document as a plan-approval gate with implementation as a successor task, or extend Done when to cover the code.

---

## Scope

### F15 — This is two goals wearing one coat; split it. `moderate`, `high`
"Restore `Σ frozen == compute().total`" and "packs must appear as purchases" are separable. The plan itself concedes the arithmetic can be fixed by Alternative 4 alone. Suggested split: **(i)** a fact-finding spike answering F7, F8, the ratchet question, empty-build-zero, and the writer inventory; **(ii)** invariant + single prefix-delta pricing helper; **(iii)** pack-as-event + species swap. Sequencing (i) first is close to free and could halve or double (ii)+(iii)'s scope.

### F16 — The out-of-scope display task is load-bearing in the interim. `moderate`, `low`
Step 2 emits pack events that the play sheet's history does not display. Between this landing and that task landing, the play sheet shows a line-set that sums to less than the total — which is a *worse* version of the already-queued "AP left vs AP Ledger disagree" bug, on a tool used during live play. Either pull the display change in, or state the accepted interim behaviour. Low confidence only because I can't see how that view computes its footer.

---

## What's solid

The "Assumptions vs verified facts" split is unusually disciplined and made this review possible — most plans hide the seam. The 15-vs-33 reproduction as a named acceptance test is a good, objective gate. The Alternatives section engages honestly with the cheap option instead of strawmanning it. The observation that the existing hardcoded −2 cases are evidence that special-casing accumulates rather than converges is the right generalisation and I'd keep it as the plan's spine. Risks 1–5 identify the right hazards; my objection is to how three of them are sequenced, not to their content.

---

## Decision points for the owner

**A. What to do with step 1.**
- **A1 (recommended) — Own it as the ordering fix, promoted to the shared writer.** Enforce emit order == canonical order: the writer materialises the identity/pack event before any species-dependent event and refuses to price against a species-less prefix. Keeps readable lines *and* the invariant, and is honest about being the rejected fix relocated. Resolves F1; requires F7 answered first.
- **A2 — Accept Reading A and adopt Alternative 4's data shape**, fixing readability at the display layer. Cheapest; concedes in-ledger refunds, which collides with the recorded objection in F9.
- **A3 — Full dependency ordering over event kinds.** Only justified if F7 shows level/class also gate prices; largest scope, defer until the spike answers it.

**B. How amendment/species-swap is recorded.**
- **B1 (recommended) — Supersede-by-append.** Old slot event stays; an amend event carries the swap delta. Preserves the prefix sequence and therefore the invariant. Resolves F2.
- **B2 — Keep remove-and-append and re-price affected events on edit.** Simpler writer, but breaks the frozen-price rule within a version — needs an explicit product ruling.

**C. Sequencing.**
- **C1 (recommended) — Spike first** (F7, F8, ratchet, empty-build, writer inventory, before/after replay diff), then decide A and B with real numbers.
- **C2 — Proceed now** and treat the spike questions as implementation-time discoveries. Faster to start, but A and B are both blocked on spike answers, so this mostly relocates the delay.
