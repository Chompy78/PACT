# D-GH-2026-08-04-species-pack-ledger-drift — the frozen ledger drifts from compute(), and two wrong diagnoses on the way

Status: Active — the fix is scoped as `fix/species-pack-not-charged` on `docs/TASK_BOARD_NEXT.md`, not built.

## Context

The owner reported DM Console roster figures looking wrong. Chasing it produced one real shipped fix
(`D-GH-2026-08-04-dm-console-dm-ap-budget`) and then uncovered a second, deeper defect that is **not**
fixed yet. This record exists so the next agent starts from the correct mechanism rather than re-deriving
it — and so the two wrong turns don't get repeated, because both were confident and both were wrong.

Anders Tealeaf (live, Amble, built 2026-08-02 on v0.337): `compute().total` = **33**, `economy().spent`
= **21**. Like-for-like (the frozen figure excludes drawbacks, which `total` carries as −6): **15 vs 33**.

## The two wrong diagnoses

**Wrong #1 — "the identity step should have cost +15."** I read `compute().lines` on the *final* build
(Heritage pack 5 + 2nd origin species ×2 pack 10) and treated it as what the identity event's delta ought
to have been. It isn't: the ideal delta at that point was **−4** against the recorded **−5**. The identity
step was very nearly right.

**Wrong #2 — "CharGen recorded four species traits as free that the engine prices at 21."** This came from
walking the log and comparing cumulative recorded cost against `compute(foldBuild(LOG.slice(0, i+1)))`.
Those partial replays are **states that never existed** — species traits owned with no species set — so
`compute()` prices them as loose cross-race purchases. The owner corrected it: the four traits are
pack-included and **correctly 0**, and the build's 19 AP of species cost (pack 5 + ×2 pack 10 + Naturally
Stealthy 4) is right.

**The lesson, and the reason this record exists:** *`compute()` on a truncated event log is not evidence.*
The fold is order-dependent and intermediate states can be incoherent. Reason about the final build, or
about deltas the tool actually computed — never about a prefix of somebody else's log.

## The actual mechanism

`compute()` derives pack cost from `b.species` / `b.species2` alone (`js/engine.js:177-178`), so a pack is
never an event **by design**. The defect is in how the identity event's delta was produced:

1. The four traits were committed to the LOG **before** the identity event, each recorded **0** — CharGen's
   form already knew the species even though no identity event had been written.
2. `priceOf()` priced identity as `compute(after) − compute(before)`. `compute(before)` sees traits owned
   with no species, prices them as cross-race — **21 AP the log never charged**.
3. The delta therefore *refunds a phantom 21* while adding the real +15 of packs, landing at **−5**.

Verified: `compute()` on the log truncated just before the identity event returns **21**; recorded costs to
that point sum to **0**. From that event onward the frozen ledger and `compute()` stay ~18 apart for the
character's life.

**The general failure — this is the durable finding.** `priceOf()` computes deltas against
`compute(build)`, but recorded costs are never held equal to `compute()`. Once the two diverge for any
reason, every later delta **compounds** the error instead of correcting it. Ordering is one trigger; it
will not be the only one.

## Decision

> **⚠ Addendum (2026-08-05) — H2 below is SUPERSEDED by `D-GH-2026-08-05-pricing-model`. Do not build it.**
> H2 aimed to make each event's recorded cost equal `compute()`'s delta by construction. That delta is
> *exactly* what `priceOf()` already returns — the contaminated number — so H2 formalises the defect rather
> than fixing it. The acceptance test below is likewise wrong as a general property: prices freeze at
> purchase while `compute()` re-prices at today's context, so the two are *meant* to diverge for any
> character who has levelled or unlocked a class. It holds only for a character built entirely at one
> context, which is what its own "freshly built character" wording actually scoped. Everything **above**
> this line — the reproduction, the two wrong diagnoses, the mechanism — still stands and is the right
> starting point. Two rounds of external cold review (9 reviewers) preceded the reversal; artefacts under
> `zUser-Uploads/`.

**H2 — the invariant route** (owner, 2026-08-04), over H1 (make CharGen commit the identity event before
any trait that depends on it).

- **H1** is smaller and fixes this reproduction, but leaves `priceOf()`'s fragility intact — the next
  ordering accident reintroduces the same drift silently.
- **H2** makes every event's recorded cost equal `compute()`'s own delta *by construction*, so the frozen
  ledger cannot drift regardless of event order. Emitting packs as their own visible events — the owner's
  stated intent, since they are real allowable purchases granting species abilities at a discount — sits
  inside this.

**Acceptance test:** for a character built entirely under one rules version, the sum of frozen costs must
equal `compute().total`. It fails today at 15 vs 33.

## Why this is not fixed in the same session

Rules-adjacent, and it carries a migration decision that is the owner's to make, not an implementation
detail: Anders, Fenwick, Cedric and every already-built PC carry under-recorded ledgers. Either they stay
grandfathered (consistent with the app's stated rule that price drift is never refunded or charged) or a
one-off reconciliation event is emitted. The task specifies a cold plan review before implementation.

## Related

`feat/ap-model-reconcile` must sequence **after** this, since this changes what the frozen ledger contains
— and G1 (see that task) already commits "AP left" to the frozen figure.
