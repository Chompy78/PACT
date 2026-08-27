# D-GH-2026-08-25-password-reset-flow — password reset was broken end-to-end; fixed the redirect target and built the missing recovery page

## Context
Reported by the owner: clicking the reset link in the recovery email took them to the main PACT
homepage, not anywhere they could set a new password. Confirmed as **two** defects, not one — fixing
only the link would still have left the flow dead:

1. **Wrong destination.** `js/auth.js`'s `forgotPassword()` called `resetPasswordForEmail(email,
   {redirectTo: REDIRECT_BASE})`, and `REDIRECT_BASE` is `https://chompy78.github.io/PACT/` — the app
   menu. `index.html` has no recovery handling, so the recovery session Supabase establishes as part of
   the redirect was silently discarded.
2. **There was no reset page at all.** `updatePassword(newPassword)` (calling
   `supabase.auth.updateUser({password})`) already existed in `js/auth.js`, but nothing anywhere called
   it — verified by grep across every `.html`/`.js` outside `js/vendor/`. `login.html` had no recovery
   branch and no new-password form, so even pointed at `login.html` the link would have landed on a
   plain sign-in form the user couldn't use for this purpose.

## Decision
**Redirect target: `login.html`, not a new dedicated page.** One auth page, one place service-worker
caching has to be right — matches the task's own stated preference, and the fragment-handling
complexity that would have justified a dedicated page turned out to be manageable inline.

**How the recovery redirect is detected — read from the actual vendored Supabase client source, not
assumed from memory.** Read `js/vendor/supabase-js-2.110.2.js` directly to confirm the real mechanics
before writing any detection logic:
- This client's config (`js/supabase-client.js`) never sets `flowType`, and the library's own default is
  `flowType:'implicit'` (confirmed in the vendored source) — so a recovery link redirects with
  `#access_token=...&type=recovery&...` in the URL **fragment**, not a `?code=...` query param (that's
  the PKCE-flow shape, not in use here).
- An invalid/expired/already-used token instead redirects with `#error=...&error_code=...&error_description=...`
  — Supabase's own `/auth/v1/verify` endpoint distinguishes these **before** the browser ever reaches our
  page, so a single hash-shape check reliably tells the two cases apart without needing to inspect
  anything about the token itself.
- The client's `_getSessionFromURL()` clears the hash (`window.location.hash = ''`) as part of parsing
  it, and dispatches `PASSWORD_RECOVERY` via `onAuthStateChange` inside a `setTimeout(fn, 0)` — both
  async, racing against our own page's boot code in a way that isn't spec-guaranteed to resolve one way
  or the other.

**Race avoided with a synchronous pre-import hint, not by trusting event timing alone.** A plain classic
`<script>` block (no `type="module"`) runs *before* the module script in document order — guaranteed by
the HTML spec, not a timing assumption — so it reads `location.hash` for `type=recovery` / `error=`
*before* the Supabase client (imported by the module script that follows) gets any chance to touch the
URL. This sets `window.__pactAuthRedirect = {recovery, error, errorDescription}`, which the module
script's boot logic branches on. The `PASSWORD_RECOVERY` event is still used as the authoritative
confirmation that a real recovery session was established (showing the actual new-password form only
once it fires) — the sync hint decides *which view to show first*, not whether the password change is
allowed to proceed.

**The existing "already signed in → bounce to index.html" boot check had to move behind the
recovery/error branches, not just coexist with them.** Supabase's recovery flow establishes a real
session as part of the redirect, so `currentUser()` resolves truthy for a genuine recovery visit too —
without reordering, that bounce would fire before the new-password form ever had a chance to show,
silently reproducing a shape of the original bug (arrive with a valid recovery link, get bounced away
without changing anything) even after the redirect URL itself was fixed.

**Separate `RESET_REDIRECT` constant, not a repointed `REDIRECT_BASE`.** `REDIRECT_BASE` is also
`signUp()`'s `emailRedirectTo`, where the homepage genuinely is the correct target — confirmed unchanged
and verified via grep that no other call site uses `forgotPassword`/`updatePassword` besides
`login.html`.

**Expired/invalid-token UX:** a distinct view (`recoveryExpired`) with a plain-language message and an
inline "send a new reset email" field reusing `forgotPassword()` — not a blank form or a raw error. Also
reached by a defensive 5-second timeout if the sync hint found `type=recovery` with no `error=` param but
`PASSWORD_RECOVERY` still never fires (a malformed-redirect case the hint alone wouldn't catch).

## Why
**Why a dashboard step is called out explicitly rather than silently assumed done.** The task's own text
flagged that the Supabase project's Auth → URL Configuration → Redirect URLs allow-list may be the *real*
reason this was landing on the homepage — a redirect not on that list is silently rewritten to the Site
URL, which would make the code fix alone a no-op. Checked directly: the Supabase MCP tool surface
available in this session (`get_project`, `list_tables`, `get_advisors`, `execute_sql`,
`apply_migration`, `query_logs`, branch/project management) has no tool exposing Auth configuration —
confirmed via two separate keyword searches of the tool registry, not assumed from the absence of an
obviously-named tool. This setting is genuinely dashboard-only from this session's position; flagged for
the user rather than silently left undone. **`https://chompy78.github.io/PACT/login.html` needs to be
added to that allow-list before this fix can work in production**, alongside the existing
`https://chompy78.github.io/PACT/` entry `emailRedirectTo` already relies on.

**Why no new automated e2e coverage was added for this flow.** `testing/scripts/cloud-e2e.mjs` is the
harness shaped for exactly this (a local Supabase stack with a real mail-catcher that could exercise an
actual recovery redirect end-to-end) — but it needs Docker + the Supabase CLI, and this environment has
no Docker daemon (confirmed: `docker ps` fails with "no such file or directory" on the daemon socket).
Building a lighter Playwright/CDP-only test would still need to either reach the live production
Supabase auth endpoint (unacceptable for an automated test run) or fully mock the auth module, which
would only prove the mock's shape, not the real integration. What *was* verified instead:
`node --check` on every new/changed script block; a structural cross-check that all 23 DOM ids the script
references via `$('...')` exist in the HTML and vice versa (would catch a typo'd id producing a silent
`null` and a `TypeError`); `engine-parity-ci.mjs` (65/0) and `tool-pricing-ci.mjs` (176/0) as null
controls (this change touches no `js/engine.js`/pricing code); and a manual trace of all four boot-state
branches (plain visit, valid recovery, invalid/expired redirect, defensive timeout fallback) against the
actual vendored Supabase client source rather than assumed library behavior.

## Status
Implemented on `fix/password-reset-flow`. `js/auth.js`: new `RESET_REDIRECT` constant,
`forgotPassword()` repointed at it, `REDIRECT_BASE`/`signUp()` unchanged. `login.html`: new `recoveryView`
(checking / new-password-form / expired-with-resend sub-states), a synchronous pre-import hint script, and
boot logic that branches on it ahead of the existing signed-in bounce.

**Not yet verified: the real end-to-end path with a live recovery email**, which needs the Supabase
dashboard allow-list entry above (a step outside this session's tool access) plus a real mailbox — the
one thing this task's own board entry already said couldn't be checked at the unit level. Flagged here,
not silently assumed correct.

`engine-parity-ci.mjs`: 65/0 (null control). `tool-pricing-ci.mjs`: 176/0 (null control). No
`DATA.version`/`BUILD` change (no rules/engine code touched).
