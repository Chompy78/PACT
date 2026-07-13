-- PACT — database schema
-- Apply in the Supabase SQL editor (or `supabase db push`). RLS policies live in
-- rls-policies.sql and MUST be applied after this file.
--
-- Design notes (see docs/PWA-BUILD-PLAN.md Tasks 3 & 4):
--   * characters.stats is the ONLY place raw character data lives:
--       CharGen   -> the flat build JSON
--       Live Sheet-> the event log { LOG, SEQ, rules }
--     Derived stats (HP, AC, AP, warnings) are NEVER stored; the engine recomputes them.
--   * characters.ap is a SEPARATE column, not inside stats, so RLS can protect it
--     independently — players can never write it; only a campaign's DM can.
--   * Roles are PER-CAMPAIGN and derived, never a stored flag:
--       DM of a campaign  = you are in campaign_dms for it (the owner is dm_id +
--                           auto-added; co-DMs join by dm_invite_code or promotion)
--       player in one     = you own a character whose campaign_id is that campaign
--     The same user can be a DM in one campaign and a player in another at once,
--     and a campaign can have multiple DMs (see D-GH7).
--   * AP is dual-source: characters.ap (DM-granted, via award_ap) + the Live
--     Sheet's own log awards (player-entered). campaigns.ignore_player_ap, when
--     true, tells the tools to count only DM-granted AP.
--   * updated_at is maintained by a trigger and drives last-write-wins sync.
--   * Campaigns have no player cap — any number of players may join.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Invite-code generator: 6 chars, A-Z0-9 (matches the campaigns check).
-- Sourced from gen_random_bytes (pgcrypto, CSPRNG) rather than random(), which
-- is a plain PRNG not fit for anything that acts as a shared secret (REV-07).
-- ---------------------------------------------------------------------------
create or replace function public.gen_invite_code()
returns text language plpgsql as $$
declare
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  code text;
  raw  bytea;
begin
  loop
    raw := gen_random_bytes(6);
    code := '';
    for i in 0..5 loop
      code := code || substr(alphabet, 1 + (get_byte(raw, i) % 36), 1);
    end loop;
    exit when not exists (
      select 1 from public.campaigns where invite_code = code or dm_invite_code = code
    );
  end loop;
  return code;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles — one row per auth user, created on signup.
-- No role column: roles are per-campaign and derived (see notes above).
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile when a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data->>'display_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- campaigns — an owner (dm_id) + a set of co-DMs (campaign_dms). Joined by a
-- player invite_code; co-DMs join by a separate dm_invite_code (see D-GH7).
-- ---------------------------------------------------------------------------
create table if not exists public.campaigns (
  id               uuid primary key default gen_random_uuid(),
  dm_id            uuid not null references public.profiles(id) on delete cascade,  -- owner/creator
  name             text not null,
  invite_code      text not null unique default public.gen_invite_code()
                   check (invite_code ~ '^[A-Z0-9]{6}$'),
  dm_invite_code   text not null unique default public.gen_invite_code()
                   check (dm_invite_code ~ '^[A-Z0-9]{6}$'),
  ignore_player_ap boolean not null default false,   -- when true, only DM-granted AP counts
  rules            jsonb not null default '{}'::jsonb, -- DM-authoritative campaign rules (D-GH14)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_campaigns_dm on public.campaigns(dm_id);

drop trigger if exists trg_campaigns_updated_at on public.campaigns;
create trigger trg_campaigns_updated_at
  before update on public.campaigns
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- campaign_dms — every user who can DM a campaign (the owner is auto-added).
-- is_campaign_dm() checks membership here, so all DM powers extend to co-DMs.
-- ---------------------------------------------------------------------------
create table if not exists public.campaign_dms (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  dm_id       uuid not null references public.profiles(id) on delete cascade,
  added_by    uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (campaign_id, dm_id)
);
create index if not exists idx_campaign_dms_dm on public.campaign_dms(dm_id);

create or replace function public.add_owner_as_dm()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.campaign_dms (campaign_id, dm_id, added_by)
  values (new.id, new.dm_id, new.dm_id)
  on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists trg_campaign_owner_dm on public.campaigns;
create trigger trg_campaign_owner_dm
  after insert on public.campaigns
  for each row execute function public.add_owner_as_dm();

-- ---------------------------------------------------------------------------
-- characters — raw build JSON / event log + server-authoritative ap
-- ---------------------------------------------------------------------------
create table if not exists public.characters (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  name        text not null default 'New Character',
  kind        text not null default 'livesheet' check (kind in ('chargen','livesheet')),
  stats       jsonb not null default '{}'::jsonb,   -- build JSON or { LOG, SEQ, rules }
  ap          integer not null default 0,           -- DM-authoritative; never written by players
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_characters_owner    on public.characters(owner_id);
create index if not exists idx_characters_campaign on public.characters(campaign_id);

drop trigger if exists trg_characters_updated_at on public.characters;
create trigger trg_characters_updated_at
  before update on public.characters
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- ap_awards — the AP award ledger (attribution + history). award_ap() writes a
-- row stamped with the calling DM and bumps the running characters.ap total.
-- ---------------------------------------------------------------------------
create table if not exists public.ap_awards (
  id           uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  dm_id        uuid references public.profiles(id) on delete set null,  -- survives DM deletion
  campaign_id  uuid references public.campaigns(id) on delete set null,
  amount       integer not null,
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_ap_awards_char on public.ap_awards(character_id);

-- ---------------------------------------------------------------------------
-- join_campaign(code) — the ONLY way a player joins, so they never need broad
-- read access to the campaigns table. Runs as definer: looks up the campaign by
-- code, blocks re-joining, and creates the caller's character in it. A DM may
-- join their OWN campaign as a player too (DM and player are not exclusive,
-- even within one campaign). Campaigns have no player cap.
-- ---------------------------------------------------------------------------
create or replace function public.join_campaign(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_campaign campaigns%rowtype;
  v_char_id  uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_campaign from campaigns where invite_code = upper(p_code);
  if not found then
    raise exception 'No campaign with that invite code';
  end if;

  if exists (select 1 from characters
             where campaign_id = v_campaign.id and owner_id = auth.uid()) then
    raise exception 'You have already joined this campaign';
  end if;

  insert into characters (owner_id, campaign_id, name)
  values (auth.uid(), v_campaign.id, 'New Character')
  returning id into v_char_id;

  return v_campaign.id;   -- caller can now read the campaign via RLS (member)
end;
$$;

-- ---------------------------------------------------------------------------
-- join_as_dm(code) — become a co-DM via the campaign's DM invite code.
-- ---------------------------------------------------------------------------
create or replace function public.join_as_dm(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_campaign campaigns%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into v_campaign from campaigns where dm_invite_code = upper(p_code);
  if not found then raise exception 'No campaign with that DM invite code'; end if;
  insert into campaign_dms (campaign_id, dm_id, added_by)
    values (v_campaign.id, auth.uid(), auth.uid())
    on conflict do nothing;
  return v_campaign.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- promote_to_dm / remove_dm — owner-only co-DM management. The owner cannot be
-- removed. is_campaign_owner() is defined in rls-policies.sql.
-- ---------------------------------------------------------------------------
create or replace function public.promote_to_dm(p_campaign uuid, p_profile uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_campaign_owner(p_campaign) then
    raise exception 'Only the campaign owner can add co-DMs';
  end if;
  insert into campaign_dms (campaign_id, dm_id, added_by)
    values (p_campaign, p_profile, auth.uid())
    on conflict do nothing;
end;
$$;

create or replace function public.remove_dm(p_campaign uuid, p_profile uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_campaign_owner(p_campaign) then
    raise exception 'Only the campaign owner can remove co-DMs';
  end if;
  if p_profile = (select dm_id from campaigns where id = p_campaign) then
    raise exception 'The owner cannot be removed as DM';
  end if;
  delete from campaign_dms where campaign_id = p_campaign and dm_id = p_profile;
end;
$$;

-- ---------------------------------------------------------------------------
-- regenerate_invite_code / regenerate_dm_invite_code — any DM; invalidates the
-- old code. is_campaign_dm() is defined in rls-policies.sql.
-- ---------------------------------------------------------------------------
create or replace function public.regenerate_invite_code(p_campaign uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not is_campaign_dm(p_campaign) then
    raise exception 'Only a campaign DM can regenerate the invite code';
  end if;
  v_code := gen_invite_code();
  update campaigns set invite_code = v_code where id = p_campaign;
  return v_code;
end;
$$;

create or replace function public.regenerate_dm_invite_code(p_campaign uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not is_campaign_dm(p_campaign) then
    raise exception 'Only a campaign DM can regenerate the DM invite code';
  end if;
  v_code := gen_invite_code();
  update campaigns set dm_invite_code = v_code where id = p_campaign;
  return v_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- campaign_invites — single-use, per-player invite tokens (Path A: DM invites a
-- brand-new player). Distinct from the shared campaigns.invite_code above: this
-- token is single-use, DM-curated with a preset starting AP/budget, and produces
-- a 'chargen' character. See sql/migrations/2026-07-13-campaign-invite-tokens.sql
-- and docs/plans/2026-07-11-campaign-join-invite-flow.md for the full design.
-- ---------------------------------------------------------------------------
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

  loop
    v_token := encode(gen_random_bytes(16), 'hex');
    exit when not exists (select 1 from campaign_invites where token = v_token);
  end loop;

  insert into campaign_invites (campaign_id, token, starting_ap, starting_budget, created_by)
    values (p_campaign_id, v_token, p_starting_ap, p_starting_budget, auth.uid());

  return v_token;
end;
$$;

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
