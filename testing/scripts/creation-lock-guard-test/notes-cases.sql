\set QUIET on
-- feat/boon-drawback-notes — cases. Expectations are the AFTER-migration truth. Run BEFORE the migration, the player
-- attacks on an approved description show FAIL ('allowed' instead of 'refused') and the DM's Approve/Unlock show FAIL
-- (the event type is unknown): that is the gap. Built on schema.sql + rls-policies.sql (which carries
-- 2026-09-03-dm-zero-player-ap.sql and 2026-10-12-server-player-award-after-lock.sql since 2026-10-20), so the REAL
-- dm_edit_character_log and every characters trigger live today run alongside the rule under test.
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
    elsif sqlerrm like 'PACT: %' or sqlerrm like 'dm_edit_character_log: %' or sqlerrm like 'Only a campaign DM%' or sqlerrm like 'Character is not in a campaign%' then g := 'refused';
    -- a failed `expect` check, or (BEFORE the migration) the missing state reader: the behaviour under test is absent
    elsif sqlerrm like 'CHECK FAILED%' or sqlerrm like 'function pact_item_note_state%does not exist' or sqlerrm like 'function public.pact_js_trim%does not exist' then g := 'check failed';
    else g := 'ERROR: ' || sqlerrm; end if;
  end;
  insert into res(name, expect, got, verdict) values (p_name, p_expect, g, case when g = p_expect then 'PASS' else 'FAIL' end);
end $$;
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
create or replace function dm_ev(p_name text, p_evs text) returns jsonb language plpgsql as $$
begin
  perform as_dm();
  return dm_edit_character_log((select id from characters where name = p_name), p_evs::jsonb);
end $$;
-- `expect` raises unless the condition holds, so a check case reports 'allowed' when it holds.
create or replace function expect(p_ok boolean, p_what text) returns void language plpgsql as $$
begin if not coalesce(p_ok, false) then raise exception 'CHECK FAILED: %', p_what; end if; end $$;
select as_admin();
truncate characters, character_backups, campaign_dms, campaigns cascade;
insert into campaigns(id, dm_id, name) values
 ('c1000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','One'),
 ('c1000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','Two');
insert into campaign_dms(campaign_id, dm_id) select id, 'd0000000-0000-0000-0000-000000000001' from campaigns on conflict do nothing;

-- pending : a written note awaiting approval (and a held Patron boon with no note yet)
-- approved: a note the DM approved in campaign One (seeded as admin; the BEFORE run cannot write it through the RPC)
-- otherc  : an approval stamped with campaign TWO on a campaign ONE character (does not count)
-- solo    : no campaign; carries an approval from a former campaign (never locks a solo character)
insert into characters(owner_id, campaign_id, name, kind, ap, stats) values
 ('a0000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','pending','livesheet',0,
  '{"SEQ":6,"LOG":[{"seq":1,"type":"award","amount":79,"note":"Budget","noLock":true},
    {"seq":2,"type":"buy","cat":"drawback","cost":-3,"payload":{"v":"Code of Honour"}},
    {"seq":3,"type":"itemNote","cat":"drawback","refVal":"Code of Honour","text":"Never strike an unarmed foe."},
    {"seq":4,"type":"buy","cat":"boon","cost":4,"payload":{"v":"Patron"}}]}'),
 ('a0000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000001','approved','livesheet',0,
  '{"SEQ":5,"LOG":[{"seq":1,"type":"award","amount":79,"note":"Budget","noLock":true},
    {"seq":2,"type":"buy","cat":"drawback","cost":-3,"payload":{"v":"Code of Honour"}},
    {"seq":3,"type":"itemNote","cat":"drawback","refVal":"Code of Honour","text":"Old oath"},
    {"seq":4,"type":"dmApproveNote","cat":"drawback","refVal":"Code of Honour","text":"Old oath","campaignId":"c1000000-0000-0000-0000-000000000001","dmEdit":true,"dmId":"d0000000-0000-0000-0000-000000000001"}]}'),
 ('a0000000-0000-0000-0000-000000000003','c1000000-0000-0000-0000-000000000001','otherc','livesheet',0,
  '{"SEQ":5,"LOG":[{"seq":1,"type":"award","amount":79,"note":"Budget","noLock":true},
    {"seq":2,"type":"buy","cat":"drawback","cost":-3,"payload":{"v":"Code of Honour"}},
    {"seq":3,"type":"itemNote","cat":"drawback","refVal":"Code of Honour","text":"Old oath"},
    {"seq":4,"type":"dmApproveNote","cat":"drawback","refVal":"Code of Honour","text":"Old oath","campaignId":"c1000000-0000-0000-0000-000000000002","dmEdit":true,"dmId":"d0000000-0000-0000-0000-000000000001"}]}'),
 ('a0000000-0000-0000-0000-000000000004',null,'solo','livesheet',0,
  '{"SEQ":5,"LOG":[{"seq":1,"type":"award","amount":79,"note":"Budget","noLock":true},
    {"seq":2,"type":"buy","cat":"drawback","cost":-3,"payload":{"v":"Code of Honour"}},
    {"seq":3,"type":"itemNote","cat":"drawback","refVal":"Code of Honour","text":"Old oath"},
    {"seq":4,"type":"dmApproveNote","cat":"drawback","refVal":"Code of Honour","text":"Old oath","campaignId":"c1000000-0000-0000-0000-000000000001","dmEdit":true,"dmId":"d0000000-0000-0000-0000-000000000001"}]}');

-- ===== DM: approve / unlock through dm_edit_character_log =====
select t('DM approves a note awaiting approval (sending the text shown)', 'allowed', $b$ select dm_ev('pending', '[{"type":"dmApproveNote","cat":"drawback","refVal":"Code of Honour","text":"Never strike an unarmed foe."}]') $b$);
select t('DM approval with NO text (not the one shown) is refused', 'refused', $b$ select dm_ev('pending', '[{"type":"dmApproveNote","cat":"drawback","refVal":"Code of Honour"}]') $b$);
select t('DM approval of a STALE text (the player changed it since the page loaded) is refused', 'refused', $b$ select owner_append('pending', '{"seq":6,"type":"itemNote","cat":"drawback","refVal":"Code of Honour","text":"Something else"}'); select dm_ev('pending', '[{"type":"dmApproveNote","cat":"drawback","refVal":"Code of Honour","text":"Never strike an unarmed foe."}]') $b$);
select t('...the stored approval is DM-stamped, carries the approved text and the campaign, and nothing the client sent', 'allowed', $b$
  select dm_ev('pending', '[{"type":"dmApproveNote","cat":"drawback","refVal":"Code of Honour","text":"Never strike an unarmed foe.","cost":50,"amount":9,"campaignId":"x"}]');
  select as_admin();
  select expect((select e->>'text' = 'Never strike an unarmed foe.' and e->>'campaignId' = 'c1000000-0000-0000-0000-000000000001'
                        and e->'dmEdit' = 'true'::jsonb and e->>'dmId' = 'd0000000-0000-0000-0000-000000000001'
                        and not (e ? 'cost') and not (e ? 'amount') and e->>'seq' = '6'
                   from characters c, jsonb_array_elements(c.stats->'LOG') e where c.name = 'pending' and e->>'type' = 'dmApproveNote'), 'stamped approval') $b$);
select t('DM approves a note that is already approved', 'refused', $b$ select dm_ev('approved', '[{"type":"dmApproveNote","cat":"drawback","refVal":"Code of Honour"}]') $b$);
select t('DM approves a held boon that has no note yet', 'refused', $b$ select dm_ev('pending', '[{"type":"dmApproveNote","cat":"boon","refVal":"Patron"}]') $b$);
select t('DM approves a note for an item the character does not hold', 'refused', $b$ select dm_ev('pending', '[{"type":"dmApproveNote","cat":"drawback","refVal":"Nightmares"}]') $b$);
select t('DM approves with a bad category', 'refused', $b$ select dm_ev('pending', '[{"type":"dmApproveNote","cat":"skill","refVal":"Code of Honour"}]') $b$);
select t('DM approves a note on a SOLO character (no campaign)', 'refused', $b$ select dm_ev('solo', '[{"type":"dmApproveNote","cat":"drawback","refVal":"Code of Honour"}]') $b$);
select t('a PLAYER calls dm_edit_character_log to approve their own note', 'refused', $b$ select as_user('a0000000-0000-0000-0000-000000000001'); select dm_edit_character_log((select id from characters where name='pending'), '[{"type":"dmApproveNote","cat":"drawback","refVal":"Code of Honour"}]'::jsonb) $b$);
select t('an approval stamped with ANOTHER campaign does not count: the DM can approve here', 'allowed', $b$ select dm_ev('otherc', '[{"type":"dmApproveNote","cat":"drawback","refVal":"Code of Honour","text":"Old oath"}]') $b$);
select t('DM unlocks an approved note, with a reason', 'allowed', $b$ select dm_ev('approved', '[{"type":"dmUnlockNote","cat":"drawback","refVal":"Code of Honour","note":"swore a new oath"}]') $b$);
select t('DM unlocks with no reason', 'allowed', $b$ select dm_ev('approved', '[{"type":"dmUnlockNote","cat":"drawback","refVal":"Code of Honour"}]') $b$);
select t('DM unlocks a note that is not approved', 'refused', $b$ select dm_ev('pending', '[{"type":"dmUnlockNote","cat":"drawback","refVal":"Code of Honour"}]') $b$);
select t('DM unlock reason over 200 characters', 'refused', $b$ select dm_ev('approved', format('[{"type":"dmUnlockNote","cat":"drawback","refVal":"Code of Honour","note":"%s"}]', repeat('x', 201))) $b$);
select t('DM approves then unlocks in ONE call', 'allowed', $b$ select dm_ev('pending', '[{"type":"dmApproveNote","cat":"drawback","refVal":"Code of Honour","text":"Never strike an unarmed foe."},{"type":"dmUnlockNote","cat":"drawback","refVal":"Code of Honour"}]') $b$);

-- ===== ATTACKS: a player changes an approved description (refused after; allowed today) =====
select t('player appends a new note to an approved description', 'refused', $b$ select owner_append('approved', '{"seq":5,"type":"itemNote","cat":"drawback","refVal":"Code of Honour","text":"New oath"}') $b$);
select t('player rewrites the approved note in place', 'refused', $b$ select owner_upd('approved', $e$ jsonb_set(stats,'{LOG,2,text}','"Rewritten"') $e$) $b$);
select t('player deletes the approved note', 'refused', $b$ select owner_upd('approved', $e$ jsonb_set(stats,'{LOG}', (select jsonb_agg(e order by o) from jsonb_array_elements(stats->'LOG') with ordinality x(e,o) where e->>'type' <> 'itemNote')) $e$) $b$);
select t('player deletes the DM approval', 'refused', $b$ select owner_upd('approved', $e$ jsonb_set(stats,'{LOG}', (select jsonb_agg(e order by o) from jsonb_array_elements(stats->'LOG') with ordinality x(e,o) where e->>'type' <> 'dmApproveNote')) $e$) $b$);
select t('player forges a DM approval of their own pending note', 'refused', $b$ select owner_append('pending', '{"seq":6,"type":"dmApproveNote","cat":"drawback","refVal":"Code of Honour","text":"Never strike an unarmed foe.","campaignId":"c1000000-0000-0000-0000-000000000001","dmEdit":true,"dmId":"d0000000-0000-0000-0000-000000000001"}') $b$);
select t('player forges a DM unlock of their approved note', 'refused', $b$ select owner_append('approved', '{"seq":5,"type":"dmUnlockNote","cat":"drawback","refVal":"Code of Honour","campaignId":"c1000000-0000-0000-0000-000000000001","dmEdit":true,"dmId":"d0000000-0000-0000-0000-000000000001"}') $b$);
select t('player forges an unlock AND a new note in one save', 'refused', $b$ select owner_upd('approved', $e$ jsonb_set(stats,'{LOG}', (stats->'LOG') || '[{"seq":5,"type":"dmUnlockNote","cat":"drawback","refVal":"Code of Honour","campaignId":"c1000000-0000-0000-0000-000000000001","dmEdit":true},{"seq":6,"type":"itemNote","cat":"drawback","refVal":"Code of Honour","text":"New"}]'::jsonb) $e$) $b$);
select t('a campaign character inserted by a player carrying an approval made there arrives WITHOUT it (C: dropped, not refused)', 'allowed', $b$ select as_user('a0000000-0000-0000-0000-000000000009'); insert into characters(owner_id, campaign_id, name, kind, ap, stats) values ('a0000000-0000-0000-0000-000000000009','c1000000-0000-0000-0000-000000000001','ins','livesheet',0,(select stats from characters where name='approved')); select as_admin(); select expect((select count(*) = 0 from characters c, jsonb_array_elements(c.stats->'LOG') e where c.name='ins' and e->>'type'='dmApproveNote'), 'forged approval dropped') $b$);

-- ===== description text =====
select t('player writes a 501-character note', 'refused', $b$ select owner_append('pending', format('{"seq":6,"type":"itemNote","cat":"drawback","refVal":"Code of Honour","text":"%s"}', repeat('x', 501))) $b$);
select t('player writes a blank note', 'refused', $b$ select owner_append('pending', '{"seq":6,"type":"itemNote","cat":"drawback","refVal":"Code of Honour","text":"   "}') $b$);
select t('player writes a note whose text is not a string', 'refused', $b$ select owner_append('pending', '{"seq":6,"type":"itemNote","cat":"drawback","refVal":"Code of Honour","text":42}') $b$);

-- ===== LEGITIMATE: must stay allowed =====
select t('player edits a note awaiting approval (appends a newer one)', 'allowed', $b$ select owner_append('pending', '{"seq":6,"type":"itemNote","cat":"drawback","refVal":"Code of Honour","text":"Never strike first."}') $b$);
select t('player writes a 500-character note', 'allowed', $b$ select owner_append('pending', format('{"seq":6,"type":"itemNote","cat":"drawback","refVal":"Code of Honour","text":"%s"}', repeat('x', 500))) $b$);
select t('player writes the note for a held boon', 'allowed', $b$ select owner_append('pending', '{"seq":6,"type":"itemNote","cat":"boon","refVal":"Patron","text":"The Silver Hand guild."}') $b$);
select t('approved description: player makes an unrelated purchase', 'allowed', $b$ select owner_append('approved', '{"seq":5,"type":"buy","cat":"skill","cost":1,"payload":{"v":"Arcana"}}') $b$);
select t('approved description: player buys and describes ANOTHER flagged item', 'allowed', $b$ select owner_upd('approved', $e$ jsonb_set(stats,'{LOG}', (stats->'LOG') || '[{"seq":5,"type":"buy","cat":"boon","cost":4,"payload":{"v":"Patron"}},{"seq":6,"type":"itemNote","cat":"boon","refVal":"Patron","text":"A guild"}]'::jsonb) $e$) $b$);
select t('approved description: player re-saves unchanged', 'allowed', $b$ select owner_upd('approved', $e$ stats || '{"name":"x"}'::jsonb $e$) $b$);
select t('after a DM unlock the player changes the note', 'allowed', $b$ select dm_ev('approved', '[{"type":"dmUnlockNote","cat":"drawback","refVal":"Code of Honour"}]'); select owner_append('approved', '{"seq":6,"type":"itemNote","cat":"drawback","refVal":"Code of Honour","text":"New oath"}') $b$);
select t('after approval the player cannot change it, after re-approval neither', 'refused', $b$ select dm_ev('approved', '[{"type":"dmUnlockNote","cat":"drawback","refVal":"Code of Honour"}]'); select owner_append('approved', '{"seq":6,"type":"itemNote","cat":"drawback","refVal":"Code of Honour","text":"New oath"}'); select dm_ev('approved', '[{"type":"dmApproveNote","cat":"drawback","refVal":"Code of Honour","text":"New oath"}]'); select owner_append('approved', '{"seq":9,"type":"itemNote","cat":"drawback","refVal":"Code of Honour","text":"Sneaky"}') $b$);
select t('an approval from ANOTHER campaign does not lock the note here', 'allowed', $b$ select owner_append('otherc', '{"seq":5,"type":"itemNote","cat":"drawback","refVal":"Code of Honour","text":"New oath"}') $b$);
select t('SOLO character: an approved note stays editable (never locked)', 'allowed', $b$ select owner_append('solo', '{"seq":5,"type":"itemNote","cat":"drawback","refVal":"Code of Honour","text":"New oath"}') $b$);
select t('SOLO character: the player still cannot remove a DM approval', 'refused', $b$ select owner_upd('solo', $e$ jsonb_set(stats,'{LOG}', (select jsonb_agg(e order by o) from jsonb_array_elements(stats->'LOG') with ordinality x(e,o) where e->>'type' <> 'dmApproveNote')) $e$) $b$);
select t('a SOLO character is inserted carrying an approval (inert)', 'allowed', $b$ select as_user('a0000000-0000-0000-0000-000000000009'); insert into characters(owner_id, campaign_id, name, kind, ap, stats) values ('a0000000-0000-0000-0000-000000000009',null,'ins2','livesheet',0,(select stats from characters where name='approved')) $b$);
select t('admin session rewrites an approved note (hand repair)', 'allowed', $b$ select as_admin(); update characters set stats = jsonb_set(stats,'{LOG,2,text}','"Repaired"') where name = 'approved' $b$);
select t('DM boon grant through dm_edit_character_log still works', 'allowed', $b$ select dm_ev('approved', '[{"type":"buy","cat":"boon","payload":{"v":"Lucky"},"cost":12},{"type":"award","amount":12,"note":"DM boon grant"}]') $b$);
select t('DM unlock-drawback validation still runs (refuses a player-taken drawback)', 'refused', $b$ select dm_ev('approved', '[{"type":"dmUnlockDrawback","refVal":"Code of Honour","targetSeq":2,"note":"beat"}]') $b$);
-- ===== #673 review A: approved text swapped while solo =====
select t('A: DM approves, unbinds; the SOLO player rewrites the approved note in place; rebinds — the swapped note is pending, not approved', 'allowed', $b$
  select as_admin(); update characters set campaign_id = null where name = 'approved';
  select owner_upd('approved', $e$ jsonb_set(stats,'{LOG,2,text}','"Swapped oath"') $e$);
  select as_admin(); update characters set campaign_id = 'c1000000-0000-0000-0000-000000000001' where name = 'approved';
  select expect((select s.status = 'pending' from characters c, pact_item_note_state(c.stats->'LOG','drawback','Code of Honour','c1000000-0000-0000-0000-000000000001') s where c.name='approved'), 'swapped note pending') $b$);
select t('A: ...so the player can still change it, and the DM approves the NEW text', 'allowed', $b$
  select as_admin(); update characters set campaign_id = null where name = 'approved';
  select owner_upd('approved', $e$ jsonb_set(stats,'{LOG,2,text}','"Swapped oath"') $e$);
  select as_admin(); update characters set campaign_id = 'c1000000-0000-0000-0000-000000000001' where name = 'approved';
  select owner_append('approved', '{"seq":5,"type":"itemNote","cat":"drawback","refVal":"Code of Honour","text":"Swapped again"}');
  select dm_ev('approved', '[{"type":"dmApproveNote","cat":"drawback","refVal":"Code of Honour","text":"Swapped again"}]') $b$);
select t('A: an approval whose text differs from the note it follows does not lock it', 'allowed', $b$
  select as_admin(); update characters set stats = jsonb_set(stats,'{LOG,3,text}','"Not the note"') where name = 'approved';
  select owner_append('approved', '{"seq":5,"type":"itemNote","cat":"drawback","refVal":"Code of Honour","text":"Edited"}') $b$);

-- ===== #673 review C: a player claims a DM's pregen whose descriptions the DM approved =====
select t('C: redeem_character_claim of an approved pregen succeeds, and the copy''s approvals are dropped (notes pending again)', 'allowed', $b$
  select as_admin();
  insert into characters(owner_id, campaign_id, name, kind, ap, stats) values ('d0000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000002','pregen','livesheet',0,(select stats from characters where name='approved'));
  update characters set stats = jsonb_set(stats,'{LOG,3,campaignId}','"c1000000-0000-0000-0000-000000000002"') where name='pregen';
  select as_dm();
  create temp table tok as select public.create_character_claim((select id from characters where name='pregen'), null) as t;
  select as_user('a0000000-0000-0000-0000-000000000009');
  select * from public.redeem_character_claim((select t from tok));
  select as_admin();
  select expect((select count(*) = 0 from characters c, jsonb_array_elements(c.stats->'LOG') e where c.owner_id='a0000000-0000-0000-0000-000000000009' and c.campaign_id='c1000000-0000-0000-0000-000000000002' and e->>'type'='dmApproveNote'), 'approvals dropped');
  select expect((select count(*) = 1 from characters c, jsonb_array_elements(c.stats->'LOG') e where c.owner_id='a0000000-0000-0000-0000-000000000009' and c.campaign_id='c1000000-0000-0000-0000-000000000002' and e->>'type'='itemNote'), 'note kept') $b$);


-- ===== #673 re-review 4: joining a campaign never carries approvals made "in" it =====
select t('bind_character_to_campaign of a SOLO character with FORGED approvals stamped with the campaign: joins, approvals dropped, note pending', 'allowed', $b$
  select as_admin();
  insert into characters(owner_id, campaign_id, name, kind, ap, stats) values ('a0000000-0000-0000-0000-000000000005',null,'forger','livesheet',0,
    '{"SEQ":4,"LOG":[{"seq":1,"type":"buy","cat":"drawback","cost":-3,"payload":{"v":"Code of Honour"}},{"seq":2,"type":"itemNote","cat":"drawback","refVal":"Code of Honour","text":"Forged"},{"seq":3,"type":"dmApproveNote","cat":"drawback","refVal":"Code of Honour","text":"Forged","campaignId":"c1000000-0000-0000-0000-000000000001","dmEdit":true,"dmId":"d0000000-0000-0000-0000-000000000001"}]}');
  select as_user('a0000000-0000-0000-0000-000000000005');
  select public.bind_character_to_campaign((select id from characters where name='forger'), (select invite_code from campaigns where id='c1000000-0000-0000-0000-000000000001'));
  select as_admin();
  select expect((select campaign_id = 'c1000000-0000-0000-0000-000000000001' from characters where name='forger'), 'bound');
  select expect((select count(*) = 0 from characters c, jsonb_array_elements(c.stats->'LOG') e where c.name='forger' and e->>'type'='dmApproveNote'), 'forged approval dropped');
  select expect((select s.status = 'pending' from characters c, pact_item_note_state(c.stats->'LOG','drawback','Code of Honour','c1000000-0000-0000-0000-000000000001') s where c.name='forger'), 'note pending') $b$);
select t('an HONEST rejoin (DM approved, unbound, rejoined) also needs the DM''s approval again', 'allowed', $b$
  select as_admin(); update characters set campaign_id = null where name = 'approved';
  select as_user('a0000000-0000-0000-0000-000000000002');
  select public.bind_character_to_campaign((select id from characters where name='approved'), (select invite_code from campaigns where id='c1000000-0000-0000-0000-000000000001'));
  select as_admin();
  select expect((select s.status = 'pending' from characters c, pact_item_note_state(c.stats->'LOG','drawback','Code of Honour','c1000000-0000-0000-0000-000000000001') s where c.name='approved'), 'pending after rejoin');
  select dm_ev('approved', '[{"type":"dmApproveNote","cat":"drawback","refVal":"Code of Honour","text":"Old oath"}]') $b$);
select t('a move INTO a campaign cannot smuggle a NEW approval of another campaign either (any other approval change is refused)', 'refused', $b$
  select as_user((select owner_id from characters where name='solo'));
  update characters set campaign_id = 'c1000000-0000-0000-0000-000000000001',
    stats = jsonb_set(stats,'{LOG}', (stats->'LOG') || '[{"seq":9,"type":"dmApproveNote","cat":"boon","refVal":"Patron","text":"x","campaignId":"c1000000-0000-0000-0000-000000000002","dmEdit":true}]'::jsonb)
   where name = 'solo' $b$);
select t('redeem_player_invite, then the player saves a log with a FORGED approval: refused', 'refused', $b$
  select as_dm();
  create temp table ptok as select public.create_player_invite('c1000000-0000-0000-0000-000000000001', 0, 79, null) as t;
  select as_user('a0000000-0000-0000-0000-000000000006');
  select * from public.redeem_player_invite((select t from ptok), 'Invitee');
  select owner_upd('Invitee', $e$ jsonb_build_object('SEQ',4,'LOG','[{"seq":1,"type":"buy","cat":"drawback","cost":-3,"payload":{"v":"Code of Honour"}},{"seq":2,"type":"itemNote","cat":"drawback","refVal":"Code of Honour","text":"Forged"},{"seq":3,"type":"dmApproveNote","cat":"drawback","refVal":"Code of Honour","text":"Forged","campaignId":"c1000000-0000-0000-0000-000000000001","dmEdit":true,"dmId":"d0000000-0000-0000-0000-000000000001"}]'::jsonb) $e$) $b$);
select t('redeem_player_invite, then an honest first save (a note, no approval): allowed', 'allowed', $b$
  select as_dm();
  create temp table ptok2 as select public.create_player_invite('c1000000-0000-0000-0000-000000000001', 0, 79, null) as t;
  select as_user('a0000000-0000-0000-0000-000000000006');
  select * from public.redeem_player_invite((select t from ptok2), 'Invitee');
  select owner_upd('Invitee', $e$ jsonb_build_object('SEQ',3,'LOG','[{"seq":1,"type":"buy","cat":"drawback","cost":-3,"payload":{"v":"Code of Honour"}},{"seq":2,"type":"itemNote","cat":"drawback","refVal":"Code of Honour","text":"Honest"}]'::jsonb) $e$) $b$);

-- ===== #673 re-review 5: "blank" means what JavaScript's trim() means =====
select t('a note of only NBSP / ideographic space / BOM is blank (refused, as JS trim() sees it)', 'refused', $b$ select owner_append('pending', format('{"seq":6,"type":"itemNote","cat":"drawback","refVal":"Code of Honour","text":"%s"}', chr(160) || chr(12288) || chr(65279))) $b$);
select t('pact_js_trim matches JS: strips NBSP/U+3000/U+FEFF/tab/newline, keeps U+0085 (JS does not trim NEL)', 'allowed', $b$
  select expect(public.pact_js_trim(chr(160) || chr(9) || ' x ' || chr(10) || chr(12288) || chr(65279)) = 'x', 'trim set');
  select expect(public.pact_js_trim(chr(133)) = chr(133), 'NEL kept');
  select expect((select status from public.pact_item_note_state(jsonb_build_array(jsonb_build_object('type','itemNote','cat','drawback','refVal','X','text',chr(160) || chr(8200))), 'drawback','X','c') ) = 'none', 'blank state') $b$);
select t('a note with leading/trailing NBSP around real text is allowed', 'allowed', $b$ select owner_append('pending', format('{"seq":6,"type":"itemNote","cat":"drawback","refVal":"Code of Honour","text":"%s"}', chr(160) || 'Real text' || chr(160))) $b$);

select as_admin();
