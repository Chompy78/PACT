<!-- File: species-pack-not-charged-review-gpt-5-default.md -->

# Model

GPT-5 (default settings)

# Review findings

## 1. (blocking, high) The telescoping proof only proves the invariant if `compute()` is a pure function of replay state

**Gap:**  
The proof is mathematically sound *only if* every event cost is computed as

> `compute(prefix_after) - compute(prefix_before)`

using exactly the same replay semantics that later produce the final build.

However, the plan simultaneously proposes changing replay semantics (canonical ordering, pack events, possibly replaying identity before traits). That means the proof and the implementation are coupled: if replay order differs between "pricing time" and "final fold", the invariant no longer follows automatically.

The plan currently treats these as separate steps, but they are really one correctness condition.

**Suggested improvement:**  
State explicitly that the pricing helper must invoke the *same fold implementation* used by `compute()`, not a logically equivalent implementation.

---

## 2. (blocking, high) Canonical replay ordering is not obviously equivalent to the rejected ordering fix

**Gap:**  
The plan argues this is fundamentally different from the rejected ordering fix because it changes replay rather than emission.

I am not convinced.

From a behavioural perspective, both approaches amount to:

> "Identity is always processed before dependent purchases."

The difference is merely *where* that guarantee lives.

That distinction matters architecturally, but the plan overstates it. A reviewer could reasonably conclude this is still an ordering fix—just centralised.

The stronger argument is not that it is different in principle, but that **all writers inherit it automatically**, preventing future regressions.

**Suggested improvement:**  
Rephrase the justification around enforcement scope rather than claiming it is a fundamentally different solution.

---

## 3. (blocking, medium) Step 2 and the description of `compute()` appear to pull in opposite directions

**Gap:**  
The Context section explicitly states:

> compute charges packs from the species field alone.

Later, Step 2 proposes introducing explicit pack purchase events.

It is not clear whether:

* `compute()` will continue deriving pack ownership from species,
* or `compute()` will instead derive it from pack events,
* or both.

Those produce different architectures.

The verification section distinguishes "compute output changed" from "recorded costs changed", implying compute *might not* change.

Yet Step 2 sounds like a conceptual shift in what constitutes ownership.

**Suggested improvement:**  
Explicitly state whether pack events are:

* purely ledger artefacts while `compute()` still derives packs from species, or
* the new source of entitlement.

That architectural decision should not remain implicit.

---

## 4. (blocking, medium) Species swaps are under-specified

**Gap:**  
The plan correctly says species changes should refund the old pack and charge the new.

However, it never discusses what happens to traits whose pricing depended on the original pack.

Example:

- Buy Human pack.
- Buy Human-only traits at zero.
- Later become Elf.

Do those earlier trait purchases remain free forever because prices freeze?

Or do they cease being entitled?

Those are product rules, not implementation details.

The plan only discusses pack repricing.

**Suggested improvement:**  
Explicitly define what "changing species" means for existing pack-included traits.

---

## 5. (moderate, high) The migration decision is more load-bearing than presented

**Gap:**  
Migration is listed as intentionally deferred.

But implementation choices may depend on it.

For example:

- reconciliation event,
- grandfathering,
- replay version branching,
- mixed-version handling,

all influence replay architecture.

Leaving migration undecided is reasonable.

Leaving migration **completely disconnected** from implementation is riskier.

**Suggested improvement:**  
Record the implementation assumptions that remain valid regardless of migration strategy.

---

## 6. (moderate, high) The plan assumes identity is the only replay dependency without establishing a general rule

**Gap:**  
Risk 5 acknowledges this, but it is actually more fundamental.

Today:

- species gates pricing.

Tomorrow another field may.

If replay acquires multiple dependency rules, ad hoc canonical ordering becomes difficult to reason about.

**Suggested improvement:**  
Instead of "identity always first", define replay phases (identity → ownership → derived purchases → everything else), or explicitly state why no broader dependency graph is required.

---

## 7. (moderate, medium) The plan does not define what constitutes replay identity

**Gap:**  
Identity appears to contain:

- species
- second origin
- possibly other fields

If identity patches are split, canonical ordering requires knowing which events belong to the identity phase.

Future additions may accidentally bypass this.

**Suggested improvement:**  
Define the replay category rather than individual event types.

---

## 8. (moderate, medium) The ratchet discussion is stronger than most assumption sections but still unresolved

**Gap:**  
The plan correctly identifies `_raceTraitLocked` as the highest technical risk.

However, "no UI currently fires those events" is weak evidence.

Replay semantics are exactly where dormant code tends to become observable.

**Suggested improvement:**  
Treat replay equivalence as something to demonstrate with dedicated regression tests rather than a reasoning exercise.

---

## 9. (moderate, medium) The invariant is scoped to one rules version but verification does not exercise that boundary

**Gap:**  
The document correctly notes the invariant cannot span multiple rules versions.

However, verification never checks the transition.

An implementer could accidentally enforce the invariant across mixed versions and silently violate the frozen-price rule.

**Suggested improvement:**  
Add one explicit negative test:

> mixed-version characters are *not expected* to satisfy the invariant.

---

## 10. (minor, high) The empty-build assumption should not remain an assumption

**Gap:**  
You already recognise this.

Since the telescoping proof literally depends on it, verifying it belongs in Preconditions rather than Verification.

**Suggested improvement:**  
Promote this from an assumption into a confirmed prerequisite before implementation begins.

---

## 11. (minor, medium) Verification checks totals but not ledger readability

**Gap:**  
One of the primary reasons for rejecting the cheaper refund approach is human-readable history.

Yet no acceptance criterion checks that.

A future implementation could satisfy every numerical invariant while producing confusing ledger entries.

**Suggested improvement:**  
Add an acceptance test asserting that a newly purchased species creates an explicit pack purchase line and that pack-included traits appear with zero recorded cost rather than offsetting refunds.

---

## 12. (minor, medium) "24 passed / 0 failed" is necessary but not sufficient

**Gap:**  
Existing parity fixtures appear to validate rules outputs.

This task is primarily about **ledger behaviour**.

The regression suite should include at least one invariant-focused fixture independent of compute parity.

**Suggested improvement:**  
Add dedicated ledger tests rather than relying primarily on engine parity.

---

# Assessment of alternatives

The rejected "cross-race now, refund later" alternative deserves more discussion than it receives.

Technically, it has attractive properties:

- preserves the telescoping invariant,
- avoids replay-order dependence,
- avoids canonical ordering,
- avoids introducing new event types,
- avoids touching replay.

Its rejection rests almost entirely on ledger readability.

That is a perfectly legitimate product decision if readable purchase history is a first-class requirement.

If readability is *not* considered a product requirement, I think this alternative is substantially simpler and less risky than the proposed architecture.

Conversely, if readable ledgers are indeed a product requirement—as the owner's recorded decision indicates—then rejecting it is justified.

I therefore do **not** consider this a blocking issue, but I do think the plan should more explicitly acknowledge that it is choosing architectural complexity in exchange for a UX property rather than for correctness.

# Overall assessment

The plan is well structured, clearly scoped, and unusually honest about its assumptions and unresolved risks. The telescoping argument is fundamentally sound provided pricing and replay use identical semantics.

The largest remaining concern is architectural clarity around the interaction between:

- canonical replay,
- pack purchase events,
- species-derived entitlement,
- and future replay dependencies.

Those relationships should be made explicit before implementation begins, because they determine whether the proposed invariant really becomes "true by construction" or merely "true in the current implementation."
