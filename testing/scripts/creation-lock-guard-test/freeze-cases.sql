\set QUIET on
-- Server freeze, stage 1 (D2 + E1) — cases. Expectations are the AFTER-migration truth. Run BEFORE the migration the attacks show FAIL (that is the point: the hole exists today).
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
    elsif sqlerrm like '%locked character history%' then g := 'refused';
    else g := 'ERROR: ' || sqlerrm; end if;
  end;
  insert into res(name, expect, got, verdict) values (p_name, p_expect, g, case when g = p_expect then 'PASS' else 'FAIL' end);
end $$;
create or replace function as_user(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true) $$;
create or replace function as_admin() returns void language sql as $$ select set_config('request.jwt.claims', '', true) $$;

truncate characters, character_backups, campaign_dms, campaigns cascade;
insert into campaigns(id, dm_id, name) values ('c1000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','Amble-like');
insert into campaign_dms values ('c1000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001');
-- owner a…01; campaign c1…01; DM d…01
-- LOCKED, no seal, no award. Indices: 0 cfg · 1 hd patch · 2 appearance · 3 houseRules · 4 skill · 5 stats patch · 6 traditions patch (temp-exempt)
-- · 7 MIXED (hd + appearance) · 8 creationLocked · 9 post-lock buy
insert into characters(id, owner_id, campaign_id, name, stats) values
 ('aaaaaaaa-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','lockedA',
  '{"SEQ":11,"LOG":[
    {"seq":1,"type":"creationLockConfig","payload":{"threshold":80}},
    {"seq":2,"type":"buy","cat":"patch","cost":5,"_slot":"hdProf","level":3,"payload":{"patch":{"hd":3,"profBonus":2}}},
    {"seq":3,"type":"buy","cat":"patch","cost":0,"payload":{"patch":{"appearance":{"eyes":"blue"}}}},
    {"seq":4,"type":"buy","cat":"patch","cost":0,"payload":{"patch":{"houseRules":{"a":1}}}},
    {"seq":5,"type":"buy","cat":"skill","cost":1,"payload":{"v":"Stealth"}},
    {"seq":6,"type":"buy","cat":"patch","cost":13,"payload":{"patch":{"stats":{"STR":14,"DEX":10}}}},
    {"seq":7,"type":"buy","cat":"patch","cost":2,"payload":{"patch":{"traditions":[{"name":"Primal"}]}}},
    {"seq":8,"type":"buy","cat":"patch","cost":3,"payload":{"patch":{"hd":4,"appearance":{"eyes":"green"}}}},
    {"seq":9,"type":"creationLocked"},
    {"seq":10,"type":"buy","cat":"hd","cost":3,"payload":{"to":5}}]}');
-- helper: the owner updates lockedA's stats with a jsonb expression
create or replace function owner_upd(p_name text, p_expr text) returns void language plpgsql as $$
begin
  perform as_user('a0000000-0000-0000-0000-000000000001');
  execute format('update characters set stats = %s where name = %L', p_expr, p_name);
end $$;

-- ===== ATTACKS (refused after the migration; allowed today) =====
select t('E1  lower Hit Dice inside a creation-era priced patch event', 'refused', $b$ select owner_upd('lockedA', $e$ jsonb_set(stats,'{LOG,1,payload,patch,hd}','2') $e$) $b$);
select t('E1  set a priced patch event''s stamped cost to 0', 'refused', $b$ select owner_upd('lockedA', $e$ jsonb_set(stats,'{LOG,1,cost}','0') $e$) $b$);
select t('E1  delete a priced patch event', 'refused', $b$ select owner_upd('lockedA', $e$ jsonb_set(stats,'{LOG}', (stats->'LOG') - 1) $e$) $b$);
select t('D2  delete a flat creation purchase after the lock (the refund route)', 'refused', $b$ select owner_upd('lockedA', $e$ jsonb_set(stats,'{LOG}', (stats->'LOG') - 4) $e$) $b$);
select t('E1  lower an ability score inside the stats patch', 'refused', $b$ select owner_upd('lockedA', $e$ jsonb_set(stats,'{LOG,5,payload,patch,stats,STR}','12') $e$) $b$);
select t('E1  set a protected field to null', 'refused', $b$ select owner_upd('lockedA', $e$ jsonb_set(stats,'{LOG,1,payload,patch,hd}','null') $e$) $b$);
select t('E1  delete one protected key from a patch (profBonus remains)', 'refused', $b$ select owner_upd('lockedA', $e$ jsonb_set(stats,'{LOG,1,payload,patch}', (stats->'LOG'->1->'payload'->'patch') - 'hd') $e$) $b$);
select t('E1  reorder two protected events (swap 1 and 5)', 'refused', $b$ select owner_upd('lockedA', $e$ jsonb_set(stats,'{LOG}', (select jsonb_agg(e order by case o when 2 then 6 when 6 then 2 else o end) from jsonb_array_elements(stats->'LOG') with ordinality x(e,o))) $e$) $b$);
select t('E1  turn a protected patch event into an unprotected type (list shrinks)', 'refused', $b$ select owner_upd('lockedA', $e$ jsonb_set(stats,'{LOG,1,type}','"note"') $e$) $b$);
select t('E1  replace a patch with a non-object (must not crash the trigger)', 'refused', $b$ select owner_upd('lockedA', $e$ jsonb_set(stats,'{LOG,1,payload,patch}','[]') $e$) $b$);
select t('E1  insert a NEW protected patch event in the middle (positions shift)', 'refused', $b$ select owner_upd('lockedA', $e$ jsonb_set(stats,'{LOG}', (select jsonb_agg(e order by o) from (select e, o from jsonb_array_elements(stats->'LOG') with ordinality x(e,o) union all select '{"seq":50,"type":"buy","cat":"patch","cost":9,"payload":{"patch":{"languages":3}}}'::jsonb, 3) y)) $e$) $b$);
select t('E1  change the stamped cost of a MIXED event (hd + appearance)', 'refused', $b$ select owner_upd('lockedA', $e$ jsonb_set(stats,'{LOG,7,cost}','0') $e$) $b$);
select t('E1  change the protected field of a MIXED event', 'refused', $b$ select owner_upd('lockedA', $e$ jsonb_set(stats,'{LOG,7,payload,patch,hd}','1') $e$) $b$);
select t('admin session (no claims) also cannot rewrite it — the trigger has never exempted admins', 'refused', $b$ select as_admin(); update characters set stats = jsonb_set(stats,'{LOG,1,payload,patch,hd}','2') where name='lockedA' $b$);
select t('a campaign DM updating the row directly cannot rewrite it either (DM routes are append-only)', 'refused', $b$ select as_user('d0000000-0000-0000-0000-000000000001'); update characters set stats = jsonb_set(stats,'{LOG,1,payload,patch,hd}','2') where name='lockedA' $b$);

-- Stage-aware: run with `psql -v tmpexp=refused` after stage 2 (the temporary exemption is gone); the default is stage 1, where those fields may still be rewritten.
\if :{?tmpexp}
\else
\set tmpexp allowed
\endif

-- ===== LEGITIMATE (allowed before and after) =====
select t('edit the appearance patch in place after the lock', 'allowed', $b$ select owner_upd('lockedA', $e$ jsonb_set(stats,'{LOG,2,payload,patch,appearance,eyes}','"red"') $e$) $b$);
select t('edit house rules in place after the lock', 'allowed', $b$ select owner_upd('lockedA', $e$ jsonb_set(stats,'{LOG,3,payload,patch,houseRules,a}','2') $e$) $b$);
select t('edit ONLY the appearance inside a mixed event (hd + appearance)', 'allowed', $b$ select owner_upd('lockedA', $e$ jsonb_set(stats,'{LOG,7,payload,patch,appearance,eyes}','"grey"') $e$) $b$);
select t('spellcasting (the stage-1 temporary exemption): rewritten after the lock — allowed at stage 1, refused at stage 2', :'tmpexp', $b$ select owner_upd('lockedA', $e$ jsonb_set(stats,'{LOG,6,payload,patch,traditions}','[{"name":"Divine"}]') $e$) $b$);
select t('append a new in-play purchase after the lock', 'allowed', $b$ select owner_upd('lockedA', $e$ jsonb_set(stats,'{LOG}', (stats->'LOG') || '[{"seq":11,"type":"buy","cat":"hd","cost":4,"payload":{"to":6},"gp":25,"days":7}]') $e$) $b$);
select t('undo the last in-play purchase (removal after the lock, before any seal)', 'allowed', $b$ select owner_upd('lockedA', $e$ jsonb_set(stats,'{LOG}', (stats->'LOG') - 9) $e$) $b$);
select t('rename the character (column only)', 'allowed', $b$ select as_user('a0000000-0000-0000-0000-000000000001'); update characters set name='renamed' where name='lockedA' $b$);
select t('a no-op save (stats unchanged)', 'allowed', $b$ select owner_upd('lockedA', 'stats') $b$);
select t('the DM appends a seal (append-only DM route shape)', 'allowed', $b$ select as_user('d0000000-0000-0000-0000-000000000001'); update characters set stats = jsonb_set(stats,'{LOG}', (stats->'LOG') || '[{"seq":11,"type":"sessionSeal","dmEdit":true}]') where name='lockedA' $b$);
select t('the DM appends an award', 'allowed', $b$ select as_user('d0000000-0000-0000-0000-000000000001'); update characters set stats = jsonb_set(stats,'{LOG}', (stats->'LOG') || '[{"seq":11,"type":"award","amount":6,"dmEdit":true}]') where name='lockedA' $b$);

-- ===== the lock lifecycle =====
insert into characters(id, owner_id, campaign_id, name, stats) values
 ('aaaaaaaa-0000-0000-0000-0000000000b1','a0000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','reopened',
  '{"SEQ":6,"LOG":[{"seq":1,"type":"creationLockConfig","payload":{"threshold":80}},{"seq":2,"type":"buy","cat":"patch","cost":5,"payload":{"patch":{"hd":3}}},{"seq":3,"type":"creationLocked"},{"seq":4,"type":"creationUnlocked","dmEdit":true}]}'),
 ('aaaaaaaa-0000-0000-0000-0000000000b2','a0000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','relocked',
  '{"SEQ":7,"LOG":[{"seq":1,"type":"creationLockConfig","payload":{"threshold":80}},{"seq":2,"type":"buy","cat":"patch","cost":5,"payload":{"patch":{"hd":3}}},{"seq":3,"type":"creationLocked"},{"seq":4,"type":"creationUnlocked","dmEdit":true},{"seq":5,"type":"creationLocked"}]}'),
 ('aaaaaaaa-0000-0000-0000-0000000000b3','a0000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','sealed-reopened',
  '{"SEQ":7,"LOG":[{"seq":1,"type":"creationLockConfig","payload":{"threshold":80}},{"seq":2,"type":"buy","cat":"patch","cost":5,"payload":{"patch":{"hd":3}}},{"seq":3,"type":"sessionSeal","dmEdit":true},{"seq":4,"type":"creationLocked"},{"seq":5,"type":"creationUnlocked","dmEdit":true}]}'),
 ('aaaaaaaa-0000-0000-0000-0000000000b4','a0000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','never-locked',
  '{"SEQ":4,"LOG":[{"seq":1,"type":"creationLockConfig","payload":{"threshold":80}},{"seq":2,"type":"buy","cat":"patch","cost":5,"payload":{"patch":{"hd":3}}},{"seq":3,"type":"buy","cat":"skill","cost":1,"payload":{"v":"Stealth"}}]}'),
 ('aaaaaaaa-0000-0000-0000-0000000000b5','a0000000-0000-0000-0000-000000000001',null,'solo-locked',
  '{"SEQ":4,"LOG":[{"seq":1,"type":"buy","cat":"patch","cost":5,"payload":{"patch":{"hd":3}}},{"seq":2,"type":"creationLocked"},{"seq":3,"type":"buy","cat":"skill","cost":1,"payload":{"v":"Stealth"}}]}'),
 ('aaaaaaaa-0000-0000-0000-0000000000b6','a0000000-0000-0000-0000-000000000001',null,'solo-sealed',
  '{"SEQ":5,"LOG":[{"seq":1,"type":"buy","cat":"patch","cost":5,"payload":{"patch":{"hd":3}}},{"seq":2,"type":"sessionSeal"},{"seq":3,"type":"buy","cat":"skill","cost":1,"payload":{"v":"Stealth"}}]}'),
 ('aaaaaaaa-0000-0000-0000-0000000000b7','a0000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','sealed-camp',
  '{"SEQ":7,"LOG":[{"seq":1,"type":"creationLockConfig","payload":{"threshold":80}},{"seq":2,"type":"buy","cat":"patch","cost":5,"payload":{"patch":{"hd":3}}},{"seq":3,"type":"buy","cat":"skill","cost":1,"payload":{"v":"Stealth"}},{"seq":4,"type":"sessionSeal","dmEdit":true},{"seq":5,"type":"buy","cat":"skill","cost":1,"payload":{"v":"Arcana"}}]}');
select t('a DM-REOPENED character (last unlock after last lock, no seal): the lock boundary is lifted — a creation purchase can be edited', 'allowed', $b$ select owner_upd('reopened', $e$ jsonb_set(stats,'{LOG,1,payload,patch,hd}','2') $e$) $b$);
select t('...and once RE-LOCKED the new lock freezes it again', 'refused', $b$ select owner_upd('relocked', $e$ jsonb_set(stats,'{LOG,1,payload,patch,hd}','2') $e$) $b$);
select t('a reopen does NOT lift a SEAL: a sealed-then-reopened character stays frozen', 'refused', $b$ select owner_upd('sealed-reopened', $e$ jsonb_set(stats,'{LOG,1,payload,patch,hd}','2') $e$) $b$);
select t('a character that was never locked and has no seal/award is unchanged (editable)', 'allowed', $b$ select owner_upd('never-locked', $e$ jsonb_set(stats,'{LOG,1,payload,patch,hd}','2') $e$) $b$);
select t('a SOLO locked character is not covered by the lock boundary (the owner decides)', 'allowed', $b$ select owner_upd('solo-locked', $e$ jsonb_set(stats,'{LOG,0,payload,patch,hd}','2') $e$) $b$);
select t('a SOLO sealed character is frozen by its seal (E1 applies to the seal boundary too)', 'refused', $b$ select owner_upd('solo-sealed', $e$ jsonb_set(stats,'{LOG,0,payload,patch,hd}','2') $e$) $b$);
select t('a SEALED campaign character: lowering Hit Dice in a patch event (the original hole)', 'refused', $b$ select owner_upd('sealed-camp', $e$ jsonb_set(stats,'{LOG,1,payload,patch,hd}','2') $e$) $b$);
select t('a SEALED campaign character: deleting a flat purchase after the seal is a post-seal undo (allowed)', 'allowed', $b$ select owner_upd('sealed-camp', $e$ jsonb_set(stats,'{LOG}', (stats->'LOG') - 4) $e$) $b$);

-- ===== one case per patch key =====
-- a locked character with one single-key patch event per key (the key's value is the string "v0"), then a lock; each case rewrites that one value.
create temp table keys(k text, cls text, expect text, i int);
insert into keys(k, cls, expect, i)
select k, cls, expect, row_number() over () from (values
  ('appearance','permanent','allowed'),('houseRules','permanent','allowed'),('gold','permanent','allowed'),
  ('traditions','temporary',:'tmpexp'),('innate','temporary',:'tmpexp'),('dabblerCantrips','temporary',:'tmpexp'),('martiallyBound','temporary',:'tmpexp'),
  ('originClass','temporary',:'tmpexp'),('originClass2','temporary',:'tmpexp'),('size','temporary',:'tmpexp'),('lineage','temporary',:'tmpexp'),
  ('species','temporary','refused'),('species2','temporary','refused'),   -- still refused: the existing species-freeze rule, independent of stage 1
  ('stats','protected','refused'),('hd','protected','refused'),('profBonus','protected','refused'),('languages','protected','refused'),('hardy','protected','refused'),
  ('tough','protected','refused'),('ki','protected','refused'),('sorcery','protected','refused'),('attune','protected','refused'),('armour','protected','refused'),
  ('wornArmour','protected','refused'),('weaponProf','protected','refused'),('freeSub','protected','refused'),('customProfs','protected','refused'),
  ('someFutureSlot','UNKNOWN (fail-closed)','refused')) v(k, cls, expect);
insert into characters(id, owner_id, campaign_id, name, stats)
select 'aaaaaaaa-0000-0000-0000-0000000000c1','a0000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','keys',
  jsonb_build_object('SEQ', 100, 'LOG',
    (select jsonb_agg(jsonb_build_object('seq', i, 'type','buy','cat','patch','cost',1,'payload',jsonb_build_object('patch', jsonb_build_object(k,'"v0"'::jsonb))) order by i) from keys)
    || jsonb_build_array(jsonb_build_object('seq', 99, 'type','creationLocked')));
do $$ declare r record; begin
  for r in select * from keys order by i loop
    perform t('key ' || r.k || ' (' || r.cls || '): rewrite its value after the lock', r.expect,
      format($f$ select owner_upd('keys', $e$ jsonb_set(stats,'{LOG,%s,payload,patch,%s}','"changed"') $e$) $f$, r.i - 1, r.k));
  end loop;
end $$;

\set QUIET off
select n, verdict, expect, got, name from res order by n;
select count(*) filter (where verdict = 'PASS') as passed, count(*) filter (where verdict = 'FAIL') as failed from res;
