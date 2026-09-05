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
returns boolean language sql security definer stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from campaign_dms where campaign_id = p_campaign and dm_id = auth.uid()
  );
$$;

-- Owner = the campaigns.dm_id (creator). Owner-only actions: manage co-DMs, delete.
create or replace function public.is_campaign_owner(p_campaign uuid)
returns boolean language sql security definer stable set search_path = public, pg_temp as $$
  select exists (select 1 from campaigns where id = p_campaign and dm_id = auth.uid());
$$;

create or replace function public.is_campaign_member(p_campaign uuid)
returns boolean language sql security definer stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from characters where campaign_id = p_campaign and owner_id = auth.uid()
  );
$$;

-- True if auth.uid() and p_other share any campaign (either as DM or player).
create or replace function public.shares_campaign(p_other uuid)
returns boolean language sql security definer stable set search_path = public, pg_temp as $$
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

-- character_dm_notes: DM-only, evaluated against the character's CURRENT
-- campaign (a live join, not a cached campaign_id on this table) so access
-- automatically follows a character if it's unbound or re-bound elsewhere.
create or replace function public.is_campaign_dm_of_character(p_character uuid)
returns boolean language sql security definer stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from characters c
    join campaign_dms d on d.campaign_id = c.campaign_id
    where c.id = p_character and d.dm_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Archived-campaign write lockdown (D-GH-2026-08-22-archived-campaign-rpc-enforcement;
-- sql/migrations/2026-08-22-archived-campaign-write-lockdown.sql). "Archived = read-only"
-- was previously enforced only in tools/DM-Console.html's client-side UI guards -- these
-- three functions make it a real server-side invariant for the seven write paths enumerated
-- in that migration (five SECURITY DEFINER RPCs plus the campaigns_update/characters_delete
-- RLS policies below). Deliberately does NOT touch is_campaign_dm() itself -- that helper
-- also backs several READ policies, and a DM/co-DM must still be able to see an archived
-- campaign; only write paths gain the extra check.
--
-- is_campaign_active() is the one boolean primitive (fail-closed by construction: a
-- missing/wrong campaign id returns false, not "silently passes"); the other two are
-- call-site helpers derived from it -- assert_campaign_active() for the five RPCs (call it
-- immediately AFTER each function's existing is_campaign_dm() authority check, so an
-- unauthorized caller still gets "only a campaign DM can..." rather than leaking archive
-- state to someone with no access at all), is_campaign_dm_and_active() for the two RLS
-- policies (where the archive check has to compose into a single USING/WITH CHECK predicate).
create or replace function public.is_campaign_active(p_campaign uuid)
returns boolean language sql security definer stable set search_path = public, pg_temp as $$
  select exists (select 1 from campaigns where id = p_campaign and archived_at is null);
$$;

create or replace function public.assert_campaign_active(p_campaign uuid)
returns void language plpgsql security definer stable set search_path = public, pg_temp as $$
begin
  if not is_campaign_active(p_campaign) then
    raise exception 'This campaign is archived and read-only';
  end if;
end;
$$;

create or replace function public.is_campaign_dm_and_active(p_campaign uuid)
returns boolean language sql security definer stable set search_path = public, pg_temp as $$
  select is_campaign_dm(p_campaign) and is_campaign_active(p_campaign);
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------
alter table public.profiles           enable row level security;
alter table public.campaigns          enable row level security;
alter table public.characters         enable row level security;
alter table public.campaign_dms       enable row level security;
alter table public.ap_awards          enable row level security;
alter table public.gold_awards        enable row level security;
alter table public.campaign_downtime_declarations enable row level security;
alter table public.character_dm_notes enable row level security;

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
grant select, insert, delete on public.campaigns to authenticated;   -- update is column-scoped below
grant select, insert, update on public.profiles to authenticated;
grant select on public.campaign_dms to authenticated;   -- writes via RPCs only
grant select on public.ap_awards    to authenticated;   -- inserts via award_ap only
grant select on public.gold_awards  to authenticated;   -- inserts via award_gold only
grant select on public.campaign_downtime_declarations to authenticated;   -- inserts via declare_downtime only

-- service_role. The APP never uses this role — it is the browser client throughout, on the anon key
-- under RLS — so nothing here was ever exercised and the omission stayed invisible. It surfaced on
-- 2026-08-04 when testing/scripts/seed-review-stack.mjs became the first thing to authenticate as
-- service_role and every call came back "permission denied": production had NO service_role table
-- grants at all. Supabase's project defaults normally supply these, which is precisely why relying
-- on them is the wrong call — this file's stated job is that "a fresh project works", and a database
-- built from it must not depend on defaults that may or may not have been applied.
--
-- service_role bypasses RLS by design; these grants only give it the table access that assumes.
-- Nothing player-facing can reach it: the key is never shipped to a browser (AGENTS.md's hard rule),
-- and it exists so admin/seeding tooling run from a trusted shell can work.
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage on schema public to service_role;

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

-- Any DM of an ACTIVE (non-archived) campaign may edit campaign settings (e.g.
-- ignore_player_ap). See D-GH-2026-08-22-archived-campaign-rpc-enforcement.
drop policy if exists campaigns_update on public.campaigns;
create policy campaigns_update on public.campaigns
  for update using (is_campaign_dm_and_active(id)) with check (is_campaign_dm_and_active(id));

-- Delete stays owner-only.
drop policy if exists campaigns_delete on public.campaigns;
create policy campaigns_delete on public.campaigns
  for delete using (dm_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Column-level campaign-write lockdown. The campaigns_update row policy above
-- (any DM) can't be column-scoped by Postgres RLS, so a blanket UPDATE grant
-- would let any co-DM write archived_at directly via REST, bypassing
-- archive_campaign()/unarchive_campaign()'s owner-only check — the same class
-- of gap characters.ap was already locked down for. Only re-grant the columns
-- an ordinary DM actually needs to update directly today; archived_at (and
-- name/invite_code/dm_id, which have no direct-update client path at all) go only through their
-- SECURITY DEFINER RPCs. (dm_invite_code itself was dropped by
-- D-GH-2026-08-09-harden-invitation-system, so it's not merely lockdown-protected anymore, it's
-- gone.)
-- ---------------------------------------------------------------------------
grant update (ignore_player_ap, rules) on public.campaigns to authenticated;

-- ---------------------------------------------------------------------------
-- campaign_dms — readable by any DM or member of the campaign; writes are only
-- via the SECURITY DEFINER RPCs (redeem_dm_invite / promote_to_dm / remove_dm).
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
-- gold_awards — the gold ledger. Same rows, same readers, same rule as ap_awards
-- immediately above: the character's owner or any DM of its campaign. Inserts happen only
-- through award_gold() (definer).
-- ---------------------------------------------------------------------------
drop policy if exists gold_awards_select on public.gold_awards;
create policy gold_awards_select on public.gold_awards
  for select using (
    is_campaign_dm(campaign_id)
    or exists (select 1 from characters c where c.id = character_id and c.owner_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- campaign_downtime_declarations — party-wide, not owner-scoped: readable by ANY member of
-- the campaign (player or DM), not just the character's own owner, because a downtime window
-- applies to everyone at once and every player needs to see it, not only whoever it was
-- declared "for". Inserts happen only through declare_downtime() (definer).
-- ---------------------------------------------------------------------------
drop policy if exists campaign_downtime_declarations_select on public.campaign_downtime_declarations;
create policy campaign_downtime_declarations_select on public.campaign_downtime_declarations
  for select using (
    is_campaign_dm(campaign_id) or is_campaign_member(campaign_id)
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

-- The owner's own delete path is untouched (matches the "a player's own client
-- saving/removing their own character must keep working" principle already established for
-- characters_update); only the DM-authority branch gains the archive check. See
-- D-GH-2026-08-22-archived-campaign-rpc-enforcement.
drop policy if exists characters_delete on public.characters;
create policy characters_delete on public.characters
  for delete using (owner_id = auth.uid() or is_campaign_dm_and_active(campaign_id));

-- ---------------------------------------------------------------------------
-- character_dm_notes — DM-only per-character notes/label. Never the character's
-- owner, even though they can read/delete the character row itself.
-- ---------------------------------------------------------------------------
drop policy if exists character_dm_notes_all on public.character_dm_notes;
create policy character_dm_notes_all on public.character_dm_notes
  for all using (is_campaign_dm_of_character(character_id))
  with check (is_campaign_dm_of_character(character_id));

grant select, insert, update, delete on public.character_dm_notes to authenticated;

-- ---------------------------------------------------------------------------
-- get_character_visible_fields(character) — D-GH-2026-08-10-dm-custom-character-fields.
-- character_dm_notes.custom_fields holds the campaign's custom-field VALUES for this
-- character; the DEFINITIONS (label + per-field "visible to players" flag, default
-- false) live in campaigns.rules.customFields. Because character_dm_notes' own RLS
-- policy just above is DM-only, a player has no raw-table read path at all — this
-- SECURITY DEFINER RPC is the one place the "visible" flag is actually enforced: a
-- campaign DM gets every value unfiltered (they already have raw table access, so
-- filtering here would just be a confusing extra hop); the character's own owner
-- gets only the slots the campaign currently marks visible. No tool UI calls this
-- yet (DM Console — this feature's UI — is DM-only, so it reads the table directly;
-- see docs/TASK_BOARD_NEXT.md's feat/custom-fields-player-display for the follow-up
-- that would have a player-facing surface consume it).
-- ---------------------------------------------------------------------------
create or replace function public.get_character_visible_fields(p_character uuid)
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
declare
  v_campaign uuid;
  v_owner    uuid;
  v_rules    jsonb;
  v_values   jsonb;
  v_out      jsonb := '{}'::jsonb;
  v_key      text;
begin
  select campaign_id, owner_id into v_campaign, v_owner from characters where id = p_character;
  if v_campaign is null then
    return '{}'::jsonb;   -- not campaign-bound: no campaign-level fields apply
  end if;
  if not (v_owner = auth.uid() or is_campaign_dm(v_campaign)) then
    raise exception 'Not authorized to read this character''s custom fields';
  end if;

  if is_campaign_dm(v_campaign) then
    select coalesce(custom_fields, '{}'::jsonb) into v_values
      from character_dm_notes where character_id = p_character;
    return coalesce(v_values, '{}'::jsonb);
  end if;

  select rules into v_rules from campaigns where id = v_campaign;
  select coalesce(custom_fields, '{}'::jsonb) into v_values
    from character_dm_notes where character_id = p_character;
  v_rules := coalesce(v_rules, '{}'::jsonb);
  v_values := coalesce(v_values, '{}'::jsonb);

  for v_key in select jsonb_object_keys(coalesce(v_rules->'customFields', '{}'::jsonb))
  loop
    if (v_rules->'customFields'->v_key->>'visible') = 'true' then
      v_out := v_out || jsonb_build_object(v_key, v_values->v_key);
    end if;
  end loop;
  return v_out;
end;
$$;

revoke all on function public.get_character_visible_fields(uuid) from public;
grant execute on function public.get_character_visible_fields(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Column-level ap lockdown — the real ap guard.
-- Strip blanket UPDATE, then grant UPDATE only on the player-writable columns.
-- ap is deliberately excluded; it can change ONLY through award_ap().
-- campaign_id is excluded: join_campaign() / leave_campaign() (SECURITY DEFINER)
-- are the sole writers; direct player writes are rejected.
-- ---------------------------------------------------------------------------
revoke update on public.characters from authenticated, anon;
grant update (name, kind, stats) on public.characters to authenticated;
-- gold is excluded for the same reason as ap: DM-authoritative, writable only through
-- award_gold(). Its absence from this grant list IS the guard -- any UPDATE naming it is
-- rejected by Postgres before characters_update's WITH CHECK runs. (Downtime carries no
-- column here at all -- it lives in campaign_downtime_declarations, not on characters; see
-- sql/migrations/2026-08-19-downtime-window-revision.sql.)

-- archived_at (soft-delete/undelete) needs no RPC, unlike campaigns.archived_at:
-- characters_update's row policy above is already owner-only in both USING and
-- WITH CHECK (no co-owner/co-DM case to guard against), so a plain column grant
-- is already correctly scoped.
grant update (archived_at) on public.characters to authenticated;

-- autosave_enabled (D-GH-2026-08-08-universal-autosave-toggle): same reasoning as archived_at
-- immediately above -- an owner-only preference toggle, no DM/co-owner case to guard against, so a
-- plain column grant under characters_update's existing owner-only row policy is already correctly
-- scoped. No RPC (unlike award_ap, which needs SECURITY DEFINER specifically because the WRITER --
-- a DM -- is not the row's owner; that never applies here).
grant update (autosave_enabled) on public.characters to authenticated;

-- Same guard on INSERT: strip blanket INSERT, grant it only on the columns a
-- new character actually needs. ap and campaign_id are excluded here too —
-- any future insert naming either column is rejected by Postgres itself,
-- before the characters_insert policy's WITH CHECK is even evaluated. Belt
-- and suspenders with that policy's own `ap = 0` check above.
revoke insert on public.characters from authenticated;
grant insert (id, owner_id, name, kind, stats, autosave_enabled) on public.characters to authenticated;
-- autosave_enabled included here (unlike ap/campaign_id) so pushCharacter()'s first-ever insert for a
-- character can carry forward a toggle preference set locally before any row existed -- without this,
-- flipping the toggle off on a brand-new never-saved character would be silently discarded the moment
-- that character's first cloud save actually created the row (the insert would fall back to the
-- column's own `true` default instead of the local `false` the player had already chosen).

-- ---------------------------------------------------------------------------
-- award_ap(character, amount, note) — the ONLY ap write path. Any DM of the
-- character's campaign; runs as definer so it can write the column players have
-- no grant on. Writes an ap_awards ledger row (attribution) AND bumps the
-- running total. Pass a negative amount to deduct.
-- ---------------------------------------------------------------------------
drop function if exists public.award_ap(uuid, integer);
create or replace function public.award_ap(p_character uuid, p_amount integer, p_note text default null)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
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
  perform assert_campaign_active(v_campaign);

  insert into ap_awards (character_id, dm_id, campaign_id, amount, note)
    values (p_character, auth.uid(), v_campaign, p_amount, p_note);

  update characters set ap = ap + p_amount
    where id = p_character
    returning ap into v_ap;
  return v_ap;
end;
$$;

-- ---------------------------------------------------------------------------
-- award_gold(character, gold, note) — the ONLY write path to characters.gold. The gold
-- twin of award_ap() directly above, and deliberately identical in shape: any DM of the
-- character's campaign, definer so it can write a column players have no grant on, one
-- gold_awards ledger row for attribution plus the running total.
--
-- Renamed from award_wealth() the same day it was first applied (see
-- sql/migrations/2026-08-19-downtime-window-revision.sql) once downtime turned out not to
-- share gold's shape at all -- gold banks per character and accumulates; downtime is a
-- single party-wide window that REPLACES the last one. See declare_downtime() below for
-- downtime's own write path, which this function no longer touches in any way.
--
-- A solo, uncampaigned character never reaches this: it has no DM, so its gold lives as
-- `wealth` events in its own LOG instead. That asymmetry is the requirement, not a gap --
-- in a campaign world the DM applies the money.
-- ---------------------------------------------------------------------------
create or replace function public.award_gold(
  p_character uuid,
  p_gold integer,
  p_note text default null
)
returns characters language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign uuid;
  v_row      characters%rowtype;
begin
  select campaign_id into v_campaign from characters where id = p_character;
  if v_campaign is null then
    raise exception 'Character is not in a campaign';
  end if;
  if not is_campaign_dm(v_campaign) then
    raise exception 'Only a campaign DM can award gold';
  end if;
  perform assert_campaign_active(v_campaign);
  if coalesce(p_gold, 0) = 0 then
    raise exception 'Award must change gold';
  end if;

  insert into gold_awards (character_id, dm_id, campaign_id, gold, note)
    values (p_character, auth.uid(), v_campaign, p_gold, p_note);

  update characters set gold = gold + p_gold
    where id = p_character
    returning * into v_row;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- declare_downtime(campaign, days, character, note) — the ONLY write path to downtime.
-- Any DM of the campaign; definer, since a PLAYER has no insert grant on
-- campaign_downtime_declarations at all (see its select-only grant above).
--
-- p_character defaults to null, meaning "the party base" -- applies to everyone at once and
-- REPLACES whatever base was declared before (the whole point: "the time should not keep
-- adding up... spend it now or wait till another opportunity" -- owner). Passing a specific
-- character declares a BONUS for them alone, layered on top of whichever base is currently
-- live; a bonus is validated against the SAME campaign as p_campaign so a DM cannot stamp
-- one onto an unrelated character by mistake.
--
-- Deliberately just an INSERT, never an UPDATE -- "declare again" needs no reset logic of
-- its own; a fresh row IS the reset, and get_downtime_window() below always reads only the
-- latest one. The full history stays visible for the story record.
-- ---------------------------------------------------------------------------
create or replace function public.declare_downtime(
  p_campaign uuid,
  p_days integer,
  p_character uuid default null,
  p_note text default null
)
returns campaign_downtime_declarations language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_char_campaign uuid;
  v_row campaign_downtime_declarations%rowtype;
begin
  if not is_campaign_dm(p_campaign) then
    raise exception 'Only a campaign DM can declare downtime';
  end if;
  perform assert_campaign_active(p_campaign);
  if p_days is null then
    raise exception 'Days is required';
  end if;
  if p_character is not null then
    select campaign_id into v_char_campaign from characters where id = p_character;
    if v_char_campaign is distinct from p_campaign then
      raise exception 'That character is not in this campaign';
    end if;
  end if;

  insert into campaign_downtime_declarations (campaign_id, character_id, days, note, declared_by)
    values (p_campaign, p_character, p_days, p_note, auth.uid())
    returning * into v_row;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- get_downtime_window(campaign, character) — the downtime window in force RIGHT NOW: the
-- latest party-base row's days, plus any bonus rows declared for `character` on or after
-- that same base row, summed into one total. Returns NO ROWS if no base has ever been
-- declared for this campaign (nothing to compose), which callers read as "no window yet" --
-- the same null js/engine.js's resolveDowntimeWindow() returns for that case.
--
-- p_character defaults to null: pass null to read just the party base (no bonus composed
-- in), or a specific character to get their real total.
--
-- NOT security definer, on purpose -- this only ever needs to see what the caller's own
-- RLS already lets them see (campaign_downtime_declarations_select: any campaign member or
-- DM), so there is nothing here that needs a privilege escalation.
-- ---------------------------------------------------------------------------
create or replace function public.get_downtime_window(p_campaign uuid, p_character uuid default null)
returns table(days integer, declared_at timestamptz)
language sql stable set search_path = public, pg_temp as $$
  with base as (
    select d.days as base_days, d.created_at as base_at
    from campaign_downtime_declarations d
    where d.campaign_id = p_campaign and d.character_id is null
    order by d.created_at desc
    limit 1
  ),
  bonus as (
    select coalesce(sum(d.days), 0) as bonus_days
    from campaign_downtime_declarations d, base
    where p_character is not null
      and d.campaign_id = p_campaign and d.character_id = p_character
      and d.created_at >= base.base_at
  )
  select (base.base_days + coalesce(bonus.bonus_days, 0))::integer, base.base_at
  from base left join bonus on true;
$$;

-- ---------------------------------------------------------------------------
-- dm_unbind_character(character) — the ONLY way to clear characters.campaign_id
-- once set (join_campaign()/bind_character_to_campaign() are the only setters).
-- characters_update's row policy is owner-only, so a DM removing a PLAYER's
-- character from their own campaign needs the same SECURITY DEFINER bypass
-- award_ap() uses. A soft "kick": the character and its stats/AP survive,
-- untouched, just no longer attached to any campaign.
-- ---------------------------------------------------------------------------
create or replace function public.dm_unbind_character(p_character uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign uuid;
begin
  select campaign_id into v_campaign from characters where id = p_character;
  if v_campaign is null then
    raise exception 'Character is not in a campaign';
  end if;
  if not is_campaign_dm(v_campaign) then
    raise exception 'Only a campaign DM can remove a character from the campaign';
  end if;
  perform assert_campaign_active(v_campaign);

  update characters set campaign_id = null where id = p_character;
end;
$$;

-- ---------------------------------------------------------------------------
-- dm_edit_character_log(character, events) — feat/dm-edit-events (D-GH-2026-08-10-dm-edit-events).
-- The ONLY path a DM can append to a player's own stats->LOG through — characters_update's row policy
-- is owner-only, same SECURITY DEFINER-bypass pattern as award_ap/dm_unbind_character just above,
-- extended to `stats`. Scope allowlist (owner: "not a general editor"): buy/cat:boon, buy/cat:drawback,
-- award, dmRemoveBoon only. Server stamps seq/ts/dmEdit/dmId on every event, discarding whatever the
-- client sent for them — the caller cannot forge who made the edit, when, or where in the log it lands.
-- Accepts a JSON ARRAY so a DM-granted boon's matched buy+award pair lands in ONE atomic write (see
-- the migration file's header for why two separate calls would leave a real, if brief, non-neutral
-- moment). See sql/migrations/2026-08-10-dm-edit-character-log.sql for the full design/compatibility
-- reasoning against the AP-integrity triggers just below.
-- ---------------------------------------------------------------------------
create or replace function public.dm_edit_character_log(p_character uuid, p_events jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign   uuid;
  v_stats      jsonb;
  v_log        jsonb;
  v_seq        integer;
  v_new        jsonb := '[]'::jsonb;
  v_ev         jsonb;
  v_type       text;
  v_cat        text;
  v_ts         bigint := (extract(epoch from now()) * 1000)::bigint;
  -- fix/dm-edit-boon-amount-check (D-GH-2026-08-10-dm-edit-boon-amount-check): cross-validate that
  -- every boon grant's buy/award pair actually moves the same amount, so the "net 0 to spendable AP"
  -- promise this function makes is enforced server-side, not just by DM Console's client always
  -- sending the pair together. FIFO-by-VALUE, not by-name: an award event carries only an amount, no
  -- reference to which buy it pays for (unlike buyoff/dmRemoveBoon, which carry refVal).
  v_boon_costs numeric[] := '{}';
  v_award_amts numeric[] := '{}';
  v_award_used boolean[];
  v_matched    boolean;
  v_i          integer;
  v_j          integer;
begin
  if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events) = 0 then
    raise exception 'p_events must be a non-empty JSON array';
  end if;

  select campaign_id, stats into v_campaign, v_stats from characters where id = p_character for update;
  if not found then
    raise exception 'Character not found';
  end if;
  if v_campaign is null then
    raise exception 'Character is not in a campaign';
  end if;
  if not is_campaign_dm(v_campaign) then
    raise exception 'Only a campaign DM can edit this character';
  end if;
  perform assert_campaign_active(v_campaign);
  if v_stats is null or not (v_stats ? 'LOG') then
    raise exception 'Character has no log to edit';
  end if;

  v_log := coalesce(v_stats->'LOG', '[]'::jsonb);
  v_seq := coalesce((v_stats->>'SEQ')::integer, jsonb_array_length(v_log) + 1);

  for v_ev in select * from jsonb_array_elements(p_events) loop
    v_type := v_ev->>'type';
    v_cat  := v_ev->>'cat';
    if v_type = 'buy' then
      if v_cat is distinct from 'boon' and v_cat is distinct from 'drawback' then
        raise exception 'dm_edit_character_log: unsupported buy category %', v_cat;
      end if;
      if v_cat = 'boon' then
        v_boon_costs := v_boon_costs || coalesce((v_ev->>'cost')::numeric, 0);
      end if;
    -- [SEAL] 'sessionSeal' added by 2026-09-01-session-seal.sql so a DM can draw the line
    -- through the same audited, dm-stamped path as every other DM-authored event.
    elsif v_type not in ('award', 'dmRemoveBoon', 'sessionSeal') then
      raise exception 'dm_edit_character_log: unsupported event type %', v_type;
    end if;
    if v_type = 'award' then
      v_award_amts := v_award_amts || coalesce((v_ev->>'amount')::numeric, 0);
    end if;

    -- [SEAL] A seal is a marker, not a transaction. Stripping amount/cost keeps it out of
    -- pact_ap_ledger_spend's sums and out of the boon/award matching arrays above.
    if v_type = 'sessionSeal' then
      v_ev := v_ev - 'amount' - 'cost';
    end if;

    v_ev := (v_ev - 'seq' - 'ts' - 'dmEdit' - 'dmId')
      || jsonb_build_object('seq', v_seq, 'ts', v_ts, 'dmEdit', true, 'dmId', auth.uid());
    v_new := v_new || jsonb_build_array(v_ev);
    v_seq := v_seq + 1;
  end loop;

  -- Every boon-grant buy must be matched, FIFO-by-value, to a same-call award of the identical amount —
  -- checked AFTER the loop above (once both arrays are fully collected) but BEFORE the write below, so a
  -- rejected batch never partially applies. A standalone award with no matching boon-buy is left alone
  -- on purpose — award_ap() already lets any campaign DM grant arbitrary AP through its own, unrestricted
  -- path, so a bare award here is a second route to a capability the DM already unconditionally has, not
  -- a new privilege; only a genuinely MISMATCHED pair (a boon-buy this batch never actually paid for) is
  -- the correctness gap this closes.
  v_award_used := array_fill(false, array[coalesce(array_length(v_award_amts, 1), 0)]);
  for v_i in 1 .. coalesce(array_length(v_boon_costs, 1), 0) loop
    v_matched := false;
    for v_j in 1 .. coalesce(array_length(v_award_amts, 1), 0) loop
      if not v_award_used[v_j] and v_award_amts[v_j] = v_boon_costs[v_i] then
        v_award_used[v_j] := true;
        v_matched := true;
        exit;
      end if;
    end loop;
    if not v_matched then
      raise exception 'dm_edit_character_log: boon grant at cost % has no matching award of the identical amount in the same call', v_boon_costs[v_i];
    end if;
  end loop;

  v_log := v_log || v_new;
  v_stats := jsonb_set(jsonb_set(v_stats, '{LOG}', v_log), '{SEQ}', to_jsonb(v_seq));

  update characters set stats = v_stats where id = p_character;
  return v_new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Campaign-bound AP-ledger integrity (D-GH-2026-08-10-campaign-ap-log-integrity;
-- sql/migrations/2026-08-10-campaign-ap-log-integrity.sql). Two BEFORE UPDATE triggers on
-- characters, both pure ledger arithmetic over numbers already declared on the LOG -- neither
-- re-derives what anything SHOULD cost, so neither duplicates js/engine.js's pricing tables.
--
-- pact_ap_ledger_spend / pact_ap_ledger_protected are the shared helpers (no table access, no
-- SECURITY DEFINER needed). pact_enforce_ap_budget_consistency (N1) sums frozen buy(non-patch)/
-- buyoff/names costs and award/drawback earnings and rejects a write only if that sum both
-- INCREASES and exceeds spendable AP (characters.ap + player-logged awards unless the campaign
-- ignores player AP) -- NOT the same quantity as the client-side gate
-- (_lsOverApBudget/_cgOverApBudget), which checks compute().remaining, a REPRICED total only
-- engine.js's pricing tables can produce; see the migration file's header for the full reasoning,
-- the accepted boughtOff approximation, and why cat:'patch' costs are out of scope for this
-- SQL-only check (covered by the client gate instead).
-- pact_enforce_locked_history (O3) makes Live Sheet's own undo() boundary -- everything
-- at-or-before the LAST non-discretionary, non-seed `award` event -- server-authoritative: once
-- such an award exists, that prefix of "protected" (non-cat:'patch') events, INCLUDING each
-- protected event's own fields like `disc`, may never be rewritten, reordered, or removed.
-- cat:'patch' events (CharGen's replacePatchSlot(), Live Sheet's _shCommitAppearanceField) are
-- exempt -- they are legitimately rewritten/reordered in place by design, verified directly in
-- both tools' source. See the migration file's revision note for the three real bugs (two caught
-- by /code-review ultra on PR #401, one found while fixing those) this version already fixes.
-- ---------------------------------------------------------------------------
create or replace function public.pact_ap_ledger_spend(p_log jsonb)
returns table(spent numeric, player_earned numeric)
language plpgsql set search_path = public, pg_temp as $$
declare
  ev jsonb;
  v_spent numeric := 0;
  v_earned numeric := 0;
begin
  for ev in select * from jsonb_array_elements(coalesce(p_log, '[]'::jsonb)) loop
    if (ev->>'type') = 'award' then
      v_earned := v_earned + coalesce((ev->>'amount')::numeric, 0);
    elsif (ev->>'type') = 'buy' and coalesce(ev->>'cat','') = 'drawback' then
      -- drawback cost is stored negative (a refund); js/engine.js's economy() negates it into earned.
      v_earned := v_earned + (coalesce((ev->>'cost')::numeric, 0) * -1);
    elsif (ev->>'type') in ('buyoff','names') or ((ev->>'type') = 'buy' and coalesce(ev->>'cat','') <> 'patch') then
      v_spent := v_spent + coalesce((ev->>'cost')::numeric, 0);
    end if;
  end loop;
  spent := v_spent; player_earned := v_earned;
  return next;
end;
$$;

create or replace function public.pact_ap_ledger_protected(p_log jsonb)
returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg((ev - 'seq' - 'ts' - 'rules' - 'label') order by ord), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_log,'[]'::jsonb)) with ordinality as t(ev, ord)
  where (ev->>'type') in ('buyoff','names','award','sessionSeal','dmRemoveBoon')
     or ((ev->>'type') = 'buy' and coalesce(ev->>'cat','') <> 'patch');
$$;

create or replace function public.pact_enforce_ap_budget_consistency()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign public.campaigns%rowtype;
  v_enforce boolean;
  v_old_spent numeric;
  v_new_spent numeric; v_new_earned numeric;
  v_spendable numeric;
begin
  if NEW.campaign_id is null then
    return NEW;
  end if;
  if NEW.stats is not distinct from OLD.stats then
    return NEW;
  end if;

  select * into v_campaign from public.campaigns where id = NEW.campaign_id;
  if not found then
    return NEW;  -- dangling campaign_id shouldn't happen; fail open rather than block on it here
  end if;

  v_enforce := coalesce((v_campaign.rules->>'enforceApBudget')::boolean, true);
  if not v_enforce then
    return NEW;
  end if;

  select spent, player_earned into v_new_spent, v_new_earned
    from public.pact_ap_ledger_spend(NEW.stats->'LOG');
  select spent into v_old_spent
    from public.pact_ap_ledger_spend(OLD.stats->'LOG');

  v_spendable := NEW.ap + (case when v_campaign.ignore_player_ap then 0 else v_new_earned end);

  if v_new_spent > v_old_spent and v_new_spent > v_spendable then
    raise exception 'PACT: over AP budget by % (spent % of % spendable)',
      (v_new_spent - v_spendable), v_new_spent, v_spendable;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_pact_ap_budget_consistency on public.characters;
create trigger trg_pact_ap_budget_consistency
  before update on public.characters
  for each row execute function public.pact_enforce_ap_budget_consistency();

create or replace function public.pact_enforce_locked_history()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old_log jsonb; v_award_idx int; v_seal_idx int; v_idx int;
  v_protected_old jsonb; v_protected_new jsonb; i int;
  v_old_species text; v_new_species text;
  v_old_species2 text; v_new_species2 text;
  v_old_stats jsonb; v_new_stats jsonb; v_key text;
begin
  if NEW.stats is not distinct from OLD.stats then return NEW; end if;
  v_old_log := coalesce(OLD.stats->'LOG', '[]'::jsonb);

  select max(ord) into v_seal_idx
  from jsonb_array_elements(v_old_log) with ordinality as t(ev, ord)
  where (ev->>'type') = 'sessionSeal';

  if NEW.campaign_id is not null then
    select max(ord) into v_award_idx
    from jsonb_array_elements(v_old_log) with ordinality as t(ev, ord)
    where (ev->>'type') = 'award'
      and not coalesce((ev->>'disc')::boolean, false)
      and not coalesce((ev->>'noLock')::boolean, false);
  end if;

  v_idx := greatest(coalesce(v_seal_idx, 0), coalesce(v_award_idx, 0));
  if v_idx = 0 then return NEW; end if;

  v_protected_old := public.pact_ap_ledger_protected(
    (select jsonb_agg(ev order by ord)
       from jsonb_array_elements(v_old_log) with ordinality as t(ev, ord)
       where ord <= v_idx));
  v_protected_new := public.pact_ap_ledger_protected(coalesce(NEW.stats->'LOG', '[]'::jsonb));

  if jsonb_array_length(v_protected_new) < jsonb_array_length(v_protected_old) then
    raise exception 'PACT: locked character history cannot shrink (% events are sealed or locked by an AP award)', v_idx
      using hint = 'Reload the character — its history was locked after this copy was loaded.';
  end if;

  for i in 0 .. jsonb_array_length(v_protected_old) - 1 loop
    if (v_protected_old -> i) is distinct from (v_protected_new -> i) then
      raise exception 'PACT: locked character history cannot be rewritten (protected event % changed)', i
        using hint = 'Reload the character — its history was locked after this copy was loaded.';
    end if;
  end loop;

  select ev->'payload'->'patch'->>'species' into v_old_species
    from jsonb_array_elements(v_old_log) with ordinality as t(ev, ord)
   where ev->>'type'='buy' and ev->>'cat'='patch' and ev->'payload'->'patch' ? 'species'
   order by ord desc limit 1;
  select ev->'payload'->'patch'->>'species' into v_new_species
    from jsonb_array_elements(coalesce(NEW.stats->'LOG','[]'::jsonb)) with ordinality as t(ev, ord)
   where ev->>'type'='buy' and ev->>'cat'='patch' and ev->'payload'->'patch' ? 'species'
   order by ord desc limit 1;
  if v_old_species is not null and v_new_species is distinct from v_old_species then
    raise exception 'PACT: locked character history — species is frozen (was %, tried to set %)',
                    v_old_species, coalesce(v_new_species, '(none)')
      using hint = 'Your DM locked this character. Ask them to change its species for you.';
  end if;

  select ev->'payload'->'patch'->>'species2' into v_old_species2
    from jsonb_array_elements(v_old_log) with ordinality as t(ev, ord)
   where ev->>'type'='buy' and ev->>'cat'='patch' and ev->'payload'->'patch' ? 'species2'
   order by ord desc limit 1;
  select ev->'payload'->'patch'->>'species2' into v_new_species2
    from jsonb_array_elements(coalesce(NEW.stats->'LOG','[]'::jsonb)) with ordinality as t(ev, ord)
   where ev->>'type'='buy' and ev->>'cat'='patch' and ev->'payload'->'patch' ? 'species2'
   order by ord desc limit 1;
  if v_old_species2 is not null and v_old_species2 <> '(none)'
     and v_new_species2 is distinct from v_old_species2 then
    raise exception 'PACT: locked character history — second origin species is frozen (was %, tried to set %)',
                    v_old_species2, coalesce(v_new_species2, '(none)')
      using hint = 'Your DM locked this character. Ask them to change it for you.';
  end if;

  select ev->'payload'->'patch'->'stats' into v_old_stats
    from jsonb_array_elements(v_old_log) with ordinality as t(ev, ord)
   where ev->>'type'='buy' and ev->>'cat'='patch' and ev->'payload'->'patch' ? 'stats'
   order by ord desc limit 1;
  select ev->'payload'->'patch'->'stats' into v_new_stats
    from jsonb_array_elements(coalesce(NEW.stats->'LOG','[]'::jsonb)) with ordinality as t(ev, ord)
   where ev->>'type'='buy' and ev->>'cat'='patch' and ev->'payload'->'patch' ? 'stats'
   order by ord desc limit 1;

  if v_old_stats is not null and jsonb_typeof(v_old_stats) = 'object' then
    for v_key in select jsonb_object_keys(v_old_stats) loop
      if jsonb_typeof(v_old_stats->v_key) = 'number' then
        if v_new_stats is null or (v_new_stats->v_key) is null
           or jsonb_typeof(v_new_stats->v_key) <> 'number'
           or (v_new_stats->>v_key)::numeric < (v_old_stats->>v_key)::numeric then
          raise exception 'PACT: locked character history — % cannot go below % (tried %)',
                          v_key, v_old_stats->>v_key, coalesce(v_new_stats->>v_key, '(removed)')
            using hint = 'Your DM locked this character. Ability scores can still be raised, but not lowered or moved.';
        end if;
      end if;
    end loop;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_pact_locked_history on public.characters;
create trigger trg_pact_locked_history
  before update on public.characters
  for each row execute function public.pact_enforce_locked_history();

-- ---------------------------------------------------------------------------
-- Session-seal RPCs (feat/session-seal, 2026-09-01; award_ap_and_seal's `for update` added 2026-09-02
-- by D-GH-2026-09-02 restore-dm-edit-guards). These were MISSING from this baseline entirely until
-- 2026-09-02: a database built the documented fresh-install way (schema.sql + this file) shipped the
-- tools' Phase-2 UI calling supabase.rpc('seal_character_history') against a database where no such
-- function existed. Every seal failed, and nothing enforced a seal that did somehow land.
-- ---------------------------------------------------------------------------
create or replace function public.seal_character_history(
  p_character uuid,
  p_note      text default null,
  p_idem      text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign uuid;
  v_owner    uuid;
  v_stats    jsonb;
  v_log      jsonb;
  v_seq      integer;
  v_ev       jsonb;
  v_ts       bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  select campaign_id, owner_id, stats
    into v_campaign, v_owner, v_stats
    from characters where id = p_character for update;
  if not found then
    raise exception 'Character not found';
  end if;

  if v_campaign is not null then
    if not is_campaign_dm(v_campaign) then
      raise exception 'Only a campaign DM can seal this character''s history';
    end if;
    perform assert_campaign_active(v_campaign);
  elsif v_owner is distinct from auth.uid() then
    raise exception 'Only the owner can seal a character that is not in a campaign';
  end if;

  if v_stats is null or not (v_stats ? 'LOG') then
    raise exception 'Character has no log to seal';
  end if;
  v_log := coalesce(v_stats->'LOG', '[]'::jsonb);

  if p_idem is not null then
    select ev into v_ev
      from jsonb_array_elements(v_log) as t(ev)
     where t.ev->>'type' = 'sessionSeal' and t.ev->>'idem' = p_idem
     limit 1;
    if v_ev is not null then
      return v_ev;
    end if;
  end if;

  v_seq := coalesce((v_stats->>'SEQ')::integer, jsonb_array_length(v_log) + 1);
  v_ev := jsonb_build_object(
    'seq',        v_seq,
    'ts',         v_ts,
    'type',       'sessionSeal',
    'label',      coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Session sealed'),
    'note',       coalesce(p_note, ''),
    'sealedBy',   auth.uid(),
    'sealedRole', case when v_campaign is null then 'owner' else 'dm' end
  );
  if p_idem is not null then
    v_ev := v_ev || jsonb_build_object('idem', p_idem);
  end if;
  -- dmEdit marks ANOTHER account's edit, so it belongs on a DM seal and not on a self-seal. The
  -- protection does not depend on it either way — `sessionSeal` is a boundary by type.
  if v_campaign is not null then
    v_ev := v_ev || jsonb_build_object('dmEdit', true, 'dmId', auth.uid());
  end if;

  v_stats := jsonb_set(jsonb_set(v_stats, '{LOG}', v_log || jsonb_build_array(v_ev)),
                       '{SEQ}', to_jsonb(v_seq + 1));
  update characters set stats = v_stats where id = p_character;
  return v_ev;
end;
$$;

create or replace function public.award_ap_and_seal(
  -- DEFAULTS MUST BE REPEATED. `create or replace` cannot drop parameter defaults from an existing
  -- function (Postgres: "cannot remove parameter defaults from existing function"), and the
  -- 2026-09-01 migration created this with defaults on both text arguments. Omitting them here made
  -- this file fail outright on a database that already had the function — caught by running
  -- testing/sql/session-seal-test.sql against a real Postgres 16, not by reading it.
  p_character uuid, p_amount integer, p_note text default null::text, p_idem text default null::text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ap integer; v_seal jsonb; v_campaign uuid; v_owner uuid;
begin
  -- AUTHORISE FIRST, before the replay shortcut can return anything.
  -- `for update` added 2026-09-02: serialises concurrent calls sharing one p_idem so the replay
  -- probe below cannot be passed twice and award_ap() run twice.
  select campaign_id, owner_id into v_campaign, v_owner from characters where id = p_character for update;
  if not found then raise exception 'Character not found'; end if;
  if v_campaign is not null then
    if not is_campaign_dm(v_campaign) then
      raise exception 'Only a campaign DM can award AP and seal this character';
    end if;
  elsif v_owner is distinct from auth.uid() then
    raise exception 'Only the owner can seal a character that is not in a campaign';
  end if;

  if p_idem is not null then
    select ev into v_seal
      from characters c, jsonb_array_elements(coalesce(c.stats->'LOG', '[]'::jsonb)) as t(ev)
     where c.id = p_character and t.ev->>'type' = 'sessionSeal' and t.ev->>'idem' = p_idem limit 1;
    if v_seal is not null then
      select ap into v_ap from characters where id = p_character;
      return jsonb_build_object('ap', v_ap, 'seal', v_seal, 'repeated', true);
    end if;
  end if;
  v_ap   := public.award_ap(p_character, p_amount, p_note);
  v_seal := public.seal_character_history(p_character, p_note, p_idem);
  return jsonb_build_object('ap', v_ap, 'seal', v_seal, 'repeated', false);
end;
$$;

-- EXECUTE grants — these mirror LIVE state, verified against pg_proc's has_function_privilege on
-- 2026-09-02. Three of the four lines below used to GRANT to `authenticated`, which silently reverted
-- sql/migrations/2026-09-01-revoke-trigger-function-execute.sql every time this file was re-run — while
-- that migration's own header claimed it existed so the grant state "would be reproducible from sql/
-- alone". A trigger function is not an RPC: triggers execute as the table owner, so nothing needs
-- EXECUTE on them, and leaving them callable at /rest/v1/rpc is API surface nobody designed.
-- pact_ap_ledger_spend KEEPS its grant — it is deliberately callable, and live confirms authenticated
-- can execute it.
grant  execute on function public.pact_ap_ledger_spend(jsonb)            to authenticated;
revoke execute on function public.pact_ap_ledger_spend(jsonb)            from public, anon;
revoke execute on function public.pact_ap_ledger_protected(jsonb)        from public, anon, authenticated;
revoke execute on function public.pact_enforce_ap_budget_consistency()   from public, anon, authenticated;
revoke execute on function public.pact_enforce_locked_history()          from public, anon, authenticated;

-- The seal RPCs ARE meant to be called by a signed-in user; both gate authorisation internally.
revoke execute on function public.seal_character_history(uuid, text, text) from public, anon;
grant  execute on function public.seal_character_history(uuid, text, text) to authenticated;
revoke execute on function public.award_ap_and_seal(uuid, integer, text, text) from public, anon;
grant  execute on function public.award_ap_and_seal(uuid, integer, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- campaign_invites — unified player+dm invite tokens (extended from player-only by
-- D-GH-2026-08-09-harden-invitation-system). A DM sees all invites for their campaign; a redeemer can
-- read their own redeemed row. Writes happen only through create_player_invite()/redeem_player_invite()
-- /create_dm_invite()/redeem_dm_invite() (all SECURITY DEFINER) — no insert/update/delete policy.
--
-- `note` is withheld at the COLUMN level (D-GH-2026-08-03-invite-note-dm-only): the redeemer clause
-- below would otherwise let a player read the DM's label for their own invite, RLS being row-level.
-- The DM reads notes through list_campaign_invites(), which is SECURITY DEFINER. `token_hash` is
-- withheld the same way and for the same structural reason (row-level RLS can't do column-level
-- exclusion) — it is never selectable by any client role, DM included; DM invites are read back via
-- list_campaign_invites() too, which always returns null for a dm-type row's token (the plaintext was
-- never stored — Security Invariant 1). Note that a column-level revoke cannot subtract from a
-- table-level grant — the blanket grant is dropped and the wanted columns granted explicitly, which is
-- why this is a column list and not `grant select on`.
--
-- D-GH-2026-08-30-invite-note-grant-drift: the paragraph above describes the intent, but until this
-- change nothing in this file actually EXECUTED that drop — there was no `revoke` before the `grant
-- select (...)` below. Production stayed safe only because whatever role actually ran the historical
-- migration chain there never picked up a table-level SELECT for `authenticated`/`anon` on this table
-- from Postgres's `pg_default_acl` in the first place (confirmed via `information_schema.column_
-- privileges`: `note`/`token_hash` carry no SELECT there). A FRESH build from this file — exactly what
-- `testing/scripts/cloud-e2e.mjs`'s local Supabase CLI stack does — is not guaranteed the same luck:
-- pg_default_acl depends on which role issues `create table`, and CI's stack reproducibly leaks `note`.
-- The explicit `revoke` below makes the restriction hold regardless of ambient default privileges,
-- matching what the comment above already claimed. It is a no-op wherever the privilege was never held
-- (verified safe against the live production table), so this is safe to apply anywhere.
-- ---------------------------------------------------------------------------
alter table public.campaign_invites enable row level security;

drop policy if exists campaign_invites_select on public.campaign_invites;
create policy campaign_invites_select on public.campaign_invites
  for select using (is_campaign_dm(campaign_id) or redeemed_by = auth.uid());

revoke select on public.campaign_invites from authenticated, anon;   -- see D-GH-2026-08-30 note above

grant select (id, campaign_id, type, mode, token, starting_ap, starting_budget,
              max_redemptions, redeemed_count, expires_at,
              created_by, created_at, revoked_at,
              redeemed_by, redeemed_at)
  on public.campaign_invites to authenticated;   -- every column EXCEPT note and token_hash

-- campaign_invite_redemptions — per-redeemer tracking for REUSABLE (dm-only) invites. A redeemer sees
-- their own row; a DM sees every redemption of any invite belonging to their campaign. Written only by
-- redeem_dm_invite() (SECURITY DEFINER) — no insert/update/delete policy.
alter table public.campaign_invite_redemptions enable row level security;

drop policy if exists campaign_invite_redemptions_select on public.campaign_invite_redemptions;
create policy campaign_invite_redemptions_select on public.campaign_invite_redemptions
  for select using (
    redeemed_by = auth.uid()
    or exists (select 1 from campaign_invites i where i.id = invite_id and is_campaign_dm(i.campaign_id))
  );
grant select on public.campaign_invite_redemptions to authenticated;

-- ---------------------------------------------------------------------------
-- Allow authenticated users to call the controlled RPCs.
-- ---------------------------------------------------------------------------
grant execute on function public.join_campaign(text)                to authenticated;
grant execute on function public.create_dm_invite(uuid, text, integer, text, timestamptz) to authenticated;
grant execute on function public.redeem_dm_invite(text)                                   to authenticated;
grant execute on function public.promote_to_dm(uuid, uuid)          to authenticated;
grant execute on function public.remove_dm(uuid, uuid)              to authenticated;
grant execute on function public.regenerate_invite_code(uuid)       to authenticated;
grant execute on function public.archive_campaign(uuid)             to authenticated;
grant execute on function public.unarchive_campaign(uuid)           to authenticated;
grant execute on function public.award_ap(uuid, integer, text)      to authenticated;
grant execute on function public.award_gold(uuid, integer, text) to authenticated;
grant execute on function public.declare_downtime(uuid, integer, uuid, text) to authenticated;
grant execute on function public.get_downtime_window(uuid, uuid) to authenticated;
grant execute on function public.redeem_player_invite(text, text)             to authenticated;
grant execute on function public.bind_character_to_campaign(uuid, text)       to authenticated;
grant execute on function public.dm_unbind_character(uuid)                    to authenticated;
grant execute on function public.is_campaign_dm_of_character(uuid)            to authenticated;
grant execute on function public.create_player_invite(uuid, integer, integer, text) to authenticated;
grant execute on function public.list_campaign_invites(uuid)                        to authenticated;
grant execute on function public.set_invite_revoked(uuid, boolean)                  to authenticated;
grant execute on function public.peek_player_invite(text)                           to authenticated;
grant execute on function public.dm_edit_character_log(uuid, jsonb)                 to authenticated;
grant execute on function public.create_character_claim(uuid, text)                 to authenticated;
grant execute on function public.redeem_character_claim(text)                       to authenticated;

-- create_player_invite gained a 4th (p_note) parameter on 2026-08-03. `create or replace` with a new
-- signature CREATES a second function rather than replacing the old one, so the 3-argument version was
-- dropped in that migration — this revoke targets the surviving signature.
revoke execute on function public.create_player_invite(uuid, integer, integer, text) from public;
revoke execute on function public.list_campaign_invites(uuid)                        from public;
revoke execute on function public.set_invite_revoked(uuid, boolean)                  from public;
revoke execute on function public.redeem_player_invite(text, text)             from public;
revoke execute on function public.peek_player_invite(text)                     from public;
revoke execute on function public.dm_edit_character_log(uuid, jsonb)           from public;
revoke execute on function public.bind_character_to_campaign(uuid, text)       from public;
revoke execute on function public.dm_unbind_character(uuid)                    from public;
revoke execute on function public.is_campaign_dm_of_character(uuid)            from public;
revoke execute on function public.create_character_claim(uuid, text)          from public;
revoke execute on function public.redeem_character_claim(text)                from public;

-- Postgres grants EXECUTE to PUBLIC by default on every new function; revoke it here
-- so award_ap is authenticated-only rather than relying solely on its internal
-- is_campaign_dm() guard. See sql/migrations/2026-07-02-drop-legacy-award-xp-lock-award-ap.sql.
revoke execute on function public.award_ap(uuid, integer, text) from public;
revoke execute on function public.award_gold(uuid, integer, text) from public;
revoke execute on function public.declare_downtime(uuid, integer, uuid, text) from public;
revoke execute on function public.get_downtime_window(uuid, uuid) from public;

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

-- Archived-campaign write lockdown helpers (see their definitions above).
-- is_campaign_dm_and_active must be directly callable by authenticated, since it's evaluated
-- in the querying role's context as an RLS predicate (campaigns_update, characters_delete).
grant execute on function public.is_campaign_active(uuid)        to authenticated;
grant execute on function public.assert_campaign_active(uuid)    to authenticated;
grant execute on function public.is_campaign_dm_and_active(uuid) to authenticated;

revoke execute on function public.is_campaign_dm(uuid)     from public;
revoke execute on function public.is_campaign_owner(uuid)  from public;
revoke execute on function public.is_campaign_member(uuid) from public;
revoke execute on function public.shares_campaign(uuid)    from public;
revoke execute on function public.gen_invite_code()        from public;

revoke execute on function public.is_campaign_active(uuid)        from public;
revoke execute on function public.assert_campaign_active(uuid)    from public;
revoke execute on function public.is_campaign_dm_and_active(uuid) from public;

-- Client-facing RPCs already granted to authenticated above: just strip the
-- redundant PUBLIC grant.
revoke execute on function public.join_campaign(text)             from public;
revoke execute on function public.create_dm_invite(uuid, text, integer, text, timestamptz) from public;
revoke execute on function public.redeem_dm_invite(text)                                   from public;
revoke execute on function public.promote_to_dm(uuid, uuid)       from public;
revoke execute on function public.remove_dm(uuid, uuid)           from public;
revoke execute on function public.archive_campaign(uuid)          from public;
revoke execute on function public.unarchive_campaign(uuid)        from public;
revoke execute on function public.regenerate_invite_code(uuid)    from public;

-- find_campaign_by_invite_code (schema.sql; D-GH-2026-07-13-campaign-
-- membership-helpers): unlike is_campaign_dm/owner/member above, it's NEVER
-- called from an RLS policy's USING clause — only from inside
-- join_campaign/bind_character_to_campaign, which already run elevated as
-- SECURITY DEFINER. So no grant to authenticated at all, just strip the
-- PUBLIC default so it can't be called as a standalone client RPC.
revoke execute on function public.find_campaign_by_invite_code(text) from public;

-- Trigger-only functions (handle_new_user, add_owner_as_dm, set_updated_at,
-- defined in schema.sql): revoke execute from public, no replacement grant —
-- Postgres rejects any direct call to a `returns trigger` function regardless
-- of grant, so authenticated loses EXECUTE here too and that's fine.
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.add_owner_as_dm() from public;
revoke execute on function public.set_updated_at()  from public;

-- ---------------------------------------------------------------------------
-- feedback -- in-app user feedback (feat/feedback-widget). Insert-only for BOTH
-- authenticated AND anon; NO select/update/delete grant to either role, so the
-- Supabase dashboard (service role) is the only reader (no in-app admin view in
-- v1). This is the FIRST table in this file to grant `anon` a write -- a
-- deliberate, documented relaxation of the "anon holds no table grant here"
-- invariant noted in the function-lockdown block above. It is safe because the
-- insert policy below calls ONLY auth.uid() (a Supabase built-in, granted to anon
-- by default), not any of the is_campaign_*/shares_campaign helpers whose anon
-- EXECUTE was revoked above -- so no policy evaluation hits a "permission denied
-- for function" for anon. See DECISIONS.md D-GH-2026-07-15-feedback-widget.
-- ---------------------------------------------------------------------------
alter table public.feedback enable row level security;

-- Column-restricted insert: id and created_at are DB-defaulted and must never be
-- client-supplied (mirrors the characters insert-grant pattern above). Granted to
-- anon as well, since anonymous feedback is allowed.
grant insert (user_id, page, message, contact) on public.feedback to authenticated, anon;

drop policy if exists feedback_insert on public.feedback;
create policy feedback_insert on public.feedback
  for insert to authenticated, anon
  -- A caller may tag a row with their OWN user_id or leave it null (anonymous);
  -- they can never attribute feedback to someone else. For anon, auth.uid() is
  -- null, so ONLY user_id = null passes. The length guard mirrors the column
  -- CHECK so a bad insert is rejected at the policy layer too, not only the column.
  with check (
    char_length(message) between 1 and 2000
    and (user_id is null or user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- character_backups -- automatic pre-change snapshots (see schema.sql and
-- sql/migrations/2026-08-07-character-backups.sql).
--
-- RLS ON with ZERO policies. That is the whole access model, not an omission:
-- with RLS enabled and no permissive policy, every row fails for every client
-- role, so authenticated/anon can neither read, write, nor detect this table.
-- service_role bypasses RLS by design and is the only reader -- the same posture
-- as `feedback` above (no in-app admin view; the Supabase dashboard is the
-- admin surface). An in-app restore UI would require inventing an admin role,
-- which this project deliberately does not have.
--
-- The explicit service_role grant is NOT redundant with the blanket
-- `grant ... on all tables ... to service_role` earlier in this file: that ran
-- against the tables existing at the time and does not apply to tables created
-- later. A new table needs its own grant.
--
-- The trigger function still writes fine under all of this because it is
-- SECURITY DEFINER and owned by postgres -- see schema.sql for why that is
-- load-bearing rather than incidental.
-- ---------------------------------------------------------------------------
alter table public.character_backups enable row level security;

revoke all on public.character_backups from authenticated, anon;
grant select, insert, update, delete on public.character_backups to service_role;

revoke execute on function public.snapshot_character() from public, authenticated, anon;
