-- Harden every SECURITY DEFINER function's search_path against session-local temp-table
-- shadowing: `set search_path = public` alone doesn't also list `pg_temp`, which is the classic
-- gap that lets an unprivileged caller create a same-named temp table/function that gets
-- resolved ahead of the intended public one inside a SECURITY DEFINER context. Low real-world
-- exploitability today (Supabase/PostgREST clients have no raw-SQL/DDL path to create a temp
-- table before calling an RPC), but closing it repeatedly-verified-safe is cheap and repo-wide
-- rather than piecemeal. See docs/TASK_BOARD.md "Harden search_path on SECURITY DEFINER
-- functions against temp-table shadowing" and DECISIONS.md
-- D-GH-2026-07-16-harden-search-path-pg-temp.
--
-- Uses ALTER FUNCTION rather than re-declaring each function body (avoids the schema.sql-vs-
-- migration drift risk found in D-GH-2026-07-16-campaign-invite-search-path).

alter function public.add_owner_as_dm() set search_path = public, pg_temp;
alter function public.award_ap(p_character uuid, p_amount integer, p_note text) set search_path = public, pg_temp;
alter function public.bind_character_to_campaign(p_character_id uuid, p_code text) set search_path = public, pg_temp;
alter function public.create_player_invite(p_campaign_id uuid, p_starting_ap integer, p_starting_budget integer) set search_path = public, pg_temp;
alter function public.handle_new_user() set search_path = public, pg_temp;
alter function public.is_campaign_dm(p_campaign uuid) set search_path = public, pg_temp;
alter function public.is_campaign_member(p_campaign uuid) set search_path = public, pg_temp;
alter function public.is_campaign_owner(p_campaign uuid) set search_path = public, pg_temp;
alter function public.join_as_dm(p_code text) set search_path = public, pg_temp;
alter function public.join_campaign(p_code text) set search_path = public, pg_temp;
alter function public.promote_to_dm(p_campaign uuid, p_profile uuid) set search_path = public, pg_temp;
alter function public.redeem_player_invite(p_token text, p_name text) set search_path = public, pg_temp;
alter function public.regenerate_dm_invite_code(p_campaign uuid) set search_path = public, pg_temp;
alter function public.regenerate_invite_code(p_campaign uuid) set search_path = public, pg_temp;
alter function public.remove_dm(p_campaign uuid, p_profile uuid) set search_path = public, pg_temp;
alter function public.shares_campaign(p_other uuid) set search_path = public, pg_temp;
