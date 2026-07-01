-- PACT — drop legacy award_xp, lock down anon EXECUTE on award_ap
--
-- Supabase's security advisor flagged both award_xp and award_ap as callable by the
-- `anon` (unauthenticated) role via /rest/v1/rpc/*. Investigation:
--   * award_xp is dead code — superseded by award_ap in the XP -> AP rename, zero
--     references remain in js/ or sql/. Dropped outright.
--   * award_ap is live and correctly guarded internally (raises unless
--     is_campaign_dm() passes, which requires auth.uid() to match a real DM row —
--     anon's auth.uid() is null, so no actual bypass exists), but it never had its
--     default Postgres EXECUTE-to-PUBLIC grant revoked. The grant now matches
--     intent (authenticated only) instead of relying solely on the internal check.

drop function if exists public.award_xp(uuid, integer);

revoke execute on function public.award_ap(uuid, integer, text) from public;
