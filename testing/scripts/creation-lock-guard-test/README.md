# Creation-lock guard — Docker test

Tests `sql/migrations/2026-10-04-creation-lock-guard.sql` (D1 server guard, L1 campaign move keeps the lock,
S1 keep every campaign backup) on a **throwaway Postgres in Docker**. No real database is touched.
Decision: `D-GH-2026-10-01-creation-lock-integrity`. Run: `./run.sh` (needs Docker only).

| File | What |
|---|---|
| `base.sql` | stand-ins for Supabase (`auth.uid()`, roles, tables) + the live function text the guard sits beside (`pact_enforce_locked_history`, `is_campaign_dm`, pre-guard `snapshot_character` / `pact_campaign_move_clears_creation`) |
| `triggers.sql` | the live triggers in play (alphabetical order decides firing order) |
| `guard-cases.sql` | 22 cases: run **before** (the attacks must succeed) and **after** (all must PASS) |
| `dm-rpcs.sql`, `dm-rpc-cases.sql` | the live `dm_reopen_creation()` / `dm_set_creation_ceiling()` still work with the guard on |
| `move-and-backups.sql` | L1 (a move keeps the lock) and S1 (campaign character keeps all backups; solo is pruned to 50) |

**Limits.** `base.sql` is a snapshot of live definitions taken 2026-10-04 and is NOT the whole schema: it omits
RLS, `pact_enforce_ap_budget_consistency`, `pact_enforce_player_ap_ceiling`, `pact_enforce_basic_mode`, and
real Supabase Auth (claims are faked with `request.jwt.claims`). Refresh it when those functions change. The
real fix for that gap is bringing `sql/schema.sql` + `rls-policies.sql` up to date so CI's `cloud-e2e` can
test it (the restart note's option T3).

## Server freeze, stage 1 (D2 + E1) — added 2026-10-05

`sql/migrations/2026-10-05-server-freeze-d2-e1-stage1.sql` (+ `-rollback.sql`), plan `docs/plans/2026-10-04-server-freeze-d2-e1.md`. **Applied to the live database on 2026-10-10** (merging the file did not apply it; the apply was a separate owner-approved step).

| File | What |
|---|---|
| `freeze-live-defs.sql` | `pact_ap_ledger_protected()` and `pact_enforce_locked_history()` exactly as LIVE on 2026-10-04 (`pg_get_functiondef`); loaded after `base.sql`, whose older copy predates `dmUnlockDrawback` |
| `freeze-cases.sql` | 66 cases: attacks (refused after), legitimate saves (allowed), the lock lifecycle (reopen, re-lock, seal), solo/unlocked characters, and **one case per patch key** including an unknown future key (fail-closed) |
| `run-freeze.sh` | `BEFORE` (36 attacks work today) → apply (`psql -1`) → `AFTER` (all 61 pass) → rollback (byte-identical definitions) → attacks work again. In CI as the `freeze-rehearsal` job |
| `backup-replay-audit.mjs` | replays every real old→new save from `character_backups` through the OLD then the NEW rule; lists the saves only the new rule refuses |
| `roundtrip-audit.mjs` | loads every live character in the real CharGen and Live Sheet, autosaves, and checks the frozen part of the history is untouched (`--force-end` stress mode, `--synthetic` Live-Sheet-origin variants) |

Both audits take an export of live rows (made with a read-only query) and **must not be committed** — it holds real player data.

**When the migration is applied to live:** (1) add it to the `\ir` lists in `testing/sql/session-seal-test.sql` and `testing/sql/rls-baseline-test.sql`; (2) fold the two changed functions and the three helpers into `sql/rls-policies.sql`, so a fresh install matches production and
re-running the baseline file can never revert the freeze; (3) run the Supabase advisors. Until then the baseline correctly describes production.


## Stage 2 — added 2026-10-11 (NOT applied to the live database)

`sql/migrations/2026-10-11-server-freeze-stage2.sql` (+ `-rollback.sql`) empties the stage-1 TEMPORARY exempt list, so spellcasting, innate spells, martial binding, dabbler cantrips, origin classes, size and lineage become protected like every other priced patch field (only appearance, houseRules and gold stay editable). `run-freeze.sh` now rehearses it after stage 1: `freeze-cases.sql` takes `-v tmpexp=refused` (the default `allowed` is the stage-1 expectation), all 61 cases must pass at stage 2, and the stage-2 rollback must restore the stage-1 list exactly.

Before applying to live, re-run both audits against a FRESH read-only export with the new flag: `backup-replay-audit.mjs <export.json> --stage2` lists every real saved pair that stage 2 would refuse but stage 1 (live today) allows — each must be a rewrite the current tools no longer make — and `roundtrip-audit.mjs <export.json> --stage2 --campaign-all` loads every live character in both tools and checks nothing in the stage-2-protected part of the history moves. Apply only after both come back clean.

## Player award after the lock — added 2026-10-12 (applied to the live database 2026-10-13; folded into `rls-policies.sql` 2026-10-20)

`sql/migrations/2026-10-12-server-player-award-after-lock.sql` (+ `-rollback.sql`), decision `D-GH-2026-10-12-server-player-award-after-lock`. Amends `pact_enforce_player_ap_ceiling()` so nobody but the campaign's DM can raise a locked or sealed campaign character's LOG award total, and no campaign character's award amount can be anything but a JSON number. Folded into `rls-policies.sql` on 2026-10-20 together with `2026-09-03-dm-zero-player-ap.sql`, so the baseline already carries it: `run-award.sh` records the folded definition, steps back with the house-rules rollback (applied later; its guards refuse some of these attacks on their own) and then this file's rollback, and checks that the re-applied migration matches the fold.

| File | What |
|---|---|
| `award-shims.sql` | Supabase stand-ins (auth schema, roles, `auth.users`, `auth.uid()` from `request.jwt.claims`, pgcrypto) |
| `award-cases.sql` | 39 cases on the REAL fresh-install path (`schema.sql` + `rls-policies.sql`, which carries `2026-09-03-dm-zero-player-ap.sql` since 2026-10-20), so `dm_edit_character_log`, `award_ap`, `award_ap_and_seal`, `dm_zero_player_ap`, the budget check and the history lock all run beside the rule: player-award attacks, the CharGen Budget singleton moves (incl. the live 77-AP-after-the-lock shape), DM paths, solo, reopened, `ignore_player_ap` campaigns, and award amounts that are not JSON numbers ("NaN", "500", "Infinity", a NaN planted before the lock) |
| `run-award.sh` | step back to the 2026-09-03 rule → `BEFORE` (17 attacks allowed) → apply → `AFTER` (all 39 pass) → rollback (byte-identical to 2026-09-03) → the gap is back. In CI's `freeze-rehearsal` job |

## Campaign house rules, the server half — added 2026-10-13 (applied to the live database 2026-10-20; folded into `rls-policies.sql` the same day)

`sql/migrations/2026-10-13-campaign-house-rules-server.sql` (+ `-rollback.sql`), decision `D-GH-2026-10-13-campaign-house-rules` (its PR3 addendum), plan `docs/plans/2026-10-13-campaign-house-rules.md`. Adds `dm_apply_house_rules_change()`, the `campaigns.rules.charHouseRules` guard, `dmHouseRules` in `dm_edit_character_log()`, the split ledger with the owner's Z1 drawback cap and M4 targeted buy-off netting, the M1 DM-family forgery guard and the extended history lock. Applied 2026-10-20 (plus two follow-ups that only re-spelled `pact_js_number()`'s trim set in ASCII — the file carries the final text) and folded into `rls-policies.sql` the same day, so `run-house-rules.sh` records the folded definitions, steps back with the rollback first, and checks that the re-applied migration matches the fold; `run-dm-house-rules-replay.sh` re-applies the file on top of the baseline (it is re-runnable).

| File | What |
|---|---|
| `house-rules-cases.sql` | 191 cases (incl. three PR #654 security review rounds' attacks — two pinned as allowed: the pre-existing negative-cost route and the R2-6 residual risk — and owner decision AB1's drawback price list) on the REAL fresh-install path (`schema.sql` + `rls-policies.sql`, which carries `2026-09-03-dm-zero-player-ap.sql` and `2026-10-12-server-player-award-after-lock.sql` since 2026-10-20), each with an AFTER expectation and a BEFORE prediction: the campaign-key guard, every RPC refusal the decision record lists (shape, who, draft, unknown/wrong/ambiguous/stale target, imposed, DM-granted, M3 from/to incl. pin > override > campaign and the printed-value fallback), what the RPC stamps, `dm_edit_character_log` + `dmHouseRules`, the ledger and budget (X1, Z1, M4, V1), every forgery the M1 guard refuses, the honest player saves and every DM path it must keep allowing, and the history lock |
| `drawback-cap-shapes.json` | 45 `rules.drawbackCap` shapes with the cap the real `js/campaign.js` `drawbackCapFromRules()` gives (generated from it; `house-rules-ledger-ci.mjs` re-checks the JS side) |
| `run-house-rules.sh` | step back with the rollback → `BEFORE` (every case lands as predicted: 145 gaps/new behaviours fail) → apply (`psql -1`) → `AFTER` (all pass; Z1 shapes agree; the real SQL ledger equals `house-rules-ledger-ci.mjs`'s port on the fuzz's random histories) → rollback (five definitions byte-identical, seventeen functions and three triggers gone, cases back to BEFORE). In CI's `freeze-rehearsal` job |

Also: `testing/scripts/dm-family-roundtrip-e2e.mjs` (real Live Sheet + CharGen: an honest save never touches the DM family) and `roundtrip-audit.mjs`, which now checks the DM family on a live export too.

## Character images — added 2026-10-15 (applied to the live database 2026-10-19)

`sql/migrations/2026-10-15-character-images.sql` (+ `-rollback.sql`), decision `D-GH-2026-10-15-character-images`. A private Storage bucket and four `storage.objects` policies: the character's owner reads and writes `<character id>/1|2`; its campaign's DMs and the campaign's other players read (NPCs included); nobody else; and an object older than its character row (a leftover from a deleted row whose uuid was recreated) is untouchable by everyone.

| File | What |
|---|---|
| `images-storage-shim.sql` | stand-ins for `storage.buckets` / `storage.objects` with RLS on (the Storage API's size and MIME limits are NOT in the database, so not tested here) |
| `images-cases.sql` | 55 cases on the real fresh-install path: who reads (owner, DM, co-DM, fellow player, outsider, other campaign's DM/player, anon, NPC), who writes (third slot, bad names, other characters, DM, anon, rename/move, Storage-API-style upsert), access following the character live (unbind, move, ownership transfer, deleted row), and a recreated row with a deleted character's uuid inheriting nothing |
| `run-images.sh` | `BEFORE` (20 rows fail: the feature isn't there) → apply → `AFTER` (all 55 pass) → re-run (idempotent) → rollback (back to the BEFORE counts). In CI's `freeze-rehearsal` job |

## Boon & drawback descriptions — added 2026-10-15 (applied to the live database 2026-10-19)

`sql/migrations/2026-10-15-boon-drawback-notes.sql` (+ `-rollback.sql`), decision `D-GH-2026-10-15-boon-drawback-notes`. A DM approves a player's description of certain boons/drawbacks through `dm_edit_character_log` (`dmApproveNote` / `dmUnlockNote`), and the new `pact_enforce_item_note_lock()` refuses a player's change to an approved description on a campaign character. Folded into `rls-policies.sql` 2026-10-19; since the house-rules fold (2026-10-20) `run-notes.sh` steps back with the house-rules rollback first (it restores this migration's `dm_edit_character_log`), then with this one's.

| File | What |
|---|---|
| `notes-cases.sql` | 54 cases on the REAL fresh-install path (`schema.sql` + `rls-policies.sql`) (which carries `2026-09-03-dm-zero-player-ap.sql` and `2026-10-12-server-player-award-after-lock.sql` since 2026-10-20): the DM's approve/unlock (incl. what the stored event carries), player attacks on an approved description (append, rewrite, delete, forged approval/unlock, insert into a campaign), the text cap, the #673 review fixes (approval bound to its exact text, the DM sends the text shown, a claimed pregen's approvals dropped via the real `redeem_character_claim`, joining via `bind_character_to_campaign` / `redeem_player_invite` with forged approvals, JS-equivalent blank detection), and the legitimate paths (edit before approval, after an unlock, solo, another campaign's approval, admin repair, DM boon grant) |
| `run-notes.sh` | prints the BASE md5 of `dm_edit_character_log` (compare with production before applying) → `BEFORE` (28 cases fail: the gap and the missing DM events) → apply single-transaction → `AFTER` (all 54 pass) → rollback (byte-identical `dm_edit_character_log`, added objects gone). In CI's `freeze-rehearsal` job |

## Negative costs — added 2026-10-25

`sql/migrations/2026-10-25-server-negative-cost.sql` (+ `-rollback.sql`), decision `D-GH-2026-10-25-server-negative-cost-after-lock`. A new trigger refuses a NEW negative-cost `buy` (any cat except `drawback`, `patch`, `mbound`, `dbound`) or `names` event, and a binding cheaper than `-pact_binding_grant_max()` (2), on a campaign character written by anyone but a DM of its campaign or an admin session. Folded into `rls-policies.sql` in the same change; the migration is applied to the live database as a separate step. It is NEWER than the house-rules migration and its trigger calls `pact_num()`, so `run-house-rules.sh`, `run-award.sh` and `run-notes.sh` roll it back first (before they step past house rules); that is also why `house-rules-cases.sql` still pins R2-2 / R2-4 as allowed: in that harness the guard is stepped back, and `negative-cost-cases.sql` covers the refusal.

| File | What |
|---|---|
| `negative-cost-cases.sql` | 36 cases on the REAL fresh-install path: 19 attacks (a -1000 skill/boon buy, a -1000 names event alone and beside the spend in one save, a binding below -2, a string cost, a catless or unknown-cat buy, a positive buy rewritten negative, a second copy beside a stored negative) and 17 legitimate paths (ordinary and free buys, paid names, bindings at -2 and -1, a negative patch, a drawback, stored negatives re-saved or beside a new buy, solo, admin, the DM) |
| `run-negative-cost.sh` | roll the folded baseline back → `BEFORE` (the 15 attacks work, every legitimate case passes) → apply → `AFTER` (all 36 pass; the two functions are byte-identical to the fold; the trigger function is not callable) → check `pact_binding_grant_max()` against `js/engine.js`'s flat binding price → rollback (functions and trigger gone, the gap is back). In CI's `freeze-rehearsal` job |
