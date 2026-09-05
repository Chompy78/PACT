# D-GH-2026-09-05-protected-projection-search-path — restore a pin, and assert the property instead of agreement

Status: Active

- **Context:** `pact_ap_ledger_protected(jsonb)` returns the frozen portion of a character's event log;
  `pact_enforce_locked_history()` calls it before and after every save and refuses the write if that
  portion moved. Three consecutive definitions declared `set search_path = public, pg_temp`
  (`2026-08-10-campaign-ap-log-integrity.sql`, `2026-09-01-session-seal.sql`,
  `2026-09-01-session-seal-rollback.sql`). `2026-09-02-widen-protected-projection.sql` rewrote the
  function to widen its projection — a correct change — and dropped the SET clause while retyping the
  signature. `cb323ca` then copied that weaker form into `sql/rls-policies.sql`, the maintained
  fresh-install path.

  Found by `/code-review ultra` on PR #503 and verified independently against the repo. The Supabase
  advisor had been reporting `function_search_path_mutable` on this exact function; PR #503's body
  dismissed it as pre-existing.

- **Options:**

  On **whether to fix it at all**, given the honest severity (see Why):
  1. *Leave it and document why it is safe.* Rejected — the safety is a property of today's call graph.
  2. *Restore the pin in both files.* **Chosen.**

  On **how to stop it recurring**:
  1. *Rely on the drift guard hardened in #505.* Rejected — insufficient, see below.
  2. *Add a positive assertion that every checked function pins its search_path.* **Chosen.**
  3. *Lint the SQL text for the clause.* Rejected: it would pass on a file that declares the clause and
     fails to apply it, and misses anything `create or replace`d elsewhere. Ask the catalog, not the text.

- **Decision:** Restore `set search_path = public, pg_temp` in a new dated migration
  (`2026-09-05-restore-protected-search-path.sql`) **and** in `sql/rls-policies.sql`; add a positive
  `search_path` assertion to `testing/sql/rls-baseline-test.sql` covering all seven functions; load the
  new migration in both SQL harnesses' migration paths. Body, projection and grants unchanged.

- **Why:**

  **The honest severity, stated because the first framing of it was too strong.** This function is
  **not** `security definer` (`pg_proc.prosecdef = false`) — it runs as its caller, so hijacking its
  name resolution gains an attacker nothing they could not already do. And it is reached from
  `pact_enforce_locked_history()`, which *is* `security definer` and *does* pin its own `search_path`,
  so the pinned path is already in force before this function is entered. **There is no known live
  escalation path today**, and calling this "a live security hole" would be wrong.

  It is fixed anyway, for reasons that outlive today's call graph:
  1. `2026-07-16-harden-search-path-pg-temp.sql` made pinning unconditional across the project. One
     function silently stopped following it. A rule with an unexplained exception stops being a rule.
  2. The current safety is a property of **how it happens to be called**, not of the function.
     Safe-by-construction beats safe-by-accident, because callers change and the next one may not pin.
  3. It reached the fresh-install baseline, so every new database inherited the weaker form.
  4. A permanently-ignored advisor warning is how the dangerous one eventually gets missed.

  **Why a positive assertion, when #505 just hardened the drift guard.** The drift guard asserts the
  baseline and the migrations say the *same* thing. It is satisfied when both are wrong in the same
  way — which is exactly what happened here: the clause was dropped from the migration and then copied,
  already weakened, into the baseline. Both sources agreed. **Agreement is not correctness.** So the
  new check asserts the property itself against the fresh-install build, before the migrations load.

  Proven rather than argued, on a real PostgreSQL 16:
  * Recreating the original bug exactly — both sides unpinned, and therefore agreeing —
    now fails with `UNPINNED: pact_ap_ledger_protected`. Under the old guard this state passed.
  * A one-sided regression (pin dropped from the baseline only) also fails.
  * Clean tree: `rls-baseline-test.sql` **34/34** (was 32), `session-seal-test.sql` **43/43**, and the
    migration path ends with `proconfig = search_path=public, pg_temp` confirmed from `pg_proc`.

  **Why seven functions and not the drift guard's five.** The drift guard compares the five whose
  bodies both sources define. The `search_path` property applies to every function either source
  creates, so `pact_ap_ledger_spend` and `pact_enforce_ap_budget_consistency` are included. A count
  assertion accompanies it for the same reason the drift guard has one: a renamed or typo'd name must
  fail, never silently shrink coverage.

  **Why the assertion was not added in #505.** It was written up as deliberately deferred in
  `D-GH-2026-09-03-code-review-503-followups`: adding it before this fix would have put CI red on
  `preview` for a defect that branch did not own. It lands here, with the fix it guards.

  **Why a new dated migration rather than editing the 2026-09-02 one.** `sql/migrations/README.md`: a
  dated migration file is a historical record of one change, not the current definition of anything.
  Editing an applied file is separately filed as `docs/migration-record-dm-remove-boon`.

- **Status:** Active. Repo-side complete and verified.

  **Not yet applied to the live database.** The migration is committed but production still carries the
  unpinned function until it is run there, and the advisor will keep reporting
  `function_search_path_mutable` until then. Deliberately left as an explicit owner-approved step rather
  than done silently, because it is a write to the live database — even though its blast radius is nil
  (no body change, no projection change, no grant change, identical output for identical input).
