# Cold review — `priceOf()` pricing-basis fix

**Reviewer:** Microsoft Copilot (Claude Opus 5 backend), default settings, extended reasoning on. No codebase access — text of the plan only.

**Posture:** adversarial, as instructed. Everything below is an attempt to refute or stress the plan, not to validate it. Where a section is sound I say so briefly and move on.

---

## Summary judgement

The diagnosis is right and unusually well-argued — particularly the recognition that `compute().total ≠ ledger sum` is *intended*, which is the trap most people fall into on this class of bug. The proposed *mechanism* (price context changes from listed rules, not from a whole-build diff) is also right.

Where I think the plan is weakest is that it keeps the broken pricing basis as the **default** for the majority of categories and carves exceptions out of it. That inverts the safety properties: a misclassification fails silently and permanently, and any *future* context-sensitive branch added to `compute()` re-introduces the bug for every category still on the diff path. The plan names this as Risk 1 and then mitigates it with a test derived from the same inspection that produced the risk. Findings A and E below are the substantive attack.

---

## Findings

### A. The two-way split is the wrong default; invert it
**Severity: blocking · Confidence: high**

**Gap.** "Item purchase" is defined by a *negative* property — "does not change how anything else is priced." Negative properties can't be established by inspection, only refuted by counter-example. The plan admits the category→field mapping "was traced by inspection, not exhaustively," so the entire correctness of the fix rests on an unverifiable negative, forever, including for categories added later by someone who never read this plan.

Meanwhile the plan's own reasoning shows the diff is only correct for item purchases *because for them the diff equals the listed price*. If that's true, the diff is never the authority — it's a coincidence that happens to agree with the authority. Keeping two pricing paths preserves a failure mode for no benefit.

Note also that the split doesn't survive contact with the plan's own examples. Level Up, ability-score raise, class unlock and ability-raising boons are all *simultaneously* a thing bought and a context change. The plan resolves this correctly (price them from their table), but that resolution is precisely "the purchase's listed price is the authority" — which is a **universal** rule, not a classification.

**Suggested improvement.** Make listed-price/ladder-rung lookup the default for **all** categories, and keep the before/after diff only as (i) a test oracle asserted to agree with the table for the categories where it should, or (ii) an explicitly annotated fallback that logs when used. Risk 1 then stops being a risk and becomes a build-time gap ("this category has no price source") rather than a silent mispricing. This is also the version that survives future edits to `compute()`.

If the inversion is judged too large for one change, the fallback position is: keep the classification, but make the *unclassified* case fail loudly rather than default to diff.

---

### B. "Priced from their own rules table" doesn't say *at which context the table is read*
**Severity: blocking · Confidence: high**

**Gap.** Every listed price in the plan's list is itself a function of state: the unlock-ladder rung depends on how many classes are unlocked; the hit-die step depends on current level; the ability-raise table entry depends on the current score; second-origin species depends on whether an origin already exists. So "look it up in the table" is under-specified until you state whether the lookup uses the **pre-mutation** or **post-mutation** build.

This matters more than it looks, for two reasons:
1. It is a classic silent off-by-one — a level-up charged at the new tier's rung instead of the old one is wrong by exactly one rung and will look plausible in every fixture that isn't per-line asserted.
2. The three existing hardcoded escapes were written independently and **may not agree with each other** on this convention. Retiring them into one rule (step 3) can therefore change the price of an ability-score raise or a "bound" option — a behaviour change the plan neither predicts nor tests for.

**Suggested improvement.** State the convention explicitly in the plan — I'd propose *"a purchase is priced under the context that exists **before** its own mutation is applied, except where the rules table is explicitly indexed by the count of the thing being bought (ladder rungs), which use N+1."* Then add an equivalence test: for each of the three retired escapes, assert the generalised rule returns the identical price to the hardcoded value it replaces, across a spread of contexts. Without that test, step 3 is an unmeasured behaviour change bundled into a bug fix.

---

### C. Migration is treated as cosmetic; negative quotes may mean characters are *invalid*, not just mis-labelled
**Severity: blocking · Confidence: high**

**Gap.** The plan states class unlock "can reach zero or negative." If a negative quote was ever written to an append-only log, it didn't just mis-record a price — it **returned AP to the player**, who then spent it. Grandfathering is presented as the conservative, product-consistent option ("prices freeze"), but grandfathering an unearned refund leaves characters whose ledgers are internally consistent and whose *budgets* are not: they own things they could not have afforded under correct pricing.

That reframes the open question. It is not "grandfather vs. correct" — it is "do we accept that some saved characters are over-budget under the new rules, and does anything in the tools enforce a budget ceiling?" If any tool validates spend ≤ available AP, grandfathered characters may start failing validation *after* this change, with no code path having touched them. Also worth confirming: does levelling itself grant AP? If so, changing the Level Up charge moves both sides of the ledger.

**Suggested improvement.** Before implementation, get the owner to answer the question in its stronger form, and separately establish (cheap query) how many saved characters carry a zero-or-negative recorded purchase. If the answer is "none in the corpus", this drops to minor immediately and the plan is much safer. If it's non-zero, the migration decision has a hard dependency on whether budget validation exists.

---

### D. Stamp a pricing-basis version onto events
**Severity: moderate · Confidence: high**

**Gap.** After this change the log contains two kinds of frozen price — old-basis and new-basis — that are indistinguishable by inspection. Every downstream reader (the two display tasks already queued, any future audit, the corpus test itself) has to guess. The plan correctly says the *rules* version shouldn't bump because `compute()` doesn't move; that's a different axis from the pricing basis.

**Suggested improvement.** Add a small `basis: 2` (or a date) to newly written purchase events. It costs almost nothing, makes grandfathering displayable and honest, makes finding E's corpus test tractable, and it is the only migration-neutral artefact that lets a later owner decision be implemented without archaeology.

---

### E. The corpus-replay test is either vacuous or asserts the wrong outcome
**Severity: moderate · Confidence: high**

**Gap.** "Re-quote nothing, but replay every available saved character before and after and diff their totals. Require zero drift." These two halves contradict. If nothing is re-quoted, recorded costs are read straight from the log and zero drift is guaranteed by construction — the test can never fail and proves nothing. If "replay" means re-executing the event log through the new quoting path, then drift is *expected and desirable* on exactly the species / class-unlock / Level-Up events, and "require zero drift" would fail the correct implementation.

**Suggested improvement.** Split it into two tests with opposite assertions: (i) **no-touch invariant** — loading and re-saving an existing character changes no recorded cost (zero drift, and this one is worth having as a guard against accidental re-quoting on load); (ii) **replay delta** — re-quote every saved character's log under the new basis and require drift to be **non-zero only on context-change events**, with the per-character delta enumerated. Test (ii) is also the cheapest empirical answer to Risk 1: if an "item purchase" category drifts on replay, it was misclassified.

---

### F. The price-independence test will produce false failures unless the fixture pair is specified
**Severity: moderate · Confidence: high**

**Gap.** "Buy it on a bare character and again on a heavily-loaded character." A heavily-loaded character is, in practice, also a *higher-tier* character — and the plan states that ladders and several branches legitimately scale with tier, species and origin class. If the loaded fixture differs in any context field, prices legitimately differ and the test fails on correct code. Conversely, if the fixture is built by levelling to acquire the load, the confound is guaranteed.

**Suggested improvement.** Specify the invariant precisely rather than as two example characters:

> A quote depends only on `(category, option, context fields, count of same-ladder items already owned)` — and on nothing else the character owns.

Then the test is: hold that tuple fixed, vary everything else, assert the quote is identical. This formulation **answers your Q5 directly** — it distinguishes the bug from correct ladder behaviour without exceptions, so it can be applied blanket-wise to *every* category including ladders, and no separate "ladder counter-test" carve-out is needed. That also removes the need to trust the classification in order to trust the test, which is the single biggest structural weakness in the current verification plan.

---

### G. The "no decomposition needed" claim has an escape hatch that may swallow it
**Severity: moderate · Confidence: high**

**Gap.** The plan asserts decomposing `compute()` is not a dependency, then concedes "if a listed price isn't reachable without exporting an accessor." That concession is doing a lot of work. If any of the ~9 context-change prices exists only as an inline branch or literal *inside* `compute()`'s flow rather than as addressable data, extracting it **is** the decomposition that's declared out of scope — and you'd discover that mid-implementation, on the category you understand least.

**Suggested improvement.** Before committing to the plan, spend the 20 minutes to confirm, for each of the nine context-change categories, that a listed price is reachable as data (or via one additive accessor). Record the result in the plan as verified. If one isn't, that category needs its resolution decided up front, not improvised.

---

### H. Two tools, one rule — no mechanism keeps them agreeing
**Severity: moderate · Confidence: high**

**Gap.** Step 5 says "apply the same classification" in the generator tool, which does its diff inline. In a vanilla-JS repo with no bundler, "the same" reliably decays into "a copy that drifts." The generator is the tool most likely to receive a new category later.

**Suggested improvement.** Extract one shared quoting module used by both writers, and add a cross-tool agreement test: for a spread of `(build, category, option)` triples, both tools return the identical quote. That test is cheap and catches drift permanently; without it, the fix has a half-life.

---

### I. Step 4 (species pack as its own priced event) is a log-schema change riding along with a bug fix
**Severity: moderate · Confidence: high**

**Gap.** Everything else in the plan changes *values written to the log*. Step 4 changes *the shape of the log* — a new event kind, plus pack-included traits recorded at 0. That is the one item with back-compatibility consequences for every existing log reader, and it's an owner *feature request*, not part of the defect. Bundling it means a rollback of the feature is also a rollback of the fix.

**Suggested improvement.** Split step 4 into a follow-on change that lands immediately after, sharing the same fixtures. If it must ship together, state explicitly which readers parse event kinds and confirm they tolerate an unknown/new kind.

---

### J. "Done when" is partly circular
**Severity: minor · Confidence: high**

**Gap.** "Every context-change category quotes a price independent of what the character already owns" is checkable only against the list of context-change categories — which is the thing under doubt (Risk 1). If a category is misclassified, the Done-when clause passes anyway.

**Suggested improvement.** Restate as the universal invariant from finding F, which is checkable without reference to the classification. The other three Done-when clauses (escapes gone, per-line fixture, decision reversed, owner answer) are objective and fine as written.

---

### K. Append-only + context *change* (not just context set) is unspecified
**Severity: minor · Confidence: low**

**Gap.** The list says "species / 2nd-origin species" as a category, and step 4 emits a pack purchase. What happens when a player *changes* species having already bought one — a second full pack charge, a refund event for the old pack, or a replacement? An append-only log with frozen prices has no obvious answer, and "refund the old pack at its frozen price" quietly reintroduces the very mechanic the plan is removing. Same question for changing origin class.

**Suggested improvement.** One line in the plan stating whether re-selection is reachable in the UI, and if so, which of the three it does. Related to Risk 4 (removal) — I'd merge them into a single "retraction semantics" open question, still out of scope for implementation but answered in text.

---

### L. Epic boons and the third tool — cheap to close, so close them
**Severity: minor · Confidence: high**

**Gap.** Both are flagged honestly as untraced, which is good practice. But "epic boons are a fourth live instance" is a five-minute trace, and it changes the category list the whole plan is built on. Leaving it assumed means the implementer may discover a tenth category after the classification is written.

**Suggested improvement.** Trace it before starting. Same for the third tool — a grep for log writes is trivial and converts an assumption into a fact.

---

### M. Quote/commit staleness
**Severity: minor · Confidence: low**

**Gap.** The price is "quoted and then frozen." Nothing in the plan states that the commit re-derives the price from the same build state the quote was taken from. If the UI shows a quote and the build mutates before commit (a second tab, an undo, a house-rule override toggled by the DM), the frozen price may not match either context. Pre-existing, not introduced here — but the fix moves prices onto a lookup that is *more* sensitive to which build snapshot is used (finding B).

**Suggested improvement.** Note in the plan whether quote and commit share one evaluation, or add it to the retraction-semantics question.

---

## What's genuinely solid — no action needed

- **The Context section.** Separating "what would this cost today" from "what was paid," and stating that their divergence is *correct*, is the crux and it's nailed. The existing "paid X · Y at today's prices" UI is good corroborating evidence that the product already agrees.
- **Rejecting the contamination-subtraction alternative.** The argument (pack cost and trait re-pricing arrive as one inseparable number, so you need the listed price anyway) is correct and decisive.
- **Rejecting the superseded "recorded cost == `compute()` delta" decision, and explicitly reversing it in the decisions record.** Identifying a prior recorded decision as the bug restated as a goal is the highest-value item in the document; reversing it in writing is the right move.
- **Rejecting the fourth-escape alternative.** Your Q3 asks if the classification is over-engineered relative to one more escape. It isn't — "three escapes did not converge" is a sufficient argument, and class-unlock and Level Up would demonstrably stay wrong. If anything the plan is *under*-generalised (finding A), not over-engineered.
- **The named reproduction fixture with per-line assertions** rather than a total. Correct instinct; a total would hide a pack-price error offset by a trait error.
- **Declining to decompose `compute()` or add a purchase-time model.** Both correctly identified as not load-bearing for this fix. To your Q6: nothing in Out of scope is load-bearing for the fix itself — the purchase-time model is load-bearing only for retraction semantics and display honesty, both of which stay out.

---

## Direct answers to your five questions

**Q1 — does the approach achieve the goal; is the two-way split sound?** The mechanism achieves the goal; the split is not sound as a taxonomy (Level Up, ability raises, class unlock and boons are both things at once) and is unsafe as a default (finding A). Invert it and the goal is met with one pricing path.

**Q2 — shakiest assumption?** Completeness of the category list, and it breaks *silently* — a misclassified category keeps the exact bug you're fixing, with a green test suite. Finding F's reformulated invariant is the mitigation that doesn't depend on the assumption being true.

**Q3 — Risk 3, legitimate context-dependence vs. contamination.** You expected this to be the weak point; I think it's actually the strongest part conceptually, and the plan just hasn't written down the rule it's already using. The distinction is not "which category" — it's **which direction in time**. Legitimate dependence = today's context applied to *this* purchase. Contamination = today's context applied to *past* purchases. The origin-class discount is legitimate precisely because the class context predates the purchase. Write that sentence into the plan and Risk 3 stops being subtle; what remains is finding B, the pre/post-mutation convention, which is the genuinely fiddly bit.

**Q4 — what's missing.** Table-read context convention (B); equivalence tests for the three retired escapes (B); AP-affordability consequence of migration (C); basis stamping (D); cross-tool agreement test (H); confirmation that listed prices exist as data (G).

**Q5 — is Verification objectively checkable?** Mostly, with two exceptions: the corpus replay is self-contradictory (E), and price-independence will produce false failures unless the fixture pair holds context constant (F). Reformulated per F, the independence test applies to ladders too and the counter-test becomes unnecessary.

**Q6 — should it be split?** Yes, one cut: step 4 (species pack as its own event) is the only log-*shape* change and should land separately (I). The rest is one coherent change.

---

## One structural alternative you didn't consider

**Reduced-build diff.** Instead of classifying UI buy categories, compute the diff against a build stripped of everything except context fields and same-ladder counts:

```
price = compute(stripped + context-change + item) − compute(stripped + context-change)
```

Because no pre-owned items are present, nothing can be retroactively re-priced — contamination is impossible by construction. Because context fields are retained, legitimate context-dependence (the origin-class discount) survives intact. It handles species, class unlock and Level Up correctly with no per-category rules.

Its appeal is that the artefact it depends on — *which build fields the pricing branches read* — is the one you **verified exhaustively** (all ~370 lines audited), whereas the artefact the current plan depends on — the UI-category→field mapping — is the one you traced **by inspection**. It swaps an assumed input for a verified one.

Its cost: ladder rungs need their counts retained, so you still need to know which fields are ladder counters (a field-level list, not a category-level one), and it doubles `compute()` calls per quote. I am **not** recommending it over the listed-price lookup — listed prices are more legible and cheaper — but it is a better fallback than the diff for any category where finding G turns up a price that isn't reachable as data, and it's worth a line in Alternatives so a later reader knows it was weighed.
