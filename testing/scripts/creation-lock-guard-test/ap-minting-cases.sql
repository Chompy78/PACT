\set QUIET on
-- fix/ap-minting-and-edit-award-campaign — cases. Expectations are the AFTER-migration truth. Run BEFORE the migration the
-- minting chain and the former-DM edit show FAIL: that is the gap. Built on schema.sql + rls-policies.sql (the real
-- award_ap / award_gold / dm_bind_npc / dm_unbind_character / bind_character_to_campaign / edit_ap_award / budget trigger).
-- State carries across steps (autocommit), so the file is for a fresh database; run-ap-minting.sh resets one each time.
drop table if exists res; create table res(n serial, name text, expect text, got text, verdict text);
create or replace function chk(p_name text, p_expect text, p_got text) returns void language sql as $$
  insert into res(name, expect, got, verdict) values (p_name, p_expect, p_got, case when p_got = p_expect then 'PASS' else 'FAIL' end) $$;
-- run a statement in a rolled-back sub-transaction; 'refused' = one of the messages this change or the budget trigger raises
drop function if exists t(text,text,text);
create function t(p_name text, p_expect text, p_body text) returns void language plpgsql as $$
declare g text;
begin
  begin
    execute p_body;
    raise exception 'ROLLBACK_OK';
  exception when others then
    if sqlerrm = 'ROLLBACK_OK' then g := 'allowed';
    elsif sqlerrm like 'This character is no longer in the campaign%' or sqlerrm like 'PACT: over AP budget%' then g := 'refused';
    else g := 'ERROR: ' || sqlerrm; end if;
  end;
  insert into res(name, expect, got, verdict) values (p_name, p_expect, g, case when g = p_expect then 'PASS' else 'FAIL' end);
end $$;
-- session-level identity (false = survives the statement); '' = admin session
create or replace function as_user(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, false) $$;
create or replace function as_admin() returns void language sql as $$ select set_config('request.jwt.claims', '', false) $$;
create or replace function ap_of(p_name text) returns text language sql as $$ select ap::text from characters where name = p_name $$;
create or replace function gold_of(p_name text) returns text language sql as $$ select gold::text from characters where name = p_name $$;
create or replace function char_id(p_name text) returns uuid language sql as $$ select id from characters where name = p_name $$;

select as_admin();
-- A = a…01 (the attacker, DM of their own campaign), V = d…01 (the victim's DM), P = a…02 (an honest player)
insert into campaigns(id, dm_id, name, invite_code, rules) values
 ('c1000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','Own',    'AAAAAA','{}'),
 ('c1000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','Victim', 'VVVVVV','{"startingTier":{"ap":10}}'),
 ('c1000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','Other',  'OOOOOO','{}');
insert into campaign_dms(campaign_id, dm_id) select id, dm_id from campaigns on conflict do nothing;
insert into characters(owner_id, campaign_id, name, kind, ap, stats) values
 ('a0000000-0000-0000-0000-000000000001',null,'mint', 'chargen',0,'{"SEQ":2,"LOG":[{"seq":1,"type":"name","name":"mint"}]}'),
 ('a0000000-0000-0000-0000-000000000001',null,'mover','chargen',0,'{"SEQ":2,"LOG":[{"seq":1,"type":"name","name":"mover"}]}'),
 ('a0000000-0000-0000-0000-000000000001',null,'stay', 'chargen',0,'{"SEQ":2,"LOG":[{"seq":1,"type":"name","name":"stay"}]}'),
 ('a0000000-0000-0000-0000-000000000002',null,'legit','chargen',0,'{"SEQ":2,"LOG":[{"seq":1,"type":"name","name":"legit"}]}');

-- ===== HOLE 1: the minting chain =====
select as_user('a0000000-0000-0000-0000-000000000001');
select dm_bind_npc(char_id('mint'),  'c1000000-0000-0000-0000-000000000001');
select dm_bind_npc(char_id('mover'), 'c1000000-0000-0000-0000-000000000001');
select dm_bind_npc(char_id('stay'),  'c1000000-0000-0000-0000-000000000001');
select award_ap(char_id('mint'), 1000000, 'mint');
select award_gold(char_id('mint'), 500, 'mint');
select award_ap(char_id('mover'), 20, 'mover award');
select award_ap(char_id('stay'), 20, 'stay award');
select chk('own campaign: the DM can still award their own NPC (ap 1000000)', '1000000', ap_of('mint'));
select chk('own campaign: gold awarded', '500', gold_of('mint'));
select dm_unbind_character(char_id('mint'));
select chk('unbinding to SOLO keeps ap (not wiped)', '1000000', ap_of('mint'));
select chk('unbinding to SOLO keeps gold', '500', gold_of('mint'));
select bind_character_to_campaign(char_id('mint'), 'VVVVVV');
select chk('joining a victim campaign: ap is that campaign''s starting AP only (10), not the minted 1000000', '10', ap_of('mint'));
select chk('joining a victim campaign: gold is 0', '0', gold_of('mint'));
select t('player spends minted AP in the victim campaign (buy cost 500000)', 'refused',
  $b$ update characters set stats = jsonb_set(stats,'{LOG}', (stats->'LOG') || '[{"seq":2,"type":"buy","cat":"boon","cost":500000,"payload":{"v":"Lucky"}}]'::jsonb) where name = 'mint' $b$);

-- ===== HOLE 2: a former DM edits an award of a character that moved =====
select dm_unbind_character(char_id('mover'));
select bind_character_to_campaign(char_id('mover'), 'OOOOOO');
select chk('moved character: ap is the new campaign''s award sum (0), not the carried 20', '0', ap_of('mover'));
select t('former DM raises an award of the character that left (edit_ap_award)', 'refused',
  format($b$ select edit_ap_award(%L, 1000000, 'x', null, 'former dm') $b$, (select id from ap_awards where character_id = char_id('mover'))));
select chk('no audit row exists from a refused edit', '0', (select count(*)::text from ap_award_edits));
select t('DM edits an award of a character still in the campaign (legitimate)', 'allowed',
  format($b$ select edit_ap_award(%L, 25, 'fixed', null, 'typo') $b$, (select id from ap_awards where character_id = char_id('stay'))));
select edit_ap_award((select id from ap_awards where character_id = char_id('stay')), 25, 'fixed', null, 'typo');
select chk('legitimate edit applies the delta (20 -> 25)', '25', ap_of('stay'));
select t('a non-DM still cannot edit an award', 'ERROR: Only a campaign DM can edit an AP award',
  format($b$ select as_user('a0000000-0000-0000-0000-000000000002'); select edit_ap_award(%L, 1, 'x', null, 'n') $b$, (select id from ap_awards where character_id = char_id('stay'))));
select as_user('a0000000-0000-0000-0000-000000000001');

-- ===== legitimate joins and rejoins =====
select as_user('a0000000-0000-0000-0000-000000000002');
select bind_character_to_campaign(char_id('legit'), 'VVVVVV');
select chk('first join: starting AP granted once (10)', '10', ap_of('legit'));
select chk('first join: one starting-AP award row', '1', (select count(*)::text from ap_awards where character_id = char_id('legit')));
select as_user('d0000000-0000-0000-0000-000000000001');
select award_ap(char_id('legit'), 5, 'session 1');
select award_gold(char_id('legit'), 7, 'loot');
select chk('DM award in the campaign', '15', ap_of('legit'));
select dm_unbind_character(char_id('legit'));
select chk('left to solo: ap kept', '15', ap_of('legit'));
select as_user('a0000000-0000-0000-0000-000000000002');
select bind_character_to_campaign(char_id('legit'), 'VVVVVV');
select chk('rejoin the SAME campaign: award sum restored (15), starting AP not granted twice', '15', ap_of('legit'));
select chk('rejoin the same campaign: gold restored (7)', '7', gold_of('legit'));
select chk('rejoin: still one starting-AP award row', '1', (select count(*)::text from ap_awards where character_id = char_id('legit') and note like 'Starting AP%'));
select as_user('d0000000-0000-0000-0000-000000000001');
select dm_unbind_character(char_id('legit'));
select as_user('a0000000-0000-0000-0000-000000000002');
select bind_character_to_campaign(char_id('legit'), 'OOOOOO');
select chk('moving to a DIFFERENT campaign: that campaign''s award sum (0)', '0', ap_of('legit'));
select chk('moving to a different campaign: gold 0', '0', gold_of('legit'));
select as_user('d0000000-0000-0000-0000-000000000001');
select dm_unbind_character(char_id('legit'));
select as_user('a0000000-0000-0000-0000-000000000002');
select bind_character_to_campaign(char_id('legit'), 'VVVVVV');
select chk('back to the first campaign: its 15 returns', '15', ap_of('legit'));

-- ===== admin sessions behave like the other triggers =====
select as_admin();
update characters set campaign_id = 'c1000000-0000-0000-0000-000000000003' where name = 'legit';
select chk('admin session (no claims): the move does not reset ap', '15', ap_of('legit'));
select as_admin();
