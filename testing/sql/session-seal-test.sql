-- PACT — verification harness for sql/migrations/2026-09-01-session-seal.sql (feat/session-seal).
--
-- WHAT IS UNDER TEST. That migration does not add a new trigger; it AMENDS the one that has existed
-- since 2026-08-10 (pact_enforce_locked_history). So this harness has two jobs, and the second
-- matters more than the first:
--   1. the seal works — solo characters included, the seal itself cannot be removed;
--   2. THE EXISTING AWARD BOUNDARY STILL BEHAVES EXACTLY AS BEFORE. Amending a live rule that
--      already protects 35 real characters is the risk here, not the new feature.
--
-- HOW TO RUN. Any Postgres 14+; no Supabase needed. auth.uid, is_campaign_dm,
-- assert_campaign_active and award_ap are stubbed to the real signatures, and "who is logged in" is
-- a session GUC so a test can switch between DM, owner and stranger.
--
--   initdb -D /tmp/pgseal/data -U postgres --auth=trust
--   pg_ctl -D /tmp/pgseal/data -o "-p 55432 -k /tmp/pgseal" -l /tmp/pgseal/log start
--   psql -h /tmp/pgseal -p 55432 -U postgres -v ON_ERROR_STOP=1 -f testing/sql/session-seal-test.sql
--
-- One assertion per line; the first failure raises, so psql's exit code is the pass/fail signal.

\set ON_ERROR_STOP on
-- NOTICE level is deliberate: every assertion reports through raise notice, so lowering this to
-- `warning` silences the entire pass list and leaves only "it didn't crash" as evidence.
set client_min_messages = notice;
\pset tuples_only on
\pset format unaligned

-- ---------------------------------------------------------------------------
-- Stubs: the smallest shapes the migration actually touches.
-- ---------------------------------------------------------------------------
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('pact.test_uid', true), '')::uuid;
$$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

create table if not exists public.characters (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, campaign_id uuid,
  name text not null default 'New Character', stats jsonb not null default '{}'::jsonb,
  ap integer not null default 0, updated_at timestamptz not null default now());
create table if not exists public.ap_awards (
  id uuid primary key default gen_random_uuid(),
  character_id uuid, dm_id uuid, campaign_id uuid, amount integer, note text);
create table if not exists public.campaign_dms (campaign_id uuid, dm_id uuid);

create or replace function public.is_campaign_dm(p_campaign uuid) returns boolean
language sql stable as $$
  select exists (select 1 from campaign_dms where campaign_id = p_campaign and dm_id = auth.uid());
$$;
create or replace function public.assert_campaign_active(p_campaign uuid) returns void
language plpgsql as $$ begin return; end; $$;
create or replace function public.award_ap(p_character uuid, p_amount integer, p_note text default null)
returns integer language plpgsql as $$
declare v_campaign uuid; v_ap integer;
begin
  select campaign_id into v_campaign from characters where id = p_character;
  if v_campaign is null then raise exception 'Character is not in a campaign'; end if;
  if not is_campaign_dm(v_campaign) then raise exception 'Only a campaign DM can award AP'; end if;
  insert into ap_awards (character_id, dm_id, campaign_id, amount, note)
    values (p_character, auth.uid(), v_campaign, p_amount, p_note);
  update characters set ap = ap + p_amount where id = p_character returning ap into v_ap;
  return v_ap;
end; $$;

-- ---------------------------------------------------------------------------
-- The migration under test, then the trigger it AMENDS (which already exists in production, so the
-- migration does not re-create it — this harness must).
-- ---------------------------------------------------------------------------
\ir ../../sql/migrations/2026-09-01-session-seal.sql

drop trigger if exists trg_pact_locked_history on public.characters;
create trigger trg_pact_locked_history
  before update on public.characters
  for each row execute function public.pact_enforce_locked_history();

-- ---------------------------------------------------------------------------
-- Assertion helpers.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.ok(p_name text, p_cond boolean) returns void
language plpgsql as $$
begin
  if p_cond then raise notice '  PASS %', p_name;
  else raise exception 'FAIL %', p_name; end if;
end; $$;

-- The point of this migration is what it REFUSES, so these matter more than the happy paths.
create or replace function pg_temp.rejects(p_name text, p_sql text) returns void
language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then
    raise notice '  PASS % (rejected: %)', p_name, left(sqlerrm, 60); return;
  end;
  raise exception 'FAIL % — the statement was ACCEPTED and should not have been', p_name;
end; $$;

-- Rebuilds both fixtures from scratch so each section starts from a known state.
create or replace function pg_temp.reset_fixtures() returns void language plpgsql as $$
begin
  delete from characters; delete from ap_awards;
  -- c1: campaign-bound, carries a real (non-disc, non-noLock) award at ordinal 1.
  insert into characters (id, owner_id, campaign_id, stats) values (
    '00000000-0000-0000-0000-0000000000c1',
    '22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444444',
    jsonb_build_object('schema','pact-character/1','SEQ',5,'LOG', jsonb_build_array(
      jsonb_build_object('seq',1,'ts',1,'type','award','amount',79),
      jsonb_build_object('seq',2,'ts',2,'type','buy','cat','boon','payload',jsonb_build_object('v','Alertness'),'cost',6),
      jsonb_build_object('seq',3,'ts',3,'type','buy','cat','patch','_slot','identity','cost',0),
      jsonb_build_object('seq',4,'ts',4,'type','name','name','Anders'))));
  -- c2: solo (no campaign), one award — which the award boundary must IGNORE.
  insert into characters (id, owner_id, campaign_id, stats) values (
    '00000000-0000-0000-0000-0000000000c2',
    '22222222-2222-2222-2222-222222222222', null,
    jsonb_build_object('schema','pact-character/1','SEQ',3,'LOG', jsonb_build_array(
      jsonb_build_object('seq',1,'ts',1,'type','award','amount',79),
      jsonb_build_object('seq',2,'ts',2,'type','buy','cat','boon','payload',jsonb_build_object('v','Alertness'),'cost',6))));
end; $$;

insert into campaign_dms values ('44444444-4444-4444-4444-444444444444',
                                 '11111111-1111-1111-1111-111111111111');
select pg_temp.reset_fixtures();

\echo ''
\echo 'REGRESSION — the 2026-08-10 award boundary must behave exactly as before'
select pg_temp.rejects('a campaign character''s pre-award history still cannot be rewritten',
  $$update characters set stats = jsonb_set(stats,'{LOG,0}','{"type":"award","amount":999}'::jsonb)
     where id = '00000000-0000-0000-0000-0000000000c1'$$);
select pg_temp.rejects('...nor shrink below the award',
  $$update characters set stats = jsonb_set(stats,'{LOG}','[]'::jsonb)
     where id = '00000000-0000-0000-0000-0000000000c1'$$);
do $$ begin
  -- cat:'patch' stays exempt — CharGen and the Live Sheet rewrite these slots in place by design.
  update characters set stats = jsonb_set(stats,'{LOG,2}',
    jsonb_build_object('seq',3,'ts',3,'type','buy','cat','patch','_slot','identity','cost',0,'changed',true))
    where id = '00000000-0000-0000-0000-0000000000c1';
  perform pg_temp.ok('a cat:patch event is still freely rewritable', true);
  -- Appending after the boundary is still fine.
  update characters set stats = jsonb_set(stats,'{LOG}', (stats->'LOG') ||
    jsonb_build_array(jsonb_build_object('seq',5,'ts',5,'type','buy','cat','boon','cost',4)))
    where id = '00000000-0000-0000-0000-0000000000c1';
  perform pg_temp.ok('appending after the award boundary is still allowed', true);
end $$;

\echo ''
\echo 'A SOLO character is still untouched by the award boundary (unchanged scope)'
do $$ begin
  update characters set stats = jsonb_set(stats,'{LOG}','[]'::jsonb)
    where id = '00000000-0000-0000-0000-0000000000c2';
  perform pg_temp.ok('a solo character with an award can still be emptied', jsonb_array_length(stats->'LOG') = 0)
    from characters where id = '00000000-0000-0000-0000-0000000000c2';
end $$;
select pg_temp.reset_fixtures();

\echo ''
\echo 'Placing a seal — authorisation (owner decision I2)'
set pact.test_uid = '33333333-3333-3333-3333-333333333333';   -- a stranger
select pg_temp.rejects('a stranger cannot seal a campaign character',
  $$select seal_character_history('00000000-0000-0000-0000-0000000000c1'::uuid,'nope')$$);
select pg_temp.rejects('a stranger cannot seal someone else''s solo character',
  $$select seal_character_history('00000000-0000-0000-0000-0000000000c2'::uuid,'nope')$$);

set pact.test_uid = '22222222-2222-2222-2222-222222222222';   -- the OWNER
select pg_temp.rejects('the owner cannot seal their own CAMPAIGN character (only the DM can)',
  $$select seal_character_history('00000000-0000-0000-0000-0000000000c1'::uuid,'nope')$$);
do $$ declare s jsonb; begin
  s := seal_character_history('00000000-0000-0000-0000-0000000000c2'::uuid,'Solo session 1');
  perform pg_temp.ok('the owner CAN seal their own solo character (I2)', s->>'type' = 'sessionSeal');
  perform pg_temp.ok('a solo seal records the owner role',   s->>'sealedRole' = 'owner');
  perform pg_temp.ok('a solo seal is not marked a DM edit',  not (s ? 'dmEdit'));
  perform pg_temp.ok('a seal carries no AP value',           not (s ? 'amount') and not (s ? 'cost'));
end $$;

\echo ''
\echo 'The seal now protects a SOLO character, which the award boundary never did'
select pg_temp.rejects('a sealed solo character cannot be emptied',
  $$update characters set stats = jsonb_set(stats,'{LOG}','[]'::jsonb)
     where id = '00000000-0000-0000-0000-0000000000c2'$$);
select pg_temp.rejects('a sealed solo character''s earlier purchase cannot be rewritten',
  $$update characters set stats = jsonb_set(stats,'{LOG,1}','{"type":"buy","cat":"boon","cost":999}'::jsonb)
     where id = '00000000-0000-0000-0000-0000000000c2'$$);
select pg_temp.rejects('the seal itself cannot be removed',
  $$update characters set stats = jsonb_set(stats,'{LOG}',
      (select jsonb_agg(e) from jsonb_array_elements(stats->'LOG') e where e->>'type' <> 'sessionSeal'))
     where id = '00000000-0000-0000-0000-0000000000c2'$$);
do $$ begin
  update characters set stats = jsonb_set(stats,'{LOG}', (stats->'LOG') ||
    jsonb_build_array(jsonb_build_object('seq',9,'ts',9,'type','name','name','Renamed After Seal')))
    where id = '00000000-0000-0000-0000-0000000000c2';
  perform pg_temp.ok('an append-only description edit after a seal is allowed (K3)', true);
  update characters set stats = jsonb_set(stats,'{LOG}', (stats->'LOG') ||
    jsonb_build_array(jsonb_build_object('seq',10,'ts',10,'type','dmRemoveBoon','dmEdit',true)))
    where id = '00000000-0000-0000-0000-0000000000c2';
  perform pg_temp.ok('a correction appended after a seal is allowed (J1)', true);
end $$;

\echo ''
\echo 'On a campaign character the boundary is the LATER of award and seal'
set pact.test_uid = '11111111-1111-1111-1111-111111111111';   -- the DM
do $$ declare s jsonb; begin
  -- Append a buy AFTER the award, then seal: the seal must move the boundary past that buy.
  update characters set stats = jsonb_set(stats,'{LOG}', (stats->'LOG') ||
    jsonb_build_array(jsonb_build_object('seq',5,'ts',5,'type','buy','cat','boon','cost',4)))
    where id = '00000000-0000-0000-0000-0000000000c1';
  s := seal_character_history('00000000-0000-0000-0000-0000000000c1'::uuid,'Session 4');
  perform pg_temp.ok('the DM can seal a campaign character',  s->>'type' = 'sessionSeal');
  perform pg_temp.ok('a DM seal records the dm role',         s->>'sealedRole' = 'dm');
  perform pg_temp.ok('a DM seal is marked a DM edit',         (s->>'dmEdit')::boolean);
end $$;
select pg_temp.rejects('a purchase made AFTER the award but BEFORE the seal is now frozen too',
  $$update characters set stats = jsonb_set(stats,'{LOG,4}','{"type":"buy","cat":"boon","cost":1}'::jsonb)
     where id = '00000000-0000-0000-0000-0000000000c1'$$);

\echo ''
\echo 'Idempotency — a retry must not stack seals or double AP'
do $$ declare s1 jsonb; s2 jsonb; before integer; after1 integer; after2 integer; r2 jsonb; begin
  s1 := seal_character_history('00000000-0000-0000-0000-0000000000c1'::uuid,'Session 5','idem-abc');
  s2 := seal_character_history('00000000-0000-0000-0000-0000000000c1'::uuid,'Session 5','idem-abc');
  perform pg_temp.ok('a repeated seal with the same key returns the SAME seal', s1->>'seq' = s2->>'seq');
  perform pg_temp.ok('...and appends only one',
    (select count(*) from jsonb_array_elements(stats->'LOG') e where e->>'idem' = 'idem-abc') = 1)
    from characters where id = '00000000-0000-0000-0000-0000000000c1';

  select ap into before from characters where id = '00000000-0000-0000-0000-0000000000c1';
  perform award_ap_and_seal('00000000-0000-0000-0000-0000000000c1'::uuid, 7, 'Session 6', 'idem-xyz');
  select ap into after1 from characters where id = '00000000-0000-0000-0000-0000000000c1';
  r2 := award_ap_and_seal('00000000-0000-0000-0000-0000000000c1'::uuid, 7, 'Session 6', 'idem-xyz');
  select ap into after2 from characters where id = '00000000-0000-0000-0000-0000000000c1';

  perform pg_temp.ok('award_ap_and_seal awards exactly once',    after1 = before + 7);
  perform pg_temp.ok('a retry with the same key awards NOTHING', after2 = after1);
  perform pg_temp.ok('the retry reports itself as repeated',     (r2->>'repeated')::boolean);
  perform pg_temp.ok('exactly one ledger row for the award',
    (select count(*) from ap_awards where note = 'Session 6') = 1);
end $$;

\echo ''
\echo 'dm_edit_character_log — a seal may also arrive through the DM edit path'
do $$ declare r jsonb; begin
  r := dm_edit_character_log('00000000-0000-0000-0000-0000000000c1'::uuid,
        jsonb_build_array(jsonb_build_object('type','sessionSeal','label','via edit','amount',999,'cost',5)));
  perform pg_temp.ok('a sessionSeal is accepted by the allow-list', r->0->>'type' = 'sessionSeal');
  perform pg_temp.ok('an AP amount smuggled onto a seal is STRIPPED',
    not (r->0 ? 'amount') and not (r->0 ? 'cost'));
  perform pg_temp.ok('it is stamped as a DM edit', (r->0->>'dmEdit')::boolean);
end $$;
-- Must run AS THE DM, or it is refused by the authorisation check and proves nothing about the
-- allow-list. (An earlier version of this harness got exactly that wrong and reported a false PASS.)
set pact.test_uid = '11111111-1111-1111-1111-111111111111';
select pg_temp.rejects('an unrelated event type is still refused by the allow-list',
  $$select dm_edit_character_log('00000000-0000-0000-0000-0000000000c1'::uuid,
      jsonb_build_array(jsonb_build_object('type','creationLocked')))$$);

\echo ''
\echo 'ALL SESSION-SEAL SQL ASSERTIONS PASSED'
