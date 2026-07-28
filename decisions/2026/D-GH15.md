# D-GH15 — Function EXECUTE grants: explicit `authenticated`, not implicit `PUBLIC`

Status: Active

- **Context:** Supabase's security advisor (run via the newly-connected Supabase MCP) flagged `award_ap`
  and the now-dropped `award_xp` as callable by the unauthenticated `anon` role via `/rest/v1/rpc/*`.
  Investigation showed this wasn't specific to those two functions: every `SECURITY DEFINER` function in
  the schema still carried Postgres's default EXECUTE-to-`PUBLIC` grant, which none of the migrations had
  ever explicitly revoked — confirmed live via `has_function_privilege('anon', ..., 'EXECUTE')` returning
  `true` across the board. `award_ap` itself was never actually exploitable (its `is_campaign_dm()` guard
  rejects any caller without a real `auth.uid()` match, and `anon` has zero table-level grants anywhere in
  the schema), but the grant not matching intent is exactly the kind of drift that turns into a real bug
  later if an internal guard is ever refactored without someone re-checking the grant surface.
- **Options:** (i) leave it — internal guards already prevent exploitation; (ii) **revoke the default
  `PUBLIC` grant on `award_ap`, matching the explicit `authenticated` grant it already has** (this
  decision's scope); (iii) do the same across all ~12 flagged functions in one pass, including the
  RLS-helper predicates (`is_campaign_dm`, `is_campaign_member`, etc.) that have no explicit grant at all
  today and rely solely on `PUBLIC` for `authenticated` to work.
- **Decision:** (ii) for now — `award_ap`'s `PUBLIC` grant revoked, `award_xp` dropped outright (dead code
  from the XP → AP rename, zero references in `js/` or `sql/`). (iii) was investigated and confirmed safe
  (verified `anon` has no SELECT/INSERT/UPDATE/DELETE on any table, and every client-facing RPC call in
  `js/` maps only to functions that already have an explicit `authenticated` grant) but deliberately not
  applied in the same pass — it touches ~12 functions across the schema, which is a larger blast radius
  than what was being discussed when the fix was requested. Left as a scoped, ready-to-apply follow-up.
- **Why:** a `SECURITY DEFINER` function's grant should express who is *meant* to call it, not rely purely
  on internal logic to reject the rest — the internal guard and the grant are two independent layers, and
  this project has already been burned once (REV-04, D-GH12) by a case where only one of those layers was
  actually enforcing the boundary.
- **Status:** IN FORCE as of 2026-07-02 for `award_ap`/`award_xp`. The broader ~12-function grant cleanup
  is scoped and safe but NOT yet applied — pending a separate explicit go-ahead.
- **Addendum (2026-07-10):** the broader cleanup landed — `sql/migrations/2026-07-10-lock-down-remaining-
  function-grants.sql`, mirrored into `sql/rls-policies.sql`. One nuance the original plan's "Done when"
  wording glossed over: for the three trigger-only functions (`handle_new_user`, `add_owner_as_dm`,
  `set_updated_at`), revoking the `PUBLIC` grant with no replacement leaves `authenticated_can_execute`
  `false` too, not just `anon`'s — verified live post-migration. That's correct and intended (Postgres
  rejects any direct `/rest/v1/rpc/*` call to a `returns trigger` function regardless of grant, so no role
  ever needed explicit EXECUTE on these), it just doesn't match a literal "authenticated_can_execute=true
  for all ~13" reading of the done-when criteria — noting it here so a future agent checking grants doesn't
  mistake it for a regression. All 11 non-trigger functions show `anon=false` / `authenticated=true` as
  planned; `get_advisors` post-migration shows no new findings (remaining WARNs are pre-existing and
  out of scope: `authenticated`-callable `SECURITY DEFINER` functions, which is intentional for RPCs meant
  to be called by signed-in users, and unrelated leaked-password-protection). Also skimmed `get_logs`
  (postgres service) post-migration per the AGENTS.md per-change checklist — only the expected
  `apply_migration` statement and routine connection/checkpoint lines, no errors.

---
