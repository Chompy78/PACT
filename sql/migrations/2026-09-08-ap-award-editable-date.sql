-- feat/dm-ap-award-filters, item 4 (2026-09-08)
--
-- Makes ap_awards.created_at directly editable via edit_ap_award(), per owner decision "A": a DM
-- may rewrite an award's date/time, not just its amount/note. Owner's own words: "a lot are
-- awarded at the same second and the ordering makes it hard for me to understand" - confirmed live:
-- one bulk award batch has 24 rows sharing the exact same created_at down to the microsecond
-- (2026-08-10 11:58:58.142556+00).
--
-- Explicitly the option that trades away audit precision (option B, a separate occurred_at field
-- leaving created_at untouched, was offered and not chosen): ap_award_edits' own before/after
-- ordering is no longer fully reliable once the column it orders by can itself be rewritten. Owner
-- was told this plainly before choosing. Recorded in decisions/2026/D-GH-2026-09-08-ap-award-editing.md
-- as an addendum, not a new record - this amends that same feature, doesn't replace it.
--
-- Shape: edit_ap_award() gains a 5th parameter, p_new_created_at timestamptz, NULLABLE - passing
-- NULL means "don't touch the date", so an amount/note-only edit (the common case) is unaffected.
-- ap_award_edits gains old_created_at/new_created_at, both nullable for the same reason: a row only
-- carries them when the date was actually part of that edit.
--
-- Blast radius: 0 of 35 characters / 52 existing ap_awards rows affected (additive columns, a
-- function signature change with the old 4-arg version dropped and replaced - the ONLY caller is
-- editApAward() in js/dm.js, updated in the same change, so nothing else can be mid-call against
-- the old signature).

alter table public.ap_award_edits
  add column if not exists old_created_at timestamptz,
  add column if not exists new_created_at timestamptz;

drop function if exists public.edit_ap_award(uuid, integer, text, text);
create or replace function public.edit_ap_award(
  p_award_id        uuid,
  p_new_amount      integer,
  p_new_note        text,
  p_new_created_at  timestamptz,
  p_edit_note       text
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
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

revoke execute on function public.edit_ap_award(uuid, integer, text, timestamptz, text) from public;
grant  execute on function public.edit_ap_award(uuid, integer, text, timestamptz, text) to authenticated;
