-- PACT — rollback for sql/migrations/2026-09-01-session-seal.sql.
--
-- WHY THIS FILE EXISTS AND WHAT IT IS ACTUALLY FOR. The forward migration is additive DDL: it creates
-- functions and one trigger and does not write a single row. So the failure mode it needs protecting
-- against is NOT data loss — it is the trigger refusing a save it should have allowed, which a data
-- backup cannot fix and this file can, in one statement.
--
-- Drop the trigger FIRST and on its own if you are mid-incident. That alone restores the previous
-- behaviour completely: every function below is inert unless something calls it, but the trigger runs
-- on every character update.
--
--     drop trigger if exists trg_characters_sealed_prefix on public.characters;
--
-- WHAT ROLLING BACK COSTS. Any `sessionSeal` events already written stay in their characters' logs and
-- remain undo barriers in the tools (js/engine.js treats the type as a barrier regardless of the
-- database). They simply stop being ENFORCED. That is the correct direction to fail: histories that
-- were sealed are still marked as sealed and still resist undo, they are just no longer proof against
-- a determined stale write. Nothing needs deleting and no character is damaged by leaving them.
--
-- dm_edit_character_log() is restored to its pre-seal allow-list. Run this only if you also want to
-- stop DMs appending seals through that path; leaving the newer version in place is harmless, since a
-- seal with nothing enforcing it is just an inert marker.

begin;

-- 1. The enforcement. This is the one that changes live behaviour.
drop trigger if exists trg_characters_sealed_prefix on public.characters;
drop function if exists public.pact_enforce_sealed_prefix();

-- 2. The write paths. Inert once nothing calls them, dropped for tidiness.
drop function if exists public.award_ap_and_seal(uuid, integer, text, text);
drop function if exists public.seal_character_history(uuid, text, text);
drop function if exists public.pact_sealed_floor(jsonb);

-- 3. dm_edit_character_log() back to its 2026-08-10 allow-list (no 'sessionSeal').
--    Byte-identical to sql/migrations/2026-08-10-dm-edit-character-log.sql.
create or replace function public.dm_edit_character_log(p_character uuid, p_events jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign uuid;
  v_stats    jsonb;
  v_log      jsonb;
  v_seq      integer;
  v_new      jsonb := '[]'::jsonb;
  v_ev       jsonb;
  v_type     text;
  v_cat      text;
  v_ts       bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events) = 0 then
    raise exception 'p_events must be a non-empty JSON array';
  end if;

  select campaign_id, stats into v_campaign, v_stats from characters where id = p_character for update;
  if not found then
    raise exception 'Character not found';
  end if;
  if v_campaign is null then
    raise exception 'Character is not in a campaign';
  end if;
  if not is_campaign_dm(v_campaign) then
    raise exception 'Only a campaign DM can edit this character';
  end if;
  if v_stats is null or not (v_stats ? 'LOG') then
    raise exception 'Character has no log to edit';
  end if;

  v_log := coalesce(v_stats->'LOG', '[]'::jsonb);
  v_seq := coalesce((v_stats->>'SEQ')::integer, jsonb_array_length(v_log) + 1);

  for v_ev in select * from jsonb_array_elements(p_events) loop
    v_type := v_ev->>'type';
    v_cat  := v_ev->>'cat';
    if v_type = 'buy' then
      if v_cat is distinct from 'boon' and v_cat is distinct from 'drawback' then
        raise exception 'dm_edit_character_log: unsupported buy category %', v_cat;
      end if;
    elsif v_type not in ('award', 'dmRemoveBoon') then
      raise exception 'dm_edit_character_log: unsupported event type %', v_type;
    end if;

    v_ev := (v_ev - 'seq' - 'ts' - 'dmEdit' - 'dmId')
      || jsonb_build_object('seq', v_seq, 'ts', v_ts, 'dmEdit', true, 'dmId', auth.uid());
    v_new := v_new || jsonb_build_array(v_ev);
    v_seq := v_seq + 1;
  end loop;

  v_log := v_log || v_new;
  v_stats := jsonb_set(jsonb_set(v_stats, '{LOG}', v_log), '{SEQ}', to_jsonb(v_seq));

  update characters set stats = v_stats where id = p_character;
  return v_new;
end;
$$;

grant execute on function public.dm_edit_character_log(uuid, jsonb) to authenticated;
revoke execute on function public.dm_edit_character_log(uuid, jsonb) from public;

commit;
