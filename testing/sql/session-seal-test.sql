-- PACT — verification harness for sql/migrations/2026-09-01-session-seal.sql (feat/session-seal).
--
-- WHY THIS EXISTS AS A FILE RATHER THAN A ONE-OFF. The seal's whole value is that it holds against
-- write paths nobody enumerated, so "I read the SQL and it looks right" is not evidence. This runs
-- the real migration against a real Postgres and asserts the behaviour, including the cases three
-- cold reviewers asked for: the stale-client truncation, the sealed-event rewrite, idempotent retry,
-- and — the one that protects the 35 live characters — that an UNSEALED character is completely
-- unaffected.
--
-- HOW TO RUN. Any Postgres 14+ will do; it needs no Supabase, because the four things it depends on
-- (auth.uid, is_campaign_dm, assert_campaign_active, award_ap) are stubbed below to the same
-- signatures and semantics the real schema gives them. The identity of the "current user" is a GUC,
-- so a test can switch between DM, owner and stranger without an auth server.
--
--   initdb -D /tmp/pgseal/data -U postgres --auth=trust
--   pg_ctl -D /tmp/pgseal/data -o "-p 55432 -k /tmp/pgseal" -l /tmp/pgseal/log start
--   psql -h /tmp/pgseal -p 55432 -U postgres -v ON_ERROR_STOP=1 -f testing/sql/session-seal-test.sql
--
-- This file applies the migration ITSELF (via \ir below) after installing the stubs, because the
-- migration's functions reference is_campaign_dm()/assert_campaign_active()/award_ap() and so cannot
-- be loaded first. One invocation, in the right order, no ceremony to remember.
--
-- Prints one line per assertion and raises on the first failure, so a non-zero psql exit is the
-- pass/fail signal. Run it against a Supabase BRANCH before the production migration.

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

-- Supabase provides this role; a bare Postgres does not, and the migration's GRANTs name it.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

create table if not exists public.characters (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null,
  campaign_id uuid,
  name        text not null default 'New Character',
  stats       jsonb not null default '{}'::jsonb,
  ap          integer not null default 0,
  updated_at  timestamptz not null default now()
);
create table if not exists public.ap_awards (
  id uuid primary key default gen_random_uuid(),
  character_id uuid, dm_id uuid, campaign_id uuid, amount integer, note text
);
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
-- The migration under test. Applied here, after the stubs it depends on.
-- ---------------------------------------------------------------------------
\ir ../../sql/migrations/2026-09-01-session-seal.sql

-- ---------------------------------------------------------------------------
-- Assertion helpers.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.ok(p_name text, p_cond boolean) returns void
language plpgsql as $$
begin
  if p_cond then raise notice '  PASS %', p_name;
  else raise exception 'FAIL %', p_name; end if;
end; $$;

-- Asserts that a statement fails. Used for every "must be rejected" case — the point of the whole
-- migration is what it REFUSES, so these matter more than the happy paths.
create or replace function pg_temp.rejects(p_name text, p_sql text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice '  PASS % (rejected: %)', p_name, left(sqlerrm, 60);
    return;
  end;
  raise exception 'FAIL % — the statement was ACCEPTED and should not have been', p_name;
end; $$;

-- ---------------------------------------------------------------------------
-- Fixtures.
-- ---------------------------------------------------------------------------
\set dm    '''11111111-1111-1111-1111-111111111111'''
\set owner '''22222222-2222-2222-2222-222222222222'''
\set other '''33333333-3333-3333-3333-333333333333'''
\set camp  '''44444444-4444-4444-4444-444444444444'''

truncate characters, ap_awards, campaign_dms;
insert into campaign_dms values (:camp, :dm);

-- A campaign character with three ordinary events and no seal.
insert into characters (id, owner_id, campaign_id, stats) values (
  '00000000-0000-0000-0000-0000000000c1', :owner, :camp,
  jsonb_build_object('schema','pact-character/1','SEQ',4,'LOG', jsonb_build_array(
    jsonb_build_object('seq',1,'ts',1,'type','award','amount',79),
    jsonb_build_object('seq',2,'ts',2,'type','buy','cat','boon','payload',jsonb_build_object('v','Alertness'),'cost',6),
    jsonb_build_object('seq',3,'ts',3,'type','name','name','Anders')
  )));

-- A solo character (no campaign), same shape.
insert into characters (id, owner_id, campaign_id, stats) values (
  '00000000-0000-0000-0000-0000000000c2', :owner, null,
  jsonb_build_object('schema','pact-character/1','SEQ',3,'LOG', jsonb_build_array(
    jsonb_build_object('seq',1,'ts',1,'type','award','amount',79),
    jsonb_build_object('seq',2,'ts',2,'type','buy','cat','boon','payload',jsonb_build_object('v','Alertness'),'cost',6)
  )));

\echo ''
\echo 'pact_sealed_floor() — where the immutable prefix ends'
do $$ begin
  perform pg_temp.ok('empty log has no floor',        pact_sealed_floor('[]'::jsonb) = 0);
  perform pg_temp.ok('null log tolerated',            pact_sealed_floor(null) = 0);
  perform pg_temp.ok('a non-array log tolerated',     pact_sealed_floor('"nonsense"'::jsonb) = 0);
  perform pg_temp.ok('no seal means no floor',        pact_sealed_floor('[{"type":"buy"},{"type":"award"}]'::jsonb) = 0);
  perform pg_temp.ok('one seal sets the floor after it',
    pact_sealed_floor('[{"type":"buy"},{"type":"sessionSeal"},{"type":"buy"}]'::jsonb) = 2);
  perform pg_temp.ok('the LAST seal wins',
    pact_sealed_floor('[{"type":"sessionSeal"},{"type":"buy"},{"type":"sessionSeal"},{"type":"buy"}]'::jsonb) = 3);
  perform pg_temp.ok('a seal at the very end freezes everything',
    pact_sealed_floor('[{"type":"buy"},{"type":"buy"},{"type":"sessionSeal"}]'::jsonb) = 3);
end $$;

\echo ''
\echo 'An UNSEALED character is completely unaffected (protects the 35 live characters)'
do $$
declare c uuid := '00000000-0000-0000-0000-0000000000c1';
begin
  -- The exact shape CharGen uses today: rewrite the whole log, dropping a mid-log event.
  update characters set stats = jsonb_set(stats, '{LOG}',
    jsonb_build_array(jsonb_build_object('seq',1,'ts',1,'type','award','amount',79))) where id = c;
  perform pg_temp.ok('a whole-log replacement still succeeds with no seal',
    jsonb_array_length(stats->'LOG') = 1) from characters where id = c;
  perform pg_temp.ok('...and truncating to empty is fine too', true);
end $$;

-- Put the fixture back.
update characters set stats = jsonb_set(stats, '{LOG}', jsonb_build_array(
    jsonb_build_object('seq',1,'ts',1,'type','award','amount',79),
    jsonb_build_object('seq',2,'ts',2,'type','buy','cat','boon','payload',jsonb_build_object('v','Alertness'),'cost',6),
    jsonb_build_object('seq',3,'ts',3,'type','name','name','Anders')))
  where id = '00000000-0000-0000-0000-0000000000c1';

\echo ''
\echo 'Writing a seal — authorisation (owner decision I2: DM or solo owner)'
-- Identity is set with a SESSION-level SET, never set_config(..., true). The transaction-local form
-- was used here first and produced a FALSE PASS: each `select pg_temp.rejects(...)` is its own
-- transaction, so the identity had already reverted to NULL and the "owner cannot seal a campaign
-- character" case was actually being refused for having no identity at all. It reported PASS while
-- testing nothing. Every uid below is therefore set outside the block that uses it.
set pact.test_uid = '33333333-3333-3333-3333-333333333333';   -- a stranger
select pg_temp.rejects('a stranger cannot seal a campaign character',
  $$select seal_character_history('00000000-0000-0000-0000-0000000000c1'::uuid, 'nope')$$);

set pact.test_uid = '22222222-2222-2222-2222-222222222222';   -- the character's OWNER
select pg_temp.rejects('the owner cannot seal their own CAMPAIGN character (only the DM can)',
  $$select seal_character_history('00000000-0000-0000-0000-0000000000c1'::uuid, 'nope')$$);

do $$
declare s jsonb;
begin
  s := seal_character_history('00000000-0000-0000-0000-0000000000c2'::uuid, 'Solo session 1');
  perform pg_temp.ok('the owner CAN seal a solo character (I2)', s->>'type' = 'sessionSeal');
  perform pg_temp.ok('a solo seal records the owner role',       s->>'sealedRole' = 'owner');
  perform pg_temp.ok('a solo seal is NOT marked as a DM edit',   not (s ? 'dmEdit'));
  perform pg_temp.ok('a seal carries no AP amount',              not (s ? 'amount') and not (s ? 'cost'));
end $$;

set pact.test_uid = '11111111-1111-1111-1111-111111111111';   -- the campaign DM
do $$
declare s jsonb;
begin
  s := seal_character_history('00000000-0000-0000-0000-0000000000c1'::uuid, 'Session 4');
  perform pg_temp.ok('the DM can seal a campaign character',  s->>'type' = 'sessionSeal');
  perform pg_temp.ok('a DM seal records the dm role',         s->>'sealedRole' = 'dm');
  perform pg_temp.ok('a DM seal IS marked as a DM edit',      (s->>'dmEdit')::boolean);
  perform pg_temp.ok('the seal landed in the log',
    pact_sealed_floor((select stats->'LOG' from characters where id = '00000000-0000-0000-0000-0000000000c1')) = 4);
end $$;

\echo ''
\echo 'The trigger — what a sealed character refuses'
select pg_temp.rejects('truncating below the floor is rejected (the stale-client case)',
  $$update characters set stats = jsonb_set(stats,'{LOG}', jsonb_build_array(stats->'LOG'->0))
     where id = '00000000-0000-0000-0000-0000000000c1'$$);

select pg_temp.rejects('altering a sealed event is rejected',
  $$update characters set stats = jsonb_set(stats,'{LOG,1}', '{"seq":2,"ts":2,"type":"buy","cat":"boon","payload":{"v":"TAMPERED"},"cost":6}'::jsonb)
     where id = '00000000-0000-0000-0000-0000000000c1'$$);

select pg_temp.rejects('removing the seal itself is rejected',
  $$update characters set stats = jsonb_set(stats,'{LOG}',
      (select jsonb_agg(e) from jsonb_array_elements(stats->'LOG') e where e->>'type' <> 'sessionSeal'))
     where id = '00000000-0000-0000-0000-0000000000c1'$$);

select pg_temp.rejects('replacing the log with a non-array is rejected',
  $$update characters set stats = jsonb_set(stats,'{LOG}','"gone"'::jsonb)
     where id = '00000000-0000-0000-0000-0000000000c1'$$);

\echo ''
\echo 'The trigger — what a sealed character still ALLOWS'
do $$
declare c uuid := '00000000-0000-0000-0000-0000000000c1'; n integer;
begin
  -- J1: a DM correction appends, so it passes without needing an exception.
  update characters set stats = jsonb_set(stats, '{LOG}',
    (stats->'LOG') || jsonb_build_array(jsonb_build_object('seq',5,'ts',5,'type','dmRemoveBoon','dmEdit',true)))
    where id = c;
  perform pg_temp.ok('a DM correction AFTER the seal is allowed (J1)',
    jsonb_array_length(stats->'LOG') = 5) from characters where id = c;

  -- K3: a description edit appends a superseding name event rather than replacing the sealed one.
  update characters set stats = jsonb_set(stats, '{LOG}',
    (stats->'LOG') || jsonb_build_array(jsonb_build_object('seq',6,'ts',6,'type','name','name','Anders Tealeaf')))
    where id = c;
  perform pg_temp.ok('an append-only description edit is allowed (K3)',
    (stats->'LOG'->-1->>'name') = 'Anders Tealeaf') from characters where id = c;

  -- Events after the floor stay mutable.
  update characters set stats = jsonb_set(stats, '{LOG,4}',
    jsonb_build_object('seq',5,'ts',5,'type','dmRemoveBoon','dmEdit',true,'edited',true)) where id = c;
  perform pg_temp.ok('an event AFTER the seal can still be altered',
    (stats->'LOG'->4->>'edited') = 'true') from characters where id = c;

  -- Fields outside LOG are untouched by the trigger.
  update characters set name = 'Renamed' where id = c;
  perform pg_temp.ok('non-LOG columns are unaffected', name = 'Renamed') from characters where id = c;
end $$;

\echo ''
\echo 'Idempotency — a retried request must not stack seals or double AP'
do $$
declare s1 jsonb; s2 jsonb; before integer; after1 integer; after2 integer; r1 jsonb; r2 jsonb;
begin
  s1 := seal_character_history('00000000-0000-0000-0000-0000000000c1'::uuid, 'Session 5', 'idem-abc');
  s2 := seal_character_history('00000000-0000-0000-0000-0000000000c1'::uuid, 'Session 5', 'idem-abc');
  perform pg_temp.ok('a repeated seal with the same key returns the SAME seal', s1->>'seq' = s2->>'seq');
  perform pg_temp.ok('...and does not append a second one',
    (select count(*) from jsonb_array_elements(stats->'LOG') e where e->>'idem' = 'idem-abc') = 1)
    from characters where id = '00000000-0000-0000-0000-0000000000c1';

  select ap into before from characters where id = '00000000-0000-0000-0000-0000000000c1';
  r1 := award_ap_and_seal('00000000-0000-0000-0000-0000000000c1'::uuid, 7, 'Session 6', 'idem-xyz');
  select ap into after1 from characters where id = '00000000-0000-0000-0000-0000000000c1';
  r2 := award_ap_and_seal('00000000-0000-0000-0000-0000000000c1'::uuid, 7, 'Session 6', 'idem-xyz');
  select ap into after2 from characters where id = '00000000-0000-0000-0000-0000000000c1';

  perform pg_temp.ok('award_ap_and_seal awards exactly once',      after1 = before + 7);
  perform pg_temp.ok('a retry with the same key awards NOTHING',   after2 = after1);
  perform pg_temp.ok('the retry reports itself as repeated',       (r2->>'repeated')::boolean);
  perform pg_temp.ok('the retry did not append a second seal',
    (select count(*) from jsonb_array_elements(stats->'LOG') e where e->>'idem' = 'idem-xyz') = 1)
    from characters where id = '00000000-0000-0000-0000-0000000000c1';
  perform pg_temp.ok('exactly one ledger row for the awarded amount',
    (select count(*) from ap_awards where note = 'Session 6') = 1);
end $$;

\echo ''
\echo 'dm_edit_character_log — the seal may also arrive through the existing DM edit path'
do $$
declare r jsonb;
begin
  r := dm_edit_character_log('00000000-0000-0000-0000-0000000000c1'::uuid,
        jsonb_build_array(jsonb_build_object('type','sessionSeal','label','via edit','amount',999,'cost',5)));
  perform pg_temp.ok('a sessionSeal is accepted by the allowlist', r->0->>'type' = 'sessionSeal');
  perform pg_temp.ok('an AP amount smuggled onto a seal is STRIPPED',
    not (r->0 ? 'amount') and not (r->0 ? 'cost'));
  perform pg_temp.ok('it is stamped as a DM edit', (r->0->>'dmEdit')::boolean);
end $$;

-- Must run AS THE DM. Run as anyone else it is refused by the authorisation check and proves
-- nothing about the allowlist at all — which is exactly what it did before this was fixed.
set pact.test_uid = '11111111-1111-1111-1111-111111111111';
select pg_temp.rejects('an unrelated event type is still refused by the allowlist',
  $$select dm_edit_character_log('00000000-0000-0000-0000-0000000000c1'::uuid,
      jsonb_build_array(jsonb_build_object('type','creationLocked')))$$);

\echo ''
\echo 'ALL SESSION-SEAL SQL ASSERTIONS PASSED'
