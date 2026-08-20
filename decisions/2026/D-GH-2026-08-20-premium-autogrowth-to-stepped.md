# D-GH-2026-08-20-premium-autogrowth-to-stepped — Rage/Wild Shape/Bardic Inspiration die become stepped-Premium; hard prerequisite blocking; three more features retrofitted

## Context

`pact-guide`'s `D-2026-08-19-premium-autogrowth-to-stepped` found that 3 of the Premium band's 20
features (Rage, Wild Shape, Bardic Inspiration die) grow in power for free as a character levels, with no
further AP spend after the initial Premium unlock — an underpriced-value problem the other 17 Premium
items don't share. That decision's mechanism (convert to Stepped, chained by prerequisite, per-track
banding, a 50% post-unlock discount) was cold-reviewed there (4 reviewers) and finalized with exact
per-step AP tables. This record is the implementation side, plus three further decisions made during a
follow-up design conversation with the owner in this repo:

1. **Hard block, not warn.** The engine's prerequisite check (`js/engine.js`, previously scoped to
   Warlock invocations only) was advisory-only — `W.push()`, never a purchase gate. The owner directed
   that the widened check (now covering any `f.prereq`-bearing feature, per the source decision) become
   an actual hard block: a prerequisite-violating purchase is excluded from pricing and ownership, not
   just warned about.
2. **Track-scoped, confirmed by the owner directly.** Rage's Damage track (`+3 damage` → `+4 damage`)
   and Uses track (3→4→5→6 uses) never gate each other; same for Wild Shape's Capability and Uses
   tracks. Each step's only hard prerequisite is the prior step in its own track.
3. **Retrofit three more features to the same shape.** Sneak Attack, Martial Arts die, and Unarmored
   Movement — already-shipped Stepped features priced at full tier/band cost for every step — were
   extended to the identical "unlock, then half-price named steps" pattern, at the owner's explicit
   request after reviewing worked comparison tables for all 6 features together.

## Decision

- **Engine (`js/engine.js`):** the prerequisite check runs for any feature declaring `f.prereq`
  (previously `f.inv`-only). It's a fixed-point pre-pass over `b.features` — a feature whose prereq isn't
  owned, or whose prereq is itself blocked (a skipped intermediate step), is added to a `_blockedFeat`
  set before pricing runs. Blocked features are excluded from `featAP`/ownership entirely: 0 cost, no
  benefit, itemized separately under a new **"Blocked purchases"** ledger line (`addDisplay`, doesn't
  count toward `total`) so the exclusion is visible rather than silent. A fixture-verified side effect:
  the 8 existing Warlock invocation prerequisites also go from warn-only to hard-blocked, since they share
  the one widened check.
- **Data (`js/engine-data.js`, `DATA.version` v0.357 → v0.358):**
  - **Rage** (7 steps: unlock + 6): Uses track (T3→T4→T5→T7, 4 steps) and Damage track (T4→T6, 2 steps),
    both branching from the T1 Premium unlock (12/13 AP, price unchanged). Total origin 43 AP.
  - **Wild Shape** (5 steps: unlock + 4): Capability track (T3→T4, **Passive** band — changed from the
    source decision's original At-Will, an owner call made in this session) and Uses track (T4→T7),
    branching from the T2 Premium unlock (13/16 AP, unchanged). Total origin 35 AP.
  - **Bardic Inspiration die** (4 steps: unlock + 3): single track, T4→T5→T6, from the T1 Premium unlock
    (12/13 AP, unchanged). Total origin 27 AP.
  - **Sneak Attack** (10 steps: unlock + 9): unlock repriced from T1 At-Will (4/5) to **T1 Premium**
    (12/13). Steps follow the die's real 5e breakpoints (2d6@L3, 3d6@L5, 4d6@L7 [T4, shared tier with
    3d6], 5d6@L9, 6d6@L11 [T5, shared], 7d6@L13, 8d6@L15 [T6, shared], 9d6@L17, 10d6@L19 [T7, shared]) —
    these tiers were **not invented**; they were already documented, correctly, in the guide's own Rogue
    class table (see "Course correction" below). Total origin 70 AP.
  - **Martial Arts die** (4 steps: unlock + 3): unlock repriced from T1 At-Will (4/5) to **T1 Premium**
    (12/13). Steps at the real breakpoints d8@L5(T4), d10@L11(T5), d12@L17(T7) — same source. Total
    origin 32 AP.
  - **Unarmored Movement** (5 steps: unlock + 4): unlock **unchanged**, T2 Passive (7/10) — the owner
    chose not to reprice this one's base into Premium. Steps at the real breakpoints +15ft@L6(T4),
    +20ft@L10(T5), +25ft@L14(T6), +30ft@L18(T7) — skips T3 entirely, per the guide's existing table — in
    **Situational** band (an owner call this session, changed from Passive). Total origin 25 AP.
  - Every post-unlock step across all 6 features prices at exactly `round_half_up(0.5 × the ordinary
    one-time tier/band price)` — verified by hand for all 21 steps before implementation, not sampled.
- **Regression coverage:** 12 new fixtures (`CG-021`–`CG-032`) — full-chain in-order purchases for all 6
  features, out-of-order hard-block for Rage/Bardic Inspiration, cross-track independence for
  Rage/Wild Shape, and two permanent regression guards for the Warlock-invocation warn→block change
  (a direct block and a transitive multi-link block) plus a guard for a bug the post-implementation code
  review caught (see below).
- **UI (`tools/PACT-CharGen-Webtool.html`, `tools/DM-Console.html`):** the new "Blocked purchases" ledger
  line wired into each tool's existing `SECTIONS`/`LGROUPS` category arrays (the `Classes`/`Class &
  Heritage` group — no new section added; CharGen's `SECTIONS` array is positionally bound to markup
  `#secN` ids, `audit.py`-asserted equal length) plus an explain-text entry in CharGen matching the
  existing "Lost purchases" precedent. Live Sheet has no equivalent categorization structure, so no change
  needed there.
- **Guide (`docs/PACT-Players-Guide.html`):** every passage describing what "Premium" means and how the
  stepped discount works was rewritten — the band definition table, the "Why Premium sits above Passive"
  and "Reading the cost table" callouts, the section 11 intro/litmus-test/worked-examples, the "How to
  read the Status column" callout, the "Growing feature" table (now lists all 6 features with their real
  totals), the "Three homes for growth" callout (now four: Premium-once, stepped-Premium, stepped-half-
  price-ordinary-base, ordinary-stepped-full-price), and both glossary entries for Premium/Stepped. The
  Rogue and Monk class tables' Sneak Attack/Martial Arts die/Unarmored Movement rows were repriced to the
  new half-price numbers. Verified against the live engine with `testing/scripts/guide-price-check.mjs`:
  **0 price-mismatches** (was 17 before the class-table fix — see "Course correction").

## Why

C (Stepped conversion) was already decided in the source record; this repo's job was implementation.
Track-scoping and the hard block were the owner's direct answers to two questions the implementation
plan explicitly left open for them (see the plan's v2 "Out of scope"/Risks — reproduced in
`docs/plans/2026-08-19-premium-autogrowth-to-stepped-cold-review.md`) rather than assumed. The Wild
Shape Capability→Passive and Unarmored Movement→Situational band changes were made directly by the
owner while reviewing comparison tables mid-session, after seeing the At-Will-band numbers.

**Why retrofit three more features instead of stopping at the source decision's scope.** The owner
explicitly chose "all 6 features" when asked, after being shown that Sneak Attack/Martial Arts die and
Unarmored Movement were the only other Stepped features in the dataset and that leaving them at full
price while three siblings got a 50% discount would be an odd, unexplained inconsistency. Accepted with
the tradeoff named: these three are live, shipped abilities (unlike the pre-launch-only original three),
so this is a real price change to existing character math, not just new content.

## Course correction (worth recording, not just fixing silently)

The first implementation pass invented generic placeholder step labels and consecutive-tier progressions
(T2→T7) for Sneak Attack/Martial Arts die/Unarmored Movement, reasoning that no verified level-breakpoint
data existed for them — the same caution this repo's `AGENTS.md` calls for ("verify before writing an
absence claim"). That caution was under-applied: a `testing/scripts/guide-price-check.mjs` run mid-session
surfaced that the guide's own Rogue and Monk class tables **already had real, correct 5e-sourced
breakpoints** for all three (Sneak Attack scales at 10 points not 7; Martial Arts die has only 3 real
upgrade tiers, not 6; Unarmored Movement skips T3 entirely) — just never wired into `engine-data.js`,
which had them as flat `rep:true` auto-formula entries that didn't match the guide's documented shape at
all. The placeholder data was fully replaced with the guide's real breakpoints before this shipped; the
guide's own price table was itself the missing verification step. Also caught by `/code-review ultra`
post-implementation: the "Invocation breadth surcharge" (`js/engine.js`) counted a hard-blocked invocation
toward the count of genuinely-owned ones, overcharging AP; and two guide callouts self-contradicted the
guide's own tables by claiming Martial Arts die/Unarmored Movement were full-price when they're half —
both fixed in the same session, with new regression coverage.

## Status

**Active — implemented, tested, guide-synced within this repo.** `testing/tests/engine-parity.html` → 52
passed / 0 failed. `guide-price-check.mjs` → 0 price-mismatches. **Not yet complete by this repo's own
"mechanics change isn't finished until engine and guide land it" rule:** `docs/PACT-Players-Guide.html`
is a served copy, not the master — the `pact-guide` project's canonical guide still needs the identical
prose/table changes transferred over (manual, verified procedure per `docs/VERSION-SYNC.md`), and that
project's own `D-2026-08-19-premium-autogrowth-to-stepped` record needs its "Status" section updated to
reflect this implementation landing. Tracked as a follow-up, not silently assumed done.

## Related

- `pact-guide`'s `D-2026-08-19-premium-autogrowth-to-stepped` — the mechanism decision and original
  finalized tables this implements.
- `docs/plans/2026-08-19-premium-autogrowth-to-stepped-cold-review.md` — the implementation plan, cold-
  reviewed by 4 models, with the full v1→v3 revision history and the owner-direction addendum.
