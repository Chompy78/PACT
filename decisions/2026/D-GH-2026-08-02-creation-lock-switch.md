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
- **Status:** IN FORCE for the engine slice. Verified: parity **24/0** (20 pre-existing, all
  untouched, plus 4 new fixtures whose expected values were predicted from first principles *before*
  running and matched exactly on the first attempt — EV-011 unlock-is-future-only, EV-012 custom
  threshold, EV-013 solo opt-in, EV-014 auto-off disarms). Static audit 27/0; `random-manual-e2e`
  2/2. Backfill dry run (`testing/scripts/creation-lock-backfill-dryrun.mjs`, read-only) run against
  all three real campaign-bound characters: full folded build *and* full `compute()` output
  byte-identical before/after appending the marker, including every per-trait lock stamp. **No
  production data was written** — the real backfill is deliberately left for a human to trigger.
