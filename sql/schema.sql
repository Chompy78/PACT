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
--       DM of a campaign  = campaigns.dm_id is you
--       player in one     = you own a character whose campaign_id is that campaign
--     The same user can be a DM in one campaign and a player in another at once.
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
-- ---------------------------------------------------------------------------
create or replace function public.gen_invite_code()
returns text language plpgsql as $$
declare
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  code text;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random()*36)::int, 1);
    end loop;
    exit when not exists (select 1 from public.campaigns where invite_code = code);
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
-- campaigns — one DM, joined by a 6-char invite code
-- ---------------------------------------------------------------------------
create table if not exists public.campaigns (
  id          uuid primary key default gen_random_uuid(),
  dm_id       uuid not null references public.profiles(id) on delete cascade,
  name        text not null,
  invite_code text not null unique default public.gen_invite_code()
              check (invite_code ~ '^[A-Z0-9]{6}$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_campaigns_dm on public.campaigns(dm_id);

drop trigger if exists trg_campaigns_updated_at on public.campaigns;
create trigger trg_campaigns_updated_at
  before update on public.campaigns
  for each row execute function public.set_updated_at();

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
-- regenerate_invite_code(campaign) — DM-only; invalidates the old code.
-- ---------------------------------------------------------------------------
create or replace function public.regenerate_invite_code(p_campaign uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_code text;
begin
  if not exists (select 1 from campaigns
                 where id = p_campaign and dm_id = auth.uid()) then
    raise exception 'Only the campaign DM can regenerate the invite code';
  end if;

  v_code := gen_invite_code();
  update campaigns set invite_code = v_code where id = p_campaign;
  return v_code;
end;
$$;
