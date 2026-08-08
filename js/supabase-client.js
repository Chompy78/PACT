// PACT — single shared Supabase client.
//
// Vanilla ES module: pulls supabase-js straight from a CDN (no npm/build step).
// The publishable key is SAFE to ship in client code — the database is protected
// by Row-Level Security (see sql/rls-policies.sql), not by hiding this key.
// NEVER put the secret/service_role key in here.

// Pinned to an EXACT version (not the `@2` major) so a CDN-side minor/patch release can't silently
// change offline/auth behaviour under us. To bump: change ONLY this line to a new 2.x, then re-run the
// pre-release QA. The e2e stub (testing/scripts/random-manual-e2e.mjs) matches the import with a
// version-agnostic regex, so it needs no edit on a bump. `@2` last resolved to 2.110.2 (2026-07-13).
// Vendored locally (D-GH-2026-08-03-vendor-supabase-js). This used to be an esm.sh URL, which made
// every cloud feature depend on a third-party CDN at page load — and an ES module import failure
// aborts the whole script, so an outage or a block took the cloud half of every tool down. The
// filename is version-pinned so it can never go stale in the service-worker cache; updating means a
// new filename. See js/vendor/supabase-js-2.110.2.js for provenance and the update procedure.
import { createClient } from './vendor/supabase-js-2.110.2.js';

export const SUPABASE_URL = 'https://piuprrrnaotrtxucrtsb.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_oUOXbf432dY6_XBF1RcCuw_nFfLBbUC';

// A page-lifecycle flush (e.g. on `pagehide`, when a tab is closing or navigating away) needs its one
// outgoing request to survive the page tearing down, which a plain `fetch()` does not guarantee — the
// browser can abort an in-flight request once teardown starts. `keepalive: true` is the fetch option that
// lets a request outlive page dismissal (subject to a small body-size cap and a per-origin quota).
// `navigator.sendBeacon` was considered and rejected for this: it cannot carry the Authorization/apikey
// headers an authenticated Supabase write needs. `withKeepalive(fn)` flags the very next request THIS
// client makes to opt into `keepalive` — scope it tightly (wrap exactly one call) since the flag is a
// single shared mutable toggle. Even with keepalive this is best-effort, not a delivery guarantee, on
// every browser/OS — see docs/plans/2026-08-08-header-simplification-universal-autosave.md, Part A.
let _keepaliveNext = false;
export async function withKeepalive(fn) {
  _keepaliveNext = true;
  try { return await fn(); } finally { _keepaliveNext = false; }
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,        // keep the session in localStorage
    autoRefreshToken: true,      // silently refresh the access token
    storageKey: 'pact-auth',     // namespaced so it can't clash with anything else
  },
  global: {
    fetch: (url, options) => fetch(url, _keepaliveNext ? { ...options, keepalive: true } : options),
  },
});
