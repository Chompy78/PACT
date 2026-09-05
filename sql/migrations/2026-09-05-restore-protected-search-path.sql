-- ---------------------------------------------------------------------------
-- Restore the pinned search_path on pact_ap_ledger_protected().
--
-- WHAT WAS LOST. Three consecutive definitions of this function declared
-- `set search_path = public, pg_temp`:
--
--     2026-08-10-campaign-ap-log-integrity.sql:122
--     2026-09-01-session-seal.sql:57
--     2026-09-01-session-seal-rollback.sql:21
--
-- 2026-09-02-widen-protected-projection.sql rewrote the function to widen its projection — a correct
-- change — and dropped the SET clause while retyping the signature. cb323ca then copied that weaker
-- form into sql/rls-policies.sql, the maintained fresh-install path, so every database built the
-- documented way inherited it. This restores the clause in both places. The body is unchanged, byte
-- for byte, from the 2026-09-02 version; only the SET clause is added.
--
-- WHAT THE ACTUAL RISK IS, stated honestly rather than inflated. This function is NOT security
-- definer (pg_proc.prosecdef = false) — it runs as its caller, so hijacking its name resolution wins
-- an attacker nothing they could not already do. In normal operation it is reached from
-- pact_enforce_locked_history(), which IS security definer and DOES pin its own search_path, so the
-- pinned path is already in force before this function is entered. There is no known live escalation
-- path today.
--
-- It is fixed anyway, for four reasons that outlive today's call graph:
--   1. 2026-07-16-harden-search-path-pg-temp.sql made pinning a project-wide rule. One function
--      silently stopped following it. A rule with an unexplained exception is not a rule.
--   2. The current safety is a property of HOW IT HAPPENS TO BE CALLED, not of the function. Callers
--      change; the next one may not pin. Safe-by-construction beats safe-by-accident.
--   3. It went into the fresh-install baseline, so every new database inherits the weaker form.
--   4. Supabase's advisor reports function_search_path_mutable on it every run. PR #503's body waved
--      that off as pre-existing. A permanently-ignored advisor warning is how the dangerous one gets
--      missed.
--
-- WHY THE GUARD DID NOT CATCH IT. testing/sql/rls-baseline-test.sql compared normalised prosrc, and
-- search_path lives in proconfig, not the body — so the baseline and the migrations could disagree on
-- it while the guard printed "define the SAME logic". Proven by injecting the divergence deliberately
-- and watching it pass. Fixed in #505 (D-GH-2026-09-03-code-review-503-followups); this migration
-- lands with the companion POSITIVE check that guard still lacked: every function in the checked set
-- must actually HAVE a pinned search_path, not merely agree across both sources. That assertion was
-- deliberately held back until now because adding it before this fix would have put CI red on preview
-- for a defect that branch did not own.
--
-- BLAST RADIUS: none. No body change, no projection change, no grant change — a name-resolution SET
-- clause only. Existing rows, triggers and policies are untouched, and the function returns identical
-- output for identical input.
-- ---------------------------------------------------------------------------
create or replace function public.pact_ap_ledger_protected(p_log jsonb)
returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg((ev - 'seq' - 'ts' - 'rules' - 'label') order by ord), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_log,'[]'::jsonb)) with ordinality as t(ev, ord)
  where (ev->>'type') in ('buyoff','names','award','sessionSeal','dmRemoveBoon')
     or ((ev->>'type') = 'buy' and coalesce(ev->>'cat','') <> 'patch');
$$;

-- Not an RPC. Same reasoning as 2026-09-01-revoke-trigger-function-execute.sql: a helper reachable at
-- /rest/v1/rpc is API surface nobody designed. Re-stated because `create or replace` above does not
-- alter grants, and restating them keeps the grant state reproducible from sql/ alone.
revoke execute on function public.pact_ap_ledger_protected(jsonb) from public, anon, authenticated;
