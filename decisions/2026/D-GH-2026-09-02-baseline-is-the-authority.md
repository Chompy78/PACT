# D-GH-2026-09-02-baseline-is-the-authority — `sql/rls-policies.sql`, not the dated migrations, is the current definition of the security functions

Status: Active

> **Provenance.** Written 2026-10-22 from commit `cb323ca` (shipped in PR #503, the `preview` → `main` promotion for build `v1.503`): its message, its diff, and `sql/migrations/README.md`. It was not written by the commit's author on the day, so it records only what those sources state. Nothing here is a new decision; the missing record was flagged on the board as `docs/decisions-for-2026-09-02-sql-commits`.

- **Context:** `sql/rls-policies.sql` calls itself the fresh-install path (`schema.sql`, then this file) and declares itself safe to re-run. Neither claim held. It had fallen three migrations behind, so:
  - a database built that way had **no seal functions at all** (`seal_character_history` and `award_ap_and_seal` were absent), so the tools' seal button would have failed on every press and nothing would have enforced a seal that somehow landed;
  - re-running it against production would have **reverted `pact_enforce_locked_history` to the award-only 2026-08-10 version** and **re-granted EXECUTE** that `2026-09-01-revoke-trigger-function-execute.sql` had removed. That migration's own header claimed the grant state was "reproducible from sql/ alone".

  The same day, `2026-09-01-session-seal.sql` had rebuilt `dm_edit_character_log()` from the 2026-08-10 file because its header said "every other line is unchanged" — true, and the defect, since 2026-08-10 was no longer the live definition. Two later protections (`assert_campaign_active()` and the boon/award amount check) were lost for about eleven hours. That incident is why the rule below exists.

- **Options:**
  1. *Leave the baseline as it was and tell people to build from the migrations.* Rejected: rebuilding a function from the migration that first created it silently reverts every change made since — the failure that had just happened.
  2. *Fold the current live definitions into the baseline, keep it as the documented fresh-install path, and guard it so it cannot fall behind again.* **Chosen.**

- **Decision:**
  - The baseline now carries the live `dm_edit_character_log` (archived-campaign guard, boon/award amount check), the widened protected projection (including `dmRemoveBoon`), the amended locked-history trigger (species freeze, stats ratchet), **both** seal RPCs, and EXECUTE grants matching live. Three of the four old grant lines granted `authenticated` on functions that live has revoked; `pact_ap_ledger_spend` keeps its grant because live confirms it is deliberately callable.
  - The baseline was assembled by splicing the already-verified blocks out of the migration files programmatically, not retyped.
  - **The rule, recorded in `sql/migrations/README.md`:** a dated migration file is a historical record of one change, never the current definition of anything. The current definition is `sql/rls-policies.sql` or, when it matters, `pg_proc`.

- **Why:**
  - The baseline is the one file written to be copied from and re-run, so it is the right place to hold "current". Making it so, and proving it, removes the trap rather than warning about it.
  - **Verified by diff, not by eye.** A database built from `schema.sql` + `rls-policies.sql` alone was compared with production for all seven functions as normalised body hashes, in both directions. The first comparison flagged `seal_character_history` over a single space (`end )` vs `end)`); the normaliser was tightened to ignore whitespace around punctuation rather than waving the difference through, because a comparison that cries wolf gets silenced.
  - **Two guards, because the fix alone just resets the clock.** `testing/sql/rls-baseline-test.sql` (30 assertions) builds the fresh-install path, checks the functions exist and are the current rules, checks every EXECUTE grant, places a real seal and confirms the protections fire, re-runs the baseline to confirm nothing reverts, then loads the migrations on top and asserts both sources define the same logic. `.github/workflows/sql-guards.yml` runs it and `session-seal-test.sql` (43 assertions covering the seal boundary, which had never run in CI) against a Postgres 16 service container. The drift guard was shown to fail by reverting one line of the projection, then restored.

- **Known gap, found afterwards:** the first drift guard hashed only `prosrc`, so it could not see the `search_path` that was dropped from `pact_ap_ledger_protected` in the same fold. See `D-GH-2026-09-03-code-review-503-followups` and `D-GH-2026-09-05-protected-projection-search-path`.

- **Related:** `sql/migrations/README.md`; `D-GH-2026-09-02-protect-dm-removals` (the projection change this fold carries).
