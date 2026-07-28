# D-GH31 — A LOG-driven `creationLocked` event/threshold replaces the dead `b.inPlay` flag (engine Phase 1)

Status: Active

- **Context:** the owner proposed unifying CharGen and Live Sheet onto one event-sourced character model,
  with an explicit trigger marking when "character generation" ends and creation pricing stops applying —
  a more fundamental alternative to reconciling `compute()`/`economy()` (D-GH30's deferred
  `feat/ap-model-reconcile`). Investigation found `js/engine.js`'s `compute()` already had a `b.inPlay`
  flag doing exactly this, narrowly (racial/species trait pricing only) and inertly: `baseBuild()` sets
  `inPlay:true` unconditionally, and a repo-wide search found `inPlay:false` set in exactly one place — a
  display-only comparison, never real build state. A self-contained plan (`docs/plans/2026-07-08-creation-
  pricing-trigger-phase1.md`) was written, cold-reviewed (15 findings, all accepted), and revised before
  implementation.
- **Options considered (racial-trait repricing scope, Option A/B/C from the plan):** (A) generalize
  post-lock repricing to all purchase categories; (B) keep it racial-traits-only, just make the existing
  mechanic real; (C) make category scope data-driven via `DATA`. Also considered, and rejected during the
  plan's cold review: a single whole-build `inPlay` boolean set once triggered — rejected because it has
  no memory of purchase order, reproducing D-GH30's exact bug shape (a later state retroactively repricing
  earlier purchases).
- **Decision:** shipped **Option B** (racial-traits-only, matching today's scope) via **per-purchase
  tagging, not a whole-build flag**. `_replay()` walks the LOG once, tracking a one-way-ratchet `locked`
  state (an explicit `creationLocked` event, or cumulative AP spend exceeding `DATA.level1AP`, whichever
  comes first) and tags each racial-trait purchase with the lock state as of *just before* that specific
  purchase — so purchase order within one build is respected. `compute()`'s racial-trait pricing branch
  reads this per-trait tag (`b._raceTraitLocked[label]`) instead of `b.inPlay`; a build with no tag for a
  given trait (e.g. a flat one-shot creation build with no LOG at all) always prices at the creation rate,
  by design. A build-time correction: the plan assumed `DATA.level1AP` didn't exist (a regex miss during
  planning — the real text is `"level1AP":50` inside `js/engine.js`'s single-line `DATA` object literal,
  not matched by a `level1AP\s*:` search); it already existed as `50`. The plan's "Step 0" precursor was
  therefore unnecessary and skipped; the real value was used directly. A second gap, found only by
  actually building and testing the mechanism (not caught by cold review): a one-shot import/creation
  burst whose total legitimately exceeds the anchor (e.g. a higher-level starting character) would
  self-trigger the automatic lock partway through the burst, mispricing racial traits bought later in that
  *same* burst — before any real in-play spending occurred. Fixed with an event-level `noLock: true` flag:
  a `buy`/`buyoff`/`names` event so tagged is excluded from the automatic-threshold accumulation (real AP
  accounting via `economy()` is unaffected); a future CharGen-style export can tag its whole synthetic
  burst this way, while genuine post-import spending (untagged) still triggers the lock normally. Verified
  by fixture (`EV-006`/`EV-007`).
- **Why:** per-purchase tagging over a whole-build flag because the alternative provably reproduces
  D-GH30's bug class — this was the cold review's single most consequential finding. Option B over A/C
  because it's the smallest change that proves the event model, tagging design, and migration strategy,
  with the narrowest surface to verify; A/C are deferred to a future phase once B is proven in real use.
  Migration: `inPlay` is verified `true` for every existing character today, so the new logic can only
  ever make an existing low-AP character's racial-trait pricing *cheaper*, never more expensive — no
  separate migration mechanism needed, the same replay-time inference just runs uniformly on old and new
  LOGs alike.
- **Status:** DONE for the engine mechanism (`js/engine.js` `DATA.version` v0.332→v0.333; 6 new fixtures,
  `EV-002`–`EV-007`; `testing/tests/engine-parity.html` → 11/0). **Not done:** no tool emits a
  `creationLocked` event yet — CharGen, Live Sheet, and DM Console are all untouched in this phase, so
  nothing about either tool's real behavior changes until a Phase 2 (CharGen rewired onto this model) or
  Phase 3 (per-campaign/DM threshold configuration) lands. `feat/ap-model-reconcile` (D-GH30's deferred
  item) is superseded by this decision and closed in `docs/PACT_ROADMAP.md`/`CHANGELOG.md`.
