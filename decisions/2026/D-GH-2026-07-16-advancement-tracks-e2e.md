# D-GH-2026-07-16-advancement-tracks-e2e — real-browser verification, one real bug fixed, one filed not fixed

Status: Active

- **Context:** PR #206 (`feat/advancement-tracks`) shipped three DM-tunable campaign advancement dials but
  was explicitly **not** browser-E2E'd — it needs real Supabase auth + a live campaign, which the headless
  `engine-parity` gate can't exercise. This roadmap follow-up task was to drive the real DM-panel↔bound-player
  round-trip in an actual browser and either fix or file any bugs found.
- **Options:** (1) stub Supabase like the existing `random-manual-e2e.mjs` harness does, to stay fully
  automatable/CI-safe. (2) Use real Supabase auth + the live (but pre-launch, no real user data) `PACT`
  project via a throwaway test DM account and player account. (3) Ask the human to do the manual pass by
  hand and just log the result.
- **Decision:** option 2. The whole point of this task is that a stub *can't* prove persistence or
  cross-account behavior — `campaigns.rules` round-tripping and a bound player actually seeing a different
  `Track-Level` than an unbound one are exactly the things a stub would fake. Created two throwaway test
  accounts (`e2e-dm-*@pact-test.invalid`, `e2e-player-*@pact-test.invalid`) and one throwaway campaign,
  drove the real UI with Playwright against the real project (`piuprrrnaotrtxucrtsb`), cross-checked
  persistence directly via SQL, and deleted every row it created afterward (verified zero rows remain,
  matched only by the exact throwaway identifiers — the three pre-existing real accounts/campaigns were
  never touched).
- **Why:** the app is confirmed pre-launch (no real characters/campaigns to protect, per `AGENTS.md`), so
  creating and then fully deleting a couple of throwaway rows in the live project is low-risk and the only
  way to actually prove the round-trip works, rather than assert it from reading the code.
- **Findings:**
  1. **Fixed** — `tools/DM-Console.html`'s `onAuthChange` callback bound its single parameter to the event
     string instead of the session object (`js/auth.js` calls `cb(event, session)`), so `updateAuth()`
     threw on `session.user.email` on every auth-state change. The same bug had already been fixed in Live
     Sheet and CharGen's own `onAuthChange` call sites — DM Console's campaign-auth wiring was the one
     remaining copy. One-line fix, same pattern as the other two tools.
  2. **Filed, not fixed** — `sql/schema.sql`'s `gen_invite_code()` and `create_player_invite()` (both
     `SECURITY DEFINER`, `search_path = public`) call bare `gen_random_bytes(...)`, which lives in the
     `extensions` schema, not `public`. Confirmed via SQL that **zero campaign rows existed anywhere in the
     project** before this run — right now nobody can create a campaign or a player invite anywhere in the
     deployed app. This is moot today only because no `tools/*.html` or `login.html` UI currently calls
     `createCampaign()` either (verified by grep). A live-DB migration to a schema-qualified call is a
     bigger blast-radius decision than this browser-verification task should make unilaterally, so it's
     left as a roadmap item instead of a same-PR fix.
  3. **Fixed (found by `/code-review`, addressed same-PR)** — finding 1's fix removed the crash that had
     been accidentally preventing `updateAuth()` from ever reaching `loadCampaigns()` more than once, which
     exposed a second, latent bug: `updateAuth()` called `loadCampaigns()`→`loadRoster()` unconditionally on
     *every* truthy-session auth event, including hourly `TOKEN_REFRESHED`, wiping the roster table's HTML
     (and any in-progress award-amount/note input a DM was mid-typing) for no reason. Added the same
     `wasSignedIn`/`nowSignedIn` sign-in-transition guard `tools/PACT-CharGen-Webtool.html`'s `updateAuth`
     already uses for this exact reason.
- **Verification:** all 5 checklist steps passed (controls render + live L20 preview + preset↔field sync;
  save→reload persistence confirmed via direct SQL; Starting-tier→invite Starting-budget prefill, editable;
  a campaign-bound character and an unbound character landed at the identical AP-spend and showed
  genuinely different Track-Levels — Track-Level 0 tuned vs. Track-Level 1 Standard — proving the tuned
  curve is actually in effect, not coincidentally matching). No console errors beyond a harmless missing
  `favicon.ico` 404 and one non-reproducing transient network blip. `engine-parity` still 20/0 (display-only
  feature, no `compute()`/`DATA.version` involvement).
- **Status:** Active. Follow-up needed: file the `gen_random_bytes` search-path bug as its own roadmap task.
