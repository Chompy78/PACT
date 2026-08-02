# Plan: Creation-lock switch — make "this character is finished" a real, controllable state

Supersedes: docs/plans/2026-07-12-creation-lock-and-house-rules-rename.md
Revision 2 — incorporates cold review from GPT-5.5, M365 Copilot (GPT-5), Kimi, and one
Anthropic-or-DeepSeek reviewer. Five blocking clusters raised; all resolved below.

Sibling follow-up (NOT this plan): "availability lock" — hiding creation-only options once
locked. Deferred to Plan 2; depends on this landing first.

## Goal
PACT's rules make a character's own-species racial traits cheap while building and more
expensive if claimed later mid-campaign. The pricing math exists and is correct, but nothing
can mark a character "finished," so the expensive price never applies. This plan builds that
switch.

**Explicit scope limit (v1 is honour-system, by decision):** a player can undo their own
finalise. This is accepted, not overlooked. The mechanism the DM actually relies on is the
automatic spend threshold, which is self-enforcing — escaping it requires undoing the
purchases themselves, so a player cannot both keep their purchases and be unlocked. Hardened
server-side enforcement is a possible follow-up, not part of v1.

## Context
PACT is a static vanilla-JS tabletop-RPG tool suite (no framework, no build step). Three
browser tools — character generator, live sheet, DM console — import one shared rules engine,
`js/engine.js`, the single source of truth for rules, whose public API must stay stable.
Characters are event-sourced: a character IS an append-only log; all state derives from
replaying it. Backend is hosted Postgres reached directly from the browser under row-level
security; there is no server-side app code. Repo rule: if `compute()` output changes for the
same input, bump the rules dataset version and update expected-output fixtures in the same change.

**Two lock mechanisms exist and behave differently — this distinction drives everything below:**
- **Explicit lock** — a `creationLocked` event. Fires unconditionally from that point in the log.
- **Automatic lock** — armed by a `campaignBound` event, fires once cumulative spend passes a
  threshold. Derived fresh on every replay, so it is inherently reversible: drop back under the
  threshold and it un-fires.

Why now: the app is **no longer pre-launch** (four real characters in a live campaign, one fully
built), and a recent refactor unifying how the tools fold logs silently flipped racial-trait
pricing from always-expensive to always-cheap. Neither state is correct.

## Assumptions vs. verified facts

**Verified (measured against the engine this session):**
- Lock state is stamped **per purchase**, capturing the state as of just before that purchase.
  Prices freeze at purchase; later locking never reprices an earlier buy.
- Locked effect: own-species non-"pack" racial traits reprice from a flat cheap price to a
  cost-table cell keyed on current tier. Pack basics and cross-species traits are unaffected.
- Measured, tier-3, trait "Halfling: Naturally Stealthy": **4 AP unlocked / 10 AP locked.**
- **At tier 1 both prices coincide** — the mechanism is invisible on a level-1 character.
- **Nothing emits either trigger.** Grep of all three tools: zero matches. Never UI-reachable.
- With no per-trait stamp, `compute()` falls back to a whole-build flag the base constructor
  sets `true` — i.e. "locked." This is why pre-refactor tools charged expensive for everything.
- **`campaignBound` has exactly one effect** — it arms the threshold. Confirmed by reading every
  reference in the engine. No hidden side effects. *(Closes a reviewer concern.)*
- **`compute()` does not expose lock state at all** — its `status` field is only a budget string.
  The lock map lives on the *build*, not compute output. A dry run must diff both. *(Corrects a
  reviewer assumption that a `locked` output field would flip.)*
- **Backfill-at-end is provably safe and effective.** Tested on a realistic tier-3 log: before
  and after appending the marker are byte-identical *including the per-trait lock map*, and a
  purchase made after the marker correctly prices expensive.
- Campaign settings are already a free-form DM-owned JSON blob with a working write path.
- The live sheet's undo pops only the last event and refuses to cross a non-discount AP award.

**Assumed (attack these):**
- That materialising DM settings into the player's log on next online load is an acceptable
  propagation delay (offline players run on last-known rules until they reconnect).
- That re-adding the campaign marker on load when membership says it belongs is sufficient to
  make it undo-resistant, without causing duplicate-event churn.
- That no existing expected-output fixture contains a threshold or trigger event.

## Proposed approach

1. **Engine — threshold becomes a log event (decision L1).** Introduce a
   `creationLockConfig` event carrying `{ auto: boolean, threshold: number|null }`.
   Replay reads the **latest such event, last-write-wins**. Defaults when absent: `auto:false,
   threshold:null` — i.e. **explicitly off**, so no existing log's behaviour changes. The engine
   stays pure log-replay; `compute()`'s signature does not change.
2. **Engine — keep the campaign-bound gate for campaign characters.** Automatic lock still
   requires `campaignBound`. *(This is a deliberate reversal of revision 1, which proposed
   dropping it — three reviewers correctly identified that dropping it contradicted the backfill
   step. Keeping it also preserves the documented "solo characters never auto-lock by accident"
   protection.)* Solo auto-lock is instead opt-in: a solo player who enables it gets a
   `creationLockConfig{auto:true}` event, which the engine honours **without** requiring
   `campaignBound`. So: campaign → gated by membership; solo → gated by explicit opt-in. Nothing
   auto-locks unless someone asked for it.
3. **Engine — unlock becomes an event (decision K1).** Introduce `creationUnlocked`.
   Precedence is strictly **log order, last-write-wins** among `creationLocked` /
   `creationUnlocked`; the automatic threshold is evaluated independently and can re-fire
   afterwards. Unlock is **future-only** — already-stamped purchases keep their frozen prices.
   Document this precedence as a hard rule so it can't drift.
4. **Campaign settings (DM), no migration.** Add to the existing settings blob: whether players
   may self-finalise; whether automatic locking is on; the threshold; and a list of character
   ids the DM has unlocked. The DM only ever writes their own campaign row — never a player's.
   **The threshold DEFAULTS TO THE CAMPAIGN'S CREATION BUDGET** (the same number that pre-fills an
   invite's "Creation budget" field), not `DATA.level1AP`. Decided 2026-08-02 after the production
   dry run showed Amble grants 70 AP while the engine anchor is 50, which would lock a player
   mid-creation. Do NOT try to derive this from the character's own budget award instead — that was
   checked and breaks fixture EV-007 (see the decision record).
5. **Materialisation.** On load, when online, a player's client reconciles campaign settings into
   its own log: appends a `creationLockConfig` if the effective config differs from the latest one
   in the log, appends `creationUnlocked` if this character is in the DM's unlocked list and isn't
   already unlocked, and re-appends `campaignBound` if membership says it belongs but the log
   lacks it (self-healing against undo). Each append is guarded by an equality check so it cannot
   loop or duplicate.
6. **Tools — the switch.** A "Finalise character" action emitting `creationLocked`, behind a
   confirmation, hidden when the campaign disables self-finalise. A state indicator
   ("still in creation" vs "locked"). Solo tools additionally expose the auto-lock opt-in.
7. **Backfill the four live characters.** Append `campaignBound` at the END of each log for
   characters already in a campaign. Verified safe above. Dry-run first (below).

## Files involved
- `js/engine.js` — replay lock bookkeeping: new config/unlock events, precedence, defaults.
  Highest-risk file in the repo; exported API shape must not change.
- `js/campaign.js` — read/write the new settings keys.
- `tools/PACT-CharGen-Webtool.html`, `tools/PACT-Live-Char-Sheet.html` — finalise action,
  solo opt-in, state indicator, materialisation-on-load.
- `tools/DM-Console.html` — campaign settings controls, per-character unlock.
- `testing/fixtures/`, `testing/expected/` — new fixtures (below).
- **No SQL migration.** DM actions write only the DM-owned campaign row; player events are
  written by the player's own client. *(Dissolves revision 1's deployment-order dependency.)*

## Out of scope
- **Availability blocking** (hiding creation-only options once locked) — Plan 2, and the larger
  of the two effects.
- Server-enforced, undo-proof finalise (the M2 option) — deliberate v1 limitation, see Goal.
- Gold and downtime as in-play costs — unmodelled, needs game design.
- Whether the reprice matches the printed rules — previously flagged as possibly off-model; the
  designer has confirmed it is intended. Settled.

## Alternatives considered
- **Drop the campaign-bound gate entirely** (revision 1's approach) — rejected on review: it
  contradicted the backfill step and removed a protection against solo characters locking
  unexpectedly.
- **Pass campaign settings into `compute()`** — rejected: breaks pure-log-replay, threatens API
  stability, and makes old logs replay under today's settings rather than the settings in force
  at the time.
- **Per-character database column for the threshold** (the superseded July plan) — rejected for
  v1: the settings blob exists and needs no migration.
- **Prepend the backfill marker** — rejected as actively dangerous: it would sit before all
  existing spend, cross the threshold mid-history, and reprice already-purchased traits.
- **Privileged server-side unlock RPC** — rejected for v1: materialising via campaign settings
  achieves the same outcome with no migration, consistent with the honour-system posture.
- **Do nothing / accept always-cheap** — rejected by the designer.

## Risks / open questions
- **Live player data.** Four real characters. The backfill is the highest-stakes step; proven
  safe in test, must be re-proven on a copy of the real data before running.
- **Materialisation is the most intricate piece.** Appending events on load risks loops or
  duplicates if the equality guards are wrong. Needs its own tests.
- **Propagation delay.** A DM's change reaches a player only when they next load online.
- **Auto-lock is reversible, explicit lock is not.** Two coexisting models with different
  semantics; a DM raising the threshold un-fires the auto lock for future purchases. Intended,
  but worth confirming it isn't surprising.
- **Tier-1 invisibility** makes manual QA misleading — always test at tier 3+.
- **Threshold comparison is strictly greater-than**; the purchase that crosses the threshold is
  itself still cheap, only the next is expensive. Intended (freeze-at-purchase), but needs UI
  wording so it doesn't read as a bug.

## Verification
- Engine parity suite → **20 passed / 0 failed.** Existing fixtures contain no trigger or config
  events, so **any movement is a failure, not an expected update** — this is an acceptance
  criterion, not a hope.
- **Version-bump rule, stated explicitly:** bump the rules dataset version *if and only if*
  identical inputs produce different `compute()` output. Expected outcome here: no change, so
  no bump. If a fixture does move, treat it as a defect first and investigate before bumping.
- **New fixtures** — below threshold (cheap); crossing purchase itself still cheap; next
  purchase expensive; explicit finalise; unlock after explicit lock (future-only — earlier
  purchases stay expensive); threshold raised back above spend (auto-lock un-fires); config
  toggled off after being on; solo with no config (never locks); duplicate `campaignBound`
  events (idempotent); config event set before vs after spend.
- **Regression guard for the actual bug:** a fixture asserting a character with no trigger events
  prices traits *cheap* — pinning the correct half of the expensive/cheap flip.
- **Backfill dry run — strengthened per review.** On a copy of the four production characters,
  diff **the full folded build (including every per-purchase lock stamp) and full `compute()`
  output**, not just totals. Aggregate equality is insufficient — it cannot distinguish "nothing
  changed" from "two changes cancelled." Expected diff: exactly zero. Then simulate one further
  purchase and confirm it prices expensive. Do not run for real until both hold.
- **Post-backfill, open each character in all three tools** and confirm they recompute rather
  than serve stale cached state.
- **Materialisation tests:** loading twice appends nothing the second time; undoing the campaign
  marker re-adds it on next load; unlocking then re-finalising ends locked.
- **Tier sensitivity:** assert at tier 3+, since tier 1 cannot distinguish the prices.
- **DM round trip:** disabling self-finalise hides the button; unlocking a locked character
  returns it to creation pricing for future purchases only.
- Static audit script and random end-to-end generator green (both existing repo tools).

## Done when
**Behavioural:**
- Racial traits price cheap during creation and expensive after locking, verified at tier 3+.
- A player can finalise; a solo player can opt into auto-lock; a DM can disable self-finalise,
  set a threshold, and unlock — with changes reaching players on next online load.
- Unlock affects only future purchases; earlier purchases keep their frozen prices.

**Implementation checkpoints (tracked separately from the above):**
- The four live characters carry the marker, with full build + compute output provably unchanged.
- Parity 20/0 with no existing fixture movement, plus all new fixtures passing.
- Precedence rule documented in the engine.

---

## Reviewer instructions
**Before anything else, state which AI model and settings you are** — as the very first line of
your response — e.g. "GPT-5.5 (default)", "Gemini 2.x Pro", "human reviewer". The author uses
this to weight findings and tell reviewers apart.

You are reviewing **cold, with no codebase access** — only the text above. Judge the plan's
**logic, clarity, scope, and risk — not code correctness you cannot verify.** If the plan relies
on knowledge you don't have, that itself is a finding.

**This is revision 2.** Five blocking clusters from the first round were resolved: unlock
semantics, threshold source, the campaign-bound/backfill contradiction, solo configuration, and
deployment ordering. Judge whether those resolutions actually hold — and whether they introduced
new problems.

**Default posture: try to refute this plan.** Assume the goal is unmet until convinced.
1. Does the approach achieve the goal? Argue against it first.
2. Which **assumptions** are shaky — especially materialisation-on-load, and the claim that
   defaults-off means no existing behaviour changes?
3. Is the two-mode lock model (reversible auto vs. one-way explicit, with a last-write-wins
   unlock layered on) coherent, or will it produce surprising states?
4. What's missing — an edge case, a dependency, a **verification step**?
5. Are "Verification" and "Done when" objectively checkable?
6. Is the honour-system v1 scope limit defensible, or does it undermine the stated goal?

For **each finding** tag **severity** (`blocking`/`moderate`/`minor`) and **confidence**
(`high`/`low`). Plain list; don't rewrite the plan. **If a section is solid, say so briefly
rather than inventing concerns** — false findings cost a wasted cycle.

**Deliver as a Markdown file** led by your model line, named
`creation-lock-switch-r2-review-<your-model>.md`.

---

## Review outcome (round 1 — revision 1 of this plan)
Reviewers (model + vendor family): GPT-5.5 (OpenAI) · M365 Copilot / GPT-5 reasoning (OpenAI) ·
Kimi Chat long-context (Moonshot) · one reviewer self-declaring "Claude 3.5 Sonnet" but
delivered in a file named `deepseek_*` — **provenance ambiguous** (Anthropic or DeepSeek).
Either way it is a non-OpenAI family, so the cross-family conclusions below are unaffected.

| Finding | Severity | Confidence | Raised by | Cross-family agreement | Disposition |
|---|---|---|---|---|---|
| Unlock incoherent with one-way lock — replay semantics undefined | blocking | high | all 4 | yes (3 families) | accept → K1: `creationUnlocked` event, last-write-wins, future-only |
| Threshold source contradictory (log vs campaign blob) | blocking | high | all 4 | yes (3 families) | accept → L1: `creationLockConfig` log event; settings materialise into it |
| Backfill/`campaignBound` self-contradiction (step 1 drops the gate, step 6 relies on it) | blocking ×3, moderate ×1 | high | all 4 | yes (3 families) | accept → keep the campaign-bound gate; solo auto-lock becomes explicit opt-in |
| Backfill proof too weak (totals can cancel out) | blocking | high | GPT-5.5, M365 | no (1 family) | accept → diff full build + per-purchase stamps, not just totals |
| Solo config/escape hatch undefined | moderate | high | all 4 | yes (3 families) | accept → solo opt-in event; defaults explicitly off |
| DM enforcement vs honour-system left open | blocking ×1, moderate ×2 | high | M365, Kimi, GPT-5.5 | no (1 family) | accept → M1: honour-system, now stated as an explicit scope limit in the Goal |
| Deployment order / migration dependency | blocking | high | M365 | no (1 family) | accept → dissolved; v1 needs no migration at all |
| `campaignBound` may have hidden side effects | moderate | high | Kimi | no (1 family) | **reject** — verified in code: exactly one effect (arms the threshold) |
| `locked` flag in `compute()` output would flip during backfill | moderate | moderate | Kimi, M365 | no (1 family) | **reject** — verified: `compute()` exposes no lock state; lock map lives on the build |
| Existing-fixture stability stated as expectation not criterion | moderate | high | GPT-5.5 | no (1 family) | accept → now an explicit acceptance criterion |
| Auto-lock reversibility is a rules decision, not config | moderate | high | M365, GPT-5.5 | no (same family ×2 — weak) | accept → documented explicitly as two coexisting models |
| Missing ordering/edge fixtures | moderate | high | M365 | no (1 family) | accept → fixture list expanded |
| Threshold comparison operator (`>` vs `>=`) unspecified | moderate | high | M365 | no (1 family) | accept → stated: strictly `>`, crossing purchase stays cheap |
| Version-bump rule ambiguous | minor | high | all 4 | yes (3 families) | accept → decision rule stated explicitly |
| Stale cached state after backfill | moderate | low | GPT-5.5 | no (1 family) | accept → added a post-backfill all-tools recompute check |
| "Done when" mixes behaviour with implementation | minor | high | GPT-5.5 | no (1 family) | accept → split into behavioural vs implementation checkpoints |
| Two lock mechanisms introduced too late in the doc | minor | high | GPT-5.5 | no (1 family) | accept → moved into Context |
| Unknown-event forward compatibility | moderate | moderate | Kimi | no (1 family) | defer → task-board item (engine already no-ops unknown categories; needs confirming for event *types*) |
| Plan 2 load-bearing for Plan 1 usability | moderate | moderate | Kimi, M365 | no (1 family) | defer → revisit when Plan 2 is drafted; v1 ships with the state indicator as mitigation |
| Glossary of overlapping terms | minor | low | M365 | no (1 family) | defer → doc-note during implementation |

- **Materially changed the plan?** Yes — substantially. Unlock and threshold went from undefined
  to specified events; the campaign-bound gate was un-dropped; the migration disappeared entirely;
  the backfill proof was strengthened from totals-only to full-state.
- **Without the review, what would have happened:** implementation would have started on a plan
  containing a direct self-contradiction (drop the campaign gate, then backfill a campaign
  marker to enable the gate) and an unimplementable DM unlock. Both would have surfaced only
  after code was written — and the weak backfill proof could have let a real change to live
  player data pass as "verified."
