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

-- NPC rows (feat/campaign-npcs) never make their owner a "member": a DM's NPCs must not block that DM joining as a
-- player, nor keep a removed co-DM reading the campaign.
create or replace function public.is_campaign_member(p_campaign uuid)
returns boolean language sql security definer stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from characters where campaign_id = p_campaign and owner_id = auth.uid() and not is_npc
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
alter table public.ap_award_edits     enable row level security;
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
-- feat/player-basic-mode: plain UPDATE deliberately NOT granted here (was blanket/unscoped before
-- this feature; confirmed unused -- nothing in the app performs a client-side UPDATE on profiles).
-- basic_mode/basic_mode_set_by/basic_mode_set_at are writable ONLY through set_basic_mode()/
-- unset_basic_mode() below (both SECURITY DEFINER), never by a plain grant -- see that section for
-- why. If a future feature needs direct profile writes (e.g. editing display_name), add
-- `grant update (display_name) on public.profiles to authenticated;` then, column-scoped like
-- characters' own grants below, not a blanket update.
grant select, insert on public.profiles to authenticated;
grant select on public.campaign_dms to authenticated;   -- writes via RPCs only
grant select on public.ap_awards    to authenticated;   -- inserts via award_ap only
grant select on public.ap_award_edits to authenticated; -- inserts via edit_ap_award only
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
-- ap_award_edits — the audit trail for edit_ap_award() (feat/dm-ap-award-editing, 2026-09-08).
-- Same readers as ap_awards immediately above, on purpose (owner decision this session, "4:
-- transparency"): a player can see that one of their own awards was corrected, and why, not just
-- the DM. Inserts happen only through edit_ap_award() (definer).
-- ---------------------------------------------------------------------------
drop policy if exists ap_award_edits_select on public.ap_award_edits;
create policy ap_award_edits_select on public.ap_award_edits
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
-- edit_ap_award(award_id, new_amount, new_note, new_created_at, edit_note) — feat/dm-ap-award-editing,
-- 2026-09-08; new_created_at added feat/dm-ap-award-filters item 4 (2026-09-08, owner decision A —
-- see decisions/2026/D-GH-2026-09-08-ap-award-editing.md's addendum). The ONLY way to change an
-- existing ap_awards row. Same permission shape as award_ap() directly above: any DM of the award's
-- (still-active) campaign. edit_note is required (a correction always states why).
--
-- new_created_at is NULLABLE — pass NULL to leave the award's date untouched (the common case: an
-- amount/note-only edit). When non-NULL, this DIRECTLY REWRITES ap_awards.created_at, the row's
-- actual insert time and (until this change) the one fact ap_award_edits' own audit ordering could
-- rely on being immutable. That tradeoff was surfaced and accepted explicitly (owner: "a lot are
-- awarded at the same second and the ordering makes it hard for me to understand" — confirmed live,
-- one batch has 24 rows sharing the same created_at to the microsecond) rather than the safer
-- alternative (a separate occurred_at display field, created_at left untouched).
--
-- Logs the full before/after to ap_award_edits (old/new_created_at only populated when this edit
-- actually touched the date — see that table's own comment), then applies the AMOUNT DELTA
-- (new − old) to characters.ap, not an overwrite, so it composes correctly with any award made
-- between the original and this edit. The date rewrite itself has no AP effect.
-- ---------------------------------------------------------------------------
drop function if exists public.edit_ap_award(uuid, integer, text, text);
create or replace function public.edit_ap_award(
  p_award_id       uuid,
  p_new_amount     integer,
  p_new_note       text,
  p_new_created_at timestamptz,
  p_edit_note      text
)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_character      uuid;
  v_campaign       uuid;
  v_char_campaign  uuid;
  v_old_amount     integer;
  v_old_note       text;
  v_old_created_at timestamptz;
  v_delta          integer;
  v_ap             integer;
begin
  if p_edit_note is null or btrim(p_edit_note) = '' then
    raise exception 'An edit note is required';
  end if;

  -- for update: two concurrent edits of one award serialise, so each computes its delta from the amount the other left.
  select character_id, campaign_id, amount, note, created_at
    into v_character, v_campaign, v_old_amount, v_old_note, v_old_created_at
    from ap_awards where id = p_award_id for update;

  if v_character is null then
    raise exception 'Award not found';
  end if;
  if v_campaign is null then
    raise exception 'Award has no campaign context';
  end if;
  if not is_campaign_dm(v_campaign) then
    raise exception 'Only a campaign DM can edit an AP award';
  end if;
  perform assert_campaign_active(v_campaign);

  -- The award belongs to a campaign; the AP it paid out only counts while the character is still IN that campaign.
  select campaign_id into v_char_campaign from characters where id = v_character for update;
  if v_char_campaign is distinct from v_campaign then
    raise exception 'This character is no longer in the campaign that made this award';
  end if;

  v_delta := p_new_amount - v_old_amount;

  insert into ap_award_edits
    (award_id, character_id, campaign_id, dm_id, old_amount, old_note, new_amount, new_note,
     old_created_at, new_created_at, edit_note)
    values
    (p_award_id, v_character, v_campaign, auth.uid(), v_old_amount, v_old_note, p_new_amount, p_new_note,
     case when p_new_created_at is not null then v_old_created_at else null end,
     p_new_created_at,
     p_edit_note);

  update ap_awards
    set amount = p_new_amount,
        note = p_new_note,
        created_at = coalesce(p_new_created_at, created_at)
    where id = p_award_id;

  update characters set ap = ap + v_delta
    where id = v_character
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
-- Campaign NPCs (feat/campaign-npcs, D-GH-2026-10-11-campaign-npcs). A DM's own character bound to their own campaign
-- with is_npc = true. Same definitions as sql/migrations/2026-10-11-campaign-npcs.sql (the index re-scope lives in
-- schema.sql next to the index). is_npc is in NO client column grant: dm_bind_npc() is the only setter, so a player can
-- never self-flag past the one-per-campaign rule. The basic-mode count deliberately still includes NPCs (any user can
-- create a campaign, so excluding them would be a bypass).
-- ---------------------------------------------------------------------------
alter table public.characters add column if not exists is_npc boolean not null default false;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'characters_npc_needs_campaign') then
    alter table public.characters add constraint characters_npc_needs_campaign check (not is_npc or campaign_id is not null);
  end if;
end $$;

create or replace function public.pact_npc_clear_on_unbind()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.is_npc := false;
  return new;
end;
$$;
revoke all on function public.pact_npc_clear_on_unbind() from public, anon, authenticated;

drop trigger if exists trg_pact_npc_clear_on_unbind on public.characters;
create trigger trg_pact_npc_clear_on_unbind
  before update on public.characters
  for each row when (new.campaign_id is null and new.is_npc)
  execute function public.pact_npc_clear_on_unbind();

create or replace function public.dm_bind_npc(p_character uuid, p_campaign uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_char characters%rowtype;
begin
  if auth.uid() is null then
    raise exception 'PACT: not signed in';
  end if;
  select * into v_char from characters where id = p_character and owner_id = auth.uid() for update;
  if not found then
    raise exception 'PACT: character not found (an NPC must be one of your own characters)';
  end if;
  if not is_campaign_dm(p_campaign) then
    raise exception 'PACT: only a DM of this campaign can add an NPC to it';
  end if;
  perform assert_campaign_active(p_campaign);
  if v_char.archived_at is not null then
    raise exception 'PACT: un-archive this character before adding it as an NPC';
  end if;
  if v_char.campaign_id = p_campaign and v_char.is_npc then
    return p_campaign;
  end if;
  if v_char.campaign_id is not null then
    raise exception 'PACT: this character is already in a campaign — remove it from that campaign first';
  end if;
  update characters set campaign_id = p_campaign, is_npc = true where id = p_character;
  return p_campaign;
end;
$$;
revoke all on function public.dm_bind_npc(uuid, uuid) from public, anon;
grant execute on function public.dm_bind_npc(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- dm_edit_character_log(character, events) — feat/dm-edit-events (D-GH-2026-08-10-dm-edit-events).
-- The ONLY path a DM can append to a player's own stats->LOG through — characters_update's row policy
-- is owner-only, same SECURITY DEFINER-bypass pattern as award_ap/dm_unbind_character just above,
-- extended to `stats`. Scope (owner: "not a general editor") is a FIXED allowlist of audited event types,
-- never arbitrary events: buy/cat:boon, buy/cat:drawback, award, dmRemoveBoon, sessionSeal, dmUnlockDrawback.
-- The last two are MARKERS rather than ledger transactions (they move no AP), and dmUnlockDrawback also changes
-- what the player's own client allows (a locked drawback may then be bought off) — which is why it is validated
-- against the stored log and rebuilt from a whitelist, not just allowlisted.
-- Server stamps seq/ts/dmEdit/dmId on every event, discarding whatever the client sent for them — the caller
-- cannot forge who made the edit, when, or where in the log it lands.
-- Accepts a JSON ARRAY so a DM-granted boon's matched buy+award pair lands in ONE atomic write (see
-- the migration file's header for why two separate calls would leave a real, if brief, non-neutral
-- moment). See sql/migrations/2026-08-10-dm-edit-character-log.sql for the full design/compatibility
-- reasoning against the AP-integrity triggers just below.
-- ---------------------------------------------------------------------------
-- [HOUSE RULES] Redefined by sql/migrations/2026-10-13-campaign-house-rules-server.sql (APPLIED 2026-10-20); the statement below is that migration's, verbatim.
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
  -- feat/dm-unlock-drawback (D-GH-2026-10-04-dm-unlock-drawback): scratch for validating 'dmUnlockDrawback'.
  v_name       text;
  v_target     integer;
  v_note       text;
  v_matches    integer;
  -- feat/dm-ap-discount (D-GH-2026-10-13-dm-ap-discount): scratch for validating 'dmDiscount'.
  v_tcat       text;
  v_amount     numeric;
  v_cost       numeric;
  v_prior      numeric;
  -- feat/boon-drawback-notes (D-GH-2026-10-15-boon-drawback-notes): scratch for validating 'dmApproveNote'/'dmUnlockNote'.
  v_nstatus    text;
  v_ntext      text;
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
  v_seq := public.pact_next_seq(v_stats);

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
    -- [UNLOCK] 'dmUnlockDrawback' added by 2026-10-04-dm-unlock-drawback.sql: a DM releases a drawback they
    -- imposed LOCKED once the story beat has happened. Validated below, per event.
    -- [HR] 'dmHouseRules' added by 2026-10-13-campaign-house-rules-server.sql: a DM's per-character house-rule override
    -- snapshot for THIS campaign. Validated and rebuilt below. The three AP-moving house-rules events are NOT accepted
    -- here: dm_apply_house_rules_change() is their only writer (it validates the target and stamps the amounts).
    -- [DISCOUNT] 'dmDiscount' added by 2026-10-13-dm-ap-discount.sql: a DM takes AP off one earlier priced
    -- purchase. Validated below, per event.
    -- [NOTES] 'dmApproveNote' / 'dmUnlockNote' added by 2026-10-15-boon-drawback-notes.sql: a DM approves (locks) or
    -- re-opens a player's description of a boon/drawback. Validated below, per event.
    elsif v_type not in ('award', 'dmRemoveBoon', 'sessionSeal', 'dmUnlockDrawback', 'dmHouseRules', 'dmDiscount', 'dmApproveNote', 'dmUnlockNote') then
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

    -- [UNLOCK] An unlock is a marker, not a transaction, and it must name ONE specific purchase. Keyed by the
    -- imposed purchase's server-stamped seq plus its drawback name — never by name alone, because a character
    -- can hold a player-taken and an imposed purchase of the same name and js/engine.js's buy-off match is
    -- by name (FIFO). The target must already be in the STORED log: an imposition and its unlock cannot be
    -- sent in the same call. Validated against the stored log, not the client, so a DM cannot unlock a
    -- player-taken drawback, an unlocked one, one that does not exist, or the same one twice.
    -- Deliberately NOT checked here: whether the target has since been bought off. That is js/engine.js's
    -- by-name FIFO match; re-implementing it in SQL would duplicate a rules decision in a second place. An
    -- unlock of a bought-off purchase is a harmless no-op the engine ignores, and DM Console only ever offers
    -- purchases the engine reports as open.
    if v_type = 'dmUnlockDrawback' then
      v_name := btrim(coalesce(v_ev->>'refVal', ''));
      v_note := btrim(coalesce(v_ev->>'note', ''));
      if v_name = '' then
        raise exception 'dm_edit_character_log: dmUnlockDrawback needs refVal (the drawback name)';
      end if;
      if coalesce(v_ev->>'targetSeq', '') !~ '^[0-9]{1,9}$' then
        raise exception 'dm_edit_character_log: dmUnlockDrawback needs targetSeq (the integer seq of the imposed purchase)';
      end if;
      v_target := (v_ev->>'targetSeq')::integer;
      if v_note = '' or char_length(v_note) > 200 then
        raise exception 'dm_edit_character_log: dmUnlockDrawback needs a story-beat note of 1 to 200 characters';
      end if;
      -- jsonb equality, not ::boolean casts: a hand-edited log can hold any value in these fields, and a
      -- cast error here would abort the DM's call instead of cleanly refusing it.
      select count(*) into v_matches
        from jsonb_array_elements(v_log) as t(e)
       where e->>'type' = 'buy' and e->>'cat' = 'drawback'
         and e#>>'{payload,v}' = v_name
         and e->>'seq' = v_target::text
         and e->'dmEdit' = 'true'::jsonb
         and e->'dmLocked' = 'true'::jsonb;
      if v_matches <> 1 then
        raise exception 'dm_edit_character_log: no single DM-imposed, locked drawback "%" at seq % to unlock (found %)', v_name, v_target, v_matches;
      end if;
      if exists (select 1 from jsonb_array_elements(v_log || v_new) as t(e)
                  where e->>'type' = 'dmUnlockDrawback' and e->>'refVal' = v_name
                    and e->>'targetSeq' = v_target::text) then
        raise exception 'dm_edit_character_log: drawback "%" at seq % is already unlocked', v_name, v_target;
      end if;
      -- Rebuild from a whitelist instead of stripping fields: nothing else the client sent (cost, amount, disc,
      -- payload, ...) may ride along, so the event cannot move AP or masquerade as another type.
      v_ev := jsonb_build_object('type', 'dmUnlockDrawback', 'refVal', v_name, 'targetSeq', v_target,
                                 'note', v_note,
                                 'label', left(coalesce(nullif(btrim(v_ev->>'label'), ''), 'DM unlocked — ' || v_name), 120));
    end if;

    -- [HR] A per-character override snapshot (js/engine.js: the LAST DM-stamped dmHouseRules for a campaignId IS that
    -- campaign's override layer). Shape-checked by the shared validator and REBUILT from a whitelist; campaignId is the
    -- character's campaign, stamped here — never the client's — so an override applies only in the campaign whose DM
    -- wrote it. Not a buy: no cost, never repriced, and allowed on a creation draft.
    if v_type = 'dmHouseRules' then
      perform public.pact_hr_validate(v_ev->'overrides', 'override');
      v_ev := jsonb_build_object('type', 'dmHouseRules', 'overrides', v_ev->'overrides', 'campaignId', v_campaign::text,
                                 'label', left(coalesce(nullif(btrim(v_ev->>'label'), ''), 'DM house rules for this character'), 120));
    end if;

    -- [DISCOUNT] A discount names ONE earlier purchase by its seq plus its category (`targetCat`: the buy's
    -- `cat`, or 'buyoff' / 'names' for those types) — the same identity js/engine.js's activeEvents() resolves.
    -- The target is looked up in the stored log plus this call's earlier events, so a grant and its discount
    -- can be sent together. It must be the only event with that seq, a priced purchase (not a drawback), and
    -- the purchase's net discount after this one must stay between 0 and its frozen cost: a negative amount is
    -- how a DM corrects a mistake, and nothing is ever deleted. Amounts are whole AP and must be JSON numbers.
    -- Not checked: whether the purchase is still owned — js/engine.js decides that (owner decision I1).
    if v_type = 'dmDiscount' then
      v_tcat := btrim(coalesce(v_ev->>'targetCat', ''));
      v_note := btrim(coalesce(v_ev->>'note', ''));
      if coalesce(v_ev->>'targetSeq', '') !~ '^[0-9]{1,9}$' then
        raise exception 'dm_edit_character_log: dmDiscount needs targetSeq (the integer seq of the purchase)';
      end if;
      v_target := (v_ev->>'targetSeq')::integer;
      if v_tcat = '' then
        raise exception 'dm_edit_character_log: dmDiscount needs targetCat (the purchase''s category)';
      end if;
      if jsonb_typeof(v_ev->'amount') is distinct from 'number' then
        raise exception 'dm_edit_character_log: dmDiscount needs a whole, non-zero amount of AP';
      end if;
      v_amount := (v_ev->>'amount')::numeric;
      if v_amount = 0 or v_amount <> trunc(v_amount) then
        raise exception 'dm_edit_character_log: dmDiscount needs a whole, non-zero amount of AP';
      end if;
      if v_note = '' or char_length(v_note) > 200 then
        raise exception 'dm_edit_character_log: dmDiscount needs a note of 1 to 200 characters';
      end if;
      select count(*),
             max(case when e->>'type' = 'buy' then coalesce(e->>'cat', '') else e->>'type' end),
             max(case when jsonb_typeof(e->'cost') = 'number' then (e->>'cost')::numeric else 0 end)
        into v_matches, v_cat, v_cost
        from jsonb_array_elements(v_log || v_new) as t(e)
       where e->>'seq' = v_target::text and coalesce(e->>'type', '') <> 'dmDiscount';
      if v_matches <> 1 or v_cat is distinct from v_tcat or v_cat = 'drawback'
         or not exists (select 1 from jsonb_array_elements(v_log || v_new) as t(e)
                         where e->>'seq' = v_target::text and e->>'type' in ('buy', 'buyoff', 'names'))
         or coalesce(v_cost, 0) <= 0 then
        raise exception 'dm_edit_character_log: no single priced % purchase at seq % to discount (found %)', v_tcat, v_target, v_matches;
      end if;
      -- [HR x DISCOUNT] (merge of the two 2026-10-13 migrations, D-GH-2026-10-13-campaign-house-rules addendum): a boon the
      -- DM refunded (dm_apply_house_rules_change, dmRefundBoon) is gone, and its refund already returned its full price, so
      -- js/engine.js and the ledger (pact_ap_ledger_split's discount column) drop a refunded boon's discount. Refuse a new one
      -- (or a correction) on it rather than record AP that never moves.
      if exists (select 1 from jsonb_array_elements(v_log || v_new) as t(e)
                  where e->>'type' = 'dmRefundBoon' and e->'dmEdit' = 'true'::jsonb
                    and public.pact_js_key(e->'targetSeq') = v_target::text) then
        raise exception 'dm_edit_character_log: seq % was refunded by the DM — there is nothing left to discount', v_target;
      end if;
      select coalesce(sum((e->>'amount')::numeric), 0) into v_prior
        from jsonb_array_elements(v_log || v_new) as t(e)
       where e->>'type' = 'dmDiscount' and e->>'targetSeq' = v_target::text and jsonb_typeof(e->'amount') = 'number';
      if v_prior + v_amount < 0 or v_prior + v_amount > v_cost then
        raise exception 'dm_edit_character_log: a discount of % would take seq % to % AP off a % AP purchase (allowed 0 to %)',
          v_amount, v_target, v_prior + v_amount, v_cost, v_cost;
      end if;
      -- Rebuild from a whitelist, like the unlock: no cost, payload or other field the client sent rides along.
      v_ev := jsonb_build_object('type', 'dmDiscount', 'targetSeq', v_target, 'targetCat', v_tcat,
                                 'amount', v_amount::integer, 'note', v_note,
                                 'label', left(coalesce(nullif(btrim(v_ev->>'label'), ''), 'DM discount — ' || v_amount::integer || ' AP'), 120));
    end if;

    -- [NOTES] Approve / unlock a player's description of a boon or drawback, keyed by category + name (a character holds
    -- at most one copy of a name; seq is not stable while CharGen rebuilds a draft). The note's state is read from the
    -- stored log (plus this call's earlier events) by pact_item_note_state(), the same reading the tools and
    -- pact_enforce_item_note_lock() use, counting only approvals made in THIS campaign. An approval needs a note awaiting
    -- approval and records the text it approved; an unlock needs an approved note. Both carry the campaign they were
    -- made in. Rebuilt from a whitelist, like the unlock and the discount.
    if v_type in ('dmApproveNote', 'dmUnlockNote') then
      v_tcat := coalesce(v_ev->>'cat', '');
      v_name := btrim(coalesce(v_ev->>'refVal', ''));
      v_note := btrim(coalesce(v_ev->>'note', ''));
      if v_tcat not in ('boon', 'drawback') or v_name = '' then
        raise exception 'dm_edit_character_log: % needs cat (boon or drawback) and refVal (the item''s name)', v_type;
      end if;
      if not exists (select 1 from jsonb_array_elements(v_log || v_new) as t(e)
                      where e->>'type' = 'buy' and e->>'cat' = v_tcat and e#>>'{payload,v}' = v_name) then
        raise exception 'dm_edit_character_log: this character has no % "%"', v_tcat, v_name;
      end if;
      select s.status, s.note into v_nstatus, v_ntext
        from public.pact_item_note_state(v_log || v_new, v_tcat, v_name, v_campaign::text) as s;
      if v_type = 'dmApproveNote' then
        if v_nstatus is distinct from 'pending' then
          raise exception 'dm_edit_character_log: no description of % "%" awaiting approval (it is %)', v_tcat, v_name, coalesce(v_nstatus, 'none');
        end if;
        -- The DM approves the text they were SHOWN (#673 review B): DM Console sends it, and a note the player changed
        -- since the page loaded is refused rather than approved unseen.
        if jsonb_typeof(v_ev->'text') is distinct from 'string' or v_ev->>'text' is distinct from v_ntext then
          raise exception 'dm_edit_character_log: the description of % "%" changed since this page loaded — reload and read it again', v_tcat, v_name;
        end if;
        v_ev := jsonb_build_object('type', 'dmApproveNote', 'cat', v_tcat, 'refVal', v_name, 'text', v_ntext,
                                   'campaignId', v_campaign::text,
                                   'label', left(coalesce(nullif(btrim(v_ev->>'label'), ''), 'DM approved description — ' || v_name), 120));
      else
        if v_nstatus is distinct from 'approved' then
          raise exception 'dm_edit_character_log: the description of % "%" is not approved (it is %)', v_tcat, v_name, coalesce(v_nstatus, 'none');
        end if;
        if char_length(v_note) > 200 then
          raise exception 'dm_edit_character_log: dmUnlockNote''s note must be 200 characters or fewer';
        end if;
        v_ev := jsonb_build_object('type', 'dmUnlockNote', 'cat', v_tcat, 'refVal', v_name, 'campaignId', v_campaign::text,
                                   'label', left(coalesce(nullif(btrim(v_ev->>'label'), ''), 'DM unlocked description — ' || v_name), 120))
                || case when v_note = '' then '{}'::jsonb else jsonb_build_object('note', v_note) end;
      end if;
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

-- =====================================================================================================================
-- feat/campaign-house-rules (D-GH-2026-10-13-campaign-house-rules) — part 1 of 2: the helpers and the AP ledger split.
-- Applied to production 2026-10-20 as sql/migrations/2026-10-13-campaign-house-rules-server.sql (plus two follow-ups that
-- re-created pact_js_number() with its JS-whitespace trim spelled in plain ASCII — the text below is the final one). Every
-- statement from here to pact_ap_ledger_split() is that migration's, verbatim; its header has the whole design. The
-- functions it REDEFINES (pact_ap_ledger_spend, pact_ap_ledger_protected, pact_enforce_ap_budget_consistency,
-- pact_ap_ledger_discount, pact_enforce_locked_history, dm_edit_character_log) are replaced in place below, each marked
-- [HOUSE RULES]; part 2 (the new guards, dm_apply_house_rules_change and the grants) follows the boon/drawback-notes section.
-- pact_drawback_printed() is GENERATED (testing/scripts/gen-drawback-prices-sql.mjs); its --check reads the migration, and a
-- later drawback price change ships as a NEW migration whose block is then folded here too.
-- =====================================================================================================================
-- ---------------------------------------------------------------------------------------------------------------------
-- Helpers: JavaScript value semantics, so the server reads a jsonb value exactly the way js/campaign.js / js/engine.js do.
-- ---------------------------------------------------------------------------------------------------------------------

-- pact_js_truthy(v): Boolean(v) for a JSON value; a missing key (SQL NULL) is undefined -> false.
create or replace function public.pact_js_truthy(p jsonb)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select case
    when p is null then false
    when jsonb_typeof(p) = 'null' then false
    when jsonb_typeof(p) = 'boolean' then p = 'true'::jsonb
    when jsonb_typeof(p) = 'number' then (p #>> '{}')::numeric <> 0
    when jsonb_typeof(p) = 'string' then (p #>> '{}') <> ''
    else true end;
$$;

-- pact_js_number(v): Number(v) for a JSON value, NULL standing for NaN and for +/-Infinity (callers want "finite or not").
-- undefined (SQL NULL) -> NaN · null -> 0 · true/false -> 1/0 · number -> itself · string -> JS StringToNumber (trimmed;
-- '' -> 0; decimal with optional sign/exponent; 0x / 0b / 0o literals) · [] -> 0 · [x] -> Number of x's string form ·
-- longer arrays / objects -> NaN. One deliberate approximation: [true] is 1 here, NaN in JS (no tool writes it).
create or replace function public.pact_js_number(p jsonb)
returns numeric language plpgsql immutable set search_path = public, pg_temp as $$
declare
  t text; s text; n numeric := 0; base int; dig int; c text; i int;
begin
  if p is null then return null; end if;
  t := jsonb_typeof(p);
  if t = 'null' then return 0;
  elsif t = 'boolean' then return case when p = 'true'::jsonb then 1 else 0 end;
  elsif t = 'number' then
    n := (p #>> '{}')::numeric;
    return case when abs(n) > 1.7976931348623157e308 then null else n end;
  elsif t = 'array' then
    if jsonb_array_length(p) = 0 then return 0; end if;
    if jsonb_array_length(p) > 1 then return null; end if;
    return public.pact_js_number(p -> 0);
  elsif t <> 'string' then
    return null;
  end if;
  s := btrim(p #>> '{}', E' \t\n\r\f\u000b' || chr(160) || chr(65279) || chr(8232) || chr(8233));   -- JS whitespace (NBSP, BOM, LS, PS by code point: plain ASCII, so no copy or transport can mangle them)
  if s = '' then return 0; end if;
  if s ~ '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$' then
    begin
      n := s::numeric;
    exception when others then
      return null;
    end;
    return case when abs(n) > 1.7976931348623157e308 then null else n end;
  end if;
  if s ~ '^0[xX][0-9a-fA-F]+$' then base := 16;
  elsif s ~ '^0[bB][01]+$' then base := 2;
  elsif s ~ '^0[oO][0-7]+$' then base := 8;
  else return null;
  end if;
  for i in 3 .. length(s) loop
    c := lower(substr(s, i, 1));
    dig := position(c in '0123456789abcdef') - 1;
    n := n * base + dig;
    if n > 1.7976931348623157e308 then return null; end if;
  end loop;
  return n;
end;
$$;

-- pact_js_key(v): the text js/engine.js gets when it builds a match key with `v + '|'` — JavaScript's String() of the parsed
-- JSON value. A number prints without trailing zeros (5.0 -> "5", 1.50 -> "1.5"), which `->>` on a jsonb numeric does not do
-- (PR #654 round-2 review, F3: a purchase stored with seq 5.0 matched nothing here while the engine matched it).
create or replace function public.pact_js_key(p jsonb)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case jsonb_typeof(p)
    when 'number' then case when (p #>> '{}')::numeric = trunc((p #>> '{}')::numeric) and abs((p #>> '{}')::numeric) < 1e21
                            then trunc((p #>> '{}')::numeric)::text
                            else trim_scale((p #>> '{}')::numeric)::text end
    when 'null' then null
    else p #>> '{}' end;
$$;

-- pact_next_seq(stats): the seq a server-stamped event takes — the greater of stats.SEQ (when a whole number) and one past
-- the highest numeric seq in the LOG (round-2 review, F4: a player-written SEQ of "abc" made every DM write to that character raise).
create or replace function public.pact_next_seq(p_stats jsonb)
returns integer language sql immutable set search_path = public, pg_temp as $$
  -- greatest() of the two (round 3): a stale, too-low SEQ can't hand out a seq the LOG already uses.
  select greatest(
    case when jsonb_typeof(p_stats -> 'SEQ') = 'number' and (p_stats ->> 'SEQ')::numeric between 0 and 2000000000
              and (p_stats ->> 'SEQ')::numeric = trunc((p_stats ->> 'SEQ')::numeric)
         then (p_stats ->> 'SEQ')::integer else 0 end,
    coalesce((select max(trunc((e ->> 'seq')::numeric))::integer
                from jsonb_array_elements(case when jsonb_typeof(p_stats -> 'LOG') = 'array' then p_stats -> 'LOG' else '[]'::jsonb end) e
               where jsonb_typeof(e -> 'seq') = 'number' and abs((e ->> 'seq')::numeric) < 2000000000), 0) + 1);
$$;

-- pact_hr_drawback_cap(rules) — owner decision Z1: the drawback AP cap the server applies, mirroring
-- js/campaign.js drawbackCapFromRules() and compute()'s Math.max(0, cap). NULL = no cap (the DM switched it off, or never
-- set one). testing/scripts/creation-lock-guard-test/drawback-cap-shapes.json holds 45 shapes generated from the real JS
-- function; run-house-rules.sh asserts this one agrees on every one, and house-rules-ledger-ci.mjs asserts the JS side.
create or replace function public.pact_hr_drawback_cap(p_rules jsonb)
returns numeric language plpgsql immutable set search_path = public, pg_temp as $$
declare
  c jsonb; n numeric;
begin
  if p_rules is null or jsonb_typeof(p_rules) <> 'object' then return null; end if;
  c := p_rules -> 'drawbackCap';
  if not public.pact_js_truthy(c) or jsonb_typeof(c) <> 'object' then return null; end if;   -- a non-object has no .ap
  if c -> 'enabled' = 'false'::jsonb then return null; end if;
  n := public.pact_js_number(c -> 'ap');
  if n is null then return null; end if;
  return greatest(0, n);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- House-rules shape validator (#642's checks, moved here and shared; plan §6.2). Raises on anything it does not accept.
--   p_layer 'campaign' — campaigns.rules.charHouseRules: {schema?:1, dmAllows?, boons?, draws?}
--   p_layer 'override' — a dmHouseRules event's overrides: {dmAllows?, boons?, draws?, disabled?, pins?:{draws?}}
-- dmAllows: bound/boons/drawbacks/tasha -> boolean · boons: name -> {hd 1-20, ap 0-1000 (whole numbers), fx? <=500} ·
-- draws: name -> {ap 0-1000, fx?} · disabled: {boons?:[name], draws?:[name]} · pins.draws: name -> {ap 0-1000, reason? <=200,
-- at? <=64}. Names: 1-80 characters, not blank, never __proto__ / constructor / prototype (js/engine.js drops those, so a
-- server that accepted one would price something the browser does not see). The whole object <= 32 KB.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.pact_hr_entry_ok(p_name text, p_val jsonb, p_kind text)
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare
  k text; v jsonb;
begin
  if p_name is null or btrim(p_name) = '' or char_length(p_name) > 80
     or p_name in ('__proto__', 'constructor', 'prototype') then return false; end if;
  if p_val is null or jsonb_typeof(p_val) <> 'object' then return false; end if;
  for k, v in select key, value from jsonb_each(p_val) loop
    if p_kind = 'boon' and k not in ('hd', 'ap', 'fx') then return false; end if;
    if p_kind = 'draw' and k not in ('ap', 'fx') then return false; end if;
    if p_kind = 'pin'  and k not in ('ap', 'reason', 'at') then return false; end if;
    if k = 'fx' and (jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 500) then return false; end if;
    if k = 'reason' and (jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 200) then return false; end if;
    if k = 'at' and (jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 64) then return false; end if;
  end loop;
  if jsonb_typeof(p_val -> 'ap') is distinct from 'number' then return false; end if;
  if (p_val ->> 'ap')::numeric not between 0 and 1000 or (p_val ->> 'ap')::numeric <> trunc((p_val ->> 'ap')::numeric) then return false; end if;
  if p_kind = 'boon' then
    if jsonb_typeof(p_val -> 'hd') is distinct from 'number' then return false; end if;
    if (p_val ->> 'hd')::numeric not between 1 and 20 or (p_val ->> 'hd')::numeric <> trunc((p_val ->> 'hd')::numeric) then return false; end if;
  end if;
  return true;
end;
$$;

create or replace function public.pact_hr_validate(p_hr jsonb, p_layer text)
returns void language plpgsql immutable set search_path = public, pg_temp as $$
declare
  k text; v jsonb; x jsonb; d record;
begin
  if p_hr is null or jsonb_typeof(p_hr) <> 'object' then
    raise exception 'PACT house rules: must be an object';
  end if;
  if octet_length(p_hr::text) > 32768 then
    raise exception 'PACT house rules: too large (32 KB at most)';
  end if;
  for k, v in select key, value from jsonb_each(p_hr) loop
    if p_layer = 'campaign' and k not in ('schema', 'dmAllows', 'boons', 'draws') then
      raise exception 'PACT house rules: unknown field "%" (campaign rules take schema, dmAllows, boons, draws; disabled items are the campaign ban lists)', k;
    end if;
    if p_layer = 'override' and k not in ('dmAllows', 'boons', 'draws', 'disabled', 'pins') then
      raise exception 'PACT house rules: unknown override field "%"', k;
    end if;
    if k = 'schema' and v is distinct from '1'::jsonb then
      raise exception 'PACT house rules: schema must be 1';
    elsif k = 'dmAllows' then
      if jsonb_typeof(v) <> 'object' then raise exception 'PACT house rules: dmAllows must be an object'; end if;
      for d in select key, value from jsonb_each(v) loop
        if d.key not in ('bound', 'boons', 'drawbacks', 'tasha') or jsonb_typeof(d.value) <> 'boolean' then
          raise exception 'PACT house rules: dmAllows must map bound/boons/drawbacks/tasha to true or false';
        end if;
      end loop;
    elsif k in ('boons', 'draws') then
      if jsonb_typeof(v) <> 'object' then raise exception 'PACT house rules: % must be an object', k; end if;
      for d in select key, value from jsonb_each(v) loop
        if not public.pact_hr_entry_ok(d.key, d.value, case when k = 'boons' then 'boon' else 'draw' end) then
          if k = 'boons' then
            raise exception 'PACT house rules: boon "%" needs a name, whole-number hd 1-20, whole-number ap 0-1000 and an optional short fx', left(d.key, 80);
          end if;
          raise exception 'PACT house rules: drawback "%" needs a name, whole-number ap 0-1000 and an optional short fx', left(d.key, 80);
        end if;
      end loop;
    elsif k = 'disabled' then
      if jsonb_typeof(v) <> 'object' then raise exception 'PACT house rules: disabled must be an object'; end if;
      for d in select key, value from jsonb_each(v) loop
        if d.key not in ('boons', 'draws') or jsonb_typeof(d.value) <> 'array' then
          raise exception 'PACT house rules: disabled must hold boons/draws lists of names';
        end if;
        for x in select value from jsonb_array_elements(d.value) loop
          if jsonb_typeof(x) <> 'string' or char_length(x #>> '{}') > 80 then
            raise exception 'PACT house rules: disabled must hold boons/draws lists of names';
          end if;
        end loop;
      end loop;
    elsif k = 'pins' then
      if jsonb_typeof(v) <> 'object' or exists (select 1 from jsonb_object_keys(v) as pk where pk <> 'draws') then
        raise exception 'PACT house rules: pins may hold draws only';
      end if;
      if v ? 'draws' then
        if jsonb_typeof(v -> 'draws') <> 'object' then raise exception 'PACT house rules: pins.draws must be an object'; end if;
        for d in select key, value from jsonb_each(v -> 'draws') loop
          if not public.pact_hr_entry_ok(d.key, d.value, 'pin') then
            raise exception 'PACT house rules: pinned drawback "%" needs whole-number ap 0-1000 and optional short reason/at', left(d.key, 80);
          end if;
        end loop;
      end if;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- pact_hr_resolve(log) — the part of js/engine.js activeEvents() the server needs, walked the same way in one forward pass:
-- which purchase each buyoff / dmRemoveBoon cancels (FIFO by name, oldest open first), and which purchase each DM-stamped
-- dmRefundBoon / dmRemoveDrawback / dmRepriceDrawback matched (by targetSeq + name, unique among the purchases BEFORE it;
-- a shared seq+name matches nothing; a non-finite amount matches nothing; a target no longer open matches nothing).
-- Like the engine it skips falsy log entries (filter(Boolean)) and purchases with no payload.v.
-- Returns {purchases:[{n, ord, cat, name, seq, cost, dmEdit, status, delta}], dmap, bmap, buyoffs}
--   n       1-based purchase number            ord     1-based position in the raw log
--   status  open | boughtOff | removed (dmRemoveDrawback) | refunded (dmRefundBoon) | dmRemoved (dmRemoveBoon)
--   delta   ΣΔ of the dmRepriceDrawback events matched to it
--   dmap / bmap  'seq|name' -> n, or -1 when two drawback (resp. boon) purchases share it (as of the END of the log)
--   buyoffs      'ord of a buyoff' -> n of the purchase it cancelled
--   matched      'ord of a DM-stamped refund / removal / reprice' -> n of the purchase it matched (js/engine.js dmMatched)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.pact_hr_resolve(p_log jsonb)
returns jsonb language plpgsql immutable set search_path = public, pg_temp as $$
declare
  ev jsonb; o bigint; t text; cat text; v text; k text; j int; q jsonb; amt jsonb;
  n int := 0;
  a_ord bigint[] := '{}'; a_cat text[] := '{}'; a_name text[] := '{}'; a_seq text[] := '{}';
  a_cost jsonb[] := '{}'; a_dm jsonb[] := '{}'; a_status text[] := '{}'; a_delta numeric[] := '{}';
  dq jsonb := '{}'; bq jsonb := '{}'; dmap jsonb := '{}'; bmap jsonb := '{}'; bo jsonb := '{}'; mt jsonb := '{}';
  out jsonb := '[]'; i int;
begin
  for ev, o in select e, x.ord from jsonb_array_elements(case when jsonb_typeof(p_log) = 'array' then p_log else '[]'::jsonb end) with ordinality as x(e, ord) loop
    if not public.pact_js_truthy(ev) or jsonb_typeof(ev) <> 'object' then continue; end if;
    t := ev ->> 'type';
    if t = 'buy' and (ev ->> 'cat') in ('drawback', 'boon') then
      cat := ev ->> 'cat';
      v := ev -> 'payload' ->> 'v';
      if v is null then continue; end if;
      n := n + 1;
      a_ord := a_ord || o; a_cat := a_cat || cat; a_name := a_name || v; a_seq := a_seq || public.pact_js_key(ev -> 'seq');
      a_cost := a_cost || coalesce(ev -> 'cost', 'null'::jsonb); a_dm := a_dm || coalesce(ev -> 'dmEdit', 'null'::jsonb);
      a_status := a_status || 'open'::text; a_delta := a_delta || 0::numeric;
      if cat = 'drawback' then
        dq := jsonb_set(dq, array[v], coalesce(dq -> v, '[]'::jsonb) || to_jsonb(n));
      else
        bq := jsonb_set(bq, array[v], coalesce(bq -> v, '[]'::jsonb) || to_jsonb(n));
      end if;
      if public.pact_js_key(ev -> 'seq') is not null then
        k := public.pact_js_key(ev -> 'seq') || '|' || v;
        if cat = 'drawback' then
          dmap := dmap || jsonb_build_object(k, case when dmap ? k then -1 else n end);
        else
          bmap := bmap || jsonb_build_object(k, case when bmap ? k then -1 else n end);
        end if;
      end if;
    elsif t in ('dmRemoveDrawback', 'dmRepriceDrawback', 'dmRefundBoon') then
      if ev -> 'dmEdit' is distinct from 'true'::jsonb or (ev ->> 'refVal') is null or public.pact_js_key(ev -> 'targetSeq') is null then continue; end if;
      amt := case t when 'dmRemoveDrawback' then ev -> 'grantBack' when 'dmRepriceDrawback' then ev -> 'amount' else ev -> 'cost' end;
      if amt is not null and jsonb_typeof(amt) <> 'null' and public.pact_js_number(amt) is null then continue; end if;
      if t <> 'dmRemoveDrawback' and public.pact_js_number(amt) is null then continue; end if;
      k := public.pact_js_key(ev -> 'targetSeq') || '|' || (ev ->> 'refVal');
      j := case when t = 'dmRefundBoon' then (bmap ->> k)::int else (dmap ->> k)::int end;
      if j is null or j < 0 or a_status[j] <> 'open' then continue; end if;
      mt := mt || jsonb_build_object(o::text, j);
      if t = 'dmRepriceDrawback' then
        a_delta[j] := a_delta[j] + public.pact_js_number(amt);
      elsif t = 'dmRemoveDrawback' then
        a_status[j] := 'removed';
        dq := jsonb_set(dq, array[ev ->> 'refVal'], coalesce((select jsonb_agg(y.x) from jsonb_array_elements(dq -> (ev ->> 'refVal')) as y(x) where y.x <> to_jsonb(j)), '[]'::jsonb));
      else
        a_status[j] := 'refunded';
        bq := jsonb_set(bq, array[ev ->> 'refVal'], coalesce((select jsonb_agg(y.x) from jsonb_array_elements(bq -> (ev ->> 'refVal')) as y(x) where y.x <> to_jsonb(j)), '[]'::jsonb));
      end if;
    elsif t = 'buyoff' then
      v := ev ->> 'refVal';
      if v is null then continue; end if;
      q := dq -> v;
      if q is not null and jsonb_array_length(q) > 0 then
        j := (q ->> 0)::int;
        dq := jsonb_set(dq, array[v], q - 0);
        a_status[j] := 'boughtOff';
        bo := bo || jsonb_build_object(o::text, j);
      end if;
    elsif t = 'dmRemoveBoon' then
      v := ev ->> 'refVal';
      if v is null then continue; end if;
      q := bq -> v;
      if q is not null and jsonb_array_length(q) > 0 then
        j := (q ->> 0)::int;
        bq := jsonb_set(bq, array[v], q - 0);
        a_status[j] := 'dmRemoved';
      end if;
    end if;
  end loop;
  for i in 1 .. n loop
    out := out || jsonb_build_array(jsonb_build_object('n', i, 'ord', a_ord[i], 'cat', a_cat[i], 'name', a_name[i], 'seq', a_seq[i],
      'cost', a_cost[i], 'dmEdit', a_dm[i], 'status', a_status[i], 'delta', a_delta[i]));
  end loop;
  return jsonb_build_object('purchases', out, 'dmap', dmap, 'bmap', bmap, 'buyoffs', bo, 'matched', mt);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- The ledger (plan §6.4, M1, M4). See the header for the sums.
-- pact_num(v): Number(v) || 0, as js/engine.js reads every frozen amount — a malformed string counts 0 instead of raising
-- (a raise here would block every save of that character, by anyone, until an admin repaired the row).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.pact_num(p jsonb)
returns numeric language sql immutable set search_path = public, pg_temp as $$
  select coalesce(public.pact_js_number(p), 0);
$$;

-- AB1 (owner, 2026-10-13): the server's own copy of the PRINTED drawback values, generated from js/engine-data.js.
-- testing/scripts/gen-drawback-prices-sql.mjs writes the block below; --check (sql-guards CI) fails if it drifts.
-- BEGIN GENERATED pact_drawback_printed — testing/scripts/gen-drawback-prices-sql.mjs; do not edit by hand
-- 109 printed drawbacks, js/engine-data.js rules v0.379. NULL = not a printed drawback.
create or replace function public.pact_drawback_printed(p_name text)
returns numeric language sql immutable set search_path = public, pg_temp as $$
  select (('{"Addled Memory":2,
    "Affliction — Clumsy (DEX)":2,
    "Affliction — Dim-Willed (WIS)":2,
    "Affliction — Dull-Witted (INT)":2,
    "Affliction — Feeble (STR)":2,
    "Affliction — Hollow (CHA)":2,
    "Affliction — Sickly (CON)":2,
    "Agoraphobic":2,
    "Always Hungry":1,
    "Asthmatic":2,
    "Bad Back":1,
    "Bad Knee":2,
    "Bad Liar":2,
    "Bad With Animals":1,
    "Berserk Temper":4,
    "Blunt":2,
    "Borrowed Time":6,
    "Brittle Bones":2,
    "Burned Eye":4,
    "Butterfingers":1,
    "Can''t Swim":2,
    "Claustrophobic":2,
    "Code of Honour":3,
    "Cold Heart":3,
    "Compulsion":3,
    "Conspicuous":2,
    "Cracked Ribs":2,
    "Crawling Things":1,
    "Crushed Leg":3,
    "Cursed Wealth":3,
    "Dependent":3,
    "Doppelganger":3,
    "Echo":2,
    "Faltering Resolve":3,
    "Fear of Being Alone":2,
    "Fear of the Dark":2,
    "Fear of the Dead":1,
    "Forgetful":1,
    "Frail":4,
    "Frightening Visage":3,
    "Frostbitten Limbs":2,
    "Geas of the Road":1,
    "Glass Frame":5,
    "Gun Shy":1,
    "Hard of Hearing":2,
    "Haunted / Phobia":2,
    "Heavy Sleeper":1,
    "Hexed Luck":8,
    "Honest to a Fault":3,
    "Hunted":4,
    "Illiterate":1,
    "Iron-Bane":4,
    "Lame":3,
    "Leaden Reflexes":6,
    "Light-Blind":6,
    "Lost Fingers":2,
    "Maimed Hand":2,
    "Mana Leak":2,
    "Mana-Sick":2,
    "Mangled Arm":4,
    "Marked":3,
    "Merciful":2,
    "Missing Arm":5,
    "Motion Sick":1,
    "Mute":5,
    "Nightmares":3,
    "No Head for Heights":2,
    "Not a Morning Person":1,
    "Notorious":3,
    "Oath of Poverty (permanent)":5,
    "Old Wound":3,
    "One-Eyed":4,
    "Outsider":2,
    "Overthinks Everything":1,
    "Peg Leg":4,
    "Prophesied Doom":4,
    "Quick to Quarrel":1,
    "Rattled Skull":2,
    "Reckless":3,
    "Resists Healing Magic":4,
    "Ritual-Blind":2,
    "Ruined Hearing":2,
    "Scarred Throat":2,
    "Scorched Lungs":2,
    "Sensory Overload":2,
    "Shattered Hand":2,
    "Shell-Shocked":2,
    "Slow Study":4,
    "Slow to Mend":5,
    "Slow-Footed":2,
    "Sluggish":1,
    "Snorer":1,
    "Soul Debt":5,
    "Squeamish":2,
    "Suggestible":2,
    "Superstitious":2,
    "Sweaty Palms":1,
    "Thin-Skinned":5,
    "Torn Shoulder":2,
    "Trembling Hands":2,
    "Truename Known":3,
    "Two Souls":5,
    "Unwary":2,
    "Vulnerable":6,
    "Weak-Willed":5,
    "Weather-Bringer":1,
    "Wild Surge":3,
    "Withered Arm":4,
    "Wrenched Back":2}'::jsonb) ->> p_name)::numeric;
$$;
-- END GENERATED pact_drawback_printed

-- pact_hr_drawback_effective(name, charHouseRules, override) — a drawback's CURRENT EFFECTIVE value for a campaign character,
-- exactly js/engine.js drawbackValue() in a campaign context: DM pin > DM override > campaign charHouseRules > printed, and 0
-- for a name none of them knows (a made-up or deleted custom drawback). A name that is an Object.prototype property reads as
-- 0 in the engine (the table lookup finds the prototype's function, whose .ap is undefined), so it is 0 here too.
create or replace function public.pact_hr_drawback_effective(p_name text, p_chr jsonb, p_ov jsonb)
returns numeric language plpgsql immutable set search_path = public, pg_temp as $$
declare
  x jsonb;
begin
  if p_name is null then return 0; end if;
  if p_name in ('__proto__', 'constructor', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString',
                'toString', 'valueOf', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__') then
    return 0;
  end if;
  if jsonb_typeof(p_ov) = 'object' then
    x := p_ov -> 'pins' -> 'draws' -> p_name;
    if jsonb_typeof(p_ov -> 'pins') = 'object' and jsonb_typeof(x) = 'object' and public.pact_js_number(x -> 'ap') is not null then
      return public.pact_js_number(x -> 'ap');
    end if;
    x := p_ov -> 'draws' -> p_name;
    if jsonb_typeof(x) = 'object' then return public.pact_num(x -> 'ap'); end if;
  end if;
  if jsonb_typeof(p_chr) = 'object' then
    x := p_chr -> 'draws' -> p_name;
    if jsonb_typeof(x) = 'object' then return public.pact_num(x -> 'ap'); end if;
  end if;
  return coalesce(public.pact_drawback_printed(p_name), 0);
end;
$$;

-- pact_ap_ledger_split(log, charHouseRules?, campaign?) — see the header for the sums. Drawbacks are summed PER PURCHASE
-- (AB1): a player drawback buy grants least(−cost + ΣΔ of its matched DM reprices, its effective value), and a NAME
-- grants once (F1, round-2 review): of two open player copies only the oldest earns. Never more than the drawback is worth for this character today, so a forged cost or a made-up name buys nothing; a DM-imposed one
-- (truthy dmEdit, cost >= 0) grants 0; a DM-removed one, or one a TARGETED buy-off cancelled (M4), grants 0; one an
-- untargeted buy-off cancelled keeps its grant (the old, accepted approximation). Without p_chr/p_campaign (the
-- pact_ap_ledger_spend wrapper) only printed values are known.
create or replace function public.pact_ap_ledger_split(p_log jsonb, p_chr jsonb default null, p_campaign uuid default null)
returns table(spent numeric, award_earned numeric, drawback_earned numeric)
language plpgsql stable set search_path = public, pg_temp as $$
declare
  ev jsonb;
  v_log jsonb := case when jsonb_typeof(p_log) = 'array' then p_log else '[]'::jsonb end;
  v_spent numeric := 0;
  v_award numeric := 0;
  v_draw numeric := 0;
  v_need boolean := false;
  r jsonb; b record; p jsonb;
  v_byord jsonb := '{}'; v_netted jsonb := '{}'; v_names jsonb := '{}'; v_ov jsonb; v_g numeric; v_o bigint;
begin
  for ev in select * from jsonb_array_elements(v_log) loop
    if (ev->>'type') = 'award' then
      v_award := v_award + public.pact_num(ev->'amount');
    elsif (ev->>'type') = 'buy' and coalesce(ev->>'cat','') = 'drawback' then
      v_need := true;
    elsif (ev->>'type') in ('buyoff','names') or ((ev->>'type') = 'buy' and coalesce(ev->>'cat','') <> 'patch') then
      v_spent := v_spent + public.pact_num(ev->'cost');
    elsif (ev->>'type') = 'dmRefundBoon' and ev->'dmEdit' = 'true'::jsonb then
      v_need := true;
    end if;
  end loop;
  if not v_need then
    spent := v_spent; award_earned := v_award; drawback_earned := 0;
    return next; return;
  end if;

  r := public.pact_hr_resolve(v_log);
  -- M1 + the PR #654 review: a DM refund counts only when it MATCHED its target (js/engine.js dmMatched). Reprices and
  -- removals act through the per-purchase grant below (delta / status), which pact_hr_resolve also builds from matches only.
  for b in select key::bigint as ord from jsonb_each(r -> 'matched') loop
    ev := v_log -> (b.ord::int - 1);
    if (ev->>'type') = 'dmRefundBoon' then v_spent := v_spent + public.pact_num(ev->'cost'); end if;
  end loop;
  for p in select value from jsonb_array_elements(r -> 'purchases') loop
    v_byord := v_byord || jsonb_build_object(p->>'ord', p);
  end loop;
  -- M4: a buyoff that names (targetSeq) the purchase js/engine.js's FIFO match cancels: that purchase grants nothing.
  for b in select key::bigint as ord, value::int as n from jsonb_each_text(r -> 'buyoffs') loop
    ev := v_log -> (b.ord::int - 1);
    p := r -> 'purchases' -> (b.n - 1);
    if public.pact_js_key(ev->'targetSeq') is not null and (p->>'seq') is not null and (p->>'seq') = public.pact_js_key(ev->'targetSeq') then
      v_netted := v_netted || jsonb_build_object(p->>'ord', true);
    end if;
  end loop;
  -- The character's DM override for its CURRENT campaign: the last DM-stamped dmHouseRules for that campaignId (js/engine.js
  -- _replay: dmEdit === true, campaignId a string, overrides a plain object).
  if p_campaign is not null then
    select e -> 'overrides' into v_ov
      from jsonb_array_elements(v_log) with ordinality as t(e, ord)
     where jsonb_typeof(e) = 'object' and e->>'type' = 'dmHouseRules' and e->'dmEdit' = 'true'::jsonb
       and jsonb_typeof(e->'campaignId') = 'string' and e->>'campaignId' = p_campaign::text
       and jsonb_typeof(e->'overrides') = 'object'
     order by ord desc limit 1;
  end if;
  for ev, v_o in select x.e, x.ord from jsonb_array_elements(v_log) with ordinality as x(e, ord) loop
    if jsonb_typeof(ev) <> 'object' or (ev->>'type') is distinct from 'buy' or coalesce(ev->>'cat','') <> 'drawback' then continue; end if;
    if public.pact_js_truthy(ev->'dmEdit') and public.pact_num(ev->'cost') >= 0 then continue; end if;   -- imposed: grants 0
    p := v_byord -> (v_o::text);
    if p is null then                                                   -- no payload.v: no name, worth 0
      v_g := least(-public.pact_num(ev->'cost'), 0);
    elsif p->>'status' = 'removed' or v_netted ? (v_o::text) then
      v_g := 0;
    elsif p->>'status' = 'open' and v_names ? (p->>'name') then
      v_g := 0;                                                         -- F1: a name grants once (its oldest open copy)
    else
      if p->>'status' = 'open' then v_names := v_names || jsonb_build_object(p->>'name', true); end if;
      v_g := least(-public.pact_num(ev->'cost') + (p->>'delta')::numeric,
                   public.pact_hr_drawback_effective(p->>'name', p_chr, v_ov));
    end if;
    v_draw := v_draw + v_g;
  end loop;

  spent := v_spent; award_earned := v_award; drawback_earned := v_draw;
  return next;
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
-- [HOUSE RULES] Redefined by sql/migrations/2026-10-13-campaign-house-rules-server.sql (APPLIED 2026-10-20); the statement below is that migration's, verbatim.
create or replace function public.pact_ap_ledger_spend(p_log jsonb)
returns table(spent numeric, player_earned numeric)
language plpgsql set search_path = public, pg_temp as $$
begin
  select s.spent, s.award_earned + s.drawback_earned into spent, player_earned
    from public.pact_ap_ledger_split(p_log) s;
  return next;
end;
$$;

-- Folded in from sql/migrations/2026-10-05-server-freeze-d2-e1-stage1.sql (applied to production 2026-10-10): the three helpers, then the ledger function that uses them.
-- The key lists live in two tiny functions so they are visible in the database itself (COMMENT ON FUNCTION) and a later migration changes one line.
create or replace function public.pact_patch_exempt_keys()
 returns text[] language sql immutable set search_path = public, pg_temp
as $function$ select array['appearance','houseRules','gold']::text[] $function$;
comment on function public.pact_patch_exempt_keys() is
  'PERMANENT: patch fields that carry no AP and stay editable after a lock/seal (appearance text, house-rule toggles, the legacy wallet field). Everything else in a buy/patch event is protected (fail-closed).';

create or replace function public.pact_patch_temp_exempt_keys()
 returns text[] language sql immutable set search_path = public, pg_temp
as $function$ select array[]::text[] $function$;
comment on function public.pact_patch_temp_exempt_keys() is
  'EMPTY since stage 2 (2026-10-11). Was the stage-1 TEMPORARY exemption (spellcasting, innate spells, martial binding, dabbler cantrips, origin classes, size, lineage, species); the creation tool no longer rewrites those after a lock. Kept as an empty list so the projection function is unchanged; a later cleanup may delete it.';

-- The protected projection of ONE buy/patch event: its type, cat, stamped cost, gp/days and the NON-exempt fields of payload.patch.
-- Returns NULL when the patch has no protected field (an appearance-only event stays unprotected). A non-object patch yields NULL too:
-- turning a protected event into one shrinks the protected list, which the trigger refuses.
create or replace function public.pact_patch_protected_projection(p_ev jsonb)
 returns jsonb language sql immutable set search_path = public, pg_temp
as $function$
  select case when s.n = 0 then null
              else jsonb_build_object('type', p_ev->'type', 'cat', p_ev->'cat', 'cost', p_ev->'cost',
                                      'gp', p_ev->'gp', 'days', p_ev->'days', 'patch', s.patch) end
  from (select count(*) as n, coalesce(jsonb_object_agg(kv.key, kv.value), '{}'::jsonb) as patch
          from jsonb_each(case when jsonb_typeof(p_ev->'payload'->'patch') = 'object' then p_ev->'payload'->'patch' else '{}'::jsonb end) as kv
         where kv.key <> all (public.pact_patch_exempt_keys() || public.pact_patch_temp_exempt_keys())) s;
$function$;
comment on function public.pact_patch_protected_projection(jsonb) is
  'E1: the part of a buy/patch event that is frozen once a character is locked, sealed or awarded. See sql/migrations/2026-10-05-server-freeze-d2-e1-stage1.sql.';

-- pact_ap_ledger_protected: patch events with a protected field join the protected list (E1).
-- [HOUSE RULES] Redefined by sql/migrations/2026-10-13-campaign-house-rules-server.sql (APPLIED 2026-10-20); the statement below is that migration's, verbatim.
create or replace function public.pact_ap_ledger_protected(p_log jsonb)
 returns jsonb
 language sql
 immutable
 set search_path = public, pg_temp
as $function$
  -- [HR] A purchase's and a buyoff's `seq` is protected too (PR #654 review): the DM's house-rules events and M4's
  -- buy-off netting name their target BY seq, so renumbering a frozen purchase would un-match a DM refund in the browser.
  -- No client rewrites the seq of an existing buy/buyoff (verified in both tools, 2026-10-13; dm-family-roundtrip-e2e).
  -- [DISCOUNT] 'dmDiscount' is protected as 2026-10-13-dm-ap-discount.sql (APPLIED) made it — kept here, or applying this
  -- file would silently un-freeze the discounts #649 froze.
  select coalesce(jsonb_agg(
           case when (ev->>'type') = 'buy' and coalesce(ev->>'cat','') = 'patch'
                then public.pact_patch_protected_projection(ev)
                when (ev->>'type') in ('buy', 'buyoff')
                then (ev - 'ts' - 'rules' - 'label')
                else (ev - 'seq' - 'ts' - 'rules' - 'label') end
           order by ord), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_log,'[]'::jsonb)) with ordinality as t(ev, ord)
  where (ev->>'type') in ('buyoff','names','award','sessionSeal','dmRemoveBoon','dmUnlockDrawback','dmDiscount',
                          'dmHouseRules','dmRefundBoon','dmRemoveDrawback','dmRepriceDrawback')
     or ((ev->>'type') = 'buy' and coalesce(ev->>'cat','') <> 'patch')
     or ((ev->>'type') = 'buy' and coalesce(ev->>'cat','') = 'patch' and public.pact_patch_protected_projection(ev) is not null);
$function$;

-- [HOUSE RULES] Redefined by sql/migrations/2026-10-13-campaign-house-rules-server.sql (APPLIED 2026-10-20); the statement below is that migration's, verbatim.
create or replace function public.pact_enforce_ap_budget_consistency()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign public.campaigns%rowtype;
  v_enforce boolean;
  v_old_spent numeric;
  v_new_spent numeric; v_new_award numeric; v_new_draw numeric;
  v_cap numeric;
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

  select spent, award_earned, drawback_earned into v_new_spent, v_new_award, v_new_draw
    from public.pact_ap_ledger_split(NEW.stats->'LOG', v_campaign.rules->'charHouseRules', NEW.campaign_id);
  select spent into v_old_spent
    from public.pact_ap_ledger_split(OLD.stats->'LOG', v_campaign.rules->'charHouseRules', NEW.campaign_id);

  -- X1: a drawback's grant counts whether or not the campaign ignores player AP (only AWARDS are the player's to ignore).
  -- Z1: capped at the DM's drawback cap when they set one (js/campaign.js drawbackCapFromRules), uncapped otherwise.
  v_cap := public.pact_hr_drawback_cap(v_campaign.rules);
  -- feat/dm-ap-discount (2026-10-13-dm-ap-discount.sql, APPLIED — kept here, or applying this file would silently undo it):
  -- a DM discount is DM-given AP, so it counts whether or not the campaign ignores player AP (js/engine.js keeps it outside
  -- the same bracket). pact_ap_ledger_discount() is redefined above to leave out a refunded boon's discount.
  v_spendable := NEW.ap + public.pact_ap_ledger_discount(NEW.stats->'LOG')
               + (case when v_campaign.ignore_player_ap then 0 else v_new_award end)
               + (case when v_cap is null then v_new_draw else least(v_cap, v_new_draw) end);

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

-- feat/dm-ap-discount (D-GH-2026-10-13-dm-ap-discount) ---------------------------------------------------------
-- pact_ap_ledger_discount: the AP a log's DM discounts hand back, for the budget check above. A plain sum: the
-- per-purchase range (0 to the purchase's cost) is enforced when each discount is written by
-- dm_edit_character_log, and only a DM can add, change or remove one (the trigger below). It does NOT check that
-- the discounted purchase is still owned — js/engine.js decides that; owner decision I1 accepts the gap.
-- [HOUSE RULES] Redefined by sql/migrations/2026-10-13-campaign-house-rules-server.sql (APPLIED 2026-10-20); the statement below is that migration's, verbatim.
-- No longer quite a plain sum: a discount aimed (targetSeq) at a boon a MATCHED dmRefundBoon refunded stops counting, so the
-- refund does not hand the discounted AP back twice (js/engine.js activeEvents() drops it the same way).
create or replace function public.pact_ap_ledger_discount(p_log jsonb)
 returns numeric
 language plpgsql
 stable
 set search_path = public, pg_temp
as $function$
declare
  v_log jsonb := case when jsonb_typeof(p_log) = 'array' then p_log else '[]'::jsonb end;
  v_refunded jsonb := '{}'::jsonb;
  v_sum numeric;
  r jsonb; b record; ev jsonb;
begin
  if exists (select 1 from jsonb_array_elements(v_log) as t(e)
              where jsonb_typeof(e) = 'object' and e->>'type' = 'dmRefundBoon' and e->'dmEdit' = 'true'::jsonb) then
    r := public.pact_hr_resolve(v_log);
    for b in select key::bigint as ord from jsonb_each(r -> 'matched') loop
      ev := v_log -> (b.ord::int - 1);
      if (ev->>'type') = 'dmRefundBoon' and public.pact_js_key(ev->'targetSeq') is not null then
        v_refunded := v_refunded || jsonb_build_object(public.pact_js_key(ev->'targetSeq'), true);
      end if;
    end loop;
  end if;
  select coalesce(sum((e->>'amount')::numeric), 0) into v_sum
    from jsonb_array_elements(v_log) as t(e)
   where jsonb_typeof(e) = 'object' and e->>'type' = 'dmDiscount' and jsonb_typeof(e->'amount') = 'number'
     and not (v_refunded ? coalesce(public.pact_js_key(e->'targetSeq'), ''));
  return v_sum;
end;
$function$;

-- pact_enforce_dm_discount_authorship: a DM discount is AP, and a character's owner can write their own log,
-- so without this a player could forge one. Unlike every other check here it identifies the DM by WHO is
-- writing (is_campaign_dm), never by a flag in the event, which the writer controls.
--   * UPDATE: the log's dmDiscount events (compared as a set) may change only when the writer is a DM of the
--     character's campaign and the campaign is not changing in the same write.
--   * A discount may not ARRIVE in a campaign from outside: inserting a campaign character whose log already
--     holds one, or binding a character that holds one to a campaign, is refused.
-- Admin sessions (no JWT) are not exempt, like pact_enforce_player_ap_ceiling.
create or replace function public.pact_enforce_dm_discount_authorship()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old jsonb := '[]'::jsonb;
  v_new jsonb;
begin
  select coalesce(jsonb_agg(e order by e::text), '[]'::jsonb) into v_new
    from jsonb_array_elements(case when jsonb_typeof(NEW.stats->'LOG') = 'array' then NEW.stats->'LOG' else '[]'::jsonb end) as t(e)
   where e->>'type' = 'dmDiscount';
  if TG_OP = 'INSERT' then
    if NEW.campaign_id is not null and v_new <> '[]'::jsonb then
      raise exception 'PACT: a character cannot join a campaign carrying AP discounts from elsewhere';
    end if;
    return NEW;
  end if;
  select coalesce(jsonb_agg(e order by e::text), '[]'::jsonb) into v_old
    from jsonb_array_elements(case when jsonb_typeof(OLD.stats->'LOG') = 'array' then OLD.stats->'LOG' else '[]'::jsonb end) as t(e)
   where e->>'type' = 'dmDiscount';
  if NEW.campaign_id is not null and NEW.campaign_id is distinct from OLD.campaign_id and v_new <> '[]'::jsonb then
    raise exception 'PACT: a character cannot join a campaign carrying AP discounts from elsewhere';
  end if;
  if v_new is not distinct from v_old then
    return NEW;
  end if;
  if OLD.campaign_id is not null and NEW.campaign_id is not distinct from OLD.campaign_id
     and public.is_campaign_dm(OLD.campaign_id) then
    return NEW;
  end if;
  raise exception 'PACT: only the campaign''s DM can add, change or remove an AP discount';
end;
$$;

drop trigger if exists trg_pact_dm_discount_authorship on public.characters;
create trigger trg_pact_dm_discount_authorship
  before insert or update on public.characters
  for each row execute function public.pact_enforce_dm_discount_authorship();

-- Folded in from the same migration (adds the D2 lock boundary).
-- [HOUSE RULES] Redefined by sql/migrations/2026-10-13-campaign-house-rules-server.sql (APPLIED 2026-10-20); the statement below is that migration's, verbatim.
create or replace function public.pact_enforce_locked_history()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
declare
  v_old_log jsonb; v_award_idx int; v_seal_idx int; v_lock_idx int; v_last_lock int; v_last_unlock int; v_idx int;
  v_dm_idx int;
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

    -- D2 (owner, 2026-10-04): for a campaign character that is CURRENTLY locked, nothing before the lock may change. "Currently locked" =
    -- the last creationLocked is after the last creationUnlocked, so a DM reopening creation (dm_reopen_creation appends a creationUnlocked)
    -- lifts this boundary; the seal/award boundary above is untouched by a reopen. Solo characters are not covered (no DM; the owner decides).
    select max(ord) into v_last_lock
    from jsonb_array_elements(v_old_log) with ordinality as t(ev, ord)
    where (ev->>'type') = 'creationLocked';
    select max(ord) into v_last_unlock
    from jsonb_array_elements(v_old_log) with ordinality as t(ev, ord)
    where (ev->>'type') = 'creationUnlocked';
    if v_last_lock is not null and coalesce(v_last_unlock, 0) < v_last_lock then
      v_lock_idx := v_last_lock;
    end if;

    -- [HR] campaign house rules (D-GH-2026-10-13-campaign-house-rules, plan §6.5): a DM's AP-moving house-rules event (a
    -- refund, a drawback removal or a reprice) freezes everything before it, like an award — the client's undo barrier,
    -- server-side. It stays a boundary if creation is reopened: re-costing a purchase under it would pay the refund twice.
    select max(ord) into v_dm_idx
    from jsonb_array_elements(v_old_log) with ordinality as t(ev, ord)
    where (ev->>'type') in ('dmRefundBoon', 'dmRemoveDrawback', 'dmRepriceDrawback')
      and ev->'dmEdit' = 'true'::jsonb;
  end if;

  v_idx := greatest(coalesce(v_seal_idx, 0), coalesce(v_award_idx, 0), coalesce(v_lock_idx, 0), coalesce(v_dm_idx, 0));
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
$function$;

drop trigger if exists trg_pact_locked_history on public.characters;
create trigger trg_pact_locked_history
  before update on public.characters
  for each row execute function public.pact_enforce_locked_history();

-- feat/boon-drawback-notes (D-GH-2026-10-15-boon-drawback-notes) --------------------------------------------------
-- Applied to production 2026-10-19 as sql/migrations/2026-10-15-boon-drawback-notes.sql; the text below is that
-- migration's, verbatim (its header has the full design). dm_edit_character_log() above carries its [NOTES] hunks.
-- pact_item_note_state() reads one boon/drawback description's state from a log exactly as js/ui-helpers.js
-- pactNoteStates() does; trg_pact_item_note_lock lets only the campaign's DM write dmApproveNote/dmUnlockNote and
-- freezes a player's itemNote once the DM has approved it (a solo character's notes are never locked, owner AW1).
-- pact_js_trim: String.prototype.trim() exactly — strips the same whitespace set from both ends (ASCII tab/LF/VT/FF/CR/space,
-- NBSP, U+1680, U+2000–U+200A, U+2028/2029, U+202F, U+205F, U+3000, U+FEFF) and nothing else, so "blank" means the same on
-- the server as in js/ui-helpers.js pactCheckNoteText()/pactNoteStates() (#673 re-review 5). btrim() only strips spaces, and
-- [[:space:]] is locale-dependent (it can include U+0085, which JS keeps).
create or replace function public.pact_js_trim(p text)
 returns text
 language sql
 immutable
 set search_path = public, pg_temp
as $function$
  select regexp_replace(p, '^[' || w || ']+|[' || w || ']+$', '', 'g')
    from (select chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) || chr(160) || chr(5760)
                 || chr(8192) || '-' || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279) as w) s;
$function$;

create or replace function public.pact_item_note_state(p_log jsonb, p_cat text, p_name text, p_campaign text,
                                                       out status text, out note text)
 language plpgsql
 immutable
 set search_path = public, pg_temp
as $function$
declare
  e jsonb;
begin
  status := 'none'; note := '';
  for e in
    select ev from jsonb_array_elements(case when jsonb_typeof(p_log) = 'array' then p_log else '[]'::jsonb end)
                   with ordinality as t(ev, ord)
     where ev->>'type' in ('itemNote', 'dmApproveNote', 'dmUnlockNote') and ev->>'cat' = p_cat and ev->>'refVal' = p_name
     order by ord
  loop
    if e->>'type' = 'itemNote' then
      if jsonb_typeof(e->'text') = 'string' then
        note := e->>'text';
        status := case when public.pact_js_trim(note) = '' then 'none' else 'pending' end;
      end if;
    elsif e->'dmEdit' = 'true'::jsonb and p_campaign is not null and e->>'campaignId' = p_campaign then
      -- only an approval OF THIS TEXT counts (#673 review A): a note rewritten in place after approval stays pending
      if e->>'type' = 'dmApproveNote' and status <> 'none' and jsonb_typeof(e->'text') = 'string' and e->>'text' = note then
        status := 'approved';
      elsif e->>'type' = 'dmUnlockNote' and status = 'approved' then
        status := 'pending';
      end if;
    end if;
  end loop;
end;
$function$;

-- pact_enforce_item_note_lock: see the header, item 3.
create or replace function public.pact_enforce_item_note_lock()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old_log jsonb := '[]'::jsonb;
  v_new_log jsonb;
  v_old_fam jsonb;
  v_new_fam jsonb;
  v_dm      boolean := false;
  k         record;
begin
  if coalesce(current_setting('request.jwt.claims', true), '') = '' then return NEW; end if;   -- admin session
  if TG_OP = 'UPDATE' then
    if NEW.stats is not distinct from OLD.stats and NEW.campaign_id is not distinct from OLD.campaign_id then return NEW; end if;
    v_old_log := case when jsonb_typeof(OLD.stats->'LOG') = 'array' then OLD.stats->'LOG' else '[]'::jsonb end;
  end if;
  v_new_log := case when jsonb_typeof(NEW.stats->'LOG') = 'array' then NEW.stats->'LOG' else '[]'::jsonb end;

  -- A NEW description (one not already stored, compared whole) must be 1 to 500 characters after trimming.
  if exists (select 1 from jsonb_array_elements(v_new_log) as t(e)
              where e->>'type' = 'itemNote'
                and (coalesce(jsonb_typeof(e->'text'), '') <> 'string' or char_length(public.pact_js_trim(e->>'text')) not between 1 and 500)
                and not exists (select 1 from jsonb_array_elements(v_old_log) as o(x) where x = e)) then
    raise exception 'PACT: a boon or drawback description must be 1 to 500 characters'
      using hint = 'Shorten the description and save again.';
  end if;

  -- INSERT into a campaign by anyone but its DM: approvals made in that campaign are DROPPED from the new row, not
  -- refused (#673 review C). The honest case is redeem_character_claim() copying a DM's pregen whose descriptions that
  -- DM approved; refusing broke it. Dropping is the safer of the two fixes: no approval stamped with THIS campaign
  -- survives a player's insert into it (a hand-crafted one is removed the same way), the copy's notes simply wait for the
  -- DM's approval again, and redeem_character_claim() is not redefined. Approvals stamped with another campaign are kept
  -- but never count here; a SOLO insert is not filtered (nothing counts on a solo character), and the move-into-a-campaign
  -- branch below drops them on the way in.
  if TG_OP = 'INSERT' then
    if NEW.campaign_id is not null and not public.is_campaign_dm(NEW.campaign_id)
       and exists (select 1 from jsonb_array_elements(v_new_log) as t(e)
                    where e->>'type' in ('dmApproveNote', 'dmUnlockNote') and e->>'campaignId' = NEW.campaign_id::text) then
      NEW.stats := jsonb_set(NEW.stats, '{LOG}',
        (select coalesce(jsonb_agg(e order by ord), '[]'::jsonb) from jsonb_array_elements(v_new_log) with ordinality as t(e, ord)
          where not (e->>'type' in ('dmApproveNote', 'dmUnlockNote') and e->>'campaignId' = NEW.campaign_id::text)));
    end if;
    return NEW;
  end if;

  -- Moving INTO a campaign (campaign_id changes to X) when the writer is not X's DM — bind_character_to_campaign(), a
  -- campaign move — drops the approvals stamped with X, exactly as an INSERT does (#673 re-review 4). That closes the
  -- "forge approvals on a solo character, then join" path: whatever arrives, no approval made "in X" survives the join, so
  -- every approval that counts in a campaign was written there by its DM through dm_edit_character_log. The comparison
  -- below then treats the dropped events as never having been there; any OTHER change to approvals is still refused.
  if NEW.campaign_id is not null and NEW.campaign_id is distinct from OLD.campaign_id
     and not public.is_campaign_dm(NEW.campaign_id)
     and exists (select 1 from jsonb_array_elements(v_new_log) as t(e)
                  where e->>'type' in ('dmApproveNote', 'dmUnlockNote') and e->>'campaignId' = NEW.campaign_id::text) then
    v_new_log := (select coalesce(jsonb_agg(e order by ord), '[]'::jsonb) from jsonb_array_elements(v_new_log) with ordinality as t(e, ord)
                   where not (e->>'type' in ('dmApproveNote', 'dmUnlockNote') and e->>'campaignId' = NEW.campaign_id::text));
    NEW.stats := jsonb_set(NEW.stats, '{LOG}', v_new_log);
    v_old_log := (select coalesce(jsonb_agg(e order by ord), '[]'::jsonb) from jsonb_array_elements(v_old_log) with ordinality as t(e, ord)
                   where not (e->>'type' in ('dmApproveNote', 'dmUnlockNote') and e->>'campaignId' = NEW.campaign_id::text));
  end if;

  v_dm := OLD.campaign_id is not null and NEW.campaign_id is not distinct from OLD.campaign_id
          and public.is_campaign_dm(OLD.campaign_id);

  select coalesce(jsonb_agg(e order by ord), '[]'::jsonb) into v_old_fam
    from jsonb_array_elements(v_old_log) with ordinality as t(e, ord) where e->>'type' in ('dmApproveNote', 'dmUnlockNote');
  select coalesce(jsonb_agg(e order by ord), '[]'::jsonb) into v_new_fam
    from jsonb_array_elements(v_new_log) with ordinality as t(e, ord) where e->>'type' in ('dmApproveNote', 'dmUnlockNote');
  if v_new_fam is distinct from v_old_fam and not v_dm then
    raise exception 'PACT: only the campaign''s DM can approve or unlock a boon or drawback description';
  end if;

  if OLD.campaign_id is null or v_dm then return NEW; end if;

  -- The lock: every description approved in this campaign keeps exactly its stored itemNote events.
  for k in
    select distinct e->>'cat' as c, e->>'refVal' as n
      from jsonb_array_elements(v_old_log) as t(e)
     where e->>'type' = 'dmApproveNote' and e->>'campaignId' = OLD.campaign_id::text
  loop
    if (select s.status from public.pact_item_note_state(v_old_log, k.c, k.n, OLD.campaign_id::text) as s) = 'approved'
       and (select coalesce(jsonb_agg(e order by ord), '[]'::jsonb) from jsonb_array_elements(v_old_log) with ordinality as t(e, ord)
             where e->>'type' = 'itemNote' and e->>'cat' = k.c and e->>'refVal' = k.n)
           is distinct from
           (select coalesce(jsonb_agg(e order by ord), '[]'::jsonb) from jsonb_array_elements(v_new_log) with ordinality as t(e, ord)
             where e->>'type' = 'itemNote' and e->>'cat' = k.c and e->>'refVal' = k.n) then
      raise exception 'PACT: your DM approved the description of % — it can''t be changed until they unlock it', k.n
        using hint = 'Ask your DM to unlock it in DM Console, or reload the character if it was approved after you opened it.';
    end if;
  end loop;
  return NEW;
end;
$$;

drop trigger if exists trg_pact_item_note_lock on public.characters;
create trigger trg_pact_item_note_lock
  before insert or update on public.characters
  for each row execute function public.pact_enforce_item_note_lock();

revoke execute on function public.pact_item_note_state(jsonb, text, text, text) from public, anon, authenticated;
revoke execute on function public.pact_js_trim(text)                            from public, anon, authenticated;
revoke execute on function public.pact_enforce_item_note_lock()                 from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Player AP: a DM can zero it, and it cannot rise behind the DM's back (feat/dm-zero-player-ap, D-GH-2026-09-03-dm-zero-player-ap;
-- fix/server-player-award-after-lock, D-GH-2026-10-12-server-player-award-after-lock). Applied to production as
-- sql/migrations/2026-09-03-dm-zero-player-ap.sql and then 2026-10-12-server-player-award-after-lock.sql (2026-10-13), which
-- REDEFINED pact_enforce_player_ap_ceiling() and revoked its EXECUTE; folded here 2026-10-20. dm_zero_player_ap() is the
-- 2026-09-03 text verbatim; pact_enforce_player_ap_ceiling(), its trigger, revoke and comment are the 2026-10-12 text verbatim
-- (both headers carry the full reasoning). A campaign character's LOG award total may not rise, except by a DM of its
-- campaign, when the campaign ignores player AP or the character is creation-locked or sealed.
-- ---------------------------------------------------------------------------
create or replace function public.dm_zero_player_ap(p_character uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign  uuid;
  v_stats     jsonb;
  v_log       jsonb;
  v_seq       integer;
  v_event     jsonb;
  v_ts        bigint := (extract(epoch from now()) * 1000)::bigint;
  v_player_ap numeric;
begin
  select campaign_id, stats into v_campaign, v_stats from characters where id = p_character for update;
  if not found then
    raise exception 'Character not found';
  end if;
  if v_campaign is null then
    raise exception 'Character is not in a campaign';
  end if;
  if not is_campaign_dm(v_campaign) then
    raise exception 'Only a campaign DM can zero player AP';
  end if;
  perform assert_campaign_active(v_campaign);
  if v_stats is null or not (v_stats ? 'LOG') then
    raise exception 'Character has no log';
  end if;

  v_log := coalesce(v_stats->'LOG', '[]'::jsonb);
  v_seq := coalesce((v_stats->>'SEQ')::integer, jsonb_array_length(v_log) + 1);

  -- Sum every existing NON-DM-ATTRIBUTED 'award' event's amount — Player AP specifically, matching
  -- exactly what pact_enforce_player_ap_ceiling (below) protects. Found in review (/code-review ultra):
  -- an earlier version of this summed ALL award events, dmEdit:true included, so zeroing a character
  -- with a DM-granted boon (dm_edit_character_log's matched buy/award pair, the award side stamped
  -- dmEdit:true) would cancel that award too while leaving its paired buy cost in place — silently
  -- charging the character for a boon that was supposed to be free, with nothing catching the drop
  -- (pact_enforce_ap_budget_consistency only blocks spend RISING past what's spendable, not earned
  -- falling). Excluding dmEdit:true here means this RPC only ever touches the pool it claims to.
  select coalesce(sum((e->>'amount')::numeric), 0) into v_player_ap
    from jsonb_array_elements(v_log) e
   where e->>'type' = 'award' and not coalesce((e->>'dmEdit')::boolean, false);

  if v_player_ap = 0 then
    raise exception 'Player AP is already 0';
  end if;

  v_event := jsonb_build_object(
    'seq', v_seq,
    'ts', v_ts,
    'type', 'award',
    'amount', -v_player_ap,
    'note', 'Zeroed by DM',
    'dmEdit', true,
    'dmId', auth.uid(),
    'label', 'Player AP zeroed by DM (was ' || v_player_ap || ' AP)'
  );

  update characters
     set stats = jsonb_set(jsonb_set(v_stats, '{LOG}', v_log || v_event),
                           '{SEQ}', to_jsonb(v_seq + 1))
   where id = p_character;

  return v_event;
end;
$$;

revoke all on function public.dm_zero_player_ap(uuid) from public, anon;
grant execute on function public.dm_zero_player_ap(uuid) to authenticated;

comment on function public.dm_zero_player_ap(uuid) is
  'DM-only: append a compensating award (dmEdit:true) that brings a campaign character''s own award-event sum (Player AP) to exactly 0. Append-only — never rewrites or removes the prior award events.';

create or replace function public.pact_enforce_player_ap_ceiling()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign    public.campaigns%rowtype;
  v_old_log     jsonb;
  v_last_lock   int;
  v_last_unlock int;
  v_sealed      boolean;
  v_locked      boolean;
  v_old_award   numeric;
  v_new_award   numeric;
begin
  if NEW.campaign_id is null then
    return NEW;
  end if;
  if NEW.stats is not distinct from OLD.stats then
    return NEW;
  end if;

  select * into v_campaign from public.campaigns where id = NEW.campaign_id;
  if not found then
    return NEW;  -- fail open, matching pact_enforce_ap_budget_consistency's own dangling-campaign case
  end if;

  -- Every award amount must be a JSON number. A string such as "NaN", "Infinity" or "500" casts to numeric, and a NaN
  -- makes every sum NaN, so the budget check and this ceiling both stop comparing anything. Checked for every writer and
  -- whether or not the character is locked: a value planted before the lock would otherwise disarm both checks after it.
  if exists (select 1 from jsonb_array_elements(coalesce(NEW.stats->'LOG', '[]'::jsonb)) e
              where e->>'type' = 'award' and jsonb_typeof(e->'amount') <> 'number') then
    raise exception 'PACT: an AP award amount must be a number';
  end if;

  -- A DM of this campaign is the one person allowed to give AP through the log (boon grants, zeroing).
  if public.is_campaign_dm(NEW.campaign_id) then
    return NEW;
  end if;

  v_old_log := coalesce(OLD.stats->'LOG', '[]'::jsonb);
  select max(ord) filter (where ev->>'type' = 'creationLocked'),
         max(ord) filter (where ev->>'type' = 'creationUnlocked'),
         coalesce(bool_or(ev->>'type' = 'sessionSeal'), false)
    into v_last_lock, v_last_unlock, v_sealed
    from jsonb_array_elements(v_old_log) with ordinality as t(ev, ord);
  v_locked := v_sealed or (v_last_lock is not null and coalesce(v_last_unlock, 0) < v_last_lock);

  if not v_campaign.ignore_player_ap and not v_locked then
    return NEW;
  end if;

  select coalesce(sum(coalesce((e->>'amount')::numeric, 0)), 0) into v_old_award
    from jsonb_array_elements(v_old_log) e
   where e->>'type' = 'award';
  select coalesce(sum(coalesce((e->>'amount')::numeric, 0)), 0) into v_new_award
    from jsonb_array_elements(coalesce(NEW.stats->'LOG', '[]'::jsonb)) e
   where e->>'type' = 'award';

  if v_new_award > v_old_award then
    if v_campaign.ignore_player_ap then
      raise exception
        'PACT: this campaign''s DM has switched off player-entered AP — it can no longer be increased (ask your DM to raise it instead)';
    end if;
    raise exception
      'PACT: this character''s creation is finished — its AP comes from your DM now (ask them to award it in the DM Console)';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_pact_player_ap_ceiling on public.characters;
create trigger trg_pact_player_ap_ceiling
  before update on public.characters
  for each row execute function public.pact_enforce_player_ap_ceiling();

-- A trigger function never needs EXECUTE (2026-09-01-revoke-trigger-function-execute.sql); the 2026-09-03
-- migration granted it to authenticated. Revoking does not stop the trigger firing.
revoke execute on function public.pact_enforce_player_ap_ceiling() from public, anon, authenticated;

comment on function public.pact_enforce_player_ap_ceiling() is
  'Refuses a rise in a campaign character''s LOG award total by anyone but a DM of its campaign, when the campaign ignores player AP or the character is creation-locked or sealed. D-GH-2026-10-12-server-player-award-after-lock.';

-- =====================================================================================================================
-- feat/campaign-house-rules (D-GH-2026-10-13-campaign-house-rules) — part 2 of 2: the DM-family guard, the player-grants
-- guard, the campaigns.rules.charHouseRules guard, dm_apply_house_rules_change() and the grants. Applied to production
-- 2026-10-20 as sql/migrations/2026-10-13-campaign-house-rules-server.sql; the text below is that migration's, verbatim
-- (dm_edit_character_log, which it also redefines, is replaced in place above).
-- =====================================================================================================================
-- ---------------------------------------------------------------------------------------------------------------------
-- M1: the DM-family forgery guard (plan §6.5, addendum M1).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.pact_dm_family(p_log jsonb)
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(ev order by ord), '[]'::jsonb)
    from jsonb_array_elements(case when jsonb_typeof(p_log) = 'array' then p_log else '[]'::jsonb end) with ordinality as t(ev, ord)
   where jsonb_typeof(ev) = 'object'
     and (public.pact_js_truthy(ev->'dmEdit')
          or (ev->>'type') in ('dmHouseRules', 'dmRefundBoon', 'dmRemoveDrawback', 'dmRepriceDrawback',
                               'dmRemoveBoon', 'dmUnlockDrawback', 'sessionSeal',
                               -- the boon/drawback-notes DM events (2026-10-15-boon-drawback-notes.sql, live since 2026-10-19)
                               'dmApproveNote', 'dmUnlockNote'));
$$;

create or replace function public.pact_enforce_dm_family()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old jsonb; v_new jsonb; v_draft boolean; v_ok boolean; i int; v_o jsonb; v_n jsonb;
begin
  if NEW.stats is not distinct from OLD.stats then return NEW; end if;
  if OLD.campaign_id is null and NEW.campaign_id is null then return NEW; end if;            -- solo (residual risk: header)
  if coalesce(current_setting('request.jwt.claims', true), '') = '' then return NEW; end if;  -- admin session
  if (OLD.campaign_id is not null and public.is_campaign_dm(OLD.campaign_id))
     or (NEW.campaign_id is not null and public.is_campaign_dm(NEW.campaign_id)) then
    return NEW;
  end if;
  v_old := public.pact_dm_family(OLD.stats->'LOG');
  v_new := public.pact_dm_family(NEW.stats->'LOG');
  if v_old is not distinct from v_new then return NEW; end if;
  -- One relaxation (PR #654 review): while the character is still a creation DRAFT (no creationLocked after its last
  -- creationUnlocked), the engine on `main` before rules v0.377 re-prices a DM-granted boon's cost to today's price on every
  -- CharGen save. Accept that re-pricing only when it does NOT lower the cost — a higher cost is more spend, never AP for
  -- the player — and nothing else about the event changes.
  v_draft := coalesce((select max(ord) from jsonb_array_elements(coalesce(OLD.stats->'LOG', '[]'::jsonb)) with ordinality as t(e, ord)
                        where e->>'type' = 'creationLocked'), 0)
          <= coalesce((select max(ord) from jsonb_array_elements(coalesce(OLD.stats->'LOG', '[]'::jsonb)) with ordinality as t(e, ord)
                        where e->>'type' = 'creationUnlocked'), 0);
  if v_draft and jsonb_array_length(v_old) = jsonb_array_length(v_new) then
    v_ok := true;
    for i in 0 .. jsonb_array_length(v_old) - 1 loop
      v_o := v_old -> i; v_n := v_new -> i;
      if v_o is not distinct from v_n then continue; end if;
      if not (v_o->>'type' = 'buy' and v_o->>'cat' = 'boon' and (v_o - 'cost') = (v_n - 'cost')
              and jsonb_typeof(v_n->'cost') = 'number' and public.pact_num(v_n->'cost') >= public.pact_num(v_o->'cost')) then
        v_ok := false;
        exit;
      end if;
    end loop;
    if v_ok then return NEW; end if;
  end if;
  raise exception 'PACT: only your DM can add, change or remove a DM entry in this character''s history'
    using hint = 'Reload the character — your DM has changed it since this copy was loaded.';
end;
$$;

drop trigger if exists trg_pact_dm_family_guard on public.characters;
create trigger trg_pact_dm_family_guard
  before update on public.characters
  for each row execute function public.pact_enforce_dm_family();

-- ---------------------------------------------------------------------------------------------------------------------
-- Player drawback grants and buy-offs (PR #654 round-2 review, F1 + R2-5). For a campaign character written by someone who
-- is neither a DM of its campaign nor an admin session, a NEW event (one not already in the stored row — events compared
-- without ts/rules/label, which tools re-stamp; existing ones are grandfathered) is refused when it is:
--   * a player drawback buy (no truthy dmEdit) on a creation-LOCKED character (last creationLocked after the last
--     creationUnlocked) whose campaign has not switched rules.postLockDrawbacks on — js/engine.js postLockAllowance(), which
--     the Live Sheet's _lsBarGrant() already applies. (Bindings stay the client's: not part of this review item.)
--   * a buyoff without targetSeq (M4: the server must know which purchase it cancels; the Live Sheet stamps it since PR2);
--   * a targeted buyoff that cancels nothing, or whose cost is below the buy-off price: rate × the purchase's effective value
--     (drawbackBuyoffQuote, W1) — rate 3 for a drawback the player took, and for a DM-imposed one the DM's own rate
--     (dmRemovalCost 'expensive' = 3, else 1), all of which the stored purchase carries.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.pact_enforce_player_grants()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old jsonb; v_new jsonb; v_rules jsonb; v_locked boolean;
  v_used int[] := '{}'; v_ev jsonb; v_ord bigint; v_found boolean; j int; v_cand jsonb;
  v_r jsonb := null; v_n int; v_p jsonb; v_ov jsonb; v_rate numeric; v_need numeric;
begin
  if NEW.stats is not distinct from OLD.stats then return NEW; end if;
  if NEW.campaign_id is null then return NEW; end if;
  if coalesce(current_setting('request.jwt.claims', true), '') = '' then return NEW; end if;  -- admin session
  if (OLD.campaign_id is not null and public.is_campaign_dm(OLD.campaign_id)) or public.is_campaign_dm(NEW.campaign_id) then
    return NEW;
  end if;
  v_old := case when jsonb_typeof(OLD.stats->'LOG') = 'array' then OLD.stats->'LOG' else '[]'::jsonb end;
  v_new := case when jsonb_typeof(NEW.stats->'LOG') = 'array' then NEW.stats->'LOG' else '[]'::jsonb end;
  select rules into v_rules from public.campaigns where id = NEW.campaign_id;
  v_locked := coalesce((select max(ord) from jsonb_array_elements(v_old) with ordinality as t(e, ord) where e->>'type' = 'creationLocked'), 0)
            > coalesce((select max(ord) from jsonb_array_elements(v_old) with ordinality as t(e, ord) where e->>'type' = 'creationUnlocked'), 0);
  for v_ev, v_ord in select x.e, x.ord from jsonb_array_elements(v_new) with ordinality as x(e, ord) loop
    if jsonb_typeof(v_ev) <> 'object' then continue; end if;
    if not ((v_ev->>'type' = 'buy' and v_ev->>'cat' = 'drawback' and not public.pact_js_truthy(v_ev->'dmEdit'))
            or v_ev->>'type' = 'buyoff') then continue; end if;
    -- already stored? (multiset match, ignoring what tools re-stamp)
    v_found := false;
    for j in 0 .. jsonb_array_length(v_old) - 1 loop
      if j = any(v_used) then continue; end if;
      v_cand := v_old -> j;
      if jsonb_typeof(v_cand) = 'object' and (v_cand - 'ts' - 'rules' - 'label') = (v_ev - 'ts' - 'rules' - 'label') then
        v_used := v_used || j; v_found := true; exit;
      end if;
    end loop;
    if v_found then continue; end if;
    if v_ev->>'type' = 'buy' then
      if v_locked and coalesce(v_rules->'postLockDrawbacks', 'false'::jsonb) <> 'true'::jsonb then
        raise exception 'PACT: drawbacks can''t be taken once creation is finished — they give AP; ask your DM to impose one, or to allow them in the campaign settings';
      end if;
      continue;
    end if;
    -- a new buyoff
    if public.pact_js_key(v_ev->'targetSeq') is null then
      raise exception 'PACT: a buy-off must name the purchase it cancels (targetSeq) — reload the character and buy it off again';
    end if;
    if v_r is null then
      v_r := public.pact_hr_resolve(v_new);
      select e -> 'overrides' into v_ov
        from jsonb_array_elements(v_new) with ordinality as t(e, ord)
       where jsonb_typeof(e) = 'object' and e->>'type' = 'dmHouseRules' and e->'dmEdit' = 'true'::jsonb
         and jsonb_typeof(e->'campaignId') = 'string' and e->>'campaignId' = NEW.campaign_id::text
         and jsonb_typeof(e->'overrides') = 'object'
       order by ord desc limit 1;
    end if;
    v_n := (v_r -> 'buyoffs' ->> v_ord::text)::int;
    if v_n is null then
      raise exception 'PACT: that buy-off cancels no drawback the character holds';
    end if;
    v_p := v_r -> 'purchases' -> (v_n - 1);
    -- Round 3: the targetSeq must name exactly the purchase the buyoff cancels (the oldest open copy). A targetSeq that names
    -- nothing (999, true, a closed copy) would leave the cancelled purchase's grant on the server while the browser drops it.
    if (v_p ->> 'seq') is null or public.pact_js_key(v_ev->'targetSeq') is distinct from (v_p ->> 'seq') then
      raise exception 'PACT: that buy-off names seq %, but it cancels the % at seq % — reload the character and buy it off again',
        public.pact_js_key(v_ev->'targetSeq'), v_p ->> 'name', coalesce(v_p ->> 'seq', '(none)');
    end if;
    v_rate := case when public.pact_js_truthy(v_p -> 'dmEdit')
                   then (case when v_new -> (((v_p ->> 'ord')::int) - 1) ->> 'dmRemovalCost' = 'expensive' then 3 else 1 end)
                   else 3 end;
    v_need := v_rate * public.pact_hr_drawback_effective(v_p ->> 'name', v_rules -> 'charHouseRules', v_ov);
    if public.pact_num(v_ev -> 'cost') < v_need then
      raise exception 'PACT: buying off % costs % AP (% × its value), not %', v_p ->> 'name', v_need, v_rate, public.pact_num(v_ev -> 'cost');
    end if;
  end loop;
  return NEW;
end;
$$;

drop trigger if exists trg_pact_player_grants_guard on public.characters;
create trigger trg_pact_player_grants_guard
  before update on public.characters
  for each row execute function public.pact_enforce_player_grants();

-- ---------------------------------------------------------------------------------------------------------------------
-- §6.1: campaigns.rules.charHouseRules has one writer.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.pact_guard_char_house_rules()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old jsonb;
begin
  if coalesce(current_setting('pact.hr_rpc', true), '') = 'on' then return NEW; end if;
  if coalesce(current_setting('request.jwt.claims', true), '') = '' then return NEW; end if;  -- admin session
  if TG_OP = 'UPDATE' then v_old := OLD.rules -> 'charHouseRules'; else v_old := null; end if;
  if (NEW.rules -> 'charHouseRules') is not distinct from v_old then return NEW; end if;
  -- Carried over, not refused: DM Console saves the whole rules blob it loaded, so a stale copy must not erase a newer
  -- RPC write, and a hand-made one must not forge it. Everything else in the blob saves as sent.
  if v_old is null then
    NEW.rules := coalesce(NEW.rules, '{}'::jsonb) - 'charHouseRules';
  else
    NEW.rules := jsonb_set(case when jsonb_typeof(NEW.rules) = 'object' then NEW.rules else '{}'::jsonb end,
                           '{charHouseRules}', v_old);
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_pact_guard_char_house_rules on public.campaigns;
create trigger trg_pact_guard_char_house_rules
  before insert or update on public.campaigns
  for each row execute function public.pact_guard_char_house_rules();

-- ---------------------------------------------------------------------------------------------------------------------
-- dm_apply_house_rules_change(campaign, charHouseRules, actions) — §6.2, M3, M4. See the header.
--   p_char_house_rules  SQL NULL = leave the campaign's charHouseRules as it is · JSON null = remove it (all calls on,
--                       no overrides) · an object = validated and stored whole.
--   p_actions           a JSON array (may be empty), at most 500, processed IN ORDER, each against the log as the
--                       earlier actions left it (two reprices of one purchase in one call chain their from/to).
--   p_expected          SQL NULL = no check · {"charHouseRules": X} = refuse unless the stored charHouseRules is X (JSON null
--                       = absent): optimistic concurrency between two DMs (PR #658 review). An `override` / `pin` action may
--                       carry `expected` (the character's current override snapshot for this campaign as the caller saw it,
--                       JSON null = none) — refused if the log's latest one differs.
-- Returns {charHouseRules, events:[{character, event}]}.
-- ---------------------------------------------------------------------------------------------------------------------
drop function if exists public.dm_apply_house_rules_change(uuid, jsonb, jsonb);   -- the pre-review signature (never applied)
create or replace function public.dm_apply_house_rules_change(p_campaign uuid, p_char_house_rules jsonb default null,
                                                              p_actions jsonb default '[]'::jsonb, p_expected jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_rules    jsonb;
  v_chr      jsonb;
  v_act      jsonb;
  v_idx      bigint;
  v_kind     text;
  v_char     uuid;
  v_ccamp    uuid;
  v_stats    jsonb;
  v_log      jsonb;
  v_seq      integer;
  v_ts       bigint := (extract(epoch from now()) * 1000)::bigint;
  v_ev       jsonb;
  v_out      jsonb := '[]'::jsonb;
  v_name     text;
  v_tseq     integer;
  v_r        jsonb;
  v_n        int;
  v_p        jsonb;
  v_cost     numeric;
  v_grant    numeric;
  v_ov       jsonb;
  v_eff      numeric;
  v_from     numeric;
  v_to       numeric;
  v_amt      numeric;
  v_last_lock int;
  v_last_unlk int;
  v_label    text;
  v_arch     boolean;
begin
  if auth.uid() is null then
    raise exception 'PACT: not signed in';
  end if;
  if not is_campaign_dm(p_campaign) then
    raise exception 'Only a campaign DM can change its house rules';
  end if;
  perform assert_campaign_active(p_campaign);
  select rules into v_rules from campaigns where id = p_campaign for update;
  if not found then
    raise exception 'Campaign not found';
  end if;
  -- Optimistic concurrency (PR #658 review): the rules the caller previewed against must still be the stored ones.
  if p_expected is not null then
    if jsonb_typeof(p_expected) <> 'object' or not (p_expected ? 'charHouseRules') then
      raise exception 'PACT house rules: p_expected must be {"charHouseRules": <the rules you loaded, or null>}';
    end if;
    if coalesce(v_rules -> 'charHouseRules', 'null'::jsonb) is distinct from (p_expected -> 'charHouseRules') then
      raise exception 'PACT house rules: another DM changed this campaign''s character house rules since you loaded them — reload and make your change again';
    end if;
  end if;

  p_actions := coalesce(p_actions, '[]'::jsonb);
  if jsonb_typeof(p_actions) <> 'array' then
    raise exception 'PACT house rules: p_actions must be a JSON array';
  end if;
  if jsonb_array_length(p_actions) > 500 then
    raise exception 'PACT house rules: at most 500 actions per call';
  end if;

  -- 1. The campaign layer.
  if p_char_house_rules is null then
    v_chr := v_rules -> 'charHouseRules';
  else
    if jsonb_typeof(p_char_house_rules) = 'null' then
      v_chr := null;
    else
      perform public.pact_hr_validate(p_char_house_rules, 'campaign');
      v_chr := p_char_house_rules;
    end if;
    perform set_config('pact.hr_rpc', 'on', true);
    update campaigns
       set rules = case when v_chr is null then coalesce(rules, '{}'::jsonb) - 'charHouseRules'
                        else jsonb_set(coalesce(rules, '{}'::jsonb), '{charHouseRules}', v_chr) end
     where id = p_campaign;
    perform set_config('pact.hr_rpc', '', true);
  end if;

  -- 2. The per-character events.
  for v_act, v_idx in select a, o from jsonb_array_elements(p_actions) with ordinality as x(a, o) loop
    if jsonb_typeof(v_act) <> 'object' then
      raise exception 'PACT house rules: action % must be an object', v_idx;
    end if;
    v_kind := v_act ->> 'kind';
    if v_kind is null or v_kind not in ('override', 'pin', 'reprice', 'refundBoon', 'removeDrawback') then
      raise exception 'PACT house rules: action % has an unknown kind "%"', v_idx, coalesce(v_kind, '');
    end if;
    if coalesce(v_act ->> 'character', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'PACT house rules: action % needs a character id', v_idx;
    end if;
    v_char := (v_act ->> 'character')::uuid;
    select campaign_id, stats, archived_at is not null into v_ccamp, v_stats, v_arch from characters where id = v_char for update;
    if not found or v_ccamp is distinct from p_campaign then
      raise exception 'PACT house rules: action % — that character is not in this campaign', v_idx;
    end if;
    -- An archived (soft-deleted) character is read-only here, as dm_bind_npc treats it. A DM's own NPC (is_npc) is accepted,
    -- like every other DM write path (dm_edit_character_log, award_ap): house rules apply to it as to any campaign character.
    if v_arch then
      raise exception 'PACT house rules: action % — that character is archived; un-archive it first', v_idx;
    end if;
    if v_stats is null or jsonb_typeof(v_stats -> 'LOG') is distinct from 'array' then
      raise exception 'PACT house rules: action % — the character has no log', v_idx;
    end if;
    v_log := v_stats -> 'LOG';
    v_seq := public.pact_next_seq(v_stats);
    v_label := nullif(btrim(coalesce(v_act ->> 'label', '')), '');

    if v_kind in ('override', 'pin') then
      perform public.pact_hr_validate(v_act -> 'overrides', 'override');
      if v_act ? 'expected' then   -- the override snapshot the caller built from must still be the latest one
        select e -> 'overrides' into v_ov
          from jsonb_array_elements(v_log) with ordinality as t(e, ord)
         where jsonb_typeof(e) = 'object' and e->>'type' = 'dmHouseRules' and e->'dmEdit' = 'true'::jsonb
           and jsonb_typeof(e->'campaignId') = 'string' and e->>'campaignId' = p_campaign::text
           and jsonb_typeof(e->'overrides') = 'object'
         order by ord desc limit 1;
        if coalesce(v_ov, 'null'::jsonb) is distinct from (v_act -> 'expected') then
          raise exception 'PACT house rules: action % — another DM changed this character''s house-rule overrides since you loaded them — reload and make your change again', v_idx;
        end if;
      end if;
      v_ev := jsonb_build_object('type', 'dmHouseRules', 'overrides', v_act -> 'overrides',
                                 'label', left(coalesce(v_label, 'DM house rules for this character'), 120));
    else
      -- AP-moving: only on a character that has FINISHED creation (its last creationLocked after its last
      -- creationUnlocked — #642's D2 test). A draft re-prices its purchases on every save (repriceDraft).
      select max(ord) into v_last_lock from jsonb_array_elements(v_log) with ordinality as t(e, ord) where e->>'type' = 'creationLocked';
      select max(ord) into v_last_unlk from jsonb_array_elements(v_log) with ordinality as t(e, ord) where e->>'type' = 'creationUnlocked';
      if v_last_lock is null or coalesce(v_last_unlk, 0) > v_last_lock then
        raise exception 'PACT house rules: action % — the character has not finished creation (its draft picks up the change by itself)', v_idx;
      end if;
      v_name := v_act ->> 'name';
      if v_name is null or btrim(v_name) = '' then
        raise exception 'PACT house rules: action % needs the purchase name', v_idx;
      end if;
      if jsonb_typeof(v_act -> 'targetSeq') = 'number' and (v_act ->> 'targetSeq') ~ '^[0-9]{1,9}$' then
        v_tseq := (v_act ->> 'targetSeq')::integer;
      else
        raise exception 'PACT house rules: action % needs targetSeq, the whole-number seq of the purchase', v_idx;
      end if;
      v_r := public.pact_hr_resolve(v_log);
      v_n := ((case when v_kind = 'refundBoon' then v_r -> 'bmap' else v_r -> 'dmap' end) ->> (v_tseq::text || '|' || v_name))::int;
      if v_n is null then
        raise exception 'PACT house rules: action % — no % "%" at seq %', v_idx,
          case when v_kind = 'refundBoon' then 'boon' else 'drawback' end, v_name, v_tseq;
      end if;
      if v_n < 0 then
        raise exception 'PACT house rules: action % — two purchases share seq % and name "%"; pin it instead', v_idx, v_tseq, v_name;
      end if;
      v_p := v_r -> 'purchases' -> (v_n - 1);
      if v_p ->> 'status' <> 'open' then
        raise exception 'PACT house rules: action % — "%" at seq % is no longer held (%)', v_idx, v_name, v_tseq, v_p ->> 'status';
      end if;
      if jsonb_typeof(v_p -> 'cost') not in ('number', 'null') then
        raise exception 'PACT house rules: action % — the purchase''s cost is not a number', v_idx;
      end if;
      v_cost := public.pact_num(v_p -> 'cost');
      if v_kind = 'refundBoon' then
        if public.pact_js_truthy(v_p -> 'dmEdit') then
          raise exception 'PACT house rules: action % — "%" was granted by a DM; remove it without a refund', v_idx, v_name;
        end if;
        if v_cost < 0 then
          raise exception 'PACT house rules: action % — "%" has a negative cost', v_idx, v_name;
        end if;
        v_ev := jsonb_build_object('type', 'dmRefundBoon', 'refVal', v_name, 'targetSeq', v_tseq, 'cost', -v_cost,
                                   'label', left(coalesce(v_label, 'DM refund — ' || v_name || ' (' || v_cost || ' AP)'), 120));
      else
        if public.pact_js_truthy(v_p -> 'dmEdit') and v_cost >= 0 then
          raise exception 'PACT house rules: action % — "%" was imposed by a DM; it grants nothing to change', v_idx, v_name;
        end if;
        v_grant := -v_cost + (v_p ->> 'delta')::numeric;
        if v_kind = 'removeDrawback' then
          v_ev := jsonb_build_object('type', 'dmRemoveDrawback', 'refVal', v_name, 'targetSeq', v_tseq, 'grantBack', v_grant,
                                     'label', left(coalesce(v_label, 'DM removed drawback — ' || v_name || ' (−' || v_grant || ' AP)'), 120));
        else
          if jsonb_typeof(v_act -> 'amount') is distinct from 'number' or jsonb_typeof(v_act -> 'from') is distinct from 'number'
             or jsonb_typeof(v_act -> 'to') is distinct from 'number' then
            raise exception 'PACT house rules: action % — a reprice needs numeric amount, from and to', v_idx;
          end if;
          v_amt := (v_act ->> 'amount')::numeric; v_from := (v_act ->> 'from')::numeric; v_to := (v_act ->> 'to')::numeric;
          if v_amt <> trunc(v_amt) or v_from <> trunc(v_from) or v_to <> trunc(v_to)
             or v_amt = 0 or abs(v_amt) > 1000 or v_to not between 0 and 1000 then
            raise exception 'PACT house rules: action % — amount must be a whole non-zero number up to ±1000 and to a whole number 0-1000', v_idx;
          end if;
          -- M3 from: the ledger's current grant for this purchase.
          if v_from <> v_grant then
            raise exception 'PACT house rules: action % — from (%) is not the purchase''s current grant (%)', v_idx, v_from, v_grant;
          end if;
          -- M3 to: its effective value now — DM pin > DM override (the last DM-stamped snapshot for THIS campaign) >
          -- campaign charHouseRules > printed (AB1's generated price list), 0 for a name none of them knows: the same
          -- pact_hr_drawback_effective() the ledger caps each grant at, so a tick always lands browser and server together.
          select e -> 'overrides' into v_ov
            from jsonb_array_elements(v_log) with ordinality as t(e, ord)
           where jsonb_typeof(e) = 'object' and e->>'type' = 'dmHouseRules' and e->'dmEdit' = 'true'::jsonb
             and jsonb_typeof(e->'campaignId') = 'string' and e->>'campaignId' = p_campaign::text
             and jsonb_typeof(e->'overrides') = 'object'
           order by ord desc limit 1;
          v_eff := public.pact_hr_drawback_effective(v_name, v_chr, v_ov);
          if v_to <> v_eff then
            raise exception 'PACT house rules: action % — to (%) is not "%"''s effective value for this character (%)', v_idx, v_to, v_name, v_eff;
          end if;
          if v_amt <> v_to - v_from then
            raise exception 'PACT house rules: action % — amount must be to − from (%)', v_idx, v_to - v_from;
          end if;
          v_ev := jsonb_build_object('type', 'dmRepriceDrawback', 'refVal', v_name, 'targetSeq', v_tseq,
                                     'amount', v_amt, 'from', v_from, 'to', v_to,
                                     'label', left(coalesce(v_label, 'DM repriced drawback — ' || v_name || ' ' || v_from || ' → ' || v_to || ' AP'), 120));
        end if;
      end if;
    end if;

    v_ev := v_ev || jsonb_build_object('campaignId', p_campaign::text, 'seq', v_seq, 'ts', v_ts, 'dmEdit', true, 'dmId', auth.uid());
    v_stats := jsonb_set(jsonb_set(v_stats, '{LOG}', v_log || jsonb_build_array(v_ev)), '{SEQ}', to_jsonb(v_seq + 1));
    update characters set stats = v_stats where id = v_char;
    v_out := v_out || jsonb_build_array(jsonb_build_object('character', v_char, 'event', v_ev));
  end loop;

  return jsonb_build_object('charHouseRules', v_chr, 'events', v_out);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Grants. Trigger functions are never callable (2026-09-01-revoke-trigger-function-execute.sql). The pure helpers stay
-- callable by signed-in users because pact_ap_ledger_spend — deliberately callable — runs them as the caller.
-- ---------------------------------------------------------------------------------------------------------------------
revoke execute on function public.pact_enforce_dm_family()        from public, anon, authenticated;
revoke execute on function public.pact_guard_char_house_rules()   from public, anon, authenticated;
revoke execute on function public.pact_enforce_player_grants()    from public, anon, authenticated;
revoke execute on function public.pact_ap_ledger_discount(jsonb)   from public, anon, authenticated;   -- as 2026-10-13-dm-ap-discount.sql left it
revoke all on function public.pact_js_truthy(jsonb)               from public, anon;
revoke all on function public.pact_js_number(jsonb)               from public, anon;
revoke all on function public.pact_num(jsonb)                     from public, anon;
revoke all on function public.pact_js_key(jsonb)                  from public, anon;
revoke all on function public.pact_next_seq(jsonb)                from public, anon;
revoke all on function public.pact_hr_drawback_cap(jsonb)         from public, anon;
revoke all on function public.pact_hr_entry_ok(text, jsonb, text) from public, anon;
revoke all on function public.pact_hr_validate(jsonb, text)       from public, anon;
revoke all on function public.pact_hr_resolve(jsonb)              from public, anon;
revoke all on function public.pact_ap_ledger_split(jsonb, jsonb, uuid) from public, anon;
revoke all on function public.pact_drawback_printed(text)          from public, anon;
revoke all on function public.pact_hr_drawback_effective(text, jsonb, jsonb) from public, anon;
revoke all on function public.pact_dm_family(jsonb)               from public, anon;
grant execute on function public.pact_js_truthy(jsonb)               to authenticated;
grant execute on function public.pact_js_number(jsonb)               to authenticated;
grant execute on function public.pact_num(jsonb)                     to authenticated;
grant execute on function public.pact_js_key(jsonb)                  to authenticated;
grant execute on function public.pact_next_seq(jsonb)                to authenticated;
grant execute on function public.pact_hr_drawback_cap(jsonb)         to authenticated;
grant execute on function public.pact_hr_entry_ok(text, jsonb, text) to authenticated;
grant execute on function public.pact_hr_validate(jsonb, text)       to authenticated;
grant execute on function public.pact_hr_resolve(jsonb)              to authenticated;
grant execute on function public.pact_ap_ledger_split(jsonb, jsonb, uuid) to authenticated;
grant execute on function public.pact_drawback_printed(text)          to authenticated;
grant execute on function public.pact_hr_drawback_effective(text, jsonb, jsonb) to authenticated;
grant execute on function public.pact_dm_family(jsonb)               to authenticated;
revoke all on function public.dm_apply_house_rules_change(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.dm_apply_house_rules_change(uuid, jsonb, jsonb, jsonb) to authenticated;

comment on function public.dm_apply_house_rules_change(uuid, jsonb, jsonb, jsonb) is
  'The one writer of campaigns.rules.charHouseRules and of the DM house-rules events (dmHouseRules, dmRefundBoon, dmRemoveDrawback, dmRepriceDrawback). D-GH-2026-10-13-campaign-house-rules.';
comment on function public.pact_hr_drawback_cap(jsonb) is
  'Owner decision Z1: the drawback AP cap the budget check applies — js/campaign.js drawbackCapFromRules() exactly; NULL = no cap.';
comment on function public.pact_enforce_dm_family() is
  'M1: a non-DM, non-admin writer may not add, change, remove or reorder a campaign character''s DM-family events (truthy dmEdit, or a DM-only type). D-GH-2026-10-13-campaign-house-rules.';
comment on function public.pact_guard_char_house_rules() is
  'Keeps campaigns.rules.charHouseRules as it was unless dm_apply_house_rules_change() (GUC pact.hr_rpc) or an admin session writes it.';

-- ---------------------------------------------------------------------------
-- Creation-lock guard (D1), campaign moves keep the lock (L1) — applied to live 2026-10-04 as migration
-- creation_lock_guard (sql/migrations/2026-10-04-creation-lock-guard.sql). See
-- D-GH-2026-10-01-creation-lock-integrity. NOTE: pact_campaign_move_clears_creation() and its trigger were
-- previously missing from this file (the 2026-09-01 migration is their only other definition).
-- ---------------------------------------------------------------------------
create or replace function public.pact_lock_family(p_log jsonb)
returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg((ev - 'seq' - 'ts' - 'rules' - 'label') order by ord), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_log, '[]'::jsonb)) with ordinality as t(ev, ord)
  where (ev->>'type') in ('creationLocked', 'creationUnlocked', 'creationLockConfig');
$$;
revoke execute on function public.pact_lock_family(jsonb) from public, anon, authenticated;

create or replace function public.pact_enforce_creation_lock()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old jsonb; v_new jsonb; v_ev jsonb; i int;
  v_moved boolean := OLD.campaign_id is distinct from NEW.campaign_id;
begin
  if NEW.stats is not distinct from OLD.stats then return NEW; end if;
  if OLD.campaign_id is null and NEW.campaign_id is null then return NEW; end if;   -- solo character
  if coalesce(current_setting('request.jwt.claims', true), '') = '' then return NEW; end if;  -- admin session
  if (OLD.campaign_id is not null and public.is_campaign_dm(OLD.campaign_id))
     or (NEW.campaign_id is not null and public.is_campaign_dm(NEW.campaign_id)) then
    return NEW;
  end if;

  v_old := public.pact_lock_family(OLD.stats->'LOG');
  v_new := public.pact_lock_family(NEW.stats->'LOG');

  if jsonb_array_length(v_new) < jsonb_array_length(v_old) then
    raise exception 'PACT: locked character history — a creation-lock entry cannot be removed'
      using hint = 'Reload the character — this copy is older than the saved one.';
  end if;
  for i in 0 .. jsonb_array_length(v_old) - 1 loop
    if (v_old -> i) is distinct from (v_new -> i) then
      raise exception 'PACT: locked character history — a creation-lock entry cannot be changed (entry %)', i
        using hint = 'Reload the character — this copy is older than the saved one.';
    end if;
  end loop;

  for i in jsonb_array_length(v_old) .. jsonb_array_length(v_new) - 1 loop
    v_ev := v_new -> i;
    if v_ev->>'type' = 'creationLocked' then
      continue;
    elsif v_ev->>'type' = 'creationLockConfig' and not (coalesce(v_ev->'payload', '{}'::jsonb) ? 'threshold') then
      continue;
    elsif v_moved and v_ev->>'type' = 'creationLockConfig'
          and (v_ev->'payload'->'threshold') = 'null'::jsonb and coalesce((v_ev->>'systemEdit')::boolean, false) then
      continue;
    end if;
    raise exception 'PACT: locked character history — only the campaign DM can reopen creation or set its limit'
      using hint = 'Ask your DM to reopen creation in DM Console.';
  end loop;
  return NEW;
end;
$$;
revoke execute on function public.pact_enforce_creation_lock() from public, anon, authenticated;

drop trigger if exists trg_pact_creation_lock_guard on public.characters;
create trigger trg_pact_creation_lock_guard
  before update on public.characters
  for each row execute function public.pact_enforce_creation_lock();


create or replace function public.pact_campaign_move_clears_creation()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_log jsonb; v_seq integer;
  v_ts bigint := (extract(epoch from now()) * 1000)::bigint;
  v_note text;
begin
  if NEW.campaign_id is not distinct from OLD.campaign_id then return NEW; end if;
  if NEW.stats is null or not (NEW.stats ? 'LOG') then return NEW; end if;

  v_log := coalesce(NEW.stats->'LOG', '[]'::jsonb);
  v_seq := coalesce((NEW.stats->>'SEQ')::integer, jsonb_array_length(v_log) + 1);

  v_note := case
    when OLD.campaign_id is null then 'joined a campaign'
    when NEW.campaign_id is null then 'left the campaign'
    else 'moved to a different campaign'
  end;

  v_log := v_log || jsonb_build_object(
    'seq', v_seq, 'ts', v_ts,
    'type', 'creationLockConfig',
    'payload', jsonb_build_object('threshold', null),
    'systemEdit', true,
    'label', 'Creation limit cleared - ' || v_note);
  v_seq := v_seq + 1;

  -- L1 (2026-10-01): no creationUnlocked here any more. A finished character stays finished; the new
  -- table's DM reopens creation explicitly if they want it.

  NEW.stats := jsonb_set(jsonb_set(NEW.stats, '{LOG}', v_log), '{SEQ}', to_jsonb(v_seq));
  return NEW;
end;
$$;

drop trigger if exists trg_pact_campaign_move_clears_creation on public.characters;
create trigger trg_pact_campaign_move_clears_creation
  before update on public.characters
  for each row execute function public.pact_campaign_move_clears_creation();

-- fix/ap-minting-and-edit-award-campaign (D-GH-2026-10-22-ap-minting-and-edit-award-campaign): ap/gold cannot be carried between campaigns.
-- Folded from sql/migrations/2026-10-22-ap-minting-and-edit-award-campaign.sql (NOT yet applied to production when this was written).
create or replace function public.pact_reset_campaign_grants_on_move()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if NEW.campaign_id is null or NEW.campaign_id is not distinct from OLD.campaign_id then
    return NEW;
  end if;
  if coalesce(current_setting('request.jwt.claims', true), '') = '' then return NEW; end if;  -- admin session

  NEW.ap := coalesce((select sum(a.amount) from public.ap_awards a
                       where a.character_id = NEW.id and a.campaign_id = NEW.campaign_id), 0);
  NEW.gold := coalesce((select sum(g.gold) from public.gold_awards g
                         where g.character_id = NEW.id and g.campaign_id = NEW.campaign_id), 0);
  return NEW;
end;
$$;

drop trigger if exists trg_pact_aa_reset_grants_on_campaign_move on public.characters;
create trigger trg_pact_aa_reset_grants_on_campaign_move
  before update on public.characters
  for each row
  when (NEW.campaign_id is not null and NEW.campaign_id is distinct from OLD.campaign_id)
  execute function public.pact_reset_campaign_grants_on_move();

revoke execute on function public.pact_reset_campaign_grants_on_move() from public, anon, authenticated;

comment on function public.pact_reset_campaign_grants_on_move() is
  'On a move into a different non-null campaign, resets characters.ap / gold to that campaign''s ap_awards / gold_awards sums for the character, so granted AP and gold cannot be carried between campaigns. D-GH-2026-10-22-ap-minting-and-edit-award-campaign.';

-- ---------------------------------------------------------------------------
-- Account-level "basic mode" (feat/player-basic-mode). Restricts a flagged player to one active
-- (non-archived) character, enforced so it cannot be bypassed by calling the database directly. See
-- docs/plans/2026-09-05-player-basic-mode.md and decisions/2026/D-GH-2026-09-05-player-basic-mode.md
-- (authority model, decision A3) for the full reasoning; full commentary in the migration this was
-- first applied from: sql/migrations/2026-09-06-player-basic-mode.sql.
--
-- Broadened to INSERT *and* UPDATE OF archived_at so it also closes the archive/create/un-archive
-- bypass, not INSERT alone. Advisory-lock-guarded (hashtextextended, 64-bit) so two concurrent
-- attempts for the same owner serialize instead of both reading a pre-write count of zero.
--
-- Correctness guard: `UPDATE OF archived_at` fires whenever that column is present in the UPDATE's
-- SET list, whether or not its value actually changes -- resending archived_at=NULL unchanged on a
-- routine edit to an already-active character must NOT re-run the count check. Guarded in the
-- function body (this codebase's existing style for pact_enforce_locked_history/
-- pact_enforce_ap_budget_consistency), not a trigger WHEN clause.
--
-- Trigger ordering: fires alongside this table's three existing BEFORE UPDATE triggers in
-- alphabetical-by-name order on any UPDATE OF archived_at. trg_pact_ap_budget_consistency and
-- trg_pact_locked_history both early-return whenever stats is unchanged -- true by definition for an
-- archived_at-only update -- so neither interacts with this trigger regardless of order.
-- ---------------------------------------------------------------------------
create or replace function public.pact_enforce_basic_mode()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_basic_mode   boolean;
  v_active_count integer;
begin
  if NEW.archived_at is not null then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' and OLD.archived_at is not distinct from NEW.archived_at then
    return NEW;
  end if;

  select basic_mode into v_basic_mode from profiles where id = NEW.owner_id;
  if not coalesce(v_basic_mode, false) then
    return NEW;   -- not flagged: no limit to enforce
  end if;

  perform pg_advisory_xact_lock(hashtextextended(NEW.owner_id::text, 0));

  select count(*) into v_active_count
    from characters
    where owner_id = NEW.owner_id and archived_at is null and id <> NEW.id;

  if v_active_count > 0 then
    raise exception 'PACT: this account is limited to one active character (basic mode)'
      using errcode = 'PACT1',
            hint = 'Ask a DM to turn off basic mode, or turn it off yourself in your account settings.';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_pact_enforce_basic_mode on public.characters;
create trigger trg_pact_enforce_basic_mode
  before insert or update of archived_at on public.characters
  for each row execute function public.pact_enforce_basic_mode();

revoke all on function public.pact_enforce_basic_mode() from public, anon, authenticated;

-- is_dm_of_player(player) -- true iff auth.uid() DMs a campaign `player` currently plays in. Mirrors
-- shares_campaign()'s own first branch exactly, deliberately NOT shares_campaign() itself: that
-- function's other three branches (p_other DMs a campaign I play in; we both play in the same
-- campaign as fellow players; we co-DM the same campaign) do NOT mean "I am this player's DM", and
-- basic-mode authority (decision A3) is DM-of-the-player only, one specific direction.
--
-- FOUND BY /code-review ultra on PR #531, before merge: set_basic_mode()/unset_basic_mode() originally
-- called shares_campaign() directly, which let ANY two fellow-players in the same campaign flag each
-- other (or even their own DM) -- a real privilege escalation, live in production for under a day
-- before being caught, never actually exploited (0 players flagged at time of fix). Every other
-- privileged RPC in this codebase (award_ap, seal_character_history, etc.) already checks
-- is_campaign_dm(campaign); this is that same pattern's account-level equivalent.
create or replace function public.is_dm_of_player(p_player uuid)
returns boolean language sql security definer stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from campaign_dms d join characters ch on ch.campaign_id = d.campaign_id
      where d.dm_id = auth.uid() and ch.owner_id = p_player and not ch.is_npc
  );
$$;

revoke all on function public.is_dm_of_player(uuid) from public, anon;
grant execute on function public.is_dm_of_player(uuid) to authenticated;

-- set_basic_mode(player) / unset_basic_mode(player) -- the only write paths for profiles.basic_mode
-- and its audit columns (profiles has no plain UPDATE grant at all -- see above). Authority per
-- decision A3: a DM sharing a campaign with the player may turn it ON; the player may ALWAYS turn
-- their own OFF regardless of any DM's current standing; a DM sharing a campaign may also turn it
-- off, as a convenience, but is never the only path.
create or replace function public.set_basic_mode(p_player uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_dm_of_player(p_player) then
    raise exception 'PACT: only a DM sharing a campaign with this player can turn on basic mode';
  end if;
  update profiles
    set basic_mode = true, basic_mode_set_by = auth.uid(), basic_mode_set_at = now()
    where id = p_player;
  if not found then
    raise exception 'Player not found';
  end if;
end;
$$;

create or replace function public.unset_basic_mode(p_player uuid default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_target uuid := coalesce(p_player, auth.uid());
begin
  if v_target <> auth.uid() and not is_dm_of_player(v_target) then
    raise exception 'PACT: only the player themselves, or a DM sharing a campaign with them, can turn off basic mode';
  end if;
  update profiles
    set basic_mode = false, basic_mode_set_by = null, basic_mode_set_at = null
    where id = v_target;
  if not found then
    raise exception 'Player not found';
  end if;
end;
$$;

revoke all on function public.set_basic_mode(uuid) from public, anon;
grant execute on function public.set_basic_mode(uuid) to authenticated;
revoke all on function public.unset_basic_mode(uuid) from public, anon;
grant execute on function public.unset_basic_mode(uuid) to authenticated;

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
revoke execute on function public.pact_ap_ledger_discount(jsonb)            from public, anon, authenticated;
revoke execute on function public.pact_enforce_dm_discount_authorship()    from public, anon, authenticated;
revoke execute on function public.pact_enforce_creation_lock()          from public, anon, authenticated;

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
grant execute on function public.edit_ap_award(uuid, integer, text, timestamptz, text) to authenticated;
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
revoke execute on function public.edit_ap_award(uuid, integer, text, timestamptz, text) from public;
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

-- ---------------------------------------------------------------------------
-- Blank-row guard (fix/blank-row-guard, 2026-10-10; D-GH-2026-10-10-blank-row-guard).
-- Same definitions as sql/migrations/2026-10-10-blank-row-guard.sql — see that header for why the guard
-- and the purge are SOLO-only (join_campaign/redeem_player_invite seed campaign rows with stats {}).
-- The weekly pg_cron schedule is Supabase-only and lives in 2026-10-10-blank-row-purge-schedule.sql.
-- ---------------------------------------------------------------------------
create or replace function public.pact_refuse_blank_solo_character()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if NEW.campaign_id is null and not (coalesce(NEW.stats, '{}'::jsonb) ? 'LOG') then
    raise exception 'PACT: refused a blank character — a solo character must be saved with its event log'
      using errcode = 'check_violation';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_pact_refuse_blank_solo_character on public.characters;
create trigger trg_pact_refuse_blank_solo_character
  before insert on public.characters
  for each row execute function public.pact_refuse_blank_solo_character();

revoke all on function public.pact_refuse_blank_solo_character() from public, anon, authenticated;

create or replace function public.pact_purge_blank_characters(p_min_age interval default interval '1 day')
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_n integer;
begin
  with gone as (
    delete from public.characters c
     where c.campaign_id is null
       and c.stats = '{}'::jsonb
       and c.created_at < now() - p_min_age
       and c.updated_at < now() - p_min_age
       and not exists (select 1 from public.ap_awards a                       where a.character_id = c.id)
       and not exists (select 1 from public.gold_awards g                     where g.character_id = c.id)
       and not exists (select 1 from public.character_dm_notes n              where n.character_id = c.id)
       and not exists (select 1 from public.campaign_invites i                where i.source_character_id = c.id)
       and not exists (select 1 from public.campaign_downtime_declarations d  where d.character_id = c.id)
       and not exists (select 1 from public.ap_award_edits e                  where e.character_id = c.id)
    returning 1
  )
  select count(*) into v_n from gone;
  return v_n;
end;
$$;

revoke all on function public.pact_purge_blank_characters(interval) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage: the private `character-images` bucket (feat/character-images, D-GH-2026-10-15-character-images).
-- Applied to production 2026-10-19 as sql/migrations/2026-10-15-character-images.sql; its header has the whole
-- design (the object name `<character uuid>/1|2` IS the data model; owner writes; owner + campaign DMs + campaign
-- players read; an object older than its character row is invisible). The helpers and grants below are that
-- migration's text verbatim.
--
-- WHY THE BUCKET AND POLICIES SIT INSIDE A GUARD. They live in Supabase's own `storage` schema, which exists on
-- every Supabase project but NOT on the plain Postgres this file is also loaded into (sql-guards.yml's harnesses,
-- the creation-lock-guard-test rehearsals, cloud-e2e, seed-review-stack). Loading the statements bare would make
-- this file fail everywhere except Supabase; adding a storage stub to every one of those loaders would make each
-- of them pretend to be Supabase for a feature none of them tests. So: on Supabase (storage.objects exists) the
-- statements run exactly as written; elsewhere they are skipped with a NOTICE. Each EXECUTE carries the
-- migration's statement unchanged, so the policy text still reads as SQL and still matches the migration — and
-- testing/sql/rls-baseline-test.sql loads a storage stub FIRST, so this branch is built and checked there.
-- The helpers need only public.characters and auth.uid(), so they are created unconditionally.
-- ---------------------------------------------------------------------------
-- The character a picture belongs to, or NULL when the name is not exactly `<lower-case uuid>/1|2`.
-- Fail-closed: every policy below needs a non-null answer.
create or replace function public.character_image_character(p_name text)
returns uuid language sql immutable set search_path = public, pg_temp as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[12]$'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;

-- p_created = the OBJECT's created_at (from the policy). NULL fails closed.
create or replace function public.can_read_character_image(p_name text, p_created timestamptz)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from characters c
    where c.id = character_image_character(p_name)
      and p_created >= c.created_at
      and (
            c.owner_id = auth.uid()
         or is_campaign_dm(c.campaign_id)
         or is_campaign_member(c.campaign_id)
      )
  );
$$;

create or replace function public.can_write_character_image(p_name text, p_created timestamptz)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from characters c
    where c.id = character_image_character(p_name)
      and p_created >= c.created_at
      and c.owner_id = auth.uid()
  );
$$;

revoke all on function public.character_image_character(text) from public, anon;
revoke all on function public.can_read_character_image(text, timestamptz)  from public, anon;
revoke all on function public.can_write_character_image(text, timestamptz) from public, anon;
grant execute on function public.character_image_character(text) to authenticated;
grant execute on function public.can_read_character_image(text, timestamptz)  to authenticated;
grant execute on function public.can_write_character_image(text, timestamptz) to authenticated;

do $storage$
begin
  if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null then
    raise notice 'rls-policies.sql: no storage schema here (not Supabase) — character-images bucket and policies skipped';
  else
    execute $sql$insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('character-images', 'character-images', false, 2097152, array['image/webp','image/jpeg','image/png'])
      on conflict (id) do update
        set public = false,
            file_size_limit = excluded.file_size_limit,
            allowed_mime_types = excluded.allowed_mime_types$sql$;

    -- Upload with upsert (the client's "Replace") needs SELECT + INSERT + UPDATE; the owner holds all three.
    execute $sql$drop policy if exists character_images_select on storage.objects$sql$;
    execute $sql$create policy character_images_select on storage.objects
        for select to authenticated
        using (bucket_id = 'character-images' and public.can_read_character_image(name, created_at))$sql$;
    execute $sql$drop policy if exists character_images_insert on storage.objects$sql$;
    execute $sql$create policy character_images_insert on storage.objects
        for insert to authenticated
        with check (bucket_id = 'character-images' and public.can_write_character_image(name, created_at))$sql$;
    -- WITH CHECK as well as USING: a rename/move may not land on another character or on a third slot.
    execute $sql$drop policy if exists character_images_update on storage.objects$sql$;
    execute $sql$create policy character_images_update on storage.objects
        for update to authenticated
        using (bucket_id = 'character-images' and public.can_write_character_image(name, created_at))
        with check (bucket_id = 'character-images' and public.can_write_character_image(name, created_at))$sql$;
    execute $sql$drop policy if exists character_images_delete on storage.objects$sql$;
    execute $sql$create policy character_images_delete on storage.objects
        for delete to authenticated
        using (bucket_id = 'character-images' and public.can_write_character_image(name, created_at))$sql$;
  end if;
end
$storage$;
