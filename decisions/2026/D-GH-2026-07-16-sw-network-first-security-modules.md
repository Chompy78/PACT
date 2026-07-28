# D-GH-2026-07-16-sw-network-first-security-modules — widen network-first, no offline cost

Status: Active

- **Context:** `service-worker.js`'s `NETWORK_FIRST_RE` covered only `*.html`, `/PACT/`, and
  `js/engine.js` (REV-03) "so deployed fixes reach returning users immediately." `js/auth.js`,
  `js/supabase-client.js`, `js/sync.js`, `js/campaign.js`, `js/dm.js` were pre-cached and fell into the
  cache-first branch, so a client-side fix to one of them didn't reach a returning offline-capable user
  until the SW updated *and* they reloaded twice — the exact class of bug DM Console's `onAuthChange`
  fix (this same session) would otherwise have been slow to reach real users.
- **Options:** (a) widen `NETWORK_FIRST_RE` to include these 5 modules. (b) leave them cache-first and
  document why — RLS is server-authoritative, so a stale auth/sync client isn't itself a security hole.
- **Decision:** (a). Widened the regex; `CACHE_NAME` bumped `pact-v4`→`pact-v5` (this repo's standing
  convention for any `service-worker.js` caching-behavior or precache-list change, so `activate` purges
  the old cache immediately rather than waiting for these specific entries to naturally expire).
- **Why:** read `service-worker.js`'s fetch handler before deciding — its network-first path already
  does `.catch(() => caches.match(...))`, falling back to the cached copy when offline. Widening the list
  costs **zero** offline capability; it only changes online users from "stale until double-reload" to
  "immediate," identical to what `engine.js` already gets. Option (b)'s stated rationale (RLS is
  server-authoritative) is true but irrelevant to the actual tradeoff here, which turned out to be free.
- **Status:** Active.
