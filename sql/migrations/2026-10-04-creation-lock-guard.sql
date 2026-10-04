-- PACT — creation-lock guard (D1), campaign moves keep the lock (L1), keep every backup of campaign
-- characters (S1). docs/plans/2026-10-01-creation-lock-integrity.md, Part 2.
-- Decision: D-GH-2026-10-01-creation-lock-integrity (+ its 2026-10-04 addendum).
--
-- WHY. Between 26 Aug and 3 Oct, Amble characters lost their finished-creation lock six times, by two
-- unrelated client bugs: CharGen's boot rebuilt the LOG from the form (fixed in #553), and a stale local
-- autosave was pushed over a newer cloud save (still open). The server accepted every one of those saves,
-- because nothing protects the creation-lock events: pact_ap_ledger_protected() covers awards, buys,
-- buyoffs, names, seals and DM removals, not creationLocked / creationUnlocked / creationLockConfig.
-- A server rule catches every client path at once, including ones not found yet.
--
-- THE RULE (campaign characters only — a character with no campaign has no DM, so its owner decides):
--   1. Lock-family events are APPEND-ONLY. The OLD list (creationLocked, creationUnlocked,
--      creationLockConfig — bookkeeping keys stripped) must be a prefix of the NEW list.
--   2. A player may APPEND only:
--        - creationLocked                     ("Finish creating")
--        - creationLockConfig with no threshold key   (CharGen/Live Sheet arming the lock)
--      Never creationUnlocked, and never a ceiling (threshold) — those are DM actions.
--   3. A campaign DM (is_campaign_dm on the old or new campaign) may do anything; the DM RPCs
--      dm_reopen_creation() / dm_set_creation_ceiling() append through this path.
--   4. A direct database session (no API JWT claims at all — the SQL editor, a migration, an admin
--      repair) is not checked. Every browser request through PostgREST carries claims, anon included,
--      so this does not open a path for any client. (Review finding M2: auth.uid() IS NULL alone would
--      also match anon.)
--   5. When campaign_id changes in the same update, the system's own threshold-null config appended by
--      pact_campaign_move_clears_creation() (which fires first — triggers run alphabetically) is allowed.
--
-- The refusal message contains "locked character history" on purpose: js/sync.js already maps that
-- phrase to its reload/recovery path, so a refused stale save surfaces with the existing UX.
--
-- NOT COVERED HERE (logged as follow-ups): moving a post-lock purchase to before the lock (review H3) —
-- the existing pact_enforce_locked_history() already freezes the prefix up to the last award/seal;
-- extending that freeze to the last creationLocked is a separate change.

-- ===========================================================================================
-- D1 — the guard
-- ===========================================================================================
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

-- ===========================================================================================
-- L1 — a campaign move never reopens creation (replaces the 2026-09-01 "locks go" half).
-- The ceiling-clearing half is kept unchanged: a figure one DM chose must not govern another table.
-- ===========================================================================================
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

-- ===========================================================================================
-- S1 — never prune backups of a campaign character (the 50-snapshot window lost Archer's history).
-- Identical to the live snapshot_character() except the retention condition.
-- ===========================================================================================
create or replace function public.snapshot_character()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_reason text;
begin
  if TG_OP = 'DELETE' then
    v_reason := 'delete';
  elsif OLD.stats       is distinct from NEW.stats
     or OLD.name        is distinct from NEW.name
     or OLD.kind        is distinct from NEW.kind
     or OLD.ap          is distinct from NEW.ap
     or OLD.campaign_id is distinct from NEW.campaign_id
     or OLD.archived_at is distinct from NEW.archived_at then
    v_reason := 'update';
  else
    return NEW;
  end if;

  insert into public.character_backups
    (character_id, owner_id, campaign_id, name, kind, stats, ap, archived_at, reason,
     character_updated_at)
  values
    (OLD.id, OLD.owner_id, OLD.campaign_id, OLD.name, OLD.kind, OLD.stats, OLD.ap, OLD.archived_at,
     v_reason, OLD.updated_at);

  -- Retention: newest 50 'update' snapshots per character — EXCEPT a campaign character (before or
  -- after this update), whose full history is kept for troubleshooting (S1, 2026-10-04).
  if v_reason = 'update' and OLD.campaign_id is null and NEW.campaign_id is null then
    delete from public.character_backups b
     where b.character_id = OLD.id
       and b.reason = 'update'
       and b.id not in (
         select id from public.character_backups
          where character_id = OLD.id and reason = 'update'
          order by captured_at desc, id desc
          limit 50
       );
  end if;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;
revoke execute on function public.snapshot_character() from public, authenticated, anon;
