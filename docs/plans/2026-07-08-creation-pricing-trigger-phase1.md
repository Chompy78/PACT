# Plan: Character-generation-complete trigger in js/engine.js (Phase 1 of 3)

## Goal
Replace the currently-dead `b.inPlay` flag in `js/engine.js`'s `compute()` with a real, per-purchase,
LOG-driven "is this purchase still at creation pricing?" fact — triggered either automatically
(cumulative AP spend crosses a configured threshold) or manually (an explicit LOG event, which takes
precedence over the automatic inference) — so creation-vs-locked pricing becomes deterministic and
event-sourced instead of an unused per-tool default. This is Phase 1 of a larger effort to eventually
unify two tools (a one-shot character builder and an ongoing event-sourced character sheet) onto one
data model; Phase 2 (rewriting the builder tool) and Phase 3 (per-campaign/DM configuration UI) are
separate, later plans, and Phase 1 alone ships no visible behavior change until one of them lands (see
"Risks," below — this dependency is deliberate and stated up front, not hidden).

## Context
Repo rules (paraphrased — the reviewer cannot open these files): a single shared rules engine module is
the sole source of truth for all game rules; UI tools must never re-implement rules logic locally. The
project is vanilla JS, no build step, static-file deployment. A regression-test gate must report all
fixtures passing after any change; if a change alters the rules engine's costing output, the
fixtures/expected-values file must be updated in the same change and a rules-data version counter bumped
— this project tracks that counter separately from a cosmetic build/display version counter, and is
strict about not bumping the wrong one. Architectural decisions get logged in a decisions file with
Context/Options/Decision/Why/Status, one entry per decision.

This session found and fixed (logged as decision "D-GH30") a bug where one tool's displayed "AP
remaining" disagreed with what it actually let a player spend, because a stateless, order-free full
recompute function and a separate frozen-ledger AP tracker (event-sourced, order-aware) applied
retroactive discounts differently. The fix was display-only. A follow-up item was filed to reconcile the
two pricing models — this plan supersedes that item with a more fundamental redesign: one model instead
of two. **A cold review of this plan's first draft caught that the original design (a single whole-build
boolean flag) would reproduce the exact same bug shape as D-GH30** — a later state change retroactively
repricing earlier purchases — so the design below uses per-purchase tagging instead (see step 2).

## Assumptions vs. verified facts
- **Verified (read directly in the code):**
  - The rules engine's costing function has a `b.inPlay` boolean affecting exactly one thing today:
    racial/species trait pricing (own-race non-pack traits price at a current-tier lookup table if true,
    a flat creation price if false).
  - The referenced creation-anchor number (`DATA.level1AP`) is **not actually defined anywhere** — every
    reference falls back to a literal `45`. It doesn't exist as real data today.
  - The build-construction function sets `inPlay: true` unconditionally, and a repo-wide search found
    `inPlay: false` set in exactly one place — a one-off display comparison in one tool, never real build
    state. **In real usage today, `inPlay` is always `true` for every existing character.** This matters
    directly for migration (see below): there is no existing character anywhere with `inPlay: false`
    baked into its behavior, so "what do old saves do under the new logic" has a clean, narrow answer.
  - The shared replay function that folds a LOG into a build only special-cases three event types
    (`name`, `names`, `buy`); every other event type — including any type it's never seen before —
    silently falls through and is skipped. **Confirmed: an older engine encountering a new event type in
    a LOG already degrades safely for free**, no extra compatibility code needed for that direction.
  - One tool already has a function that converts its finished, one-shot build into a synthetic event
    log matching the other tool's native format (one event per purchase, costs as before/after deltas)
    — but only at one-time export, not as ongoing live state.
  - A per-campaign settings mechanism already exists (an arbitrary rules object a DM can set, consumed by
    a `validate(build, rules)` check) — the natural home for Phase 3's threshold configuration.
- **Assumed (not yet confirmed — flagged for review):**
  - That per-purchase tagging (step 2) is implementable within the existing replay function without a
    deeper rewrite of the build's data shape beyond what's described below.
  - That existing saves genuinely have no `inPlay: false` state anywhere outside the one verified display
    comparison — verified by grep, not by exhaustively auditing every stored character.

## Proposed approach

**Step 0 (independent precursor, ships first, its own commit):** Define the creation-anchor number as a
real, defined data field instead of an inline fallback literal. This is a no-op today (every call site
already falls back to the same value) — no rules-version bump needed, no fixture changes, and it
shrinks the real mechanics-change diff in step 2+ for easier review.

**Step 1 — define what the trigger represents (a decision, not an implementation detail).** The trigger
models **"this specific purchase is no longer eligible for creation pricing,"** not "the character has
entered play" or "character generation is narratively finished." This narrower framing is deliberate: a
DM-created veteran NPC built directly above the anchor, a campaign that starts characters above level 1,
or a character imported from elsewhere are not edge cases of this mechanic — they're simply never in the
"at or below the creation anchor" state to begin with, so nothing about them is ambiguous under this
framing. The event is named `creationLocked` for the same reason — it describes exactly what it does
(locks creation pricing going forward) without overclaiming narrative significance.

**Step 2 — per-purchase tagging, not a whole-build flag.** A single global `b.inPlay` boolean, if it
gates pricing for every trait in the finished build, has no memory of *when* the trigger fired relative
to *when* the trait was purchased — it would misprice everything the same way regardless of order,
which is the same defect class as D-GH30. Instead: the replay function tracks whether `creationLocked`
has been seen yet as it walks the LOG in order, and **tags each racial-trait purchase at the moment it's
replayed** with whether the lock was already active for that specific purchase. The costing function then
prices each trait line item from its own tag, not from one build-wide flag. Concretely, this likely means
`b.racialTraits` (currently a flat array of trait-label strings) grows a parallel per-entry marker (or
becomes an array of `{name, lockedAtPurchase}` pairs) — a real, if small, build-shape change, called out
explicitly here so it isn't discovered mid-implementation.

**Step 3 — trigger precedence and event semantics** (all decided now, not left implicit):
- If an explicit `creationLocked` event exists anywhere in the LOG, it wins — explicit intent overrides
  the inferred threshold, regardless of LOG order relative to the threshold being crossed.
- If no explicit event exists, the threshold (`DATA.level1AP`, cumulative AP spend) is used as an
  inference at replay time — not written back into the LOG as if it were a real event.
- A second `creationLocked` event, if one is ever emitted twice, is a no-op (idempotent — first one
  wins).
- No un-lock event exists or is planned. This is a one-way ratchet; stated explicitly so a future change
  doesn't casually add reversibility without re-opening this design.
- Unknown-event forward-compat is free, per the verified fact above — no extra work needed for an older
  engine to safely ignore this new event type.

**Step 4 — event ownership** (decided now): **In Phase 1, neither tool emits this event.** The event type
and the replay/costing logic exist in the engine, covered by fixtures, but nothing in either tool's UI
produces a `creationLocked` event until Phase 2 or 3 wires up a trigger button/threshold config. This is
intentional — Phase 1 proves the mechanism in isolation — but it means **Phase 1 alone changes nothing
about either tool's real behavior**, a dependency that is stated openly here rather than implied away
(see "Risks").

**Step 5 — scope of what gets repriced (the Option A/B/C fork).** A cold review of this plan's first
draft and this plan's own analysis independently converged on the same answer: **ship Option B — keep
repricing scoped to racial/species traits exactly as today; the only new work is making the existing
mechanic real** (driven by the LOG instead of a hardcoded `true`). This is the smallest change that
proves the event model, the per-purchase tagging design, and the migration strategy, with minimal
behavioral change to verify. Generalizing to more purchase categories (the previously-drafted Option A)
or making category scope data-driven (Option C) are explicitly deferred to a future phase, as a separate
mechanics change once Phase 1's model is proven in real use — not decided here.

**Step 6 — migration (a first-class decision, not a note).** Because `inPlay` is verified to be `true`
for every existing character today, and Phase 1 only *adds* the ability for a purchase to be tagged
"unlocked" (creation-priced) — it never removes that ability from anything that already worked — **the
chosen answer is: infer state from AP totals at replay time, using the exact same threshold logic that
drives the automatic trigger for new characters** (option (c) from cold review, not a special-cased
migration branch). This is deliberately the same code path for old and new characters, not a parallel
migration mechanism — old high-AP characters evaluate as locked (matching today's always-`inPlay:true`
behavior, no visible change), and old low-AP characters below the anchor become eligible for the cheaper
creation-price branch on their racial traits for the first time (a favorable, not adverse, change — see
Verification for how this gets checked before shipping).

**Step 7 — fixtures.** New fixtures covering: spend below threshold throughout (creation pricing
throughout); spend crossing the threshold mid-LOG (creation pricing before, locked after — asserting
per-purchase tagging, not whole-build repricing); an explicit manual `creationLocked` event fired before
the automatic threshold would have (asserting explicit-wins-over-inferred); a duplicate manual event
(asserting idempotence). Expected values hand-confirmed against the rules reference, per this project's
existing review discipline for fixture data.

**Step 8 — versioning and roadmap.** Bump the rules-data version counter (step 2+ changes costing
output); do **not** bump the cosmetic build/display version counter — Phase 1 makes no UI change, stated
explicitly here so its absence doesn't read as an oversight. Log a new decision recording the Step 1
(what the trigger represents), Step 2 (per-purchase tagging vs. whole-build flag, and why the whole-build
version was rejected), Step 6 (migration answer), and a short paragraph on why Phase 1 uses a narrow
per-purchase tag rather than a broader character-lifecycle model (Active/Retired/NPC/Frozen, etc.) — the
lifecycle framing may become relevant if a future phase's needs grow beyond pricing, and per-purchase
tagging doesn't foreclose layering that on top later, but Phase 1's resolved scope (Step 1) is
specifically about pricing eligibility, nothing broader. Close out the superseded roadmap item with a
pointer to the new decision.

## Files involved
- Rules engine module — creation-anchor data field (Step 0); `creationLocked` event handling in the
  shared replay function; per-purchase tagging on racial-trait entries (a build-shape change, not just a
  costing-function change); the costing function's racial-trait pricing branch reads the per-entry tag
  instead of a whole-build flag.
- New fixtures (four, per Step 7) and their expected-value rows.
- Decisions file — new entry per Step 8.
- Roadmap / changelog — close the superseded reconciliation item, add Phase 2/3 as new items.

## Out of scope
- Phase 2 (rewriting the one-shot character-builder tool to operate on a live LOG) and Phase 3
  (per-campaign/per-character threshold configuration UI, DM Console wiring, manual-trigger UI and
  permissions) — separate future plans.
- Migration tooling beyond the replay-time inference in Step 6 (no batch/offline migration script needed,
  since the inference runs identically on every load).
- Generalizing repriced categories beyond racial traits (Option A/C) — deferred.
- A full character-lifecycle state model (Retired/NPC/Frozen/etc.) — deferred, reasoning recorded per
  Step 8 but not designed here.

## Alternatives considered
- **Whole-build `inPlay` boolean** (this plan's own first draft) — rejected: reproduces D-GH30's bug
  shape (a later state retroactively repricing earlier purchases judged by a single build-wide flag).
- **Keep two separate pricing models, only fix their reconciliation** (the original, now-superseded
  roadmap item) — rejected per the requester's explicit preference for one unified model over patching
  the split.
- **Manual-trigger-only, no automatic threshold** — rejected; an automatic path is explicitly wanted.
- **One PR covering the engine change plus both tools' UI plus campaign wiring** — rejected as
  unreviewable at any reasonable size, and because each phase carries independent risk.
- **A full lifecycle state model in Phase 1** — rejected for now (see Step 8); Phase 1's scope is
  narrowly about pricing eligibility, not general character state.

## Risks / open questions
- **Phase 1's value is contingent on Phase 2 or 3 landing.** Nothing emits `creationLocked` until one of
  them does; if neither lands, Phase 1 is a second inert mechanic — the exact situation this effort exists
  to fix. Stated openly, not hidden behind "Phase 1 is independently valuable."
- Per-character override of the Phase 3 threshold is intentionally undesigned here (belongs to Phase 3).
- Whether a manual trigger should be player-permitted or DM-only is undesigned here (belongs to Phase 3);
  matters for whether a player could stay in cheap creation pricing indefinitely by never crossing the
  threshold — may be fine/intended, flagged rather than asserted as a problem.
- The per-purchase build-shape change (Step 2) is the least-verified part of this plan — it's assumed
  implementable within the existing replay function's structure but not yet spiked.

## Verification
- Regression-test gate reports all fixtures passing (baseline today: 5 fixtures, +4 from Step 7).
- **Replay determinism:** replaying the same LOG twice produces byte-identical output.
- **Replay idempotence / cross-tool round-trip:** export the existing one-shot builder tool's synthetic
  LOG export, replay it under the new engine, assert it produces the same final state the builder tool
  showed at export time — this is the same check Phase 2 will need, proven early.
- **Migration check (required, not optional):** replay a realistic pre-existing-shaped LOG fixture (built
  from this project's existing "clean generator export" fixture, since real user save data isn't
  available at plan/implementation time) through both the old always-`inPlay:true` logic and the new
  threshold-inference logic; confirm displayed AP totals and any racial-trait line items either match
  exactly (high-AP case) or show the documented, favorable direction of change (low-AP case) — not an
  unexpected direction. Recommend a follow-up manual spot-check against real production saves before any
  UI in Phase 2/3 makes this visible to users.
- Rules-data version bumped and mirrored per this project's version-sync convention; cosmetic
  build/display version explicitly **not** bumped (no UI change in Phase 1).

## Done when
The rules engine has a real, LOG-driven, per-purchase creation-pricing-eligibility fact (event-based
and/or threshold-based per Step 3's precedence rule); it's covered by the fixtures in Step 7 plus the
determinism/idempotence/migration checks above; the rules-data version is bumped; a decision record
documents Steps 1, 2, 6, and 8's lifecycle-framing paragraph; the superseded roadmap item is closed with
a pointer to the new decision. (Phases 2 and 3 each get their own future "done when," not covered here.)

---

## Reviewer instructions
You are reviewing this plan **cold, with no access to the codebase** — only the text above. You are a
general reasoner, not a code analyzer: judge the plan's **logic, clarity, scope, and risk — not code
correctness you cannot verify.** If the plan relies on knowledge you don't have, that itself is a finding.
Find gaps, unstated risks, and better alternatives — including structural/redesign suggestions, not just
"missing detail" — but do not implement anything. Specifically:
1. Does the proposed approach actually achieve the stated goal?
2. Which of the plan's **assumptions** look shaky, and what happens if one is wrong?
3. Is anything in "Alternatives considered" actually better, or is the plan overcomplicated for the goal?
4. What's missing — an edge case, a risk, a dependency, a **verification step** the plan doesn't mention?
5. Are "Verification" and "Done when" objectively checkable, or do they hide ambiguity?
6. Should this task be split? Is anything in "Out of scope" actually load-bearing?

Write your findings as a plain list (gaps found, suggested improvements, verdict) — don't rewrite the plan
yourself unless asked. **If a section is genuinely solid, say so briefly rather than inventing concerns** —
false findings cost the implementer a wasted cycle.

---

## Review outcome (fill in after the review + implementation — not part of the cold review)
- Reviewer findings: 15 → accept 15 / reject 0 / defer 0 (two items — #10 lifecycle model, #15 scope-cost
  note — were "consider and document," folded in as reasoning rather than design changes)
- Materially changed the plan? **Yes.** The core mechanism changed from a whole-build `inPlay` flag to
  per-purchase tagging (finding #9) — this is a correctness fix, not a style preference: the original
  design would have reproduced D-GH30's exact bug shape. Migration went from an unstated assumption to an
  explicit, verified-consistent design (findings #1-2). Event semantics, ownership, and naming were fully
  specified (findings #3-8) rather than left implicit. Two new verification tests were added (#12-13).
- Without the review, what would have happened: **a real risk was caught, not a stylistic nit.** The
  original Phase 1 design, if implemented as first drafted, would have shipped a second instance of the
  exact bug class this entire multi-session effort exists to eliminate — a later event retroactively
  repricing earlier purchases — inside the very mechanism meant to prevent it.

## Implementation notes (added while building Phase 1 — corrections to this plan's own claims)
- **`DATA.level1AP` correction:** this plan's "Assumptions vs. verified facts" section stated
  `DATA.level1AP` "is not actually defined anywhere" and Step 0 proposed defining it as a precursor commit.
  Both were **wrong**. The verification search used a regex (`level1AP\s*:`) that missed the real text —
  `js/engine.js`'s entire `DATA` object is a single ~194,000-character line, and the field is written
  `"level1AP":50` (a quoted JSON-style key with no whitespace before the colon). `DATA.level1AP` already
  existed, as `50`. Step 0 was skipped entirely; the real value was used directly in Step 6's threshold
  check. Flagged here so a future reader trusts the DECISIONS.md D-GH31 entry (which has the corrected
  version) over this plan document where they disagree.
- **A gap not caught by cold review, found only by building and testing the mechanism:** a one-shot
  import/creation burst whose total legitimately exceeds `DATA.level1AP` (e.g. a higher-level starting
  character) self-triggered the automatic lock partway through the burst, mispricing racial traits bought
  later in that *same* burst — verified concretely: a simulated CharGen-style import (150 AP budget, an
  80 AP bulk creation cost, two racial traits) priced both traits at 22 AP total instead of the correct 6.
  Presented to the project owner as three options; **resolved by adding `e.noLock: true`**, an optional
  field on `buy`/`buyoff`/`names` events that excludes that event's cost from the automatic-threshold
  accumulation (real AP accounting via `economy()` is unaffected). A future Phase 2 CharGen export would
  tag its entire synthetic burst this way; genuine post-import spending (untagged) still triggers the lock
  normally. Verified by two new fixtures, `EV-006` (import burst stays unlocked) and `EV-007` (genuine
  post-import spend still locks a later purchase). This gap existed in every version of this plan the cold
  reviewer saw — it was invisible without actually running the mechanism against a realistic import shape.
- **Final Phase 1 status:** shipped on branch `claude/live-sheet-task-fkqj92` (commits implementing the
  mechanism, then the `noLock` fix). `testing/tests/engine-parity.html` → **11/0** (5 pre-existing +
  6 new: `EV-002` through `EV-007`). All 5 pre-existing fixtures verified byte-identical to their
  pre-change output. Replay determinism verified across all 7 event-log fixtures. `DATA.version`
  v0.332→v0.333. See `DECISIONS.md` D-GH31 for the authoritative record.
