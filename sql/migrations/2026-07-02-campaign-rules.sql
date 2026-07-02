-- Feature: DM campaign rules — configure and enforce
-- Apply to the live Supabase project via the SQL editor.
--
-- Adds a DM-authoritative `rules` column to campaigns holding banned
-- species/masteries/boons/origin classes/origin species, a multi-discipline
-- toggle, and freeform house-rule toggles. See DECISIONS.md D-GH14.
--
-- No RLS change needed: campaigns has no column-level UPDATE grant (the
-- blanket `grant ... update on public.campaigns to authenticated` in
-- rls-policies.sql covers every column), and the existing campaigns_update
-- row policy already restricts writes to is_campaign_dm(id). Players can
-- SELECT the new column (read-only) via the existing campaigns_select policy.

alter table public.campaigns
  add column if not exists rules jsonb not null default '{}'::jsonb;
