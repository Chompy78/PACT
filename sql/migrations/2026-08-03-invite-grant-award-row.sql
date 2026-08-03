-- PACT — an invite's starting AP grant is recorded in ap_awards, like every other DM award.
-- D-GH-2026-08-03-invite-grant-award-row.
--
-- WHY. `award_ap()` writes an ap_awards row (amount, note, which DM, when) before incrementing
-- characters.ap, so DM Console can show a per-character award history. `redeem_player_invite` did NOT:
-- it set characters.ap directly. Since D-GH-2026-08-03-invite-single-ap-grant made that grant the
-- character's ENTIRE starting AP, the one number that defines a new character had no provenance at all.
-- Observed: ap_awards held 0 rows campaign-wide while every character in the campaign carried AP.
--
-- This is not only an audit gap. Live Sheet's "clone to standalone" (D-GH-2026-07-11) converts a
-- campaign character's DM AP into itemized `award` log entries by reading getAwardHistory() — that being
-- the project's decided mechanism for moving AP out of the DM pool when the campaign link is severed.
-- With ap_awards empty, cloning produced a standalone character that silently lost its whole starting
-- grant. Recording the row here fixes that existing feature without touching it.
--
-- NOTE ON THE INVARIANT (js/engine.js, "ANTI-DOUBLE-COUNT INVARIANT"): this does NOT put dmAp anywhere
-- new. characters.ap remains the single authoritative store of DM AP; ap_awards is a provenance ledger
-- that explains it, and is only ever converted into log entries on a path that severs the campaign and
-- resets ap to 0 (the clone). Nothing here writes AP into a character's log or an export.

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

    -- Single pool. The fold covers pre-2026-08-03 invites, whose budget half would otherwise vanish.
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

    -- Provenance for the grant. Attributed to the DM who created the invite (campaign_invites.created_by)
    -- rather than auth.uid(), which here is the redeeming PLAYER — recording the player as the awarding
    -- DM would make the history actively misleading. Skipped when the grant is 0 so an unfunded invite
    -- doesn't litter the history with a meaningless row.
    if v_grant <> 0 then
      insert into ap_awards (character_id, dm_id, campaign_id, amount, note)
        values (v_char_id, v_invite.created_by, v_invite.campaign_id, v_grant, 'Starting AP (campaign invite)');
    end if;

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

  -- Idempotent replay: no second ap_awards row, or a double-click would double the recorded history
  -- (and the character's ap was only ever incremented once).
  v_grant := coalesce(v_invite.starting_ap, 0) + coalesce(v_invite.starting_budget, 0);
  return query select v_char_id, v_grant, 0, v_invite.campaign_id, false;
end;
$$;
