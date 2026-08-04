-- 2026-08-04 — bind_character_to_campaign: an unconfigured campaign grants NOTHING.
--
-- Reverses the `absent -> 79` default introduced hours earlier in
-- 2026-08-04-join-grant-bounds-and-default.sql. That change was made on the reasoning that DM Console
-- displays 79, so granting 0 broke a promise the interface had made.
--
-- The reasoning was wrong. The 79 is a hardcoded `value="79"` attribute on the input element — a
-- placeholder the HTML ships with, not a saved setting — and the whole panel lives inside a COLLAPSED
-- <details>. A DM who has never expanded "Level budget curve · award pace · starting tier" has never
-- seen the field at all, so there was no promise to keep. Paying out a full level-1 budget on the
-- strength of a placeholder is the larger error, and it applied to every campaign created before the
-- advancement dials existed.
--
-- Absent now means absent. A DM opts in by saving a tier, and the rebuilt DM Console panel always
-- writes an explicit `ap` when rules are saved — so a campaign whose rules have been saved even once
-- is never in the ambiguous state again.
--
-- Unchanged from the previous version: the 7-digit length bound (so a junk rules blob cannot overflow
-- ::integer and abort the join), grant-only-on-first-bind, and the ap_awards double-pay guard.
--
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

  -- absent / empty / malformed all grant 0; only a saved, plainly-numeric, in-range figure pays out.
  v_start_txt := nullif(trim(coalesce(v_campaign.rules -> 'startingTier' ->> 'ap', '')), '');
  if v_start_txt is not null and v_start_txt ~ '^[0-9]{1,7}$' then
    v_start := v_start_txt::integer;
  else
    v_start := 0;
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
