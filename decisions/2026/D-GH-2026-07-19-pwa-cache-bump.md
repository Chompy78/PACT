# D-GH-2026-07-19-pwa-cache-bump — propagate the Continue feature to already-installed PWA users, plus a PWA-completeness audit

Status: Active

- **Context:** promoting `preview`→`main` for the Continue-recent-chars feature (D-GH-2026-07-18) raised
  the question of whether merging alone was enough to actually reach users. Tracing `service-worker.js`'s
  caching strategy found `js/character-store.js` — the file `recordAutosave`/`readRecent` was added to —
  is deliberately **cache-first**, and `service-worker.js` itself wasn't touched by that PR, so browsers
  wouldn't even detect a new SW version to install. A returning/already-installed user would silently keep
  the pre-Continue-feature `character-store.js` indefinitely; only first-time or cache-cleared visitors
  would get it. Asked to check "do we have this for all the other things" prompted a broader PWA audit
  (`manifest.json`, every `js/*.js` file's cache policy, icon wiring) rather than fixing only the one file.
- **Options (cache staleness):** (a) bump `CACHE_NAME` so `activate` purges the old cache and `install`
  re-fetches `PRE_CACHE` fresh. (b) leave it — the fix reaches users eventually as their cache naturally
  churns. (c) move `character-store.js` to network-first permanently.
- **Options (the audit's other findings, once made):** widen `NETWORK_FIRST_RE` to also cover
  `js/ui-helpers.js`/`ap-by-level.js`/`advancement.js` (found uncovered by *either* precache *or*
  network-first — same staleness risk class, pre-existing, not introduced by this session) vs. leave them
  cache-first and accept the risk. Wire up the unused `apple-touch-icon.png` asset via an explicit
  `<link>` tag vs. leave iOS relying solely on the manifest's icon entry.
- **Decision:** (a) for this release — `pact-v6`→`pact-v7`. For the audit findings: widened
  `NETWORK_FIRST_RE` to include `ui-helpers.js`/`ap-by-level.js`/`advancement.js` and added all three to
  `PRE_CACHE`; added `<link rel="apple-touch-icon" href="/PACT/icons/apple-touch-icon.png">` to
  `index.html`. Left as explicitly-flagged-not-fixed: `login.html`/`docs/PACT-Players-Guide.html` don't
  declare `<link rel="manifest">` (low-impact — `start_url` is `index.html`, the true installable entry
  point), and the apple-touch-icon tag was added only to `index.html`, not the individual tool pages.
- **Why:** (a) over (c) — `D-GH-2026-07-16-sw-network-first-security-modules` already established that
  `character-store.js` staying cache-first is a deliberate choice ("for speed"), so this is a one-time
  propagation problem, not a reason to reverse that choice; a `CACHE_NAME` bump is this repo's own standing
  convention for exactly this situation. Widening `NETWORK_FIRST_RE` for the three newly-found files
  applies the *prior* decision's own reasoning rather than re-deciding it — `ui-helpers.js` holds `esc()`,
  arguably more security-relevant than the auth/sync modules that decision already covers, so leaving it
  cache-first was the harder position to defend once found. The apple-touch-icon gap was worth a fix, not
  just a note, because the asset and manifest entry already existed with obvious intent — wiring up an
  existing 5-line asset is lower-risk than leaving a half-finished feature in place. The two left-flagged
  items were judged genuinely lower-stakes (an edge case for bookmarked non-entry pages) and kept out of
  scope rather than silently expanding this fix further.
- **Status:** Active. Verified: regex unit-tested against all `PRE_CACHE`/`NETWORK_FIRST_RE` file paths
  (10/10), `apple-touch-icon.png` path confirmed to exist at the referenced location, parity 20/0.
