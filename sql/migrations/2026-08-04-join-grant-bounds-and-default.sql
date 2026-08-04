-- 2026-08-04 — bind_character_to_campaign: default the join grant, and bound the numeric parse.
--
-- Follow-up to 2026-08-04-campaign-starting-ap-on-join.sql. Two defects in that version's
-- defensive read of rules.startingTier.ap, both found by review rather than by a user report:
--
--  1. ABSENT ≠ ZERO. `rules` is `not null default '{}'::jsonb` and createCampaign() inserts only
--     {name, dm_id}, so a campaign whose DM never opened the advancement card has no startingTier
--     key at all. The old code fell through the `~ '^[0-9]+$'` test and granted nothing — while DM
--     Console's own Starting AP field sat there showing 79. On this database 3 of 4 live campaigns
--     were in exactly that state. Absent now means 79, the number the UI has always displayed.
--
--  2. '^[0-9]+$' IS NOT A RANGE CHECK. It accepts '2147483648'; the following ::integer cast then
--     overflows and aborts the transaction, so a junk rules blob could hard-fail the join — the
--     precise failure the defensive read was written to prevent. Bounding the match to 7 digits
--     makes the cast unable to overflow, and anything else grants 0 instead of raising.
--
-- The grant block is also lifted out of the parse branch so all three cases share one guarded payout.
-- Idempotent: create or replace, same signature (uuid, text) — no new overload.

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

  v_start_txt := nullif(trim(coalesce(v_campaign.rules -> 'startingTier' ->> 'ap', '')), '');
  if v_start_txt is null then
    v_start := 79;                       -- no tier saved: keep the promise the UI makes
  elsif v_start_txt ~ '^[0-9]{1,7}$' then
    v_start := v_start_txt::integer;     -- bounded, so ::integer cannot overflow and abort the bind
  else
    v_start := 0;                        -- malformed: grant nothing, never block the join
  end if;

  if v_start > 0
     and not exists (select 1 from ap_awards
                      where character_id = p_character_id and campaign_id = v_campaign.id) then
    update characters set ap = ap + v_start where id = p_character_id;
    insert into ap_awards (character_id, dm_id, campaign_id, amount, note)
      values (p_character_id, v_campaign.dm_id, v_campaign.id, v_start,
              'Starting AP (joined by campaign code)');
  end if;

  return v_campaign.id;
end;
$$;
