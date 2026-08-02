# D-GH-2026-08-02-invite-already-joined-message — clearer redemption message when a second invite finds an existing membership

Status: Active

- **Context:** Live report: a DM sent a player (Christen) two separate invite links to the same
  campaign. Christen said "only the first one worked and the second just took him to the first one he
  made." Investigation traced the actual mechanics: `sql/schema.sql`'s `redeem_player_invite` marks
  the second (never-before-redeemed) token as redeemed, then checks `is_campaign_member()` — true,
  since Christen already joined via the first invite — and raises `'You have already joined this
  campaign'`. This is the correct, deliberate one-character-per-player-per-campaign rule (also
  DB-enforced via `idx_characters_owner_campaign_unique`) working as designed — confirmed via SQL
  that Christen has exactly one character row, campaign membership intact, no data lost. The bug was
  purely presentational: `tools/PACT-CharGen-Webtool.html`'s `tryRedeem()` catch block showed this as
  `'Could not join campaign: You have already joined this campaign'` — reads as a failure for what is
  actually a harmless no-op, and gave Christen no explanation of what actually happened.
  - Considered whether DM Console could warn *before* generating a redundant second invite — ruled
    out: `create_player_invite`/`createPlayerInvite(campaignId, ap, budget)` takes no player identity
    at all (confirmed by reading both the RPC and its client wrapper), so there is nothing to check
    against at generation time; the DM can't know who will redeem a given token until they do.
- **Decision / what shipped:** `tryRedeem()`'s catch block now detects the `/already joined/i` message
  specifically and shows *"You're already in this campaign — this invite wasn't needed. Your existing
  character is shown below."* instead of the generic "Could not join campaign: ..." wording. No RPC
  or data-model change — this is a client-side message-only fix; the banner element itself was already
  neutrally styled (no red/error CSS), so no visual change beyond the wording.
- **Why:** the only point where "this player already has a character here" is knowable is at
  redemption time (invites are anonymous tokens, not player-targeted), so the fix has to live at that
  point. Worth a short record (not just a changelog line) because a future agent looking at
  `redeem_player_invite`'s "already joined" exception might reasonably assume it needs a data-model
  fix (e.g. relaxing the one-character-per-campaign constraint) — it doesn't; the constraint is correct
  and intentional, only the message needed to change.
- **Status:** IN FORCE. Verified: `testing/scripts/audit.py` and `engine-parity-ci.mjs` both green (no
  `js/engine.js` change, no `DATA.version` change). Not independently re-tested against a live
  duplicate-invite redemption (would require a second real test account) — the fix is a straightforward
  string-match on the RPC's own already-observed exact error text, confirmed correct by reading
  `redeem_player_invite`'s `raise exception 'You have already joined this campaign'` verbatim.
