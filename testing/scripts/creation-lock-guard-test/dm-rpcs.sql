create or replace function public.dm_reopen_creation(p_character uuid, p_note text DEFAULT NULL::text)
 returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_campaign uuid; v_stats jsonb; v_log jsonb; v_seq integer; v_event jsonb;
  v_ts bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  select campaign_id, stats into v_campaign, v_stats from characters where id = p_character for update;
  if not found then raise exception 'Character not found'; end if;
  if v_campaign is null then raise exception 'Character is not in a campaign'; end if;
  if not is_campaign_dm(v_campaign) then raise exception 'Only a campaign DM can reopen creation'; end if;
  if v_stats is null or not (v_stats ? 'LOG') then raise exception 'Character has no log'; end if;
  v_log := coalesce(v_stats->'LOG', '[]'::jsonb);
  v_seq := coalesce((v_stats->>'SEQ')::integer, jsonb_array_length(v_log) + 1);
  v_event := jsonb_build_object('seq', v_seq, 'ts', v_ts, 'type', 'creationUnlocked',
    'dmEdit', true, 'dmId', auth.uid(),
    'label', coalesce(nullif(btrim(p_note), ''), 'Creation reopened by DM'));
  update characters set stats = jsonb_set(jsonb_set(v_stats,'{LOG}', v_log || v_event),'{SEQ}', to_jsonb(v_seq+1))
   where id = p_character;
  return v_event;
end; $function$;
create or replace function public.dm_set_creation_ceiling(p_character uuid, p_threshold integer)
 returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_campaign uuid; v_stats jsonb; v_log jsonb; v_seq integer; v_event jsonb;
  v_ts bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if p_threshold is null or p_threshold < 1 or p_threshold > 2000 then
    raise exception 'Creation ceiling must be between 1 and 2000 AP (got %)', p_threshold;
  end if;
  select campaign_id, stats into v_campaign, v_stats from characters where id = p_character for update;
  if not found then raise exception 'Character not found'; end if;
  if v_campaign is null then raise exception 'Character is not in a campaign'; end if;
  if not is_campaign_dm(v_campaign) then raise exception 'Only a campaign DM can set a creation ceiling'; end if;
  if v_stats is null or not (v_stats ? 'LOG') then raise exception 'Character has no log'; end if;
  v_log := coalesce(v_stats->'LOG', '[]'::jsonb);
  v_seq := coalesce((v_stats->>'SEQ')::integer, jsonb_array_length(v_log) + 1);
  v_event := jsonb_build_object('seq', v_seq, 'ts', v_ts, 'type', 'creationLockConfig',
    'payload', jsonb_build_object('threshold', p_threshold),
    'dmEdit', true, 'dmId', auth.uid(),
    'label', 'Creation limit set by DM - ' || p_threshold || ' AP (+ drawbacks)');
  update characters set stats = jsonb_set(jsonb_set(v_stats,'{LOG}', v_log || v_event),'{SEQ}', to_jsonb(v_seq+1))
   where id = p_character;
  return v_event;
end; $function$;
