-- PACT — server freeze, stage 3: houseRules and gold are no longer exempt from the freeze.
-- feat/server-freeze-houserules-gold (D-GH-2026-10-27-server-freeze-houserules-gold). Follows stage 1 (applied 2026-10-10) and stage 2 (applied 2026-10-11).
-- APPLIED to the live database on 2026-10-27 (migration `server_freeze_houserules_gold`), after the live function matched the stage-1 text; the live definition's md5 equals a local build of this file.
--
-- THE GAP. Stage 1 left a PERMANENT exemption: pact_patch_exempt_keys() = {appearance, houseRules, gold}, on the belief that those three carry no AP. Two of
-- them do (found by fix/player-free-ap, 2026-10-12): compute() prices houseRules (custom and repriced boons and drawbacks via b.houseRules, and the
-- Martially Bound +2 in `misc`) and gold ("Starting gold" at 1 AP per step). So a modified client could still rewrite a houseRules or gold patch event
-- in place on a locked, sealed or awarded character and move what the engine prices.
--
-- THE CHANGE. One line: pact_patch_exempt_keys() returns {appearance} only. pact_patch_protected_projection() reads that list, so a patch event that
-- carries houseRules or gold now joins the protected list, and pact_enforce_locked_history() refuses to rewrite, reorder or remove it once the character is
-- locked, sealed or awarded. APPENDING a new patch event is still allowed, as for every other protected field. Nothing else changes.
--
-- MEASURED LIVE before writing this (2026-10-27, read-only): 1,067 snapshots (every backup plus the live row) of 91 characters. 452 consecutive saved
-- pairs started from a locked or sealed row; NONE of them rewrote or removed a houseRules or gold value. 44 characters carry a houseRules patch value
-- (23 of them locked or sealed at some snapshot, 14 in a campaign); no character has ever carried a gold value. So the rule refuses no save that exists.
-- The tools agree: CharGen refuses both fields after the lock, the Live Sheet writes the Tasha rule as a cat:'tasharule' buy (not a patch), and the DM
-- writes dmHouseRules (a different event type, through dm_edit_character_log / dm_apply_house_rules_change).
--
-- Rollback: 2026-10-27-server-freeze-houserules-gold-rollback.sql.

create or replace function public.pact_patch_exempt_keys()
 returns text[] language sql immutable set search_path to 'public', 'pg_temp'
as $function$ select array['appearance']::text[] $function$;
comment on function public.pact_patch_exempt_keys() is
  'PERMANENT: the only patch field that carries no AP and stays editable after a lock/seal (appearance text). houseRules and gold left this list on 2026-10-27 (stage 3): compute() prices both. Everything else in a buy/patch event is protected (fail-closed).';
