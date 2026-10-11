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

## Server freeze, stage 1 (D2 + E1) — added 2026-10-05

`sql/migrations/2026-10-05-server-freeze-d2-e1-stage1.sql` (+ `-rollback.sql`), plan `docs/plans/2026-10-04-server-freeze-d2-e1.md`. **Applied to the live database on 2026-10-10** (merging the file did not apply it; the apply was a separate owner-approved step).

| File | What |
|---|---|
| `freeze-live-defs.sql` | `pact_ap_ledger_protected()` and `pact_enforce_locked_history()` exactly as LIVE on 2026-10-04 (`pg_get_functiondef`); loaded after `base.sql`, whose older copy predates `dmUnlockDrawback` |
| `freeze-cases.sql` | 61 cases: attacks (refused after), legitimate saves (allowed), the lock lifecycle (reopen, re-lock, seal), solo/unlocked characters, and **one case per patch key** including an unknown future key (fail-closed) |
| `run-freeze.sh` | `BEFORE` (36 attacks work today) → apply → `AFTER` (all 61 pass) → rollback (byte-identical definitions) → attacks work again. In CI as the `freeze-rehearsal` job |
| `backup-replay-audit.mjs` | replays every real old→new save from `character_backups` through the OLD then the NEW rule; lists the saves only the new rule refuses |
| `roundtrip-audit.mjs` | loads every live character in the real CharGen and Live Sheet, autosaves, and checks the frozen part of the history is untouched (`--force-end` stress mode, `--synthetic` Live-Sheet-origin variants) |

Both audits take an export of live rows (made with a read-only query) and **must not be committed** — it holds real player data.

**When the migration is applied to live:** (1) add it to the `\ir` lists in `testing/sql/session-seal-test.sql` and `testing/sql/rls-baseline-test.sql`; (2) fold the two changed functions and the three helpers into `sql/rls-policies.sql`, so a fresh install matches production and
re-running the baseline file can never revert the freeze; (3) run the Supabase advisors. Until then the baseline correctly describes production.


## Stage 2 — added 2026-10-11 (NOT applied to the live database)

`sql/migrations/2026-10-11-server-freeze-stage2.sql` (+ `-rollback.sql`) empties the stage-1 TEMPORARY exempt list, so spellcasting, innate spells, martial binding, dabbler cantrips, origin classes, size and lineage become protected like every other priced patch field (only appearance, houseRules and gold stay editable). `run-freeze.sh` now rehearses it after stage 1: `freeze-cases.sql` takes `-v tmpexp=refused` (the default `allowed` is the stage-1 expectation), all 61 cases must pass at stage 2, and the stage-2 rollback must restore the stage-1 list exactly.

Before applying to live, re-run both audits against a FRESH read-only export with the new flag: `backup-replay-audit.mjs <export.json> --stage2` lists every real saved pair that stage 2 would refuse but stage 1 (live today) allows — each must be a rewrite the current tools no longer make — and `roundtrip-audit.mjs <export.json> --stage2 --campaign-all` loads every live character in both tools and checks nothing in the stage-2-protected part of the history moves. Apply only after both come back clean.
