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

create extension if not exists pgcrypto;

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

  select prosrc into src from pg_proc where proname = 'pact_ap_ledger_protected';
  perform pg_temp.ok('the protected projection covers dmRemoveBoon',
    src like '%dmRemoveBoon%');
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
                      'pact_ap_ledger_spend','pact_enforce_ap_budget_consistency')
  loop
    v_n := v_n + 1;
    if r.cfg not like '%search_path=%' then v_bad := v_bad || r.proname || ' '; end if;
  end loop;
  -- Same missing-match guard as the drift check: a renamed or typo'd function must fail, never
  -- silently shrink coverage. version-label-ci.mjs states the rule — "A missing match is a FAILURE,
  -- not a skip."
  perform pg_temp.ok('all 7 search_path-checked functions exist (saw ' || v_n || ')', v_n = 7);
  perform pg_temp.ok('every checked function pins its search_path'
    || case when v_bad = '' then '' else ' — UNPINNED: ' || v_bad end, v_bad = '');
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
                  'pact_ap_ledger_protected','pact_enforce_locked_history');

-- THE GUARD NEEDS ITS OWN GUARD. The comparison below is an INNER JOIN with no count assertion, so a
-- function missing from one side simply produces no row, v_bad stays empty, and the whole thing prints
-- PASS having checked nothing. A typo in the five names above, or a future migration renaming one, and
-- this file silently stops covering it. version-label-ci.mjs states the rule one directory over: "A
-- missing match is a FAILURE, not a skip." Assert the count on both sides.
do $$ begin
  perform pg_temp.ok('all 5 baseline function bodies were snapshotted',
    (select count(*) from pg_temp.baseline_bodies) = 5);
end $$;

\ir ../../sql/migrations/2026-09-01-session-seal.sql
\ir ../../sql/migrations/2026-09-02-restore-dm-edit-guards.sql
\ir ../../sql/migrations/2026-09-02-widen-protected-projection.sql
\ir ../../sql/migrations/2026-09-02-seal-freezes-species-and-ratchets-stats.sql
\ir ../../sql/migrations/2026-09-05-restore-protected-search-path.sql

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
  perform pg_temp.ok('the drift comparison actually covered all 5 functions (saw ' || v_n || ')',
    v_n = 5);
  perform pg_temp.ok('rls-policies.sql and the migrations define the SAME logic'
    || case when v_bad = '' then '' else ' — DIVERGED: ' || v_bad end, v_bad = '');
end $$;

\echo ''
\echo 'ALL RLS-BASELINE ASSERTIONS PASSED'
