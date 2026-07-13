// PACT — single shared Supabase client.
//
// Vanilla ES module: pulls supabase-js straight from a CDN (no npm/build step).
// The publishable key is SAFE to ship in client code — the database is protected
// by Row-Level Security (see sql/rls-policies.sql), not by hiding this key.
// NEVER put the secret/service_role key in here.

// Pinned to an EXACT version (not the `@2` major) so a CDN-side minor/patch release can't silently
// change offline/auth behaviour under us. To bump: pick a new 2.x, update this line AND the version in
// the e2e stub route (testing/scripts/random-manual-e2e.mjs uses a version-agnostic regex, so it keeps
// matching), then re-run the pre-release QA. `@2` last resolved to 2.110.2 (2026-07-13).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.2';

export const SUPABASE_URL = 'https://piuprrrnaotrtxucrtsb.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_oUOXbf432dY6_XBF1RcCuw_nFfLBbUC';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,        // keep the session in localStorage
    autoRefreshToken: true,      // silently refresh the access token
    storageKey: 'pact-auth',     // namespaced so it can't clash with anything else
  },
});
