\set QUIET on
-- fix/server-negative-cost-after-lock — cases for sql/migrations/2026-10-25-server-negative-cost.sql. Expectations are the AFTER-migration
-- truth. Run BEFORE it (run-negative-cost.sh rolls it back first) the attacks show FAIL ('allowed' instead of 'refused'): that is the gap.
-- Built on schema.sql + rls-policies.sql, so the REAL budget check, history lock, player-grants guard and creation-lock guard run beside it.
-- An attack case only counts as refused by THIS rule when the message matches 'PACT: a % can''t be recorded with a cost of%'.
drop table if exists res; create table res(n serial, name text, expect text, got text, verdict text);
drop function if exists t(text,text,text);
create function t(p_name text, p_expect text, p_body text) returns void language plpgsql as $$
declare g text;
begin
  begin
    execute p_body;
    raise exception 'ROLLBACK_OK';
  exception when others then
    if sqlerrm = 'ROLLBACK_OK' then g := 'allowed';
    elsif sqlerrm like 'PACT: a % can''t be recorded with a cost of%' then g := 'refused';
    elsif sqlerrm like 'ASSERT:%' then g := sqlerrm;
    elsif sqlerrm like 'PACT%' then g := 'refused (other rule): ' || sqlerrm;
    else g := 'ERROR: ' || sqlerrm; end if;
  end;
  insert into res(name, expect, got, verdict) values (p_name, p_expect, g, case when g = p_expect then 'PASS' else 'FAIL' end);
end $$;
create or replace function ok(p boolean, p_msg text) returns void language plpgsql as $$
begin if p is not true then raise exception 'ASSERT: %', p_msg; end if; end $$;
create or replace function as_user(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true) $$;
create or replace function as_admin() returns void language sql as $$ select set_config('request.jwt.claims', '', true) $$;
create or replace function as_dm() returns void language sql as $$ select as_user('d0000000-0000-0000-0000-000000000001') $$;
create or replace function owner_upd(p_name text, p_expr text) returns void language plpgsql as $$
begin
  perform as_user((select owner_id from characters where name = p_name));
  execute format('update characters set stats = %s where name = %L', p_expr, p_name);
end $$;
create or replace function owner_append(p_name text, p_ev text) returns void language plpgsql as $$
begin
  perform owner_upd(p_name, format($f$ jsonb_set(stats, '{LOG}', (stats->'LOG') || %L::jsonb) $f$, p_ev));
end $$;

select as_admin();
truncate characters, character_backups, campaign_dms, campaigns cascade;
-- c…01 counts player AP; c…02 ignores it (the live campaign's setting).
insert into campaigns(id, dm_id, name, ignore_player_ap) values
 ('c1000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','Open', false),
 ('c1000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','Ignores', true);
insert into campaign_dms(campaign_id, dm_id) select id, 'd0000000-0000-0000-0000-000000000001' from campaigns on conflict do nothing;

insert into characters(owner_id, campaign_id, name, kind, ap, stats) values
 -- LOCKED, 79 AP budget, 70 spent
 ('a0000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','locked','chargen',0,
  '{"SEQ":6,"LOG":[
    {"seq":1,"type":"name","name":"locked"},
    {"seq":2,"type":"award","amount":79,"note":"Budget","noLock":true},
    {"seq":3,"type":"buy","cat":"boon","cost":70,"payload":{"v":"Alertness"},"noLock":true},
    {"seq":4,"type":"creationLocked"},
    {"seq":5,"type":"buy","cat":"skill","cost":1,"payload":{"v":"Stealth"}}]}'),
 -- PRE-LOCK campaign character (creation still open)
 ('a0000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000001','prelock','chargen',0,
  '{"SEQ":3,"LOG":[{"seq":1,"type":"award","amount":79,"note":"Budget","noLock":true},{"seq":2,"type":"buy","cat":"boon","cost":6,"payload":{"v":"Alertness"},"noLock":true}]}'),
 -- locked in the campaign that ignores player AP
 ('a0000000-0000-0000-0000-000000000003','c1000000-0000-0000-0000-000000000002','ign','chargen',50,
  '{"SEQ":4,"LOG":[{"seq":1,"type":"buy","cat":"boon","cost":6,"payload":{"v":"Alertness"},"noLock":true},{"seq":2,"type":"creationLocked"},{"seq":3,"type":"award","amount":0,"note":"Budget","noLock":true}]}'),
 -- SOLO
 ('a0000000-0000-0000-0000-000000000004',null,'solo','chargen',0,
  '{"SEQ":4,"LOG":[{"seq":1,"type":"award","amount":79,"note":"Budget","noLock":true},{"seq":2,"type":"creationLocked"},{"seq":3,"type":"buy","cat":"skill","cost":1,"payload":{"v":"Stealth"}}]}'),
 -- BOUND: already martially bound (-2) and magically bound at discipline 0/0 (-2)
 ('a0000000-0000-0000-0000-000000000006','c1000000-0000-0000-0000-000000000001','bound','chargen',20,
  '{"SEQ":4,"LOG":[{"seq":1,"type":"buy","cat":"mbound","cost":-2,"payload":{"v":true}},{"seq":2,"type":"buy","cat":"dbound","cost":-2,"payload":{"v":true,"ti":0,"di":0}},{"seq":3,"type":"creationLocked"}]}'),
 -- STORED: already carries a negative non-drawback buy and a negative names event from before this rule (inserted directly)
 ('a0000000-0000-0000-0000-000000000005','c1000000-0000-0000-0000-000000000001','stored','chargen',20,
  '{"SEQ":5,"LOG":[{"seq":1,"type":"buy","cat":"skill","cost":-3,"payload":{"v":"Stealth"}},{"seq":2,"type":"names","cost":-4},{"seq":3,"type":"buy","cat":"boon","cost":2,"payload":{"v":"Alertness"}}]}');

-- ===== ATTACKS: a player lowers the server's spend (refused after; allowed today) =====
select t('locked: a -1000 skill buy', 'refused', $b$ select owner_append('locked', '{"seq":6,"type":"buy","cat":"skill","cost":-1000,"payload":{"v":"Arcana"}}') $b$);
select t('locked: a -1 skill buy', 'refused', $b$ select owner_append('locked', '{"seq":6,"type":"buy","cat":"skill","cost":-1,"payload":{"v":"Arcana"}}') $b$);
select t('locked: a -1000 boon buy', 'refused', $b$ select owner_append('locked', '{"seq":6,"type":"buy","cat":"boon","cost":-1000,"payload":{"v":"Lucky"}}') $b$);
select t('locked: the -1000 buy and the 1000 spend in ONE save', 'refused', $b$ select owner_upd('locked', $e$ jsonb_set(stats, '{LOG}', (stats->'LOG') || '[{"seq":6,"type":"buy","cat":"skill","cost":-1000,"payload":{"v":"Arcana"}},{"seq":7,"type":"buy","cat":"boon","cost":1000,"payload":{"v":"Lucky"}}]'::jsonb) $e$) $b$);
select t('ignore-mode campaign, locked: a -1000 skill buy', 'refused', $b$ select owner_append('ign', '{"seq":4,"type":"buy","cat":"skill","cost":-1000,"payload":{"v":"Arcana"}}') $b$);
select t('pre-lock campaign character: a -1000 skill buy', 'refused', $b$ select owner_append('prelock', '{"seq":4,"type":"buy","cat":"skill","cost":-1000,"payload":{"v":"Arcana"}}') $b$);
select t('locked: a -1000 names event', 'refused', $b$ select owner_append('locked', '{"seq":6,"type":"names","cost":-1000}') $b$);
select t('locked: the -1000 names event and the 1000 spend in ONE save', 'refused', $b$ select owner_upd('locked', $e$ jsonb_set(stats, '{LOG}', (stats->'LOG') || '[{"seq":6,"type":"names","cost":-1000},{"seq":7,"type":"buy","cat":"boon","cost":1000,"payload":{"v":"Lucky"}}]'::jsonb) $e$) $b$);
select t('locked: a martial binding for -1000', 'refused', $b$ select owner_append('locked', '{"seq":6,"type":"buy","cat":"mbound","cost":-1000,"payload":{"v":true}}') $b$);
select t('locked: a magical binding for -3 (the engine pays -2)', 'refused', $b$ select owner_append('locked', '{"seq":6,"type":"buy","cat":"dbound","cost":-3,"payload":{"v":true,"ti":0,"di":0}}') $b$);
select t('locked: a cost written as the string "-1000"', 'refused', $b$ select owner_append('locked', '{"seq":6,"type":"buy","cat":"skill","cost":"-1000","payload":{"v":"Arcana"}}') $b$);
-- (on the UNLOCKED character: on a locked one pact_enforce_player_grants' null-cat fall-through already refuses a catless buy as a "drawback")
select t('pre-lock: a buy with NO cat and a negative cost', 'refused', $b$ select owner_append('prelock', '{"seq":4,"type":"buy","cost":-5,"payload":{"v":"Arcana"}}') $b$);
select t('locked: a buy of an unknown cat and a negative cost', 'refused', $b$ select owner_append('locked', '{"seq":6,"type":"buy","cat":"xyz","cost":-5,"payload":{"v":"Arcana"}}') $b$);
select t('locked: an existing positive buy rewritten to a negative cost', 'refused', $b$ select owner_upd('locked', $e$ jsonb_set(stats, '{LOG,4,cost}', '-5') $e$) $b$);
select t('stored negatives: a SECOND -3 skill buy (only the stored copy is grandfathered)', 'refused', $b$ select owner_append('stored', '{"seq":6,"type":"buy","cat":"skill","cost":-3,"payload":{"v":"Stealth"}}') $b$);

select t('locked: 50 martial bindings at -2 each in one save (review finding)', 'refused', $b$ select owner_upd('locked', $e$ jsonb_set(stats, '{LOG}', (stats->'LOG') || (select jsonb_agg(jsonb_build_object('seq', 100+g, 'type','buy','cat','mbound','cost',-2,'payload','{"v":true}'::jsonb)) from generate_series(1,50) g)) $e$) $b$);
select t('locked: two magical bindings of the SAME discipline at -2 each', 'refused', $b$ select owner_upd('locked', $e$ jsonb_set(stats, '{LOG}', (stats->'LOG') || '[{"seq":6,"type":"buy","cat":"dbound","cost":-2,"payload":{"v":true,"ti":0,"di":0}},{"seq":7,"type":"buy","cat":"dbound","cost":-2,"payload":{"v":true,"ti":0,"di":0}}]'::jsonb) $e$) $b$);
select t('already martially bound: a SECOND -2 martial binding', 'refused', $b$ select owner_append('bound', '{"seq":4,"type":"buy","cat":"mbound","cost":-2,"payload":{"v":true}}') $b$);
select t('already bound at discipline 0/0: a SECOND -2 binding there', 'refused', $b$ select owner_append('bound', '{"seq":4,"type":"buy","cat":"dbound","cost":-2,"payload":{"v":true,"ti":0,"di":0}}') $b$);

-- ===== LEGITIMATE: must stay allowed =====
select t('locked: an ordinary skill buy', 'allowed', $b$ select owner_append('locked', '{"seq":6,"type":"buy","cat":"skill","cost":1,"payload":{"v":"Arcana"}}') $b$);
select t('locked: a free (0 AP) buy', 'allowed', $b$ select owner_append('locked', '{"seq":6,"type":"buy","cat":"skill","cost":0,"payload":{"v":"Arcana"}}') $b$);
select t('locked: a names event for 0', 'allowed', $b$ select owner_append('locked', '{"seq":6,"type":"names","cost":0}') $b$);
select t('locked: a names event for 6 (a paid swap)', 'allowed', $b$ select owner_append('locked', '{"seq":6,"type":"names","cost":6}') $b$);
select t('locked: a martial binding at the engine price (-2)', 'allowed', $b$ select owner_append('locked', '{"seq":6,"type":"buy","cat":"mbound","cost":-2,"payload":{"v":true}}') $b$);
select t('locked: a magical binding at the engine price (-2)', 'allowed', $b$ select owner_append('locked', '{"seq":6,"type":"buy","cat":"dbound","cost":-2,"payload":{"v":true,"ti":0,"di":0}}') $b$);
select t('already bound: a magical binding of a DIFFERENT discipline (0/1) at -2', 'allowed', $b$ select owner_append('bound', '{"seq":4,"type":"buy","cat":"dbound","cost":-2,"payload":{"v":true,"ti":0,"di":1}}') $b$);
select t('already bound: an unchanged re-save', 'allowed', $b$ select owner_upd('bound', $e$ stats || '{"name":"bound"}'::jsonb $e$) $b$);
select t('locked: a binding for -1 (less than the engine pays)', 'allowed', $b$ select owner_append('locked', '{"seq":6,"type":"buy","cat":"mbound","cost":-1,"payload":{"v":true}}') $b$);
select t('locked: a patch event with a negative cost (CharGen stamps these; not in the server spend)', 'allowed', $b$ select owner_append('locked', '{"seq":6,"type":"buy","cat":"patch","cost":-11,"payload":{"patch":{"appearance":{"hair":"red"}}}}') $b$);
select t('pre-lock: a drawback (negative cost by design; capped elsewhere)', 'allowed', $b$ select owner_append('prelock', '{"seq":4,"type":"buy","cat":"drawback","cost":-4,"payload":{"v":"Peg Leg"}}') $b$);
select t('stored negatives: an unchanged re-save', 'allowed', $b$ select owner_upd('stored', $e$ stats || '{"name":"stored"}'::jsonb $e$) $b$);
select t('stored negatives: re-saved with fresh ts/label stamps', 'allowed', $b$ select owner_upd('stored', $e$ jsonb_set(jsonb_set(stats,'{LOG,0,ts}','123'),'{LOG,1,label}','"Named spells & languages"') $e$) $b$);
select t('stored negatives: a new ordinary buy beside them', 'allowed', $b$ select owner_append('stored', '{"seq":6,"type":"buy","cat":"skill","cost":1,"payload":{"v":"Arcana"}}') $b$);
select t('solo character: a -1000 skill buy is not this rule''s business', 'allowed', $b$ select owner_append('solo', '{"seq":4,"type":"buy","cat":"skill","cost":-1000,"payload":{"v":"Arcana"}}') $b$);
select t('admin session (migration / RPC): a negative buy on a campaign character', 'allowed', $b$ select as_admin(); update characters set stats = jsonb_set(stats, '{LOG}', (stats->'LOG') || '[{"seq":6,"type":"buy","cat":"skill","cost":-5,"payload":{"v":"Arcana"}}]'::jsonb) where name = 'locked' $b$);
select t('the DM: a negative buy on a campaign character (not a player write)', 'allowed', $b$ select as_dm(); with u as (update characters set stats = jsonb_set(stats, '{LOG}', (stats->'LOG') || '[{"seq":6,"type":"buy","cat":"skill","cost":-5,"payload":{"v":"Arcana"}}]'::jsonb) where name = 'locked' returning 1) select ok((select count(*) from u) = 1, 'the DM update touched no row') $b$);
