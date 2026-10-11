-- ROLLBACK for 2026-10-11-server-freeze-stage2.sql: restores the stage-1 temporary exempt list exactly. Functions only; no data was changed.
create or replace function public.pact_patch_temp_exempt_keys()
 returns text[] language sql immutable set search_path to 'public', 'pg_temp'
as $function$ select array['traditions','innate','dabblerCantrips','martiallyBound','originClass','originClass2','species','species2','size','lineage']::text[] $function$;
comment on function public.pact_patch_temp_exempt_keys() is
  'TEMPORARY (stage 1, 2026-10-05): priced/identity patch fields the character-creation tool still rewrites in place after a lock until phase 2b ships (spellcasting, innate spells, martial binding, dabbler cantrips, species, origin classes, size, lineage). Removed by the stage-2 migration. Keep separate from the permanent list so an entry cannot quietly become permanent.';
