\set QUIET on
-- feat/campaign-house-rules-server — cases for sql/migrations/2026-10-13-campaign-house-rules-server.sql.
-- Built on the REAL fresh-install path (schema.sql + rls-policies.sql, which carries
-- 2026-09-03-dm-zero-player-ap.sql since 2026-10-20 — and this migration too; run-house-rules.sh rolls it back first), so the real
-- dm_edit_character_log, award_ap, award_ap_and_seal, dm_zero_player_ap, seal_character_history, the budget check, the
-- history lock, the creation-lock guard and the player-AP ceiling all run beside the new code.
--
-- t(name, expect, before, body [, like]):
--   expect  the AFTER-migration truth: 'allowed' (the body ran, every ok() assertion held) or 'refused' (a PACT /
--           authorisation refusal; when `like` is given the message must match it, so the RIGHT rule refused it)
--   before  what the same case does on TODAY's definitions: 'pass' (unchanged behaviour — a legitimate path, or a
--           refusal that already exists) or 'fail' (the gap this migration closes, or a function it adds).
--           run-house-rules.sh asserts every case lands exactly as predicted BEFORE, all PASS after, and BEFORE again
--           after the rollback.
drop table if exists res; create table res(n serial, name text, expect text, before text, got text, verdict text);
drop function if exists t(text,text,text,text,text);
create function t(p_name text, p_expect text, p_before text, p_body text, p_like text default null) returns void language plpgsql as $$
declare g text;
begin
  begin
    execute p_body;
    raise exception 'ROLLBACK_OK';
  exception when others then
    if sqlerrm = 'ROLLBACK_OK' then g := 'allowed';
    elsif sqlerrm like 'ASSERT:%' then g := sqlerrm;
    elsif sqlerrm like 'PACT%' or sqlerrm like 'Only a campaign DM%' or sqlerrm like 'dm_edit_character_log:%'
       or sqlerrm like 'This campaign is archived%' or sqlerrm like 'Character is not in a campaign%' then
      g := case when p_like is null or sqlerrm like p_like then 'refused' else 'refused (other rule): ' || sqlerrm end;
    else g := 'ERROR: ' || sqlerrm; end if;
  end;
  insert into res(name, expect, before, got, verdict) values (p_name, p_expect, p_before, g, case when g = p_expect then 'PASS' else 'FAIL' end);
end $$;
create or replace function ok(p boolean, p_msg text) returns void language plpgsql as $$
begin if p is not true then raise exception 'ASSERT: %', p_msg; end if; end $$;
create or replace function as_user(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true) $$;
create or replace function as_admin() returns void language sql as $$ select set_config('request.jwt.claims', '', true) $$;
create or replace function as_dm() returns void language sql as $$ select as_user('d0000000-0000-0000-0000-000000000001') $$;
create or replace function camp(n int) returns uuid language sql as $$ select ('c1000000-0000-0000-0000-00000000000' || n)::uuid $$;
create or replace function chid(p text) returns uuid language sql as $$ select id from characters where name = p $$;
create or replace function logof(p text) returns jsonb language sql as $$ select stats->'LOG' from characters where name = p $$;
-- a DM allows drawbacks after the lock in campaign n (rules.postLockDrawbacks, js/engine.js postLockAllowance)
create or replace function allow_post_lock(n int) returns void language plpgsql as $$
begin perform as_admin(); update campaigns set rules = rules || '{"postLockDrawbacks":true}' where id = camp(n); end $$;
create or replace function lastev(p text) returns jsonb language sql as $$ select (stats->'LOG') -> (jsonb_array_length(stats->'LOG') - 1) from characters where name = p $$;
create or replace function owner_upd(p_name text, p_expr text) returns void language plpgsql as $$
begin
  perform as_user((select owner_id from characters where name = p_name));
  execute format('update characters set stats = %s where name = %L', p_expr, p_name);
end $$;
create or replace function owner_append(p_name text, p_ev text) returns void language plpgsql as $$
begin
  perform owner_upd(p_name, format($f$ jsonb_set(stats, '{LOG}', (stats->'LOG') || %L::jsonb) $f$, p_ev));
end $$;
-- a dm_apply_house_rules_change action for a character by name
create or replace function act(p_kind text, p_char text, p_extra jsonb default '{}'::jsonb) returns jsonb language sql as $$
  select p_extra || jsonb_build_object('kind', p_kind, 'character', chid(p_char)) $$;
create or replace function hr(p_camp int, p_chr jsonb, p_actions jsonb) returns jsonb language plpgsql as $$
begin
  perform as_dm();
  return dm_apply_house_rules_change(camp(p_camp), p_chr, p_actions);
end $$;
create or replace function split(p_log jsonb, p_chr jsonb default null, p_camp uuid default null) returns jsonb language plpgsql as $$
declare r record;
begin
  select * into r from pact_ap_ledger_split(p_log, p_chr, p_camp);
  return jsonb_build_array(r.spent, r.award_earned, r.drawback_earned);
end $$;
-- a character's ledger as its budget check sees it (its campaign's charHouseRules and id)
create or replace function splitc(p_name text) returns jsonb language sql as $$
  select split(c.stats->'LOG', cp.rules->'charHouseRules', c.campaign_id) from characters c join campaigns cp on cp.id = c.campaign_id where c.name = p_name $$;

select as_admin();
truncate characters, character_backups, campaign_dms, campaigns cascade;
insert into campaigns(id, dm_id, name, ignore_player_ap, rules) values
 (camp(1),'d0000000-0000-0000-0000-000000000001','Main',   false, '{"bannedBoons":[]}'),
 (camp(2),'d0000000-0000-0000-0000-000000000001','Ign',    true,  '{}'),
 (camp(3),'d0000000-0000-0000-0000-000000000001','Cap4',   false, '{"drawbackCap":{"enabled":true,"ap":4}}'),
 (camp(4),'d0000000-0000-0000-0000-000000000001','CapOff', false, '{"drawbackCap":{"enabled":false,"ap":4}}'),
 (camp(5),'d0000000-0000-0000-0000-000000000002','Other',  false, '{}'),
 (camp(6),'d0000000-0000-0000-0000-000000000001','Gone',   false, '{}');
update campaigns set archived_at = now() where id = camp(6);
insert into campaign_dms(campaign_id, dm_id) select id, dm_id from campaigns on conflict do nothing;

insert into characters(owner_id, campaign_id, name, kind, ap, stats) values
-- HOLD: a finished character with a player boon, two player drawbacks, a DM-granted boon (buy + award pair), an imposed
-- locked drawback, then the lock and one in-play buy. Ledger: spent 6+12+1 = 19; awards 79+12; drawbacks 5+2 (printed).
 ('a0000000-0000-0000-0000-000000000001', camp(1), 'hold', 'livesheet', 0, '{"SEQ":10,"LOG":[
   {"seq":1,"type":"award","amount":79,"note":"Budget","noLock":true},
   {"seq":2,"type":"buy","cat":"boon","cost":6,"payload":{"v":"Alertness"}},
   {"seq":3,"type":"buy","cat":"drawback","cost":-5,"payload":{"v":"Slow to Mend"}},
   {"seq":4,"type":"buy","cat":"drawback","cost":-2,"payload":{"v":"Squeamish"}},
   {"seq":5,"type":"buy","cat":"boon","cost":12,"payload":{"v":"Lucky"},"dmEdit":true,"dmId":"d0000000-0000-0000-0000-000000000001"},
   {"seq":6,"type":"award","amount":12,"note":"DM boon grant","dmEdit":true,"dmId":"d0000000-0000-0000-0000-000000000001"},
   {"seq":7,"type":"buy","cat":"drawback","cost":0,"payload":{"v":"Hexed"},"dmEdit":true,"dmLocked":true,"dmId":"d0000000-0000-0000-0000-000000000001"},
   {"seq":8,"type":"creationLocked"},
   {"seq":9,"type":"buy","cat":"skill","cost":1,"payload":{"v":"Stealth"}}]}'),
-- DRAFT: creation not finished.
 ('a0000000-0000-0000-0000-000000000002', camp(1), 'draft', 'chargen', 0, '{"SEQ":4,"LOG":[
   {"seq":1,"type":"award","amount":79,"note":"Budget","noLock":true},
   {"seq":2,"type":"buy","cat":"boon","cost":6,"payload":{"v":"Alertness"}},
   {"seq":3,"type":"buy","cat":"drawback","cost":-5,"payload":{"v":"Slow to Mend"}}]}'),
-- DUP: two purchases share seq 2 and a name (ambiguous).
 ('a0000000-0000-0000-0000-000000000003', camp(1), 'dup', 'livesheet', 0, '{"SEQ":4,"LOG":[
   {"seq":1,"type":"award","amount":79,"note":"Budget","noLock":true},
   {"seq":2,"type":"buy","cat":"drawback","cost":-5,"payload":{"v":"Slow to Mend"}},
   {"seq":2,"type":"buy","cat":"drawback","cost":-5,"payload":{"v":"Slow to Mend"}},
   {"seq":3,"type":"creationLocked"}]}'),
-- BOFF: Squeamish taken (seq 2), bought off, taken again (seq 5, open). A boon removed by the DM (dmRemoveBoon, seq 7).
 ('a0000000-0000-0000-0000-000000000004', camp(1), 'boff', 'livesheet', 0, '{"SEQ":9,"LOG":[
   {"seq":1,"type":"award","amount":79,"note":"Budget","noLock":true},
   {"seq":2,"type":"buy","cat":"drawback","cost":-2,"payload":{"v":"Squeamish"}},
   {"seq":3,"type":"creationLocked"},
   {"seq":4,"type":"buyoff","refVal":"Squeamish","cost":6},
   {"seq":5,"type":"buy","cat":"drawback","cost":-2,"payload":{"v":"Squeamish"}},
   {"seq":6,"type":"buy","cat":"boon","cost":6,"payload":{"v":"Alertness"}},
   {"seq":7,"type":"dmRemoveBoon","refVal":"Alertness","dmEdit":true,"dmId":"d0000000-0000-0000-0000-000000000001"},
   {"seq":8,"type":"buy","cat":"boon","cost":6,"payload":{"v":"Bulwark"}}]}'),
-- OTHER: another DM's campaign.
 ('a0000000-0000-0000-0000-000000000005', camp(5), 'other', 'livesheet', 0, '{"SEQ":4,"LOG":[
   {"seq":1,"type":"award","amount":79,"note":"Budget","noLock":true},
   {"seq":2,"type":"buy","cat":"drawback","cost":-5,"payload":{"v":"Slow to Mend"}},
   {"seq":3,"type":"creationLocked"}]}'),
-- IGN: ignore-player-AP campaign, DM AP 10, one 5 AP drawback.
 ('a0000000-0000-0000-0000-000000000006', camp(2), 'ign', 'livesheet', 10, '{"SEQ":4,"LOG":[
   {"seq":1,"type":"award","amount":0,"note":"Budget","noLock":true},
   {"seq":2,"type":"buy","cat":"drawback","cost":-5,"payload":{"v":"Slow to Mend"}},
   {"seq":3,"type":"creationLocked"}]}'),
-- CAP4 / CAPOFF: 7 AP of drawbacks, no awards, no DM AP; the DM's cap is 4 (on) / 4 but switched off.
 ('a0000000-0000-0000-0000-000000000007', camp(3), 'cap4', 'livesheet', 0, '{"SEQ":5,"LOG":[
   {"seq":1,"type":"award","amount":0,"note":"Budget","noLock":true},
   {"seq":2,"type":"buy","cat":"drawback","cost":-5,"payload":{"v":"Slow to Mend"}},
   {"seq":3,"type":"buy","cat":"drawback","cost":-2,"payload":{"v":"Squeamish"}},
   {"seq":4,"type":"creationLocked"}]}'),
 ('a0000000-0000-0000-0000-000000000008', camp(4), 'capoff', 'livesheet', 0, '{"SEQ":5,"LOG":[
   {"seq":1,"type":"award","amount":0,"note":"Budget","noLock":true},
   {"seq":2,"type":"buy","cat":"drawback","cost":-5,"payload":{"v":"Slow to Mend"}},
   {"seq":3,"type":"buy","cat":"drawback","cost":-2,"payload":{"v":"Squeamish"}},
   {"seq":4,"type":"creationLocked"}]}'),
-- NOCAP: a campaign with no drawbackCap key at all, 21 AP of drawbacks at their printed values (more than DATA.drawbackCap 12).
 ('a0000000-0000-0000-0000-000000000009', camp(1), 'nocap', 'livesheet', 0, '{"SEQ":7,"LOG":[
   {"seq":1,"type":"award","amount":0,"note":"Budget","noLock":true},
   {"seq":2,"type":"buy","cat":"drawback","cost":-5,"payload":{"v":"Slow to Mend"}},
   {"seq":3,"type":"buy","cat":"drawback","cost":-6,"payload":{"v":"Light-Blind"}},
   {"seq":4,"type":"buy","cat":"drawback","cost":-4,"payload":{"v":"Iron-Bane"}},
   {"seq":5,"type":"buy","cat":"drawback","cost":-6,"payload":{"v":"Leaden Reflexes"}},
   {"seq":6,"type":"creationLocked"}]}'),
-- WITHDM: already carries DM house-rules events (written as admin, so BEFORE and AFTER see the same row): a refund of
-- Bulwark (seq 5) and an override snapshot. Ledger after: spent 6+6-6+1 = 7.
 ('a0000000-0000-0000-0000-000000000010', camp(1), 'withdm', 'livesheet', 0, '{"SEQ":9,"LOG":[
   {"seq":1,"type":"award","amount":79,"note":"Budget","noLock":true},
   {"seq":2,"type":"buy","cat":"boon","cost":6,"payload":{"v":"Alertness"}},
   {"seq":3,"type":"buy","cat":"drawback","cost":-5,"payload":{"v":"Slow to Mend"}},
   {"seq":4,"type":"creationLocked"},
   {"seq":5,"type":"buy","cat":"boon","cost":6,"payload":{"v":"Bulwark"}},
   {"seq":6,"type":"dmRefundBoon","refVal":"Bulwark","targetSeq":5,"cost":-6,"campaignId":"c1000000-0000-0000-0000-000000000001","dmEdit":true,"dmId":"d0000000-0000-0000-0000-000000000001"},
   {"seq":7,"type":"dmHouseRules","overrides":{},"campaignId":"c1000000-0000-0000-0000-000000000001","dmEdit":true,"dmId":"d0000000-0000-0000-0000-000000000001"},
   {"seq":8,"type":"buy","cat":"skill","cost":1,"payload":{"v":"Stealth"}}]}'),
-- REOPEN: like withdm, but the DM reopened creation after the refund.
 ('a0000000-0000-0000-0000-000000000011', camp(1), 'reopen', 'chargen', 0, '{"SEQ":8,"LOG":[
   {"seq":1,"type":"award","amount":79,"note":"Budget","noLock":true},
   {"seq":2,"type":"buy","cat":"boon","cost":6,"payload":{"v":"Alertness"}},
   {"seq":3,"type":"creationLocked"},
   {"seq":4,"type":"buy","cat":"boon","cost":6,"payload":{"v":"Bulwark"}},
   {"seq":5,"type":"dmRefundBoon","refVal":"Bulwark","targetSeq":4,"cost":-6,"campaignId":"c1000000-0000-0000-0000-000000000001","dmEdit":true,"dmId":"d0000000-0000-0000-0000-000000000001"},
   {"seq":6,"type":"creationUnlocked","dmEdit":true,"dmId":"d0000000-0000-0000-0000-000000000001"},
   {"seq":7,"type":"buy","cat":"skill","cost":1,"payload":{"v":"Stealth"}}]}'),
-- TAIL: CharGen's noLock Budget singleton AFTER the lock, with a DM override snapshot before it.
 ('a0000000-0000-0000-0000-000000000012', camp(1), 'tail', 'chargen', 0, '{"SEQ":5,"LOG":[
   {"seq":1,"type":"buy","cat":"boon","cost":70,"payload":{"v":"Alertness"},"noLock":true},
   {"seq":2,"type":"creationLocked"},
   {"seq":3,"type":"dmHouseRules","overrides":{},"campaignId":"c1000000-0000-0000-0000-000000000001","dmEdit":true,"dmId":"d0000000-0000-0000-0000-000000000001"},
   {"seq":4,"type":"award","amount":77,"note":"Budget","noLock":true}]}'),
-- TB: one 5 AP drawback, 10 AP of awards, locked: 15 spendable.
 ('a0000000-0000-0000-0000-000000000013', camp(1), 'tb', 'livesheet', 0, '{"SEQ":4,"LOG":[
   {"seq":1,"type":"award","amount":10,"note":"Budget","noLock":true},
   {"seq":2,"type":"buy","cat":"drawback","cost":-5,"payload":{"v":"Slow to Mend"}},
   {"seq":3,"type":"creationLocked"}]}'),
-- IG2 / IG3 / DRHR: the PR #654 security review's fixtures (ATK1, ATK2, ATK5, ATK6).
 ('a0000000-0000-0000-0000-000000000015', camp(2), 'ig2', 'livesheet', 10, '{"SEQ":4,"LOG":[
   {"seq":1,"type":"award","amount":0,"note":"Budget","noLock":true},
   {"seq":2,"type":"buy","cat":"boon","cost":10,"payload":{"v":"Bulwark"}},
   {"seq":3,"type":"creationLocked"}]}'),
 ('a0000000-0000-0000-0000-000000000016', camp(2), 'ig3', 'livesheet', 10, '{"SEQ":3,"LOG":[
   {"seq":1,"type":"award","amount":0,"note":"Budget","noLock":true},
   {"seq":2,"type":"creationLocked"}]}'),
 ('a0000000-0000-0000-0000-000000000017', camp(1), 'drhr', 'chargen', 0, '{"SEQ":3,"LOG":[
   {"seq":1,"type":"award","amount":79,"note":"Budget","noLock":true},
   {"seq":2,"type":"buy","cat":"boon","cost":6,"payload":{"v":"Alertness"}}]}'),
-- DRG: a draft with a DM-stamped boon buy and NO award after it (the shape the guard's draft re-price relaxation is for).
 ('a0000000-0000-0000-0000-000000000019', camp(1), 'drg', 'chargen', 0, '{"SEQ":3,"LOG":[
   {"seq":1,"type":"award","amount":79,"note":"Budget","noLock":true},
   {"seq":2,"type":"buy","cat":"boon","cost":12,"payload":{"v":"Lucky"},"dmEdit":true,"dmId":"d0000000-0000-0000-0000-000000000001"}]}'),
-- SOLO: not in a campaign.
 ('a0000000-0000-0000-0000-000000000014', null, 'solo', 'livesheet', 0, '{"SEQ":3,"LOG":[
   {"seq":1,"type":"award","amount":79,"note":"Budget","noLock":true},
   {"seq":2,"type":"buy","cat":"boon","cost":6,"payload":{"v":"Alertness"}}]}');

-- =====================================================================================================================
-- 1. campaigns.rules.charHouseRules has one writer (§6.1)
-- =====================================================================================================================
select t('guard: a DM''s plain rules save cannot ADD charHouseRules (it is dropped, the rest saves)', 'allowed', 'fail', $b$
  select as_dm(); update campaigns set rules = '{"bannedBoons":["Lucky"],"charHouseRules":{"draws":{"Hexed":{"ap":99}}}}' where id = camp(1);
  select ok((select not (rules ? 'charHouseRules') and rules->'bannedBoons' = '["Lucky"]' from campaigns where id = camp(1)), 'key dropped, bans saved') $b$);
select t('guard: a stale whole-blob save keeps the RPC''s charHouseRules', 'allowed', 'fail', $b$
  select hr(1, '{"draws":{"Slow to Mend":{"ap":7}}}', '[]');
  select as_dm(); update campaigns set rules = '{"bannedBoons":["Lucky"]}' where id = camp(1);
  select ok((select rules->'charHouseRules' = '{"draws":{"Slow to Mend":{"ap":7}}}' and rules->'bannedBoons' = '["Lucky"]' from campaigns where id = camp(1)), 'kept') $b$);
select t('guard: a DM cannot overwrite charHouseRules with a plain update', 'allowed', 'fail', $b$
  select hr(1, '{"draws":{"Slow to Mend":{"ap":7}}}', '[]');
  select as_dm(); update campaigns set rules = jsonb_set(rules, '{charHouseRules}', '{"draws":{"Slow to Mend":{"ap":1000}}}') where id = camp(1);
  select ok((select rules->'charHouseRules'->'draws'->'Slow to Mend'->>'ap' = '7' from campaigns where id = camp(1)), 'kept 7') $b$);
select t('guard: a new campaign cannot be inserted with charHouseRules', 'allowed', 'fail', $b$
  select as_user('a0000000-0000-0000-0000-000000000009');
  insert into campaigns(dm_id, name, rules) values ('a0000000-0000-0000-0000-000000000009', 'Mine', '{"charHouseRules":{"draws":{"X":{"ap":5}}}}');
  select ok((select not (rules ? 'charHouseRules') from campaigns where name = 'Mine'), 'dropped on insert') $b$);
select t('guard: the ignore_player_ap toggle and other rules keys still save', 'allowed', 'pass', $b$
  select as_dm(); update campaigns set ignore_player_ap = true, rules = rules || '{"drawbackCap":{"enabled":true,"ap":6}}' where id = camp(1);
  select ok((select ignore_player_ap and rules->'drawbackCap'->>'ap' = '6' from campaigns where id = camp(1)), 'saved') $b$);
select t('guard: an admin session may write charHouseRules directly (repairs)', 'allowed', 'pass', $b$
  select as_admin(); update campaigns set rules = rules || '{"charHouseRules":{"schema":1}}' where id = camp(1);
  select ok((select rules->'charHouseRules' = '{"schema":1}' from campaigns where id = camp(1)), 'written') $b$);

-- =====================================================================================================================
-- 2. dm_apply_house_rules_change — who, and the shape of the rules
-- =====================================================================================================================
select t('rpc: a player cannot call it', 'refused', 'fail', $b$
  select as_user('a0000000-0000-0000-0000-000000000001'); select dm_apply_house_rules_change(camp(1), '{}', '[]') $b$, 'Only a campaign DM%');
select t('rpc: the DM of ANOTHER campaign cannot call it', 'refused', 'fail', $b$
  select as_user('d0000000-0000-0000-0000-000000000002'); select dm_apply_house_rules_change(camp(1), '{}', '[]') $b$, 'Only a campaign DM%');
select t('rpc: an archived campaign is read-only', 'refused', 'fail', $b$ select hr(6, '{}', '[]') $b$, 'This campaign is archived%');
select t('rpc: stores charHouseRules', 'allowed', 'fail', $b$
  select hr(1, '{"schema":1,"dmAllows":{"boons":false,"tasha":false},"boons":{"Bulwark":{"hd":2,"ap":9,"fx":"x"}},"draws":{"Hexed Custom":{"ap":4}}}', '[]');
  select ok((select rules->'charHouseRules'->'boons'->'Bulwark'->>'ap' = '9' and rules->'bannedBoons' = '[]' from campaigns where id = camp(1)), 'stored, rest intact') $b$);
select t('rpc: JSON null removes charHouseRules', 'allowed', 'fail', $b$
  select hr(1, '{"draws":{"Hexed":{"ap":3}}}', '[]'); select hr(1, 'null', '[]');
  select ok((select not (rules ? 'charHouseRules') from campaigns where id = camp(1)), 'removed') $b$);
select t('rpc: SQL NULL leaves charHouseRules untouched', 'allowed', 'fail', $b$
  select hr(1, '{"draws":{"Hexed":{"ap":3}}}', '[]'); select hr(1, null, '[]');
  select ok((select rules->'charHouseRules' = '{"draws":{"Hexed":{"ap":3}}}' from campaigns where id = camp(1)), 'kept') $b$);
select t('shape: unknown campaign field (disabled lives in the ban lists)', 'refused', 'fail', $b$ select hr(1, '{"disabled":{"boons":[]}}', '[]') $b$, 'PACT house rules: unknown field%');
select t('shape: schema 2', 'refused', 'fail', $b$ select hr(1, '{"schema":2}', '[]') $b$, 'PACT house rules: schema%');
select t('shape: boon hd 0', 'refused', 'fail', $b$ select hr(1, '{"boons":{"B":{"hd":0,"ap":3}}}', '[]') $b$, 'PACT house rules: boon%');
select t('shape: boon without hd', 'refused', 'fail', $b$ select hr(1, '{"boons":{"B":{"ap":3}}}', '[]') $b$, 'PACT house rules: boon%');
select t('shape: drawback ap 1001', 'refused', 'fail', $b$ select hr(1, '{"draws":{"D":{"ap":1001}}}', '[]') $b$, 'PACT house rules: drawback%');
select t('shape: drawback ap 2.5', 'refused', 'fail', $b$ select hr(1, '{"draws":{"D":{"ap":2.5}}}', '[]') $b$, 'PACT house rules: drawback%');
select t('shape: drawback ap "5" (a string)', 'refused', 'fail', $b$ select hr(1, '{"draws":{"D":{"ap":"5"}}}', '[]') $b$, 'PACT house rules: drawback%');
select t('shape: drawback ap negative', 'refused', 'fail', $b$ select hr(1, '{"draws":{"D":{"ap":-1}}}', '[]') $b$, 'PACT house rules: drawback%');
select t('shape: drawback with an unknown field', 'refused', 'fail', $b$ select hr(1, '{"draws":{"D":{"ap":1,"hd":2}}}', '[]') $b$, 'PACT house rules: drawback%');
select t('shape: fx longer than 500', 'refused', 'fail', $b$ select hr(1, jsonb_build_object('draws', jsonb_build_object('D', jsonb_build_object('ap', 1, 'fx', repeat('x', 501)))), '[]') $b$, 'PACT house rules: drawback%');
select t('shape: a __proto__ name', 'refused', 'fail', $b$ select hr(1, '{"draws":{"__proto__":{"ap":1}}}', '[]') $b$, 'PACT house rules: drawback%');
select t('shape: a blank name', 'refused', 'fail', $b$ select hr(1, '{"draws":{" ":{"ap":1}}}', '[]') $b$, 'PACT house rules: drawback%');
select t('shape: dmAllows value not a boolean', 'refused', 'fail', $b$ select hr(1, '{"dmAllows":{"boons":"no"}}', '[]') $b$, 'PACT house rules: dmAllows%');
select t('shape: dmAllows unknown call', 'refused', 'fail', $b$ select hr(1, '{"dmAllows":{"everything":true}}', '[]') $b$, 'PACT house rules: dmAllows%');
select t('shape: rules not an object', 'refused', 'fail', $b$ select hr(1, '[1]', '[]') $b$, 'PACT house rules: must be an object');
select t('shape: rules larger than 32 KB', 'refused', 'fail', $b$
  select hr(1, jsonb_build_object('draws', (select jsonb_object_agg('D' || g, jsonb_build_object('ap', 1, 'fx', repeat('x', 400))) from generate_series(1, 100) g)), '[]') $b$, 'PACT house rules: too large%');
select t('actions: not an array', 'refused', 'fail', $b$ select hr(1, null, '{"kind":"pin"}') $b$, 'PACT house rules: p_actions%');
select t('actions: more than 500', 'refused', 'fail', $b$ select hr(1, null, (select jsonb_agg('{}'::jsonb) from generate_series(1, 501))) $b$, 'PACT house rules: at most 500%');
select t('actions: unknown kind', 'refused', 'fail', $b$ select hr(1, null, jsonb_build_array(act('mint', 'hold'))) $b$, 'PACT house rules: action 1 has an unknown kind%');
select t('actions: no character id', 'refused', 'fail', $b$ select hr(1, null, '[{"kind":"pin","overrides":{}}]') $b$, '%needs a character id%');
select t('actions: a character of another campaign', 'refused', 'fail', $b$ select hr(1, null, jsonb_build_array(act('pin', 'other', '{"overrides":{}}'))) $b$, '%not in this campaign%');
select t('actions: a solo character', 'refused', 'fail', $b$ select hr(1, null, jsonb_build_array(act('pin', 'solo', '{"overrides":{}}'))) $b$, '%not in this campaign%');
select t('override: unknown field', 'refused', 'fail', $b$ select hr(1, null, jsonb_build_array(act('pin', 'hold', '{"overrides":{"mint":1}}'))) $b$, 'PACT house rules: unknown override field%');
select t('override: pins carries something other than draws', 'refused', 'fail', $b$ select hr(1, null, jsonb_build_array(act('pin', 'hold', '{"overrides":{"pins":{"boons":{}}}}'))) $b$, 'PACT house rules: pins%');
select t('override: a pin with a non-numeric ap', 'refused', 'fail', $b$ select hr(1, null, jsonb_build_array(act('pin', 'hold', '{"overrides":{"pins":{"draws":{"Hexed":{"ap":"x"}}}}}'))) $b$, 'PACT house rules: pinned%');
select t('override: disabled must be lists of names', 'refused', 'fail', $b$ select hr(1, null, jsonb_build_array(act('override', 'hold', '{"overrides":{"disabled":{"boons":[1]}}}'))) $b$, 'PACT house rules: disabled%');

-- =====================================================================================================================
-- 3. The AP-moving actions — everything the engine would ignore is refused (decision record "What PR3's RPC must refuse")
-- =====================================================================================================================
select t('target: a draft (creation not finished) — reprice', 'refused', 'fail', $b$
  select hr(1, '{"draws":{"Slow to Mend":{"ap":7}}}', jsonb_build_array(act('reprice', 'draft', '{"name":"Slow to Mend","targetSeq":3,"amount":2,"from":5,"to":7}'))) $b$, '%has not finished creation%');
select t('target: a draft — refund', 'refused', 'fail', $b$ select hr(1, null, jsonb_build_array(act('refundBoon', 'draft', '{"name":"Alertness","targetSeq":2}'))) $b$, '%has not finished creation%');
select t('target: a draft — removal', 'refused', 'fail', $b$ select hr(1, null, jsonb_build_array(act('removeDrawback', 'draft', '{"name":"Slow to Mend","targetSeq":3}'))) $b$, '%has not finished creation%');
select t('target: a REOPENED character (creationUnlocked after the lock)', 'refused', 'fail', $b$ select hr(1, null, jsonb_build_array(act('refundBoon', 'reopen', '{"name":"Alertness","targetSeq":2}'))) $b$, '%has not finished creation%');
select t('target: unknown targetSeq', 'refused', 'fail', $b$ select hr(1, null, jsonb_build_array(act('removeDrawback', 'hold', '{"name":"Slow to Mend","targetSeq":99}'))) $b$, '%no drawback "Slow to Mend" at seq 99%');
select t('target: the right seq, the wrong name', 'refused', 'fail', $b$ select hr(1, null, jsonb_build_array(act('removeDrawback', 'hold', '{"name":"Squeamish","targetSeq":3}'))) $b$, '%no drawback%');
select t('target: a boon refund aimed at a drawback purchase', 'refused', 'fail', $b$ select hr(1, null, jsonb_build_array(act('refundBoon', 'hold', '{"name":"Slow to Mend","targetSeq":3}'))) $b$, '%no boon%');
select t('target: a drawback removal aimed at a boon purchase', 'refused', 'fail', $b$ select hr(1, null, jsonb_build_array(act('removeDrawback', 'hold', '{"name":"Alertness","targetSeq":2}'))) $b$, '%no drawback%');
select t('target: two purchases share seq+name (ambiguous)', 'refused', 'fail', $b$ select hr(1, null, jsonb_build_array(act('removeDrawback', 'dup', '{"name":"Slow to Mend","targetSeq":2}'))) $b$, '%share seq%');
select t('target: already bought off', 'refused', 'fail', $b$ select hr(1, null, jsonb_build_array(act('removeDrawback', 'boff', '{"name":"Squeamish","targetSeq":2}'))) $b$, '%no longer held (boughtOff)%');
select t('target: the retaken copy after a buy-off IS open', 'allowed', 'fail', $b$
  select hr(1, null, jsonb_build_array(act('removeDrawback', 'boff', '{"name":"Squeamish","targetSeq":5}')));
  select ok(lastev('boff')->>'grantBack' = '2', 'grantBack 2') $b$);
select t('target: a boon the DM removed (dmRemoveBoon, FIFO)', 'refused', 'fail', $b$ select hr(1, null, jsonb_build_array(act('refundBoon', 'boff', '{"name":"Alertness","targetSeq":6}'))) $b$, '%no longer held (dmRemoved)%');
select t('target: a boon already refunded', 'refused', 'fail', $b$ select hr(1, null, jsonb_build_array(act('refundBoon', 'withdm', '{"name":"Bulwark","targetSeq":5}'))) $b$, '%no longer held (refunded)%');
select t('target: removed twice in one call', 'refused', 'fail', $b$
  select hr(1, null, jsonb_build_array(act('removeDrawback', 'hold', '{"name":"Squeamish","targetSeq":4}'), act('removeDrawback', 'hold', '{"name":"Squeamish","targetSeq":4}'))) $b$, 'PACT house rules: action 2%no longer held (removed)%');
select t('target: a DM-granted boon is not refunded (plan §7.2)', 'refused', 'fail', $b$ select hr(1, null, jsonb_build_array(act('refundBoon', 'hold', '{"name":"Lucky","targetSeq":5}'))) $b$, '%granted by a DM%');
select t('target: a DM-imposed drawback is not repriced', 'refused', 'fail', $b$
  select hr(1, '{"draws":{"Hexed":{"ap":4}}}', jsonb_build_array(act('reprice', 'hold', '{"name":"Hexed","targetSeq":7,"amount":4,"from":0,"to":4}'))) $b$, '%imposed by a DM%');
select t('target: a DM-imposed drawback is not removed', 'refused', 'fail', $b$ select hr(1, null, jsonb_build_array(act('removeDrawback', 'hold', '{"name":"Hexed","targetSeq":7}'))) $b$, '%imposed by a DM%');
select t('target: targetSeq as a string', 'refused', 'fail', $b$ select hr(1, null, jsonb_build_array(act('removeDrawback', 'hold', '{"name":"Squeamish","targetSeq":"4"}'))) $b$, '%needs targetSeq%');
select t('target: targetSeq negative', 'refused', 'fail', $b$ select hr(1, null, jsonb_build_array(act('removeDrawback', 'hold', '{"name":"Squeamish","targetSeq":-4}'))) $b$, '%needs targetSeq%');
select t('target: no name', 'refused', 'fail', $b$ select hr(1, null, jsonb_build_array(act('removeDrawback', 'hold', '{"targetSeq":4}'))) $b$, '%needs the purchase name%');
select t('reprice: amount 0', 'refused', 'fail', $b$
  select hr(1, '{"draws":{"Slow to Mend":{"ap":5}}}', jsonb_build_array(act('reprice', 'hold', '{"name":"Slow to Mend","targetSeq":3,"amount":0,"from":5,"to":5}'))) $b$, '%amount must be a whole non-zero%');
select t('reprice: a fractional amount', 'refused', 'fail', $b$
  select hr(1, '{"draws":{"Slow to Mend":{"ap":7}}}', jsonb_build_array(act('reprice', 'hold', '{"name":"Slow to Mend","targetSeq":3,"amount":1.5,"from":5,"to":7}'))) $b$, '%amount must be a whole%');
select t('reprice: a non-numeric amount ("Infinity")', 'refused', 'fail', $b$
  select hr(1, '{"draws":{"Slow to Mend":{"ap":7}}}', jsonb_build_array(act('reprice', 'hold', '{"name":"Slow to Mend","targetSeq":3,"amount":"Infinity","from":5,"to":7}'))) $b$, '%numeric amount, from and to%');
select t('reprice: |amount| over 1000', 'refused', 'fail', $b$
  select hr(1, null, jsonb_build_array(act('reprice', 'hold', '{"name":"Slow to Mend","targetSeq":3,"amount":1001,"from":5,"to":1006}'))) $b$, '%amount must be a whole%');
select t('reprice M3: from is not the ledger grant', 'refused', 'fail', $b$
  select hr(1, '{"draws":{"Slow to Mend":{"ap":7}}}', jsonb_build_array(act('reprice', 'hold', '{"name":"Slow to Mend","targetSeq":3,"amount":4,"from":3,"to":7}'))) $b$, '%from (3) is not the purchase''s current grant (5)%');
select t('reprice M3: to is not the campaign value', 'refused', 'fail', $b$
  select hr(1, '{"draws":{"Slow to Mend":{"ap":7}}}', jsonb_build_array(act('reprice', 'hold', '{"name":"Slow to Mend","targetSeq":3,"amount":4,"from":5,"to":9}'))) $b$, '%to (9) is not "Slow to Mend"''s effective value for this character (7)%');
select t('reprice: amount is not to − from', 'refused', 'fail', $b$
  select hr(1, '{"draws":{"Slow to Mend":{"ap":7}}}', jsonb_build_array(act('reprice', 'hold', '{"name":"Slow to Mend","targetSeq":3,"amount":3,"from":5,"to":7}'))) $b$, '%amount must be to − from%');
select t('reprice M3: a DM override beats the campaign value', 'refused', 'fail', $b$
  select hr(1, '{"draws":{"Slow to Mend":{"ap":7}}}', jsonb_build_array(act('override', 'hold', '{"overrides":{"draws":{"Slow to Mend":{"ap":9}}}}'),
    act('reprice', 'hold', '{"name":"Slow to Mend","targetSeq":3,"amount":2,"from":5,"to":7}'))) $b$, '%effective value for this character (9)%');
select t('reprice M3: a pin beats the override', 'refused', 'fail', $b$
  select hr(1, '{"draws":{"Slow to Mend":{"ap":7}}}', jsonb_build_array(act('override', 'hold', '{"overrides":{"draws":{"Slow to Mend":{"ap":9}},"pins":{"draws":{"Slow to Mend":{"ap":6,"reason":"kept"}}}}}'),
    act('reprice', 'hold', '{"name":"Slow to Mend","targetSeq":3,"amount":4,"from":5,"to":9}'))) $b$, '%effective value for this character (6)%');
select t('a batch is all-or-nothing: a bad second action leaves the first unapplied', 'allowed', 'pass', $b$
  do $d$ begin
    perform hr(1, null, jsonb_build_array(act('removeDrawback', 'hold', '{"name":"Squeamish","targetSeq":4}'), act('removeDrawback', 'hold', '{"name":"Nope","targetSeq":4}')));
  exception when others then null; end $d$;
  select as_admin(); select ok(jsonb_array_length(logof('hold')) = 9, 'nothing appended') $b$);

-- =====================================================================================================================
-- 4. The AP-moving actions that are accepted, and what they stamp
-- =====================================================================================================================
select t('reprice: stamped dmRepriceDrawback, server ledger +2', 'allowed', 'fail', $b$
  select hr(1, '{"draws":{"Slow to Mend":{"ap":7}}}', jsonb_build_array(act('reprice', 'hold', '{"name":"Slow to Mend","targetSeq":3,"amount":2,"from":5,"to":7,"dmEdit":false,"seq":1,"dmId":"x"}')));
  select as_admin();
  select ok(lastev('hold') - 'ts' - 'label' = '{"type":"dmRepriceDrawback","refVal":"Slow to Mend","targetSeq":3,"amount":2,"from":5,"to":7,"campaignId":"c1000000-0000-0000-0000-000000000001","seq":10,"dmEdit":true,"dmId":"d0000000-0000-0000-0000-000000000001"}'::jsonb, 'event ' || lastev('hold')::text);
  select ok((select (stats->>'SEQ')::int = 11 from characters where name = 'hold'), 'SEQ advanced');
  select ok(splitc('hold') = '[19, 91, 9]', 'ledger ' || splitc('hold')::text) $b$);
select t('reprice: the printed-value fallback — the campaign deletes its reprice, the holder is ticked back to printed 5', 'allowed', 'fail', $b$
  select hr(1, '{"draws":{"Slow to Mend":{"ap":7}}}', jsonb_build_array(act('reprice', 'hold', '{"name":"Slow to Mend","targetSeq":3,"amount":2,"from":5,"to":7}')));
  select hr(1, '{}', jsonb_build_array(act('reprice', 'hold', '{"name":"Slow to Mend","targetSeq":3,"amount":-2,"from":7,"to":5}')));
  select as_admin(); select ok(lastev('hold')->>'to' = '5', 'stamped'); select ok(splitc('hold') = '[19, 91, 7]', 'ledger ' || splitc('hold')::text) $b$);
select t('reprice M3 (AB1): with nothing naming it, to must be the PRINTED value (now known to the server)', 'refused', 'fail', $b$
  select hr(1, null, jsonb_build_array(act('reprice', 'hold', '{"name":"Squeamish","targetSeq":4,"amount":7,"from":2,"to":9}'))) $b$, '%effective value for this character (2)%');
select t('reprice: to the pin value when the DM pinned it', 'allowed', 'fail', $b$
  select hr(1, '{"draws":{"Slow to Mend":{"ap":7}}}', jsonb_build_array(act('pin', 'hold', '{"overrides":{"pins":{"draws":{"Slow to Mend":{"ap":6,"reason":"kept","at":"2026-10-13"}}}}}'),
    act('reprice', 'hold', '{"name":"Slow to Mend","targetSeq":3,"amount":1,"from":5,"to":6}')));
  select as_admin(); select ok(lastev('hold')->>'amount' = '1', 'stamped') $b$);
select t('an override for ANOTHER campaign does not set the effective value here', 'allowed', 'fail', $b$
  select as_admin(); update characters set stats = jsonb_set(stats, '{LOG}', (stats->'LOG') || '[{"seq":10,"type":"dmHouseRules","overrides":{"draws":{"Slow to Mend":{"ap":1}}},"campaignId":"c1000000-0000-0000-0000-000000000005","dmEdit":true}]'::jsonb) || '{"SEQ":11}' where name = 'hold';
  select hr(1, '{"draws":{"Slow to Mend":{"ap":7}}}', jsonb_build_array(act('reprice', 'hold', '{"name":"Slow to Mend","targetSeq":3,"amount":2,"from":5,"to":7}'))) $b$);
select t('reprice then remove in ONE call: grantBack = −cost + ΣΔ (M4)', 'allowed', 'fail', $b$
  select hr(1, '{"draws":{"Slow to Mend":{"ap":7}}}', jsonb_build_array(act('reprice', 'hold', '{"name":"Slow to Mend","targetSeq":3,"amount":2,"from":5,"to":7}'),
    act('removeDrawback', 'hold', '{"name":"Slow to Mend","targetSeq":3}')));
  select as_admin(); select ok(lastev('hold')->>'grantBack' = '7', 'grantBack 7');
  select ok(splitc('hold') = '[19, 91, 2]', 'ledger ' || splitc('hold')::text) $b$);
select t('a second reprice chains: from includes the first Δ', 'allowed', 'fail', $b$
  select hr(1, '{"draws":{"Slow to Mend":{"ap":7}}}', jsonb_build_array(act('reprice', 'hold', '{"name":"Slow to Mend","targetSeq":3,"amount":2,"from":5,"to":7}')));
  select hr(1, '{"draws":{"Slow to Mend":{"ap":2}}}', jsonb_build_array(act('reprice', 'hold', '{"name":"Slow to Mend","targetSeq":3,"amount":-5,"from":7,"to":2}')));
  select as_admin(); select ok(splitc('hold') = '[19, 91, 4]', 'ledger ' || splitc('hold')::text) $b$);
select t('refund: dmRefundBoon cost = −frozen cost; spent drops', 'allowed', 'fail', $b$
  select hr(1, '{"dmAllows":{"boons":false}}', jsonb_build_array(act('refundBoon', 'hold', '{"name":"Alertness","targetSeq":2,"cost":-500}')));
  select as_admin(); select ok(lastev('hold')->>'cost' = '-6', 'cost -6, not the client''s');
  select ok(splitc('hold') = '[13, 91, 7]', 'ledger ' || splitc('hold')::text) $b$);
select t('override/pin: a dmHouseRules event, campaignId stamped by the server', 'allowed', 'fail', $b$
  select hr(1, null, jsonb_build_array(act('override', 'draft', '{"overrides":{"boons":{"Shiny":{"hd":1,"ap":2}}},"campaignId":"c1000000-0000-0000-0000-000000000005"}')));
  select as_admin(); select ok(lastev('draft')->>'type' = 'dmHouseRules' and lastev('draft')->>'campaignId' = camp(1)::text
    and lastev('draft')->'dmEdit' = 'true' and lastev('draft')->'overrides' = '{"boons":{"Shiny":{"hd":1,"ap":2}}}', 'event ' || lastev('draft')::text) $b$);
select t('the RPC returns what it wrote', 'allowed', 'fail', $b$
  select ok((select r->'charHouseRules' = '{"draws":{"Slow to Mend":{"ap":7}}}' and jsonb_array_length(r->'events') = 1
    and r->'events'->0->>'character' = chid('hold')::text
    from (select hr(1, '{"draws":{"Slow to Mend":{"ap":7}}}', jsonb_build_array(act('reprice', 'hold', '{"name":"Slow to Mend","targetSeq":3,"amount":2,"from":5,"to":7}'))) as r) x), 'return') $b$);
select t('after a refund the player can spend the refunded AP (79 left + 6 refunded = 85)', 'allowed', 'fail', $b$
  select hr(1, null, jsonb_build_array(act('refundBoon', 'hold', '{"name":"Alertness","targetSeq":2}')));
  select owner_append('hold', '{"seq":11,"type":"buy","cat":"boon","cost":85,"payload":{"v":"Bulwark"}}') $b$);
select t('…but not one AP more (86)', 'refused', 'pass', $b$
  do $d$ begin perform hr(1, null, jsonb_build_array(act('refundBoon', 'hold', '{"name":"Alertness","targetSeq":2}'))); exception when others then null; end $d$;
  select owner_append('hold', '{"seq":11,"type":"buy","cat":"boon","cost":86,"payload":{"v":"Bulwark"}}') $b$, 'PACT: over AP budget%');

-- =====================================================================================================================
-- 5. dm_edit_character_log and dmHouseRules
-- =====================================================================================================================
select t('dm_edit: dmHouseRules accepted on a DRAFT, campaignId stamped, client fields dropped', 'allowed', 'fail', $b$
  select as_dm(); select dm_edit_character_log(chid('draft'), '[{"type":"dmHouseRules","overrides":{"draws":{"Slow to Mend":{"ap":9}}},"campaignId":"c1000000-0000-0000-0000-000000000005","cost":-50,"amount":50}]');
  select as_admin(); select ok(lastev('draft') - 'ts' - 'seq' - 'dmId' = '{"type":"dmHouseRules","overrides":{"draws":{"Slow to Mend":{"ap":9}}},"campaignId":"c1000000-0000-0000-0000-000000000001","label":"DM house rules for this character","dmEdit":true}'::jsonb, 'event ' || lastev('draft')::text) $b$);
select t('dm_edit: dmHouseRules with a bad shape', 'refused', 'fail', $b$
  select as_dm(); select dm_edit_character_log(chid('hold'), '[{"type":"dmHouseRules","overrides":{"boons":{"B":{"ap":5}}}}]') $b$, 'PACT house rules: boon%');
select t('dm_edit: dmRefundBoon is RPC-only', 'refused', 'pass', $b$
  select as_dm(); select dm_edit_character_log(chid('hold'), '[{"type":"dmRefundBoon","refVal":"Alertness","targetSeq":2,"cost":-6}]') $b$, '%unsupported event type%');
select t('dm_edit: dmRepriceDrawback is RPC-only', 'refused', 'pass', $b$
  select as_dm(); select dm_edit_character_log(chid('hold'), '[{"type":"dmRepriceDrawback","refVal":"Slow to Mend","targetSeq":3,"amount":50}]') $b$, '%unsupported event type%');
select t('dm_edit: dmRemoveDrawback is RPC-only', 'refused', 'pass', $b$
  select as_dm(); select dm_edit_character_log(chid('hold'), '[{"type":"dmRemoveDrawback","refVal":"Slow to Mend","targetSeq":3,"grantBack":-50}]') $b$, '%unsupported event type%');
select t('dm_edit: #642''s buy/patch houseRules stays refused (superseded by dmHouseRules)', 'refused', 'pass', $b$
  select as_dm(); select dm_edit_character_log(chid('hold'), '[{"type":"buy","cat":"patch","payload":{"patch":{"houseRules":{}}},"cost":0}]') $b$, '%unsupported buy category%');

-- =====================================================================================================================
-- 6. The ledger (§6.4, M1, M4) and the budget check (X1, Z1)
-- =====================================================================================================================
select t('ledger: split sums, dmEdit-only counting of the new events', 'allowed', 'fail', $b$
  select ok(split('[{"type":"award","amount":10},{"type":"buy","cat":"drawback","payload":{"v":"A"},"cost":-5,"seq":1},
    {"type":"buy","cat":"boon","payload":{"v":"B"},"cost":4,"seq":2},
    {"type":"dmRefundBoon","refVal":"B","targetSeq":2,"cost":-4,"dmEdit":true},
    {"type":"dmRepriceDrawback","refVal":"A","targetSeq":1,"amount":2,"dmEdit":true},
    {"type":"dmRefundBoon","refVal":"B","targetSeq":2,"cost":-40},
    {"type":"dmRepriceDrawback","refVal":"A","targetSeq":1,"amount":20,"dmEdit":"true"},
    {"type":"dmRemoveDrawback","refVal":"A","targetSeq":1,"grantBack":-30,"dmEdit":1}]', '{"draws":{"A":{"ap":7}}}') = '[0, 10, 7]', 'sums') $b$);
select t('ledger M4: a targeted buyoff nets out the grant incl. ΣΔ', 'allowed', 'fail', $b$
  select ok(split('[{"type":"award","amount":10},{"type":"buy","cat":"drawback","payload":{"v":"A"},"cost":-5,"seq":1},
    {"type":"dmRepriceDrawback","refVal":"A","targetSeq":1,"amount":2,"dmEdit":true},
    {"type":"buyoff","refVal":"A","targetSeq":1,"cost":21}]') = '[21, 10, 0]', 'netted') $b$);
select t('ledger M4: an untargeted buyoff keeps the grant (old approximation)', 'allowed', 'fail', $b$
  select ok(split('[{"type":"award","amount":10},{"type":"buy","cat":"drawback","payload":{"v":"A"},"cost":-5,"seq":1},
    {"type":"buyoff","refVal":"A","cost":15}]', '{"draws":{"A":{"ap":5}}}') = '[15, 10, 5]', 'kept') $b$);
select t('ledger M4: a targetSeq that is NOT the purchase FIFO cancels nets nothing', 'allowed', 'fail', $b$
  select ok(split('[{"type":"buy","cat":"drawback","payload":{"v":"A"},"cost":-5,"seq":1},{"type":"buy","cat":"drawback","payload":{"v":"A"},"cost":-4,"seq":2},
    {"type":"buyoff","refVal":"A","targetSeq":2,"cost":12}]', '{"draws":{"A":{"ap":5}}}') = '[12, 0, 9]', 'not netted') $b$);
select t('ledger M4: the second buyoff of two copies nets the second', 'allowed', 'fail', $b$
  select ok(split('[{"type":"buy","cat":"drawback","payload":{"v":"A"},"cost":-5,"seq":1},{"type":"buy","cat":"drawback","payload":{"v":"A"},"cost":-4,"seq":2},
    {"type":"buyoff","refVal":"A","targetSeq":1,"cost":15},{"type":"buyoff","refVal":"A","targetSeq":2,"cost":12}]') = '[27, 0, 0]', 'both netted') $b$);
select t('ledger: pact_ap_ledger_spend keeps its shape (player_earned = awards + drawbacks)', 'allowed', 'pass', $b$
  select ok((select spent = 4 and player_earned = 15 from pact_ap_ledger_spend('[{"type":"award","amount":10},{"type":"buy","cat":"drawback","payload":{"v":"Slow to Mend"},"cost":-5},{"type":"buy","cat":"boon","payload":{"v":"B"},"cost":4}]')), 'shape') $b$);
select t('budget M4: buying off with targetSeq cannot spend the grant it cancels', 'refused', 'fail', $b$
  select owner_append('tb', '{"seq":4,"type":"buyoff","refVal":"Slow to Mend","targetSeq":2,"cost":15}') $b$, 'PACT: over AP budget%');
select t('budget M4: the same buyoff within budget is fine (DM AP 10 + awards 10)', 'allowed', 'pass', $b$
  select as_admin(); update characters set ap = 10 where name = 'tb';
  select owner_append('tb', '{"seq":4,"type":"buyoff","refVal":"Slow to Mend","targetSeq":2,"cost":15}') $b$);
select t('R2-5: a NEW buyoff without targetSeq is refused (existing ones are grandfathered)', 'refused', 'fail', $b$
  select owner_append('tb', '{"seq":4,"type":"buyoff","refVal":"Slow to Mend","cost":15}') $b$, 'PACT: a buy-off must name%');
select t('R2-5 (reviewer): a free untargeted buyoff that kept the grant server-side', 'refused', 'fail', $b$
  select owner_append('tb', '{"seq":4,"type":"buyoff","refVal":"Slow to Mend","cost":0}') $b$, 'PACT: a buy-off must name%');
select t('R2-5: a targeted buyoff below 3 × the drawback''s value is refused', 'refused', 'fail', $b$
  select as_admin(); update characters set ap = 50 where name = 'tb';
  select owner_append('tb', '{"seq":4,"type":"buyoff","refVal":"Slow to Mend","targetSeq":2,"cost":14}') $b$, 'PACT: buying off Slow to Mend costs 15%');
select t('R2-5: …a targeted buyoff that cancels nothing is refused', 'refused', 'fail', $b$
  select as_admin(); update characters set ap = 200 where name = 'tb';
  select owner_append('tb', '{"seq":4,"type":"buyoff","refVal":"Peg Leg","targetSeq":2,"cost":99}') $b$, 'PACT: that buy-off cancels no drawback%');
select t('R2-5: a DM-imposed ''flat'' drawback buys off at 1 × its value', 'allowed', 'pass', $b$
  select as_dm(); select dm_edit_character_log(chid('tb'), '[{"type":"buy","cat":"drawback","payload":{"v":"Peg Leg"},"cost":0,"dmRemovalCost":"flat"}]');
  select as_admin(); update characters set ap = 50 where name = 'tb';
  select owner_append('tb', '{"seq":9,"type":"buyoff","refVal":"Peg Leg","targetSeq":4,"cost":4}') $b$);
select t('R2-5: …an ''expensive'' one at 3 ×', 'refused', 'fail', $b$
  select as_dm(); select dm_edit_character_log(chid('tb'), '[{"type":"buy","cat":"drawback","payload":{"v":"Peg Leg"},"cost":0,"dmRemovalCost":"expensive"}]');
  select as_admin(); update characters set ap = 50 where name = 'tb';
  select owner_append('tb', '{"seq":9,"type":"buyoff","refVal":"Peg Leg","targetSeq":4,"cost":4}') $b$, 'PACT: buying off Peg Leg costs 12%');
select t('R2-5: the stored untargeted buyoff on boff is grandfathered (a re-save is fine)', 'allowed', 'pass', $b$
  select owner_upd('boff', $e$ stats || '{"name":"again"}'::jsonb $e$) $b$);
select t('budget X1: an ignore-player-AP campaign counts the drawback grant (10 DM + 5)', 'allowed', 'fail', $b$
  select owner_append('ign', '{"seq":4,"type":"buy","cat":"boon","cost":15,"payload":{"v":"Bulwark"}}') $b$);
select t('budget X1: …but not more than that', 'refused', 'pass', $b$
  select owner_append('ign', '{"seq":4,"type":"buy","cat":"boon","cost":16,"payload":{"v":"Bulwark"}}') $b$, 'PACT: over AP budget%');
select t('budget Z1: the DM''s cap (4) limits the 7 AP of drawbacks', 'refused', 'fail', $b$
  select owner_append('cap4', '{"seq":5,"type":"buy","cat":"boon","cost":5,"payload":{"v":"Bulwark"}}') $b$, 'PACT: over AP budget%');
select t('budget Z1: within the cap', 'allowed', 'pass', $b$
  select owner_append('cap4', '{"seq":5,"type":"buy","cat":"boon","cost":4,"payload":{"v":"Bulwark"}}') $b$);
select t('budget Z1: the cap switched OFF — no cap (all 7)', 'allowed', 'pass', $b$
  select owner_append('capoff', '{"seq":5,"type":"buy","cat":"boon","cost":7,"payload":{"v":"Bulwark"}}') $b$);
select t('budget Z1: cap off, still not more than the grant', 'refused', 'pass', $b$
  select owner_append('capoff', '{"seq":5,"type":"buy","cat":"boon","cost":8,"payload":{"v":"Bulwark"}}') $b$, 'PACT: over AP budget%');
select t('budget Z1: no drawbackCap key — no cap, not DATA.drawbackCap (20 of 21 > 12)', 'allowed', 'pass', $b$
  select owner_append('nocap', '{"seq":7,"type":"buy","cat":"boon","cost":20,"payload":{"v":"Bulwark"}}') $b$);
select t('budget: a DM reprice moves the server''s grant (ign: +2)', 'allowed', 'fail', $b$
  select hr(2, '{"draws":{"Slow to Mend":{"ap":7}}}', jsonb_build_array(act('reprice', 'ign', '{"name":"Slow to Mend","targetSeq":2,"amount":2,"from":5,"to":7}')));
  select owner_append('ign', '{"seq":5,"type":"buy","cat":"boon","cost":17,"payload":{"v":"Bulwark"}}') $b$);
select t('budget: a DM drawback removal takes the grant back (ign: 10 left)', 'refused', 'fail', $b$
  select hr(2, null, jsonb_build_array(act('removeDrawback', 'ign', '{"name":"Slow to Mend","targetSeq":2}')));
  select owner_append('ign', '{"seq":5,"type":"buy","cat":"boon","cost":11,"payload":{"v":"Bulwark"}}') $b$, 'PACT: over AP budget%');
select t('budget V1: a character pushed below 0 by a removal can still SAVE (no new spend)', 'allowed', 'fail', $b$
  select hr(2, null, jsonb_build_array(act('removeDrawback', 'ign', '{"name":"Slow to Mend","targetSeq":2}')));
  select as_admin(); update characters set ap = 0 where name = 'ign';
  select owner_upd('ign', $e$ stats || '{"name":"renamed"}'::jsonb $e$) $b$);

-- =====================================================================================================================
-- 7. M1 — the DM-family forgery guard (a PLAYER writing their own campaign character)
-- =====================================================================================================================
select t('forge: player appends a dmEdit:true dmRefundBoon (an AP mint)', 'refused', 'fail', $b$
  select owner_append('hold', '{"seq":10,"type":"dmRefundBoon","refVal":"Alertness","targetSeq":2,"cost":-60,"dmEdit":true}') $b$, 'PACT: only your DM%');
select t('forge: player appends a dmRepriceDrawback without dmEdit (a DM-only type)', 'refused', 'fail', $b$
  select owner_append('hold', '{"seq":10,"type":"dmRepriceDrawback","refVal":"Slow to Mend","targetSeq":3,"amount":50}') $b$, 'PACT: only your DM%');
select t('forge: player appends a dmRemoveDrawback', 'refused', 'fail', $b$
  select owner_append('hold', '{"seq":10,"type":"dmRemoveDrawback","refVal":"Hexed","targetSeq":7,"grantBack":-50,"dmEdit":true}') $b$, 'PACT: only your DM%');
select t('forge: player appends a dmHouseRules override (reprices in the browser)', 'refused', 'fail', $b$
  select owner_append('hold', '{"seq":10,"type":"dmHouseRules","overrides":{"draws":{"Slow to Mend":{"ap":99}}},"campaignId":"c1000000-0000-0000-0000-000000000001","dmEdit":true}') $b$, 'PACT: only your DM%');
select t('forge: player appends a sessionSeal', 'refused', 'fail', $b$
  select owner_append('hold', '{"seq":10,"type":"sessionSeal","note":"mine"}') $b$, 'PACT: only your DM%');
select t('forge: player appends a dmRemoveBoon', 'refused', 'fail', $b$
  select owner_append('hold', '{"seq":10,"type":"dmRemoveBoon","refVal":"Alertness"}') $b$, 'PACT: only your DM%');
select t('forge: player appends a dmUnlockDrawback (frees a locked drawback)', 'refused', 'fail', $b$
  select owner_append('hold', '{"seq":10,"type":"dmUnlockDrawback","refVal":"Hexed","targetSeq":7,"note":"x","dmEdit":true}') $b$, 'PACT: only your DM%');
select t('forge: player appends a dmEdit:true boon buy at cost 0', 'refused', 'fail', $b$
  select owner_append('hold', '{"seq":10,"type":"buy","cat":"boon","cost":0,"payload":{"v":"Bulwark"},"dmEdit":true}') $b$, 'PACT: only your DM%');
select t('forge: dmEdit:"true" (a truthy string) counts as a DM entry', 'refused', 'fail', $b$
  select owner_append('hold', '{"seq":10,"type":"buy","cat":"boon","cost":0,"payload":{"v":"Bulwark"},"dmEdit":"true"}') $b$, 'PACT: only your DM%');
select t('forge: player deletes a DM override at the tail (outside the locked prefix)', 'refused', 'fail', $b$
  select owner_upd('tail', $e$ jsonb_set(stats, '{LOG}', (select jsonb_agg(e order by o) from jsonb_array_elements(stats->'LOG') with ordinality x(e,o) where e->>'type' <> 'dmHouseRules')) $e$) $b$, 'PACT: only your DM%');
select t('forge: player edits a DM override''s contents', 'refused', 'fail', $b$
  select owner_upd('tail', $e$ jsonb_set(stats, '{LOG,2,overrides}', '{"draws":{"Squeamish":{"ap":50}}}') $e$) $b$, 'PACT: only your DM%');
select t('forge: player clears dmLocked on an imposed drawback (already frozen by the lock today)', 'refused', 'pass', $b$
  select owner_upd('hold', $e$ jsonb_set(stats, '{LOG,6,dmLocked}', 'false') $e$) $b$);
select t('forge: player re-orders two DM entries', 'refused', 'fail', $b$
  select owner_upd('withdm', $e$ jsonb_set(jsonb_set(stats, '{LOG,5}', stats->'LOG'->6), '{LOG,6}', stats->'LOG'->5) $e$) $b$);
select t('forge: a SOLO character is not guarded (residual risk, plan §6.7)', 'allowed', 'pass', $b$
  select owner_append('solo', '{"seq":3,"type":"dmRefundBoon","refVal":"Alertness","targetSeq":2,"cost":-6,"dmEdit":true}') $b$);

-- honest player saves around DM entries
select t('honest: player re-saves a character carrying DM entries (rename)', 'allowed', 'pass', $b$
  select owner_upd('withdm', $e$ stats || '{"name":"renamed"}'::jsonb $e$) $b$);
select t('honest: player appends an ordinary buy after DM entries', 'allowed', 'pass', $b$
  select owner_append('withdm', '{"seq":9,"type":"buy","cat":"skill","cost":1,"payload":{"v":"Arcana"}}') $b$);
select t('honest: player re-saves after the RPC appended events (Live Sheet shape)', 'allowed', 'fail', $b$
  select hr(1, '{"draws":{"Slow to Mend":{"ap":7}}}', jsonb_build_array(act('reprice', 'hold', '{"name":"Slow to Mend","targetSeq":3,"amount":2,"from":5,"to":7}'),
    act('pin', 'hold', '{"overrides":{"pins":{"draws":{"Squeamish":{"ap":3}}}}}')));
  select owner_append('hold', '{"seq":12,"type":"buy","cat":"skill","cost":1,"payload":{"v":"Arcana"}}');
  select owner_upd('hold', $e$ stats || '{"name":"again"}'::jsonb $e$) $b$);
select t('honest: CharGen relocates its Budget singleton past a new buy (DM override before it)', 'allowed', 'pass', $b$
  select owner_upd('tail', $e$ jsonb_set(stats,'{LOG}', (select jsonb_agg(e order by o) from jsonb_array_elements(stats->'LOG') with ordinality x(e,o) where e->>'type'<>'award') || '[{"seq":5,"type":"buy","cat":"skill","cost":1,"payload":{"v":"Arcana"}},{"seq":6,"type":"award","amount":77,"note":"Budget","noLock":true,"label":"Award — budget (77 AP)"}]'::jsonb) $e$) $b$);
select t('honest: player buys off the DM-imposed drawback after the DM unlocked it', 'allowed', 'pass', $b$
  select as_dm(); select dm_edit_character_log(chid('hold'), '[{"type":"dmUnlockDrawback","refVal":"Hexed","targetSeq":7,"note":"the curse lifts"}]');
  select owner_append('hold', '{"seq":11,"type":"buyoff","refVal":"Hexed","targetSeq":7,"cost":0}') $b$);
select t('honest: player appends a targeted buyoff (PR2 Live Sheet shape)', 'allowed', 'pass', $b$
  select owner_append('hold', '{"seq":10,"type":"buyoff","refVal":"Squeamish","targetSeq":4,"cost":6}') $b$);

-- DM paths keep working with every new trigger on
select t('DM: award_ap', 'allowed', 'pass', $b$ select as_dm(); select award_ap(chid('hold'), 25, 'session 2') $b$);
select t('DM: award_ap_and_seal (appends a DM sessionSeal)', 'allowed', 'pass', $b$ select as_dm(); select award_ap_and_seal(chid('hold'), 25, 'session 2', 'idem-1') $b$);
select t('DM: seal_character_history', 'allowed', 'pass', $b$ select as_dm(); select seal_character_history(chid('withdm'), 'end of session 3') $b$);
select t('DM: dm_zero_player_ap', 'allowed', 'pass', $b$ select as_dm(); select dm_zero_player_ap(chid('hold')) $b$);
select t('DM: boon grant through dm_edit_character_log', 'allowed', 'pass', $b$
  select as_dm(); select dm_edit_character_log(chid('hold'), '[{"type":"buy","cat":"boon","payload":{"v":"Bulwark"},"cost":6},{"type":"award","amount":6,"note":"DM boon grant"}]') $b$);
select t('DM: dmRemoveBoon through dm_edit_character_log', 'allowed', 'pass', $b$
  select as_dm(); select dm_edit_character_log(chid('hold'), '[{"type":"dmRemoveBoon","refVal":"Alertness"}]') $b$);
select t('DM: imposes a drawback, then the player re-saves', 'allowed', 'pass', $b$
  select as_dm(); select dm_edit_character_log(chid('hold'), '[{"type":"buy","cat":"drawback","payload":{"v":"Cursed"},"cost":0,"dmLocked":true}]');
  select owner_upd('hold', $e$ stats || '{"name":"x"}'::jsonb $e$) $b$);
select t('admin: a repair with no JWT is not refused by the guard', 'allowed', 'pass', $b$
  select as_admin(); update characters set stats = jsonb_set(stats, '{LOG,2,overrides}', '{"draws":{"Squeamish":{"ap":1}}}') where name = 'tail' $b$);

-- =====================================================================================================================
-- 8. History protection extended to the DM's AP-moving events (§6.5)
-- =====================================================================================================================
select t('history: a buy before a DM refund is frozen (locked character)', 'refused', 'fail', $b$
  select owner_upd('withdm', $e$ jsonb_set(stats, '{LOG,4,cost}', '1') $e$) $b$, 'PACT: locked character history%');
select t('history: …and stays frozen after the DM reopens creation (no double refund)', 'refused', 'fail', $b$
  select owner_upd('reopen', $e$ jsonb_set(stats, '{LOG,3,cost}', '0') $e$) $b$, 'PACT: locked character history%');
select t('history: a buy AFTER the DM refund on a reopened character is still the player''s', 'allowed', 'pass', $b$
  select owner_upd('reopen', $e$ jsonb_set(stats, '{LOG,6,cost}', '2') $e$) $b$);
select t('history: a non-DM-stamped refund is no boundary', 'allowed', 'pass', $b$
  select as_admin();
  insert into characters(owner_id, campaign_id, name, kind, ap, stats)
    select 'a0000000-0000-0000-0000-000000000018', campaign_id, 'reopen2', kind, ap, jsonb_set(stats, '{LOG,4,dmEdit}', 'false') from characters where name = 'reopen';
  select owner_upd('reopen2', $e$ jsonb_set(stats, '{LOG,3,cost}', '0') $e$) $b$);
select t('history: an admin cannot quietly un-stamp a DM refund either (it is protected)', 'refused', 'fail', $b$
  select as_admin(); update characters set stats = jsonb_set(stats, '{LOG,4,dmEdit}', 'false') where name = 'reopen' $b$, 'PACT: locked character history%');
-- =====================================================================================================================
-- 9. The PR #654 security review (ATK1, ATK2, ATK5, ATK6, ATK7) and its follow-ups
-- =====================================================================================================================
select t('ATK1 (a): renumbering a refunded purchase (to un-match the DM refund) is refused — seq is protected', 'refused', 'fail', $b$
  select hr(2, null, jsonb_build_array(act('refundBoon', 'ig2', '{"name":"Bulwark","targetSeq":2}')));
  select owner_upd('ig2', $e$ jsonb_set(stats, '{LOG,1,seq}', '200') $e$) $b$, 'PACT: locked character history%');
select t('ATK1 (b): an un-matched DM refund counts NOTHING in the server ledger (only matched events count)', 'allowed', 'fail', $b$
  select ok(split('[{"type":"award","amount":10},{"type":"buy","cat":"boon","payload":{"v":"Bulwark"},"cost":10,"seq":200},
    {"type":"dmRefundBoon","refVal":"Bulwark","targetSeq":2,"cost":-10,"dmEdit":true}]') = '[10, 10, 0]', 'refund not counted');
  select ok(split('[{"type":"buy","cat":"drawback","payload":{"v":"A"},"cost":-5,"seq":1},{"type":"buy","cat":"drawback","payload":{"v":"A"},"cost":-5,"seq":1},
    {"type":"dmRepriceDrawback","refVal":"A","targetSeq":1,"amount":9,"dmEdit":true}]', '{"draws":{"A":{"ap":5}}}') = '[0, 0, 5]', 'ambiguous reprice not counted (and a name grants once, F1)');
  select ok(split('[{"type":"buy","cat":"boon","payload":{"v":"B"},"cost":4,"seq":1},{"type":"dmRefundBoon","refVal":"B","targetSeq":1,"cost":"Infinity","dmEdit":true}]') = '[4, 0, 0]', 'non-finite not counted');
  select ok(split('[{"type":"buy","cat":"boon","payload":{"v":"B"},"cost":4,"seq":1},{"type":"dmRefundBoon","refVal":"B","targetSeq":1,"cost":-4,"dmEdit":true},
    {"type":"dmRefundBoon","refVal":"B","targetSeq":1,"cost":-4,"dmEdit":true}]') = '[0, 0, 0]', 'a second refund of one purchase not counted') $b$);
select t('ATK7: renumbering a purchase inside the frozen prefix (before an award) is refused', 'refused', 'fail', $b$
  select owner_upd('hold', $e$ jsonb_set(stats, '{LOG,1,seq}', '555') $e$) $b$, 'PACT: locked character history%');
select t('ATK7: …a buyoff''s seq too', 'refused', 'fail', $b$
  -- setup only: #644's award ceiling deliberately does not exempt admin sessions, so plant the award with triggers off
  select as_admin(); set local session_replication_role = replica;
  update characters set stats = jsonb_set(stats, '{LOG}', (stats->'LOG') || '[{"seq":9,"type":"award","amount":1}]'::jsonb) || '{"SEQ":10}' where name = 'boff';
  set local session_replication_role = origin;
  select owner_upd('boff', $e$ jsonb_set(stats, '{LOG,3,seq}', '444') $e$) $b$, 'PACT: locked character history%');
select t('ATK2 / AB1: an ignore-mode player''s forged -1000 drawback (made-up name) grants nothing', 'refused', 'pass', $b$
  select allow_post_lock(2);
  select owner_append('ig3', '{"seq":3,"type":"buy","cat":"drawback","cost":-1000,"payload":{"v":"Fake"}}');
  select owner_append('ig3', '{"seq":4,"type":"buy","cat":"boon","cost":1000,"payload":{"v":"Lucky"}}') $b$, 'PACT: over AP budget%');
select t('ATK5: a draft rebuild that drops a DM override (CharGen Randomise shape) is refused', 'refused', 'fail', $b$
  select as_dm(); select dm_edit_character_log(chid('drhr'), '[{"type":"dmHouseRules","overrides":{}}]');
  select owner_upd('drhr', $e$ jsonb_set(stats, '{LOG}', '[{"seq":1,"type":"award","amount":79,"note":"Budget","noLock":true},{"seq":2,"type":"buy","cat":"boon","cost":7,"payload":{"v":"Bulwark"}}]') $e$) $b$, 'PACT: only your DM%');
select t('ATK6: a DM boon GRANT (buy + award pair) is already frozen by its own award today — main''s re-pricing is refused either way', 'refused', 'pass', $b$
  select as_dm(); select dm_edit_character_log(chid('drhr'), '[{"type":"buy","cat":"boon","cost":12,"payload":{"v":"Lucky"}},{"type":"award","amount":12}]');
  select owner_upd('drhr', $e$ jsonb_set(stats, '{LOG,2,cost}', '14') $e$) $b$, 'PACT: locked character history%');
select t('ATK6 relaxation: a DM-stamped boon buy with no award after it, in a DRAFT, may be re-priced UP', 'allowed', 'pass', $b$
  select owner_upd('drg', $e$ jsonb_set(stats, '{LOG,1,cost}', '14') $e$) $b$);
select t('ATK6 relaxation: …but never DOWN', 'refused', 'fail', $b$
  select owner_upd('drg', $e$ jsonb_set(stats, '{LOG,1,cost}', '10') $e$) $b$, 'PACT: only your DM%');
select t('ATK6 relaxation: …and nothing else about the DM event may change with it', 'refused', 'fail', $b$
  select owner_upd('drg', $e$ jsonb_set(jsonb_set(stats, '{LOG,1,cost}', '14'), '{LOG,1,payload,v}', '"Bulwark"') $e$) $b$, 'PACT: only your DM%');
select t('ATK6 relaxation: …and only in a draft', 'refused', 'fail', $b$
  select as_admin(); insert into characters(owner_id, campaign_id, name, kind, ap, stats)
    select 'a0000000-0000-0000-0000-000000000020', campaign_id, 'drg2', kind, ap, jsonb_set(stats, '{LOG}', (stats->'LOG') || '[{"seq":9,"type":"creationLocked"},{"seq":10,"type":"creationUnlocked"},{"seq":11,"type":"creationLocked"},{"seq":12,"type":"buy","cat":"boon","cost":12,"payload":{"v":"Bulwark"},"dmEdit":true}]'::jsonb) from characters where name = 'drg';
  select owner_upd('drg2', $e$ jsonb_set(stats, '{LOG,5,cost}', '14') $e$) $b$, 'PACT: only your DM%');
select t('RPC: an archived character is refused', 'refused', 'fail', $b$
  select as_admin(); update characters set archived_at = now() where name = 'nocap';
  select hr(1, null, jsonb_build_array(act('pin', 'nocap', '{"overrides":{}}'))) $b$, '%archived%');
select t('RPC: a DM''s own NPC is accepted, like every other DM write path', 'allowed', 'fail', $b$
  select as_admin(); update characters set is_npc = true, owner_id = 'd0000000-0000-0000-0000-000000000001' where name = 'tb';
  select hr(1, null, jsonb_build_array(act('pin', 'tb', '{"overrides":{}}'))) $b$);
select t('a malformed cost string counts 0 instead of blocking every save (Number(x)||0, as the engine reads it)', 'allowed', 'fail', $b$
  select owner_append('tb', '{"seq":4,"type":"buy","cat":"skill","cost":"abc","payload":{"v":"Arcana"}}');
  select owner_upd('tb', $e$ stats || '{"name":"again"}'::jsonb $e$) $b$);
-- =====================================================================================================================
-- 10. AB1 (owner, 2026-10-13): a player drawback grants at most its EFFECTIVE value; an unknown name grants nothing
-- =====================================================================================================================
select t('AB1 price list: pact_drawback_printed knows the printed values (generated from js/engine-data.js)', 'allowed', 'fail', $b$
  select ok(pact_drawback_printed('Slow to Mend') = 5 and pact_drawback_printed('Peg Leg') = 4 and pact_drawback_printed('Fake') is null, 'printed') $b$);
select t('AB1: in a campaign that counts player AP, an inflated real drawback no longer mints AP (tb: 10 + 5 + 5, not + 500)', 'refused', 'fail', $b$
  select allow_post_lock(1);
  select owner_append('tb', '{"seq":4,"type":"buy","cat":"drawback","cost":-500,"payload":{"v":"Slow to Mend"}}');
  select owner_append('tb', '{"seq":5,"type":"buy","cat":"boon","cost":100,"payload":{"v":"Lucky"}}') $b$, 'PACT: over AP budget%');
select t('AB1: a real name at an inflated cost grants its printed value (ign: 10 DM + 5, not 10 + 500)', 'refused', 'pass', $b$
  select allow_post_lock(2);
  select owner_append('ig3', '{"seq":3,"type":"buy","cat":"drawback","cost":-500,"payload":{"v":"Slow to Mend"}}');
  select owner_append('ig3', '{"seq":4,"type":"buy","cat":"boon","cost":16,"payload":{"v":"Lucky"}}') $b$, 'PACT: over AP budget%');
select t('AB1: …and that printed value IS spendable (15)', 'allowed', 'fail', $b$
  select allow_post_lock(2);
  select owner_append('ig3', '{"seq":3,"type":"buy","cat":"drawback","cost":-500,"payload":{"v":"Slow to Mend"}}');
  select owner_append('ig3', '{"seq":4,"type":"buy","cat":"boon","cost":15,"payload":{"v":"Lucky"}}') $b$);
select t('AB1: a CharGen cost-0 drawback (F4a) grants 0, as today', 'allowed', 'fail', $b$
  select ok(split('[{"type":"buy","cat":"drawback","payload":{"v":"Slow to Mend"},"cost":0,"seq":1}]') = '[0, 0, 0]', 'zero') $b$);
select t('AB1: a campaign CUSTOM drawback grants its campaign value; deleted from the campaign it grants 0 (engine: no entry, no printed value)', 'allowed', 'fail', $b$
  select ok(split('[{"type":"buy","cat":"drawback","payload":{"v":"Hexed Custom"},"cost":-4,"seq":1}]', '{"draws":{"Hexed Custom":{"ap":4}}}') = '[0, 0, 4]', 'custom');
  select ok(split('[{"type":"buy","cat":"drawback","payload":{"v":"Hexed Custom"},"cost":-4,"seq":1}]', '{}') = '[0, 0, 0]', 'deleted') $b$);
select t('AB1: a deleted campaign REPRICE of a printed drawback falls back to the printed value', 'allowed', 'fail', $b$
  select ok(split('[{"type":"buy","cat":"drawback","payload":{"v":"Slow to Mend"},"cost":-9,"seq":1}]', '{}') = '[0, 0, 5]', 'printed') $b$);
select t('AB1: precedence pin > DM override (this campaign only) > campaign > printed', 'allowed', 'fail', $b$
  select ok(split('[{"type":"buy","cat":"drawback","payload":{"v":"X"},"cost":-9,"seq":1},
      {"type":"dmHouseRules","dmEdit":true,"campaignId":"c1000000-0000-0000-0000-000000000001","overrides":{"draws":{"X":{"ap":6}}}}]', '{"draws":{"X":{"ap":3}}}', camp(1)) = '[0, 0, 6]', 'override');
  select ok(split('[{"type":"buy","cat":"drawback","payload":{"v":"X"},"cost":-9,"seq":1},
      {"type":"dmHouseRules","dmEdit":true,"campaignId":"c1000000-0000-0000-0000-000000000005","overrides":{"draws":{"X":{"ap":6}}}}]', '{"draws":{"X":{"ap":3}}}', camp(1)) = '[0, 0, 3]', 'another campaign''s override ignored');
  select ok(split('[{"type":"buy","cat":"drawback","payload":{"v":"X"},"cost":-9,"seq":1},
      {"type":"dmHouseRules","dmEdit":true,"campaignId":"c1000000-0000-0000-0000-000000000001","overrides":{"draws":{"X":{"ap":6}},"pins":{"draws":{"X":{"ap":2}}}}}]', '{"draws":{"X":{"ap":3}}}', camp(1)) = '[0, 0, 2]', 'pin');
  select ok(split('[{"type":"buy","cat":"drawback","payload":{"v":"X"},"cost":-9,"seq":1},
      {"type":"dmHouseRules","campaignId":"c1000000-0000-0000-0000-000000000001","overrides":{"draws":{"X":{"ap":6}}}}]', '{"draws":{"X":{"ap":3}}}', camp(1)) = '[0, 0, 3]', 'override without dmEdit ignored') $b$);
select t('AB1: an imposed drawback grants 0; a DM-stamped one with a negative cost grants normally', 'allowed', 'fail', $b$
  select ok(split('[{"type":"buy","cat":"drawback","payload":{"v":"Slow to Mend"},"cost":0,"dmEdit":true},{"type":"buy","cat":"drawback","payload":{"v":"Slow to Mend"},"cost":3,"dmEdit":true},
      {"type":"buy","cat":"drawback","payload":{"v":"Peg Leg"},"cost":-4,"dmEdit":true}]') = '[0, 0, 4]', 'imposed 0') $b$);
select t('AB1: an Object.prototype name, or no name at all, grants 0', 'allowed', 'fail', $b$
  select ok(split('[{"type":"buy","cat":"drawback","payload":{"v":"toString"},"cost":-5},{"type":"buy","cat":"drawback","payload":{"v":"constructor"},"cost":-5},
      {"type":"buy","cat":"drawback","payload":{},"cost":-5}]', '{"draws":{}}') = '[0, 0, 0]', 'zero') $b$);
select t('AB1: a removed drawback grants 0 whatever grantBack says', 'allowed', 'fail', $b$
  select ok(split('[{"type":"buy","cat":"drawback","payload":{"v":"Slow to Mend"},"cost":-5,"seq":1},
      {"type":"dmRemoveDrawback","refVal":"Slow to Mend","targetSeq":1,"grantBack":-100,"dmEdit":true}]') = '[0, 0, 0]', 'removed') $b$);
select t('AB1 budget: a campaign custom drawback is spendable in its campaign (RPC-written rules)', 'allowed', 'fail', $b$
  select allow_post_lock(2);
  select hr(2, '{"draws":{"Hexed Custom":{"ap":4}}}', '[]');
  select owner_append('ig3', '{"seq":3,"type":"buy","cat":"drawback","cost":-4,"payload":{"v":"Hexed Custom"}}');
  select owner_append('ig3', '{"seq":4,"type":"buy","cat":"boon","cost":14,"payload":{"v":"Lucky"}}') $b$);
-- =====================================================================================================================
-- 11. PR #654 round-2 review (F1, R2-1..R2-9, F3, F4)
-- =====================================================================================================================
select t('R2-1 / F1: 20 copies of one drawback then a 100 AP boon (ignore-mode, no cap) — the copies are refused after the lock', 'refused', 'pass', $b$
  select owner_upd('ign', $e$ jsonb_set(stats, '{LOG}', (stats->'LOG') || (select jsonb_agg(jsonb_build_object('seq', 100+g, 'type','buy','cat','drawback','cost',-5,'payload',jsonb_build_object('v','Slow to Mend'))) from generate_series(1,20) g)) $e$);
  select owner_append('ign', '{"seq":200,"type":"buy","cat":"boon","cost":100,"payload":{"v":"Lucky"}}') $b$);
select t('R2-1 / F1: …and where post-lock drawbacks ARE allowed, the 20 copies grant once (10 DM + 5)', 'refused', 'pass', $b$
  select allow_post_lock(2);
  select owner_upd('ign', $e$ jsonb_set(stats, '{LOG}', (stats->'LOG') || (select jsonb_agg(jsonb_build_object('seq', 100+g, 'type','buy','cat','drawback','cost',-5,'payload',jsonb_build_object('v','Slow to Mend'))) from generate_series(1,20) g)) $e$);
  select owner_append('ign', '{"seq":200,"type":"buy","cat":"boon","cost":16,"payload":{"v":"Lucky"}}') $b$, 'PACT: over AP budget%');
select t('F1: in a campaign counting player AP (post-lock drawbacks allowed), 20 copies no longer mint 100 AP', 'refused', 'fail', $b$
  select allow_post_lock(1);
  select owner_upd('tb', $e$ jsonb_set(stats, '{LOG}', (stats->'LOG') || (select jsonb_agg(jsonb_build_object('seq', 100+g, 'type','buy','cat','drawback','cost',-5,'payload',jsonb_build_object('v','Slow to Mend'))) from generate_series(1,20) g)) $e$);
  select owner_append('tb', '{"seq":200,"type":"buy","cat":"boon","cost":100,"payload":{"v":"Lucky"}}') $b$, 'PACT: over AP budget%');
select t('F1: a name grants once in the SQL ledger', 'allowed', 'fail', $b$
  select ok(split('[{"type":"buy","cat":"drawback","payload":{"v":"Slow to Mend"},"cost":-5,"seq":1},{"type":"buy","cat":"drawback","payload":{"v":"Slow to Mend"},"cost":-5,"seq":2}]') = '[0, 0, 5]', 'once');
  select ok(split('[{"type":"buy","cat":"drawback","payload":{"v":"Slow to Mend"},"cost":-5,"seq":1},{"type":"buyoff","refVal":"Slow to Mend","targetSeq":1,"cost":15},
      {"type":"buy","cat":"drawback","payload":{"v":"Slow to Mend"},"cost":-5,"seq":3}]') = '[15, 0, 5]', 'retake after a buy-off counts');
  select ok(split('[{"type":"buy","cat":"drawback","payload":{"v":"Peg Leg"},"cost":-4,"seq":1},{"type":"buy","cat":"drawback","payload":{"v":"Peg Leg"},"cost":0,"seq":2,"dmEdit":true}]') = '[0, 0, 4]', 'imposed copy beside it') $b$);
select t('lock: a player drawback after the lock is refused unless the campaign allows it', 'refused', 'fail', $b$
  select owner_append('tb', '{"seq":4,"type":"buy","cat":"drawback","cost":-4,"payload":{"v":"Peg Leg"}}') $b$, 'PACT: drawbacks can''t be taken once creation is finished%');
select t('lock: …allowed when the DM switched rules.postLockDrawbacks on', 'allowed', 'pass', $b$
  select allow_post_lock(1);
  select owner_append('tb', '{"seq":4,"type":"buy","cat":"drawback","cost":-4,"payload":{"v":"Peg Leg"}}') $b$);
select t('lock: …and always on a draft', 'allowed', 'pass', $b$
  select owner_append('draft', '{"seq":4,"type":"buy","cat":"drawback","cost":-4,"payload":{"v":"Peg Leg"}}') $b$);
select t('lock: a DM imposing a drawback after the lock is not this rule''s business', 'allowed', 'pass', $b$
  select as_dm(); select dm_edit_character_log(chid('tb'), '[{"type":"buy","cat":"drawback","payload":{"v":"Peg Leg"},"cost":0}]') $b$);
select t('R2-2 (pre-existing, board fix/server-negative-cost-after-lock): a -1000 skill buy still lowers spend', 'allowed', 'pass', $b$
  select owner_append('ig3', '{"seq":3,"type":"buy","cat":"skill","cost":-1000,"payload":{"v":"Stealth"}}');
  select owner_append('ig3', '{"seq":4,"type":"buy","cat":"boon","cost":1000,"payload":{"v":"Lucky"}}') $b$);
select t('R2-7: a player-inserted campaign drops charHouseRules', 'allowed', 'fail', $b$
  select as_user('a0000000-0000-0000-0000-000000000001');
  insert into campaigns(id, dm_id, name, ignore_player_ap, rules) values ('c9000000-0000-0000-0000-000000000009','a0000000-0000-0000-0000-000000000001','mine',true,'{"charHouseRules":{"draws":{"Fake":{"ap":1000}}}}');
  select ok((select not (rules ? 'charHouseRules') from campaigns where id='c9000000-0000-0000-0000-000000000009'), 'stripped') $b$);
select t('R2-9 / F4: a garbage SEQ no longer blocks the DM''s RPC (next seq = max seq + 1)', 'allowed', 'fail', $b$
  select owner_upd('hold', $e$ jsonb_set(stats, '{SEQ}', '"abc"') $e$);
  select hr(1, null, jsonb_build_array(act('override', 'hold', '{"overrides":{}}')));
  select as_admin(); select ok(lastev('hold')->>'seq' = '10', 'seq ' || (lastev('hold')->>'seq')) $b$);
select t('F4: …nor dm_edit_character_log', 'allowed', 'fail', $b$
  select owner_upd('hold', $e$ jsonb_set(stats, '{SEQ}', '"abc"') $e$);
  select as_dm(); select dm_edit_character_log(chid('hold'), '[{"type":"buy","cat":"boon","payload":{"v":"Bulwark"},"cost":6},{"type":"award","amount":6}]') $b$);
select t('F3: a purchase stored with seq 5.0 is matched like the engine matches it (String(5.0) = "5")', 'allowed', 'fail', $b$
  select ok(split('[{"type":"buy","cat":"boon","payload":{"v":"B"},"cost":4,"seq":5.0},{"type":"dmRefundBoon","refVal":"B","targetSeq":5,"cost":-4,"dmEdit":true}]') = '[0, 0, 0]', 'refund matched');
  select ok(split('[{"type":"buy","cat":"drawback","payload":{"v":"Slow to Mend"},"cost":-5,"seq":5},{"type":"buyoff","refVal":"Slow to Mend","targetSeq":5.0,"cost":15}]') = '[15, 0, 0]', 'buyoff netted');
  select ok(pact_js_key('5.0') = '5' and pact_js_key('1.50') = '1.5' and pact_js_key('"7"') = '7', 'keys') $b$);
select t('R2-3: a negative-cost buyoff (cancelling nothing) is refused — it has no targetSeq', 'refused', 'fail', $b$
  select owner_append('ig3', '{"seq":3,"type":"buyoff","refVal":"Nothing","cost":-1000}');
  select owner_append('ig3', '{"seq":4,"type":"buy","cat":"boon","cost":1000,"payload":{"v":"Lucky"}}') $b$, 'PACT: a buy-off must name%');
select t('R2-4 (pre-existing, board fix/server-negative-cost-after-lock): a -1000 names event in one save still lowers spend', 'allowed', 'pass', $b$
  select owner_upd('ig3', $e$ jsonb_set(stats, '{LOG}', (stats->'LOG') || '[{"seq":3,"type":"names","cost":-1000},{"seq":4,"type":"buy","cat":"boon","cost":1000,"payload":{"v":"Lucky"}}]'::jsonb) $e$) $b$);
select t('KNOWN GAP R2-6 (residual risk, board follow-up): a pin forged while solo with the target campaign''s id survives joining', 'allowed', 'fail', $b$
  select as_admin(); update characters set campaign_id = null where name = 'ig3';
  select owner_upd('ig3', $e$ jsonb_set(stats, '{LOG}', (stats->'LOG') || '[{"seq":3,"type":"dmHouseRules","dmEdit":true,"campaignId":"c1000000-0000-0000-0000-000000000002","overrides":{"pins":{"draws":{"Fake":{"ap":1000}}}}},{"seq":4,"type":"buy","cat":"drawback","cost":-1000,"payload":{"v":"Fake"}}]'::jsonb) $e$);
  select as_admin(); update characters set campaign_id = camp(2) where name = 'ig3';
  select owner_append('ig3', '{"seq":5,"type":"buy","cat":"boon","cost":1000,"payload":{"v":"Lucky"}}') $b$);
-- =====================================================================================================================
-- 12. PR #654 round 3
-- =====================================================================================================================
select t('round 3: a buyoff whose targetSeq names nothing (999) is refused', 'refused', 'fail', $b$
  select as_admin(); update characters set ap = 50 where name = 'tb';
  select owner_append('tb', '{"seq":4,"type":"buyoff","refVal":"Slow to Mend","targetSeq":999,"cost":15}') $b$, 'PACT: that buy-off names seq 999%');
select t('round 3: …targetSeq true', 'refused', 'fail', $b$
  select as_admin(); update characters set ap = 50 where name = 'tb';
  select owner_append('tb', '{"seq":4,"type":"buyoff","refVal":"Slow to Mend","targetSeq":true,"cost":15}') $b$, 'PACT: that buy-off names seq true%');
select t('round 3: …targetSeq of a different, already-closed copy (boff: seq 2 was bought off; the open copy is seq 5)', 'refused', 'fail', $b$
  select as_admin(); update characters set ap = 50 where name = 'boff';
  select owner_append('boff', '{"seq":9,"type":"buyoff","refVal":"Squeamish","targetSeq":2,"cost":6}') $b$, 'PACT: that buy-off names seq 2, but it cancels the Squeamish at seq 5%');
select t('round 3: …and the right seq (5) is accepted', 'allowed', 'pass', $b$
  select as_admin(); update characters set ap = 50 where name = 'boff';
  select owner_append('boff', '{"seq":9,"type":"buyoff","refVal":"Squeamish","targetSeq":5,"cost":6}') $b$);
select t('round 3: a stale (too low) SEQ can''t make the RPC reuse a seq the LOG already has', 'allowed', 'fail', $b$
  select owner_upd('hold', $e$ jsonb_set(stats, '{SEQ}', '3') $e$);
  select hr(1, null, jsonb_build_array(act('override', 'hold', '{"overrides":{}}')));
  select as_admin(); select ok(lastev('hold')->>'seq' = '10', 'seq ' || (lastev('hold')->>'seq')) $b$);
-- =====================================================================================================================
-- PR #658 review: two DMs at once — optimistic concurrency on the campaign rules and on a character's override snapshot
-- =====================================================================================================================
create or replace function hrx(p_camp int, p_chr jsonb, p_actions jsonb, p_expected jsonb) returns jsonb language plpgsql as $$
begin
  perform as_dm();
  return dm_apply_house_rules_change(camp(p_camp), p_chr, p_actions, p_expected);
end $$;
select t('concurrency: expected = the stored rules is accepted', 'allowed', 'fail', $b$
  select hr(1, '{"draws":{"Hexed":{"ap":3}}}', '[]');
  select hrx(1, '{"draws":{"Hexed":{"ap":4}}}', '[]', '{"charHouseRules":{"draws":{"Hexed":{"ap":3}}}}');
  select ok((select rules->'charHouseRules'->'draws'->'Hexed'->>'ap' = '4' from campaigns where id = camp(1)), 'stored') $b$);
select t('concurrency: a stale expected (another DM saved meanwhile) is refused', 'refused', 'fail', $b$
  select hr(1, '{"draws":{"Hexed":{"ap":5}}}', '[]');
  select hrx(1, '{"draws":{"Hexed":{"ap":4}}}', '[]', '{"charHouseRules":{"draws":{"Hexed":{"ap":3}}}}') $b$, '%another DM changed this campaign%');
select t('concurrency: expected null = "none stored yet" is accepted on a campaign without rules', 'allowed', 'fail', $b$
  select hrx(1, '{"draws":{"Hexed":{"ap":4}}}', '[]', '{"charHouseRules":null}') $b$);
select t('concurrency: expected null is refused once another DM stored rules', 'refused', 'fail', $b$
  select hr(1, '{}', '[]'); select hrx(1, '{"draws":{"Hexed":{"ap":4}}}', '[]', '{"charHouseRules":null}') $b$, '%another DM changed this campaign%');
select t('concurrency: a malformed expected is refused', 'refused', 'fail', $b$
  select hrx(1, '{}', '[]', '{"rules":{}}') $b$, '%p_expected must be%');
select t('concurrency: an override whose expected = the latest snapshot is accepted', 'allowed', 'fail', $b$
  select hr(1, null, jsonb_build_array(act('override', 'hold', '{"overrides":{"boons":{"Bulwark":{"hd":1,"ap":2}}}}')));
  select hr(1, null, jsonb_build_array(act('override', 'hold', '{"overrides":{"boons":{"Bulwark":{"hd":1,"ap":1}}},"expected":{"boons":{"Bulwark":{"ap":2,"hd":1}}}}'))) $b$);
select t('concurrency: an override built from a stale snapshot is refused', 'refused', 'fail', $b$
  select hr(1, null, jsonb_build_array(act('override', 'hold', '{"overrides":{"boons":{"Bulwark":{"hd":1,"ap":2}}}}')));
  select hr(1, null, jsonb_build_array(act('override', 'hold', '{"overrides":{},"expected":{}}'))) $b$, '%another DM changed this character%');
select t('concurrency: expected null on a character that has no override for this campaign is accepted', 'allowed', 'fail', $b$
  select hr(1, null, jsonb_build_array(act('override', 'draft', '{"overrides":{},"expected":null}'))) $b$);
select as_admin();
-- =====================================================================================================================
-- Merge with #649 (feat/dm-ap-discount, 2026-10-13-dm-ap-discount.sql — APPLIED). This migration redefines three functions
-- #649 changed (dm_edit_character_log, pact_ap_ledger_protected, pact_enforce_ap_budget_consistency) plus #649's
-- pact_ap_ledger_discount; each must keep #649's discount handling, or applying it would silently undo #649. And a boon
-- refunded after a discount must not be credited twice: the refund nets to frozen cost MINUS the discount.
-- 'hold': awards 79+12, drawbacks 5+2 => spendable 98 (ap 0); spent 6 (Alertness, seq 2) + 12 + 1 = 19.
-- =====================================================================================================================
create or replace function disc(p_char text, p_seq int, p_cat text, p_amt int) returns jsonb language plpgsql as $$
begin
  perform as_dm();
  return dm_edit_character_log(chid(p_char), jsonb_build_array(jsonb_build_object('type', 'dmDiscount', 'targetSeq', p_seq,
    'targetCat', p_cat, 'amount', p_amt, 'note', 'merge case')));
end $$;
select t('#649 kept: a DM discount is still written through dm_edit_character_log', 'allowed', 'pass', $b$
  select disc('hold', 2, 'boon', 2);
  select ok(lastev('hold')->>'type' = 'dmDiscount' and lastev('hold')->'dmEdit' = 'true'::jsonb and (lastev('hold')->>'amount')::int = 2, 'stamped') $b$);
select t('#649 kept: dm_edit_character_log still refuses a discount above the purchase''s cost', 'refused', 'pass', $b$
  select disc('hold', 2, 'boon', 7) $b$, '%allowed 0 to%');
select t('#649 kept: dmDiscount is still a protected (frozen) type', 'allowed', 'pass', $b$
  select ok(jsonb_array_length(pact_ap_ledger_protected('[{"type":"dmDiscount","targetSeq":2,"targetCat":"boon","amount":1}]')) = 1, 'protected') $b$);
select t('#649 kept: the budget check counts a DM discount (an 80 AP buy fits only with the 2 AP discount)', 'allowed', 'pass', $b$
  select disc('hold', 2, 'boon', 2);
  select owner_append('hold', '{"seq":20,"type":"buy","cat":"skill","cost":80,"payload":{"v":"Arcana"}}') $b$);
select t('#649 kept: …and without the discount the same 80 AP buy is over budget', 'refused', 'pass', $b$
  select owner_append('hold', '{"seq":20,"type":"buy","cat":"skill","cost":80,"payload":{"v":"Arcana"}}') $b$, '%over AP budget%');
select t('discount x refund: the refunded boon''s discount stops counting (refund nets 6 - 2 = 4)', 'allowed', 'fail', $b$
  select disc('hold', 2, 'boon', 2);
  select ok(pact_ap_ledger_discount(logof('hold')) = 2, 'discount before');
  select hr(1, null, jsonb_build_array(act('refundBoon', 'hold', '{"name":"Alertness","targetSeq":2}')));
  select ok(pact_ap_ledger_discount(logof('hold')) = 0, 'discount after the refund');
  select ok((splitc('hold')->>0)::numeric = 13, 'spent 19 - 6') $b$);
select t('discount x refund: no double credit at the budget check (an 87 AP buy is over by 2)', 'refused', 'fail', $b$
  select disc('hold', 2, 'boon', 2);
  select hr(1, null, jsonb_build_array(act('refundBoon', 'hold', '{"name":"Alertness","targetSeq":2}')));
  select owner_append('hold', '{"seq":30,"type":"buy","cat":"skill","cost":87,"payload":{"v":"Arcana"}}') $b$, '%over AP budget%');
select t('discount x refund: …an 85 AP buy fits exactly (98 spendable, 13 + 85 spent)', 'allowed', 'fail', $b$
  select disc('hold', 2, 'boon', 2);
  select hr(1, null, jsonb_build_array(act('refundBoon', 'hold', '{"name":"Alertness","targetSeq":2}')));
  select owner_append('hold', '{"seq":30,"type":"buy","cat":"skill","cost":85,"payload":{"v":"Arcana"}}') $b$);
select t('discount x refund: a discount on a boon the DM already refunded is refused', 'refused', 'fail', $b$
  select hr(1, null, jsonb_build_array(act('refundBoon', 'hold', '{"name":"Alertness","targetSeq":2}')));
  select disc('hold', 2, 'boon', 1) $b$, '%was refunded by the DM%');
select t('discount x refund: …a correction (negative) on it is refused too', 'refused', 'fail', $b$
  select disc('hold', 2, 'boon', 2);
  select hr(1, null, jsonb_build_array(act('refundBoon', 'hold', '{"name":"Alertness","targetSeq":2}')));
  select disc('hold', 2, 'boon', -2) $b$, '%was refunded by the DM%');
select as_admin();
