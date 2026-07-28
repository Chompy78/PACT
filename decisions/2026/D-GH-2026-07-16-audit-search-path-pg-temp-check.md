# D-GH-2026-07-16-audit-search-path-pg-temp-check — a static check + a dormant CI trigger gap

Status: Active

- **Context:** `/code-review` on the `pg_temp` hardening PR flagged that the fix was purely retroactive
  — nothing in CI would catch a future `SECURITY DEFINER` function missing `pg_temp`.
- **Options:** (1) a new, separate CI workflow/script just for this one check. (2) add a check function
  to the existing `testing/scripts/audit.py` (AUD-1's general static health check, already wired into
  `static-audit.yml`).
- **Decision:** (2). One new function, `check_sql_security_definer_search_path()`, added alongside
  `audit.py`'s existing checks and called from `main()`.
- **Why:** `audit.py` is already the repo's one place for "is the system still healthy?" static checks,
  stdlib-only, seconds to run, already CI-wired — a second parallel script/workflow for one more grep-
  shaped check would just duplicate that infrastructure.
- **A real gap found along the way:** `static-audit.yml`'s trigger `paths:` list never included
  `sql/schema.sql` or `sql/rls-policies.sql` — meaning the entire static-audit workflow (not just this
  new check) has never actually run on any PR that only touches SQL files, including both of today's
  earlier `sql/` PRs in this session. Fixed by adding both files to the trigger list.
- **A false-positive caught before landing:** the check's first draft matched `"security definer"`
  anywhere in a line, which also matched `-- ... SECURITY DEFINER ...` doc comments (e.g.
  `sql/rls-policies.sql`'s section-header comments), producing 9 false FAILs with no real function
  behind them. Fixed by skipping lines starting with `--` before the substring check.
- **Verification:** ran clean (27 passed / 0 failed) against current state; reverted one function's
  `pg_temp` clause to confirm the check actually fails (`sql/schema.sql:88 — search_path = public
  (missing pg_temp)`), then restored it and re-confirmed clean.
- **Status:** Active.
