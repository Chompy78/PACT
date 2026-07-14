-- PACT — race-losing join_campaign/redeem_player_invite calls surface a friendly error
-- Run ONCE in the Supabase SQL editor on an existing PACT database.
-- Idempotent: safe to re-run (CREATE OR REPLACE, same signatures/return types as before).
-- Fresh installs get this from schema.sql instead; this file only patches a DB created
-- before this change.
--
-- join_campaign() and redeem_player_invite()'s character-insert had no unique_violation
-- handler, unlike bind_character_to_campaign() (D-GH-2026-07-13-campaign-bind-character).
-- A race that beats either RPC's is_campaign_member() pre-check hit the unique partial
-- index idx_characters_owner_campaign_unique and surfaced a raw Postgres "duplicate key
-- value violates unique constraint" error instead of the friendly "You have already
-- joined this campaign" message. See DECISIONS.md
-- D-GH-2026-07-13-campaign-join-race-friendly-error.

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

  if is_campaign_member(v_campaign.id) then
    raise exception 'You have already joined this campaign';
  end if;

  begin
    insert into characters (owner_id, campaign_id, name)
    values (auth.uid(), v_campaign.id, 'New Character')
    returning id into v_char_id;
  exception when unique_violation then
    raise exception 'You have already joined this campaign';
  end;

  return v_campaign.id;   -- caller can now read the campaign via RLS (member)
end;
$$;

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
    if is_campaign_member(v_invite.campaign_id) then
      raise exception 'You have already joined this campaign';
    end if;

    v_name := nullif(trim(coalesce(p_name, '')), '');
    if v_name is null then v_name := 'New Character'; end if;
    if length(v_name) > 100 then v_name := left(v_name, 100); end if;

    begin
      insert into characters (owner_id, campaign_id, name, kind, ap)
        values (auth.uid(), v_invite.campaign_id, v_name, 'chargen', v_invite.starting_ap)
        returning id into v_char_id;
    exception when unique_violation then
      raise exception 'You have already joined this campaign';
    end;

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
