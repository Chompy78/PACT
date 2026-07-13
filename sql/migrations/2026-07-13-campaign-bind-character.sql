-- PACT — Campaign join/invite UI, Deliverable 2 (Path B): bind an existing character
-- Run ONCE in the Supabase SQL editor on an existing PACT database.
-- Idempotent: safe to re-run. Fresh installs get this from schema.sql / rls-policies.sql
-- instead; this file only patches a DB created before this change.
--
-- A player with an already-built character binds it to a campaign via the campaign's
-- EXISTING shared invite_code (reused, not the per-player campaign_invites token from
-- Deliverable 1/Path A — that mechanism is for brand-new characters with a DM-preset
-- budget; this one is for a character that already exists). See docs/plans/2026-07-11-
-- campaign-join-invite-flow.md, Revision 4 (Path B section), for the full design.
--
-- Rebind contract (Revision 2 decision 2): bind only if the character's campaign_id
-- IS NULL; already bound to the SAME campaign is an idempotent no-op success; bound to
-- a DIFFERENT campaign is rejected outright (no transfer/leave-campaign feature in v1).

-- ===========================================================================
-- One-character-per-player-per-campaign, enforced at the database level.
-- join_campaign(), redeem_player_invite(), and bind_character_to_campaign() each
-- have their own EXISTS-then-write check for this (a UX fast-path with a friendly
-- error), but none of those checks lock the row they read — two concurrent calls
-- for the same owner/campaign (double-click, two tabs, or two different unbound
-- characters) can both pass the check before either write commits. This unique
-- partial index closes that race for all three functions at once: only one row
-- per (owner_id, campaign_id) pair can exist once campaign_id is set.
-- ===========================================================================
create unique index if not exists idx_characters_owner_campaign_unique
  on public.characters(owner_id, campaign_id) where campaign_id is not null;

-- drop first: return type changes void -> uuid, and CREATE OR REPLACE can't alter one.
drop function if exists public.bind_character_to_campaign(uuid, text);
create or replace function public.bind_character_to_campaign(p_character_id uuid, p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_campaign campaigns%rowtype;
  v_char     characters%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_char from characters where id = p_character_id and owner_id = auth.uid();
  if not found then
    raise exception 'Character not found';
  end if;

  select * into v_campaign from campaigns where invite_code = upper(p_code);
  if not found then
    raise exception 'No campaign with that invite code';
  end if;

  if v_char.campaign_id = v_campaign.id then
    return v_campaign.id;   -- already bound to this campaign -- idempotent no-op, matches join_campaign's style
  end if;
  if v_char.campaign_id is not null then
    raise exception 'This character is already bound to a different campaign';
  end if;

  if exists (select 1 from characters where campaign_id = v_campaign.id and owner_id = auth.uid()) then
    raise exception 'You have already joined this campaign with another character';
  end if;

  -- The EXISTS check above is the friendly-message fast path; the unique index is the
  -- authoritative guarantee for the race window between that check and this write.
  begin
    update characters set campaign_id = v_campaign.id where id = p_character_id;
  exception when unique_violation then
    raise exception 'You have already joined this campaign with another character';
  end;

  return v_campaign.id;
end;
$$;

grant execute on function public.bind_character_to_campaign(uuid, text) to authenticated;
revoke execute on function public.bind_character_to_campaign(uuid, text) from public;
