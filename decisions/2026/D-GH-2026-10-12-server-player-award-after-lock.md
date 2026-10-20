# D-GH-2026-10-12-server-player-award-after-lock — the database refuses a player-added award on a finished campaign character

**Context.** Found while fixing `fix/player-free-ap` (#638), by reading the SQL. `pact_enforce_locked_history()` freezes the
history that already exists but lets anything be appended after it. `pact_enforce_ap_budget_consistency()` then counts every
`award` in the LOG as spendable player AP unless the campaign has `ignore_player_ap`. So a modified client could append
`{type:'award', amount:500}` to a locked campaign character and spend it. #638 closed every path in the tools' UIs; the
database still accepted the write. This decision covers that award route only (see Scope).

**Live measurement** (owner-approved read, 2026-10-12, before any SQL was written): 12 `award` events on 10 campaign-bound
characters, all in one campaign, which has `ignore_player_ap = true`. All are CharGen's `noLock` "Budget" singleton except two
"Zeroed by DM" negatives before the lock. Four characters carry the Budget award AFTER the lock (amounts 0, 0, 0, 77): CharGen
moves its singleton to the LOG tail by filter-and-append (`_cgSyncSingletonEvent`). No `grantId` or `disc` awards anywhere. No
campaign with `ignore_player_ap = false` has a bound character with an award. So 0 characters gain AP through this gap today.

**Options.**

- **Q1 — what does the rule compare?**
  - A. Refuse any `award` event appended after the lock index (event-shaped).
  - B. Refuse an UPDATE that raises the LOG's award TOTAL compared with the stored row (sum-shaped).
  - **Decision: B.** A refuses CharGen's legitimate filter-and-append of the Budget singleton, which lands after the lock
    on four live characters. B accepts every move or re-save that keeps the amount, and catches an append, a raised singleton,
    and a "swap one award for two that sum higher" alike.

- **Q2 — a second trigger, or amend `pact_enforce_player_ap_ceiling()` (2026-09-03)?**
  - A. New trigger. B. Amend the existing one, which already refuses a rising player award total in `ignore_player_ap`
    campaigns.
  - **Decision: B.** Same sum, same table, same error path. One rule: "on a campaign character, only the DM raises the award
    total once the campaign ignores player AP OR the character is creation-locked or sealed".

- **Q3 — how is the DM exempted?**
  - A. Keep the 2026-09-03 approach: leave `dmEdit:true` awards out of the sum. Its own header admits a player can forge that flag.
  - B. Exempt by who is writing: `is_campaign_dm(NEW.campaign_id)`. Everyone else has ALL awards counted.
  - **Decision: B** (the deeper fix). It also closes the forged-`dmEdit` hole in the `ignore_player_ap` scope. No legitimate
    player save changes a DM-stamped award: each one has no `noLock`/`disc`, so it is itself a locked-history boundary and is frozen.
    DM paths that write the LOG (`dm_edit_character_log` boon grant, `dm_zero_player_ap`, `award_ap_and_seal`) all run as the DM.
    `award_ap()` writes the `ap` column, not the LOG, and is unaffected.

- **Q4 — what counts as "finished"?** (H2)
  - A. Any `creationLocked` ever. B. Currently locked (last `creationLocked` after last `creationUnlocked`, the D2 test) or
    any `sessionSeal`.
  - **Decision: B.** A DM reopening creation (`dm_reopen_creation`) is a deliberate act that hands creation back to the player,
    and CharGen allows the budget edit while reopened; A would strand those saves. A seal is permanent and the DM's, so it counts
    even without a lock. The lock state is read from the stored row, so setting the budget and finishing creation in one save is
    accepted — the player could have done it in two.

- **Q5 — does a redeemed AP grant code (`grantId` award) count?** (H2, the owner decision this task hid)
  - A. Exempt `grantId` awards so Redeem keeps working on a finished campaign character.
  - B. Refuse them like any other player award.
  - **Decision: B, provisional.** A code is tamper-evident, not secret (`js/ap-grant-code.js`): the database cannot tell a
    DM-issued code from one a player made, and exempting the field would leave the gap open to anyone who adds `grantId`. On a
    campaign the DM's authoritative channel is "Award AP" (`award_ap`). The Live Sheet now refuses Redeem on a locked or sealed
    campaign character before writing (so the save is never stranded) and says to ask the DM. Redeem is unchanged for solo
    characters, and for campaign characters before the lock or while reopened. This narrows #638's Q1 ("Redeem stays") for
    finished campaign characters only.

- **Q6 — `ignore_player_ap` campaigns:** unchanged scope (refused before and after the lock, as since 2026-09-03), except that
  a forged `dmEdit:true` award now counts (Q3).

- **Q7 — award amounts that are not numbers** (added after review).
  - A. Leave them: they cast to numeric. B. Refuse any `award` whose `jsonb_typeof(amount)` is not `number`, on every campaign
    character, for every writer, locked or not.
  - **Decision: B.** A string `"NaN"` casts to numeric NaN, which turns every award sum NaN: the budget check and this
    ceiling then compare nothing. Planted before the lock, it would disarm both checks after it. `"500"` and `"Infinity"`
    are refused for the same reason. Every client writes a number (checked in the source 2026-10-12: CharGen Budget,
    invite seed and import; Live Sheet award, redeem, seed and DM-history clone; DM Console boon grant; `dm_zero_player_ap`).
    A missing amount still counts 0 and is allowed. The live measurement did not record the JSON type of the stored amounts,
    so the owner re-checks that before applying: a stored string amount would make that character's every save refused.

**Scope — what this does NOT close.** This closes the AWARD route on a finished campaign character. Costs are still stamped by
the client, so a locked character can still gain AP through a drawback bought with a larger negative cost (a refund) or a
non-drawback buy with a negative cost. Both predate this change and are a separate board task
(`fix/server-negative-cost-after-lock`).

**Admin sessions are not exempt** (minor). With no JWT (SQL editor, service role) `auth.uid()` is null, so
`is_campaign_dm()` is false and the rule applies. `pact_enforce_creation_lock()` exempts admin sessions; this rule, like its
2026-09-03 version, does not. A hand repair that raises an award total disables `trg_pact_player_ap_ceiling` for that one
transaction.

**Baseline.** Per `sql/migrations/README.md` and the precedents (#580→#598, #600→#608), an unapplied migration merges as
migration + rollback + rehearsal only. `rls-policies.sql` is folded in a later PR, after the owner applies it. That PR also
folds the 2026-09-03 functions, which were applied but never folded in.

**Client side** (so a write the server refuses is never offered): Live Sheet `redeemGrant()` refuses via `_lsAwardsFrozen()`;
CharGen's Budget field also locks on a SEALED campaign character that was never creation-locked (`_cgAwardsFrozen()`; the
locked case was #638 item 5).

**Why.** The server, not the client, has to be the boundary for AP: the tools' checks are only UX. The sum-shaped rule closes the
award route without refusing any save the live data contains, and moving the DM exemption from a writer-set flag to the writer's identity
makes the existing rule honest too.

**Status.** Provisional — owner away, taken under standing instruction H2, reversible. The migration
(`sql/migrations/2026-10-12-server-player-award-after-lock.sql`, rollback beside it) was **APPLIED to production on
2026-10-13** (migration `server_player_award_after_lock`, owner decision N1 — found still unapplied while building
`feat/dm-ap-discount`). Pre-checks passed (below); afterwards the new version is live and `authenticated` can no longer execute
the trigger function. Before applying, confirm the live `pact_enforce_player_ap_ceiling()` still matches
`2026-09-03-dm-zero-player-ap.sql`, so the rollback is exact. Rehearsed by
`testing/scripts/creation-lock-guard-test/run-award.sh` (39 cases; 17 attacks allowed today, all 39 pass after, rollback
byte-identical). **Folded into `sql/rls-policies.sql` on 2026-10-20** (`docs/house-rules-fold`, with `dm_zero_player_ap()` from
2026-09-03 and the campaign house-rules migration); `rls-baseline-test.sql` now drift-checks both functions. Still open: the 2(a)
re-measure (no creation-locked or sealed campaign character whose stored award total would rise) is not yet recorded here.
