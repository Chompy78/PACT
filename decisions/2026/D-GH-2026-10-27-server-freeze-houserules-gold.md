# D-GH-2026-10-27-server-freeze-houserules-gold — stage 3 of the server freeze: houseRules and gold are protected after a lock

**Context.** Stage 1 (applied 2026-10-10) froze every priced patch field once a character is locked, sealed or awarded, but left a PERMANENT
exemption: `pact_patch_exempt_keys()` = {appearance, houseRules, gold}, on the belief that those three carry no AP. `fix/player-free-ap`
(2026-10-12) found that two of them do. `compute()` prices `houseRules` (custom and repriced boons and drawbacks through `b.houseRules`, and the
Martially Bound +2 in `misc`) and `gold` ("Starting gold" at 1 AP per step). So a modified client could still rewrite a `houseRules` or `gold`
patch event in place on a locked, sealed or awarded character and move what the engine prices.

**Live measurement** (read-only, 2026-10-27, before any SQL was written): every backup plus every live row, 1,067 snapshots of 91 characters.
452 consecutive saved pairs started from a locked or sealed row; **none** rewrote or removed a `houseRules` or `gold` value. 44 characters carry a
`houseRules` patch value (23 of them locked or sealed at some snapshot, 14 in a campaign). No character has ever carried a `gold` value. The tools
agree with the data: CharGen refuses both fields after the lock; the Live Sheet records the Tasha house rule as a `cat:'tasharule'` buy, not a patch;
the DM writes `dmHouseRules` (a different event type) through `dm_edit_character_log` / `dm_apply_house_rules_change`.

**Decision.** `pact_patch_exempt_keys()` returns {appearance}. One line, one migration, no new function. `pact_patch_protected_projection()` reads
that list, so a patch event carrying `houseRules` or `gold` joins the protected list and `pact_enforce_locked_history()` refuses to rewrite, reorder
or remove it. APPENDING a new patch event stays allowed, as for every other protected field. This is deeper than the cheap alternative (refuse only
in CharGen, which already does) because the server is the only place a hand-made request is stopped.

**Options considered.** (A) Drop both keys now: chosen, zero real saves are affected. (B) Drop only `gold`, keep `houseRules` for the
`feat/dm-house-rules-editor` work: rejected, because that editor writes through the DM RPCs (`dmHouseRules` events), not a player patch, and the task
board already says the DM route must stay able to write, which it does. (C) Wait for the editor first: rejected, no dependency.

**Pinned by** `freeze-cases.sql` (stage-aware: `-v hrgold=refused` after this migration; the existing "edit house rules in place" case and the
per-key `houseRules` / `gold` cases flip from allowed to refused) and `run-freeze.sh` (stage 3 apply, 69/69, rollback byte-identical to the stage-1
permanent list, stage-2 expectations restored). `rls-policies.sql` carries the new definition; `rls-baseline-test.sql` now drift-checks
`pact_patch_exempt_keys` (52 bodies).

**Independent review** (a fresh Claude subagent, code search only). No writer of either field exists in the Live Sheet, DM Console, `sync.js`,
`dm.js` or `campaign*.js`; CharGen refuses gold after the lock (the `economy` post-lock plan) and house rules after the lock (every caller checks
`_cgDmCustomReadOnly`). Two things it flagged: (1) CharGen's HOUSE_RULES slot is NOT in `_CG_POSTLOCK_SLOTS`, so that refusal rests on every caller
checking first, and the server rule is now the backstop for a missed one; (2) `pactWithAppearance()` rewrites the last appearance-carrying patch event
in place, so a legacy bundle holding `appearance` AND `houseRules` is rewritten by an appearance edit. The trigger compares protected projections, not
whole events, so that stays legal and only a change to the `houseRules` value is refused. Pinned by three new cases on a mixed-event character
(69 cases in all).

**Also recorded here (the board's "not yet recorded" item, read-only, 2026-10-27).** All 10 characters in Amble carry a `creationLocked` event, and
all 10 have saved since stage 2 went live (last save the same day). 203 campaign backups (each one an accepted save) were captured since stage 2
across 13 characters, 22 of them since 2026-10-20: honest campaign saves succeed under the freeze.

**Status.** Applied to the live database on 2026-10-27; the live `pact_patch_exempt_keys()` md5 equals a local build of the migration, and the security advisor shows nothing new.
