-- PACT — a DM changes ONE campaign character's house rules (feat/dm-house-rules-editor,
-- D-GH-2026-10-12-dm-house-rules-editor). Tests sql/migrations/2026-10-12-dm-house-rules-edit.sql and its rollback.
--
-- Builds the documented fresh-install path (sql/schema.sql + sql/rls-policies.sql = production as recorded), proves
-- the CURRENT dm_edit_character_log refuses a house-rules patch, applies the migration, then proves: a campaign DM can
-- APPEND a houseRules-only patch to a LOCKED, AWARDED character (the triggers let it through); the event is rebuilt
-- from a whitelist and server-stamped; every malformed shape, every other patch field, the owner and another
-- campaign's DM are refused; nothing moves the server's AP ledger; the boon/award amount check still holds; and the
-- rollback restores the previous function byte-for-byte. Run by .github/workflows/sql-guards.yml; locally:
--   psql -v ON_ERROR_STOP=1 -f testing/sql/dm-house-rules-test.sql   (any Postgres 14+, on an empty database)
-- One assertion per line; the first failure raises, so psql's exit code is the pass/fail signal.

\set ON_ERROR_STOP on
set client_min_messages = notice;
\pset tuples_only on
\pset format unaligned

-- Supabase shims — same as campaign-npcs-test.sql.
create schema if not exists auth;
do $$
declare r text;
begin
  foreach r in array array['anon','authenticated','service_role'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
  end loop;
end $$;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('pact.test_uid', true), '')::uuid;
$$;
grant usage on schema auth to authenticated;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

\ir ../../sql/schema.sql
\ir ../../sql/rls-policies.sql

create or replace function pg_temp.ok(p_name text, p_cond boolean) returns void
language plpgsql as $$
begin
  if p_cond then raise notice '  PASS %', p_name;
  else raise exception 'FAIL %', p_name; end if;
end $$;

-- Must be refused with a message matching p_expect — any OTHER error is a harness failure, not a pass.
create or replace function pg_temp.rejects(p_name text, p_sql text, p_expect text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL % (the write was ALLOWED)', p_name;
exception
  when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not like p_expect then
      raise exception 'FAIL % (HARNESS ERROR — expected % but got: %)', p_name, p_expect, left(sqlerrm, 160);
    end if;
    raise notice '  PASS % (rejected: %)', p_name, left(sqlerrm, 80);
end $$;

create table pg_temp.ids (k text primary key, v uuid);
create or replace function pg_temp.id(p_k text) returns uuid language sql as $$ select v from pg_temp.ids where k = p_k $$;
create table pg_temp.src (k text primary key, v text);

\echo ''
\echo 'Setup: a DM, another table''s DM, a player; a LOCKED, AWARDED campaign character with its own house rules'
do $$
declare v uuid; v_c uuid; v_c2 uuid;
  c constant uuid := '00000000-0000-0000-0000-0000000000a1';
begin
  insert into auth.users (email) values ('hr-dm@x.test')     returning id into v; insert into pg_temp.ids values ('dm', v);
  insert into auth.users (email) values ('hr-dm2@x.test')    returning id into v; insert into pg_temp.ids values ('dm2', v);
  insert into auth.users (email) values ('hr-player@x.test') returning id into v; insert into pg_temp.ids values ('player', v);
  perform set_config('pact.test_uid', pg_temp.id('dm')::text, false);
  insert into public.campaigns (dm_id, name) values (pg_temp.id('dm'), 'House rules probe') returning id into v_c;
  perform set_config('pact.test_uid', pg_temp.id('dm2')::text, false);
  insert into public.campaigns (dm_id, name) values (pg_temp.id('dm2'), 'Another table') returning id into v_c2;
  insert into pg_temp.ids values ('camp', v_c), ('camp2', v_c2), ('c', c);

  insert into public.characters (id, owner_id, name, campaign_id, ap, stats) values (c, pg_temp.id('player'), 'House rules probe', v_c, 0,
    jsonb_build_object('schema','pact-character/1','rules','v0.364','SEQ',6,'LOG', jsonb_build_array(
      jsonb_build_object('seq',1,'ts',1,'type','award','amount',79,'label','Award'),
      jsonb_build_object('seq',2,'ts',2,'type','buy','cat','oclass','cost',0,'payload',jsonb_build_object('v','Fighter')),
      jsonb_build_object('seq',3,'ts',3,'type','buy','cat','patch','_slot','houseRules','cost',0,'label','DM customisations',
        'payload',jsonb_build_object('patch',jsonb_build_object('houseRules',jsonb_build_object(
          'boons','{}'::jsonb,'draws','{}'::jsonb,'disabled',jsonb_build_object('boons','[]'::jsonb,'draws','[]'::jsonb),
          'dmAllows',jsonb_build_object('bound',true,'boons',true,'drawbacks',true,'tasha',true))))),
      jsonb_build_object('seq',4,'ts',4,'type','buy','cat','boon','cost',3,'payload',jsonb_build_object('v','Lucky')),
      jsonb_build_object('seq',5,'ts',5,'type','creationLocked','label','Finished creating'))));
  perform pg_temp.ok('the probe character is bound to the DM''s campaign', (select campaign_id from public.characters where id = c) = v_c);
end $$;

\echo ''
\echo 'Before the migration: the current function refuses a house-rules patch'
do $$
begin
  insert into pg_temp.src values ('before', (select md5(prosrc) from pg_proc where proname = 'dm_edit_character_log'));
  perform set_config('pact.test_uid', pg_temp.id('dm')::text, false);
  perform pg_temp.rejects('production today: buy/cat:patch is an unsupported category',
    format('select public.dm_edit_character_log(%L, %L::jsonb)', pg_temp.id('c'),
      '[{"type":"buy","cat":"patch","payload":{"patch":{"houseRules":{"dmAllows":{"boons":false}}}},"cost":0}]'),
    'dm_edit_character_log: unsupported buy category patch');
end $$;

\echo ''
\echo 'Apply 2026-10-12-dm-house-rules-edit.sql'
\ir ../../sql/migrations/2026-10-12-dm-house-rules-edit.sql

\echo ''
\echo 'Refusals — wrong shapes, other fields, wrong callers (nothing is written by any of them)'
do $$
declare
  c uuid := pg_temp.id('c');
  q text := 'select public.dm_edit_character_log(%L, %L::jsonb)';
  ok_hr text := '{"dmAllows":{"bound":true,"boons":false,"drawbacks":true,"tasha":true}}';
  v_len int; v_seq text;
begin
  select jsonb_array_length(stats->'LOG'), stats->>'SEQ' into v_len, v_seq from public.characters where id = c;
  perform set_config('pact.test_uid', pg_temp.id('dm')::text, false);
  perform pg_temp.rejects('a patch carrying another field ALONGSIDE houseRules (hd) is refused',
    format(q, c, '[{"type":"buy","cat":"patch","payload":{"patch":{"houseRules":' || ok_hr || ',"hd":5}},"cost":0}]'),
    'dm_edit_character_log: a DM patch may carry houseRules and nothing else');
  perform pg_temp.rejects('a patch of any OTHER field (stats) is refused',
    format(q, c, '[{"type":"buy","cat":"patch","payload":{"patch":{"stats":{"STR":20}}},"cost":0}]'),
    'dm_edit_character_log: a DM patch may carry houseRules and nothing else');
  perform pg_temp.rejects('a patch with no payload is refused',
    format(q, c, '[{"type":"buy","cat":"patch","cost":0}]'),
    'dm_edit_character_log: a DM patch may carry houseRules and nothing else');
  perform pg_temp.rejects('houseRules that is not an object is refused',
    format(q, c, '[{"type":"buy","cat":"patch","payload":{"patch":{"houseRules":[1,2]}},"cost":0}]'),
    'dm_edit_character_log: houseRules must be an object');
  perform pg_temp.rejects('an unknown houseRules field is refused',
    format(q, c, '[{"type":"buy","cat":"patch","payload":{"patch":{"houseRules":{"budget":999}}},"cost":0}]'),
    'dm_edit_character_log: houseRules has an unknown field');
  perform pg_temp.rejects('a DM call that is not true/false is refused',
    format(q, c, '[{"type":"buy","cat":"patch","payload":{"patch":{"houseRules":{"dmAllows":{"boons":"no"}}}},"cost":0}]'),
    'dm_edit_character_log: houseRules.dmAllows%');
  perform pg_temp.rejects('an unknown DM call is refused',
    format(q, c, '[{"type":"buy","cat":"patch","payload":{"patch":{"houseRules":{"dmAllows":{"freeAp":true}}}},"cost":0}]'),
    'dm_edit_character_log: houseRules.dmAllows%');
  perform pg_temp.rejects('a custom boon without hd is refused',
    format(q, c, '[{"type":"buy","cat":"patch","payload":{"patch":{"houseRules":{"boons":{"X":{"ap":3}}}}},"cost":0}]'),
    'dm_edit_character_log: each houseRules boon%');
  perform pg_temp.rejects('a custom boon whose ap is text is refused (cleanly, not a cast error)',
    format(q, c, '[{"type":"buy","cat":"patch","payload":{"patch":{"houseRules":{"boons":{"X":{"hd":1,"ap":"lots"}}}}},"cost":0}]'),
    'dm_edit_character_log: each houseRules boon%');
  perform pg_temp.rejects('a custom boon at hd 25 is refused',
    format(q, c, '[{"type":"buy","cat":"patch","payload":{"patch":{"houseRules":{"boons":{"X":{"hd":25,"ap":3}}}}},"cost":0}]'),
    'dm_edit_character_log: each houseRules boon%');
  perform pg_temp.rejects('a custom drawback worth 5000 AP is refused',
    format(q, c, '[{"type":"buy","cat":"patch","payload":{"patch":{"houseRules":{"draws":{"Rich":{"ap":5000}}}}},"cost":0}]'),
    'dm_edit_character_log: each houseRules drawback%');
  perform pg_temp.rejects('a custom drawback with an extra field is refused',
    format(q, c, '[{"type":"buy","cat":"patch","payload":{"patch":{"houseRules":{"draws":{"D":{"ap":2,"grant":50}}}}},"cost":0}]'),
    'dm_edit_character_log: each houseRules drawback%');
  perform pg_temp.rejects('a disabled list that is not a list of names is refused',
    format(q, c, '[{"type":"buy","cat":"patch","payload":{"patch":{"houseRules":{"disabled":{"boons":[1]}}}},"cost":0}]'),
    'dm_edit_character_log: houseRules.disabled%');
  perform pg_temp.rejects('a house-rules patch cannot carry an unpaid boon grant along with it (amount check still holds)',
    format(q, c, '[{"type":"buy","cat":"patch","payload":{"patch":{"houseRules":' || ok_hr || '}},"cost":0},{"type":"buy","cat":"boon","payload":{"v":"Tough"},"cost":4}]'),
    'dm_edit_character_log: boon grant at cost % has no matching award%');

  perform set_config('pact.test_uid', pg_temp.id('player')::text, false);
  perform pg_temp.rejects('the character''s OWNER cannot use the DM path to change their house rules',
    format(q, c, '[{"type":"buy","cat":"patch","payload":{"patch":{"houseRules":' || ok_hr || '}},"cost":0}]'),
    'Only a campaign DM can edit this character');
  perform set_config('pact.test_uid', pg_temp.id('dm2')::text, false);
  perform pg_temp.rejects('a DM of a DIFFERENT campaign cannot change them either',
    format(q, c, '[{"type":"buy","cat":"patch","payload":{"patch":{"houseRules":' || ok_hr || '}},"cost":0}]'),
    'Only a campaign DM can edit this character');

  perform pg_temp.ok('...and the stored log is untouched by every refusal above',
    (select jsonb_array_length(stats->'LOG') from public.characters where id = c) = v_len
    and (select stats->>'SEQ' from public.characters where id = c) = v_seq);
end $$;

\echo ''
\echo 'The happy path — a DM appends a house-rules change to a locked, awarded character'
do $$
declare
  c uuid := pg_temp.id('c');
  v_res jsonb; v_ev jsonb; v_before jsonb; v_after jsonb;
  v_spent_b numeric; v_earned_b numeric; v_spent_a numeric; v_earned_a numeric;
begin
  select stats->'LOG' into v_before from public.characters where id = c;
  select spent, player_earned into v_spent_b, v_earned_b from public.pact_ap_ledger_spend(v_before);
  perform set_config('pact.test_uid', pg_temp.id('dm')::text, false);
  v_res := public.dm_edit_character_log(c, jsonb_build_array(jsonb_build_object(
    'type','buy','cat','patch','cost',-1,'level',3,'label','DM house rules — Lucky repriced',
    '_slot','houseRules','amount',50,'dmLocked',true,'disc',true,'gp',5,'seq',1,'dmEdit',false,'dmId',pg_temp.id('player'),
    'payload',jsonb_build_object('v','smuggled','patch',jsonb_build_object('houseRules',jsonb_build_object(
      'boons',jsonb_build_object('Lucky',jsonb_build_object('hd',1,'ap',2,'fx','cheaper at this table')),
      'draws',jsonb_build_object('Sworn Enemy',jsonb_build_object('ap',3,'fx','')),
      'disabled',jsonb_build_object('boons','[]'::jsonb,'draws',jsonb_build_array('Peg Leg')),
      'dmAllows',jsonb_build_object('bound',false,'boons',true,'drawbacks',true,'tasha',false)))))));
  v_ev := v_res->0;
  perform pg_temp.ok('the DM''s house-rules change is accepted (one event returned)', jsonb_array_length(v_res) = 1);
  perform pg_temp.ok('...rebuilt from the whitelist: exactly type, cat, payload, cost, label, level + server stamps',
    (select array_agg(k order by k) from jsonb_object_keys(v_ev) k)
      = array['cat','cost','dmEdit','dmId','label','level','payload','seq','ts','type']);
  perform pg_temp.ok('...a buy/patch whose payload holds ONLY patch.houseRules',
    v_ev->>'type' = 'buy' and v_ev->>'cat' = 'patch'
    and (select array_agg(k) from jsonb_object_keys(v_ev->'payload') k) = array['patch']
    and (select array_agg(k) from jsonb_object_keys(v_ev->'payload'->'patch') k) = array['houseRules']);
  perform pg_temp.ok('...carrying the DM''s calls and repricing',
    v_ev#>'{payload,patch,houseRules,dmAllows,bound}' = 'false'::jsonb
    and v_ev#>'{payload,patch,houseRules,boons,Lucky,ap}' = '2'::jsonb);
  perform pg_temp.ok('...server-stamped: seq 6, dmEdit true, dmId = the calling DM (forged values discarded)',
    v_ev->>'seq' = '6' and v_ev->'dmEdit' = 'true'::jsonb and v_ev->>'dmId' = pg_temp.id('dm')::text);
  perform pg_temp.ok('...its ledger cost is FORCED to 0 (the client sent -1): a rules change refunds and charges nothing',
    v_ev->'cost' = '0'::jsonb);
  perform pg_temp.ok('...and keeps the level', v_ev->'level' = '3'::jsonb);
  select stats->'LOG' into v_after from public.characters where id = c;
  perform pg_temp.ok('it is APPENDED: the stored history before it is byte-identical (the player''s own house-rules event untouched)',
    jsonb_array_length(v_after) = jsonb_array_length(v_before) + 1
    and (select jsonb_agg(e order by o) from jsonb_array_elements(v_after) with ordinality t(e, o) where o <= jsonb_array_length(v_before)) = v_before);
  perform pg_temp.ok('...and SEQ advanced to 7', (select stats->>'SEQ' from public.characters where id = c) = '7');
  select spent, player_earned into v_spent_a, v_earned_a from public.pact_ap_ledger_spend(v_after);
  perform pg_temp.ok('the server AP ledger is unmoved (patch costs are js/engine.js''s to price, not SQL''s)',
    v_spent_a = v_spent_b and v_earned_a = v_earned_b);
  perform pg_temp.ok('a houseRules-only patch has no protected projection (stays out of the frozen history)',
    public.pact_patch_protected_projection(v_ev) is null);

  -- A second change is another append; the engine folds patches in order, so the last one wins.
  perform public.dm_edit_character_log(c, '[{"type":"buy","cat":"patch","payload":{"patch":{"houseRules":{"dmAllows":{"bound":true,"boons":false,"drawbacks":true,"tasha":true}}}},"cost":"lots"}]'::jsonb);
  perform pg_temp.ok('a second change appends again (log +1, seq 7, default label, a junk cost stamped 0)',
    (select jsonb_array_length(stats->'LOG') from public.characters where id = c) = jsonb_array_length(v_after) + 1
    and (select stats->'LOG'->-1->>'seq' from public.characters where id = c) = '7'
    and (select stats->'LOG'->-1->>'label' from public.characters where id = c) = 'DM house rules'
    and (select stats->'LOG'->-1->'cost' from public.characters where id = c) = '0'::jsonb);
end $$;

\echo ''
\echo 'The player''s own saves still go through after a DM edit (the DM event is not frozen history they must carry verbatim forever)'
do $$
declare c uuid := pg_temp.id('c');
begin
  perform set_config('pact.test_uid', pg_temp.id('player')::text, false);
  update public.characters set stats = jsonb_set(stats, '{LOG}', (stats->'LOG') || jsonb_build_array(jsonb_build_object(
    'seq', 8, 'ts', 8, 'type', 'buy', 'cat', 'patch', 'cost', 0, 'payload', jsonb_build_object('patch', jsonb_build_object('appearance', jsonb_build_object('hair','red'))))))
   where id = c;
  perform pg_temp.ok('an ordinary player save after the DM edit is accepted',
    (select stats->'LOG'->-1#>>'{payload,patch,appearance,hair}' from public.characters where id = c) = 'red');
end $$;

\echo ''
\echo 'Rollback restores the previous function exactly'
\ir ../../sql/migrations/2026-10-12-dm-house-rules-edit-rollback.sql
do $$
begin
  perform pg_temp.ok('the rolled-back function is byte-identical to the pre-migration one',
    (select md5(prosrc) from pg_proc where proname = 'dm_edit_character_log') = (select v from pg_temp.src where k = 'before'));
  perform set_config('pact.test_uid', pg_temp.id('dm')::text, false);
  perform pg_temp.rejects('after rollback, a house-rules patch is refused again',
    format('select public.dm_edit_character_log(%L, %L::jsonb)', pg_temp.id('c'),
      '[{"type":"buy","cat":"patch","payload":{"patch":{"houseRules":{}}},"cost":0}]'),
    'dm_edit_character_log: unsupported buy category patch');
  perform pg_temp.ok('the grants survive (authenticated may execute, anon may not)',
    has_function_privilege('authenticated', 'public.dm_edit_character_log(uuid,jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.dm_edit_character_log(uuid,jsonb)', 'execute'));
end $$;

\echo ''
\echo 'dm-house-rules-test: all assertions passed'
