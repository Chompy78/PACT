\set QUIET on
-- fix/server-player-award-after-lock — cases. Expectations are the AFTER-migration truth. Run BEFORE the migration, the
-- player-award attacks show FAIL ('allowed' instead of 'refused'): that is the gap. Built on schema.sql + rls-policies.sql +
-- 2026-09-03-dm-zero-player-ap.sql, so the REAL dm_edit_character_log, award_ap, award_ap_and_seal, dm_zero_player_ap,
-- pact_enforce_ap_budget_consistency and pact_enforce_locked_history all run alongside the rule under test.
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
    elsif sqlerrm like 'PACT: this character''s creation is finished%' or sqlerrm like 'PACT: this campaign''s DM has switched off%'
       or sqlerrm like 'PACT: an AP award amount must be a number%' then g := 'refused';
    else g := 'ERROR: ' || sqlerrm; end if;
  end;
  insert into res(name, expect, got, verdict) values (p_name, p_expect, g, case when g = p_expect then 'PASS' else 'FAIL' end);
end $$;
create or replace function as_user(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true) $$;
create or replace function as_admin() returns void language sql as $$ select set_config('request.jwt.claims', '', true) $$;
-- the character's OWNER rewrites its stats with a jsonb expression (one player per character: a player may hold one per campaign)
create or replace function owner_upd(p_name text, p_expr text) returns void language plpgsql as $$
begin
  perform as_user((select owner_id from characters where name = p_name));
  execute format('update characters set stats = %s where name = %L', p_expr, p_name);
end $$;
-- append one event to a character's LOG, as the owner
create or replace function owner_append(p_name text, p_ev text) returns void language plpgsql as $$
begin
  perform owner_upd(p_name, format($f$ jsonb_set(stats, '{LOG}', (stats->'LOG') || %L::jsonb) $f$, p_ev));
end $$;
create or replace function as_dm() returns void language sql as $$ select as_user('d0000000-0000-0000-0000-000000000001') $$;

select as_admin();
truncate characters, character_backups, campaign_dms, campaigns cascade;
-- c…01 does NOT ignore player AP (the gap); c…02 does (the live campaign's setting).
insert into campaigns(id, dm_id, name, ignore_player_ap) values
 ('c1000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','Open', false),
 ('c1000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','Ignores', true);
insert into campaign_dms(campaign_id, dm_id) select id, 'd0000000-0000-0000-0000-000000000001' from campaigns on conflict do nothing;

-- LOCKED: CharGen creation with its noLock Budget singleton BEFORE the lock (79 AP), 70 spent.
insert into characters(owner_id, campaign_id, name, kind, ap, stats) values
 ('a0000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','locked','chargen',0,
  '{"SEQ":6,"LOG":[
    {"seq":1,"type":"name","name":"locked"},
    {"seq":2,"type":"award","amount":79,"note":"Budget","noLock":true},
    {"seq":3,"type":"buy","cat":"boon","cost":70,"payload":{"v":"Alertness"},"noLock":true},
    {"seq":4,"type":"creationLocked"},
    {"seq":5,"type":"buy","cat":"skill","cost":1,"payload":{"v":"Stealth"}}]}'),
-- LIVE SHAPE: the Budget singleton (77) already sits AFTER the lock (relocated by an earlier filter-and-append).
 ('a0000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000001','tail77','chargen',0,
  '{"SEQ":5,"LOG":[
    {"seq":1,"type":"buy","cat":"boon","cost":70,"payload":{"v":"Alertness"},"noLock":true},
    {"seq":2,"type":"creationLocked"},
    {"seq":3,"type":"name","name":"tail77"},
    {"seq":4,"type":"award","amount":77,"note":"Budget","noLock":true}]}'),
-- PRE-LOCK campaign character: budget still the player's to set.
 ('a0000000-0000-0000-0000-000000000003','c1000000-0000-0000-0000-000000000001','prelock','chargen',0,
  '{"SEQ":3,"LOG":[{"seq":1,"type":"award","amount":79,"note":"Budget","noLock":true},{"seq":2,"type":"buy","cat":"boon","cost":6,"payload":{"v":"Alertness"},"noLock":true}]}'),
-- REOPENED by the DM: creationLocked then creationUnlocked.
 ('a0000000-0000-0000-0000-000000000004','c1000000-0000-0000-0000-000000000001','reopened','chargen',0,
  '{"SEQ":4,"LOG":[{"seq":1,"type":"award","amount":79,"note":"Budget","noLock":true},{"seq":2,"type":"creationLocked"},{"seq":3,"type":"creationUnlocked"}]}'),
-- SEALED by the DM, never creation-locked (a Live-Sheet-started character).
 ('a0000000-0000-0000-0000-000000000005','c1000000-0000-0000-0000-000000000001','sealed','livesheet',10,
  '{"SEQ":3,"LOG":[{"seq":1,"type":"buy","cat":"skill","cost":1,"payload":{"v":"Stealth"}},{"seq":2,"type":"sessionSeal","note":"S1"}]}'),
-- SOLO locked character.
 ('a0000000-0000-0000-0000-000000000006',null,'solo','chargen',0,
  '{"SEQ":4,"LOG":[{"seq":1,"type":"award","amount":79,"note":"Budget","noLock":true},{"seq":2,"type":"creationLocked"},{"seq":3,"type":"buy","cat":"skill","cost":1,"payload":{"v":"Stealth"}}]}'),
-- IGNORE-player-AP campaign, locked, Budget 0 after the lock (live shape) and a pre-lock character there.
 ('a0000000-0000-0000-0000-000000000007','c1000000-0000-0000-0000-000000000002','ign_locked','chargen',50,
  '{"SEQ":4,"LOG":[{"seq":1,"type":"buy","cat":"boon","cost":6,"payload":{"v":"Alertness"},"noLock":true},{"seq":2,"type":"creationLocked"},{"seq":3,"type":"award","amount":0,"note":"Budget","noLock":true}]}'),
 ('a0000000-0000-0000-0000-000000000008','c1000000-0000-0000-0000-000000000002','ign_prelock','chargen',50,
  '{"SEQ":2,"LOG":[{"seq":1,"type":"award","amount":10,"note":"Budget","noLock":true}]}'),
-- PLANTED: a locked campaign character whose stored LOG already carries a string "NaN" award from before the lock (inserted
-- directly; only UPDATEs are guarded). NaN makes every award sum NaN, disarming the budget check and the ceiling.
 ('a0000000-0000-0000-0000-000000000009','c1000000-0000-0000-0000-000000000001','nanplant','chargen',0,
  '{"SEQ":4,"LOG":[{"seq":1,"type":"award","amount":"NaN","note":"Budget","noLock":true},{"seq":2,"type":"creationLocked"},{"seq":3,"type":"buy","cat":"skill","cost":1,"payload":{"v":"Stealth"}}]}');

-- ===== ATTACKS: a player adds AP to a finished campaign character (refused after; allowed today) =====
select t('player appends a plain award after the lock', 'refused', $b$ select owner_append('locked', '{"seq":6,"type":"award","amount":500,"note":"mine"}') $b$);
select t('player appends an award AND spends it in one save', 'refused', $b$ select owner_upd('locked', $e$ jsonb_set(stats,'{LOG}', (stats->'LOG') || '[{"seq":6,"type":"award","amount":500},{"seq":7,"type":"buy","cat":"boon","cost":400,"payload":{"v":"Lucky"}}]'::jsonb) $e$) $b$);
select t('player appends a noLock award after the lock', 'refused', $b$ select owner_append('locked', '{"seq":6,"type":"award","amount":40,"note":"Budget","noLock":true}') $b$);
select t('player appends a disc award after the lock', 'refused', $b$ select owner_append('locked', '{"seq":6,"type":"award","amount":40,"disc":true}') $b$);
select t('player redeems a grant code (grantId award) after the lock (H2)', 'refused', $b$ select owner_append('locked', '{"seq":6,"type":"award","amount":10,"note":"Session 3","grantId":"lx1abcd"}') $b$);
select t('player forges a dmEdit:true award after the lock', 'refused', $b$ select owner_append('locked', '{"seq":6,"type":"award","amount":40,"dmEdit":true,"dmId":"d0000000-0000-0000-0000-000000000001"}') $b$);
select t('player raises the after-lock Budget singleton 77 -> 177', 'refused', $b$ select owner_upd('tail77', $e$ jsonb_set(stats,'{LOG,3,amount}','177') $e$) $b$);
select t('player relocates the after-lock Budget past a new buy AND raises it 77 -> 99', 'refused', $b$ select owner_upd('tail77', $e$ jsonb_set(stats,'{LOG}', (select jsonb_agg(e order by o) from jsonb_array_elements(stats->'LOG') with ordinality x(e,o) where e->>'type'<>'award') || '[{"seq":5,"type":"buy","cat":"skill","cost":1,"payload":{"v":"Arcana"}},{"seq":6,"type":"award","amount":99,"note":"Budget","noLock":true}]'::jsonb) $e$) $b$);
select t('player appends an award on a SEALED (not locked) character', 'refused', $b$ select owner_append('sealed', '{"seq":3,"type":"award","amount":20}') $b$);
select t('player swaps a 79 award for two that sum higher', 'refused', $b$ select owner_upd('locked', $e$ jsonb_set(stats,'{LOG}', (stats->'LOG') || '[{"seq":6,"type":"award","amount":-79,"noLock":true},{"seq":7,"type":"award","amount":100,"noLock":true}]'::jsonb) $e$) $b$);

-- ===== award amounts that are not JSON numbers (review hardening) =====
select t('pre-lock: player appends an award with amount "NaN" (string)', 'refused', $b$ select owner_append('prelock', '{"seq":3,"type":"award","amount":"NaN"}') $b$);
select t('pre-lock: player appends an award with amount "500" (string)', 'refused', $b$ select owner_append('prelock', '{"seq":3,"type":"award","amount":"500"}') $b$);
select t('pre-lock: player appends an award with amount "Infinity" (string)', 'refused', $b$ select owner_append('prelock', '{"seq":3,"type":"award","amount":"Infinity"}') $b$);
select t('planted NaN, locked: player appends a 500 award', 'refused', $b$ select owner_append('nanplant', '{"seq":4,"type":"award","amount":500}') $b$);
select t('planted NaN, locked: player spends 1000 AP it never had', 'refused', $b$ select owner_append('nanplant', '{"seq":4,"type":"buy","cat":"boon","cost":1000,"payload":{"v":"Lucky"}}') $b$);
select t('DM boon grant whose award amount is a string', 'refused', $b$ select as_dm(); select dm_edit_character_log((select id from characters where name='locked'), '[{"type":"buy","cat":"boon","payload":{"v":"Lucky"},"cost":12},{"type":"award","amount":"12","note":"DM boon grant"}]'::jsonb) $b$);
select t('solo character: a string amount is not this rule''s business', 'allowed', $b$ select owner_append('solo', '{"seq":4,"type":"award","amount":"5"}') $b$);
select t('locked: an award with NO amount (counts 0) is allowed', 'allowed', $b$ select owner_append('locked', '{"seq":6,"type":"award","note":"empty"}') $b$);

-- ===== LEGITIMATE: must stay allowed =====
-- (Relocating a Budget singleton that sits BEFORE the lock is refused by pact_enforce_locked_history's D2 freeze, not by this rule; CharGen does not attempt it.)
select t('CharGen filter-and-append: after-lock Budget 77 moved past a new buy (same amount)', 'allowed', $b$ select owner_upd('tail77', $e$ jsonb_set(stats,'{LOG}', (select jsonb_agg(e order by o) from jsonb_array_elements(stats->'LOG') with ordinality x(e,o) where e->>'type'<>'award') || '[{"seq":5,"type":"buy","cat":"skill","cost":1,"payload":{"v":"Arcana"}},{"seq":6,"type":"award","amount":77,"note":"Budget","noLock":true,"label":"Award — budget (77 AP)"}]'::jsonb) $e$) $b$);
select t('77-after-lock character: unchanged re-save', 'allowed', $b$ select owner_upd('tail77', $e$ stats || '{"name":"tail77"}'::jsonb $e$) $b$);
select t('77-after-lock character: singleton re-synced (new seq/ts/label, same 77)', 'allowed', $b$ select owner_upd('tail77', $e$ jsonb_set(stats,'{LOG,3}', '{"seq":9,"ts":123,"type":"award","amount":77,"note":"Budget","noLock":true,"label":"Award — budget (77 AP)"}'::jsonb) $e$) $b$);
select t('77-after-lock character: buys a skill within budget', 'allowed', $b$ select owner_append('tail77', '{"seq":5,"type":"buy","cat":"skill","cost":1,"payload":{"v":"Arcana"}}') $b$);
select t('player LOWERS the after-lock Budget 77 -> 70', 'allowed', $b$ select owner_upd('tail77', $e$ jsonb_set(stats,'{LOG,3,amount}','70') $e$) $b$);
select t('locked character: ordinary in-play buy', 'allowed', $b$ select owner_append('locked', '{"seq":6,"type":"buy","cat":"skill","cost":1,"payload":{"v":"Arcana"}}') $b$);
select t('pre-lock campaign character: player raises the Budget', 'allowed', $b$ select owner_upd('prelock', $e$ jsonb_set(stats,'{LOG,0,amount}','90') $e$) $b$);
select t('pre-lock: budget raise and Finish creating in ONE save', 'allowed', $b$ select owner_upd('prelock', $e$ jsonb_set(jsonb_set(stats,'{LOG,0,amount}','90'),'{LOG}', (jsonb_set(stats,'{LOG,0,amount}','90')->'LOG') || '[{"seq":3,"type":"creationLocked"}]'::jsonb) $e$) $b$);
select t('DM-reopened character: player raises the Budget', 'allowed', $b$ select owner_upd('reopened', $e$ jsonb_set(stats,'{LOG,0,amount}','90') $e$) $b$);
select t('solo locked character: player appends an award', 'allowed', $b$ select owner_append('solo', '{"seq":4,"type":"award","amount":20}') $b$);
select t('DM boon grant on a locked character (dm_edit_character_log)', 'allowed', $b$ select as_dm(); select dm_edit_character_log((select id from characters where name='locked'), '[{"type":"buy","cat":"boon","payload":{"v":"Lucky"},"cost":12,"label":"Boon — Lucky (DM granted)"},{"type":"award","amount":12,"note":"DM boon grant","label":"Award — DM boon grant (12 AP)"}]'::jsonb) $b$);
select t('DM boon grant on a SEALED character', 'allowed', $b$ select as_dm(); select dm_edit_character_log((select id from characters where name='sealed'), '[{"type":"buy","cat":"boon","payload":{"v":"Lucky"},"cost":12},{"type":"award","amount":12,"note":"DM boon grant"}]'::jsonb) $b$);
select t('DM award_ap on a locked character (ap column)', 'allowed', $b$ select as_dm(); select award_ap((select id from characters where name='locked'), 25, 'session 2') $b$);
select t('DM award_ap_and_seal on a locked character', 'allowed', $b$ select as_dm(); select award_ap_and_seal((select id from characters where name='locked'), 25, 'session 2', 'idem-1') $b$);
select t('DM zeroes player AP on a locked character (dm_zero_player_ap)', 'allowed', $b$ select as_dm(); select dm_zero_player_ap((select id from characters where name='locked')) $b$);
select t('player re-saves after a DM boon grant (DM award kept)', 'allowed', $b$ select as_dm(); select dm_edit_character_log((select id from characters where name='locked'), '[{"type":"buy","cat":"boon","payload":{"v":"Lucky"},"cost":12},{"type":"award","amount":12,"note":"DM boon grant"}]'::jsonb); select owner_upd('locked', $e$ stats || '{"name":"x"}'::jsonb $e$) $b$);
select t('ignore campaign, locked: Budget 0 after the lock re-synced (live shape)', 'allowed', $b$ select owner_upd('ign_locked', $e$ jsonb_set(stats,'{LOG,2}', '{"seq":7,"type":"award","amount":0,"note":"Budget","noLock":true}'::jsonb) $e$) $b$);
select t('ignore campaign, locked: ordinary in-play buy within DM AP', 'allowed', $b$ select owner_append('ign_locked', '{"seq":4,"type":"buy","cat":"skill","cost":1,"payload":{"v":"Arcana"}}') $b$);

-- ===== ignore_player_ap: refused before AND after (2026-09-03 rule, unchanged in scope) =====
select t('ignore campaign, pre-lock: player raises the Budget', 'refused', $b$ select owner_upd('ign_prelock', $e$ jsonb_set(stats,'{LOG,0,amount}','90') $e$) $b$);
select t('ignore campaign, locked: player appends an award', 'refused', $b$ select owner_append('ign_locked', '{"seq":4,"type":"award","amount":30}') $b$);
-- the forged-dmEdit hole in the 2026-09-03 rule (its own header called it a known limit): refused after
select t('ignore campaign, pre-lock: player forges a dmEdit:true award', 'refused', $b$ select owner_append('ign_prelock', '{"seq":2,"type":"award","amount":40,"dmEdit":true}') $b$);
select as_admin();
