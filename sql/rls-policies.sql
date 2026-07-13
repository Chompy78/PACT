-- PACT — Row-Level Security policies
-- Apply AFTER schema.sql. Safe to re-run (drops policies first).
--
-- Guarantees enforced here (not just in client JS):
--   * A user reads/writes only their own characters.
--   * Players can NEVER write characters.ap — enforced by a column-level GRANT,
--     not a policy, because Postgres RLS cannot restrict an UPDATE to columns.
--     The only ap write path is award_ap(), which checks the caller is the DM.
--   * Only a campaign's DM can write campaign rows or award ap.
--   * Campaign + profile reads are scoped to people you share a campaign with.
--
-- Recursion note: a policy subquery against another table is itself subject to
-- that table's RLS. campaigns<->characters policies would recurse forever, so
-- the cross-table checks live in SECURITY DEFINER helpers that bypass RLS.

-- ---------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER — run as owner, bypass RLS, break recursion)
-- ---------------------------------------------------------------------------
-- DM = membership in campaign_dms (owner is auto-added; co-DMs join/promoted).
create or replace function public.is_campaign_dm(p_campaign uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from campaign_dms where campaign_id = p_campaign and dm_id = auth.uid()
  );
$$;

-- Owner = the campaigns.dm_id (creator). Owner-only actions: manage co-DMs, delete.
create or replace function public.is_campaign_owner(p_campaign uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from campaigns where id = p_campaign and dm_id = auth.uid());
$$;

create or replace function public.is_campaign_member(p_campaign uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from characters where campaign_id = p_campaign and owner_id = auth.uid()
  );
$$;

-- True if auth.uid() and p_other share any campaign (either as DM or player).
create or replace function public.shares_campaign(p_other uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    -- I DM a campaign p_other plays in
    select 1 from campaign_dms d join characters ch on ch.campaign_id = d.campaign_id
      where d.dm_id = auth.uid() and ch.owner_id = p_other
    union all
    -- p_other DMs a campaign I play in
    select 1 from campaign_dms d join characters ch on ch.campaign_id = d.campaign_id
      where d.dm_id = p_other and ch.owner_id = auth.uid()
    union all
    -- we both play in the same campaign
    select 1 from characters a join characters b on a.campaign_id = b.campaign_id
      where a.owner_id = auth.uid() and b.owner_id = p_other
    union all
    -- we co-DM the same campaign
    select 1 from campaign_dms a join campaign_dms b on a.campaign_id = b.campaign_id
      where a.dm_id = auth.uid() and b.dm_id = p_other
  );
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------
alter table public.profiles     enable row level security;
alter table public.campaigns    enable row level security;
alter table public.characters   enable row level security;
alter table public.campaign_dms enable row level security;
alter table public.ap_awards    enable row level security;

-- ---------------------------------------------------------------------------
-- Base table privileges. RLS gates WHICH ROWS the authenticated role may touch,
-- but the role still needs a table-level GRANT or every query is "permission
-- denied". (Supabase normally auto-grants these; we set them explicitly so a
-- fresh project works.) characters deliberately gets NO blanket UPDATE or
-- INSERT — only the column lists below — so ap stays unwritable by players
-- through either path.
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated, anon;

grant select, delete on public.characters to authenticated;
grant select, insert, update, delete on public.campaigns to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select on public.campaign_dms to authenticated;   -- writes via RPCs only
grant select on public.ap_awards    to authenticated;   -- inserts via award_ap only

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (id = auth.uid() or shares_campaign(id));

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert with check (id = auth.uid());   -- normally done by the signup trigger

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- campaigns
-- ---------------------------------------------------------------------------
-- dm_id = auth.uid() is kept FIRST so the owner can see a campaign the instant
-- it's created — before the add-owner-as-DM trigger's campaign_dms row is visible
-- to the INSERT ... RETURNING select check. co-DMs/members covered by the rest.
drop policy if exists campaigns_select on public.campaigns;
create policy campaigns_select on public.campaigns
  for select using (dm_id = auth.uid() or is_campaign_dm(id) or is_campaign_member(id));

drop policy if exists campaigns_insert on public.campaigns;
create policy campaigns_insert on public.campaigns
  for insert with check (dm_id = auth.uid());

-- Any DM may edit campaign settings (e.g. ignore_player_ap).
drop policy if exists campaigns_update on public.campaigns;
create policy campaigns_update on public.campaigns
  for update using (is_campaign_dm(id)) with check (is_campaign_dm(id));

-- Delete stays owner-only.
drop policy if exists campaigns_delete on public.campaigns;
create policy campaigns_delete on public.campaigns
  for delete using (dm_id = auth.uid());

-- ---------------------------------------------------------------------------
-- campaign_dms — readable by any DM or member of the campaign; writes are only
-- via the SECURITY DEFINER RPCs (join_as_dm / promote_to_dm / remove_dm).
-- ---------------------------------------------------------------------------
drop policy if exists campaign_dms_select on public.campaign_dms;
create policy campaign_dms_select on public.campaign_dms
  for select using (is_campaign_dm(campaign_id) or is_campaign_member(campaign_id));

-- ---------------------------------------------------------------------------
-- ap_awards — readable by the character's owner or any DM of its campaign;
-- inserts happen only through award_ap() (definer).
-- ---------------------------------------------------------------------------
drop policy if exists ap_awards_select on public.ap_awards;
create policy ap_awards_select on public.ap_awards
  for select using (
    is_campaign_dm(campaign_id)
    or exists (select 1 from characters c where c.id = character_id and c.owner_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- characters
-- ---------------------------------------------------------------------------
drop policy if exists characters_select on public.characters;
create policy characters_select on public.characters
  for select using (owner_id = auth.uid() or is_campaign_dm(campaign_id));

drop policy if exists characters_insert on public.characters;
create policy characters_insert on public.characters
  -- campaign_id must be null on direct insert; join_campaign() (SECURITY DEFINER) bypasses
  -- this policy and sets it authoritatively, so the check doesn't block that path.
  -- ap must be exactly 0 on direct insert for the same reason -- only award_ap() (SECURITY
  -- DEFINER) may ever set it to a nonzero value.
  for insert with check (owner_id = auth.uid() and campaign_id is null and ap = 0);

-- Players update their own character. The ap column is NOT in the GRANT below,
-- so even though this policy passes, an attempt to write ap is rejected.
drop policy if exists characters_update on public.characters;
create policy characters_update on public.characters
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists characters_delete on public.characters;
create policy characters_delete on public.characters
  for delete using (owner_id = auth.uid() or is_campaign_dm(campaign_id));

-- ---------------------------------------------------------------------------
-- Column-level ap lockdown — the real ap guard.
-- Strip blanket UPDATE, then grant UPDATE only on the player-writable columns.
-- ap is deliberately excluded; it can change ONLY through award_ap().
-- campaign_id is excluded: join_campaign() / leave_campaign() (SECURITY DEFINER)
-- are the sole writers; direct player writes are rejected.
-- ---------------------------------------------------------------------------
revoke update on public.characters from authenticated, anon;
grant update (name, kind, stats) on public.characters to authenticated;

-- Same guard on INSERT: strip blanket INSERT, grant it only on the columns a
-- new character actually needs. ap and campaign_id are excluded here too —
-- any future insert naming either column is rejected by Postgres itself,
-- before the characters_insert policy's WITH CHECK is even evaluated. Belt
-- and suspenders with that policy's own `ap = 0` check above.
revoke insert on public.characters from authenticated;
grant insert (id, owner_id, name, kind, stats) on public.characters to authenticated;

-- ---------------------------------------------------------------------------
-- award_ap(character, amount, note) — the ONLY ap write path. Any DM of the
-- character's campaign; runs as definer so it can write the column players have
-- no grant on. Writes an ap_awards ledger row (attribution) AND bumps the
-- running total. Pass a negative amount to deduct.
-- ---------------------------------------------------------------------------
drop function if exists public.award_ap(uuid, integer);
create or replace function public.award_ap(p_character uuid, p_amount integer, p_note text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_campaign uuid;
  v_ap       integer;
begin
  select campaign_id into v_campaign from characters where id = p_character;
  if v_campaign is null then
    raise exception 'Character is not in a campaign';
  end if;
  if not is_campaign_dm(v_campaign) then
    raise exception 'Only a campaign DM can award AP';
  end if;

  insert into ap_awards (character_id, dm_id, campaign_id, amount, note)
    values (p_character, auth.uid(), v_campaign, p_amount, p_note);

  update characters set ap = ap + p_amount
    where id = p_character
    returning ap into v_ap;
  return v_ap;
end;
$$;

-- ---------------------------------------------------------------------------
-- campaign_invites — single-use per-player invite tokens (Path A). A DM sees
-- all invites for their campaign; a redeemer can read their own redeemed row
-- (CharGen's crash-recovery path re-reads starting_budget from it if a
-- redeemed character's stats weren't seeded yet). Writes happen only through
-- create_player_invite()/redeem_player_invite() (both SECURITY DEFINER) — no
-- insert/update/delete policy.
-- ---------------------------------------------------------------------------
alter table public.campaign_invites enable row level security;

drop policy if exists campaign_invites_select on public.campaign_invites;
create policy campaign_invites_select on public.campaign_invites
  for select using (is_campaign_dm(campaign_id) or redeemed_by = auth.uid());

grant select on public.campaign_invites to authenticated;

-- ---------------------------------------------------------------------------
-- Allow authenticated users to call the controlled RPCs.
-- ---------------------------------------------------------------------------
grant execute on function public.join_campaign(text)                to authenticated;
grant execute on function public.join_as_dm(text)                   to authenticated;
grant execute on function public.promote_to_dm(uuid, uuid)          to authenticated;
grant execute on function public.remove_dm(uuid, uuid)              to authenticated;
grant execute on function public.regenerate_invite_code(uuid)       to authenticated;
grant execute on function public.regenerate_dm_invite_code(uuid)    to authenticated;
grant execute on function public.award_ap(uuid, integer, text)      to authenticated;
grant execute on function public.create_player_invite(uuid, integer, integer) to authenticated;
grant execute on function public.redeem_player_invite(text, text)             to authenticated;

revoke execute on function public.create_player_invite(uuid, integer, integer) from public;
revoke execute on function public.redeem_player_invite(text, text)             from public;

-- Postgres grants EXECUTE to PUBLIC by default on every new function; revoke it here
-- so award_ap is authenticated-only rather than relying solely on its internal
-- is_campaign_dm() guard. See sql/migrations/2026-07-02-drop-legacy-award-xp-lock-award-ap.sql.
revoke execute on function public.award_ap(uuid, integer, text) from public;

-- ---------------------------------------------------------------------------
-- Remaining function EXECUTE lockdown (anon). Same default-EXECUTE-to-PUBLIC
-- issue as award_ap above, for every other function in this file. See
-- sql/migrations/2026-07-10-lock-down-remaining-function-grants.sql and D-GH15
-- for the full safety analysis (none of these are actually exploitable today —
-- each gates on auth.uid(), which is NULL for anon — this is hygiene, not a fix
-- for a live hole).
--
-- Invariant this lockdown now depends on: is_campaign_dm/owner/member and
-- shares_campaign are called from inside RLS policy USING clauses below, and a
-- policy's internal function call still needs the *invoking role* to hold
-- EXECUTE (SECURITY DEFINER only elevates row access inside the function body,
-- not the caller's EXECUTE requirement). This is safe only because anon has no
-- table-level grant anywhere in this file (line 78: schema USAGE only) — if a
-- future change ever grants anon SELECT on a table whose policy calls one of
-- these helpers, that query would fail with "permission denied for function",
-- not an empty result, until anon is added back to that helper's grant too.
-- ---------------------------------------------------------------------------
-- Internal-only helpers (is_campaign_dm/owner/member, shares_campaign,
-- gen_invite_code): grant to authenticated first so behaviour is unchanged,
-- then revoke the PUBLIC default.
grant execute on function public.is_campaign_dm(uuid)     to authenticated;
grant execute on function public.is_campaign_owner(uuid)  to authenticated;
grant execute on function public.is_campaign_member(uuid) to authenticated;
grant execute on function public.shares_campaign(uuid)    to authenticated;
grant execute on function public.gen_invite_code()        to authenticated;

revoke execute on function public.is_campaign_dm(uuid)     from public;
revoke execute on function public.is_campaign_owner(uuid)  from public;
revoke execute on function public.is_campaign_member(uuid) from public;
revoke execute on function public.shares_campaign(uuid)    from public;
revoke execute on function public.gen_invite_code()        from public;

-- Client-facing RPCs already granted to authenticated above: just strip the
-- redundant PUBLIC grant.
revoke execute on function public.join_campaign(text)             from public;
revoke execute on function public.join_as_dm(text)                from public;
revoke execute on function public.promote_to_dm(uuid, uuid)       from public;
revoke execute on function public.remove_dm(uuid, uuid)           from public;
revoke execute on function public.regenerate_invite_code(uuid)    from public;
revoke execute on function public.regenerate_dm_invite_code(uuid) from public;

-- Trigger-only functions (handle_new_user, add_owner_as_dm, set_updated_at,
-- defined in schema.sql): revoke execute from public, no replacement grant —
-- Postgres rejects any direct call to a `returns trigger` function regardless
-- of grant, so authenticated loses EXECUTE here too and that's fine.
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.add_owner_as_dm() from public;
revoke execute on function public.set_updated_at()  from public;
