# Creation-lock guard — Docker test

Tests `sql/migrations/2026-10-04-creation-lock-guard.sql` (D1 server guard, L1 campaign move keeps the lock,
S1 keep every campaign backup) on a **throwaway Postgres in Docker**. No real database is touched.
Decision: `D-GH-2026-10-01-creation-lock-integrity`. Run: `./run.sh` (needs Docker only).

| File | What |
|---|---|
| `base.sql` | stand-ins for Supabase (`auth.uid()`, roles, tables) + the live function text the guard sits beside (`pact_enforce_locked_history`, `is_campaign_dm`, pre-guard `snapshot_character` / `pact_campaign_move_clears_creation`) |
| `triggers.sql` | the live triggers in play (alphabetical order decides firing order) |
| `guard-cases.sql` | 22 cases: run **before** (the attacks must succeed) and **after** (all must PASS) |
| `dm-rpcs.sql`, `dm-rpc-cases.sql` | the live `dm_reopen_creation()` / `dm_set_creation_ceiling()` still work with the guard on |
| `move-and-backups.sql` | L1 (a move keeps the lock) and S1 (campaign character keeps all backups; solo is pruned to 50) |

**Limits.** `base.sql` is a snapshot of live definitions taken 2026-10-04 and is NOT the whole schema: it omits
RLS, `pact_enforce_ap_budget_consistency`, `pact_enforce_player_ap_ceiling`, `pact_enforce_basic_mode`, and
real Supabase Auth (claims are faked with `request.jwt.claims`). Refresh it when those functions change. The
real fix for that gap is bringing `sql/schema.sql` + `rls-policies.sql` up to date so CI's `cloud-e2e` can
test it (the restart note's option T3).
