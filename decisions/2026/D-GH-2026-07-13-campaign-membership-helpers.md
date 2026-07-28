# D-GH-2026-07-13-campaign-membership-helpers — De-duplicate campaign-membership SQL checks

Status: Active

- **Context:** `/code-review ultra` on PR #202 (`D-GH-2026-07-13-campaign-bind-character`) found, via two
  independent finder angles (Reuse, Altitude), that `join_campaign`, `redeem_player_invite`, and
  `bind_character_to_campaign` each hand-rolled their own "look up campaign by shared `invite_code`" and
  "does this owner already have a character in this campaign" checks. Deferred out of that PR's scope at
  the time since fixing it meant touching two already-shipped functions, not just the new one — filed as
  a roadmap follow-up (`refactor/campaign-membership-helpers`) and picked up here.
- **Options (how to share the logic):** (A) a shared SQL helper function, called from all three RPCs.
  (B) leave the duplication — three RPCs is a small, closed set, and the checks are short enough that
  drift risk is low. (C) collapse the three RPCs into one parameterized function — over-abstracts three
  call sites with genuinely different pre/post logic (new-blank-character vs. token-redemption vs.
  existing-character-rebind) into one branchy function, trading duplication for a different readability
  cost.
- **Decision (A):** one new helper, `find_campaign_by_invite_code(code)` (raises on miss, matching the
  exact prior error text; used by `join_campaign`/`bind_character_to_campaign` only —
  `redeem_player_invite` resolves via a single-use token against `campaign_invites`, a different lookup,
  not this one). The "already joined" check reuses the **pre-existing** `is_campaign_member(campaign)`
  (`rls-policies.sql`) instead of a new function — see the follow-up paragraph below for why the first
  draft got this wrong. Each call site still writes its own `if is_campaign_member(...) then raise
  exception '...'` with its own message text, so the boolean-predicate shape preserves the two different
  error strings ("You have already joined this campaign" vs. "…with another character") without the
  helper needing to own the exception itself.
- **Why:** (A) over (B) — the duplication was already flagged twice independently by code review, a signal
  it's worth fixing rather than accepting; a helper function is the standard Postgres idiom for this, no
  new abstraction layer needed. (A) over (C) — the three RPCs' surrounding logic (blank-character insert,
  token-consumption, rebind-contract branching) is different enough that merging them would trade a small
  amount of literal duplication for a much larger branchy function, a worse trade.
  **Design point — not `SECURITY DEFINER`, not granted to `authenticated`:** `find_campaign_by_invite_code`
  runs plain `plpgsql` without its own `SECURITY DEFINER`. Since it's only ever called *from inside* the
  two outer `SECURITY DEFINER` RPCs, Postgres's privilege-elevation rule (current_user stays elevated
  through nested non-definer calls) means it already runs with the outer function's elevated context — no
  separate elevation needed. Consequently it's also deliberately **not** granted `EXECUTE` to
  `authenticated` (unlike `is_campaign_dm`/`owner`/`member`, which genuinely need that grant because they
  ARE invoked directly from RLS policy `USING` clauses, running as the *invoking* role, not a definer's).
  Verified post-migration: `information_schema.role_routine_grants` shows only `postgres` holding
  `EXECUTE` on it — `authenticated` cannot call it as a standalone `/rest/v1/rpc/...` request.
- **Follow-up: `/code-review` pass on this PR itself, before merge.** 10 finder angles; one real
  duplication bug and one real documentation bug, both fixed; two pre-existing (not introduced by this PR)
  gaps found and deferred as separate follow-ups rather than scope-crept into a "pure refactor" PR.
  - **Fixed — self-duplication:** the first draft added a *second* new helper,
    `owner_has_character_in_campaign(campaign, owner)`, for the "already joined" check — but every call
    site always passed `auth.uid()` as `owner`, and that's exactly what the pre-existing
    `is_campaign_member(campaign)` already checks (`rls-policies.sql`, identical query body). Caught by
    this PR's own Reuse angle before merge; replaced with `is_campaign_member` everywhere, deleting the
    redundant function (dropped via `drop function if exists` in a corrective migration since it had
    already been briefly live). Ironic given the PR's whole purpose is removing duplication — kept as the
    canonical example of why review-your-own-refactor is worth the pass.
  - **Fixed — misleading doc comment:** the helper-block comment originally implied all three RPCs
    hand-rolled *both* check shapes; `redeem_player_invite` never hand-rolled an invite_code lookup
    (different mechanism, see Decision above). Comment corrected to name exactly which RPCs use which helper.
  - **Deferred — race-handling asymmetry (real, pre-existing, not introduced here):** `join_campaign` and
    `redeem_player_invite`'s character-insert have no `unique_violation` handler, unlike
    `bind_character_to_campaign` (added in `D-GH-2026-07-13-campaign-bind-character`). A race that beats
    both RPCs' pre-check surfaces a raw Postgres constraint-violation error instead of the friendly "You
    have already joined this campaign" message. Real bug, but pre-existing and out of a "no behavior
    change" refactor's scope — filed as a roadmap follow-up (see the TODO block output alongside this
    session's work) rather than silently expanding this PR.
  - **Deferred — `search_path` hardening (real, pre-existing, not introduced here):** every `SECURITY
    DEFINER` function in `schema.sql`/`rls-policies.sql` (11+ instances, confirmed pre-existing) sets
    `search_path = public` without also listing `pg_temp`, which doesn't fully close the classic
    session-local-temp-table-shadowing pitfall. `find_campaign_by_invite_code` inherits the same pattern.
    Real latent risk, low exploitability today (Supabase/PostgREST clients have no raw-SQL/DDL path), but
    fixing it piecemeal in just the one function this PR touches would leave the other 10+ inconsistent —
    a repo-wide `search_path` hardening pass is its own follow-up, not this PR's job.
- **Status:** Shipped (`refactor/campaign-membership-helpers`). Migration
  (`sql/migrations/2026-07-13-campaign-membership-helpers.sql`, plus a corrective re-apply after the
  self-duplication fix above) applied to the live Supabase project; `find_campaign_by_invite_code('ZZZZZZ')`
  smoke-tested twice (before and after the fix) to confirm it still raises the exact original error text
  (`No campaign with that invite code`). Advisor shows no new finding class both times — the new helper
  never appears in the "authenticated can execute this SECURITY DEFINER function" WARN list (every
  client-facing RPC does), confirming the lockdown is effective, not just intended. `get_logs` (postgres
  service) skimmed post-apply — the only ERROR-severity entry is this PR's own smoke test; no unrelated
  errors. `testing/tests/engine-parity.html` unaffected (20/0 — no `js/engine.js` change).
