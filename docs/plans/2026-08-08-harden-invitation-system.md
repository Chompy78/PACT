# Plan: Harden the campaign invitation system (PACT) — v2

> Cold-review plan for task-board item `fix/harden-invitation-system` (NOW band,
> `docs/TASK_BOARD_NOW.md`). Effort: high · Risk: high.
> **Supersedes:** v1 of this plan (same file path). v1 went through 6 independent cross-vendor
> cold reviews (Grok 4.5, ChatGPT/GPT-5.6, DeepSeek, Kimi, M365 Copilot, Gemini — filed under
> `z-cold-reviews/`); this version resolves every cross-reviewer-convergent finding and the four
> genuine product/security decisions those reviews surfaced. See "Changes from v1" at the end.

## Goal

Close a confirmed, currently-live privilege-escalation bug in a browser-only web app (static
front end + Supabase Postgres backend under Row-Level Security) that lets **any authenticated
account, system-wide** — not only an existing campaign member — become a co-DM of an arbitrary
campaign without authorization. Replace the DM-invite mechanism with a hardened, unified token
model (extending the app's existing, already-hardened player-invite model) that satisfies the
Security Invariants listed below, without changing user-visible behavior for people using
player invites correctly today. Retiring the separate player-facing shared invite-code mechanism
is explicitly **not** part of this goal (see Out of scope) — this plan unifies DM invites onto
the hardened model; it does not unify all invite mechanisms into one.

## Context

This app is a tabletop-RPG character/campaign tool. A **campaign** has one owner (`dm_id`) and
can have co-DMs. Players join a campaign and each control one character. Two invite mechanisms
currently coexist:

1. **Shared, permanent, reusable 6-character codes** stored directly as columns on the
   `campaigns` table: `invite_code` (join as a new player) and `dm_invite_code` (join as a
   co-DM). Neither is ever consumed or rotated automatically; a DM can manually regenerate
   either, which invalidates the old value.
2. **Single-use, per-player invite tokens** in a separate `campaign_invites` table, added later
   and used only for player invites carrying a DM-chosen starting AP grant. Each token is
   redeemed exactly once via a database function and then marked redeemed.

The database enforces access control primarily through Postgres Row-Level Security (RLS)
policies plus column-level `GRANT`/`REVOKE` (Postgres RLS cannot restrict which *columns* of an
allowed row are readable/writable, so this codebase's existing pattern for column-level secrecy
is a narrowed column-list `GRANT SELECT (...)` instead of a blanket one — see Verified below for
a live in-repo example). All privileged writes go through `SECURITY DEFINER` database functions
(a Postgres stored procedure that runs with elevated rights regardless of who calls it) rather
than direct table writes from the browser.

## Assumptions vs. verified facts

**Verified** (read directly from live database policy/schema source files, live client code, and
(new in v2) a live read-only query against the production database — not inferred):

- The `campaigns` row-select policy lets *any* member (owner, co-DM, or ordinary player with a
  character in it) `SELECT` the full row. This is row-level only — there is no column-level
  `GRANT` narrowing it, unlike a sibling table in this same policy file, which excludes one
  sensitive column from its `SELECT` grant with a comment explaining exactly why (RLS is
  row-level, not column-level) — a proven in-repo pattern to reuse, not invent.
- `join_as_dm(code)` does **not** check the caller is already a member of the target campaign —
  only that they're logged in and the code matches. Its execute grant is system-wide
  (`to authenticated`), not campaign-scoped. Code space is ~2.1 billion combinations
  (36 chars ^ 6), and no rate-limiting mechanism exists anywhere in the schema or policy files.
- The existing `campaign_invites` table (player invites only, today) already implements: a
  128-bit random hex token from a CSPRNG, atomic claim-on-redeem
  (`UPDATE ... WHERE redeemed_by IS NULL AND revoked_at IS NULL RETURNING ...`, race-safe),
  soft revocation, DM-only creation/listing via `SECURITY DEFINER`, and a correctly-scoped
  row-select policy (DM sees their campaign's invites; a redeemer sees only their own row). This
  is a solid foundation to extend, not a parallel system to design fresh.
- `campaign_invites.expires_at` exists but its only comment reads "reserved, not yet enforced" —
  no code path currently checks it.
- The most relevant prior planning document in this repo explicitly scoped only player-invite and
  bind-existing-character flows, and treated `dm_invite_code`/`join_as_dm` as an existing,
  untouched, backward-compatible mechanism outside its scope — this is a genuinely unaddressed
  gap, not a reversal of an earlier decision.
- This repo has an RLS-audit script and a cloud/auth end-to-end script; both exist today and are
  the natural home for new coverage. It has also been bitten twice before by RLS/grant drift that
  an automated Postgres advisory tool caught for free — running that tool before opening a PR is
  a standing project convention for any RLS/grant-touching change, not optional here.
- DM Console already has a working pattern to mirror for the new "generate a DM invite"
  affordance: a `createInviteBtn` button wired to `createPlayerInvite(campaignId, ap, note)`. The
  new DM-invite-generation UI is additive alongside this existing pattern, not designed from
  scratch.
- **(New in v2) Live production data, queried directly:** 4 campaigns, 27 player invites, 4
  `campaign_dms` rows total — and every single one of those 4 rows is the campaign's own owner.
  **Zero co-DM rows exist beyond the owner in any campaign.** `join_as_dm` has never actually
  resulted in an unauthorized co-DM in production. This rules out the bug having caused actual
  privilege elevation to date (it cannot rule out someone having read a code without acting on
  it). It also means the migration in this plan touches a trivial amount of data — scale is not a
  real constraint on the migration approach.

**Assumed / not verified in this pass:**

- Whether the hosting platform's own infrastructure-level rate limiting covers arbitrary RPC
  calls (as opposed to auth-specific endpoints) — genuinely unresolved, which is exactly why rate
  limiting is being split into its own follow-up task rather than gating this one (see Decisions
  below).
- Whether the longer code-review document referenced elsewhere in this project contains adjacent
  detail worth checking before implementation — not read in full for this plan.

## Decisions (resolved before implementation, not left open)

Four questions came out of the 6-reviewer cold-review round that were genuine product/security
calls, not implementation details — each is now resolved:

1. **Who may redeem a DM invite?** → **Any authenticated account**, matching today's actual
   (if poorly secured) intended behavior — a DM can invite someone who isn't already a player.
   Security now rests entirely on token strength, expiry, and revocation rather than on
   membership-scoping. This is a deliberate, recorded choice, not an oversight (see Security
   Invariant 12 below).
2. **Are DM invites single-use or reusable by default?** → **Single-use by default.** Reusable
   is available only as an explicit DM opt-in with a mandatory redemption limit. The old code's
   permanent reusability was an implementation artifact of the 6-character-code mechanism, not a
   demonstrated product need — live data confirms zero co-DMs have ever been added via this path,
   so there's no observed workflow to preserve by defaulting to reusable.
3. **Emergency stopgap before the full fix?** → **No.** The exploitation-evidence check came back
   clean (zero unauthorized co-DMs ever created) and the app is small (4 campaigns) and pre-launch.
   A rushed interim patch to `join_as_dm` would itself be new security-critical code shipped under
   time pressure — assessed as riskier than the current low-traffic exposure window. Proceed
   directly to the full fix below.
4. **Does rate limiting (former step 7) block this plan?** → **No — split into a separate
   follow-up task.** Once tokens are 128-bit, brute-forcing them directly is infeasible; the
   remaining value of rate limiting is abuse/DoS protection, not closing the core escalation path.
   It's genuinely open-ended (may need new infrastructure this schema has none of) and all
   reviewers agreed it shouldn't gate the core fix. A follow-up task-board item captures it.

## Security invariants

The implementation must preserve these at the database level; client-side checks are never
authoritative. (Adapted from the strongest reviewer's proposed list, resolved against the
Decisions above.)

1. **Bearer credentials.** Plaintext invite tokens are never readable through ordinary table
   queries by non-DM users. Stored tokens are cryptographically hashed by default — plaintext
   storage requires explicit justification recorded in the decision log, not silent default.
2. **Server-authoritative identity.** A redemption is determined solely from the presented token
   and its server-side row. A caller-supplied campaign ID, type, mode, or limit cannot alter what
   the token authorizes.
3. **Immutable scope.** Every invite is permanently bound to exactly one campaign and one type
   (`player`/`dm`). A player-type token can never grant DM privileges and vice versa.
4. **Definer-only privilege grants.** No browser-accessible role can directly insert/update
   campaign membership or co-DM state; only `SECURITY DEFINER` functions can.
5. **Atomic single-use redemption.** A single-use invite produces at most one successful
   redemption under concurrent requests (existing proven pattern, reused as-is).
6. **Atomic reusable redemption.** A reusable invite cannot exceed its configured limit under
   concurrent requests: `UPDATE campaign_invites SET redeemed_count = redeemed_count + 1 WHERE id
   = ... AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) AND redeemed_count <
   max_redemptions RETURNING ...` — the validity check and the increment happen in one atomic
   statement, the same discipline the existing single-use path already has, extended rather than
   invented fresh.
7. **Server-side validity.** Revocation and expiry are enforced at redemption time, not only when
   an invite is displayed or listed (closes the `expires_at` no-op gap found in Verified).
8. **Indistinguishable failures.** Redeeming a nonexistent, expired, revoked, exhausted, or
   wrong-type token returns the same generic error — it must not reveal which condition applied.
9. **Old path fully retired.** After migration, no browser-callable function can grant co-DM
   status from `dm_invite_code`. `join_as_dm` and `regenerate_dm_invite_code` are explicitly
   `REVOKE EXECUTE`'d (or dropped) as their own implementation step — not merely superseded by a
   new path while remaining technically callable.
10. **Idempotent redemption by an existing member.** If the redeemer is already a co-DM (or,
    for a player-type token, already a player) of the token's campaign, redemption makes no state
    change and consumes no redemption slot — it does not silently succeed-and-consume, and it
    does not error in a way that leaks whether they were already a member (see Invariant 8).
11. **Migration never carries forward a potentially-exposed secret.** Existing `dm_invite_code`
    values are not copied into the new token store as bearer credentials — every migrated
    campaign gets a freshly-generated token, never a wrapped version of the old 6-character code.
12. **Authorization scope is explicit, not inferred.** Per Decision 1: any authenticated account
    may redeem a valid DM token. This is deliberate, not an oversight.

## Proposed approach

1. **Audit first.** Before writing new code, produce a concrete inventory: every function,
   row-policy, and column-grant touching `campaigns`, `characters`, or invites, each mapped to its
   caller authorization, data visibility, and mutation capability. This is a required deliverable
   (not an open-ended read-through) — it's what makes step 1 reproducible and catches other
   instances of this bug class before they're found the hard way.
2. **Extend the existing invite table.** Add `type` (`player`/`dm` — existing rows all become
   `player`), `mode` (`single_use`/`reusable`), `redeemed_count`/`max_redemptions` (reusable only;
   database-level check constraints enforce `max_redemptions` is mandatory when `mode = reusable`
   and irrelevant/1 when `mode = single_use`, so the database — not the RPC layer — is what
   prevents an invalid combination from ever being stored). Model the new DM-invite
   creation/listing/revocation/redemption functions on the existing player-invite functions'
   shape (same DM-only check, same atomic-claim discipline) rather than a fresh design.
3. **Stop the read leak.** Narrow the `campaigns` table's `SELECT` grant to exclude
   `dm_invite_code` only (the player-facing `invite_code` remains selectable — see Out of scope
   for why unifying that path isn't part of this goal). Necessary but not sufficient alone, since
   `join_as_dm` never depended on readability in the first place — see step 4.
4. **Replace the DM-invite primitive.** Retire `dm_invite_code` as a standing low-entropy
   column. New DM invites are 128-bit random tokens, hashed at rest (Invariant 1), bound
   server-side to campaign + type (Invariant 2/3), checked atomically on redemption (Invariant
   5/6) including expiry/revocation (Invariant 7), single-use by default per Decision 2.
5. **Explicitly retire the old path.** `REVOKE EXECUTE` on `join_as_dm` and
   `regenerate_dm_invite_code` (or drop them) as its own commit-level step, verified by attempting
   to call both post-migration and confirming they fail for every role. This is Invariant 9 and is
   listed as its own step specifically because it's the exact class of thing that quietly survives
   a migration otherwise.
6. **Migrate existing campaigns.** Per Decision 2/3: every existing campaign gets one freshly
   generated single-use DM token (not a reusable one, not a wrapped copy of the old code — per
   Invariant 11). At 4 campaigns total, this is a trivial, easily-reviewable migration statement,
   not a batched/staged one. Record the decision (this document) and the migration's execution in
   `DECISIONS.md`.
7. **Wire the UI.** DM Console: a "Generate DM invite" button mirroring the existing
   `createInviteBtn`/`createPlayerInvite` pattern, plus a redeem affordance (the previously
   separate, now-folded-in "wire up joinAsDm" task-board item) built against the new hardened RPC
   — never against `dm_invite_code`.
8. **Full regression pass before done.** Run the existing RLS-audit script and cloud/auth
   end-to-end script (both extended per Verification below), and the hosted database's advisory
   tool, fixing anything any of the three surfaces before considering this complete.

## Files (or documents) involved

- Database schema file (`campaigns`, `campaign_invites`, `join_as_dm`, `join_campaign`,
  `create_player_invite`, `redeem_player_invite`, `list_campaign_invites`, `set_invite_revoked`,
  `regenerate_invite_code`, `regenerate_dm_invite_code`, `gen_invite_code`).
- Row-level-security policy file (all `campaigns_*`/`campaign_invites_*` policies and every
  `GRANT`/`REVOKE` on those tables/functions).
- A new, dated SQL migration file, additive to the existing chain.
- The client-side RPC-wrapper module (`joinCampaign`, `joinAsDm`, `createPlayerInvite`,
  `redeemPlayerInvite`, and new DM-invite counterparts).
- DM Console (invite generation/listing/revocation UI, `createInviteBtn` pattern) and the
  player/DM-facing redemption screen.
- The project's decision log (Decisions above, once implemented) and dated change log.
- The existing RLS-audit script and cloud/auth end-to-end script, extended with new coverage.

## Out of scope

- Retiring the player-facing shared `invite_code` mechanism — lower urgency (grants ordinary
  membership, not elevated access), and per Decision-making above, unifying it is a larger
  behavior change than this security fix requires. The Goal has been reworded (v2) to not
  overclaim full unification, closing the internal contradiction a reviewer correctly flagged in
  v1.
- Rate limiting / abuse protection for invite generation and redemption — split into its own
  follow-up task-board item per Decision 4, so it doesn't block this fix.
- Any change to game-rules logic, pricing, or the rules engine.
- A full invite-management UI overhaul beyond generate/redeem/revoke.

## Alternatives considered

- **Column-grant narrowing alone.** Rejected as insufficient alone — stops the read leak but not
  the guess/brute-force path, since `join_as_dm`'s check never depended on readability.
- **Just rotate the reusable code more often.** Rejected — shrinks the exposure window without
  closing the design gap (still low entropy, no per-invite attribution, no revocation-on-suspicion
  story).
- **A brand-new, separate table for DM invites.** Rejected in favor of extending the existing
  table, which already encodes several hard-won fixes (a note-column leak, a missing-ledger-row
  bug, a double-AP-grant bug) a fresh table would have to independently rediscover.
- **An immediate narrow hotfix ahead of the full plan.** Considered and explicitly rejected — see
  Decision 3.
- **Reusable-by-default migration to preserve current behavior.** Considered and explicitly
  rejected — see Decision 2.

## Risks

- **This is security-critical, production authorization code** — a subtle mistake in the new
  functions' atomicity or the retirement step (Invariant 9) could leave a residual gap while
  appearing to close the reported one.
- **No automated coverage today exercises this exact bug class** (a readable-but-shouldn't-be
  column, or a callable-but-shouldn't-be function) — the audit and e2e scripts need genuinely new
  assertions, not just a manual read-through, or a regression could ship silently again.
- **Rollback:** the migration is additive (new columns, new tokens) and the retirement step
  (revoking old functions) is the only hard-to-reverse part — if something goes wrong post-deploy,
  re-granting `EXECUTE` on the old functions is the rollback path, but the old `dm_invite_code`
  values themselves are not regenerated/restored (per Invariant 11, they were never trustworthy
  to begin with), so rollback restores the *old vulnerable behavior*, not a neutral state. Worth
  stating plainly rather than assuming "reversible" means "safe to reverse."

## Verification

- Extend the RLS-audit script and cloud/auth end-to-end script with: a non-DM cannot read a DM
  invite secret in any form (direct `SELECT`, via any RPC return value, via error messages); a
  DM-type token cannot be redeemed through the player-redemption path or vice versa; a token bound
  to campaign A cannot create membership in campaign B even when the caller supplies campaign B's
  ID; concurrent redemption of the same single-use token yields exactly one success; concurrent
  redemption against a reusable token's limit never exceeds `max_redemptions`; an
  expired/revoked/exhausted/nonexistent token all return the identical generic error; redemption
  by an already-existing member is a no-op per Invariant 10; `join_as_dm` and
  `regenerate_dm_invite_code` are unreachable by any role post-migration.
- Run the hosted database's advisory/lint tool after the schema/policy changes; resolve anything
  it flags — non-optional per this project's own standing convention (two prior incidents).
- Manually re-derive, by reading the *final* policy/grant state (not the diff), that no
  non-DM role can select a DM invite secret from any table — this is the check that would have
  caught the original bug, so it's the check that proves this one is actually fixed.
- Confirm the rules-engine regression suite is unaffected (expected trivially true; run once to
  confirm rather than assume, since nothing here touches rules logic).

## Done when

- `dm_invite_code` is no longer selectable by any non-DM role and `join_as_dm`/
  `regenerate_dm_invite_code` are unreachable by any role — both verified against live
  policy/grant state, not the diff.
- DM invites redeem through the unified, hardened token model via `SECURITY DEFINER` functions,
  single-use by default, with no client-side path that can insert membership/co-DM state
  directly.
- Every Verification item above passes, including the new adversarial cases.
- Decisions 1–4 above are recorded in `DECISIONS.md` alongside the implementation.
- The rate-limiting follow-up task exists on the task board.
- The rules-engine regression suite is confirmed unaffected.

---

## Changes from v1 (post cold-review)

Six reviews (Grok 4.5, ChatGPT/GPT-5.6 Luna, DeepSeek, Kimi, M365 Copilot, Gemini) converged on:
a self-contradiction in v1 (narrow-both-columns vs. leave-`invite_code`-alone — fixed, now
`dm_invite_code`-only); a missing explicit retirement step for the old `join_as_dm`/
`regenerate_dm_invite_code` path (added as step 5/Invariant 9); a dangling reference to a
"security properties" list that never appeared (added as the new Security Invariants section);
unspecified concurrency semantics for reusable invites (added, Invariant 6); "hash where
practical" being too weak (now hash-by-default, Invariant 1); no rollback discussion (added to
Risks); and under-specified verification (expanded). Four items were genuine product/security
decisions rather than plan defects — DM-redemption authorization scope, single-use-vs-reusable
default, whether an emergency hotfix should precede the full fix, and whether rate limiting
should gate this plan — all four were put to the task owner and are recorded above as Decisions
1–4. Two "Assumed" items (row counts, existing UI pattern) were closed with a live read-only
query and a code check rather than left open. `docs/PACT-Code-Review-2026-06-29.md` was still not
read in full for this revision.

## Review outcome

| Reviewer | Model | Finding (condensed) | Severity | Confidence | Cross-reviewer agreement | Disposition |
|---|---|---|---|---|---|---|
| DeepSeek | Claude 3.5 Sonnet (self-identified) | Missing explicit deprecation of old `join_as_dm`/column | blocking | high | Also: Chat, Kimi, Grok | **Accepted** — step 5, Invariant 9 |
| DeepSeek | " | Contradiction: narrow-both vs. leave-invite_code-alone | blocking | high | Sole explicit "blocking" tag on this; others implied it | **Accepted** — step 3 fixed to `dm_invite_code` only |
| Kimi | Kimi k1.5 | "Fixed list of security properties" referenced but never included | blocking | high | Content gap independently filled by Chat's invariant list | **Accepted** — new Security Invariants section |
| Kimi | " | Scope contradicts goal on player-invite unification | blocking | high | — | **Accepted** — Goal reworded, not scope-expanded |
| Kimi | " | No emergency mitigation for a live bug | blocking | high | Also: Grok (Alternative A) | **Put to owner** — Decision 3: declined, no hotfix |
| Chat | GPT-5.6 Luna | DM-redemption authorization invariant undefined | (framed as required change) | high | Sole reviewer to frame this as the top issue | **Put to owner** — Decision 1: any authenticated account |
| Chat | " | Reusable-invite concurrency unspecified | (required change) | high | Also: DeepSeek | **Accepted** — Invariant 6 |
| Chat | " | Token hashing mentioned but not designed | (required change) | high | Also: Kimi, DeepSeek | **Accepted** — Invariant 1, hash-by-default |
| Chat | " | Old `join_as_dm`/`regenerate_dm_invite_code` retirement not explicit | (required change) | high | Also: DeepSeek, Kimi, Grok | **Accepted** — step 5, Invariant 9 |
| Chat | " | Would not default to reusable DM invites merely to preserve old behavior | (architectural point) | medium | Also: Grok | **Put to owner** — Decision 2: single-use default |
| Grok 4.5 | Grok 4.5 (self-identified) | Migration decision should be a pre-implementation gate/RFC | moderate | high | Universal (all 6) | **Accepted** — Decisions section added |
| Grok 4.5 | " | Rate limiting should split into its own plan/spike | moderate | high | Universal (all 6) | **Put to owner** — Decision 4: split off |
| Grok 4.5 | " | Phased hot-fix + later unification alternative not considered | moderate | medium–high | Also: Kimi | **Put to owner** — Decision 3: declined |
| Grok 4.5 | " | Verification lacks required committed-test artifacts | minor–moderate | high | Also: DeepSeek | **Accepted** — Verification section expanded with concrete cases |
| M365 Copilot | GPT-5 family (self-identified) | No explicit rollback strategy | moderate | high | Also: DeepSeek, Kimi | **Accepted** — added to Risks |
| M365 Copilot | " | Migration strategy deserves its own decision record | moderate | high | Universal | **Accepted** — Decisions section |
| M365 Copilot | " | Rate-limiting infra should be verified before committing architecture | moderate | high | Universal | **Accepted** — split off (Decision 4) rather than block on verifying |
| Gemini | Gemini (self-identified) | Rate-limiting assumption must be verified pre-implementation | blocking | high | Universal | **Accepted** — split off (Decision 4) |
| Gemini | " | Deprecate reusable DM invites entirely, single-use only | moderate | high | Also: Chat | **Put to owner** — Decision 2: single-use default (opt-in reusable kept, not fully deprecated) |
| Gemini | " | Missing user-communication step for breaking existing unredeemed codes | moderate | high | — | **Accepted** — folded into migration step 6 (fresh single-use tokens, not silently broken links; DM-facing communication is an implementation detail of step 7's UI, not a plan gap) |
| Gemini | " | Missing historical-exploit audit step | minor | medium | — | **Accepted (already done)** — live query in this revision found zero unauthorized co-DMs |
| (all 6) | — | Row counts and existing UI pattern were cheap-to-verify Assumed items | minor–moderate | — | 4–5 of 6 | **Accepted (already done)** — verified live, moved to Verified section |

Reviewer files: `z-cold-reviews/harden-invitation-system-review-{Grok-4.5,chat,deepseek,kimi,m365-copilot}.md`, `z-cold-reviews/hardening review Gemini.md`.
