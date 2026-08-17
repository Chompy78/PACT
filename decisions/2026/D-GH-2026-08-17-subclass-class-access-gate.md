# D-GH-2026-08-17-subclass-class-access-gate — Subclass purchases warn when the class is neither origin nor unlocked; the framing that motivated it was wrong, and the gate is provisional

**Status:** Implemented as a ⛔ warning (`DATA.version` v0.347). **Contested — do not treat as settled.**

## Context

The guide says:

> "Each class you can build from gives you one subclass for free: pick it, and you may buy its expanded
> spell list and any of its abilities at their normal prices."

Nothing enforced the *"you can build from"* half. A Fighter with no Cleric access could buy Life
Domain's spell list for 8 AP — and because a bought bundle registers in `subUsed`, it also claimed that
domain as the class's **free** subclass, so no 15 AP subclass unlock landed either. Three lists from
three foreign classes cost **35 AP** with no class unlock, no subclass unlock, and no warning.

## Options

- **AC1 — gate it** (require origin or unlocked). ← implemented
- **AC2 — remove the gate**; treat cross-buying as intended dabbling.
- **AC3 — gate abilities, exempt bundles.**
- **AC4 — no gate; fix the pricing so the legitimate route is never dominated.**
- **AC5 — a per-subclass "dabbling licence"**, proposed by a reviewer; between cross-buying and a full
  class unlock, creditable toward a later unlock.

## Decision

`compute()` pushes a ⛔ warning when a subclass purchase's class is neither an origin class nor
unlocked. **Warn, not refuse** — matching every other prerequisite in `engine.js`. Prices unchanged, so
`testing/expected/` needed no update. Applies to subclass **abilities** as well as bundles: they share
the `subUsed` mechanism and one guide sentence covers both.

## Why — and the correction that matters most

**The analysis that motivated this gate was partly wrong, and that is recorded here deliberately.**

The cold-review document (`docs/plans/cold-reviews/`) presented the per-feature cross-class route as a
"ladder dodge" and an "inverted penalty" — a defect. **§11 blesses that route explicitly:**

> "Or you can **skip the unlock** and buy individual features at the cross-class surcharge (+Tier each)."
>
> "Unlocking pays off once you want several features from a class; **the per-feature surcharge is cheaper
> for a single dip.**"
>
> "This **mirrors how subclasses are bought**."

The measured break-even (unlocking pays from 2–3 purchases) **confirms** the guide's stated curve rather
than exposing a fault. The author never grepped for this despite having the guide locally throughout;
three of four reviewers caught it.

**What survives as a genuine defect is narrower: the ladder does not accrue.** Only *unlocked* classes
count toward the escalating `0, 7, 21, 42, 70` unlock cost, so a permanent dabbler stays on
first-class pricing forever. A Fighter taking one ability from each of four foreign classes pays 53 AP
and their next unlock is still priced as if they owned none — against 111 AP for doing it properly.
That is a composition bug between the surcharge and the ladder, **not** a reason to forbid the surcharge.

## Where the reviewers landed

| Reviewer | Gate abilities? | Gate bundles? |
|---|---|---|
| M365 Copilot (GPT-5) | yes, temporarily | no |
| Copilot (Claude Opus 4.8) | no — reprice | no |
| GPT-5.6 Luna | no | no |
| "DeepSeek" (self-IDs as Claude Sonnet 3.7 — provenance unclear) | yes | yes |

**3–1 against gating bundles; 2–2 on abilities.** All four said split the decision. Two independently
observed that a hard prohibition is the one thing PACT does *not* do with class boundaries — it prices
them. The species precedent (Tier 2+ traits are origin-species-only) cuts the other way on inspection:
PACT locks *innate* things and prices *acquirable* ones, and class access is explicitly purchasable.

## Known incompleteness

**The gate is bypassable.** All 192 subclass abilities are mirrored into `DATA.features` (188 in
`featureList`, so CharGen's *feature* picker offers them). That route skips `subUsed` entirely, so it
raises no warning and consumes no subclass slot. Buying the same ability through both pickers charges
twice with no warning. Tracked as `refactor/subclass-purchase-unify` on the NEXT board.

## Next step

Do **not** act on the existing reviews as though they answered the right question — their premise was
the author's wrong framing. A fresh, correctly-framed decision should ask only: *given that the
surcharge route is intended, should the gate exist at all, and should the ladder accrue?* v0.350 has
since made the bundle half of the question moot for pricing purposes.
