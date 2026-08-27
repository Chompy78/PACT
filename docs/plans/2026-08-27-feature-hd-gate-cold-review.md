# Plan for cold review — Enforce Hit-Dice requirements on class abilities

**Date:** 2026-08-27 · **Branch:** `feat/feature-hd-gate` · **Decision ID:** `D-GH-2026-08-27-feature-hd-gate`
**Reviewer has no access to this repo. Everything needed to judge the plan is inline below.**

## Goal
Make the rules engine enforce a rule the published Players Guide already states but the engine has never
checked: a class ability cannot be bought before the character owns the Hit Dice its Tier requires.

## Context (for a reader with no project access)
PACT is a tabletop-RPG character builder: a static, vanilla-JavaScript web app, no frameworks, no build
step. Characters are bought with a point currency called **AP**. `js/engine.js` is the single source of
truth for all rules; three separate HTML tools (a character generator "CharGen", a play-time "Live Sheet",
and a "DM Console") are UI only and import from it. A function `compute(build)` returns AP cost plus a
list of warnings.

Two relevant scales:
- **Hit Dice (HD)** — 1 to 20, effectively character level. A character buys more over time.
- **Tier** — 1 to 7, a difficulty/power band. Every class ability carries a Tier, which sets its price.

A published mapping between them already exists in the rules data as `DATA.tierHD`:
`{T1:1, T2:2, T3:3, T4:5, T5:9, T6:13, T7:17}` — i.e. a Tier-4 ability needs 5 Hit Dice.

The Players Guide already publishes this as an absolute rule ("You can never buy an ability before you own
the Hit Dice, and hence the equivalent level, it requires"), and uses the exact example "Extra Attack is a
T4 feature gated behind 5 Hit Dice." **The engine does not implement it.** This plan closes that gap.

## Verified facts (I checked each of these directly)
1. `DATA.tierHD` exists with the values above. `Fighter: Extra Attack` is Tier 4.
2. The engine does **not** gate. A 1-HD Fighter buying `Extra Attack` *and* `Extra Attack (3rd)` (a Tier-7
   ability) computes cleanly — the only warning returned is `"OVER BUDGET by 32 AP"`.
3. The Live Sheet tool **already** applies exactly this gate in its own UI, in four places (origin-class
   features, Eldritch Invocations, cross-class features, subclass abilities), via `b.hd >= DATA.tierHD[tier]`.
4. CharGen applies `tierHD` only to *racial traits*, never to class abilities. DM Console has no class-ability
   picker at all (zero references to the feature dataset).
5. Scale: 359 class features (`DATA.features`), each with a `tier`; plus 192 subclass abilities
   (`DATA.subAbilMap`), also each with a `tier`. All 192 subclass abilities are **mirrored into**
   `DATA.features`, so they are purchasable through two different code paths.
6. A hard-block mechanism already exists for a *different* gate — prerequisite chains. A feature declaring
   `prereq` whose prerequisite is unowned is put in a `_blockedFeat` set by a fixed-point loop, costs 0 AP,
   is **not** counted as owned, and is itemized separately under a "Blocked purchases" line. The fixed point
   handles chains of any depth (owning steps 2 and 3 while skipping 1 blocks both).
7. The subclass-ability loop has **no** blocking machinery at all — it prices everything it finds.
8. Stepped ("rep") features escalate: the *n*-th purchase is priced at `min(7, baseTier + n - 1)`.
9. **13 of 41 build fixtures would newly block** under this rule (measured, full list in Risks below).
10. The test gate is `node testing/scripts/engine-parity-ci.mjs`, expected result **0 failed**. Expected
    output lives in `testing/expected/expected-results.csv` (AP totals) and `expected-warnings.json`
    (65 keyed warning lists).

## Assumptions (not verified — reviewer should challenge)
- The app is **pre-launch**: no real player characters exist that a stricter rule could invalidate. (Basis: a
  prior project decision record states this; I did not independently re-confirm it.)
- The Guide's Tier→HD table matches `DATA.tierHD` exactly. I confirmed T4/T5/T6/T7 (5/9/13/17); I did **not**
  see T1–T3 stated in the Guide text I searched.
- The Guide needs no rules edit — it already documents the rule, so this is the engine catching up to the
  Guide rather than the reverse. (Project rule: a mechanics change must land in both engine and Guide, so
  if this assumption is wrong the scope grows.)
- Blocking is desirable for cross-class and unlocked-class purchases identically, not just origin-class.

## Proposed approach
1. **Add one gate helper** in `js/engine.js`, near the existing `_tierForHD` helper:
   `_hdNeededFor(item, effectiveTier)` returning `max(DATA.tierHD[effectiveTier], item.hd || 0, item.lvl || 0)`.
   This derives the gate from Tier by default (no per-item data authoring across 551 entries) while allowing
   an optional per-item `hd` override. The `lvl` term preserves an existing Warlock-invocation level gate,
   which the Live Sheet already combines the same way.
2. **Fold the HD check into the existing `_blockedFeat` fixed-point loop**, not after it. This is the key
   structural decision: under a hard block an HD-blocked feature is *not owned*, so any feature whose
   prerequisite is that feature must block transitively. Running the HD check as a separate later pass would
   miss those dependents.
3. **Extend the same treatment to the subclass-ability loop**, which today has no block path. This requires
   adding a blocked set and routing blocked entries into the existing "Blocked purchases" itemization.
   Gating one path and not the other is a known past failure in this project: a previous cross-class gate was
   removed partly because it guarded only one of two identical purchase doors.
4. **Gate stepped features on effective step tier**, i.e. the same `min(7, baseTier + n - 1)` the pricing
   already uses — so step 3 of a Tier-4 ladder needs 13 HD, not 5. Matches the Guide's "You may buy the next
   step only once you own the Hit Dice shown."
5. **Warning text**, following the project's existing convention where `⛔` marks a hard rules violation:
   `⛔ Extra Attack — blocked: needs 5 Hit Dice (T4) (not counted, not owned)`.
6. **CharGen UI**: annotate the per-class ability dropdown built by `buildClassPickers()` with the HD each
   option requires, and surface the engine's warning on render. CharGen's picker is a `<select>`, so it cannot
   render a disabled-button state the way the Live Sheet's buy panel does — the annotation is the affordance.
7. **Fixtures**: raise `hd` on the 13 affected fixtures to the minimum that keeps each one testing what it was
   written to test; add new regression fixtures for HD-block, HD+prereq double-block, and stepped-ladder
   step gating.
8. **Regenerate** `testing/expected/expected-results.csv` and `expected-warnings.json`; bump the rules version
   `DATA.version` (this changes `compute()` output); write `CHANGELOG.md` and a `DECISIONS.md` record.

## Files involved
`js/engine.js` (gate helper, feature loop, subclass-ability loop) · `tools/PACT-CharGen-Webtool.html`
(`buildClassPickers()`) · `testing/fixtures/builds/*.json` (13 edits + new) · `testing/expected/*` ·
`CHANGELOG.md` · `DECISIONS.md` · task board.
**Not touched:** `tools/PACT-Live-Char-Sheet.html` (already gates), `tools/DM-Console.html` (no picker),
`js/engine-data.js` (no per-item data authoring needed).

## Out of scope
- Converting the existing *soft* HD warnings on boons and magical arts into hard blocks. They currently warn
  but still charge. Consistency is arguable; it is a separate decision with its own fixture churn.
- A price discrepancy found incidentally: the Guide prices Extra Attack at "14 AP" while the data has 10
  (origin) / 17 (cross-class). Real, unrelated to this gate, belongs on the task board separately.
- HD gates for other tracks that lack them (Ki points, attunement).

## Alternatives considered
- **Soft warning only** (matching how boons behave today): cheapest, no AP totals change, no fixture churn.
  Rejected — the Guide states the rule as an absolute, and an advisory gate drifts again the moment a tool
  stops rendering the warning.
- **`⛔` warning but still priced and owned** (matching how racial-trait minimums behave today): a middle
  option with zero fixture churn. Rejected as the primary choice but a legitimate fallback if the fixture work
  proves larger than expected.
- **Author an explicit `hd` field on all 551 entries** (matching how boons store it): rejected — 551 hand-authored
  values that merely restate what `tier` already implies, and a new drift surface.
- **Gate stepped features on base tier**: rejected — would let a 5-HD character buy an entire ladder at once.

## Risks and open questions
- **R1 — double-blocking may mask the regression it replaced.** Four of the affected fixtures
  (`CG-022-rage-out-of-order-blocked`, `CG-027-bardic-inspiration-skip-step-blocked`,
  `CG-030-warlock-invocation-hard-block-regression`, `CG-031-warlock-invocation-transitive-block`) exist
  specifically to prove the *prerequisite* block works. If the new HD gate also blocks them, they pass for the
  wrong reason and stop testing prerequisites. Their `hd` must be raised enough to clear the HD gate while
  still failing the prereq gate.
- **R2 — reporting when both gates fire.** Which reason should the warning name? Proposal: prerequisite first
  (it is the more specific, actionable failure), HD second. Untested assumption.
- **R3 — is a 17-HD requirement for a full ladder intended?** Five fixtures need `hd` raised to 17 to buy
  their complete stepped chain (Rage, Wild Shape, Sneak Attack, Martial Arts). That follows from the Guide's
  wording, but it is a large practical consequence and worth a sanity check.
- **R4 — non-monotonic HD via undo.** Hit Dice normally only increase, which means a retroactive recompute can
  never invalidate a purchase that was legal when made. But the Live Sheet's undo can lower HD, which could
  strand a legally-bought ability behind the gate afterwards. Unclear whether this needs handling.
- **R5 — full fixture impact** (measured; `hd` shown as current → minimum required):
  `CG-013` 1→3 · `CG-021` 1→17 · `CG-022` 1→5 · `CG-023` 1→13 · `CG-024` 1→17 · `CG-025` 1→5 ·
  `CG-026` 1→13 · `CG-027` 1→9 · `CG-028` 1→17 · `CG-029` 1→17 · `CG-030` 1→5 · `CG-031` 1→9 · `CG-032` 1→5.
  Raising `hd` also raises each fixture's AP total (Hit Dice cost money), so every one of these expected
  totals changes too — this is deliberate re-baselining, not a regeneration that can be trusted blindly.

## Verification
- `node testing/scripts/engine-parity-ci.mjs` → **0 failed**.
- `node testing/scripts/tool-pricing-ci.mjs` → **0 failed**.
- Targeted check: a 1-HD Fighter with `Extra Attack` returns a `⛔ ... needs 5 Hit Dice` warning, contributes
  0 AP, and appears under "Blocked purchases" — the same build that today returns only "OVER BUDGET".
- Targeted check: the same build at 5 HD prices normally with no HD warning.
- Transitive check: a feature whose prerequisite is HD-blocked is itself blocked.
- Parity check: the same subclass ability bought via the subclass path and via the mirrored feature path
  produces identical AP and identical warnings.
- Manual: open CharGen at 1 HD, confirm high-Tier abilities show their HD requirement and warn if selected.

## Done when
- `compute()` blocks any class feature or subclass ability whose effective Tier's HD requirement exceeds the
  character's Hit Dice, at zero AP, not owned, itemized under "Blocked purchases".
- Both purchase paths (feature list and subclass list) behave identically.
- Both test gates report 0 failed; `testing/expected/` re-baselined with each changed total explained.
- `DATA.version` bumped; CHANGELOG and DECISIONS records written; task graduated off the board.

---

## Reviewer instructions
**Begin your response by stating which model you are and any relevant settings (e.g. reasoning effort).**

You have no access to this repository. Judge the plan's **logic, clarity, scope and risk** — not code
correctness you cannot verify from this text. Then answer all six:

1. Does this approach achieve the stated goal?
2. Are any of the Assumptions shaky, and which one would hurt most if wrong?
3. Is there a better alternative than the one chosen (hard block over soft warning; derived gate over
   authored data; effective step tier over base tier)?
4. What is missing — a case, a consequence, a stakeholder, a failure mode not listed?
5. Is the Verification section **objectively checkable**, or does any item rest on judgement?
6. Should this be split into multiple plans (e.g. engine enforcement separately from fixture re-baselining)?

Pay particular attention to **R1** (whether re-baselining 13 fixtures risks silently weakening the tests they
were written to perform) and **R3** (whether the stepped-ladder consequence is acceptable game design).

Output your review as a Markdown file named `feature-hd-gate-review-<your-model-name>.md`.

---

## Review outcome
*(to be filled in after review — reviewer, date, findings accepted / rejected / deferred, and any change made
to this plan as a result)*
