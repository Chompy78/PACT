-- Feature: DM Console — campaign-level custom character fields (2 numeric + 2 text
-- slots, defined once per campaign) plus a per-character value store and a
-- player-visibility read path.
--
-- Design (see decisions/2026/D-GH-2026-08-10-dm-custom-character-fields.md):
--   * DEFINITIONS are campaign-level, not per-character — they live inside the
--     existing `campaigns.rules` jsonb settings blob (already the DM-authoritative
--     campaign-rules column per D-GH14; no new column needed) under a new
--     `rules.customFields` key, shaped as an object keyed by a fixed slot id:
--       { num1: {label, visible}, num2: {...}, text1: {...}, text2: {...} }
--     `visible` defaults to false (DM-only) at the application layer — every slot
--     is absent/false until a DM opts it in.
--   * VALUES are per-character. They ride the existing `character_dm_notes` table
--     (DM-only per-character annotations, D-GH-2026-08-01) as a new `custom_fields`
--     jsonb column keyed by the same slot ids — this table's RLS is already
--     DM-only-for-this-character, so no new table or policy is needed for the
--     DM-write path.
--   * The `visible` flag needs real teeth, not just a UI label: because
--     character_dm_notes' RLS is DM-only, a player currently has zero read access
--     to it — so exposing "visible" fields to a player needs a dedicated read path,
--     not a wider table grant (a wider grant would leak every hidden field's raw
--     value too, since RLS is row-level, not per-JSON-key). get_character_visible_fields()
--     is a SECURITY DEFINER RPC: for the character's own owner, it returns only the
--     slots the campaign's rules mark visible; for a campaign DM it returns
--     everything (they already have raw table access, so filtering would just be a
--     confusing extra hop). No tool UI calls this RPC yet — DM Console (this
--     feature's actual UI surface) doesn't need it, since a DM always sees
--     everything already. It exists so the "show players or not" toggle is a real,
--     enforced contract at the data layer the moment any player-facing surface
--     (e.g. Live Sheet's own-character view) wants to consume it — see
--     docs/TASK_BOARD_NEXT.md's feat/custom-fields-player-display follow-up.

alter table public.character_dm_notes
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;

create or replace function public.get_character_visible_fields(p_character uuid)
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
declare
  v_campaign uuid;
  v_owner    uuid;
  v_rules    jsonb;
  v_values   jsonb;
  v_out      jsonb := '{}'::jsonb;
  v_key      text;
begin
  select campaign_id, owner_id into v_campaign, v_owner from characters where id = p_character;
  if v_campaign is null then
    return '{}'::jsonb;   -- not campaign-bound: no campaign-level fields apply
  end if;
  if not (v_owner = auth.uid() or is_campaign_dm(v_campaign)) then
    raise exception 'Not authorized to read this character''s custom fields';
  end if;

  -- A campaign DM already has raw table access to character_dm_notes.custom_fields —
  -- return it unfiltered rather than making them re-derive what they can already see.
  if is_campaign_dm(v_campaign) then
    select coalesce(custom_fields, '{}'::jsonb) into v_values
      from character_dm_notes where character_id = p_character;
    return coalesce(v_values, '{}'::jsonb);
  end if;

  select rules into v_rules from campaigns where id = v_campaign;
  select coalesce(custom_fields, '{}'::jsonb) into v_values
    from character_dm_notes where character_id = p_character;
  v_rules := coalesce(v_rules, '{}'::jsonb);
  v_values := coalesce(v_values, '{}'::jsonb);

  for v_key in select jsonb_object_keys(coalesce(v_rules->'customFields', '{}'::jsonb))
  loop
    if (v_rules->'customFields'->v_key->>'visible') = 'true' then
      v_out := v_out || jsonb_build_object(v_key, v_values->v_key);
    end if;
  end loop;
  return v_out;
end;
$$;

revoke all on function public.get_character_visible_fields(uuid) from public;
grant execute on function public.get_character_visible_fields(uuid) to authenticated;
