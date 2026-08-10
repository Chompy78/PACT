-- PACT — let an invite link identify its campaign before it is redeemed.
-- feat/invite-peek-campaign-name (D-GH-2026-08-10-invite-peek-auth-scope).
--
-- WHY. CharGen's tryRedeem() confirm() dialog could not name the campaign an invite belonged to —
-- redeemPlayerInvite()'s response is the only place a campaign name has ever arrived, and asking to
-- accept AFTER redeeming would be confirming an act already taken. See the comment this migration makes
-- obsolete at tools/PACT-CharGen-Webtool.html's tryRedeem(): "The campaign's NAME is deliberately
-- absent... reading campaign_invites requires the `authenticated` role... giving anon a validity probe
-- would let anyone test tokens against the live database."
--
-- SCOPE DECISION (owner, 2026-08-10): authenticated-only, not anon-callable. This fixes the confirm()
-- naming case (a player is already signed in by the time this fires — see tryRedeem()'s own signed-out
-- branch, which returns before ever reaching a redemption attempt) but leaves the signed-out
-- "revoked link looks identical to a live one" case unfixed — anon still has no read path onto
-- campaign_invites at all. That is an accepted, explicit tradeoff: feat/invite-rate-limiting (a separate,
-- not-yet-built NEXT item) is the prerequisite for ever safely letting an unauthenticated caller probe
-- whether a token exists.
--
-- peek_player_invite(p_token) never redeems, never mutates anything — pure SELECT, SECURITY DEFINER only
-- so it can read campaign_invites/campaigns rows the caller's own RLS grants would not otherwise expose
-- (an invite to a campaign the caller hasn't joined yet). Mirrors redeem_player_invite's own lookup
-- (`token = p_token and type = 'player'`) and its validity criteria (unredeemed, unrevoked, unexpired) so
-- the two functions can never disagree about what "valid" means.

create or replace function public.peek_player_invite(p_token text)
returns table(campaign_name text, valid boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_invite campaign_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_invite from campaign_invites
    where token = p_token and type = 'player';

  if not found then
    -- Unknown token (typo, or never existed). No campaign name to give — distinct from "valid:false
    -- because expired/revoked/redeemed", which DOES know the name; the client can tell these apart.
    return query select null::text, false;
    return;
  end if;

  return query
    select c.name,
      (v_invite.redeemed_by is null and v_invite.revoked_at is null
       and (v_invite.expires_at is null or v_invite.expires_at > now()))
    from campaigns c where c.id = v_invite.campaign_id;
end;
$$;

grant execute on function public.peek_player_invite(text) to authenticated;
revoke execute on function public.peek_player_invite(text) from public;
