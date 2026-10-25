# D-GH-2026-10-25-server-negative-cost-after-lock — the database refuses a player-added negative cost on a campaign character

**Context.** Found in the review of #644 (`fix/server-player-award-after-lock`), which closed the AWARD route only. Costs are stamped by
the client and `pact_ap_ledger_split()` sums them as written: every `buy` whose cat is not `patch` or `drawback`, and every `names` or
`buyoff`, adds its `cost` to SPENT. A modified client could append `{type:'buy', cat:'skill', cost:-1000}` or `{type:'names',
cost:-1000}` and then spend 1000 AP. `pact_enforce_ap_budget_consistency()` only refuses a write whose spend both rises and exceeds the
budget, and the negative event had already lowered the spend. It works in every campaign mode, locked or not. #654 closed the drawback
route (a drawback grants at most its effective value) and the negative-buyoff route (R2-5); harness cases R2-2 and R2-4 pinned the rest
as "allowed" until now.

**Live measurement** (read-only, 2026-10-25, before any SQL was written): across every character, campaign-bound or solo, the only
events with a negative cost were `drawback` buys (12 on 5 campaign characters, 28 on 11 solo; -1 to -5) and `patch` buys (7 on 7
campaign, 12 on 10 solo; -2 to -22). Zero negative-cost buys of any other cat, zero buyoffs, zero `names` events. The rule refuses
nothing that exists today. A sweep of `priceOf()` over 183,730 single purchases on the 190 build fixtures also found no negative price
outside drawback / mbound / dbound, so no legitimate tool save should be refused.

**Options.**

- **Q1 — where does the rule live?**
  - A. Extend `pact_enforce_player_grants()` (it already skips DMs and admin sessions and already matches "new events" against the stored row).
  - B. A separate trigger, `trg_pact_negative_cost_guard`.
  - **Decision: B.** The grants function is added and removed by the house-rules migration and its harness rolls that back, so a rule
    inside it would disappear in that harness and couple two unrelated changes. A small function with its own rollback is easier to
    reason about; the exemptions are copied, not shared.

- **Q2 — which events, which floor?**
  - A. Refuse any negative cost on any non-drawback event.
  - B. Refuse a negative cost on `buy` (cat not `drawback`, `patch`, `mbound`, `dbound`) and on `names`; allow `mbound`/`dbound` down to the engine's flat -2 and refuse anything lower.
  - **Decision: B.** `patch` is skipped by the server ledger and CharGen legitimately stamps negatives on it. The two bindings are AP-granting
    by design (js/engine.js prices both at -2). A is wrong for them, and leaving them unbounded would keep a -1000 route open. `buyoff` is
    left to R2-5, which already refuses it with a more specific message. The floor is a bound, not a price: SQL still never re-prices.

  - **Addendum (independent review, 2026-10-25).** A per-event floor of -2 is not enough: 500 separate `mbound` events at -2 each pass it and
    the ledger sums every one. A binding is one flag (`mbound`) or one per discipline (`dbound`, payload `ti`/`di`), so a new negative-cost
    binding is also refused when the log already holds another negative-cost binding with the same cat and `ti`/`di`.

- **Q3 — where does the "2" live?**
  - A. Hardcode it in the trigger. B. A one-line function, `pact_binding_grant_max()`, with a comment, and a check in
    `run-negative-cost.sh` that it equals the engine's price.
  - **Decision: B.** If the engine's binding price ever changes, CI goes red instead of the server silently refusing (or over-allowing) a binding.

- **Q4 — shallow or deep?** A blanket clamp inside the budget trigger would have been the shallow fix, but that trigger returns early
  when a campaign switches the budget check off (`enforceApBudget: false`), so a negative cost would pass in exactly the campaigns
  that most need the rule to fire. The new trigger runs in every mode.

**Decision.** Accepted. New `BEFORE UPDATE` trigger on `characters`: for a campaign-bound character written by anyone other than a DM of that
campaign or an admin session, a NEW event (not already stored, compared without `ts`/`rules`/`label`) is refused when it is a negative-cost
`buy` outside the four categories above, a `names` event with a negative cost, a binding below -2, or a repeat of a binding the log already holds. Solo characters are untouched.

**Residual risk (recorded, not fixed here).** An event stored BEFORE the character joined a campaign is grandfathered, as is a row INSERTed
with one. A solo character built with a forged negative cost and then bound keeps it; closing that belongs with
`fix/server-owner-delete-reinsert-lock-bypass` and the bind-time checks.

**Side finding.** `pact_enforce_player_grants()` treats a `buy` with no `cat` as a drawback when `v_ev->>'cat' = 'drawback'` is NULL (a NULL in
its `not (A or B)` skip test), so a catless buy on a locked character is refused with the drawback message. Harmless here; noted in the harness.

**Status.** Rehearsed in `run-negative-cost.sh` (36 cases: 19 attacks refused after, all legitimate paths allowed, rollback restores the gap).
Folded into `sql/rls-policies.sql`; the migration is applied to the live database in a separate step (see the CHANGELOG line).
