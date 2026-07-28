# D-GH-2026-07-13-campaign-invite-tokens — Campaign join/invite UI, Deliverable 1 (Path A): single-use per-player tokens

Status: Active

- **Context:** `join_campaign()` already lets a player join via the campaign's shared, reusable
  `invite_code`, but it only ever creates a blank `livesheet` character with no way for the DM to
  preset a starting AP/budget. `docs/plans/2026-07-11-campaign-join-invite-flow.md` (through three
  cold reviews, Revision 2) designed a second, distinct mechanism — Path A — for this: a single-use,
  per-player token a DM issues with a preset starting AP + budget, which the player redeems into a
  brand-new campaign-bound `chargen` character built from a known-legal budget from the start (no
  retroactive validation needed, since there's no build until the token is redeemed). Revision 2 had
  one open blocker: it depended on the "Campaign AP model" work (`feat/campaign-ap-model`) to give
  CharGen any DM-AP concept to seed. That prerequisite shipped and closed 2026-07-12. This session
  re-verified Revision 2's facts against the now-current code (Revision 3) before implementing —
  everything held, with one concrete improvement: CharGen's cloud save/load (which didn't exist as a
  shipped feature when Revision 2 was written) now has ready-made `_cgEnvelope`/`_cgApplyEnvelope`/
  `currentCharId()` helpers and an existing DM-AP-status resolution pattern (`onLoadClick`) that
  redemption should call directly instead of re-deriving.
- **Options (token generation):** (A) reuse the 6-char `gen_invite_code()` alphabet/length used for
  the shared `invite_code`/`dm_invite_code`. (B) a longer, higher-entropy CSPRNG token (32 hex chars
  from 16 `gen_random_bytes`), since this token travels only in a URL and is never hand-typed, unlike
  the 6-char codes.
- **Decision (A):** (B) — the existing 6-char alphabet is sized for manual entry; a URL-only,
  single-use token has no such constraint, so it uses more entropy. The uniqueness-check loop is kept
  for consistency with `gen_invite_code()`'s pattern even though 128 bits is already effectively
  collision-free.
- **Options (auth-survival across the invite link):** (A) rely on the query param surviving whatever
  auth navigation happens. (B) stash the token in `sessionStorage` before any auth step, since CharGen
  has no inline sign-in form (it only links out to `login.html`), so a real page navigation happens
  for any unauthenticated player. (C) build a full inline sign-in/register form inside CharGen so the
  player never leaves the page.
- **Decision (auth-survival):** (B), plus a small, generic addition to `login.html` itself: after a
  successful sign-in, if a pending invite token is stashed, redirect back to CharGen with it rather
  than showing the normal signed-in view. (C) was rejected — it would duplicate `login.html`'s
  existing, working auth-form UI/logic (email/password, register, forgot-password) inside CharGen for
  a first version, which is more new surface area than the problem needs; the login.html redirect-back
  hook is small, generic, and reusable rather than a one-off hack.
- **Why:** matches the plan's own decisions 1–7 (one character per player per campaign enforced
  server-side; token-possession = authorization, no per-recipient binding in v1; no expiry/revocation
  enforcement in v1, column reserved; `redeem_player_invite` is idempotent for the same user so
  double-click/interrupted-client recovery doesn't error). The single function body per RPC gives one
  implicit transaction, so a failed character insert (e.g. "already joined") auto-rolls-back the token
  claim — no orphaned-consumed-token failure mode.
- **Status:** Shipped (`feat/campaign-invite-tokens`). Migration applied directly to the live
  Supabase project via the MCP `apply_migration` tool (user explicitly chose this over manual
  SQL-editor application when asked); Supabase security advisor shows no new class of finding, only
  the same "authenticated can execute this SECURITY DEFINER function" WARN every other campaign RPC
  in this app already carries by design. Schema/RLS/grants verified via direct introspection
  post-apply (RLS enabled; exactly one SELECT policy matching the DM-or-redeemer rule; `authenticated`
  has no direct write grant on `campaign_invites`; both functions confirmed `SECURITY DEFINER`).
  **Known gap:** full browser click-through (DM creates an invite in DM Console, a real player account
  redeems it in CharGen) was not exercised — this environment has no way to drive a real two-account
  browser session without creating test data in the live production project, so that pass is still
  owed before this feature is exercised for a real campaign. Path B (binding an existing built
  character to a campaign via the shared invite code) is a separate, still-open deliverable — the
  plan's own recommended split, tracked as its own roadmap item.
- **Follow-up: `/code-review ultra` pass (2026-07-13), 10 finder angles, ~15 findings triaged.**
  Two were genuine correctness bugs beyond polish: (1) `redeem_player_invite`'s original shape checked
  idempotency BEFORE attempting the claim, so two truly concurrent calls from the same user (a
  double-click) could race — the loser's own claim then found 0 rows and raised "invalid or already
  redeemed" instead of recovering. Fixed by attempting the atomic claim FIRST and only falling back to
  the idempotency check on 0 rows affected, which correctly recognizes "it was actually me" regardless
  of commit order. (2) The client unconditionally re-seeded and overwrote a character's `stats` on
  every redemption, including an idempotent replay (double-tab, retry) — silently destroying any real
  progress made since the first successful redemption. Fixed by having `redeem_player_invite` return
  `campaign_id`/`is_new` so the client only seeds on a genuinely fresh redemption and otherwise loads
  the existing character instead. Also fixed: a stale/declined/errored pending-invite token was never
  cleared from `sessionStorage`, so `login.html`'s new resume-after-sign-in hook could hijack any later
  unrelated sign-in in the same tab (moved the resume call out of the generic boot-time `showSignedIn()`
  into only the two actual submit-driven sign-in paths, and clear the token on decline/error too); the
  `onAuthChange` handler re-firing `tryRedeem()` on every session event including hourly
  `TOKEN_REFRESHED` (now guards on an actual sign-in transition, matching the existing pattern used
  elsewhere in the same file); `create_player_invite`'s `< 0` check silently passing a NULL argument
  through SQL's three-valued logic; `js/campaign.js`'s `| 0` coercion wrapping huge inputs via 32-bit
  truncation instead of leaving Postgres to reject them; a redundant `loadCharacter()` round-trip now
  avoided on the common (fresh-redemption) path since the RPC returns `campaign_id` directly; and the
  DM-AP-status-resolution duplication between `onLoadClick` and the redemption flow, now a single
  shared `_cgResolveDmApStatus()` helper. Full findings list in the PR's code-review report.

---
