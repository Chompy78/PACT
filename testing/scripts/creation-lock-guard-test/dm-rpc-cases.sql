\pset pager off
truncate characters, character_backups cascade;
select set_config('request.jwt.claims','',false);
insert into characters(id,owner_id,campaign_id,name,stats) values
 ('cccccccc-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','locked','{"SEQ":3,"LOG":[{"seq":1,"type":"creationLockConfig","payload":{"threshold":72}},{"seq":2,"type":"creationLocked"}]}');
create or replace function rpc(p_name text, p_uid uuid, p_sql text) returns table(test text, outcome text) language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub',p_uid,'role','authenticated')::text, true);
  begin
    execute p_sql; return query select p_name, 'ok';
  exception when others then return query select p_name, 'ERROR: '||sqlerrm; end;
  perform set_config('request.jwt.claims','',true);
end $$;
select * from rpc('DM reopens creation', 'd0000000-0000-0000-0000-000000000001', $q$select dm_reopen_creation('cccccccc-0000-0000-0000-000000000001','reopen for fix')$q$);
select * from rpc('DM sets the limit to 80', 'd0000000-0000-0000-0000-000000000001', $q$select dm_set_creation_ceiling('cccccccc-0000-0000-0000-000000000001',80)$q$);
select * from rpc('Player tries reopen', 'a0000000-0000-0000-0000-000000000001', $q$select dm_reopen_creation('cccccccc-0000-0000-0000-000000000001')$q$);
select * from rpc('Player tries set limit', 'a0000000-0000-0000-0000-000000000001', $q$select dm_set_creation_ceiling('cccccccc-0000-0000-0000-000000000001',5)$q$);
select * from rpc('Other DM tries reopen', 'd0000000-0000-0000-0000-000000000002', $q$select dm_reopen_creation('cccccccc-0000-0000-0000-000000000001')$q$);
select 'log after DM actions' as what, v->>'seq' seq, v->>'type' type, v->'payload' payload, v->>'label' label
  from characters c, jsonb_array_elements(c.stats->'LOG') v where name='locked' order by (v->>'seq')::int;
