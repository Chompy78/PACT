-- PACT — fresh-install verification for sql/schema.sql + sql/rls-policies.sql.
--
-- WHY THIS EXISTS. sql/rls-policies.sql calls itself the maintained baseline and says "safe to re-run",
-- and sql/migrations/2026-08-10-dm-edit-character-log.sql documents schema.sql + rls-policies.sql as the
-- fresh-install path. Nothing checked that claim. On 2026-09-02 it was false in both directions at once:
--
--   * a database built this way had NO seal functions at all, so the shipped tools' Phase-2 UI calling
--     supabase.rpc('seal_character_history') would have failed on every press, and
--   * re-running rls-policies.sql against production would have REVERTED pact_enforce_locked_history to
--     the 2026-08-10 award-only version and re-GRANTed the EXECUTE that
--     2026-09-01-revoke-trigger-function-execute.sql had removed — silently undoing a security fix while
--     that migration's own header claimed the grant state was "reproducible from sql/ alone".
--
-- The sibling harness (session-seal-test.sql) loads the MIGRATIONS. This one loads the BASELINE. Running
-- both is what makes drift between them fail rather than rot: neither file can quietly fall behind the
-- other without one of these two suites going red.
--
-- HOW TO RUN. Any Postgres 14+; no Supabase needed — the shims below stand in for the parts Supabase
-- provides (the auth schema, auth.uid(), and the anon/authenticated/service_role roles).
--
--   initdb -D /tmp/pgbase/data -U postgres --auth=trust
--   pg_ctl -D /tmp/pgbase/data -o "-p 55440 -k /tmp/pgbase" -l /tmp/pgbase/log start
--   psql -h /tmp/pgbase -p 55440 -U postgres -v ON_ERROR_STOP=1 -f testing/sql/rls-baseline-test.sql
--
-- One assertion per line; the first failure raises, so psql's exit code is the pass/fail signal.

\set ON_ERROR_STOP on
set client_min_messages = notice;
\pset tuples_only on
\pset format unaligned

-- ---------------------------------------------------------------------------
-- Supabase shims — the smallest surface schema.sql and rls-policies.sql actually depend on.
-- ---------------------------------------------------------------------------
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

-- raw_user_meta_data is not decoration: schema.sql's handle_new_user() trigger reads
-- new.raw_user_meta_data->>'display_name' when mirroring a signup into public.profiles, so a shim
-- without it fails on the first insert. Shaped to match the real Supabase column (jsonb, nullable).
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb
);

-- "Who is signed in" is a session GUC so a test can switch identity, exactly as session-seal-test.sql does.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('pact.test_uid', true), '')::uuid;
$$;

-- pgcrypto goes in an `extensions` schema, not the default (public) location, matching real
-- Supabase — gen_invite_code() (schema.sql) calls extensions.gen_random_bytes() fully-qualified, so
-- without this the fresh-install harness itself fails the moment any test creates a campaign row.
-- Latent since this file was written (no prior test in here ever inserted into campaigns); surfaced
-- by feat/player-basic-mode's own test, which is the first to need one, fixed here rather than
-- worked around in that test — the shim should match what schema.sql actually depends on.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- THE THING UNDER TEST: the documented fresh-install path, and nothing else.
-- No migration file is loaded here on purpose — that is the whole point.
-- ---------------------------------------------------------------------------
\ir ../../sql/schema.sql
\ir ../../sql/rls-policies.sql

-- ---------------------------------------------------------------------------
-- Assertion helpers (same shape as session-seal-test.sql).
-- ---------------------------------------------------------------------------
create or replace function pg_temp.ok(p_name text, p_cond boolean) returns void
language plpgsql as $$
begin
  if p_cond then raise notice '  PASS %', p_name;
  else raise exception 'FAIL %', p_name; end if;
end $$;

-- The rejection must come from OUR trigger, not from any error at all. `when others` with a bare
-- notice counted a syntax error, a missing column or a bad cast as a passing rejection: rename
-- characters.stats and all four rejects() calls would report PASS on 'column "stats" does not exist'
-- while never once firing trg_pact_locked_history — the suite green with zero seal coverage. Every
-- protection this file exercises raises with a distinctive 'PACT: ' prefix, so require it, and treat
-- anything else as a harness failure that goes red.
create or replace function pg_temp.rejects(p_name text, p_sql text, p_expect text default 'PACT: %')
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL % (the write was ALLOWED)', p_name;
exception
  when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not like p_expect then
      raise exception 'FAIL % (HARNESS ERROR, not a rejection — expected % but got: %)',
        p_name, p_expect, left(sqlerrm, 120);
    end if;
    raise notice '  PASS % (rejected: %)', p_name, left(sqlerrm, 60);
end $$;

\echo ''
\echo 'A fresh install has every function the shipped tools call'
do $$ begin
  perform pg_temp.ok('seal_character_history exists',
    to_regprocedure('public.seal_character_history(uuid,text,text)') is not null);
  perform pg_temp.ok('award_ap_and_seal exists',
    to_regprocedure('public.award_ap_and_seal(uuid,integer,text,text)') is not null);
  perform pg_temp.ok('dm_edit_character_log exists',
    to_regprocedure('public.dm_edit_character_log(uuid,jsonb)') is not null);
end $$;

\echo ''
\echo 'The baseline carries the CURRENT rules, not a version three migrations behind'
do $$
declare src text;
begin
  select prosrc into src from pg_proc where proname = 'dm_edit_character_log';
  perform pg_temp.ok('dm_edit_character_log keeps the archived-campaign guard (D-GH-2026-08-22)',
    src like '%assert_campaign_active%');
  perform pg_temp.ok('...and the boon/award amount check (D-GH-2026-08-10)',
    src like '%has no matching award%');
  perform pg_temp.ok('...and accepts a sessionSeal (feat/session-seal)',
    src like '%sessionSeal%');
  perform pg_temp.ok('...and accepts a dmUnlockDrawback (feat/dm-unlock-drawback)',
    src like '%dmUnlockDrawback%');

  select prosrc into src from pg_proc where proname = 'pact_ap_ledger_protected';
  perform pg_temp.ok('the protected projection covers dmRemoveBoon',
    src like '%dmRemoveBoon%');
  perform pg_temp.ok('...and dmUnlockDrawback (feat/dm-unlock-drawback)',
    src like '%dmUnlockDrawback%');
  perform pg_temp.ok('...and projects the whole event, not six enumerated fields',
    src like '%- ''seq'' - ''ts'' - ''rules'' - ''label''%');

  select prosrc into src from pg_proc where proname = 'pact_enforce_locked_history';
  perform pg_temp.ok('the locked-history trigger knows about seals',
    src like '%sessionSeal%');
  perform pg_temp.ok('...freezes species (D-GH-2026-09-02)',
    src like '%species is frozen%');
  perform pg_temp.ok('...freezes a second origin species too',
    src like '%second origin species is frozen%');
  perform pg_temp.ok('...and ratchets ability scores',
    src like '%cannot go below%');
end $$;

\echo ''
\echo 'EXECUTE grants match production — the half that used to be silently reverted'
do $$ begin
  perform pg_temp.ok('a trigger function is NOT callable by authenticated (pact_enforce_locked_history)',
    not has_function_privilege('authenticated', 'public.pact_enforce_locked_history()', 'EXECUTE'));
  perform pg_temp.ok('...nor pact_ap_ledger_protected',
    not has_function_privilege('authenticated', 'public.pact_ap_ledger_protected(jsonb)', 'EXECUTE'));
  perform pg_temp.ok('...nor pact_enforce_ap_budget_consistency',
    not has_function_privilege('authenticated', 'public.pact_enforce_ap_budget_consistency()', 'EXECUTE'));
  perform pg_temp.ok('pact_ap_ledger_spend DOES stay callable (it is deliberately an RPC)',
    has_function_privilege('authenticated', 'public.pact_ap_ledger_spend(jsonb)', 'EXECUTE'));
  perform pg_temp.ok('the seal RPCs are callable by a signed-in user',
    has_function_privilege('authenticated', 'public.seal_character_history(uuid,text,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.award_ap_and_seal(uuid,integer,text,text)', 'EXECUTE'));
  perform pg_temp.ok('...and by nobody anonymous',
    not has_function_privilege('anon', 'public.seal_character_history(uuid,text,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.award_ap_and_seal(uuid,integer,text,text)', 'EXECUTE'));
  perform pg_temp.ok('the basic-mode trigger function is NOT callable by authenticated either',
    not has_function_privilege('authenticated', 'public.pact_enforce_basic_mode()', 'EXECUTE'));
  perform pg_temp.ok('set_basic_mode/unset_basic_mode ARE callable by a signed-in user',
    has_function_privilege('authenticated', 'public.set_basic_mode(uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.unset_basic_mode(uuid)', 'EXECUTE'));
  perform pg_temp.ok('...and by nobody anonymous',
    not has_function_privilege('anon', 'public.set_basic_mode(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.unset_basic_mode(uuid)', 'EXECUTE'));
  perform pg_temp.ok('profiles has NO blanket UPDATE grant for authenticated '
    || '(closes the audit-immutability gap — basic_mode/set_by/set_at are writable only via the RPCs above)',
    not has_table_privilege('authenticated', 'public.profiles', 'UPDATE'));
end $$;

\echo ''
\echo 'The trigger is actually attached, and it actually fires'
do $$
declare v_uid uuid; v_id uuid; v_base jsonb;
begin
  perform pg_temp.ok('trg_pact_locked_history is attached to characters',
    exists (select 1 from pg_trigger where tgname = 'trg_pact_locked_history' and not tgisinternal));

  insert into auth.users (email) values ('probe@example.test') returning id into v_uid;
  perform set_config('pact.test_uid', v_uid::text, false);

  v_base := jsonb_build_object('schema','pact-character/1','rules','v0.364','SEQ',4,
    'LOG', jsonb_build_array(
      jsonb_build_object('seq',1,'ts',1,'type','buy','cat','patch','payload',
        jsonb_build_object('patch', jsonb_build_object('species','Human','stats',
          jsonb_build_object('STR',14,'DEX',10,'CON',12,'INT',10,'WIS',10,'CHA',8)))),
      jsonb_build_object('seq',2,'ts',2,'type','buy','cat','boon','cost',6,
        'payload', jsonb_build_object('v','Alertness')),
      jsonb_build_object('seq',3,'ts',3,'type','sessionSeal','label','seal')));

  insert into public.characters (id, owner_id, name, stats)
    values ('00000000-0000-0000-0000-0000000000f1', v_uid, 'Baseline probe', v_base);
  perform pg_temp.ok('a sealed character can be created on a fresh install', true);
end $$;

select pg_temp.rejects('a sealed purchase cannot be deleted on a fresh install',
  $$update public.characters set stats = jsonb_set(stats,'{LOG}',
      jsonb_build_array(stats->'LOG'->0, stats->'LOG'->2))
     where id = '00000000-0000-0000-0000-0000000000f1'$$);
select pg_temp.rejects('species is frozen on a fresh install',
  $$update public.characters set stats = jsonb_set(stats,'{LOG,0,payload,patch,species}','"Dwarf"')
     where id = '00000000-0000-0000-0000-0000000000f1'$$);
select pg_temp.rejects('an ability score cannot be lowered on a fresh install',
  $$update public.characters set stats = jsonb_set(stats,'{LOG,0,payload,patch,stats,STR}','12')
     where id = '00000000-0000-0000-0000-0000000000f1'$$);

do $$ begin
  update public.characters set stats = jsonb_set(stats,'{LOG}', (stats->'LOG') ||
    jsonb_build_array(jsonb_build_object('seq',4,'ts',4,'type','buy','cat','boon','cost',4,
      'payload', jsonb_build_object('v','Toughness'))))
    where id = '00000000-0000-0000-0000-0000000000f1';
  perform pg_temp.ok('...but a purchase made AFTER the seal still saves', true);
end $$;

\echo ''
\echo 'Re-running the baseline is safe — the claim the file makes about itself'
\ir ../../sql/rls-policies.sql
do $$
declare src text;
begin
  select prosrc into src from pg_proc where proname = 'pact_enforce_locked_history';
  perform pg_temp.ok('re-running leaves the locked-history trigger AMENDED, not reverted',
    src like '%species is frozen%' and src like '%cannot go below%');
  perform pg_temp.ok('re-running leaves the trigger-function EXECUTE still revoked',
    not has_function_privilege('authenticated', 'public.pact_enforce_locked_history()', 'EXECUTE'));
  perform pg_temp.ok('re-running leaves the seal RPCs present and callable',
    has_function_privilege('authenticated', 'public.seal_character_history(uuid,text,text)', 'EXECUTE'));
end $$;

select pg_temp.rejects('...and the protections still fire after a re-run',
  $$update public.characters set stats = jsonb_set(stats,'{LOG,0,payload,patch,species}','"Elf"')
     where id = '00000000-0000-0000-0000-0000000000f1'$$);

\echo ''
\echo 'feat/player-basic-mode — the trigger is attached, and it actually blocks the bypass'
do $$
declare v_dm uuid; v_player uuid; v_other uuid; v_fellow uuid; v_campaign uuid; v_char1 uuid; v_char2 uuid;
begin
  perform pg_temp.ok('trg_pact_enforce_basic_mode is attached to characters',
    exists (select 1 from pg_trigger where tgname = 'trg_pact_enforce_basic_mode' and not tgisinternal));

  insert into auth.users (email) values ('bm-dm@example.test') returning id into v_dm;
  insert into auth.users (email) values ('bm-player@example.test') returning id into v_player;
  insert into auth.users (email) values ('bm-other@example.test') returning id into v_other;
  insert into auth.users (email) values ('bm-fellow@example.test') returning id into v_fellow;

  perform set_config('pact.test_uid', v_dm::text, false);
  insert into public.campaigns (dm_id, name) values (v_dm, 'Basic-mode probe') returning id into v_campaign;

  -- Player has TWO active characters BEFORE being flagged — existing multi-character players must be
  -- unaffected by the flag itself (not retroactive), and this is also the fixture the round-7
  -- correctness-guard test below actually needs (a routine edit with a real second active character
  -- present is the only way that test can distinguish "the guard works" from "there was nothing to
  -- wrongly block anyway").
  perform set_config('pact.test_uid', v_player::text, false);
  insert into public.characters (id, owner_id, name, stats)
    values (gen_random_uuid(), v_player, 'Flagged player''s first character', '{"LOG":[]}'::jsonb)
    returning id into v_char1;
  insert into public.characters (id, owner_id, name, stats)
    values (gen_random_uuid(), v_player, 'Flagged player''s second character', '{"LOG":[]}'::jsonb)
    returning id into v_char2;
  -- shares_campaign(v_player) needs an actual character bound to the DM's campaign, not just an
  -- invite. join_campaign() is the real RPC for this; a direct UPDATE is test-only shorthand.
  update public.characters set campaign_id = v_campaign where id = v_char1;

  -- A DM with no shared campaign cannot set the flag.
  perform set_config('pact.test_uid', v_other::text, false);
  perform pg_temp.rejects('a DM with no shared campaign cannot set basic mode',
    format('select public.set_basic_mode(%L)', v_player),
    'PACT: only a DM sharing a campaign%');

  -- /code-review ultra finding, PR #531: an ORDINARY fellow-player who shares this campaign with
  -- v_player (but is not its DM) must not be able to set the flag either. This is the exact gap the
  -- original shares_campaign()-based check missed — shares_campaign() returns true for "we both play
  -- in the same campaign" regardless of DM status, so this test would have failed before the fix.
  perform set_config('pact.test_uid', v_fellow::text, false);
  insert into public.characters (id, owner_id, name, stats, campaign_id)
    values (gen_random_uuid(), v_fellow, 'Fellow player''s own character', '{}'::jsonb, v_campaign);
  perform pg_temp.rejects('an ordinary fellow-player sharing the SAME campaign cannot set basic mode '
    || '(shares_campaign() would have wrongly allowed this — must check DM status specifically)',
    format('select public.set_basic_mode(%L)', v_player),
    'PACT: only a DM sharing a campaign%');

  perform set_config('pact.test_uid', v_dm::text, false);
  perform public.set_basic_mode(v_player);
  perform pg_temp.ok('set_basic_mode succeeds for a DM who shares a campaign with the player, '
    || 'even though the player already had two active characters (not retroactive)',
    (select basic_mode from public.profiles where id = v_player) is true);
  perform pg_temp.ok('basic_mode_set_by/set_at are recorded',
    (select basic_mode_set_by from public.profiles where id = v_player) = v_dm
    and (select basic_mode_set_at from public.profiles where id = v_player) is not null);

  perform set_config('pact.test_uid', v_player::text, false);
  perform pg_temp.rejects('a flagged player cannot insert a THIRD active character',
    format('insert into public.characters (id, owner_id, name, stats) values (gen_random_uuid(), %L, %L, ''{"LOG":[]}''::jsonb)',
      v_player, 'Third character, should be blocked'));

  update public.characters set archived_at = archived_at where id = v_char1;
  perform pg_temp.ok('a routine UPDATE that names archived_at but resends its unchanged NULL value is '
    || 'NOT blocked, even with a real second active character present (round-7 cold-review guard — '
    || 'without it, this exact statement wrongly finds v_char2 and refuses the save)', true);

  update public.characters set archived_at = now() where id = v_char2;
  perform pg_temp.ok('archiving down to one active character always succeeds regardless of the flag',
    (select archived_at from public.characters where id = v_char2) is not null);

  perform pg_temp.rejects('un-archiving back to a second active character is rejected while flagged '
    || '(closes the archive/create/un-archive bypass both original cold reviews found)',
    format('update public.characters set archived_at = null where id = %L', v_char2));

  perform public.unset_basic_mode();
  perform pg_temp.ok('the player can always unset their OWN flag, no DM standing required',
    (select basic_mode from public.profiles where id = v_player) is false
    and (select basic_mode_set_by from public.profiles where id = v_player) is null);

  update public.characters set archived_at = null where id = v_char2;
  perform pg_temp.ok('...and the same un-archive now succeeds once unflagged',
    (select archived_at from public.characters where id = v_char2) is null);

  -- Regression control: an entirely different, never-flagged player is unaffected throughout.
  perform set_config('pact.test_uid', v_other::text, false);
  insert into public.characters (id, owner_id, name, stats)
    values (gen_random_uuid(), v_other, 'Unflagged player, character 1', '{"LOG":[]}'::jsonb);
  insert into public.characters (id, owner_id, name, stats)
    values (gen_random_uuid(), v_other, 'Unflagged player, character 2', '{"LOG":[]}'::jsonb);
  perform pg_temp.ok('an unflagged player can freely hold more than one active character', true);
end $$;

\echo ''
\echo 'feat/dm-unlock-drawback — the RPC validates, stamps, and refuses'
-- Exercises dm_edit_character_log's new 'dmUnlockDrawback' branch against the FRESH-INSTALL build (the baseline,
-- before the migrations are loaded over it). The character holds a player-taken Peg Leg (seq 2), a DM-imposed
-- LOCKED Peg Leg (seq 3) and a DM-imposed UNLOCKED Lame (seq 4): the same-name pair is the case the seq keying
-- exists for.
do $$
declare
  c constant uuid := '00000000-0000-0000-0000-0000000000c1';
  v_dm uuid; v_dm2 uuid; v_player uuid; v_camp uuid; v_camp2 uuid;
  v_res jsonb; v_log jsonb; v_len int; v_spent_b numeric; v_earned_b numeric; v_spent_a numeric; v_earned_a numeric;
  v_call text := 'select public.dm_edit_character_log(%L, %L::jsonb)';
begin
  insert into auth.users (email) values ('ul-dm@example.test') returning id into v_dm;
  insert into auth.users (email) values ('ul-dm2@example.test') returning id into v_dm2;
  insert into auth.users (email) values ('ul-player@example.test') returning id into v_player;

  perform set_config('pact.test_uid', v_dm::text, false);
  insert into public.campaigns (dm_id, name) values (v_dm, 'Unlock probe') returning id into v_camp;
  perform set_config('pact.test_uid', v_dm2::text, false);
  insert into public.campaigns (dm_id, name) values (v_dm2, 'Unlock probe — another table') returning id into v_camp2;

  insert into public.characters (id, owner_id, name, campaign_id, stats) values (c, v_player, 'Unlock probe', v_camp,
    jsonb_build_object('schema','pact-character/1','rules','v0.364','SEQ',5,'LOG', jsonb_build_array(
      jsonb_build_object('seq',1,'ts',1,'type','buy','cat','oclass','cost',0,'payload',jsonb_build_object('v','Fighter')),
      jsonb_build_object('seq',2,'ts',2,'type','buy','cat','drawback','cost',-4,'payload',jsonb_build_object('v','Peg Leg')),
      jsonb_build_object('seq',3,'ts',3,'type','buy','cat','drawback','cost',0,'dmEdit',true,'dmLocked',true,
        'dmRemovalCost','flat','payload',jsonb_build_object('v','Peg Leg')),
      jsonb_build_object('seq',4,'ts',4,'type','buy','cat','drawback','cost',0,'dmEdit',true,'dmLocked',false,
        'dmRemovalCost','flat','payload',jsonb_build_object('v','Lame')))));
  perform pg_temp.ok('the probe character is bound to the first DM''s campaign',
    (select campaign_id from public.characters where id = c) = v_camp);

  -- ---- refusals, as the right DM, before anything is written -----------------------------------------
  perform set_config('pact.test_uid', v_dm::text, false);
  perform pg_temp.rejects('refuses an unlock of a PLAYER-TAKEN drawback (seq 2)',
    format(v_call, c, '[{"type":"dmUnlockDrawback","refVal":"Peg Leg","targetSeq":2,"note":"x"}]'),
    'dm_edit_character_log: no single DM-imposed%');
  perform pg_temp.rejects('refuses an unlock of an imposed drawback that is already UNLOCKED (never locked)',
    format(v_call, c, '[{"type":"dmUnlockDrawback","refVal":"Lame","targetSeq":4,"note":"x"}]'),
    'dm_edit_character_log: no single DM-imposed%');
  perform pg_temp.rejects('refuses a seq that is not in the log',
    format(v_call, c, '[{"type":"dmUnlockDrawback","refVal":"Peg Leg","targetSeq":99,"note":"x"}]'),
    'dm_edit_character_log: no single DM-imposed%');
  perform pg_temp.rejects('refuses the right seq under the wrong drawback name',
    format(v_call, c, '[{"type":"dmUnlockDrawback","refVal":"Lame","targetSeq":3,"note":"x"}]'),
    'dm_edit_character_log: no single DM-imposed%');
  perform pg_temp.rejects('refuses a missing targetSeq',
    format(v_call, c, '[{"type":"dmUnlockDrawback","refVal":"Peg Leg","note":"x"}]'),
    'dm_edit_character_log: dmUnlockDrawback needs targetSeq%');
  perform pg_temp.rejects('refuses a non-integer targetSeq',
    format(v_call, c, '[{"type":"dmUnlockDrawback","refVal":"Peg Leg","targetSeq":"3; drop table characters","note":"x"}]'),
    'dm_edit_character_log: dmUnlockDrawback needs targetSeq%');
  perform pg_temp.rejects('refuses a missing drawback name',
    format(v_call, c, '[{"type":"dmUnlockDrawback","targetSeq":3,"note":"x"}]'),
    'dm_edit_character_log: dmUnlockDrawback needs refVal%');
  perform pg_temp.rejects('refuses an empty story beat (the beat is required)',
    format(v_call, c, '[{"type":"dmUnlockDrawback","refVal":"Peg Leg","targetSeq":3,"note":"   "}]'),
    'dm_edit_character_log: dmUnlockDrawback needs a story-beat note%');
  perform pg_temp.rejects('refuses a story beat over 200 characters',
    format(v_call, c, jsonb_build_array(jsonb_build_object('type','dmUnlockDrawback','refVal','Peg Leg','targetSeq',3,
      'note', repeat('x', 201)))::text),
    'dm_edit_character_log: dmUnlockDrawback needs a story-beat note%');
  perform pg_temp.rejects('refuses the same unlock sent twice in ONE call',
    format(v_call, c, '[{"type":"dmUnlockDrawback","refVal":"Peg Leg","targetSeq":3,"note":"a"},{"type":"dmUnlockDrawback","refVal":"Peg Leg","targetSeq":3,"note":"b"}]'),
    'dm_edit_character_log: drawback % is already unlocked');
  perform pg_temp.rejects('a batch is atomic: a valid unlock plus an invalid one writes NOTHING',
    format(v_call, c, '[{"type":"dmUnlockDrawback","refVal":"Peg Leg","targetSeq":3,"note":"ok"},{"type":"dmUnlockDrawback","refVal":"Peg Leg","targetSeq":2,"note":"bad"}]'),
    'dm_edit_character_log: no single DM-imposed%');
  perform pg_temp.ok('...and the stored log is untouched by every refusal above',
    jsonb_array_length((select stats->'LOG' from public.characters where id = c)) = 4
    and (select stats->>'SEQ' from public.characters where id = c) = '5');

  -- ---- the wrong caller ------------------------------------------------------------------------------
  perform set_config('pact.test_uid', v_player::text, false);
  perform pg_temp.rejects('the character''s OWNER cannot use the RPC to unlock their own drawback',
    format(v_call, c, '[{"type":"dmUnlockDrawback","refVal":"Peg Leg","targetSeq":3,"note":"x"}]'),
    'Only a campaign DM can edit this character');
  perform set_config('pact.test_uid', v_dm2::text, false);
  perform pg_temp.rejects('a DM of a DIFFERENT campaign cannot unlock it either',
    format(v_call, c, '[{"type":"dmUnlockDrawback","refVal":"Peg Leg","targetSeq":3,"note":"x"}]'),
    'Only a campaign DM can edit this character');

  -- ---- the happy path, with junk the client should not be able to smuggle in -------------------------
  perform set_config('pact.test_uid', v_dm::text, false);
  select spent, player_earned into v_spent_b, v_earned_b
    from public.pact_ap_ledger_spend((select stats->'LOG' from public.characters where id = c));
  v_res := public.dm_edit_character_log(c, jsonb_build_array(jsonb_build_object(
    'type','dmUnlockDrawback','refVal','Peg Leg','targetSeq',3,'note','  found a surgeon  ',
    'cost',-5,'amount',99,'disc',true,'payload',jsonb_build_object('v','x'),'dmLocked',false,'label','DM unlocked — Peg Leg')));
  perform pg_temp.ok('a DM can unlock their own locked, imposed drawback (one event returned)',
    jsonb_array_length(v_res) = 1 and v_res->0->>'type' = 'dmUnlockDrawback');
  perform pg_temp.ok('...the server stamps seq (5), dmEdit and dmId (the calling DM)',
    (v_res->0->>'seq') = '5' and (v_res->0->'dmEdit') = 'true'::jsonb and (v_res->0->>'dmId') = v_dm::text);
  perform pg_temp.ok('...keeps the target (name + seq) and the TRIMMED story beat',
    v_res->0->>'refVal' = 'Peg Leg' and (v_res->0->>'targetSeq') = '3' and v_res->0->>'note' = 'found a surgeon');
  perform pg_temp.ok('...and nothing else the client sent rode along (no cost, amount, disc, payload, dmLocked)',
    not (v_res->0 ? 'cost') and not (v_res->0 ? 'amount') and not (v_res->0 ? 'disc')
    and not (v_res->0 ? 'payload') and not (v_res->0 ? 'dmLocked'));
  select spent, player_earned into v_spent_a, v_earned_a
    from public.pact_ap_ledger_spend((select stats->'LOG' from public.characters where id = c));
  perform pg_temp.ok('...and the unlock moved NO AP (ledger spend/earn identical before and after)',
    v_spent_a = v_spent_b and v_earned_a = v_earned_b);
  perform pg_temp.ok('...SEQ advanced and the event is on the stored log',
    (select stats->>'SEQ' from public.characters where id = c) = '6'
    and jsonb_array_length((select stats->'LOG' from public.characters where id = c)) = 5);
  perform pg_temp.rejects('a second unlock of the same drawback is refused',
    format(v_call, c, '[{"type":"dmUnlockDrawback","refVal":"Peg Leg","targetSeq":3,"note":"again"}]'),
    'dm_edit_character_log: drawback % is already unlocked');

  -- ---- the unlock is protected history once an AP award follows it -----------------------------------
  -- (the locked-history trigger compares the protected prefix up to the latest award or seal; a bare award
  -- appended by the DM is allowed by the RPC and draws that line AFTER the unlock)
  perform public.dm_edit_character_log(c, '[{"type":"award","amount":5,"note":"session reward"}]'::jsonb);
  perform pg_temp.ok('the protected projection now includes the unlock event',
    exists (select 1 from jsonb_array_elements(public.pact_ap_ledger_protected(
              (select stats->'LOG' from public.characters where id = c))) e where e->>'type' = 'dmUnlockDrawback'));
  perform set_config('pact.test_uid', v_player::text, false);
  perform pg_temp.rejects('once an award follows it, the owner cannot strip the unlock back out',
    format($f$update public.characters set stats = jsonb_set(stats,'{LOG}',
        (select jsonb_agg(e order by ord) from jsonb_array_elements(stats->'LOG') with ordinality t(e, ord)
          where e->>'type' <> 'dmUnlockDrawback')) where id = %L$f$, c),
    'PACT: locked character history%');

  -- ---- an archived campaign is read-only for DM edits, unlock included -------------------------------
  perform set_config('pact.test_uid', v_dm::text, false);
  update public.campaigns set archived_at = now() where id = v_camp;
  perform pg_temp.rejects('an unlock in an ARCHIVED campaign is refused (assert_campaign_active survives)',
    format(v_call, c, '[{"type":"dmUnlockDrawback","refVal":"Peg Leg","targetSeq":3,"note":"x"}]'),
    'This campaign is archived and read-only');
end $$;

-- KNOWN LIMIT, pinned on purpose. The lock and the unlock are honoured by the player's own app; the server does
-- NOT enforce them. A character's owner can write their own `stats`, so with no award after it an owner can still
-- append a forged unlock. This assertion exists so the limit is visible in the suite rather than only in prose:
-- when feat/server-enforced-drawback-lock lands, this is the assertion that must flip to a rejection.
do $$
declare
  v_owner uuid; v_camp uuid; v_dm uuid;
begin
  select id into v_owner from auth.users where email = 'ul-player@example.test';
  select id into v_dm from auth.users where email = 'ul-dm2@example.test';
  perform set_config('pact.test_uid', v_dm::text, false);
  select id into v_camp from public.campaigns where dm_id = v_dm limit 1;
  insert into public.characters (id, owner_id, name, campaign_id, stats) values
    ('00000000-0000-0000-0000-0000000000c2', v_owner, 'Unlock forgery probe', v_camp,
     jsonb_build_object('schema','pact-character/1','rules','v0.364','SEQ',4,'LOG', jsonb_build_array(
       jsonb_build_object('seq',1,'ts',1,'type','buy','cat','oclass','cost',0,'payload',jsonb_build_object('v','Fighter')),
       jsonb_build_object('seq',2,'ts',2,'type','buy','cat','drawback','cost',0,'dmEdit',true,'dmLocked',true,
         'dmRemovalCost','flat','payload',jsonb_build_object('v','Peg Leg')))));
  perform set_config('pact.test_uid', v_owner::text, false);
  update public.characters set stats = jsonb_set(stats,'{LOG}', (stats->'LOG') || jsonb_build_array(
      jsonb_build_object('seq',3,'ts',3,'type','dmUnlockDrawback','dmEdit',true,'refVal','Peg Leg','targetSeq',2,'note','forged')))
    where id = '00000000-0000-0000-0000-0000000000c2';
  perform pg_temp.ok('KNOWN LIMIT (feat/server-enforced-drawback-lock): an owner can still forge an unlock in their own '
    || 'log — the lock is advisory, not enforced. If this fails, enforcement has landed: flip it to a rejection.',
    jsonb_array_length((select stats->'LOG' from public.characters where id = '00000000-0000-0000-0000-0000000000c2')) = 3);
end $$;

\echo ''
\echo 'Every checked function pins its search_path — the check that agreement cannot make'
-- THE DRIFT GUARD BELOW CANNOT CATCH THIS, BY CONSTRUCTION. It asserts the baseline and the migrations
-- say the SAME thing; it is satisfied when both are wrong in the same way. That is exactly what
-- happened on 2026-09-02: `set search_path = public, pg_temp` was dropped from
-- pact_ap_ledger_protected in the migration and then copied, weakened, into the baseline — so both
-- sources agreed, and both were wrong. Agreement is not correctness, so this asserts the property
-- itself, against the fresh-install build, before the migrations are loaded over the top.
--
-- WHY IT MATTERS EVEN THOUGH ONE OF THESE IS NOT security definer. An unpinned function resolves
-- unqualified names using whatever search_path its CALLER had set. For a security-definer function
-- that is a privilege-escalation path outright. For an invoker-rights one it is not — but its safety
-- then depends on how it happens to be called, which is a fact about today's call graph rather than
-- about the function. 2026-07-16-harden-search-path-pg-temp.sql made pinning unconditional precisely
-- so nobody has to re-derive that distinction per function, and this keeps it unconditional.
do $$
declare r record; v_bad text := ''; v_n int := 0;
begin
  for r in
    select proname, coalesce(array_to_string(proconfig, ','), '') as cfg
    from pg_proc
    where proname in ('dm_edit_character_log','award_ap_and_seal','seal_character_history',
                      'pact_ap_ledger_protected','pact_enforce_locked_history',
                      'pact_ap_ledger_spend','pact_enforce_ap_budget_consistency',
                      'pact_enforce_basic_mode','set_basic_mode','unset_basic_mode','is_dm_of_player')
  loop
    v_n := v_n + 1;
    if r.cfg not like '%search_path=%' then v_bad := v_bad || r.proname || ' '; end if;
  end loop;
  -- Same missing-match guard as the drift check: a renamed or typo'd function must fail, never
  -- silently shrink coverage. version-label-ci.mjs states the rule — "A missing match is a FAILURE,
  -- not a skip."
  perform pg_temp.ok('all 11 search_path-checked functions exist (saw ' || v_n || ')', v_n = 11);
  perform pg_temp.ok('every checked function pins its search_path'
    || case when v_bad = '' then '' else ' — UNPINNED: ' || v_bad end, v_bad = '');
end $$;


\echo ''
\echo 'fix/blank-row-guard — blank SOLO rows are refused; campaign seed rows still work; the purge is narrow'
do $$
declare v_p uuid; v_dm uuid; v_camp uuid; v_old uuid; v_new uuid; v_ref uuid; v_note uuid; v_seed uuid; v_n int;
begin
  perform pg_temp.ok('trg_pact_refuse_blank_solo_character is attached to characters',
    exists (select 1 from pg_trigger where tgname = 'trg_pact_refuse_blank_solo_character' and not tgisinternal));
  perform pg_temp.ok('the blank-row trigger function is NOT callable by authenticated',
    not has_function_privilege('authenticated', 'public.pact_refuse_blank_solo_character()', 'EXECUTE'));
  perform pg_temp.ok('the purge is NOT callable by authenticated or anon',
    not has_function_privilege('authenticated', 'public.pact_purge_blank_characters(interval)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.pact_purge_blank_characters(interval)', 'EXECUTE'));

  insert into auth.users (email) values ('blank-player@example.test') returning id into v_p;
  insert into auth.users (email) values ('blank-dm@example.test') returning id into v_dm;
  perform set_config('pact.test_uid', v_p::text, false);

  -- The observed bug: an INSERT carrying nothing but column defaults.
  perform pg_temp.rejects('a solo row with all-default stats ({}) is refused',
    format('insert into public.characters (owner_id) values (%L)', v_p));
  perform pg_temp.rejects('a solo row whose stats carry no LOG key is refused',
    format('insert into public.characters (owner_id, stats) values (%L, ''{"note":"x"}''::jsonb)', v_p));
  insert into public.characters (owner_id, name, stats) values (v_p, 'Fresh draft', '{"LOG":[]}'::jsonb);
  perform pg_temp.ok('a solo row with an EMPTY LOG array (an untouched draft) is allowed', true);

  -- join_campaign()/redeem_player_invite() seed a campaign row with the default {} — must keep working.
  perform set_config('pact.test_uid', v_dm::text, false);
  insert into public.campaigns (dm_id, name) values (v_dm, 'Blank-row probe') returning id into v_camp;
  perform set_config('pact.test_uid', v_p::text, false);
  insert into public.characters (owner_id, campaign_id) values (v_p, v_camp) returning id into v_seed;
  perform pg_temp.ok('a CAMPAIGN seed row with stats {} is still allowed (join_campaign path)', v_seed is not null);

  -- Purge fixtures. Blank rows can no longer be INSERTed, so make them the way history did: insert a valid
  -- row, then empty it and backdate it (session_replication_role skips user triggers for the setup only).
  insert into public.characters (owner_id, stats) values (v_p, '{"LOG":[]}'::jsonb) returning id into v_old;
  insert into public.characters (owner_id, stats) values (v_p, '{"LOG":[]}'::jsonb) returning id into v_new;
  insert into public.characters (owner_id, stats) values (v_p, '{"LOG":[]}'::jsonb) returning id into v_ref;
  insert into public.characters (owner_id, stats) values (v_p, '{"LOG":[]}'::jsonb) returning id into v_note;
  set local session_replication_role = replica;
  update public.characters set stats = '{}'::jsonb, created_at = now() - interval '3 days',
         updated_at = now() - interval '3 days' where id in (v_old, v_ref, v_seed);
  update public.characters set stats = '{"note":"hello"}'::jsonb, created_at = now() - interval '3 days',
         updated_at = now() - interval '3 days' where id = v_note;
  update public.characters set stats = '{}'::jsonb where id = v_new;   -- blank but only just created
  insert into public.character_dm_notes (character_id, notes) values (v_ref, 'keeps this row alive');
  set local session_replication_role = origin;

  v_n := public.pact_purge_blank_characters(interval '1 day');
  perform pg_temp.ok('the purge removed exactly the one old, blank, solo, unreferenced row (removed ' || v_n || ')',
    v_n = 1 and not exists (select 1 from public.characters where id = v_old));
  perform pg_temp.ok('the purge kept a blank row younger than the minimum age',
    exists (select 1 from public.characters where id = v_new));
  perform pg_temp.ok('the purge kept a blank row that another table references',
    exists (select 1 from public.characters where id = v_ref));
  perform pg_temp.ok('the purge kept a blank CAMPAIGN row',
    exists (select 1 from public.characters where id = v_seed));
  perform pg_temp.ok('the purge kept a row whose stats hold data but no LOG',
    exists (select 1 from public.characters where id = v_note));
  perform pg_temp.ok('the purged row was backed up first (character_backups, reason delete)',
    exists (select 1 from public.character_backups where character_id = v_old and reason = 'delete'));
end $$;
\echo ''
\echo 'The baseline and the MIGRATIONS agree — the anti-drift guard'
-- This is the check that makes the whole file un-rottable, and it needs no access to production.
-- Snapshot every function body as built from the BASELINE, then load the forward migrations over the
-- top and compare. If someone amends a migration and forgets rls-policies.sql (or the reverse — which is
-- exactly what happened between 2026-09-01 and 2026-09-02), the two disagree and this fails.
--
-- Compared on a NORMALISED body: comments stripped, whitespace collapsed, and spaces around ()[,;]
-- removed. The last of those is not fussiness — production and the repo genuinely differ by a single
-- space in seal_character_history's `end)` and nothing else, and a comparison that called that a
-- mismatch would cry wolf until someone silenced it.
--
-- COMPARED ON MORE THAN THE BODY. `prosrc` alone leaves a function's SECURITY posture out of the
-- comparison entirely — and that is not hypothetical: on 2026-09-02 the fold into the baseline dropped
-- `set search_path = public, pg_temp` from pact_ap_ledger_protected, which lives in `proconfig`, and
-- this guard passed. Proven by injecting the divergence deliberately and watching it print PASS
-- (2026-09-03, /code-review ultra on PR #503). So the hash now covers, per function:
--     prosrc      the logic
--     proconfig   the SET clauses — search_path above all
--     prosecdef   security definer vs invoker
--     provolatile immutable / stable / volatile
-- Drop `security definer` from a trigger function in one source only and this now goes red instead of
-- reporting SAME logic.
create table pg_temp.baseline_bodies as
select proname,
  md5(regexp_replace(regexp_replace(regexp_replace(
       regexp_replace(prosrc, '--[^\n]*', '', 'g'), '\s+', ' ', 'g'),
       ' *([(),;]) *', '\1', 'g'), '^ | $', '', 'g')
      || ' cfg=' || coalesce(array_to_string(proconfig, ','), '')
      || ' secdef=' || prosecdef
      || ' vol=' || provolatile::text) as norm
from pg_proc
where proname in ('dm_edit_character_log','award_ap_and_seal','seal_character_history',
                  'pact_ap_ledger_protected','pact_enforce_locked_history',
                  'pact_enforce_basic_mode','set_basic_mode','unset_basic_mode','is_dm_of_player',
                  'pact_refuse_blank_solo_character','pact_purge_blank_characters');

-- THE GUARD NEEDS ITS OWN GUARD. The comparison below is an INNER JOIN with no count assertion, so a
-- function missing from one side simply produces no row, v_bad stays empty, and the whole thing prints
-- PASS having checked nothing. A typo in the names above, or a future migration renaming one, and
-- this file silently stops covering it. version-label-ci.mjs states the rule one directory over: "A
-- missing match is a FAILURE, not a skip." Assert the count on both sides.
do $$ begin
  perform pg_temp.ok('all 11 baseline function bodies were snapshotted',
    (select count(*) from pg_temp.baseline_bodies) = 11);
end $$;

\ir ../../sql/migrations/2026-09-01-session-seal.sql
\ir ../../sql/migrations/2026-09-02-restore-dm-edit-guards.sql
\ir ../../sql/migrations/2026-09-02-widen-protected-projection.sql
\ir ../../sql/migrations/2026-09-02-seal-freezes-species-and-ratchets-stats.sql
\ir ../../sql/migrations/2026-09-05-restore-protected-search-path.sql
\ir ../../sql/migrations/2026-09-06-player-basic-mode.sql
\ir ../../sql/migrations/2026-09-06-player-basic-mode-index-setter-fk.sql
\ir ../../sql/migrations/2026-09-06-player-basic-mode-review-fixes.sql
\ir ../../sql/migrations/2026-10-04-dm-unlock-drawback.sql
\ir ../../sql/migrations/2026-10-10-blank-row-guard.sql

do $$
declare r record; v_bad text := ''; v_n int := 0;
begin
  for r in
    select b.proname, b.norm as baseline_norm,
      md5(regexp_replace(regexp_replace(regexp_replace(
           regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\s+', ' ', 'g'),
           ' *([(),;]) *', '\1', 'g'), '^ | $', '', 'g')
          || ' cfg=' || coalesce(array_to_string(p.proconfig, ','), '')
          || ' secdef=' || p.prosecdef
          || ' vol=' || p.provolatile::text) as migration_norm
    from pg_temp.baseline_bodies b join pg_proc p on p.proname = b.proname
  loop
    v_n := v_n + 1;
    if r.baseline_norm is distinct from r.migration_norm then
      v_bad := v_bad || r.proname || ' ';
    end if;
  end loop;
  perform pg_temp.ok('the drift comparison actually covered all 11 functions (saw ' || v_n || ')',
    v_n = 11);
  perform pg_temp.ok('rls-policies.sql and the migrations define the SAME logic'
    || case when v_bad = '' then '' else ' — DIVERGED: ' || v_bad end, v_bad = '');
end $$;

\echo ''
\echo 'ALL RLS-BASELINE ASSERTIONS PASSED'
