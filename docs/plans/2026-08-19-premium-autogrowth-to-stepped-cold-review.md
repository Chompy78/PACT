# Cold Review Plan: Convert Rage / Wild Shape / Bardic Inspiration die to Stepped pricing (v2, post cold-review)

> **v2 changes, in one line:** added the finalized step tables (v1 promised them and never included
> them — every reviewer caught this); fully re-verified the "50% of lookup" claim across all 13
> post-unlock steps instead of one hand-checked sample, with the exact rounding rule; resolved the
> block-vs-warn and mechanical-effect-gating ambiguity by reading `compute()` directly (both confirmed —
> see Verified); named the exact files/line/constants; and restructured into the workstream split all
> four reviewers converged on independently. Full triage table at the bottom.

## Goal
Implement `js/engine.js` + `js/engine-data.js` changes so that Rage (Barbarian), Wild Shape (Druid), and
Bardic Inspiration die (Bard) — currently flat-once purchases whose in-game benefit keeps growing with
Hit Dice at no extra cost — become multi-step purchases the player must buy again at named tiers to keep
their AP spend proportional to the benefit, per the finalized AP tables below. This is a pricing/data
change to a static, vanilla-JS web app's shared rules engine, not a UI change and not a change to any
in-game mechanical value (see "What this change does and does not enforce" under Verified — resolved in
v2, was an open question in v1).

## Assumptions vs. verified facts

**Verified (read directly from the current code at commit `225ca0879a7c33a4ac2f24487058061191e60dae`,
`origin/preview` tip — re-verify at implementation time if the dataset has moved on):**

- **File/symbol identification (a v1 gap — reviewers couldn't tell what to edit).** The shared rules
  module is `js/engine.js`, its `compute()` function (defined at `export function compute(b, opts)`,
  currently line 196). The prerequisite check to widen is at lines 380-382. The pricing dataset is the
  sibling file `js/engine-data.js`, whose dataset-version marker is the string literal at `"version":` —
  currently `"v0.357"`. This is a *different* constant from the cosmetic build-version marker
  `export const BUILD = "v1.432"` in `js/engine.js`, which this change must **not** touch (it's bumped
  only when a `preview`→`main` promotion PR lands, a separate, unrelated process step).

- **The existing stepped-purchase ("Sneak Attack/Extra Attack"-style) mechanism, exact formula:** on the
  Nth purchase of a feature flagged `rep:true`, `tier = min(7, f.tier + n - 1)`; price is looked up as
  `stick = MASTER[tier][band]` from a fixed table (`MASTER["1"..."7"]`, 5 columns per tier —
  `[Situational, Per-Rest, At-Will, Passive, Premium]`, one `band` per feature, constant across that
  feature's own repeat purchases); then `origin = max(1, stick - (tier-1))`, `cross = stick + tier`.

- **The finalized step tables (below) do not fit that mechanism as-is:** tiers are non-consecutive and
  repeat (Rage: 1,3,4,4,5,6,7 — skips T2, repeats T4; Wild Shape: 2,3,4,4,7; Bardic Inspiration: 1,4,5,6 —
  the one ability whose tiers *are* consecutive after the unlock, but still skips T2-T3), and the price
  *band* changes mid-chain by track, not by a fixed per-feature value.

- **Every one of the 13 post-unlock step prices is exactly reproducible** as
  `round_half_up(0.5 × X)` where `X` is what the *existing, unmodified* `rep:true` formula above would
  produce for that step's `(tier, band)` if it were priced as an ordinary next purchase — checked for
  **every step, not sampled** (v1 checked one and over-claimed "every"; this was reviewers' most-repeated
  finding). Full audit table:

  | Ability | Step | Tier/Band | Full-price origin/cross (`X`) | ×0.5, rounded | Table value | Match |
  |---|---|---|---:|---:|---:|---|
  | Rage | 2 (Uses) | T3/Per-Rest | 6 / 11 | 3 / 6 (5.5→6) | 3 / 6 | ✓ |
  | Rage | 3 (Uses) | T4/Per-Rest | 8 / 15 | 4 / 8 (7.5→8) | 4 / 8 | ✓ |
  | Rage | 4 (Damage) | T4/At-Will | 10 / 17 | 5 / 9 (8.5→9) | 5 / 9 | ✓ |
  | Rage | 5 (Uses) | T5/Per-Rest | 10 / 19 | 5 / 10 (9.5→10) | 5 / 10 | ✓ |
  | Rage | 6 (Damage) | T6/At-Will | 14 / 25 | 7 / 13 (12.5→13) | 7 / 13 | ✓ |
  | Rage | 7 (Uses) | T7/Per-Rest | 14 / 27 | 7 / 14 (13.5→14) | 7 / 14 | ✓ |
  | Wild Shape | 2 (Capability) | T3/At-Will | 8 / 13 | 4 / 7 (6.5→7) | 4 / 7 | ✓ |
  | Wild Shape | 3 (Uses) | T4/Per-Rest | 8 / 15 | 4 / 8 (7.5→8) | 4 / 8 | ✓ |
  | Wild Shape | 4 (Capability) | T4/At-Will | 10 / 17 | 5 / 9 (8.5→9) | 5 / 9 | ✓ |
  | Wild Shape | 5 (Uses) | T7/Per-Rest | 14 / 27 | 7 / 14 (13.5→14) | 7 / 14 | ✓ |
  | Bardic Insp. | 2 | T4/Per-Rest | 8 / 15 | 4 / 8 (7.5→8) | 4 / 8 | ✓ |
  | Bardic Insp. | 3 | T5/Per-Rest | 10 / 19 | 5 / 10 (9.5→10) | 5 / 10 | ✓ |
  | Bardic Insp. | 4 | T6/Per-Rest | 12 / 23 | 6 / 12 (11.5→12) | 6 / 12 | ✓ |

  Rounding rule, now pinned down (a second v1 gap): **round-half-up** on the `×0.5` result (every `origin`
  value in this set happened to already be even, so only `cross` ever exercises the half-integer case;
  all 13 confirm round-half-up, never round-half-even/truncate/ceiling). The existing formula's own
  `max(1, …)` floor is inherited unchanged — never actually triggered by these 13 steps, since none halve
  below 1.
  → **Because this is exact and total, not partial, the recommended implementation (see Proposed
  approach, step 3) is to derive these 13 prices from the formula plus a `halve: true` flag at data-load
  or via a regression-tested helper, rather than hand-freezing 13 more magic-number pairs on top of the
  existing 21+ in the dataset — the v1 plan's "hand-frozen constants" framing is superseded by this
  finding.**

- **The prerequisite-check mechanism, exact semantics (a v1 gap — three reviewers asked how prereqs
  resolve):** `js/engine.js` lines 380-382, inside the per-feature loop over `b.features`:
  ```
  (b.features||[]).forEach(function(lab){var f=DATA.features[lab];if(!f||!f.inv)return;
    (f.prereq||[]).forEach(function(req){if(!_own.has(req))W.push("⛔ "+...+" requires "+...);});
    if(f.lvl&&(b.hd||0)<f.lvl)W.push("⛔ "+...+" requires Warlock level "+f.lvl);});
  ```
  `_own` is `new Set(b.features||[])`, rebuilt fresh on every `compute()` call. Prerequisites are declared
  as an array of **exact feature-label strings** (`f.prereq: ["Warlock: Pact of the Blade"]`) — matched by
  string identity against the owned-features set, not by a separate stable ID. Multiple prerequisites in
  one array are already supported (none of today's 8 declarations use more than one, but the `.forEach`
  handles it). Because `_own` is rebuilt from `b.features` on every call, **removing an earlier step from
  a build immediately re-triggers the warning on any later step still owned** — there is no separate
  removal-time check to add; the same one runs every time.

- **⚠️ What this mechanism actually enforces — confirmed by reading `compute()` in full, not assumed
  (the single most important v2 finding; three of four reviewers independently flagged this as
  potentially fatal to the goal and were right to):**
  1. **Every prerequisite violation in this engine, today, without exception, is `W.push(...)` —
     an advisory warning string added to the returned `warnings` array.** Nothing in `compute()` removes
     a feature from pricing, refuses to add it to `featAP`, or excludes it from `b.features`. A build that
     owns every step out of order still gets priced (and totaled) as if it were valid; the player just
     sees warning text. **"Blocking warning" in v1 was a contradiction — there is no blocking today**, only
     warning. This plan does not change that: the new steps get the same enforcement every other
     prerequisite-bearing feature gets, which is real (visible, itemized, impossible to miss in the UI)
     but not a hard purchase gate. If a hard gate is wanted, that's new engine behavior beyond this
     change's scope — flagged as an open question below, not silently assumed either way.
  2. **`compute()` never derives a mechanical benefit value for any feature — only AP cost, HP, AC,
     proficiency, and the warnings/itemize ledger.** Scanning the full function: there is no code path
     that computes "how many Rage uses" or "what die size for Bardic Inspiration" from level/tier/owned
     steps. Those numbers are static flavor/reference text (in the guide and the feature's own label,
     e.g. `"Rage: 3 uses/long rest"` as an item name), never runtime-derived. **This means "does the
     character actually get held back mechanically if they skip a step" is not a question this engine
     answers at all — enforcement is 100% AP cost + advisory warning + guide prose**, the same as every
     other feature in the dataset. This isn't a gap this change needs to close (PACT is a build/pricing
     tool, not a live effects engine, confirmed by `compute()`'s actual scope) — it's a fact the plan
     needed to state explicitly instead of leaving ambiguous, which v1 did not.

- **Every feature in the entire dataset that declares `"prereq"` today is a Warlock invocation** (searched
  `js/engine-data.js` for the literal key `"prereq":[`, at the commit above: **exactly 8 matches**, all
  carrying `"inv":true`: Rebuke of the Talisman, Far Scribe, Eldritch Smite, Investment of the Chain
  Master, Thirsting Blade, Gift of the Protectors, Lifedrinker, Devouring Blade). Widening the gate at
  lines 380-382 from `if(!f||!f.inv)return;` to run for any `f.prereq`-bearing feature is therefore
  additive-only **against this exact search** — re-run the same search at implementation time in case the
  dataset moved (named explicitly now, not just asserted, per reviewer request).

- **A structurally identical precedent exists today with no prerequisite link:** `"Fighter: Extra Attack
  (2nd)"` (T5/Premium, 16/25 AP) and `"Fighter: Extra Attack (3rd)"` (T7/Premium, 22/35 AP) are both
  `rep:false` standalone entries with no `prereq` field — a Fighter can buy (3rd) without ever owning
  (2nd) today, live and unrelated to this change, surfaced while researching it.

**Assumed (from the design decision record, not independently re-derived):**
- The per-step tier/band/track assignments and the resulting AP table (below) are the finalized inputs —
  not re-litigated here, only the AP-formula relationship to them (verified above).
- "First step free at creation" is explicitly deferred in the source decision — out of scope here too.

## Finalized step tables (v1 promised these and omitted them — every reviewer flagged it; here in full)

**Rage** (Barbarian, 7 steps, two independent tracks — Uses and Damage — both branching from the shared
unlock; within a track, strict order; tracks don't gate each other):

| Step | Tier | Track | Band | Origin AP | Cross AP |
|---|---|---|---|---:|---:|
| 1 (unlock) | T1 | — | Premium | 12 | 13 |
| 2 | T3 | Uses | Per-Rest | 3 | 6 |
| 3 | T4 | Uses | Per-Rest | 4 | 8 |
| 4 | T4 | Damage | At-Will | 5 | 9 |
| 5 | T5 | Uses | Per-Rest | 5 | 10 |
| 6 | T6 | Damage | At-Will | 7 | 13 |
| 7 | T7 | Uses | Per-Rest | 7 | 14 |

**Wild Shape** (Druid, 5 steps, two independent tracks — Capability and Uses):

| Step | Tier | Track | Band | Origin AP | Cross AP |
|---|---|---|---|---:|---:|
| 1 (unlock) | T2 | — | Premium | 13 | 16 |
| 2 | T3 | Capability | At-Will | 4 | 7 |
| 3 | T4 | Uses | Per-Rest | 4 | 8 |
| 4 | T4 | Capability | At-Will | 5 | 9 |
| 5 | T7 | Uses | Per-Rest | 7 | 14 |

**Bardic Inspiration die** (Bard, 4 steps, one track — no branching):

| Step | Tier | Band | Origin AP | Cross AP |
|---|---|---|---:|---:|
| 1 (unlock) | T1 | Premium | 12 | 13 |
| 2 | T4 | Per-Rest | 4 | 8 |
| 3 | T5 | Per-Rest | 5 | 10 |
| 4 | T6 | Per-Rest | 6 | 12 |

Each step's prerequisite is the immediately-prior step **in its own track** (e.g. Rage step 4 requires
step... there is no prior Damage-track step, so step 4 requires only the unlock; step 6 requires step 4).
Independent tracks share only the unlock as their common ancestor.

## Proposed approach (restructured into 3 workstreams — every reviewer independently recommended a split)

**Workstream 1 — Engine widening (own PR, lands first, inert on landing).**
Widen the prerequisite check at `js/engine.js` lines 380-382 from `if(!f||!f.inv)return;` to run for any
feature declaring `f.prereq`, regardless of `f.inv`. Add a regression fixture asserting **zero new
warnings on the full existing fixture corpus** (proves additivity, not just asserts it — closes the
reviewers' "time-bounded claim" concern). This PR changes no prices and, because no non-Warlock feature
declares `prereq` yet, is behaviorally inert until Workstream 2's data lands — reviewable in isolation
against the "highest-risk file" bar with minimal surface area.

**Workstream 2 — Data + formula-consistency test + version bump (depends on Workstream 1).**
1. Add each post-unlock step as an ordinary `rep:false` feature entry, named e.g.
   `"Barbarian: Rage (3 uses/long rest)"`, carrying its table AP values directly and a `prereq: [<prior
   step's exact label, or the unlock's label for track-starting steps>]`.
2. Add a regression test that recomputes each of the 13 step prices from `round_half_up(0.5 ×
   formula(tier, band))` and asserts equality against the stored constants — the "make it self-checking"
   fix the audit table above enables, so the 13 numbers can't silently drift from the relationship they
   were derived from.
3. Add ordering fixtures: buy steps in order (no warnings), buy a step with its track-predecessor missing
   (exactly one new warning, existing warnings unchanged), buy only the unlock (price unchanged from
   today), buy both tracks independently (no cross-track warning).
4. Bump `js/engine-data.js`'s `"version"` string once (currently `"v0.357"`), in this same change. Do not
   touch `js/engine.js`'s `BUILD` constant.

**Workstream 3 — Guide update + Extra Attack decision (can run in parallel with Workstream 2).**
1. Update `docs/PACT-Players-Guide.html`'s description of Rage, Wild Shape, and Bardic Inspiration die to
   describe the stepped structure (which steps exist, their cost, that later steps require earlier ones
   in the same track, and — per the Verified section above — that skipping a step has no engine-enforced
   mechanical consequence, only the AP/warning consequence). Drop Rage and Wild Shape from the Premium
   band's example-features cell, leaving Aura of Protection.
2. Per this repo's own rule that guide and engine changes land together: this repo's `docs/` copy is a
   *served copy*, not the master (the master lives in the separate `pact-guide` project, reached only via
   a manual, verified transfer). This change is not "done" by this repo's own definition until that
   transfer happens — named here as a release-blocking dependency this repo cannot itself perform or
   confirm, not silently treated as out of scope.
3. **Decide, explicitly, whether to fix the Extra Attack (2nd)/(3rd) gap in Workstream 1 or defer it** —
   both are legitimate; recommend deferring to its own follow-up (it's unrelated to this decision's scope
   and bundling it muddies this change's version-bump semantics), but record whichever choice is made
   rather than including it silently.

## Files involved
- `js/engine.js` — `compute()` (line 196), the prerequisite-check widening (lines 380-382).
- `js/engine-data.js` — the three abilities' existing entries, the 13 new step entries, the `"version"`
  string.
- `docs/PACT-Players-Guide.html` (served copy) + the `pact-guide` project's master (separate, manual
  transfer).
- `testing/fixtures/` + `testing/expected/expected-results.csv` — new fixtures per Workstream 2.3.

## Out of scope
- Re-deriving the finalized tier/band/track assignments — taken as given.
- "First step free at creation" — explicitly deferred in the source decision.
- Adding any mechanical-effect computation to `compute()` — confirmed above that none exists today for
  any feature, not just these three; not this change's job to add it.
- Migrating saved character data — project is pre-launch, no real characters, per the source decision.
- Making the prerequisite check an actual purchase-blocking gate instead of advisory — today's mechanism
  is warning-only for every feature that uses it; changing that would be new behavior affecting all 8
  existing Warlock invocation prerequisites too, not scoped to this change.

## Alternatives considered
- **Generalize the `rep:true` formula to accept per-step tier/band overrides.** Rejected: would add
  permanent branching complexity to the shared engine's highest-risk function for a fully-satisfied
  data-only need; all 4 cold reviewers agreed this was the correct call.
- **Hand-freeze 13 constants with no formula linkage.** Rejected in v2 (v1's implicit approach) once the
  audit table showed the relationship is exact and total, not approximate — a regression-tested
  derivation is strictly better at the same implementation cost (Copilot reviewer's C1, adopted).
- **Make the prerequisite check an actual hard block instead of a warning.** Not adopted — would change
  behavior for the 8 existing Warlock invocation prerequisites too, a materially larger and different
  change than this decision asked for; named as an open question for the decision owner, not decided here.

## Risks
- **Player-facing catch-up cost** — named and accepted in the source decision; this plan doesn't soften
  it, and confirms (see Verified) that skipping a step has *only* the AP/social consequence, no engine
  mechanical downgrade either way.
- **Guide/engine drift** — this repo's served guide copy is not the master; "done" depends on a manual
  transfer this repo can't perform, named explicitly in Workstream 3.
- **13 magic numbers drifting from their formula** — mitigated by the formula-consistency test in
  Workstream 2.2, which didn't exist in v1.
- **Re-verification staleness** — the "additive-only" and "13-of-13 match the formula" findings are true
  at commit `225ca0879a7c33a4ac2f24487058061191e60dae`; both are cheap, mechanical re-checks (one grep, one
  test run) that must be re-run at actual implementation time if other work has landed in between.

## Verification
- `testing/tests/engine-parity.html` reports **0 failed**, including new Workstream 2.3 fixtures.
- The Workstream 1 additivity fixture shows zero new warnings on the pre-existing fixture corpus.
- The Workstream 2.2 formula-consistency test passes (each of the 13 step prices recomputed, not just
  compared to a stored constant).
- `js/engine-data.js`'s `"version"` changed exactly once; `js/engine.js`'s `BUILD` unchanged.
- Guide prose reviewed against the three abilities' new descriptions (manual read, both this repo's served
  copy and, separately, confirmation the master transfer happened).

## Done when
1. Workstream 1 merged: prerequisite check widened, additivity fixture passing, zero price/behavior
   change to any existing fixture.
2. Workstream 2 merged: all 13 step entries present with the table's exact AP values, formula-consistency
   test passing, ordering fixtures passing, dataset version bumped once.
3. Workstream 3: guide's served copy updated; master-transfer completion confirmed separately (not
   silently assumed done); Extra Attack decision explicitly recorded either way.
4. `testing/tests/engine-parity.html` → 0 failed.

---

## Reviewer instructions
*(unchanged from v1 — reproduced for continuity; this section governs future reviews of this document,
not a request to re-review v2 immediately)*

Please self-identify your model name/version and any relevant settings as the very first line of your
response. You have no access to the actual codebase or any other project file — judge this plan purely
from what's written above. Answer: (1) does the approach achieve the goal; (2) are any "Verified" claims
suspicious or over-broad; (3) is there a better approach; (4) what's missing; (5) is Verification
objectively checkable by a third party; (6) should this split further. Save your response as
`premium-autogrowth-to-stepped-review-<your-model-name>.md`.

---

## Review outcome

**Reviewers (4):** DeepSeek (file self-identified as "OpenAI GPT-4 (May 2025)" despite the filename —
treated as one data point, vendor unclear from the file itself), Copilot/Claude Opus 4.8, M365
Copilot/GPT-5 reasoning, GPT-5.6 Luna. All 4 converged independently on the same core defects — strong
cross-family agreement, not one outlier.

| Finding | Raised by | Verified how | Disposition |
|---|---|---|---|
| "Full tables below" but no tables present | all 4 | Direct check of v1 file — true | **accept — added in full, above** |
| "Checked by hand for one step" used to claim "every" step matches the 50% relationship | all 4 | Recomputed all 13 post-unlock steps by hand against `MASTER`/formula | **accept — full audit table added, all 13 confirmed, exact rounding rule pinned down** |
| "Blocking warning" is contradictory — engine warns or blocks, plan didn't say which | Copilot, M365, Luna | Read `compute()` lines 380-382 in full: every instance is `W.push`, none removes pricing or ownership | **accept — corrected to "warning, not a block," stated as verified fact with reasoning, not left ambiguous** |
| Does the engine gate the *mechanical* benefit, or only the AP cost? | Copilot, M365, Luna | Read all of `compute()`: no mechanical-value derivation exists for any feature | **accept — stated explicitly as verified: enforcement is AP + warning + guide prose only, confirmed not a gap unique to this change** |
| No exact file/line/constant names | DeepSeek, M365, Luna | N/A — my own omission | **accept — added throughout** |
| "Additive-only" claim lacked search key/count/commit | M365, Luna | Re-ran the search, recorded exact key, count (8), commit hash | **accept — added** |
| Prerequisite resolution: name vs. ID, multiple prereqs, removal behavior | M365, Luna | Read the code: string-label match, array supports multiple, `_own` rebuilt fresh every call | **accept — added to Verified** |
| Recommend splitting into independent workstreams | all 4 | Judgment call, not a factual claim | **accept — restructured into 3 workstreams as recommended** |
| Extra Attack gap should be a separate, explicit decision, not silent inclusion | M365, Luna, (DeepSeek implicitly) | Judgment call | **accept — kept as an explicit decision point in Workstream 3.3, recommendation stated, not assumed** |
| Should the prerequisite check become an actual hard block? | Copilot (implicitly, via the ambiguity), M365 | This is a scope question for the decision owner, not resolvable by re-reading code | **deferred — named as an explicit open question in Risks/Out of scope, not decided in this plan** |
| Hand-frozen constants vs. formula-derived + test | Copilot (C1) | The audit table makes this concrete rather than speculative | **accept — Workstream 2.2 formula-consistency test added** |

No findings were rejected; none required escalation to a fresh disinterested-judge pass (all were either
directly, mechanically verifiable against the actual code — and confirmed true — or genuine judgment calls
the plan now surfaces explicitly rather than resolving silently).
