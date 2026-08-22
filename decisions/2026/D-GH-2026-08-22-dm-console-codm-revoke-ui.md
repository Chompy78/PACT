# D-GH-2026-08-22-dm-console-codm-revoke-ui — a "Current co-DMs" list with a Remove action

## Context
The 2026-08-22 full-tool audit (D3) found that DM Console's co-DM management was one-directional: a DM
could generate an invite and withdraw it while unredeemed, but once someone actually redeemed one and
joined `campaign_dms`, there was no way in the console to see who currently held DM access to a campaign
or to remove them. Given this project's own history with a confirmed live privilege-escalation bug via
the old `campaigns.dm_invite_code`/`join_as_dm()` mechanism (hardened, see
`fix/harden-invitation-system` in `CHANGELOG.md`), this reads as a real follow-on gap: hardening how
access is *granted* doesn't help a campaign owner who needs to undo a mistaken or compromised grant
after the fact.

The backend already had what was needed — `removeDm(campaignId, profileId)` and
`getCampaignDms(campaignId)` are both implemented and exported from `js/campaign.js`, confirmed unused
anywhere in `tools/DM-Console.html` (grep across the whole file for either name returned nothing). This
was UI wiring work, not new backend design.

## Decision
**Verified server-side authorization before wiring anything.** Read `remove_dm(p_campaign, p_profile)`
directly in `sql/schema.sql`: it's `SECURITY DEFINER`, checks `is_campaign_owner(p_campaign)` and raises
if the caller isn't the owner, and separately blocks removing the campaign's own owner (`p_profile = ...
campaigns.dm_id` → raise). `campaign_dms`'s RLS `select` policy (`sql/rls-policies.sql`) allows any DM or
member of the campaign to read the roster (`is_campaign_dm(campaign_id) or
is_campaign_member(campaign_id)`) — reasonable for a read (seeing who else has access isn't itself
sensitive), while writes stay RPC-only. This confirmed the backend was already correctly designed for
exactly this feature — the client-side gate added below is a UX nicety ("don't show a co-DM a button
that would just fail"), not the real authorization boundary, which is worth stating plainly given this
project's repeated lesson (the invite-system incident, the archived-campaign RPC finding from the same
audit batch) that a client-side-only gate is not a security boundary.

**UI:** a new owner-only collapsible tile ("Current co-DMs") in the campaign panel, next to the existing
"Invite a co-DM" tile. Gated identically to the existing "Archive campaign" button
(`camp.isOwner` — `display:none` otherwise), populated via `getCampaignDms()` on campaign select (mirroring
`loadInvites()`'s stale-response-guard shape: a `forCampId` closure variable checked against
`currentCampId` after the fetch resolves, so a campaign switch mid-fetch can't overwrite the now-current
campaign's list with stale data). Each row shows the co-DM's display name (escaped via `esc()` — a
player-controlled field crossing into the DM's browser, the exact class of gap this project's hard
`esc()` invariant exists for) and a Remove button; Remove confirms first, naming the co-DM and the
consequence, matching this file's established confirm-before-destructive-action pattern.

**Test coverage without a live backend.** Added `window._dmCoDmsTest` (`{render, setRows}`), the same
synthetic-data test-seam shape already used for `window._dmPartyDowntimeTest` and others in this file —
lets `tool-pricing-ci.mjs` drive `renderCoDms()` and the Remove button's click handler against synthetic
rows and a stubbed `window._campBridge.removeDm`, with no sign-in or live Supabase connection required.
Four new checks: rendering produces one row per co-DM with the Remove button correctly keyed to
`dm_id` (and confirms a malicious `display_name` can't inject via this new render path — same
esc()-coverage discipline the 2026-08-22 audit's XSS batch established); an empty list shows a
placeholder rather than a blank panel; clicking Remove confirms first and then calls
`removeDm(campaignId, dmId)` with the right arguments and reloads the list; declining the confirmation
calls nothing.

**Not tested: the peek-block guard on this specific button.** The Remove handler uses `_peekBlocks()`
(the same idiom `campArchiveBtn`'s own dedicated click handler uses — a campaign-level, not
per-character, write action), but `peekCamp` — the closure variable that guard reads — has no existing
test seam exposing it for direct manipulation (the existing archived-peek test for a different handler
shape stubs `window._dmPeekBlocks` instead, which my handler doesn't call). Not adding a new seam for
this alone: `_peekBlocks()` itself is already exercised elsewhere in this file's test suite, and this
usage is a one-line reuse of an already-correct, already-tested function in the exact idiom its closest
analog (`campArchiveBtn`) already uses — low enough risk of being wrong that a dedicated test wasn't
worth the seam.

## Why
**Why this shipped as a small feature rather than deferred like the archived-campaign RPC finding from
the same audit batch.** Both D3 and D4 (this audit's other DM Console/campaign-authorization finding)
touch the same general area — campaign access control — but they're a different risk shape. D4 required
a production RLS/RPC *schema* change (adding an `archived_at` check to several DM-write RPCs), which is
exactly the class of change this project's own standing rule requires a cold plan review for. D3 required
*no* backend change at all — the RPC and RLS were already correct and already shipped; this was pure UI
wiring to something that already existed, verified safe before touching it. That's a materially lower
risk tier, consistent with AGENTS.md's own Risk-rubric framing (ambiguity low, damage scale low — additive
UI, no schema change — damage likelihood low).

**Why the confirm-before-remove copy names the consequence explicitly** ("They lose DM access
immediately... They keep any characters they play, and can be re-invited later") rather than a generic
"Remove this co-DM?" — matching this file's own established pattern (e.g. the "Remove from campaign"
confirm on a character) of stating what specifically does and doesn't happen, since "revoke someone's DM
access" is exactly the kind of action where an owner might reasonably worry it also affects that person's
own characters (it doesn't) and the copy should say so rather than leave it to be discovered.

## Status
Implemented on `feat/dm-console-codm-revoke-ui`, off `preview` at the post-PR-#451 tip.
`engine-parity-ci.mjs`: 57/0 (untouched — no engine change). `tool-pricing-ci.mjs`: 167/0 (163 existing +
4 new). `docs/TASK_BOARD_NEXT.md` graduated for this finding (D3). Not independently verified against a
live two-account signed-in session (this environment has no such harness) — the removal mechanism's
correctness rests on the RPC/RLS reading above (no session-level caching layer sits between a request and
`campaign_dms`, so a removed co-DM's very next request re-evaluates `is_campaign_dm()` against the
now-deleted row) rather than an observed live revocation. Flagged here rather than silently assumed.
