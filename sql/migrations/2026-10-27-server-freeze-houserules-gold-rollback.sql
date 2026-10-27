-- ROLLBACK for 2026-10-27-server-freeze-houserules-gold.sql: restores the stage-1 permanent exempt list exactly. Functions only; no data was changed.
create or replace function public.pact_patch_exempt_keys()
 returns text[] language sql immutable set search_path to 'public', 'pg_temp'
as $function$ select array['appearance','houseRules','gold']::text[] $function$;
comment on function public.pact_patch_exempt_keys() is
  'PERMANENT: patch fields that carry no AP and stay editable after a lock/seal (appearance text, house-rule toggles, the legacy wallet field). Everything else in a buy/patch event is protected (fail-closed).';
