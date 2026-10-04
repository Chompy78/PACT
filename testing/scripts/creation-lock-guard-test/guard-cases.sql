\set QUIET on
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
-- helpers
create or replace function as_user(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true) $$;
create or replace function as_anon() returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true) $$;
create or replace function as_admin() returns void language sql as $$ select set_config('request.jwt.claims', '', true) $$;

truncate characters, character_backups, campaign_dms, campaigns cascade;
insert into campaigns(id, dm_id, name) values
 ('c1000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','Amble-like'),
 ('c2000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000002','Other table');
insert into campaign_dms values
 ('c1000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001'),
 ('c2000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000002');
-- LOCKED campaign char (lock in the middle, a purchase after it) / UNLOCKED campaign char / SOLO locked char
insert into characters(id, owner_id, campaign_id, name, stats) values
 ('aaaaaaaa-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','locked',
  '{"SEQ":6,"LOG":[{"seq":1,"type":"creationLockConfig","payload":{"threshold":72}},
                   {"seq":2,"type":"buy","cat":"patch","cost":5},
                   {"seq":3,"type":"creationLocked","systemEdit":true,"label":"Creation locked"},
                   {"seq":4,"type":"buy","cat":"feature","cost":4,"label":"after lock"},
                   {"seq":5,"type":"award","amount":10}]}'),
 ('aaaaaaaa-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','unlocked',
  '{"SEQ":3,"LOG":[{"seq":1,"type":"buy","cat":"patch","cost":5},{"seq":2,"type":"buy","cat":"feature","cost":4}]}'),
 ('aaaaaaaa-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000001',null,'solo',
  '{"SEQ":4,"LOG":[{"seq":1,"type":"buy","cat":"patch","cost":5},{"seq":2,"type":"creationLocked","label":"x"},{"seq":3,"type":"buy","cat":"feature","cost":4}]}');

-- shorthand: update the log of one char using jsonb path expressions on stats
-- locked char log indices: 0 cfg(thr72) 1 buy 2 LOCKED 3 buy 4 award
select t('P removes creationLocked', 'refused', $b$ select as_user('a0000000-0000-0000-0000-000000000001');
  update characters set stats = jsonb_set(stats,'{LOG}', (stats->'LOG') - 2) where name='locked' $b$);
select t('P changes the lock-config limit 72->99', 'refused', $b$ select as_user('a0000000-0000-0000-0000-000000000001');
  update characters set stats = jsonb_set(stats,'{LOG,0,payload,threshold}','99') where name='locked' $b$);
select t('P removes the limit entry', 'refused', $b$ select as_user('a0000000-0000-0000-0000-000000000001');
  update characters set stats = jsonb_set(stats,'{LOG}', (stats->'LOG') - 0) where name='locked' $b$);
select t('P appends creationUnlocked', 'refused', $b$ select as_user('a0000000-0000-0000-0000-000000000001');
  update characters set stats = jsonb_set(stats,'{LOG}', (stats->'LOG') || '[{"seq":6,"type":"creationUnlocked"}]') where name='locked' $b$);
select t('P appends a limit (threshold 50)', 'refused', $b$ select as_user('a0000000-0000-0000-0000-000000000001');
  update characters set stats = jsonb_set(stats,'{LOG}', (stats->'LOG') || '[{"seq":6,"type":"creationLockConfig","payload":{"threshold":50}}]') where name='locked' $b$);
select t('P appends a limit of null (threshold:null)', 'refused', $b$ select as_user('a0000000-0000-0000-0000-000000000001');
  update characters set stats = jsonb_set(stats,'{LOG}', (stats->'LOG') || '[{"seq":6,"type":"creationLockConfig","payload":{"threshold":null}}]') where name='locked' $b$);
select t('STALE SAVE: old log (no lock) over the newer row', 'refused', $b$ select as_user('a0000000-0000-0000-0000-000000000001');
  update characters set stats = '{"SEQ":3,"LOG":[{"seq":1,"type":"buy","cat":"patch","cost":5},{"seq":2,"type":"buy","cat":"feature","cost":4}]}' where name='locked' $b$);
select t('P appends creationLocked (Finish creating)', 'allowed', $b$ select as_user('a0000000-0000-0000-0000-000000000001');
  update characters set stats = jsonb_set(stats,'{LOG}', (stats->'LOG') || '[{"seq":3,"type":"creationLocked"}]') where name='unlocked' $b$);
select t('P appends arm-lock config (no threshold)', 'allowed', $b$ select as_user('a0000000-0000-0000-0000-000000000001');
  update characters set stats = jsonb_set(stats,'{LOG}', (stats->'LOG') || '[{"seq":3,"type":"creationLockConfig","payload":{}}]') where name='unlocked' $b$);
select t('P normal save: adds a purchase, lock untouched', 'allowed', $b$ select as_user('a0000000-0000-0000-0000-000000000001');
  update characters set stats = jsonb_set(stats,'{LOG}', (stats->'LOG') || '[{"seq":6,"type":"buy","cat":"feature","cost":2}]') where name='locked' $b$);
select t('P renames character (stats unchanged)', 'allowed', $b$ select as_user('a0000000-0000-0000-0000-000000000001');
  update characters set name='renamed' where name='locked' $b$);
select t('DM appends creationUnlocked (reopen)', 'allowed', $b$ select as_user('d0000000-0000-0000-0000-000000000001');
  update characters set stats = jsonb_set(stats,'{LOG}', (stats->'LOG') || '[{"seq":6,"type":"creationUnlocked"}]') where name='locked' $b$);
select t('DM appends a limit', 'allowed', $b$ select as_user('d0000000-0000-0000-0000-000000000001');
  update characters set stats = jsonb_set(stats,'{LOG}', (stats->'LOG') || '[{"seq":6,"type":"creationLockConfig","payload":{"threshold":60}}]') where name='locked' $b$);
select t('Another campaign''s DM appends creationUnlocked', 'refused', $b$ select as_user('d0000000-0000-0000-0000-000000000002');
  update characters set stats = jsonb_set(stats,'{LOG}', (stats->'LOG') || '[{"seq":6,"type":"creationUnlocked"}]') where name='locked' $b$);
select t('Stranger (not owner, not DM) removes the lock', 'refused', $b$ select as_user('99999999-0000-0000-0000-000000000009');
  update characters set stats = jsonb_set(stats,'{LOG}', (stats->'LOG') - 2) where name='locked' $b$);
select t('Anon API request (claims, no sub) removes the lock', 'refused', $b$ select as_anon();
  update characters set stats = jsonb_set(stats,'{LOG}', (stats->'LOG') - 2) where name='locked' $b$);
select t('Admin session (no claims) removes the lock', 'allowed', $b$ select as_admin();
  update characters set stats = jsonb_set(stats,'{LOG}', (stats->'LOG') - 2) where name='locked' $b$);
select t('SOLO character: owner removes own lock', 'allowed', $b$ select as_user('a0000000-0000-0000-0000-000000000001');
  update characters set stats = jsonb_set(stats,'{LOG}', (stats->'LOG') - 1) where name='solo' $b$);
select t('P moves a locked char to another campaign', 'allowed', $b$ select as_user('a0000000-0000-0000-0000-000000000001');
  update characters set campaign_id='c2000000-0000-0000-0000-000000000002' where name='locked' $b$);
select t('P moves a locked char, and also drops its lock', 'refused', $b$ select as_user('a0000000-0000-0000-0000-000000000001');
  update characters set campaign_id='c2000000-0000-0000-0000-000000000002', stats = jsonb_set(stats,'{LOG}', (stats->'LOG') - 2) where name='locked' $b$);
select t('P leaves campaign (solo) and keeps the lock', 'allowed', $b$ select as_user('a0000000-0000-0000-0000-000000000001');
  update characters set campaign_id = null where name='locked' $b$);
select t('STALE SAVE (realistic): older base + award kept, lock missing', 'refused', $b$ select as_user('a0000000-0000-0000-0000-000000000001');
  update characters set stats = '{"SEQ":6,"LOG":[{"seq":1,"type":"creationLockConfig","payload":{"threshold":72}},{"seq":2,"type":"buy","cat":"patch","cost":5},{"seq":4,"type":"buy","cat":"feature","cost":4,"label":"after lock"},{"seq":5,"type":"award","amount":10}]}' where name='locked' $b$);
\set QUIET off
select n, verdict, expect, got, name from res order by n;
