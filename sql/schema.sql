-- PACT — database schema
-- Apply in the Supabase SQL editor (or `supabase db push`). RLS policies live in
-- rls-policies.sql and MUST be applied after this file.
--
-- Design notes (see docs/PWA-BUILD-PLAN.md Tasks 3 & 4):
--   * characters.stats is the ONLY place raw character data lives: one canonical envelope,
--       { schema:'pact-character/1', rules, name, LOG, SEQ, id }, shared by both CharGen and
--       Live Sheet since D-GH40 — kind ('chargen'/'livesheet') marks which tool owns/opens
--       the character, not a different data shape.
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
-- Assumes pgcrypto lands in the `extensions` schema (Supabase's default placement for
-- pre-provisioned projects, not guaranteed by this statement alone) -- see the
-- extensions.gen_random_bytes(...) call sites below and D-GH-2026-07-16-campaign-invite-search-path.
-- Supabase-only backend per AGENTS.md, so this is an accepted environment assumption, not a gap to fix.

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
returns text language plpgsql set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  code text;
  raw  bytea;
begin
  loop
    raw := extensions.gen_random_bytes(6);
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
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
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
  archived_at      timestamptz,   -- soft-delete (owner-only, reversible); null = active
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
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
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
-- characters — event-log character data + server-authoritative ap
-- ---------------------------------------------------------------------------
create table if not exists public.characters (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  name        text not null default 'New Character',
  kind        text not null default 'livesheet' check (kind in ('chargen','livesheet')),  -- which tool owns/opens it; both kinds share the same stats shape (D-GH40)
  stats       jsonb not null default '{}'::jsonb,   -- { schema:'pact-character/1', rules, name, LOG, SEQ, id } for both kinds (D-GH40)
  ap          integer not null default 0,           -- DM-authoritative; never written by players
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz    -- soft-delete (owner-only, reversible); null = active
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
-- character_dm_notes — DM-only per-character annotations (player-name label +
-- freeform notes). Deliberately a separate table, not columns on `characters`:
-- characters has a blanket SELECT grant with only row-level filtering, so any
-- new column there would be visible to the character's own owner the moment
-- their row passes characters_select — Postgres RLS can't hide a column within
-- an otherwise-visible row. See sql/migrations/2026-08-01-dm-remove-character-notes.sql.
-- ---------------------------------------------------------------------------
create table if not exists public.character_dm_notes (
  character_id uuid primary key references public.characters(id) on delete cascade,
  player_label text,
  notes        text,
  updated_at   timestamptz not null default now()
);

drop trigger if exists trg_character_dm_notes_updated_at on public.character_dm_notes;
create trigger trg_character_dm_notes_updated_at
  before update on public.character_dm_notes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- find_campaign_by_invite_code — shared "look up campaign by shared invite_code"
-- lookup for join_campaign and bind_character_to_campaign (NOT
-- redeem_player_invite, which resolves via a single-use token against
-- campaign_invites instead — a different lookup). The "does this owner already
-- have a character in this campaign" check all three RPCs share reuses the
-- pre-existing is_campaign_member() (rls-policies.sql) rather than a new
-- function. See DECISIONS.md D-GH-2026-07-13-campaign-membership-helpers for
-- why this isn't SECURITY DEFINER and isn't granted to authenticated.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- join_campaign(code) — the ONLY way a player joins, so they never need broad
-- read access to the campaigns table. Runs as definer: looks up the campaign by
-- code, blocks re-joining, and creates the caller's character in it. A DM may
-- join their OWN campaign as a player too (DM and player are not exclusive,
-- even within one campaign). Campaigns have no player cap.
-- ---------------------------------------------------------------------------
create or replace function public.join_campaign(p_code text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
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

-- ---------------------------------------------------------------------------
-- join_as_dm(code) — become a co-DM via the campaign's DM invite code.
-- ---------------------------------------------------------------------------
create or replace function public.join_as_dm(p_code text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
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
returns void language plpgsql security definer set search_path = public, pg_temp as $$
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
returns void language plpgsql security definer set search_path = public, pg_temp as $$
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
-- archive_campaign / unarchive_campaign — owner-only soft-delete, reversible.
-- Same tier as delete (not "any DM"). is_campaign_owner() is defined in
-- rls-policies.sql; see its "Column-level campaign-write lockdown" section for
-- why this RPC is the only path that can write archived_at.
-- ---------------------------------------------------------------------------
create or replace function public.archive_campaign(p_campaign uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_campaign_owner(p_campaign) then
    raise exception 'Only the campaign owner can archive it';
  end if;
  update campaigns set archived_at = now() where id = p_campaign;
end;
$$;

create or replace function public.unarchive_campaign(p_campaign uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_campaign_owner(p_campaign) then
    raise exception 'Only the campaign owner can restore it';
  end if;
  update campaigns set archived_at = null where id = p_campaign;
end;
$$;

-- ---------------------------------------------------------------------------
-- regenerate_invite_code / regenerate_dm_invite_code — any DM; invalidates the
-- old code. is_campaign_dm() is defined in rls-policies.sql.
-- ---------------------------------------------------------------------------
create or replace function public.regenerate_invite_code(p_campaign uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
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
returns text language plpgsql security definer set search_path = public, pg_temp as $$
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
  note            text,                                           -- DM label; see D-GH-2026-08-03-dm-invite-manager
  revoked_at      timestamptz,                                    -- soft revocation; a revoked invite cannot redeem
  redeemed_by     uuid references public.profiles(id) on delete set null,
  redeemed_at     timestamptz
);
create index if not exists idx_campaign_invites_campaign on public.campaign_invites(campaign_id);

-- Invite AP is a SINGLE grant, paid into characters.ap (DM-authoritative).
-- `starting_budget` is DEPRECATED and always written 0 — both functions still ADD it in so
-- pre-2026-08-03 invites redeem at their full intended amount. Signatures deliberately
-- unchanged so a Pages deploy and a DB migration need not be atomic — which also means the old
-- `drop function if exists redeem_player_invite(text,text)` that used to precede it is gone: the
-- return shape no longer changes, and a drop+recreate would briefly remove a live function.
-- Rationale in full:
-- sql/migrations/2026-08-03-invite-single-ap-grant.sql and
-- decisions/2026/D-GH-2026-08-03-invite-single-ap-grant.md.
-- Invite AP is a SINGLE grant paid into characters.ap; redemption also records it in ap_awards so
-- the grant has the same provenance as any later DM award. `note` labels an invite for the DM's own
-- reference and `revoked_at` withdraws an unredeemed one without destroying the record. Rationale:
-- sql/migrations/2026-08-03-invite-single-ap-grant.sql, -invite-grant-award-row.sql,
-- -invite-notes-and-revoke.sql and decisions/2026/D-GH-2026-08-03-dm-invite-manager.md.
create or replace function public.create_player_invite(
  p_campaign_id     uuid,
  p_starting_ap     integer default 0,
  p_starting_budget integer default 0,   -- DEPRECATED: folded into p_starting_ap; kept for old clients
  p_note            text    default null
)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_token text;
  v_ap    integer := coalesce(p_starting_ap, 0);
  v_extra integer := coalesce(p_starting_budget, 0);
  v_note  text    := nullif(trim(coalesce(p_note, '')), '');
begin
  if not is_campaign_dm(p_campaign_id) then
    raise exception 'Only a campaign DM can create a player invite';
  end if;
  if v_ap < 0 or v_extra < 0 then
    raise exception 'Starting AP must be non-negative';
  end if;
  v_ap := v_ap + v_extra;
  if v_note is not null and length(v_note) > 200 then v_note := left(v_note, 200); end if;

  loop
    v_token := encode(extensions.gen_random_bytes(16), 'hex');
    exit when not exists (select 1 from campaign_invites where token = v_token);
  end loop;

  insert into campaign_invites (campaign_id, token, starting_ap, starting_budget, created_by, note)
    values (p_campaign_id, v_token, v_ap, 0, auth.uid(), v_note);

  return v_token;
end;
$$;

-- Revoke / un-revoke an unredeemed invite. DM-only. Redeemed invites are immutable: the character
-- already exists and its AP was already granted, so "revoking" it would describe a state that isn't true.
create or replace function public.set_invite_revoked(p_invite uuid, p_revoked boolean default true)
returns timestamptz language plpgsql security definer set search_path = public, pg_temp as $$
declare v_campaign uuid; v_redeemed uuid; v_at timestamptz;
begin
  select campaign_id, redeemed_by into v_campaign, v_redeemed
    from campaign_invites where id = p_invite;
  if v_campaign is null then raise exception 'Invite not found'; end if;
  if not is_campaign_dm(v_campaign) then
    raise exception 'Only a campaign DM can revoke an invite';
  end if;
  if v_redeemed is not null then
    raise exception 'That invite has already been redeemed and cannot be revoked';
  end if;
  update campaign_invites
    set revoked_at = case when p_revoked then now() else null end
    where id = p_invite
    returning revoked_at into v_at;
  return v_at;
end;
$$;

-- DM-only listing. SECURITY DEFINER so it can join profiles/characters, which the caller's own RLS
-- would not let them read wholesale, while still gating on is_campaign_dm internally.
create or replace function public.list_campaign_invites(p_campaign uuid)
returns table(
  id           uuid,
  token        text,
  note         text,
  starting_ap  integer,
  created_at   timestamptz,
  revoked_at   timestamptz,
  redeemed_at  timestamptz,
  redeemed_by_name text,
  character_id uuid,
  character_name text
)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_campaign_dm(p_campaign) then
    raise exception 'Only a campaign DM can list invites';
  end if;
  return query
    select i.id, i.token, i.note,
           coalesce(i.starting_ap, 0) + coalesce(i.starting_budget, 0),   -- same fold the RPCs apply
           i.created_at, i.revoked_at, i.redeemed_at,
           p.display_name, c.id, c.name
      from campaign_invites i
      left join profiles p on p.id = i.redeemed_by
      left join characters c on c.owner_id = i.redeemed_by and c.campaign_id = i.campaign_id
     where i.campaign_id = p_campaign
     order by i.created_at desc;
end;
$$;

-- A revoked invite must not redeem. Only this branch changes; the rest is unchanged from
-- 2026-08-03-invite-grant-award-row.sql.
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

  -- Checked before the claiming UPDATE so a revoked invite can't be consumed by the race.
  if exists (select 1 from campaign_invites
              where token = p_token and revoked_at is not null and redeemed_by is null) then
    raise exception 'This invite has been withdrawn by the DM';
  end if;

  update campaign_invites
    set redeemed_by = auth.uid(), redeemed_at = now()
    where token = p_token and redeemed_by is null and revoked_at is null
    returning * into v_invite;

  if found then
    if is_campaign_member(v_invite.campaign_id) then
      raise exception 'You have already joined this campaign';
    end if;

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

    if v_grant <> 0 then
      insert into ap_awards (character_id, dm_id, campaign_id, amount, note)
        values (v_char_id, v_invite.created_by, v_invite.campaign_id, v_grant,
                coalesce(nullif(trim(v_invite.note), ''), 'Starting AP (campaign invite)'));
    end if;

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

-- ---------------------------------------------------------------------------
-- One-character-per-player-per-campaign, enforced at the database level (closes
-- a TOCTOU race the EXISTS-then-write checks below can't close on their own —
-- see the matching comment in sql/migrations/2026-07-13-campaign-bind-character.sql).
-- ---------------------------------------------------------------------------
create unique index if not exists idx_characters_owner_campaign_unique
  on public.characters(owner_id, campaign_id) where campaign_id is not null;

-- ---------------------------------------------------------------------------
-- bind_character_to_campaign — Path B: bind an already-built character to a
-- campaign via the shared invite_code. Rebind contract: bind only if unbound;
-- same-campaign is an idempotent no-op; a different campaign is rejected.
-- ---------------------------------------------------------------------------
-- Binding also grants the campaign's `rules.startingTier.ap`, so joining by shared code and
-- redeeming an invite now start a character the same way. Only on a genuine first bind, guarded
-- against an unbind/rebind double-pay, and credited to the campaign's DM rather than the joining
-- player. See sql/migrations/2026-08-04-campaign-starting-ap-on-join.sql and
-- decisions/2026/D-GH-2026-08-04-campaign-starting-ap.md.
create or replace function public.bind_character_to_campaign(p_character_id uuid, p_code text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign campaigns%rowtype;
  v_char     characters%rowtype;
  v_start_txt text;
  v_start     integer;
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

  if is_campaign_member(v_campaign.id) then
    raise exception 'You have already joined this campaign with another character';
  end if;

  begin
    update characters set campaign_id = v_campaign.id where id = p_character_id;
  exception when unique_violation then
    raise exception 'You have already joined this campaign with another character';
  end;

  -- Starting AP. Read defensively: `rules` is free-form jsonb a DM edits, so the tier figure may be
  -- absent, empty, or a non-numeric string. Three cases, and the difference between them matters:
  --   absent    -> 0. A campaign whose DM never opened the advancement card has NO rules.startingTier
  --                at all ('rules' defaults to '{}'). This briefly defaulted to 79 on the reasoning that
  --                DM Console displays 79 so granting 0 broke a UI promise — but that 79 is a hardcoded
  --                `value="79"` on a field inside a COLLAPSED <details>. A DM who never expanded it made
  --                no choice, and paying out a full level-1 budget on their behalf is the bigger error.
  --   numeric   -> that value, but LENGTH-BOUNDED. '^[0-9]+$' alone accepts '2147483648', and the
  --                ::integer cast then overflows, aborting the whole transaction — so a junk rules blob
  --                could hard-fail the join, the one thing this defensive read exists to prevent.
  --   malformed -> 0. Grant nothing; never block the join.
  v_start_txt := nullif(trim(coalesce(v_campaign.rules -> 'startingTier' ->> 'ap', '')), '');
  if v_start_txt is not null and v_start_txt ~ '^[0-9]{1,7}$' then
    v_start := v_start_txt::integer;
  else
    v_start := 0;
  end if;

  -- Guarded against an unbind/rebind double-pay: the ap_awards row from the first join is the record
  -- that stops a second payout (the same-campaign early return above never reaches this block).
  if v_start > 0
     and not exists (select 1 from ap_awards
                      where character_id = p_character_id and campaign_id = v_campaign.id) then
    update characters set ap = ap + v_start where id = p_character_id;
    insert into ap_awards (character_id, dm_id, campaign_id, amount, note)
      values (p_character_id, v_campaign.dm_id, v_campaign.id, v_start,
              'Starting AP (joined by campaign code)');
  end if;

  return v_campaign.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- feedback — free-text in-app user feedback (feat/feedback-widget).
-- Insert-only from the client, by BOTH signed-in and anonymous users; readable
-- ONLY via the Supabase dashboard (service role) — there is no in-app admin view
-- in v1. user_id is nullable: null for an anonymous submission, or when a
-- signed-in user deliberately opts out of attribution. page is constrained to
-- the four surfaces the widget ships on; message/contact are length-capped so a
-- free-text field can't be used to bloat storage. The RLS grant/policy live in
-- rls-policies.sql (this is the first table there to grant `anon` a write — see
-- that file's feedback block and DECISIONS.md D-GH-2026-07-15-feedback-widget for
-- why that's safe). Full design: docs/plans/2026-07-15-feedback-widget.md.
-- ---------------------------------------------------------------------------
create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.profiles(id) on delete set null,   -- null = anonymous
  page       text not null check (page in ('chargen','livesheet','dmconsole','guide')),
  message    text not null check (char_length(message) between 1 and 2000),
  contact    text check (char_length(contact) <= 200),   -- optional; user-supplied
  created_at timestamptz not null default now()
);
create index if not exists idx_feedback_created on public.feedback(created_at);
