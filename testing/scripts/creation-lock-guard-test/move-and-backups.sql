\pset pager off
truncate characters, character_backups cascade;
select set_config('request.jwt.claims','',false);
insert into characters(id,owner_id,campaign_id,name,stats) values
 ('bbbbbbbb-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','camp-char','{"SEQ":3,"LOG":[{"seq":1,"type":"creationLockConfig","payload":{"threshold":72}},{"seq":2,"type":"creationLocked"}]}'),
 ('bbbbbbbb-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001',null,'solo-char','{"SEQ":1,"LOG":[]}');
-- L1: player moves the locked char to another campaign; show the lock-family events afterwards
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}',false);
update characters set campaign_id='c2000000-0000-0000-0000-000000000002' where name='camp-char';
select 'L1 after move' as check, v->>'type' as event, v->'payload' as payload, v->>'label' as label
  from characters c, jsonb_array_elements(c.stats->'LOG') v where name='camp-char' and v->>'type' like 'creation%';
-- S1: 60 saves each; campaign char keeps all, solo char is pruned to 50
select set_config('request.jwt.claims','',false);
do $$ begin
  for i in 1..60 loop
    update characters set stats = jsonb_set(stats,'{SEQ}', to_jsonb(i+10)) where name in ('camp-char','solo-char');
  end loop; end $$;
select 'S1 backups kept after 60 saves' as check, c.name, count(*) as kept
  from character_backups b join characters c on c.id=b.character_id where b.reason='update' group by c.name order by 2;
