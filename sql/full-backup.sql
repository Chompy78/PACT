-- ---------------------------------------------------------------------------
-- full-backup.sql — take a complete, off-site copy of the cloud data.
--
-- WHO RUNS THIS: whoever holds the Supabase dashboard login. Nobody else can —
-- and that is the design, not a limitation. `characters_select` grants a client
-- `owner_id = auth.uid() or is_campaign_dm(campaign_id)`, so even an account that
-- DMs every campaign reads only its own characters plus its players' — as of
-- 2026-08-07, 6 of 15. There is no client route to "everything", because this
-- project deliberately has no admin role (see rls-policies.sql's character_backups
-- block and schema.sql's "No role column" note). service_role, reached from the
-- dashboard, is the admin surface. Full reasoning, including the rejected
-- alternative of inventing an admin role: DECISIONS.md
-- D-GH-2026-08-07-character-backups.
--
-- WHEN TO RUN IT: before a migration that rewrites `stats`, before a bulk change,
-- and periodically as disaster cover. This is the whole-database copy; individual
-- players keep their own via "Export backup" on My Characters, and every
-- individual change is already snapshotted server-side into character_backups.
-- The three do different jobs — see the decision record.
--
-- HOW TO RUN IT: Supabase dashboard → SQL Editor → paste ONE of the queries below
-- → Run → download/copy the result. Do not run these from the app; the anon key
-- cannot see the rows and should never be able to.
--
--   Query A (recommended) — one row per character, downloads cleanly as CSV, and
--   each `envelope` cell is a complete pact-character/1 document that CharGen or
--   the Live Sheet will Load as-is. Best for restoring one lost character.
--
--   Query B — everything as a single JSON document, including campaigns, profiles,
--   DM assignments, invites and AP awards. Best as the archival copy. Save the one
--   returned cell as a .json file.
--
-- WHAT THE OUTPUT CONTAINS: every player's character data and their email
-- addresses. Treat it as personal data — store it somewhere private, and NEVER
-- commit it to this repo. `.gitignore` does not cover it; nothing stops you.
--
-- WHAT IT DELIBERATELY OMITS: character_backups, the per-change snapshot history.
-- It is large, it is already redundant with the live rows for disaster purposes,
-- and it stays server-side by design. To recover a specific overwritten or deleted
-- character, use the restore recipes in
-- sql/migrations/2026-08-07-character-backups.sql (see its "Restore a deleted
-- character under its ORIGINAL id" section) rather than this file.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- QUERY A — one row per character. Download as CSV.
--
-- `has_envelope = false` means the row exists but was never saved from a tool
-- (a redeemed invite nobody opened): there is nothing to restore from, and it is
-- listed rather than hidden so the count is honest.
-- ---------------------------------------------------------------------------
select c.id                                   as character_id,
       c.name                                 as character_name,
       u.email                                as owner_email,
       c.owner_id,
       c.kind,                                          -- which tool it opens in
       camp.name                              as campaign_name,
       c.campaign_id,
       c.ap,                                            -- DM-awarded, server-authoritative
       c.archived_at,
       c.updated_at,
       (c.stats ? 'LOG')                      as has_envelope,
       c.stats                                as envelope   -- a pact-character/1 document
  from public.characters c
  left join auth.users       u    on u.id  = c.owner_id
  left join public.campaigns camp on camp.id = c.campaign_id
 order by u.email nulls last, c.name;


-- ---------------------------------------------------------------------------
-- QUERY B — the whole thing as one JSON document. Save the single returned cell
-- as pact-cloud-backup-<yyyy-mm-dd>.json.
--
-- Mirrors the shape used for the first off-site copy taken on 2026-08-07, so
-- successive backups diff against each other cleanly.
-- ---------------------------------------------------------------------------
select jsonb_build_object(
  'schema',      'pact-cloud-backup/1',
  'captured_at', now(),
  'note',        'Current state only. Per-change snapshot history lives server-side in '
                 || 'character_backups and is deliberately excluded — see sql/full-backup.sql.',
  'counts', jsonb_build_object(
     'characters',                    (select count(*) from public.characters),
     'campaigns',                     (select count(*) from public.campaigns),
     'profiles',                      (select count(*) from public.profiles),
     'ap_awards',                     (select count(*) from public.ap_awards),
     'campaign_invites',              (select count(*) from public.campaign_invites),
     'character_backups_server_side', (select count(*) from public.character_backups)),
  'profiles',         (select coalesce(jsonb_agg(to_jsonb(p)),  '[]'::jsonb) from public.profiles p),
  'campaigns',        (select coalesce(jsonb_agg(to_jsonb(c)),  '[]'::jsonb) from public.campaigns c),
  'campaign_dms',     (select coalesce(jsonb_agg(to_jsonb(d)),  '[]'::jsonb) from public.campaign_dms d),
  'campaign_invites', (select coalesce(jsonb_agg(to_jsonb(i)),  '[]'::jsonb) from public.campaign_invites i),
  'characters',       (select coalesce(jsonb_agg(to_jsonb(ch)), '[]'::jsonb) from public.characters ch),
  'ap_awards',        (select coalesce(jsonb_agg(to_jsonb(a)),  '[]'::jsonb) from public.ap_awards a)
)::text as bundle;
