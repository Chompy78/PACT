-- PACT — joining a campaign by its shared code grants the campaign's starting AP.
-- D-GH-2026-08-04-campaign-starting-ap.
--
-- WHY. There were two ways into a campaign and they behaved differently. redeem_player_invite creates a
-- character WITH its AP grant and records it in ap_awards; bind_character_to_campaign only ever did
-- `update characters set campaign_id = ...` and touched nothing else. A player who joined with the shared
-- code therefore landed on 0 AP, silently — no error, nothing on screen saying so, and the DM saw a
-- roster entry with no budget and no recorded reason. That is exactly what happened to Cedric Brightblade.
--
-- The amount is the campaign's OWN `rules.startingTier.ap` — the same figure that already pre-fills the
-- invite's Starting AP box. Reusing it rather than adding a second setting is the point: one number now
-- governs both routes in, so they cannot drift apart again.
--
-- WHEN IT GRANTS, precisely. Only on the path that actually binds a previously-unbound character:
--   * rebinding to the SAME campaign already returns early above, so a repeat call grants nothing;
--   * a character bound to a DIFFERENT campaign already raises;
--   * and the ap_awards guard below stops an unbind/rebind cycle from paying out twice.
-- The update is additive (`ap = ap + v_start`) so a character that already holds AP is topped up, never
-- clobbered.
--
-- ATTRIBUTION. The ap_awards row is credited to the campaign's DM, not to auth.uid() — the caller here is
-- the joining PLAYER, and recording them as the awarding DM would make the history actively misleading.
-- Same reasoning as D-GH-2026-08-03-invite-grant-award-row.

create or replace function public.bind_character_to_campaign(p_character_id uuid, p_code text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign campaigns%rowtype;
  v_char     characters%rowtype;
  v_start_txt text;
  v_start     integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_char from characters where id = p_character_id and owner_id = auth.uid();
  if not found then
    raise exception 'Character not found';
  end if;

  v_campaign := find_campaign_by_invite_code(p_code);

  if v_char.campaign_id = v_campaign.id then
    return v_campaign.id;
  end if;
  if v_char.campaign_id is not null then
    raise exception 'This character is already bound to a different campaign';
  end if;

  if is_campaign_member(v_campaign.id) then
    raise exception 'You have already joined this campaign with another character';
  end if;

  begin
    update characters set campaign_id = v_campaign.id where id = p_character_id;
  exception when unique_violation then
    raise exception 'You have already joined this campaign with another character';
  end;

  -- Starting AP. Read defensively: `rules` is free-form jsonb a DM edits, so the tier figure may be
  -- absent, empty, or a non-numeric string. Anything that isn't a plain non-negative integer grants
  -- nothing rather than erroring the join — a malformed rules blob must not block a player joining.
  v_start_txt := nullif(trim(coalesce(v_campaign.rules -> 'startingTier' ->> 'ap', '')), '');
  if v_start_txt ~ '^[0-9]+$' then
    v_start := v_start_txt::integer;
    if v_start > 0
       and not exists (select 1 from ap_awards
                        where character_id = p_character_id and campaign_id = v_campaign.id) then
      update characters set ap = ap + v_start where id = p_character_id;
      insert into ap_awards (character_id, dm_id, campaign_id, amount, note)
        values (p_character_id, v_campaign.dm_id, v_campaign.id, v_start,
                'Starting AP (joined by campaign code)');
    end if;
  end if;

  return v_campaign.id;
end;
$$;
