-- PACT — de-duplicate campaign-membership SQL checks
-- Run ONCE in the Supabase SQL editor on an existing PACT database.
-- Idempotent: safe to re-run. Fresh installs get this from schema.sql / rls-policies.sql
-- instead; this file only patches a DB created before this change.
--
-- Pure internal refactor, no behavior change: join_campaign, redeem_player_invite, and
-- bind_character_to_campaign each hand-rolled their own "look up campaign by shared
-- invite_code" and "does this owner already have a character in this campaign" checks.
-- Found during /code-review ultra on PR #202 (campaign-bind-character) — Reuse and
-- Altitude angles both flagged it independently; deferred out of that PR's scope since
-- fixing it meant touching two already-shipped functions. See DECISIONS.md
-- D-GH-2026-07-13-campaign-bind-character (Status/follow-up) and
-- D-GH-2026-07-13-campaign-membership-helpers for the full write-up.
--
-- Exact existing error messages/behavior are preserved. The unique partial index added
-- in the 2026-07-13 campaign-bind-character migration
-- (idx_characters_owner_campaign_unique) is already the authoritative race guard for all
-- three functions — this migration is about code duplication only, not correctness.
--
-- None of the three touched functions change return type, so no `drop function` is
-- needed before `create or replace function` on any of them.

-- ===========================================================================
-- New internal helpers. Not SECURITY DEFINER themselves: called only from
-- inside the SECURITY DEFINER RPCs below, they run under that outer function's
-- already-elevated context, so no separate elevation is needed. Deliberately
-- not granted to authenticated/public (see revokes at the end of this file)
-- so they can't be invoked directly as a standalone client RPC.
-- ===========================================================================
create or replace function public.find_campaign_by_invite_code(p_code text)
returns campaigns language plpgsql set search_path = public as $$
declare v_campaign campaigns%rowtype;
begin
  select * into v_campaign from campaigns where invite_code = upper(p_code);
  if not found then
    raise exception 'No campaign with that invite code';
  end if;
  return v_campaign;
end;
$$;

create or replace function public.owner_has_character_in_campaign(p_campaign uuid, p_owner uuid)
returns boolean language sql set search_path = public as $$
  select exists (select 1 from characters where campaign_id = p_campaign and owner_id = p_owner);
$$;

-- ===========================================================================
-- join_campaign — now delegates its lookup/check to the helpers above.
-- ===========================================================================
create or replace function public.join_campaign(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_campaign campaigns%rowtype;
  v_char_id  uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  v_campaign := find_campaign_by_invite_code(p_code);

  if owner_has_character_in_campaign(v_campaign.id, auth.uid()) then
    raise exception 'You have already joined this campaign';
  end if;

  insert into characters (owner_id, campaign_id, name)
  values (auth.uid(), v_campaign.id, 'New Character')
  returning id into v_char_id;

  return v_campaign.id;   -- caller can now read the campaign via RLS (member)
end;
$$;

-- ===========================================================================
-- redeem_player_invite — same "already joined" check, now delegated.
-- ===========================================================================
create or replace function public.redeem_player_invite(p_token text, p_name text default null)
returns table(character_id uuid, starting_ap integer, starting_budget integer, campaign_id uuid, is_new boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_invite  campaign_invites%rowtype;
  v_char_id uuid;
  v_name    text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update campaign_invites
    set redeemed_by = auth.uid(), redeemed_at = now()
    where token = p_token and redeemed_by is null
    returning * into v_invite;

  if found then
    if owner_has_character_in_campaign(v_invite.campaign_id, auth.uid()) then
      raise exception 'You have already joined this campaign';
    end if;

    v_name := nullif(trim(coalesce(p_name, '')), '');
    if v_name is null then v_name := 'New Character'; end if;
    if length(v_name) > 100 then v_name := left(v_name, 100); end if;

    insert into characters (owner_id, campaign_id, name, kind, ap)
      values (auth.uid(), v_invite.campaign_id, v_name, 'chargen', v_invite.starting_ap)
      returning id into v_char_id;

    return query select v_char_id, v_invite.starting_ap, v_invite.starting_budget, v_invite.campaign_id, true;
    return;
  end if;

  select * into v_invite from campaign_invites where token = p_token and redeemed_by = auth.uid();
  if not found then
    raise exception 'Invite is invalid or already redeemed';
  end if;

  select id into v_char_id from characters
    where owner_id = auth.uid() and campaign_id = v_invite.campaign_id
    limit 1;
  if v_char_id is null then
    raise exception 'Invite already redeemed but character not found';
  end if;

  return query select v_char_id, v_invite.starting_ap, v_invite.starting_budget, v_invite.campaign_id, false;
end;
$$;

-- ===========================================================================
-- bind_character_to_campaign — both checks now delegated.
-- ===========================================================================
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

  v_campaign := find_campaign_by_invite_code(p_code);

  if v_char.campaign_id = v_campaign.id then
    return v_campaign.id;
  end if;
  if v_char.campaign_id is not null then
    raise exception 'This character is already bound to a different campaign';
  end if;

  if owner_has_character_in_campaign(v_campaign.id, auth.uid()) then
    raise exception 'You have already joined this campaign with another character';
  end if;

  begin
    update characters set campaign_id = v_campaign.id where id = p_character_id;
  exception when unique_violation then
    raise exception 'You have already joined this campaign with another character';
  end;

  return v_campaign.id;
end;
$$;

-- ===========================================================================
-- Lock down the new helpers: Postgres grants EXECUTE to PUBLIC by default on
-- every new function; revoke it so these are unreachable as standalone client
-- RPCs (they're only ever called from inside the SECURITY DEFINER functions
-- above). No grant to authenticated either — unlike is_campaign_dm() etc.,
-- these are never called from an RLS policy's USING clause, so the invoking
-- role never needs its own EXECUTE on them.
-- ===========================================================================
revoke execute on function public.find_campaign_by_invite_code(text) from public;
revoke execute on function public.owner_has_character_in_campaign(uuid, uuid) from public;
