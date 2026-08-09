# D-GH-2026-08-09-harden-invitation-system — Fix a live privilege-escalation bug, unify DM invites onto the hardened player-invite model

Status: Active

- **Context:** `campaigns.dm_invite_code` (a 6-character, ~2.1-billion-combination code) was readable by
  any campaign member via `campaigns_select` RLS (row-level only, no column exclusion) and redeemable via
  `join_as_dm()` by **any authenticated account system-wide**, with no campaign-membership check and no
  rate limiting anywhere in the schema. Any player who read or guessed a code could become a co-DM of an
  arbitrary campaign. Confirmed live (not hypothetical) by reading the actual RLS policy and function
  bodies on `preview`. A live production query (4 campaigns, 27 player invites) found zero co-DM rows
  beyond each campaign's owner — the bug was never actually exploited to date, but was fully live.
  Player invites already had a hardened model (`campaign_invites`, single-use 128-bit CSPRNG tokens,
  atomic claim-on-redeem, DM-only creation) from `D-GH-2026-07-13-campaign-invite-tokens`; DM invites
  were never brought onto it.
- **Process:** the plan (`docs/plans/2026-08-08-harden-invitation-system.md`) went through 6 independent
  cross-vendor cold reviews (Grok 4.5, GPT-5.6 Luna, DeepSeek, Kimi, M365 Copilot, Gemini —
  `z-cold-reviews/harden-invitation-system-review-*.md`) before implementation. All 6 converged on: a
  self-contradiction in the original column-narrowing plan, a missing explicit retirement step for the
  old functions, a dangling "security properties" reference, unspecified reusable-invite concurrency,
  weak hashing language, and no rollback discussion — all folded into plan v2. Four items were genuine
  product/security decisions, not plan defects, and were put to the project owner:
  1. **Who may redeem a DM invite?** → Any authenticated account (matches today's actual intended
     behavior; security rests on token strength/expiry/revocation, not membership-scoping).
  2. **Single-use or reusable by default?** → Single-use by default; reusable is an explicit DM opt-in
     with a mandatory redemption limit (live data showed zero co-DMs ever added via this path — no
     observed workflow to preserve by defaulting to reusable).
  3. **Emergency hotfix before the full fix?** → No — the exploitation-evidence check came back clean and
     the app is small/pre-launch; a rushed interim patch was assessed as riskier than the low-traffic
     exposure window.
  4. **Does rate limiting block this fix?** → No — split into `docs/TASK_BOARD_NEXT.md`'s
     `feat/invite-rate-limiting`; once tokens are 128-bit, brute-forcing them is infeasible, so the
     remaining value is abuse/DoS protection, not closing the core escalation path.
- **Decision:** implement the unified `campaign_invites` model with `type` (`player`/`dm`) and `mode`
  (`single_use`/`reusable`) columns, `create_dm_invite()`/`redeem_dm_invite()` modeled on the existing
  player-invite functions' shape (same DM-only check, same atomic-claim discipline extended to cover
  reusable's redemption-count limit via row-locking). Drop `campaigns.dm_invite_code`, `join_as_dm()`,
  and `regenerate_dm_invite_code()` **outright** (not narrowed/revoked) — stronger than the plan's
  original narrow-the-grant proposal, and it eliminates that plan's step-3/step-5 self-contradiction by
  construction, since there's no column left to have a grant policy about.
  Two implementation-time refinements, found by writing the actual code rather than assumed at the plan
  stage:
  - **No auto-generated replacement DM invite for existing campaigns.** The plan originally called for
    migrating each campaign to one fresh DM token. Implementing it surfaced a real flaw: a token
    generated and immediately hashed-and-discarded inside a migration script is never seen by anyone,
    including the DM it's meant for — under hash-only storage there is no API to retrieve it again, and
    this project has no email/notification channel to hand it over out-of-band. The old code is retired
    with nothing generated in its place; a DM generates a fresh one on demand via the new DM Console UI.
  - **Player-invite tokens stay plaintext, deliberately, not hashed.** The plan's v1 called for hashing
    both invite types uniformly. `list_campaign_invites()` / DM Console's invite list reads back and
    persistently re-displays the plaintext player token (not just at creation) so a DM can re-copy a lost
    link — real, currently-used functionality. Hashing it would have silently broken that feature as a
    side effect of hardening a different, unrelated (DM) invite path — "keep the three tools working...
    unless the task says otherwise" doesn't get overridden by a security fix to a different mechanism.
    DM invites have no such legacy behavior to preserve (nothing today lets a DM re-view a
    `dm_invite_code` "again" beyond the campaign's one static value), so they get hash-only storage with
    no regression to weigh against it. Enforced at the database level with a check constraint
    (`campaign_invites_token_storage_check`) tying `type` to exactly one of `token`/`token_hash`.
- **Why:** the column-drop is strictly stronger than the originally-planned grant-narrowing and is free —
  once `join_as_dm`/`regenerate_dm_invite_code` are gone, nothing can reference the column, so removing
  it outright costs nothing extra and closes the "grant regression could re-expose it" risk permanently.
  The two refinements both resolve in favor of *not* silently breaking or complicating things beyond what
  the actual bug required — a security fix to one mechanism should not regress an unrelated one's
  existing, working behavior.
- **Implementation notes:**
  - Migration: `sql/migrations/2026-08-09-harden-invitation-system.sql`, applied directly to production
    via `mcp__Supabase__apply_migration` (two DROP FUNCTION/CREATE OR REPLACE FUNCTION signature changes
    required an explicit `DROP FUNCTION` first — Postgres rejects a `RETURNS TABLE` shape change via bare
    `CREATE OR REPLACE`). `sql/schema.sql` and `sql/rls-policies.sql` updated to match, so a fresh install
    matches production.
  - **Self-caught grant-drift regression, fixed same-session:** the `DROP FUNCTION
    list_campaign_invites(uuid)` needed for the return-shape change wiped out that function's prior
    `REVOKE EXECUTE ... FROM PUBLIC`, leaving it callable by the `anon` role — caught immediately by
    `get_advisors`, not by inspection. This is exactly the class of grant/RLS drift this project has been
    bitten by twice before (D-GH15, D-GH12); the advisor is why it didn't ship. Fixed in the same
    session (`grant ... to authenticated; revoke ... from public;` restated) and folded back into the
    migration file as an honest record (not silently corrected as if it had always been right).
  - New `campaign_invite_redemptions` table tracks per-redeemer state for reusable DM invites (a single
    `redeemed_by`/`redeemed_at` pair on `campaign_invites` can only record one redeemer).
  - `redeem_dm_invite()` uses `SELECT ... FOR UPDATE` row-locking rather than a bare
    `UPDATE ... WHERE ... RETURNING` — the existing single-use player-invite pattern is fine for its one
    trivial branch, but the DM function's multiple branches (idempotency, single-use vs. reusable-with-
    limit) need the whole read-check-mutate sequence serialized per invite row, not just one column flip.
  - Client (`js/campaign.js`) and DM Console UI (`tools/DM-Console.html`) updated: `joinAsDm`/
    `regenerateDmInviteCode` removed, `createDmInvite`/`redeemDmInvite` added, a new "Invite a co-DM"
    panel (generate/list/revoke, single-use or reusable+limit) and a "Join as co-DM" token-redemption row
    replace the old static "DMs: [code]" display. This also closes the previously-separate, now-folded-in
    task-board item "Wire up joinAsDm()" — its planned UI is built against the hardened RPC, never the
    leaking primitive it would otherwise have fronted.
  - Test scripts updated to match (`testing/scripts/seed-review-stack.mjs`,
    `testing/scripts/dm-console-ui-e2e.mjs`, `testing/campaign-test.html`); `testing/scripts/audit.py`'s
    live RLS proof extended with 3 new adversarial checks (non-DM `create_dm_invite` rejected, garbage-
    token `redeem_dm_invite` rejected, `token_hash` never selectable).
- **Verification performed:**
  - `testing/scripts/engine-parity-ci.mjs`: 29 passed / 0 failed (unaffected, as expected — nothing here
    touches `js/engine.js`).
  - `testing/scripts/audit.py --rls`: 29 passed, 0 failed (11 pre-existing warnings, unrelated). The live
    RLS-proof section (needs `PACT_PLAYER_JWT` etc.) is skipped in this environment — no test JWT
    available — but the equivalent checks were run directly against production instead (below).
  - `testing/scripts/dm-console-ui-e2e.mjs`: 79 passed / 79 (confirms the DM Console UI changes,
    including the new co-DM invite panel and the archived-campaign peek-mode scoping, didn't regress
    anything already covered).
  - `testing/scripts/cloud-e2e.mjs`: could not run — needs a local Supabase stack via Docker + the
    Supabase CLI; both were available in this environment and `supabase start` progressed as far as
    pulling every image and successfully initializing the schema from `sql/schema.sql` +
    `sql/rls-policies.sql` (itself a useful signal: the updated schema/RLS apply cleanly to a genuinely
    fresh database, not just as an incremental migration against production) — but a later container
    failed to start due to a sandbox rlimit restriction (`error setting rlimit type 7: operation not
    permitted`) unrelated to this change. This will run in CI via `.github/workflows/cloud-e2e.yml`.
  - **Direct adversarial testing against the live production database** (via SQL, simulating each
    identity's auth context, with full cleanup afterward via the real `remove_dm()` RPC): DM-only
    creation enforced; non-DM creation rejected; reusable-without-limit rejected; a DM-type token
    rejected via the player-redemption path and vice versa, both with the identical generic error; a
    valid redemption created a real `campaign_dms` row; a repeat redemption by the same user returned
    `already_member:true` with no duplicate row and no error; a third party's attempt against the
    already-consumed single-use token was rejected with the same generic error; a direct INSERT
    violating the `campaign_invites_token_storage_check` constraint was rejected at the database level,
    independent of the RPC layer. Live data reconfirmed after cleanup: 4 campaigns, 1 `campaign_dms` row
    per campaign (all owners), matching the pre-test state exactly.
  - `get_advisors` (security + performance): run twice — once catching the grant-drift regression above,
    once clean after the fix (plus one INFO-level unindexed-FK note on the new redemptions table, fixed
    for free).
- **Status:** Active. Rate limiting for invite generation/redemption is intentionally out of scope here —
  see `feat/invite-rate-limiting` on `docs/TASK_BOARD_NEXT.md` (Decision 4). Retiring the player-facing
  shared `invite_code` mechanism is also out of scope — lower urgency (grants ordinary membership, not
  elevated access) and a larger behavior change than this fix requires.
