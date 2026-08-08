-- PACT -- characters.autosave_enabled: a universal, owner-reversible cloud-autosave toggle.
-- Run ONCE in the Supabase SQL editor on an existing PACT database.
-- Idempotent: safe to re-run. Fresh installs get this from schema.sql / rls-policies.sql instead;
-- this file only patches a DB created before this change.
--
-- WHY THIS EXISTS
-- Part B3 of docs/plans/2026-08-08-shared-sync-chip-part-b.md makes cloud autosave universal --
-- every character, campaign-bound or not. The design that shipped is NOT the plan's original v1/v2
-- (a one-way "consent" timestamp, with campaign-bound characters kept on a separate always-on
-- no-toggle path); the owner asked directly for one uniform, freely-reversible toggle covering every
-- character, including campaign-bound ones. See decisions/2026/D-GH-2026-08-08-universal-autosave-
-- toggle.md for the full record, including the accepted consequence: a player CAN switch autosave off
-- on a DM's campaign character, and the DM's roster can go stale until that player saves again
-- manually -- the exact problem campaign-bound autosave was built in 2026-08-03 to prevent, taken on
-- knowingly here, not overlooked.
--
-- SHAPE
-- One boolean column, default true for every character (existing and new). Not retroactive
-- enrollment in the sense a one-way consent flag would be: the toggle is immediately visible and
-- immediately reversible in the UI, so "on by default" is closer to "shipping a new, on-by-default
-- feature" than "silently opting someone into something hidden."
--
-- Owner-only column grant under the EXISTING characters_update row policy (owner_id = auth.uid() in
-- both USING and WITH CHECK) -- same reasoning as archived_at's grant just above it in
-- rls-policies.sql. No new RPC and no SECURITY DEFINER function: unlike award_ap() (where the writer,
-- a DM, is never the row's owner), the writer here is always the row's own owner, so the existing
-- owner-only policy already scopes this correctly.

-- ===========================================================================
-- 1. characters.autosave_enabled
-- ===========================================================================
alter table public.characters
  add column if not exists autosave_enabled boolean not null default true;

-- ===========================================================================
-- 2. Column grants (mirrors archived_at's UPDATE grant immediately above it in rls-policies.sql)
-- ===========================================================================
grant update (autosave_enabled) on public.characters to authenticated;

-- Also added to the INSERT grant (unlike ap/campaign_id, which stay excluded) -- without this, a
-- toggle preference set locally before a character's first-ever cloud save would be silently
-- discarded: pushCharacter()'s insert would fall back to the column's own `true` default instead of
-- carrying forward the local `false` the player had already chosen. GRANT is additive, so this only
-- ADDS autosave_enabled to the existing insert grant -- it does not need to restate id/owner_id/
-- name/kind/stats, which schema.sql's fresh-install grant already covers.
grant insert (autosave_enabled) on public.characters to authenticated;

-- No RLS policy change needed: characters_update's / characters_insert's existing owner-only
-- USING/WITH CHECK already cover this column, same as archived_at.

-- No character_backups trigger change: public.snapshot_character()'s distinct-check list
-- (stats/name/kind/ap/campaign_id/archived_at) deliberately does NOT include autosave_enabled --
-- toggling a display preference isn't game data worth a retention slot, same treatment a bare
-- updated_at touch already gets ("not worth a retention slot").
