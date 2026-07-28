# D-GH-2026-07-16-harden-search-path-pg-temp — pg_temp on all 16 SECURITY DEFINER functions

Status: Active

- **Context:** every `SECURITY DEFINER` function in `sql/schema.sql`/`sql/rls-policies.sql` sets
  `search_path = public` without also listing `pg_temp` — the classic gap that lets an unprivileged
  caller create a same-named session-local temp table/function that resolves ahead of the intended
  `public` one inside a `SECURITY DEFINER` context, a real privilege-escalation vector in general.
- **Options:** (1) fix piecemeal, only when touching a given function for other reasons. (2) fix all 16
  in one repo-wide pass now.
- **Decision:** (2). Changed all 16 instances from `search_path = public` to `search_path = public,
  pg_temp` — 11 in `sql/schema.sql`, 5 in `sql/rls-policies.sql`. Applied live via `ALTER FUNCTION ...
  SET search_path = public, pg_temp` for each (not a full `create or replace function` body
  redeclaration) specifically to avoid the schema.sql-vs-migration drift risk `/code-review` just found
  and fixed in `D-GH-2026-07-16-campaign-invite-search-path` — `ALTER FUNCTION` only touches the
  `proconfig` search_path, leaving each function's actual body (and any independent drift risk in it)
  untouched.
- **Why:** a partial fix across only some functions would be worse than no fix — it creates the false
  impression the class of bug is closed repo-wide when it isn't, and the next engineer copying an
  as-yet-unfixed function as a template would propagate the gap. Low real-world exploitability today
  (Supabase/PostgREST clients have no raw-SQL/DDL path to create a temp table ahead of an RPC call), but
  closing all 16 consistently is a single cheap pass, not something to defer function-by-function.
- **Verification:** applied as migration `2026-07-16-harden-search-path-pg-temp.sql` against the live
  project. Queried `pg_proc.proconfig` for all 16 `SECURITY DEFINER` functions in `public` — all show
  `search_path=public, pg_temp`. Re-ran `gen_invite_code()` and `is_campaign_dm()` (a representative
  plpgsql and a representative sql-language function) to confirm they still resolve correctly. Re-ran the
  Supabase security advisor — identical warning set to before (all pre-existing/already-accepted), no new
  findings. `testing/tests/engine-parity.html` (headless) still 20/0.
- **Status:** Active.
