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
-- Enable RLS
-- ---------------------------------------------------------------------------
alter table public.profiles           enable row level security;
alter table public.campaigns          enable row level security;
alter table public.characters         enable row level security;
alter table public.campaign_dms       enable row level security;
alter table public.ap_awards          enable row level security;
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

-- Any DM may edit campaign settings (e.g. ignore_player_ap).
drop policy if exists campaigns_update on public.campaigns;
create policy campaigns_update on public.campaigns
  for update using (is_campaign_dm(id)) with check (is_campaign_dm(id));

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
-- character_dm_notes — DM-only per-character notes/label. Never the character's
-- owner, even though they can read/delete the character row itself.
-- ---------------------------------------------------------------------------
drop policy if exists character_dm_notes_all on public.character_dm_notes;
create policy character_dm_notes_all on public.character_dm_notes
  for all using (is_campaign_dm_of_character(character_id))
  with check (is_campaign_dm_of_character(character_id));

grant select, insert, update, delete on public.character_dm_notes to authenticated;

-- ---------------------------------------------------------------------------
-- Column-level ap lockdown — the real ap guard.
-- Strip blanket UPDATE, then grant UPDATE only on the player-writable columns.
-- ap is deliberately excluded; it can change ONLY through award_ap().
-- campaign_id is excluded: join_campaign() / leave_campaign() (SECURITY DEFINER)
-- are the sole writers; direct player writes are rejected.
-- ---------------------------------------------------------------------------
revoke update on public.characters from authenticated, anon;
grant update (name, kind, stats) on public.characters to authenticated;

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

  insert into ap_awards (character_id, dm_id, campaign_id, amount, note)
    values (p_character, auth.uid(), v_campaign, p_amount, p_note);

  update characters set ap = ap + p_amount
    where id = p_character
    returning ap into v_ap;
  return v_ap;
end;
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
  v_campaign uuid;
  v_stats    jsonb;
  v_log      jsonb;
  v_seq      integer;
  v_new      jsonb := '[]'::jsonb;
  v_ev       jsonb;
  v_type     text;
  v_cat      text;
  v_ts       bigint := (extract(epoch from now()) * 1000)::bigint;
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
    elsif v_type not in ('award', 'dmRemoveBoon') then
      raise exception 'dm_edit_character_log: unsupported event type %', v_type;
    end if;

    v_ev := (v_ev - 'seq' - 'ts' - 'dmEdit' - 'dmId')
      || jsonb_build_object('seq', v_seq, 'ts', v_ts, 'dmEdit', true, 'dmId', auth.uid());
    v_new := v_new || jsonb_build_array(v_ev);
    v_seq := v_seq + 1;
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
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'type', ev->>'type', 'cat', ev->>'cat',
           'cost', ev->>'cost', 'amount', ev->>'amount', 'refVal', ev->>'refVal',
           'disc', ev->>'disc'
         ) order by ord), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_log,'[]'::jsonb)) with ordinality as t(ev, ord)
  where (ev->>'type') in ('buyoff','names','award')
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
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old_log jsonb;
  v_award_idx int;
  v_protected_old jsonb;
  v_protected_new jsonb;
  i int;
begin
  if NEW.campaign_id is null then
    return NEW;
  end if;
  if NEW.stats is not distinct from OLD.stats then
    return NEW;
  end if;

  v_old_log := coalesce(OLD.stats->'LOG', '[]'::jsonb);

  -- The same boundary undo() already enforces client-side: the LAST non-discretionary, non-seed
  -- award event. noLock:true excludes CharGen's creation-budget seed (which churns to the end of
  -- the log on every resync -- see the migration file's revision note); disc:true excludes a
  -- player's own explicitly-discretionary Live Sheet award entry, same as undo()'s own check.
  select max(ord) into v_award_idx
  from jsonb_array_elements(v_old_log) with ordinality as t(ev, ord)
  where (ev->>'type') = 'award'
    and not coalesce((ev->>'disc')::boolean, false)
    and not coalesce((ev->>'noLock')::boolean, false);

  if v_award_idx is null then
    return NEW;
  end if;

  v_protected_old := public.pact_ap_ledger_protected(
    (select jsonb_agg(ev order by ord)
       from jsonb_array_elements(v_old_log) with ordinality as t(ev, ord)
       where ord <= v_award_idx)
  );
  v_protected_new := public.pact_ap_ledger_protected(coalesce(NEW.stats->'LOG', '[]'::jsonb));

  if jsonb_array_length(v_protected_new) < jsonb_array_length(v_protected_old) then
    raise exception 'PACT: locked character history cannot shrink (an AP award already locked it)';
  end if;

  for i in 0 .. jsonb_array_length(v_protected_old) - 1 loop
    if (v_protected_old -> i) is distinct from (v_protected_new -> i) then
      raise exception 'PACT: locked character history cannot be rewritten (protected event % changed)', i;
    end if;
  end loop;

  return NEW;
end;
$$;

drop trigger if exists trg_pact_locked_history on public.characters;
create trigger trg_pact_locked_history
  before update on public.characters
  for each row execute function public.pact_enforce_locked_history();

grant execute on function public.pact_ap_ledger_spend(jsonb)     to authenticated;
grant execute on function public.pact_ap_ledger_protected(jsonb) to authenticated;
grant execute on function public.pact_enforce_ap_budget_consistency() to authenticated;
grant execute on function public.pact_enforce_locked_history()        to authenticated;
revoke execute on function public.pact_ap_ledger_spend(jsonb)     from public;
revoke execute on function public.pact_ap_ledger_protected(jsonb) from public;
revoke execute on function public.pact_enforce_ap_budget_consistency() from public;
revoke execute on function public.pact_enforce_locked_history()        from public;

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
-- ---------------------------------------------------------------------------
alter table public.campaign_invites enable row level security;

drop policy if exists campaign_invites_select on public.campaign_invites;
create policy campaign_invites_select on public.campaign_invites
  for select using (is_campaign_dm(campaign_id) or redeemed_by = auth.uid());

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
grant execute on function public.redeem_player_invite(text, text)             to authenticated;
grant execute on function public.bind_character_to_campaign(uuid, text)       to authenticated;
grant execute on function public.dm_unbind_character(uuid)                    to authenticated;
grant execute on function public.is_campaign_dm_of_character(uuid)            to authenticated;
grant execute on function public.create_player_invite(uuid, integer, integer, text) to authenticated;
grant execute on function public.list_campaign_invites(uuid)                        to authenticated;
grant execute on function public.set_invite_revoked(uuid, boolean)                  to authenticated;
grant execute on function public.peek_player_invite(text)                           to authenticated;
grant execute on function public.dm_edit_character_log(uuid, jsonb)                 to authenticated;

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
