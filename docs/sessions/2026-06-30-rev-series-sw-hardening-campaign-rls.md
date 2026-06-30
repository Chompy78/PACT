# Session — 2026-06-30 · Code-review REV series: regression gate, SW hardening, campaign RLS

*History / non-authoritative. Authoritative state: `CHANGELOG.md`, `DECISIONS.md` (D-GH11, D-GH12).*

## Goal
Work through the HIGH-severity findings from the 2026-06-29 code review (REV-01 → REV-04), plus
associated SW hardening and docs cleanup.

## What we did

### REV-01 — Regression gate now asserts real values
The `engine-parity.html` test runner had `pass` hard-coded to `true` and all CSV columns blank — it
always passed regardless of engine output. Rewrote the runner with two modes: **Capture baseline**
(dumps live engine output to CSV for human review) and **Run tests (assert)** (fetches the CSV and
fails on any diff). Baseline captured and confirmed at engine v0.332: CG-001/002/003 (build tests),
LS-001/EV-001 (event-log tests). Gate now reports a real FAILED test when `compute()` output changes.

### REV-02 — SW cross-origin cache fix
The service-worker fetch handler claimed to filter same-origin requests in a comment but had no actual
guard. Supabase API calls and CDN responses were being intercepted and cached, causing stale API
responses and potential cross-user data to accumulate in Cache Storage. Fixed by adding
`url.origin !== self.location.origin → return` at the top of the fetch handler.

### REV-03 — SW network-first for HTML + engine.js
Cache-first for HTML and `engine.js` meant a deployed rules fix wouldn't reach returning users until
the SW itself was re-installed. Added `NETWORK_FIRST_RE` regex; HTML pages and `engine.js` now try
the network first and fall back to cache only when offline. Icons and supporting JS stay cache-first.
See D-GH11 for the full decision rationale.

### REV-04 — Campaign RLS: close the campaign-join bypass
Players could directly UPDATE `characters.campaign_id` to any UUID, bypassing `join_campaign()` and
the invite-code flow. Fixed by removing `campaign_id` from the player column-level UPDATE grant and
tightening the INSERT policy with `AND campaign_id IS NULL`. `join_campaign()` (SECURITY DEFINER) is
now the sole path. See D-GH12.

### CU-5 — Deduplicate D-GH7 in DECISIONS.md
Two entries shared the code `D-GH7`. The older "PWA SW registration" entry was renamed to `D-GH8`;
backreferences in the session file and CHANGELOG updated. The campaign-play entry (the real D-GH7)
and all its callers unchanged.

### Task 5 hardening (SW, offline, manifest)
- `login.html` and five JS modules added to `PRE_CACHE` so tool pages work offline from a cold install.
- `CACHE_NAME` bumped to `pact-v2`.
- Removed unconditional `self.skipWaiting()` from the SW install handler — SW now skips waiting only
  when a client posts the message, allowing the update-notification UI to fire correctly.
- SW registration added to `login.html` (the one page that was missing it).
- `"purpose":"maskable"` added to the 512-px manifest icon (Android adaptive-icon fix).
- `<link rel="preconnect">` added for `esm.sh` and the Supabase origin in `index.html`.

### Dual-source AP (engine + Live Sheet)
`compute(b, opts)` and `rebuildStateFromEvents(base, events, opts)` extended to accept
`{ dmAp, ignorePlayerAp }`. When `dmAp` is provided it blends with (or replaces) player-log AP.
Live Sheet cloud-load path stores `rec.ap` as `window._dmAp`; `render()` and `refreshBuy()` adjust
the budget before calling `compute()`. An "X from DM" chip appears in the ecoline bar. Fully
backward-compatible — callers with no opts see identical output.

## Notes / follow-ups
- REV-04 migration (`sql/migrations/2026-06-30-rev04-campaign-rls.sql`) must be applied to any
  existing live DB.
- CU-1, CU-2, CU-3 remain open in the NOW bucket.
- `engine-parity.html` stayed at 5/0 throughout all changes (engine logic untouched for REV-02–04;
  REV-01 added the assertion layer itself).
- **2026-07-01:** REV-04 migration applied to live Supabase DB and verified via REST API — a player
  `PATCH` setting `campaign_id` and a player `POST` with `campaign_id` set both returned 403; `join_campaign()` confirmed unaffected.
