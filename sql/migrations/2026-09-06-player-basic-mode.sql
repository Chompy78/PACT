-- feat/player-basic-mode — account-level "basic mode": restrict a flagged player to one active
-- (non-archived) character, enforced server-side so it cannot be bypassed by calling the database
-- directly. See docs/plans/2026-09-05-player-basic-mode.md (implementation plan, 8 cold-review
-- rounds) and decisions/2026/D-GH-2026-09-05-player-basic-mode.md (authority model, decision A3).
--
-- Blast radius, measured live against Supabase 2026-09-06 (the day this migration was written):
-- 39 characters, 8 distinct owners, 4 campaigns, 6 campaign-bound characters. This migration adds
-- three nullable columns (default null/off) and a trigger that only ever fires a check when
-- `profiles.basic_mode` is true for the row's owner — true for ZERO existing rows, since the column
-- doesn't exist until this migration creates it. 0 of 39 characters affected by this change; every
-- existing player is completely unaffected until a DM (or the player themselves, though there is no
-- self-service *on* path — see the decision record) deliberately opts them in.
--
-- ---------------------------------------------------------------------------
-- 1. Three columns on profiles. basic_mode: nullable boolean, default null (=off). set_by/set_at
--    exist purely so a flagged player can see who restricted them and when (decision record) — not
--    read by the enforcement trigger below. set_by uses `on delete set null`, the same pattern
--    ap_awards.dm_id already uses (schema.sql) — the setting DM's account being deleted later must
--    not touch the flagged player's own row (CASCADE would be catastrophic here: it would delete the
--    PLAYER's profile, not just the DM's); the flagged player's OWN account deletion is already
--    covered by the pre-existing profiles.id -> auth.users(id) on delete cascade, no new handling
--    needed for that side.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists basic_mode boolean,
  add column if not exists basic_mode_set_by uuid references public.profiles(id) on delete set null,
  add column if not exists basic_mode_set_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Enforcement trigger. Broadened to INSERT *and* UPDATE OF archived_at (not INSERT alone) so it
--    also closes the archive/create/un-archive bypass two independent cold reviews found in the
--    original INSERT-only draft. Advisory-lock-guarded so two concurrent attempts for the same owner
--    serialize instead of both reading a pre-write count of zero.
--
--    Correctness guard (cold review round 7, see plan's Proposed approach step 2a): `UPDATE OF
--    archived_at` fires whenever that column is present in the UPDATE's SET list, whether or not its
--    value actually changes — resending `archived_at = NULL` unchanged on a routine edit to an
--    already-active character must NOT re-run the count check, or a basic-mode player could be
--    wrongly blocked from saving edits to the one character they're allowed to have. Guarded in the
--    function body (matching this codebase's existing style — pact_enforce_locked_history and
--    pact_enforce_ap_budget_consistency both use an early-return guard rather than a trigger WHEN
--    clause) rather than a WHEN clause, which would need to reference OLD on a combined INSERT/UPDATE
--    trigger — safer to keep in the body where TG_OP is unambiguous.
--
--    Trigger ordering: this table's three existing BEFORE UPDATE triggers
--    (trg_characters_updated_at, trg_pact_ap_budget_consistency, trg_pact_locked_history) fire in
--    alphabetical-by-name order alongside this one on any UPDATE OF archived_at. Checked directly:
--    trg_pact_ap_budget_consistency and trg_pact_locked_history both early-return whenever
--    `NEW.stats is not distinct from OLD.stats` — true by definition for an archived_at-only update —
--    so neither interacts with this trigger regardless of firing order. trg_characters_updated_at
--    only stamps updated_at, unconditionally harmless. No existing trigger fires on INSERT at all, so
--    this is the first and only one there.
-- ---------------------------------------------------------------------------
create or replace function public.pact_enforce_basic_mode()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_basic_mode   boolean;
  v_active_count integer;
begin
  -- Only a transition INTO active state can possibly increase this owner's active-character count:
  -- a brand new row (INSERT), or un-archiving (archived_at going non-null -> null). Archiving, or a
  -- no-op re-send of the same archived_at value, cannot create a second active character.
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

  -- Advisory lock, held for the rest of this transaction, keyed on the owner. hashtextextended
  -- (64-bit) rather than hashtext (32-bit) to keep the cross-owner collision chance negligible
  -- (cold review round 7 refinement over the round-3 pattern that first proposed this lock).
  perform pg_advisory_xact_lock(hashtextextended(NEW.owner_id::text, 0));

  select count(*) into v_active_count
    from characters
    where owner_id = NEW.owner_id and archived_at is null and id <> NEW.id;

  if v_active_count > 0 then
    -- Typed SQLSTATE (belt-and-suspenders with the message-substring match the client also checks —
    -- same layering this codebase's locked-history precedent uses, per a Groq cold review's suggestion
    -- to not rely on message wording alone). 'PACT1' is this codebase's first custom error code.
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

-- ---------------------------------------------------------------------------
-- 3. set_basic_mode(player) / unset_basic_mode(player) — the only write paths for
--    profiles.basic_mode and its audit columns (see the column-grant lockdown below: authenticated
--    gets NO plain UPDATE grant on profiles at all after this migration). Authority model per
--    decisions/2026/D-GH-2026-09-05-player-basic-mode.md (A3): a DM sharing a campaign with the
--    player may turn it ON; the player may ALWAYS turn their own OFF regardless of any DM's current
--    standing (the reversibility guarantee that decision exists to give); a DM sharing a campaign may
--    also turn it off, as a convenience, but is never the only path.
-- ---------------------------------------------------------------------------
create or replace function public.set_basic_mode(p_player uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not shares_campaign(p_player) then
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
  -- The player's own account is ALWAYS sufficient standing to turn their own flag off -- no DM
  -- check, no dependency on any DM's continued campaign membership. This is the whole point of A3.
  if v_target <> auth.uid() and not shares_campaign(v_target) then
    raise exception 'PACT: only the player themselves, or a DM sharing a campaign with them, can turn off basic mode';
  end if;
  -- Clear the audit columns too, not just the flag -- once off, there is nothing for the player to
  -- see (the columns exist only to answer "who flagged me and when"), and leaving a stale set_by/
  -- set_at around after an unset would misread as still-current.
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
-- 4. Column-grant lockdown on profiles. Before this migration, `grant ... update on public.profiles`
--    was blanket (no column scoping at all) — confirmed by search that nothing in the app actually
--    performs a client-side UPDATE on profiles today (js/auth.js's myProfile() only ever SELECTs), so
--    this grant was unused, not load-bearing. Revoking it outright (rather than column-scoping,
--    characters-table style) is what makes basic_mode/basic_mode_set_by/basic_mode_set_at genuinely
--    unwritable by a player except through the two SECURITY DEFINER functions above — closing the
--    audit-immutability gap a cold review raised (round 6, plan's Risks section). If a future
--    "edit display name" feature needs direct profile writes, add
--    `grant update (display_name) on public.profiles to authenticated;` then, scoped the same way
--    characters' own column grants already are — do not restore the blanket grant.
-- ---------------------------------------------------------------------------
revoke update on public.profiles from authenticated, anon;
