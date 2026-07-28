# D-GH42 — Cloud/campaign status badge reads existing sync-ready state — no new cloud/auth plumbing

Status: Active

- **Context:** the "Cloud/campaign state is invisible to players" roadmap task needed Live Sheet to show a
  persistent sign-in + campaign-rules-fetch-status badge outside the ☁ Cloud dropdown. This was picked and
  built while another session was concurrently on `feat/engine-bridge-all-tools`, actively migrating
  `activeEvents`/`economy`/`foldBuild` (and touching the tools' bootstrap/module-bridge code) across all
  three tools — the same files this task needed to touch.
- **Options considered:** (A) add a dedicated status-tracking module/service with its own auth/campaign
  polling; (B) derive the badge purely from state the existing `sync-ready` closure already computes
  (`_session` from `A.onAuthChange`/`A.currentSession()`, campaign name + fetch outcome from the existing
  `refreshCloudCampaignRules()` and the cloud-load-btn handler), adding only two new local variables
  (`_campaignName`, `_rulesStatus`) and a `renderCloudStatusBadge()` call at their existing update sites.
- **Decision:** (B). No new fetches, no new globals beyond the two closure-local display variables, and
  zero edits to `js/engine.js`/`js/auth.js`/`js/sync.js`/`js/campaign.js` or the module-bridge bootstrap
  block itself — only the pre-existing `sync-ready` listener body and static header/toolbar markup in
  `tools/PACT-CharGen-Webtool.html`/`tools/PACT-Live-Char-Sheet.html` changed.
- **Why:** keeps this a strictly additive, display-only diff with minimal surface overlap against the
  concurrently in-flight engine-bridge migration, so both branches rebase cleanly against `preview`
  regardless of merge order. (A) was rejected as unnecessary duplication of state `refreshCloudCampaignRules()`
  already tracks, and as a larger, riskier diff for a display-only task.
- **Status:** DONE. If a future bridge migration changes how `_cloudCampaignRules`/campaign data is
  fetched, `renderCloudStatusBadge()`'s two call sites (`refreshCloudCampaignRules()` and the cloud-load
  button handler in `tools/PACT-Live-Char-Sheet.html`) are the only places that need updating.
- **Addendum (2026-07-10, docs-consistency audit):** originally logged as `D-GH30`, colliding with two
  other same-day entries also claimed as `D-GH30` (this one and "D-GH numbering: verify against the live
  remote…", both merged within ~8 minutes of each other on 2026-07-08 — the live-remote-check policy that
  same pair of collisions prompted "narrows the window but can't fully close it," per its own Why). Kept
  the earlier-merged "Live Sheet's 'AP left' reads the frozen ledger" entry at `D-GH30`; renumbered this
  one to `D-GH42` (next free at time of fix). `CHANGELOG.md`'s "surface cloud/campaign status" entry
  updated to match.
