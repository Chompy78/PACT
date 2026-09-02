-- PACT — trigger functions should not be callable as RPCs.
-- Applied to production 2026-09-01 (migration `revoke_execute_on_trigger_functions`); written to a
-- file afterwards because a code review pointed out the live grant state would otherwise not be
-- reproducible from `sql/` alone.
--
-- Both are BEFORE UPDATE trigger functions on public.characters. Calling one directly through
-- PostgREST does nothing useful — a trigger function invoked outside a trigger errors immediately —
-- so this is tidiness rather than a live exposure. They were the only two entries in the Supabase
-- advisor's "signed-in users can execute SECURITY DEFINER function" list with no business being
-- callable at all, unlike award_ap() and friends where being callable IS the point.
--
-- REVOKING EXECUTE DOES NOT STOP A TRIGGER FIRING. A trigger runs as part of the statement that fired
-- it, not as a call the client makes, so the caller's EXECUTE privilege is never consulted. Verified
-- before applying, on a throwaway Postgres 16: after revoking from both `authenticated` and PUBLIC the
-- trigger still rejected the update it was written to reject, and a legitimate update still succeeded.

revoke execute on function public.pact_enforce_locked_history()        from authenticated;
revoke execute on function public.pact_enforce_locked_history()        from public;
revoke execute on function public.pact_enforce_ap_budget_consistency() from authenticated;
revoke execute on function public.pact_enforce_ap_budget_consistency() from public;
