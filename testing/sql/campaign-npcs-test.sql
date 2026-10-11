-- PACT — campaign NPCs (feat/campaign-npcs, D-GH-2026-10-11-campaign-npcs).
--
-- Builds the documented fresh-install path (sql/schema.sql + sql/rls-policies.sql), then proves the NPC rules: a DM can
-- bind several of their own characters to their campaign as NPCs; players keep the one-per-campaign rule; nobody but a
-- DM of that campaign can make an NPC; players cannot read NPC rows or set the flag; unbinding clears it; the basic-mode
-- count still includes NPCs. Run by .github/workflows/sql-guards.yml; locally:
--   psql -v ON_ERROR_STOP=1 -f testing/sql/campaign-npcs-test.sql   (any Postgres 14+, on an empty database)
-- One assertion per line; the first failure raises, so psql's exit code is the pass/fail signal.

\set ON_ERROR_STOP on
set client_min_messages = notice;
\pset tuples_only on
\pset format unaligned

-- Supabase shims — same as rls-baseline-test.sql.
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
-- The RLS checks below run AS `authenticated`, whose policies call auth.uid().
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
create or replace function pg_temp.rejects(p_name text, p_sql text, p_expect text default 'PACT: %')
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
    raise notice '  PASS % (rejected: %)', p_name, left(sqlerrm, 70);
end $$;

create table pg_temp.ids (k text primary key, v uuid);
grant select on pg_temp.ids to authenticated;
create or replace function pg_temp.id(p_k text) returns uuid language sql as $$ select v from pg_temp.ids where k = p_k $$;

\echo ''
\echo 'Setup: a DM with a campaign (starting AP 36), a co-DM, two players'
do $$
declare v uuid; v_c uuid;
begin
  insert into auth.users (email) values ('dm@x.test')     returning id into v; insert into pg_temp.ids values ('dm', v);
  insert into auth.users (email) values ('codm@x.test')   returning id into v; insert into pg_temp.ids values ('codm', v);
  insert into auth.users (email) values ('player@x.test') returning id into v; insert into pg_temp.ids values ('player', v);
  insert into auth.users (email) values ('other@x.test')  returning id into v; insert into pg_temp.ids values ('other', v);

  perform set_config('pact.test_uid', pg_temp.id('dm')::text, false);
  insert into public.campaigns (dm_id, name, rules) values (pg_temp.id('dm'), 'Amble probe', '{"startingTier":{"ap":36}}')
    returning id into v_c;
  insert into pg_temp.ids values ('camp', v_c);
  insert into public.campaign_dms (campaign_id, dm_id, added_by) values (v_c, pg_temp.id('codm'), pg_temp.id('dm'))
    on conflict do nothing;
end $$;

do $$
declare v uuid; n text;
begin
  perform set_config('pact.test_uid', pg_temp.id('dm')::text, false);
  foreach n in array array['npc1','npc2','npc3','dmpc','archived'] loop
    insert into public.characters (owner_id, name, stats) values (pg_temp.id('dm'), 'DM char ' || n, '{"LOG":[]}')
      returning id into v;
    insert into pg_temp.ids values (n, v);
  end loop;
  update public.characters set archived_at = now() where id = pg_temp.id('archived');

  perform set_config('pact.test_uid', pg_temp.id('codm')::text, false);
  insert into public.characters (owner_id, name, stats) values (pg_temp.id('codm'), 'Co-DM NPC', '{"LOG":[]}') returning id into v;
  insert into pg_temp.ids values ('conpc', v);

  perform set_config('pact.test_uid', pg_temp.id('player')::text, false);
  foreach n in array array['p1','p2'] loop
    insert into public.characters (owner_id, name, stats) values (pg_temp.id('player'), 'Player char ' || n, '{"LOG":[]}')
      returning id into v;
    insert into pg_temp.ids values (n, v);
  end loop;
end $$;

\echo ''
\echo 'A DM binds several NPCs; no starting AP; they are not "members"'
do $$
declare v_code text;
begin
  perform set_config('pact.test_uid', pg_temp.id('dm')::text, false);
  perform public.dm_bind_npc(pg_temp.id('npc1'), pg_temp.id('camp'));
  perform public.dm_bind_npc(pg_temp.id('npc2'), pg_temp.id('camp'));
  perform public.dm_bind_npc(pg_temp.id('npc3'), pg_temp.id('camp'));
  perform pg_temp.ok('three NPCs of one DM are bound to one campaign',
    (select count(*) from public.characters where campaign_id = pg_temp.id('camp') and is_npc) = 3);
  perform pg_temp.ok('binding an NPC grants NO starting AP (no ledger row, ap = 0)',
    not exists (select 1 from public.ap_awards where character_id in (pg_temp.id('npc1'), pg_temp.id('npc2'), pg_temp.id('npc3')))
    and (select sum(ap) from public.characters where id in (pg_temp.id('npc1'), pg_temp.id('npc2'), pg_temp.id('npc3'))) = 0);
  perform pg_temp.ok('re-binding the same NPC to the same campaign is an idempotent no-op',
    public.dm_bind_npc(pg_temp.id('npc1'), pg_temp.id('camp')) = pg_temp.id('camp'));
  perform pg_temp.ok('a DM who owns only NPCs there is NOT a campaign member', not public.is_campaign_member(pg_temp.id('camp')));

  perform public.award_ap(pg_temp.id('npc1'), 82, 'NPC budget');
  perform pg_temp.ok('award_ap works on an NPC', (select ap from public.characters where id = pg_temp.id('npc1')) = 82);

  -- The DM can still join their own campaign as a PLAYER, exactly once.
  select invite_code into v_code from public.campaigns where id = pg_temp.id('camp');
  perform public.bind_character_to_campaign(pg_temp.id('dmpc'), v_code);
  perform pg_temp.ok('the DM can still bind ONE player character of their own (NPCs do not count against it)',
    (select campaign_id from public.characters where id = pg_temp.id('dmpc')) = pg_temp.id('camp')
    and not (select is_npc from public.characters where id = pg_temp.id('dmpc')));
  perform pg_temp.ok('...which makes them a member', public.is_campaign_member(pg_temp.id('camp')));
  perform pg_temp.rejects('...and a second player join by the DM is still refused',
    format('select public.join_campaign(%L)', v_code), '%already joined%');

  perform pg_temp.rejects('an archived character cannot be added as an NPC',
    format('select public.dm_bind_npc(%L, %L)', pg_temp.id('archived'), pg_temp.id('camp')), 'PACT: un-archive%');
  perform pg_temp.rejects('a character already in the campaign as a player cannot be re-bound as an NPC',
    format('select public.dm_bind_npc(%L, %L)', pg_temp.id('dmpc'), pg_temp.id('camp')), 'PACT: this character is already in a campaign%');
end $$;

\echo ''
\echo 'Players keep the one-per-campaign rule and cannot make NPCs'
do $$
declare v_code text;
begin
  select invite_code into v_code from public.campaigns where id = pg_temp.id('camp');
  perform set_config('pact.test_uid', pg_temp.id('player')::text, false);
  perform public.bind_character_to_campaign(pg_temp.id('p1'), v_code);
  perform pg_temp.ok('a player binds one character and gets the campaign starting AP',
    (select ap from public.characters where id = pg_temp.id('p1')) = 36);
  perform pg_temp.rejects('a player binding a SECOND character is still refused',
    format('select public.bind_character_to_campaign(%L, %L)', pg_temp.id('p2'), v_code), '%already joined%');
  perform pg_temp.rejects('the unique index itself still refuses a second player row (the race guard)',
    format('update public.characters set campaign_id = %L where id = %L', pg_temp.id('camp'), pg_temp.id('p2')),
    '%idx_characters_owner_campaign_unique%');
  perform pg_temp.rejects('a player cannot make their own character an NPC',
    format('select public.dm_bind_npc(%L, %L)', pg_temp.id('p2'), pg_temp.id('camp')), 'PACT: only a DM%');
  perform pg_temp.rejects('a player cannot bind the DM''s character as an NPC',
    format('select public.dm_bind_npc(%L, %L)', pg_temp.id('npc2'), pg_temp.id('camp')), 'PACT: character not found%');
  perform pg_temp.ok('a player is not a "DM of" the DM through the DM''s NPCs', not public.is_dm_of_player(pg_temp.id('dm')));
  -- Even a privileged write cannot leave an UNBOUND row flagged: the unbind trigger resets it before the check runs.
  update public.characters set is_npc = true where id = pg_temp.id('p2');
  perform pg_temp.ok('the flag cannot stick on an unbound row',
    not (select is_npc from public.characters where id = pg_temp.id('p2')));
  perform pg_temp.ok('the check constraint is present as a second line of defence',
    exists (select 1 from pg_constraint where conname = 'characters_npc_needs_campaign'));
end $$;

\echo ''
\echo 'RLS and column grants, run AS the authenticated role'
do $$
declare v_seen int; v_dm_seen int;
begin
  perform set_config('pact.test_uid', pg_temp.id('player')::text, false);
  set local role authenticated;
  select count(*) into v_seen from public.characters where is_npc;
  reset role;
  perform pg_temp.ok('a player in the campaign reads NO NPC rows (saw ' || v_seen || ')', v_seen = 0);

  perform set_config('pact.test_uid', pg_temp.id('dm')::text, false);
  set local role authenticated;
  select count(*) into v_dm_seen from public.characters where is_npc and campaign_id = pg_temp.id('camp');
  reset role;
  perform pg_temp.ok('the DM reads all three NPC rows (saw ' || v_dm_seen || ')', v_dm_seen = 3);
end $$;

do $$ begin
  perform set_config('pact.test_uid', pg_temp.id('player')::text, false);
  set local role authenticated;
  perform pg_temp.rejects('a player cannot UPDATE is_npc directly (no column grant)',
    format('update public.characters set is_npc = true where id = %L', pg_temp.id('p1')), '%permission denied%');
  perform pg_temp.rejects('a player cannot INSERT a row with is_npc (no column grant)',
    format('insert into public.characters (owner_id, name, stats, is_npc) values (%L, %L, ''{"LOG":[]}'', true)',
      pg_temp.id('player'), 'Sneaky'), '%permission denied%');
  perform pg_temp.rejects('anon/authenticated cannot call the unbind trigger function',
    'select public.pact_npc_clear_on_unbind()', '%permission denied%');
  reset role;
end $$;

\echo ''
\echo 'Unbinding clears the flag (RPC, remove_dm, campaign delete)'
do $$
declare v_c2 uuid;
begin
  perform set_config('pact.test_uid', pg_temp.id('dm')::text, false);
  perform public.dm_unbind_character(pg_temp.id('npc3'));
  perform pg_temp.ok('dm_unbind_character on an NPC clears campaign_id AND is_npc',
    (select campaign_id is null and not is_npc from public.characters where id = pg_temp.id('npc3')));

  perform set_config('pact.test_uid', pg_temp.id('codm')::text, false);
  perform public.dm_bind_npc(pg_temp.id('conpc'), pg_temp.id('camp'));
  perform pg_temp.ok('a co-DM can bind their own NPC', (select is_npc from public.characters where id = pg_temp.id('conpc')));
  perform set_config('pact.test_uid', pg_temp.id('dm')::text, false);
  perform public.remove_dm(pg_temp.id('camp'), pg_temp.id('codm'));
  perform pg_temp.ok('remove_dm unbinds the removed co-DM''s NPCs',
    (select campaign_id is null and not is_npc from public.characters where id = pg_temp.id('conpc')));
  perform pg_temp.ok('...and leaves the owner-DM''s NPCs alone',
    (select count(*) from public.characters where campaign_id = pg_temp.id('camp') and is_npc) = 2);

  insert into public.campaigns (dm_id, name) values (pg_temp.id('dm'), 'Doomed campaign') returning id into v_c2;
  perform public.dm_bind_npc(pg_temp.id('npc3'), v_c2);
  delete from public.campaigns where id = v_c2;
  perform pg_temp.ok('deleting a campaign (FK on delete set null) clears is_npc too',
    (select campaign_id is null and not is_npc from public.characters where id = pg_temp.id('npc3')));
end $$;

\echo ''
\echo 'Basic mode still counts NPCs (no bypass via a self-made campaign)'
do $$
declare v_u uuid; v_c uuid; v_ch uuid;
begin
  insert into auth.users (email) values ('basic@x.test') returning id into v_u;
  perform set_config('pact.test_uid', v_u::text, false);
  insert into public.campaigns (dm_id, name) values (v_u, 'Own campaign') returning id into v_c;
  insert into public.characters (owner_id, name, stats) values (v_u, 'Basic first', '{"LOG":[]}') returning id into v_ch;
  perform public.dm_bind_npc(v_ch, v_c);
  update public.profiles set basic_mode = true where id = v_u;
  perform pg_temp.rejects('a basic-mode user whose only character is an NPC still cannot create a second active character',
    format('insert into public.characters (owner_id, name, stats) values (%L, %L, ''{"LOG":[]}'')', v_u, 'Basic second'));
end $$;

\echo ''
\echo 'ALL CAMPAIGN-NPC ASSERTIONS PASSED'
