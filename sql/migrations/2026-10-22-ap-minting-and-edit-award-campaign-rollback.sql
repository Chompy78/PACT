-- PACT — rollback of 2026-10-22-ap-minting-and-edit-award-campaign.sql (D-GH-2026-10-22-ap-minting-and-edit-award-campaign).
-- Drops the campaign-move trigger and its function and restores edit_ap_award() exactly as it was live on 2026-10-22 (copied
-- verbatim from rls-policies.sql at that commit; run-ap-minting.sh checks pg_get_functiondef is byte-identical afterwards).
-- After a rollback both holes are open again: ap/gold carry between campaigns, and a former DM can edit an award of a character
-- that has moved.

drop trigger if exists trg_pact_aa_reset_grants_on_campaign_move on public.characters;
drop function if exists public.pact_reset_campaign_grants_on_move();

create or replace function public.edit_ap_award(
  p_award_id       uuid,
  p_new_amount     integer,
  p_new_note       text,
  p_new_created_at timestamptz,
  p_edit_note      text
)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_character      uuid;
  v_campaign       uuid;
  v_old_amount     integer;
  v_old_note       text;
  v_old_created_at timestamptz;
  v_delta          integer;
  v_ap             integer;
begin
  if p_edit_note is null or btrim(p_edit_note) = '' then
    raise exception 'An edit note is required';
  end if;

  select character_id, campaign_id, amount, note, created_at
    into v_character, v_campaign, v_old_amount, v_old_note, v_old_created_at
    from ap_awards where id = p_award_id;

  if v_character is null then
    raise exception 'Award not found';
  end if;
  if v_campaign is null then
    raise exception 'Award has no campaign context';
  end if;
  if not is_campaign_dm(v_campaign) then
    raise exception 'Only a campaign DM can edit an AP award';
  end if;
  perform assert_campaign_active(v_campaign);

  v_delta := p_new_amount - v_old_amount;

  insert into ap_award_edits
    (award_id, character_id, campaign_id, dm_id, old_amount, old_note, new_amount, new_note,
     old_created_at, new_created_at, edit_note)
    values
    (p_award_id, v_character, v_campaign, auth.uid(), v_old_amount, v_old_note, p_new_amount, p_new_note,
     case when p_new_created_at is not null then v_old_created_at else null end,
     p_new_created_at,
     p_edit_note);

  update ap_awards
    set amount = p_new_amount,
        note = p_new_note,
        created_at = coalesce(p_new_created_at, created_at)
    where id = p_award_id;

  update characters set ap = ap + v_delta
    where id = v_character
    returning ap into v_ap;
  return v_ap;
end;
$$;

revoke all on function public.edit_ap_award(uuid, integer, text, timestamptz, text) from public, anon;
grant execute on function public.edit_ap_award(uuid, integer, text, timestamptz, text) to authenticated;
