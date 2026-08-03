-- PACT — collapse an invite's two AP fields into ONE grant, paid as DM AP.
-- D-GH-2026-08-03-invite-single-ap-grant.
--
-- WHY. An invite carried two numbers: `starting_ap` (paid into characters.ap — DM-authoritative,
-- server-side) and `starting_budget` (returned to the client, which seeded it into the character's
-- LOG as an `award` event — i.e. PLAYER AP). compute() resolves
--   spendable = (ignorePlayerAp ? 0 : playerAp) + dmAp
-- so on any campaign with `ignore_player_ap = true`, the entire Creation budget was granted and then
-- immediately discarded. Observed in production: Amble issued 36 + 55, the player could spend 36, and
-- the UI announced "created with 55 AP budget" — a grant the campaign's own setting voids. The two
-- features were in direct contradiction.
--
-- Both fields are now folded into a single DM-AP grant. DM AP is the right pool for a DM-issued
-- allowance regardless of the toggle, and unlike a LOG award event the player cannot edit or undo it.
--
-- DELIBERATELY NOT DROPPING `campaign_invites.starting_budget`. Dropping a column is irreversible and
-- buys nothing here; it stays, defaults to 0, and is written 0 from now on. Both functions fold
-- (starting_ap + starting_budget) so invites created BEFORE this migration and redeemed AFTER it still
-- pay out their full intended amount rather than silently losing the budget half.
--
-- SIGNATURES ARE UNCHANGED, on purpose. GitHub Pages deploys are not atomic with a DB migration, so
-- the old client keeps calling create_player_invite(campaign, ap, budget) for a while — folding server
-- side means it keeps working and just produces a single-pool invite. In the other direction an old
-- client redeeming a NEW invite receives starting_budget = 0, seeds no player-AP award, and reads the
-- whole grant from `ap`. Both directions degrade correctly; adding an arity-2 overload instead would
-- have made the defaulted 3-arg call ambiguous.

create or replace function public.create_player_invite(
  p_campaign_id     uuid,
  p_starting_ap     integer default 0,
  p_starting_budget integer default 0   -- DEPRECATED: folded into p_starting_ap; kept for old clients
)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_token text;
  v_ap    integer := coalesce(p_starting_ap, 0);
  v_extra integer := coalesce(p_starting_budget, 0);
begin
  if not is_campaign_dm(p_campaign_id) then
    raise exception 'Only a campaign DM can create a player invite';
  end if;
  -- Checked BEFORE folding: two values that sum to a non-negative total must still each be
  -- non-negative, or a negative budget could quietly cancel part of a positive AP grant.
  if v_ap < 0 or v_extra < 0 then
    raise exception 'Starting AP must be non-negative';
  end if;
  v_ap := v_ap + v_extra;

  loop
    v_token := encode(extensions.gen_random_bytes(16), 'hex');
    exit when not exists (select 1 from campaign_invites where token = v_token);
  end loop;

  insert into campaign_invites (campaign_id, token, starting_ap, starting_budget, created_by)
    values (p_campaign_id, v_token, v_ap, 0, auth.uid());

  return v_token;
end;
$$;

create or replace function public.redeem_player_invite(p_token text, p_name text default null)
returns table(character_id uuid, starting_ap integer, starting_budget integer, campaign_id uuid, is_new boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_invite  campaign_invites%rowtype;
  v_char_id uuid;
  v_name    text;
  v_grant   integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update campaign_invites
    set redeemed_by = auth.uid(), redeemed_at = now()
    where token = p_token and redeemed_by is null
    returning * into v_invite;

  if found then
    if is_campaign_member(v_invite.campaign_id) then
      raise exception 'You have already joined this campaign';
    end if;

    -- Single pool. The fold covers pre-migration invites, whose budget half would otherwise vanish.
    v_grant := coalesce(v_invite.starting_ap, 0) + coalesce(v_invite.starting_budget, 0);

    v_name := nullif(trim(coalesce(p_name, '')), '');
    if v_name is null then v_name := 'New Character'; end if;
    if length(v_name) > 100 then v_name := left(v_name, 100); end if;

    begin
      insert into characters (owner_id, campaign_id, name, kind, ap)
        values (auth.uid(), v_invite.campaign_id, v_name, 'chargen', v_grant)
        returning id into v_char_id;
    exception when unique_violation then
      raise exception 'You have already joined this campaign';
    end;

    -- starting_budget is returned as 0 so no client, old or new, seeds a player-AP award event.
    return query select v_char_id, v_grant, 0, v_invite.campaign_id, true;
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

  v_grant := coalesce(v_invite.starting_ap, 0) + coalesce(v_invite.starting_budget, 0);
  return query select v_char_id, v_grant, 0, v_invite.campaign_id, false;
end;
$$;

comment on column public.campaign_invites.starting_budget is
  'DEPRECATED (2026-08-03, D-GH-2026-08-03-invite-single-ap-grant). Always written 0. An invite now '
  'carries a single AP grant in starting_ap, paid into characters.ap. Both RPCs still ADD this column '
  'in so pre-migration invites redeem at their full intended amount. Kept, not dropped, so the change '
  'stays reversible.';
