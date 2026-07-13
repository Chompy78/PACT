-- PACT — Campaign join/invite UI, Deliverable 1 (Path A): per-player invite tokens
-- Run ONCE in the Supabase SQL editor on an existing PACT database.
-- Idempotent: safe to re-run. Fresh installs get all this from schema.sql /
-- rls-policies.sql instead; this file only patches a DB created before this change.
--
-- A DM invites a brand-new player with a single-use, per-player token carrying a
-- starting DM AP amount and a starting build budget. This is deliberately separate
-- from the existing shared `campaigns.invite_code` (join_campaign()): that code is
-- reusable and creates a blank 'livesheet' character with no preset budget; this
-- token is single-use, DM-curated, and creates a 'chargen' character the player
-- builds from a known-legal starting budget (see docs/plans/2026-07-11-campaign-
-- join-invite-flow.md, Revision 3, for the full design + review history).
--
-- No token expiry/revocation enforcement in v1 (accepted risk, documented in that
-- plan's decision 6) — expires_at is reserved for a future migration to enforce.

-- ===========================================================================
-- 1. campaign_invites: one row per DM-issued, single-use player invite token
-- ===========================================================================
create table if not exists public.campaign_invites (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid not null references public.campaigns(id) on delete cascade,
  token           text not null unique,
  starting_ap     integer not null default 0,
  starting_budget integer not null default 0,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz,                                    -- reserved, not yet enforced
  redeemed_by     uuid references public.profiles(id) on delete set null,
  redeemed_at     timestamptz
);
create index if not exists idx_campaign_invites_campaign on public.campaign_invites(campaign_id);

-- ===========================================================================
-- 2. RPCs
-- ===========================================================================

-- create_player_invite: any DM/co-DM of the campaign. Returns the raw token
-- (the client builds the canonical CharGen ?invite=<token> URL from it).
create or replace function public.create_player_invite(
  p_campaign_id     uuid,
  p_starting_ap     integer default 0,
  p_starting_budget integer default 0
)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_token text;
begin
  if not is_campaign_dm(p_campaign_id) then
    raise exception 'Only a campaign DM can create a player invite';
  end if;
  if p_starting_ap < 0 or p_starting_budget < 0 then
    raise exception 'Starting AP and budget must be non-negative';
  end if;

  -- 16 CSPRNG bytes -> 32 hex chars. Unlike the 6-char shared invite_code (typed by
  -- hand, small alphabet, REV-07's gen_random_bytes pattern), this token travels in
  -- a URL and is never manually entered, so it uses more entropy; the uniqueness
  -- loop is defensive (128 bits is already effectively collision-free).
  loop
    v_token := encode(gen_random_bytes(16), 'hex');
    exit when not exists (select 1 from campaign_invites where token = v_token);
  end loop;

  insert into campaign_invites (campaign_id, token, starting_ap, starting_budget, created_by)
    values (p_campaign_id, v_token, p_starting_ap, p_starting_budget, auth.uid());

  return v_token;
end;
$$;

-- redeem_player_invite: single function body = one implicit transaction, so a
-- failed character insert (e.g. "already joined") auto-rolls-back the token claim
-- -- no orphaned-consumed-token failure mode. A repeat call by the SAME user after
-- a successful redemption is idempotent (returns the same character + values)
-- rather than erroring, so double-click / interrupted-client recovery is safe.
create or replace function public.redeem_player_invite(p_token text, p_name text default null)
returns table(character_id uuid, starting_ap integer, starting_budget integer)
language plpgsql security definer set search_path = public as $$
declare
  v_invite  campaign_invites%rowtype;
  v_char_id uuid;
  v_name    text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  -- Idempotent recovery: this same user already redeemed this token.
  select * into v_invite from campaign_invites where token = p_token and redeemed_by = auth.uid();
  if found then
    select id into v_char_id from characters
      where owner_id = auth.uid() and campaign_id = v_invite.campaign_id
      limit 1;
    if v_char_id is null then
      raise exception 'Invite already redeemed but character not found';
    end if;
    return query select v_char_id, v_invite.starting_ap, v_invite.starting_budget;
    return;
  end if;

  -- Atomic claim: only one caller can win this update (matches join_campaign's
  -- one-character-per-player-per-campaign style, applied here to the token itself).
  update campaign_invites
    set redeemed_by = auth.uid(), redeemed_at = now()
    where token = p_token and redeemed_by is null
    returning * into v_invite;
  if not found then
    raise exception 'Invite is invalid or already redeemed';
  end if;

  if exists (select 1 from characters where campaign_id = v_invite.campaign_id and owner_id = auth.uid()) then
    raise exception 'You have already joined this campaign';
  end if;

  v_name := nullif(trim(coalesce(p_name, '')), '');
  if v_name is null then v_name := 'New Character'; end if;
  if length(v_name) > 100 then v_name := left(v_name, 100); end if;

  insert into characters (owner_id, campaign_id, name, kind, ap)
    values (auth.uid(), v_invite.campaign_id, v_name, 'chargen', v_invite.starting_ap)
    returning id into v_char_id;

  return query select v_char_id, v_invite.starting_ap, v_invite.starting_budget;
end;
$$;

-- ===========================================================================
-- 3. RLS
-- ===========================================================================
alter table public.campaign_invites enable row level security;

-- A DM sees all invites for their campaign (to list/manage them); a redeemer can
-- read their own redeemed row (needed for CharGen's crash-recovery path, which
-- re-reads starting_budget if a redeemed character's stats weren't seeded yet).
drop policy if exists campaign_invites_select on public.campaign_invites;
create policy campaign_invites_select on public.campaign_invites
  for select using (is_campaign_dm(campaign_id) or redeemed_by = auth.uid());
-- writes happen only through the SECURITY DEFINER RPCs above (no insert/update/delete policy)

-- ===========================================================================
-- 4. Grants
-- ===========================================================================
grant select on public.campaign_invites to authenticated;

grant execute on function public.create_player_invite(uuid, integer, integer) to authenticated;
grant execute on function public.redeem_player_invite(text, text)             to authenticated;

revoke execute on function public.create_player_invite(uuid, integer, integer) from public;
revoke execute on function public.redeem_player_invite(text, text)             from public;
