-- PACT — server freeze, STAGE 2. Plan: docs/plans/2026-10-04-server-freeze-d2-e1.md. Decision: decisions/2026/D-GH-2026-10-05-server-freeze-stage1.md (stage 2 section).
-- NOT APPLIED to the live database as of this file's creation — applying it is the owner's decision. Rehearsed on a throwaway Docker Postgres
-- (testing/scripts/creation-lock-guard-test/run-freeze.sh, stage-2 phase). Rollback: sql/migrations/2026-10-11-server-freeze-stage2-rollback.sql.
--
-- WHAT. Stage 1 (applied 2026-10-10) left a TEMPORARY exemption: patch fields the character-creation tool still rewrote in place after a lock — spellcasting (`traditions`), innate
-- spells, martial binding, dabbler cantrips, origin classes, size and lineage (species/species2 were already frozen by their own rule). CharGen no longer does that: since phase 2b
-- (#579, #584) it REFUSES those edits after the lock, or records them as appended in-play purchases, and both shipped to `main` in v1.599. So the exemption can go: those eight
-- fields are now protected like every other priced patch field, and only the three PERMANENT no-AP fields (appearance, houseRules, gold) stay editable.
--
-- HOW. One line: pact_patch_temp_exempt_keys() returns an empty list. The helper stays (stage 3 may delete it; the projection function reads both lists), so nothing else changes.
-- Functions only; no stored row is touched. Effect on saves: a client older than v1.583 that rewrites one of those fields after a lock now gets the existing "locked character
-- history ... reload" message, exactly as stage 1 did for the priced fields.

create or replace function public.pact_patch_temp_exempt_keys()
 returns text[] language sql immutable set search_path to 'public', 'pg_temp'
as $function$ select array[]::text[] $function$;
comment on function public.pact_patch_temp_exempt_keys() is
  'EMPTY since stage 2 (2026-10-11). Was the stage-1 TEMPORARY exemption (spellcasting, innate spells, martial binding, dabbler cantrips, origin classes, size, lineage, species); the creation tool no longer rewrites those after a lock. Kept as an empty list so the projection function is unchanged; a later cleanup may delete it.';
