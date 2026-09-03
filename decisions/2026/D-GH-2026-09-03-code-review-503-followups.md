# D-GH-2026-09-03-code-review-503-followups — the anti-drift guard could not see the drift it was built for

Status: Active

- **Context:** `/code-review ultra` on PR #503 (the `preview` → `main` promotion that shipped build
  `v1.503`) returned 13 findings. Three were verified and dealt with separately — the
  `pact_ap_ledger_protected` `search_path` regression, the `dmRemoveBoon`/CharGen reproducibility
  question, and a `v1.` placeholder in the PR body. This record covers the rest, and specifically the
  one that made the first of those possible.

  PR #503 shipped `testing/sql/rls-baseline-test.sql`, a guard whose stated purpose is that
  `sql/rls-policies.sql` (the fresh-install path) and `sql/migrations/` can never again define different
  things — written *because* the baseline had fallen three migrations behind. `sql/migrations/README.md`,
  added in the same promotion, sells it as the reason "CI fails instead of the difference sitting there
  for someone to discover in production."

  In the same promotion, the fold of `2026-09-02-widen-protected-projection.sql` into the baseline
  dropped `set search_path = public, pg_temp` from `pact_ap_ledger_protected` — hardening every prior
  definition of that function carried, and which `2026-07-16-harden-search-path-pg-temp.sql` exists to
  enforce. **The new guard passed.**

- **Options:**

  On **what the drift guard compares**:
  1. *Keep comparing `prosrc` only*, and rely on review to catch attribute drift. Rejected — review is
     exactly what just failed, in the same commit that shipped the guard.
  2. *Compare `prosrc` + `proconfig` + `prosecdef` + `provolatile`.* **Chosen.**
  3. *Compare `pg_get_functiondef()` wholesale.* Rejected: it re-introduces the formatting noise the
     normalisation was written to strip, and would fail on the single-space `end)` difference the file's
     own comment documents as a real, harmless divergence from production.

  On **a positive `search_path` assertion** (assert every checked function *has* a pinned
  `search_path`, rather than only that both sources agree): deferred, not rejected — see Status.

- **Decision:** Harden the guards that gave false assurance; correct the doc that CI had made wrong;
  leave production SQL alone.

  * `testing/sql/rls-baseline-test.sql` — the drift hash now covers `proconfig` (the `SET` clauses),
    `prosecdef` (definer vs invoker) and `provolatile` alongside the normalised body; two new assertions
    check that all five function bodies were snapshotted and that the comparison loop actually saw five;
    `pg_temp.rejects()` now requires the error to match `'PACT: %'` instead of accepting `when others`.
    30 assertions → 32.
  * `testing/scripts/version-label-ci.mjs` — `check('…source of truth', BUILD, BUILD)` (a tautology)
    became a real well-formedness assertion on `BUILD`, and the `index.html` absence check derives its
    pattern from any major (`/v\d+\.\d{3,}/`) instead of hardcoding `v1`.
  * `testing/scripts/dm-console-ui-e2e.mjs` — the suite-wide `listCampaignInvites` stub now waits on
    `window._campBridge` instead of inheriting a 2500 ms sleep, and the sleep moved to *after* the stub.
  * `docs/VERSION-SYNC.md` — the "no rules-version literal anywhere in `tools/`" section was false and
    now names the three literals a rules bump must edit.

- **Why:**

  **Why `proconfig` is the one that mattered.** A function's `search_path` is not a stylistic attribute;
  it is the difference between a `security definer` helper resolving `characters` to the table you meant
  and resolving it to whatever a caller put earlier in their `search_path`. It lives in `proconfig`, not
  `prosrc`, so a guard hashing the body alone is blind to the entire class. This was proven, not
  reasoned: injecting the divergence deliberately (restoring the SET clause in the baseline only) made
  the guard print `PASS rls-policies.sql and the migrations define the SAME logic`. After the change the
  same injection prints `DIVERGED: pact_ap_ledger_protected` and exits non-zero.

  **Why the guard needed its own guard.** The comparison is an inner join with no count assertion, so a
  function missing from one side produces no row, `v_bad` stays empty, and it reports SAME-logic having
  compared nothing. A single typo in the five hardcoded names — or a future migration renaming one —
  silently shrinks coverage with the suite still green. `version-label-ci.mjs`, one directory over,
  already states the rule this violates: *"A missing match is a FAILURE, not a skip."* Verified by
  typo'ing `seal_character_history`: previously PASS with four functions, now
  `FAIL all 5 baseline function bodies were snapshotted`.

  **Why `when others` was worse than it looks.** `pg_temp.rejects()` treated *any* error as a passing
  rejection. Rename `characters.stats` and all four calls report PASS on `column "stats" does not exist`
  while never once firing `trg_pact_locked_history` — a suite that is green with zero seal coverage,
  which is the precise failure mode the whole file exists to prevent. Every protection here raises a
  distinctive `PACT: ` prefix, so requiring it costs nothing and closes the hole. Verified by pointing
  one probe at a non-existent column: previously PASS, now
  `FAIL … (HARNESS ERROR, not a rejection …)`.

  **Why the tautology was worth replacing rather than deleting.** `check(BUILD, BUILD)` cannot fail, and
  its own comment admitted as much ("trivially true; anchors the section") — so it was honest, not
  hidden. But `BUILD` is the value all nine other assertions compare against, so a malformed sync commit
  (`v1.5O3`, a trailing space) would make nine checks agree on a wrong string. Asserting `BUILD`'s shape
  keeps the anchor and makes it load-bearing.

  **Why `docs/VERSION-SYNC.md` was corrected rather than the tools changed.** The doc said a
  `DATA.version` bump "needs **no** rules-label edit in any tool". Since `99b024a` that is false in a way
  that fails CI: three literals in CharGen and the Live Sheet are asserted equal to `DATA.version`, and
  `js/engine-data.js` is inside `engine-parity.yml`'s path filter, so the next rules bump triggers the
  gate and goes red on three stale literals — while the documented procedure told the author no tool edit
  was required. `AGENTS.md`: when a shipped artifact disagrees with a written doc, the artifact is what
  was really built. The literals themselves are load-bearing (they are all a user sees before
  `engine-ready`, and everything they see if the module bridge never runs), so removing them was not the
  fix.

  **Why no production SQL was touched.** The `search_path` regression is live on `main` in another
  session's work and is being handed to that session with a written brief. Fixing the *guard* is
  independent of fixing the *function*, does not conflict with it, and — because the guard checks
  baseline-against-migrations rather than correctness — stays green either way. Both harnesses were run
  against a real PostgreSQL 16 before and after: `rls-baseline-test.sql` 32/32, `session-seal-test.sql`
  43/43.

- **Status:** Active.

  **Deliberately deferred, with reasons.**
  * *A positive assertion that every checked function has a pinned `search_path`.* This is the check that
    would have caught the regression directly rather than only its divergence, and it belongs in the
    same change that fixes the function — added now it would put CI red on `preview` for a defect this
    branch does not own. Handed to the fixing session as part of its brief.
  * *The hardcoded migration list.* `rls-baseline-test.sql` loads four `2026-09-0x` files by name, so it
    stops covering anything added later unless someone remembers to edit it — `sql/migrations/README.md`
    implies CI catches a forgotten fold, and it does not. Auto-discovering the directory is a design
    change with real ordering questions (which migrations are replayable, in what order), so it is filed
    rather than improvised. Filed as `test/sql-drift-guard-auto-discovery`.
  * *`2026-09-02-widen-protected-projection.sql` edited in place after being applied.* The file's header
    documents the extension honestly ("AS FIRST SHIPPED AND THEN EXTENDED"), but names the second change
    as applied under `seal_protects_dm_removals` — and no migration file by that name exists, so
    replaying the directory produces in one file a state production reached in two, with no dated record
    of when. Filed as `docs/migration-record-dm-remove-boon`.
  * *No `DECISIONS.md` record for `cb323ca` or `f2418a9`* — both changed the security posture of the
    documented fresh-install path or what the server refuses. Their author knows the *why*; writing it
    from the outside would be reconstruction. Filed as `docs/decisions-for-2026-09-02-sql-commits`.
