# D-GH-2026-08-10-invite-peek-auth-scope — invite-name lookup is authenticated-only

Status: **Active**, 2026-08-10.

## Context

Two related 2026-08-04 review findings shared one missing piece: a way to resolve a player-invite token
to `{campaignName, valid}` WITHOUT redeeming it.
1. CharGen's `tryRedeem()` confirm() dialog could not name the campaign an invite belonged to (LOW,
   recorded WON'T FIX for this reason) — the campaign name only ever arrived with
   `redeemPlayerInvite()`'s response, and prompting after redemption would be confirming an act already
   taken.
2. A revoked/expired invite link looked identical to a live one when opened signed out (MEDIUM,
   PARTIALLY FIXED — the banner stopped promising validity but still can't check it, since
   `campaign_invites` grants nothing to `anon`).

## Options

- **A — `authenticated`-only.** Fixes finding 1 (the player redeeming an invite is, by the time
  `tryRedeem()` reaches this code, already signed in — its own signed-out branch returns earlier).
  Does NOT fix finding 2 — `anon` still has no read path onto invite validity. (Chosen.)
- **B — anon-callable.** Fixes both findings, but lets anyone probe whether a token exists/is live with
  no rate limiting anywhere in this schema — `feat/invite-rate-limiting` (a separate, not-yet-built NEXT
  item) would need to land first for this to be a deliberate, safe decision rather than a new hole.

## Decision

**`authenticated`-only**, revoked from `PUBLIC` explicitly (`revoke execute ... from public`, the same
pattern every other RPC in this schema uses — new functions inherit PUBLIC execute by default in
Postgres). `peek_player_invite(p_token)` is a new `SECURITY DEFINER` function
(`sql/migrations/2026-08-10-peek-player-invite.sql`), pure `SELECT`, mirroring `redeem_player_invite`'s
own token lookup (`token = p_token and type = 'player'`) and validity criteria (unredeemed, unrevoked,
unexpired) so the two functions can never disagree about what "valid" means.

Wired into CharGen's `tryRedeem()`: called before the `confirm()` dialog, which now names the campaign
when available; a token that resolves as invalid short-circuits with a clear banner message instead of
ever showing a confirm the player has no useful way to act on. Best-effort — a peek failure (network, or
a client running against a not-yet-migrated database) falls back to the pre-existing nameless confirm()
copy rather than blocking the invite outright.

**Finding 2 (the signed-out banner) stays unfixed**, as an accepted, explicit tradeoff — not an
oversight. It is filed on `feat/invite-rate-limiting` in the task board rather than solved here.

## Why

Anon-callable would have been a straightforward code change, but it trades a cosmetic gap (a dead link
looking live for the few seconds before sign-in) for an always-on, unrate-limited way to enumerate which
tokens exist against the live database — a materially worse trust boundary than the UX gap it would
close. The `authenticated`-only scope gets the more valuable of the two findings (a player about to
accept an invite gets to see what they're accepting) without that cost, and leaves the harder call for
when rate limiting actually exists to make it safe.

## Verification

`get_advisors(security)` run immediately after applying the migration: `peek_player_invite` appears
under `authenticated_security_definer_function_executable` — the SAME expected/accepted WARN class every
other authenticated-only SECURITY DEFINER RPC in this schema already carries (confirmed by direct
comparison: `archive_campaign`, `award_ap`, `bind_character_to_campaign`, `redeem_player_invite`, etc. —
20 total), not a new finding category. `get_logs(postgres)` skimmed for the migration window: no errors,
only the expected DDL statement log. Grants confirmed directly via `information_schema.routine_privileges`:
only `postgres` (owner) and `authenticated` hold EXECUTE — `anon`/`PUBLIC` do not. Client-side: CharGen
boots with no JS errors and `window._campaignBridge.peekPlayerInvite` is bridged (verified via the
project's zero-dependency CDP technique). The full accept-an-invite flow through `tryRedeem()` needs a
real signed-in session to exercise end-to-end and could not be driven in this session — same limitation
already documented for other sign-in-gated CharGen paths (see `onSaveClick()`'s comment in
`tool-pricing-ci.mjs`); `cloud-e2e` is the intended coverage for that half and was not run here.
`testing/scripts/engine-parity-ci.mjs` and `tool-pricing-ci.mjs` are unaffected (no engine/pricing code
touched) and still report 0 failed.

## Related

- 2026-08-04 usability/security review — both original findings.
- `feat/invite-rate-limiting` — the NEXT-board prerequisite for ever revisiting Option B.
- `docs/TASK_BOARD_NOW.md`'s `fix/harden-invitation-system` (already shipped, D-GH-2026-08-09) — a
  different invite surface (`campaigns.dm_invite_code`/`join_as_dm`), explicitly out of scope here.
