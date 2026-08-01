-- Feature: DM Console — cloud roster gains a "remove from campaign" action plus
-- DM-private per-character annotations (player-name label + freeform notes).
--
-- (1) Removing a character from a campaign had NO write path at all before this —
--     `characters.campaign_id` is set only by join_campaign()/bind_character_to_campaign()
--     (both SECURITY DEFINER); there was never a corresponding "unset" RPC, and
--     characters_update's row policy is owner-only (rls-policies.sql), so a DM
--     cannot touch a player's row directly even via a column grant. dm_unbind_character()
--     mirrors award_ap()'s shape: SECURITY DEFINER, checks is_campaign_dm() on the
--     character's CURRENT campaign, then clears campaign_id. This is a soft "kick" —
--     the character and all its data (stats/LOG, AP total) survive untouched; it just
--     stops being any campaign's roster member (matches archive_campaign's reversible
--     spirit, though there's no "un-unbind" — the player would need a fresh invite/join).
--
-- (2) character_dm_notes is a new, separate table (not new columns on `characters`)
--     specifically so these stay invisible to the character's own owner: `characters`
--     has a blanket `select` grant (rls-policies.sql line ~81) with only ROW-level
--     filtering, so any new column there would be readable by the owner the moment
--     their row-select policy passes (`owner_id = auth.uid()`) — Postgres RLS can't
--     hide individual columns within a row a policy already allows. A dedicated table
--     with its own DM-only policy sidesteps that entirely. Permission is evaluated via
--     a live join to the character's CURRENT campaign_id (is_campaign_dm_of_character),
--     not a denormalized/cached campaign_id on this table — so notes automatically stop
--     being visible to the old DM the moment a character is unbound (1) or re-bound to
--     a different campaign, instead of leaking a stale campaign association.

-- ---------------------------------------------------------------------------
-- (1) dm_unbind_character — the ONLY way to clear characters.campaign_id once set.
-- ---------------------------------------------------------------------------
create or replace function public.dm_unbind_character(p_character uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign uuid;
begin
  select campaign_id into v_campaign from characters where id = p_character;
  if v_campaign is null then
    raise exception 'Character is not in a campaign';
  end if;
  if not is_campaign_dm(v_campaign) then
    raise exception 'Only a campaign DM can remove a character from the campaign';
  end if;

  update characters set campaign_id = null where id = p_character;
end;
$$;

revoke all on function public.dm_unbind_character(uuid) from public;
grant execute on function public.dm_unbind_character(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- (2) character_dm_notes — DM-only per-character annotations. One row per
-- character, created/updated via upsert from the DM Console (no RPC needed —
-- this table's own RLS policy, not a column-grant workaround, is what scopes it).
-- ---------------------------------------------------------------------------
create table if not exists public.character_dm_notes (
  character_id uuid primary key references public.characters(id) on delete cascade,
  player_label text,
  notes        text,
  updated_at   timestamptz not null default now()
);

alter table public.character_dm_notes enable row level security;

drop trigger if exists trg_character_dm_notes_updated_at on public.character_dm_notes;
create trigger trg_character_dm_notes_updated_at
  before update on public.character_dm_notes
  for each row execute function public.set_updated_at();

-- SECURITY DEFINER helper (same rationale as is_campaign_dm/is_campaign_member above:
-- a policy subquery against `characters` would otherwise be subject to characters' OWN
-- RLS, which is fine in principle here but this keeps the policy body a single call and
-- matches the file's existing style of factoring cross-table checks into helpers).
create or replace function public.is_campaign_dm_of_character(p_character uuid)
returns boolean language sql security definer stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from characters c
    join campaign_dms d on d.campaign_id = c.campaign_id
    where c.id = p_character and d.dm_id = auth.uid()
  );
$$;

drop policy if exists character_dm_notes_all on public.character_dm_notes;
create policy character_dm_notes_all on public.character_dm_notes
  for all using (is_campaign_dm_of_character(character_id))
  with check (is_campaign_dm_of_character(character_id));

grant select, insert, update, delete on public.character_dm_notes to authenticated;

revoke all on function public.is_campaign_dm_of_character(uuid) from public;
grant execute on function public.is_campaign_dm_of_character(uuid) to authenticated;
