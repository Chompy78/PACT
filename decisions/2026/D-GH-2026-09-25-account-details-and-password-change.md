# D-GH-2026-09-25-account-details-and-password-change — a shared account popover for all three tools

## Context
A user reported that "the tools" don't show who is logged in or how to change a password. Investigation
confirmed a real, consistent gap: Live Sheet and CharGen's header chip only ever showed a bare
"🔒 Signed out"/"☁ Signed in" state — never the account's email — with no in-app way to change a
password (only `login.html`'s "forgot password" email round trip). DM Console turned out to be a mixed
case: its buried `campWho` label (inside a collapsed "Campaign (cloud)" panel) already showed the email,
but its "Sign out" link was a **latent dead bug** — relabelled to "Sign out" when signed in, but its
`onclick` only called `e.preventDefault()` and never actually signed anyone out.

## Options
- **A. Do nothing beyond DM Console's sign-out bug.** Fixes the one broken control but leaves the
  original complaint (no account details, no in-app password change) unaddressed in all three tools.
- **B. Three separate, tool-local implementations.** Each tool grows its own popover/menu inline. Fastest
  per-file, but triples markup+logic for identical behavior and risks the three copies drifting in
  wording exactly like the pre-existing `chipPresentation()` sync-chip vocabulary was built to prevent.
- **C. One shared popover component, wired into each tool's existing sign-in chip (chosen).**
  `js/account-ui.js` — a plain classic script (`ui-helpers.js`'s own pattern), one global
  `renderAccountPopover(anchor, bridge)` — self-contained (injects its own CSS/DOM on first use, no
  dependency on a tool's local `.moremenu` styling, which DM Console doesn't even have). Each tool's
  existing chip (`#lsSyncChip`, `#cgSyncChip`, `#campWho`) becomes clickable and passes its own module
  bridge (`_authBridge` / `_campBridge`) into the shared function.

## Decision
C, plus the DM Console sign-out fix bundled in (same root area, same investigation). Password change is
**in-app, no email round trip** — the popover's form calls `js/auth.js`'s existing `updatePassword()`
directly, which just calls Supabase's `auth.updateUser({password})`; Supabase allows this on any active
session without re-entering the old password, so there was no new auth-security surface to add, only a
UI entry point to the helper that already existed but was only ever reachable from the post-recovery-link
form.

## Why
- **Why one shared file, not three local copies:** `js/sync.js`'s `chipPresentation()` already exists
  specifically so the three tools' sign-in wording can't drift — extending that with three independent
  popover implementations would reintroduce exactly the class of drift that function was built to kill,
  for a much larger surface (markup, a password form, error states) than a label string.
- **Why textContent, never innerHTML, for the email/display name:** both are player-set values (a
  display name is free text the account owner chose at signup) — per this repo's hard rule, anything a
  signed-in user can set that gets rendered must never reach `innerHTML` unescaped. The popover builds
  the email/name nodes via `textContent` assignment rather than string-concatenated `innerHTML`, so
  there's no escaping to get wrong in the first place. Verified in `testing/scripts/account-ui-e2e.mjs`
  with a deliberately hostile display name (`<img src=x onerror=alert(1)>Mallory`) asserting no `<img`
  tag reaches the popover's `innerHTML`.
- **Why the DM Console fix needed a new test seam (`window._dmUpdateAuthTest`):** `campWho`'s click
  wiring lives inside `updateAuth()`, only ever invoked reactively from a real Supabase auth event or
  the initial boot check — neither raisable from an offline e2e gate (no live Supabase, matching this
  suite's and `dm-console-ui-e2e.mjs`'s existing "no stack needed" design). Exposing `updateAuth` as a
  seam (mirroring the existing `_dmRulesPanel`/`_dmRenderCloudRoster`/etc. naming convention) lets the
  gate drive it directly instead of leaving the fix's own regression test unwritable.
- **Two real bugs caught by `/code-review` before merge, both fixed and covered:**
  1. The chip's new "Click for account & password" hint (`title`/`aria-label`) was being fully
     overwritten by `_lsRenderSyncChip()`/`_cgRenderSyncChip()` on every render (load, every autosave) —
     appended instead of replaced now, so the affordance survives past the first paint.
  2. The popover's "Log out" (and DM Console's dedicated link) closed/no-opped before the `logout()`
     promise settled, so a failed sign-out (offline) left the UI still showing signed-in with zero
     feedback. Both now await the result and surface a real error on failure.

## Status
Implemented on branch `fix/account-details-and-password-change`. New coverage:
`testing/scripts/account-ui-e2e.mjs` (28/28, no live Supabase needed — same "fake the bridge functions"
pattern `dm-console-ui-e2e.mjs`/`economy-ui-e2e.mjs` already use). `engine-parity-ci.mjs` (73/73),
`version-label-ci.mjs` (10/10), `economy-ui-e2e.mjs` (155/155) and `dm-console-ui-e2e.mjs` (101/101) all
still green — no `js/engine.js`/`DATA` changes.
