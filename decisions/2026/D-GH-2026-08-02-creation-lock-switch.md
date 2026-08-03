# D-GH-2026-08-02-creation-lock-switch — engine half of the creation-lock switch (events, precedence, backward compatibility)

Status: Active

Plan: `docs/plans/2026-08-02-creation-lock-switch.md` (cold-reviewed by four models across three
vendor families). This record covers the **engine slice only** — the tool/UI half is not built yet.

- **Context:** PACT's rules price own-species racial traits cheap during creation and expensive if
  claimed later. The pricing math has always been correct, but nothing in the app could ever mark a
  character "finished," so the expensive branch was unreachable. Worse, the two states the app has
  actually shipped were both wrong: before the D-GH37 fold-bridge every trait priced *expensive*
  (the tools' local folds never produced the per-trait lock stamp, so `compute()` fell through to
  `baseBuild()`'s unconditionally-`true` `inPlay` flag), and after it every trait prices *cheap*
  (real replay correctly stamps `false`, since no trigger event exists). Measured at tier 3:
  4 AP unlocked vs 10 AP locked.
- **Decision / what shipped (engine only):**
  - New `creationLockConfig` event, payload `{auto, threshold}`, last-write-wins **per field** — a
    config setting only `threshold` leaves `auto` untouched, and vice versa.
  - New `creationUnlocked` event. `creationLocked`/`creationUnlocked` resolve in log order,
    last-write-wins. Unlock is future-only: already-stamped purchases keep their frozen prices.
  - `creationUnlocked` also **suppresses the automatic threshold lock** until a later
    `creationLocked` or `creationLockConfig` re-arms it. Without this, unlocking a character already
    over the threshold would be a no-op — it would re-lock on the same replay pass.
  - Precedence documented as a block comment above `_replay()` so it can't drift.
- **Deliberate deviation from the plan, forced by evidence:** the plan (revision 2, step 1) specified
  defaults of `auto:false, threshold:null` — "explicitly off, so no existing log's behaviour
  changes." **That is wrong, and implementing it literally would have broken the test suite.** The
  repo already contains seven fixtures exercising this mechanism, three of which
  (EV-003/EV-007/EV-009) assert that `campaignBound` **alone** arms the automatic lock at the
  `DATA.level1AP` default. Defaults-off would have failed all three. Implemented instead:
  `_cfgAuto === undefined` → fall back to `campaignBound` (the historical behaviour);
  `true` → armed even without `campaignBound` (solo opt-in); `false` → disarmed even *with* it
  (a DM switching it off). Threshold falls back to `DATA.level1AP` when unset. Net effect: fully
  backward compatible, and every pre-existing fixture still passes untouched.
  - Worth noting the cold review predicted this class of failure — one reviewer flagged that
    "existing fixtures should not change" rested on a hidden assumption about replay defaults. It
    did, and the assumption was false.
- **Why:** the alternative (pass campaign settings into `compute()`) was rejected because it breaks
  pure-log-replay, threatens the stable-API rule, and would make old logs replay under *today's*
  settings rather than the settings in force when each purchase happened — silently repricing
  history. Keeping everything in the log preserves freeze-at-purchase by construction.
- **Finding from the production dry run — the default threshold is wrong for this campaign, and this
  needs a product decision before the feature is switched on.** The Amble campaign issues a **70 AP
  creation budget** via invites, but `DATA.level1AP` — the auto-lock threshold — is **50**. A player
  would therefore auto-lock 50 AP into a 70 AP build, i.e. *mid-creation*, well before finishing the
  character the DM funded. The threshold plainly wants to default to the campaign's own creation
  budget rather than the engine's level-1 anchor. Not fixed here (it's a UI/settings default, and the
  tool half isn't built), but it must be resolved before any of this is enabled for real players.
  - **SUPERSEDED next morning — see the addendum below. The threshold is the campaign's BUDGET
    CURVE L1 (83 for Amble), not its creation-budget grant (70).**
  - **RESOLVED (same day, by the owner): the threshold defaults to the campaign's creation budget**,
    not `DATA.level1AP`. The engine already supports this via `creationLockConfig{threshold}` — no
    further engine change is needed; the settings layer must emit it. `DATA.level1AP` remains only as
    the last-resort fallback for a character with no campaign and no explicit config.
  - **Rejected: having the engine derive the threshold automatically from the character's own budget
    award** (which would have been self-configuring and needed no settings at all). Checked against
    the suite: it breaks EV-007, which grants a 150 AP `noLock` import burst and then asserts that 60
    AP of genuine later spend still crosses the threshold and locks. Deriving the threshold from that
    150 award raises the bar above 60, so the lock would never fire. The creation-budget award and the
    lock threshold are therefore genuinely different numbers and cannot be collapsed into one.
- **Status:** IN FORCE for the engine slice. Verified: parity **24/0** (20 pre-existing, all
  untouched, plus 4 new fixtures whose expected values were predicted from first principles *before*
  running and matched exactly on the first attempt — EV-011 unlock-is-future-only, EV-012 custom
  threshold, EV-013 solo opt-in, EV-014 auto-off disarms). Static audit 27/0; `random-manual-e2e`
  2/2. Backfill dry run (`testing/scripts/creation-lock-backfill-dryrun.mjs`, read-only) run against
  all three real campaign-bound characters: full folded build *and* full `compute()` output
  byte-identical before/after appending the marker, including every per-trait lock stamp. **No
  production data was written** — the real backfill is deliberately left for a human to trigger.


## Addendum (2026-08-03): the threshold is the campaign's BUDGET-CURVE L1, not its creation grant

- **What prompted it:** the owner asked whether the AP-by-level numbers looked stale. They don't —
  but chasing it surfaced that the previous day's answer ("threshold = the campaign's creation
  budget", i.e. 70) was still the wrong number, for a reason already documented in this repo.
- **PACT has two different AP-per-level curves, and conflating them is a known trap.** Per
  `D-GH-2026-07-14-advancement-tracks`: a **pace** curve (AP *earned* by level — `js/ap-by-level.js`,
  L1 = 50, matching the Guide's "1st-level recruit (50 AP) to 20th-level archmage (491 AP)") and a
  separate **budget** curve (AP a *complete* level-N build is expected to have *spent* — per-campaign,
  Standard L1 = 79, Generous L1 = 83). That record notes conflating them "was a real error in two of
  the reviews," and explicitly flagged this exact fix as a follow-up:
  > The `DATA.level1AP` creation-lock threshold still hardcodes the default L1 rather than a
  > campaign's tuned `levelBudgetCurve.l1` — that IS a `compute()`/`_replay()` mechanics change
  > (needs a `DATA.version` bump + fixture refresh), so it's its own follow-up PR.
- **The lock asks "is this character finished being built?" — a question about SPEND** — so it must
  read the budget curve. `DATA.level1AP` is the pace curve's L1. That was the conflation.
- **Also verified against the Players Guide (grep, not assumption):** Level 0 is real — "an optional
  apprentice or prelude tier — starts at 55 AP" — and sits on the *budget* curve, not the pace curve
  (79 − 24 = 55, and 83 − 28 = 55; both presets agree). The existing `l1 + inc × (N−1)` formula
  already yields it at N=0, so no level-0 row is missing from any table. This also explains the
  "Level 0" shown on a real character's DM Console card: 17 AP spent is genuinely below a complete
  level-1 build, so the label was correct.
- **Decision / what shipped:** new pure export `creationLockThreshold(campaignRules)` in
  `js/engine.js` — returns `rules.levelBudgetCurve.l1` when tuned, else `DATA.level1AP`. Callers
  stamp the result into a character's log as `creationLockConfig{threshold}`; replay still never
  reads campaign settings directly. CharGen's invite redemption now stamps it at seed time — the one
  moment the character's campaign is known for certain — best-effort, falling back to prior
  behaviour if the campaign can't be fetched. The backfill dry run takes an optional campaign-rules
  file and stamps the same value.
- **Note the July record predicted a `DATA.version` bump would be needed. It isn't** — because the
  threshold now arrives as a log event rather than being read inside `_replay()`, `compute()`'s
  output is unchanged for every pre-existing input. The bump was only unavoidable under the
  read-settings-during-replay design that was rejected.
- **Status:** IN FORCE. `creationLockThreshold()` unit-checked over 7 cases (tuned generous → 83,
  tuned standard → 79, no campaign / untuned / null / string / zero → 50 fallback). End-to-end on an
  Amble-shaped log: spend 70 (the whole grant) → unlocked; spend 83 → unlocked (threshold is strictly
  greater-than); spend 84 → locked; and the same log without the threshold event → locked at 70,
  reproducing the bug. Parity 24/0, audit 27/0, e2e 2/2. No `DATA.version` bump. Still **no
  production data written** — Anders needs the backfill, reserved for a human.
