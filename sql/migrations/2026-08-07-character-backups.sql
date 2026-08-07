-- PACT -- character_backups: an automatic pre-change snapshot of every character row.
-- Run ONCE in the Supabase SQL editor on an existing PACT database.
-- Idempotent: safe to re-run. Fresh installs get all this from schema.sql /
-- rls-policies.sql instead; this file only patches a DB created before this change.
--
-- WHY THIS EXISTS
-- js/sync.js deleteCharacter() issues a real `delete` -- archived_at (2026-07-25-character-archive)
-- is a separate, reversible action, and Delete is what's offered *after* archiving. Nothing
-- captured the row on the way out, so a deleted cloud character was gone permanently, with no
-- recovery path for anyone including the project owner. That is not hypothetical: it has already
-- cost one real player character (see DECISIONS.md D-GH-2026-08-07-character-backups).
--
-- The same gap covers overwrites, not just deletes: a bad sync push replacing `stats` with an older
-- or truncated LOG was equally unrecoverable (the class of bug fix/optimistic-character-save
-- guards against prospectively -- this recovers from it retrospectively).
--
-- SHAPE
-- A BEFORE UPDATE OR DELETE trigger writes the OLD (pre-change) row into character_backups. The
-- newest state always lives in `characters` itself, so it is never duplicated here.
--
-- ADMIN SURFACE: NONE. Same posture as `feedback` -- RLS on, no grant and no policy for
-- authenticated/anon, so the Supabase dashboard (service_role, which bypasses RLS) is the only
-- reader. Players cannot read, restore from, or even detect this table. Adding an in-app restore
-- UI would mean designing an admin role, which this project deliberately does not have.
--
-- DELIBERATELY NO FOREIGN KEYS. characters.owner_id is `on delete cascade` from profiles, and
-- ap_awards.character_id is `on delete cascade` from characters. A FK here would make the backups
-- die with the very row they exist to survive. character_id/owner_id/campaign_id are therefore
-- plain uuids -- deliberately un-referenced, and they stay valid for a restore precisely because
-- nothing cascades to them.

-- ===========================================================================
-- 1. character_backups table
-- ===========================================================================
create table if not exists public.character_backups (
  id                   uuid primary key default gen_random_uuid(),
  character_id         uuid not null,          -- NO fk: must outlive the character (see header)
  owner_id             uuid not null,          -- NO fk: must outlive the profile
  campaign_id          uuid,                   -- NO fk: records the binding at snapshot time
  name                 text not null,
  kind                 text not null,
  stats                jsonb not null,         -- the full { schema, rules, name, LOG, SEQ, id } envelope
  ap                   integer not null,
  archived_at          timestamptz,            -- the character's soft-delete state at snapshot time
  reason               text not null check (reason in ('update','delete')),
  character_updated_at timestamptz,            -- characters.updated_at of the snapshotted row
  -- clock_timestamp(), NOT now(): now() is transaction time, so several snapshots taken in one
  -- transaction would share an identical captured_at and the retention prune below would then fall
  -- back to ordering by a random uuid -- i.e. prune arbitrary rows rather than the oldest. Caught
  -- by the probe run when building this (three snapshots came back with the same timestamp).
  captured_at          timestamptz not null default clock_timestamp()
);

-- Covers both the retention prune and "show me this character's history, newest first".
create index if not exists idx_character_backups_char
  on public.character_backups(character_id, captured_at desc);
-- Covers "everything this player ever had", which is the query a restore starts from when the
-- character_id is no longer known (exactly the Fenwick case).
create index if not exists idx_character_backups_owner
  on public.character_backups(owner_id, captured_at desc);

-- ===========================================================================
-- 2. RLS -- enabled with NO policies and NO client grants
-- ===========================================================================
-- Enabling RLS without a single policy makes the table unreadable and unwritable by
-- authenticated/anon no matter what: with RLS on, absent a permissive policy, every row fails.
-- The grants below are the belt to that braces -- the client roles are never granted anything on
-- this table in the first place. service_role bypasses RLS by design and gets explicit grants
-- because rls-policies.sql's `grant ... on all tables` ran before this table existed and does not
-- apply retroactively.
alter table public.character_backups enable row level security;

revoke all on public.character_backups from authenticated, anon;
grant select, insert, update, delete on public.character_backups to service_role;

-- ===========================================================================
-- 3. The snapshot trigger
-- ===========================================================================
-- SECURITY DEFINER is required, not incidental: the trigger fires as the *player* (role
-- `authenticated`), which has no insert grant on character_backups. Without it, every save and
-- every delete would fail with "permission denied for table character_backups" -- i.e. a backup
-- system that bricks the app. Owned by postgres, so it also bypasses this table's RLS.
-- search_path is pinned per 2026-07-16-harden-search-path-pg-temp.sql.
create or replace function public.snapshot_character()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
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
    -- Nothing meaningful changed (e.g. a bare updated_at touch). Snapshotting these would burn
    -- the retention window on rows identical to their neighbours.
    return NEW;
  end if;

  insert into public.character_backups
    (character_id, owner_id, campaign_id, name, kind, stats, ap, archived_at, reason,
     character_updated_at)
  values
    (OLD.id, OLD.owner_id, OLD.campaign_id, OLD.name, OLD.kind, OLD.stats, OLD.ap, OLD.archived_at,
     v_reason, OLD.updated_at);

  -- Retention: keep the newest 50 'update' snapshots per character. 'delete' snapshots are NEVER
  -- pruned -- the irreversible event is the one worth keeping forever, and there is at most one
  -- per character lifetime. Pruning inline keeps this self-maintaining with no pg_cron dependency.
  if v_reason = 'update' then
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

drop trigger if exists trg_characters_snapshot on public.characters;
create trigger trg_characters_snapshot
  before update or delete on public.characters
  for each row execute function public.snapshot_character();

-- ===========================================================================
-- 4. Restoring (service_role / Supabase SQL editor only -- reference, not executed)
-- ===========================================================================
-- Find what a player has lost, when the character_id is no longer known:
--
--   select b.id, b.character_id, b.name, b.reason, b.captured_at, b.campaign_id
--     from character_backups b
--     join profiles p on p.id = b.owner_id
--    where p.display_name ilike '%<player>%'
--    order by b.captured_at desc;
--
-- Restore a deleted character under its ORIGINAL id (works only if nothing has reused it, which
-- nothing does -- ids are gen_random_uuid()). stats.id is rewritten to match so the envelope stays
-- self-consistent per D-GH40:
--
--   insert into characters (id, owner_id, campaign_id, name, kind, stats, ap, archived_at)
--   select b.character_id, b.owner_id, b.campaign_id, b.name, b.kind,
--          jsonb_set(b.stats, '{id}', to_jsonb(b.character_id::text)), b.ap, b.archived_at
--     from character_backups b
--    where b.id = '<backup row id>';
--
-- Roll a live character back to an earlier snapshot (leaves id/owner untouched):
--
--   update characters c
--      set stats = jsonb_set(b.stats, '{id}', to_jsonb(c.id::text)), name = b.name
--     from character_backups b
--    where b.id = '<backup row id>' and c.id = b.character_id;
--
-- Note the restore itself trips the trigger, so the pre-restore state is snapshotted too -- an
-- unwanted restore is itself undoable.
