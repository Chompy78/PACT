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

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,        // keep the session in localStorage
    autoRefreshToken: true,      // silently refresh the access token
    storageKey: 'pact-auth',     // namespaced so it can't clash with anything else
  },
});
