-- feat/dm-ap-award-editing (2026-09-08)
--
-- Adds the ability for a DM to EDIT an existing ap_awards row (amount + note) after the fact,
-- with a mandatory edit note and a full, append-only audit trail — rather than the only previous
-- option, which was award_ap() adding a NEW compensating award. Motivated by a real live bug found
-- and hand-corrected this session: a bulk "session 6" award landed as +4 AP on all six Amble
-- characters when it should have been +5 (a "4 + 1 bonus" note whose bonus was never actually
-- applied). Fixed by hand via direct SQL at the time; this migration gives the DM a supported,
-- audited way to do the same correction from DM Console instead.
--
-- Design, matching this project's existing "never delete, always append a correction" pattern
-- (see the locked-history trigger, pact_enforce_locked_history, discovered this same session):
--   * ap_award_edits is a NEW, append-only table — one row per edit, capturing the full before/after
--     state plus who made the change, when, and why (edit_note is NOT NULL: required, per owner
--     decision this session — "2: required").
--   * edit_ap_award() is the only write path (SECURITY DEFINER), mirroring award_ap()'s own
--     permission model exactly: only a DM of the award's campaign may call it, and the campaign
--     must be active (assert_campaign_active). It adjusts characters.ap by the DELTA (new − old),
--     not an overwrite, so it composes correctly with any other award made in between.
--   * ap_award_edits is readable by the same audience as ap_awards itself (the character's owner,
--     or any DM of its campaign) — per owner decision this session ("4: transparency"), a player
--     can see that one of their awards was corrected and why, not just DM-only bookkeeping.
--
-- Blast radius: 0 of 35 characters / 49 existing ap_awards rows affected — purely additive (one new
-- table, one new function, one new RLS policy). No existing read or write path is touched or
-- narrowed; award_ap() itself is completely unchanged.
--
-- Per sql/migrations/README.md: this file is a historical record only. The maintained baseline for
-- the function + RLS policy is sql/rls-policies.sql (folded in alongside this migration in the same
-- change); the table definition's maintained baseline is sql/schema.sql.

-- ---------------------------------------------------------------------------
-- ap_award_edits — append-only audit trail for edit_ap_award(). Never updated or deleted; a
-- re-edit of the same award is just another row.
-- ---------------------------------------------------------------------------
create table if not exists public.ap_award_edits (
  id           uuid primary key default gen_random_uuid(),
  award_id     uuid not null references public.ap_awards(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  campaign_id  uuid references public.campaigns(id) on delete set null,
  dm_id        uuid references public.profiles(id) on delete set null,
  old_amount   integer not null,
  old_note     text,
  new_amount   integer not null,
  new_note     text,
  edit_note    text not null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_ap_award_edits_award on public.ap_award_edits(award_id);
create index if not exists idx_ap_award_edits_char  on public.ap_award_edits(character_id);

alter table public.ap_award_edits enable row level security;

grant select on public.ap_award_edits to authenticated;  -- inserts via edit_ap_award() only

drop policy if exists ap_award_edits_select on public.ap_award_edits;
create policy ap_award_edits_select on public.ap_award_edits
  for select using (
    is_campaign_dm(campaign_id)
    or exists (select 1 from characters c where c.id = character_id and c.owner_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- edit_ap_award(award_id, new_amount, new_note, edit_note) — the ONLY way to change an existing
-- ap_awards row. Same permission shape as award_ap(): any DM of the award's (still-active) campaign.
-- Logs the full before/after to ap_award_edits, then applies the DELTA to characters.ap (not an
-- overwrite — composes correctly with any award made between the original and this edit).
-- ---------------------------------------------------------------------------
drop function if exists public.edit_ap_award(uuid, integer, text, text);
create or replace function public.edit_ap_award(
  p_award_id   uuid,
  p_new_amount integer,
  p_new_note   text,
  p_edit_note  text
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_character  uuid;
  v_campaign   uuid;
  v_old_amount integer;
  v_old_note   text;
  v_delta      integer;
  v_ap         integer;
begin
  if p_edit_note is null or btrim(p_edit_note) = '' then
    raise exception 'An edit note is required';
  end if;

  select character_id, campaign_id, amount, note
    into v_character, v_campaign, v_old_amount, v_old_note
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
    (award_id, character_id, campaign_id, dm_id, old_amount, old_note, new_amount, new_note, edit_note)
    values
    (p_award_id, v_character, v_campaign, auth.uid(), v_old_amount, v_old_note, p_new_amount, p_new_note, p_edit_note);

  update ap_awards set amount = p_new_amount, note = p_new_note
    where id = p_award_id;

  update characters set ap = ap + v_delta
    where id = v_character
    returning ap into v_ap;

  return v_ap;
end;
$$;

revoke execute on function public.edit_ap_award(uuid, integer, text, text) from public;
grant  execute on function public.edit_ap_award(uuid, integer, text, text) to authenticated;
