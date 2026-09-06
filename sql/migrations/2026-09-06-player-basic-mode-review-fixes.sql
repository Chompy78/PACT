-- feat/player-basic-mode — /code-review ultra fixes, found on PR #531 before merge.
--
-- CRITICAL: set_basic_mode()/unset_basic_mode() checked shares_campaign(p_player), not
-- is_campaign_dm-style DM authority. shares_campaign() also returns true for two ORDINARY
-- fellow-players in the same campaign (its "we both play in the same campaign" branch), and even
-- for "p_player DMs a campaign I play in" -- so any player could flag ANY other player they share a
-- campaign with, including their own DM. Decision A3 (decisions/2026/D-GH-2026-09-05-player-basic-mode.md)
-- requires "a DM sharing a campaign with the player" specifically, matching every other privileged RPC
-- in this codebase (award_ap, seal_character_history, etc. all check is_campaign_dm(campaign), never
-- shares_campaign()). This was live in production (applied via 2026-09-06-player-basic-mode.sql) before
-- being caught here -- fixed same-day, before any real use of set_basic_mode() occurred.
--
-- New helper mirrors shares_campaign()'s own first branch exactly (the one and only branch that
-- actually means "auth.uid() is a DM of a campaign p_player plays in"), rather than reusing
-- shares_campaign() itself, since none of its other three branches belong in an authority check.
create or replace function public.is_dm_of_player(p_player uuid)
returns boolean language sql security definer stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from campaign_dms d join characters ch on ch.campaign_id = d.campaign_id
      where d.dm_id = auth.uid() and ch.owner_id = p_player
  );
$$;

revoke all on function public.is_dm_of_player(uuid) from public, anon;
grant execute on function public.is_dm_of_player(uuid) to authenticated;

create or replace function public.set_basic_mode(p_player uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_dm_of_player(p_player) then
    raise exception 'PACT: only a DM sharing a campaign with this player can turn on basic mode';
  end if;
  update profiles
    set basic_mode = true, basic_mode_set_by = auth.uid(), basic_mode_set_at = now()
    where id = p_player;
  if not found then
    raise exception 'Player not found';
  end if;
end;
$$;

create or replace function public.unset_basic_mode(p_player uuid default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_target uuid := coalesce(p_player, auth.uid());
begin
  -- The player's own account is ALWAYS sufficient standing to turn their own flag off -- no DM
  -- check, no dependency on any DM's continued campaign membership. This is the whole point of A3.
  if v_target <> auth.uid() and not is_dm_of_player(v_target) then
    raise exception 'PACT: only the player themselves, or a DM sharing a campaign with them, can turn off basic mode';
  end if;
  update profiles
    set basic_mode = false, basic_mode_set_by = null, basic_mode_set_at = null
    where id = v_target;
  if not found then
    raise exception 'Player not found';
  end if;
end;
$$;

revoke all on function public.set_basic_mode(uuid) from public, anon;
grant execute on function public.set_basic_mode(uuid) to authenticated;
revoke all on function public.unset_basic_mode(uuid) from public, anon;
grant execute on function public.unset_basic_mode(uuid) to authenticated;
