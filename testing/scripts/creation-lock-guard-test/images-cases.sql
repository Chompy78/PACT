\set QUIET on
-- feat/character-images — storage policy cases (sql/migrations/2026-10-15-character-images.sql). Expectations are the
-- AFTER-migration truth. Built on the REAL fresh-install path (schema.sql + rls-policies.sql), so is_campaign_dm,
-- is_campaign_member and the characters table are the real ones.
--   got = 'yes'      the statement saw / changed at least one row
--   got = 'no'       it ran and touched nothing (RLS filtered the row out)
--   got = 'refused'  it raised a row-level-security error (an INSERT, or an UPDATE failing WITH CHECK)
-- Every statement runs inside a sub-transaction as role `authenticated` (or `anon`) with that user's JWT claims,
-- and is rolled back, so the cases are independent.
drop table if exists res; create table res(n serial, name text, expect text, got text, verdict text);
drop function if exists t(text,text,text,text);
create function t(p_name text, p_expect text, p_who text, p_body text) returns void language plpgsql as $$
declare g text; k int;
begin
  begin
    if p_who = 'anon' then
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      execute 'set local role anon';
    else
      perform set_config('request.jwt.claims', json_build_object('sub', p_who, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
    end if;
    execute p_body into k;
    raise exception 'RES:%', case when coalesce(k,0) > 0 then 'yes' else 'no' end;
  exception when others then
    if sqlerrm like 'RES:%' then g := substr(sqlerrm, 5);
    elsif sqlerrm like '%row-level security%' then g := 'refused';
    else g := 'ERROR: ' || sqlerrm; end if;
  end;
  insert into res(name, expect, got, verdict) values (p_name, p_expect, g, case when g = p_expect then 'PASS' else 'FAIL' end);
end $$;
-- statement shapes (each returns a count)
create or replace function rd(p_path text) returns text language sql as $$
  select format($q$select count(*)::int from storage.objects where bucket_id='character-images' and name=%L$q$, p_path) $$;
create or replace function ins(p_path text, p_bucket text default 'character-images') returns text language sql as $$
  select format($q$with x as (insert into storage.objects(bucket_id, name, metadata) values (%L, %L, '{"mimetype":"image/webp"}') returning 1) select count(*)::int from x$q$, p_bucket, p_path) $$;
create or replace function upd(p_path text) returns text language sql as $$
  select format($q$with x as (update storage.objects set metadata='{"mimetype":"image/jpeg"}' where bucket_id='character-images' and name=%L returning 1) select count(*)::int from x$q$, p_path) $$;
create or replace function mv(p_from text, p_to text) returns text language sql as $$
  select format($q$with x as (update storage.objects set name=%L where bucket_id='character-images' and name=%L returning 1) select count(*)::int from x$q$, p_to, p_from) $$;
create or replace function del(p_path text) returns text language sql as $$
  select format($q$with x as (delete from storage.objects where bucket_id='character-images' and name=%L returning 1) select count(*)::int from x$q$, p_path) $$;

-- people (auth.users rows are inserted by run-images.sh; profiles come from schema.sql's signup trigger)
--   d1 campaign owner/DM · d2 co-DM · p1 owns A · p2 plays B in the same campaign · p3 solo outsider
--   d3 DMs ANOTHER campaign · p5 plays in that other campaign
\set d1 '''d0000000-0000-0000-0000-000000000001'''
\set d2 '''d0000000-0000-0000-0000-000000000002'''
\set d3 '''d0000000-0000-0000-0000-000000000003'''
\set p1 '''a0000000-0000-0000-0000-000000000001'''
\set p2 '''a0000000-0000-0000-0000-000000000002'''
\set p3 '''a0000000-0000-0000-0000-000000000003'''
\set p5 '''a0000000-0000-0000-0000-000000000005'''
-- characters: A (p1, campaign C), B (p2, C), N (d1's NPC in C), X (p3 solo), Y (p5, campaign C2)
\set A 'aaaaaaaa-0000-4000-8000-000000000001'
\set B 'aaaaaaaa-0000-4000-8000-000000000002'
\set N 'aaaaaaaa-0000-4000-8000-00000000000e'
\set X 'aaaaaaaa-0000-4000-8000-000000000003'
\set Y 'aaaaaaaa-0000-4000-8000-000000000005'

select set_config('request.jwt.claims', '', false);
reset role;
delete from storage.objects;
truncate characters, character_backups, campaign_dms, campaigns cascade;
insert into campaigns(id, dm_id, name) values
  ('c1000000-0000-0000-0000-000000000001', :d1, 'C'),
  ('c1000000-0000-0000-0000-000000000002', :d3, 'C2');
insert into campaign_dms(campaign_id, dm_id) values ('c1000000-0000-0000-0000-000000000001', :d2) on conflict do nothing;
insert into characters(id, owner_id, campaign_id, name, is_npc, stats)
select v.id, v.o, v.c, v.n, v.npc, jsonb_build_object('SEQ', 2, 'LOG', jsonb_build_array(jsonb_build_object('seq', 1, 'type', 'name', 'name', v.n)))
from (values
  (:'A'::uuid, :p1::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid, 'A', false),
  (:'B', :p2, 'c1000000-0000-0000-0000-000000000001', 'B', false),
  (:'N', :d1, 'c1000000-0000-0000-0000-000000000001', 'N', true),
  (:'X', :p3, null, 'X', false),
  (:'Y', :p5, 'c1000000-0000-0000-0000-000000000002', 'Y', false)) as v(id, o, c, n, npc);
insert into storage.objects(bucket_id, name) values
  ('character-images', :'A' || '/1'), ('character-images', :'N' || '/1'), ('character-images', :'X' || '/1'),
  ('other-bucket', :'A' || '/1');

-- READ ---------------------------------------------------------------------------------------------------
select t('owner reads own picture',                         'yes', :p1, rd(:'A' || '/1'));
select t('campaign DM (owner) reads a player''s picture',   'yes', :d1, rd(:'A' || '/1'));
select t('co-DM reads a player''s picture',                 'yes', :d2, rd(:'A' || '/1'));
select t('another player in the campaign reads it',         'yes', :p2, rd(:'A' || '/1'));
select t('a solo outsider cannot read it',                  'no',  :p3, rd(:'A' || '/1'));
select t('the DM of a different campaign cannot read it',   'no',  :d3, rd(:'A' || '/1'));
select t('a player of a different campaign cannot read it', 'no',  :p5, rd(:'A' || '/1'));
select t('anon cannot read it',                             'no',  'anon', rd(:'A' || '/1'));
select t('solo owner reads own picture',                    'yes', :p3, rd(:'X' || '/1'));
select t('nobody else reads a solo picture (p1)',           'no',  :p1, rd(:'X' || '/1'));
select t('nobody else reads a solo picture (DM d1)',        'no',  :d1, rd(:'X' || '/1'));
select t('NPC picture: its DM owner reads',                 'yes', :d1, rd(:'N' || '/1'));
select t('NPC picture: the co-DM reads',                    'yes', :d2, rd(:'N' || '/1'));
select t('NPC picture: a player of the campaign cannot',    'no',  :p1, rd(:'N' || '/1'));
select t('the policies stay in their bucket (other bucket)','no',  :p1, format($q$select count(*)::int from storage.objects where bucket_id='other-bucket'$q$));

-- WRITE --------------------------------------------------------------------------------------------------
select t('owner uploads slot 2',                            'yes',     :p1, ins(:'A' || '/2'));
select t('owner cannot upload a THIRD slot',                'refused', :p1, ins(:'A' || '/3'));
select t('owner cannot upload slot 0',                      'refused', :p1, ins(:'A' || '/0'));
select t('owner cannot upload a name with an extension',    'refused', :p1, ins(:'A' || '/2.webp'));
select t('owner cannot upload a nested name',               'refused', :p1, ins(:'A' || '/x/1'));
select t('owner cannot upload an UPPER-case uuid name',     'refused', :p1, ins(upper(:'A') || '/2'));
select t('owner cannot upload to a character that does not exist','refused', :p1, ins('aaaaaaaa-0000-4000-8000-0000000000ff/1'));
select t('owner cannot upload to someone else''s character','refused', :p1, ins(:'B' || '/1'));
select t('another campaign player cannot upload to A',      'refused', :p2, ins(:'A' || '/2'));
select t('the campaign DM cannot upload to a player''s character','refused', :d1, ins(:'A' || '/2'));
select t('anon cannot upload',                              'refused', 'anon', ins(:'A' || '/2'));
select t('the DM uploads to their own NPC',                 'yes',     :d1, ins(:'N' || '/2'));
select t('owner replaces (updates) slot 1',                 'yes',     :p1, upd(:'A' || '/1'));
select t('another player cannot replace slot 1',            'no',      :p2, upd(:'A' || '/1'));
select t('the campaign DM cannot replace slot 1',           'no',      :d1, upd(:'A' || '/1'));
select t('owner cannot rename slot 1 to a third slot',      'refused', :p1, mv(:'A' || '/1', :'A' || '/3'));
select t('owner cannot move a picture onto another character','refused', :p1, mv(:'A' || '/1', :'B' || '/1'));
select t('another player cannot delete it',                 'no',      :p2, del(:'A' || '/1'));
select t('the campaign DM cannot delete it',                'no',      :d1, del(:'A' || '/1'));
select t('owner deletes slot 1',                            'yes',     :p1, del(:'A' || '/1'));

-- ACCESS FOLLOWS THE CHARACTER, LIVE -----------------------------------------------------------------------
-- A leaves the campaign: its DM and fellow players lose sight of it at once.
select set_config('request.jwt.claims', '', false);
update characters set campaign_id = null where id = :'A';
select t('after unbind: the old DM cannot read A',          'no',  :d1, rd(:'A' || '/1'));
select t('after unbind: the old fellow player cannot read', 'no',  :p2, rd(:'A' || '/1'));
select t('after unbind: the owner still reads',             'yes', :p1, rd(:'A' || '/1'));
-- A moves to campaign C2: that campaign's DM and players can now see it.
update characters set campaign_id = 'c1000000-0000-0000-0000-000000000002' where id = :'A';
select t('after a move: the new DM reads A',                'yes', :d3, rd(:'A' || '/1'));
select t('after a move: a player of the new campaign reads','yes', :p5, rd(:'A' || '/1'));
-- Ownership transfer (a character claim): the new owner gets write access, the old one loses it.
update characters set owner_id = :p2 where id = :'A';
select t('after transfer: the new owner uploads',           'yes',     :p2, ins(:'A' || '/2'));
select t('after transfer: the old owner cannot upload',     'refused', :p1, ins(:'A' || '/2'));
select t('after transfer: the old owner cannot read',       'no',      :p1, rd(:'A' || '/1'));
-- The character row is deleted: its leftover file is readable and deletable by nobody.
delete from characters where id = :'X';
select t('deleted character: the former owner cannot read', 'no', :p3, rd(:'X' || '/1'));
select t('deleted character: the former owner cannot delete','no', :p3, del(:'X' || '/1'));

\set QUIET off
select n, verdict, expect, got, name from res order by n;
