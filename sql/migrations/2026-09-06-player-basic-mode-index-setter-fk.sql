-- feat/player-basic-mode follow-up. The Supabase advisor, run immediately after applying
-- 2026-09-06-player-basic-mode.sql (per this project's per-change checklist), flagged
-- profiles_basic_mode_set_by_fkey as an unindexed foreign key (INFO level) -- the only genuinely NEW
-- finding that migration produced. Every other advisor line at the time (SECURITY DEFINER functions
-- callable by authenticated -- expected, matches every other intentionally-exposed RPC in this app;
-- auth_rls_initplan on profiles/characters/campaigns/ap_awards/etc; unused indexes;
-- character_backups' RLS-enabled-no-policy) is pre-existing and app-wide, not introduced by that
-- migration.
create index if not exists idx_profiles_basic_mode_set_by on public.profiles(basic_mode_set_by);
