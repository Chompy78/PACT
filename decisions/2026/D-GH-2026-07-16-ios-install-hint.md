# D-GH-2026-07-16-ios-install-hint — feature-detect, not UA-sniff; dismissible, not persistent nag

Status: Active

- **Context:** `beforeinstallprompt` (Chromium/Android/desktop) never fires on iOS Safari, so the
  existing "Install app" button never appears there — iOS visitors had no in-app install path at all,
  only "figure out Share → Add to Home Screen yourself." The `<head>` maintainer comment already
  flagged this as a known gap: "a manual iOS hint could be added here if desired."
- **Options:** (1) UA-sniff for "iPhone|iPad|iPod" in `navigator.userAgent`. (2) feature-detect
  `'standalone' in navigator` (a nonstandard property only iOS Safari's WebKit defines). (3) skip it,
  leave the gap.
- **Decision:** (2), plus a dismiss button that persists to `localStorage` (key
  `pact-ios-install-hint-dismissed`, matching the existing `pact*`-prefix convention the backup/restore
  script already scans for).
- **Why:** UA strings are spoofable and drift (iPadOS increasingly reports as desktop Safari depending
  on the "Request Desktop Website" setting) — `ai-lessons-learned` H-015 already generalized this
  exact lesson from a different PACT feature (the Save/Export share-sheet flow): feature-detect a real
  API/property, don't UA-sniff iOS. `navigator.standalone`'s mere *existence* (not its value) is the
  iOS-Safari-specific signal; its value additionally tells us whether the app is already installed, so
  one check does both jobs. A one-time dismiss (not "show every visit") avoids nagging a user who's
  already seen and ignored it, mirroring the existing service-worker `.update-bar`'s one-shot-per-event
  pattern rather than the always-visible `.offline-badge`.
- **Verification:** real (non-mocked-JS-logic) browser test via Playwright with a spoofed iOS Safari
  user-agent and an injected `navigator.standalone`: hint shows when not installed, stays hidden when
  `navigator.standalone === true` (already installed) and on a plain desktop Chrome context (no
  `navigator.standalone` at all), dismiss removes it immediately and the dismissal survives a page
  reload, zero console/page errors in every case. `testing/tests/engine-parity.html` unaffected, still
  20/0 (no `js/engine.js`/`DATA` involvement — display-only).
- **Also found (by `/code-review`, fixed same-PR):** `.ios-hint` and the pre-existing service-worker
  `.update-bar` are both `position:fixed;bottom:0` at the same `z-index`, so both showing in one
  session would visually overlap (the later-appended one hides the earlier one). Fixed by having the
  update-bar's creation code remove any currently-visible `.ios-hint` — an update takes precedence,
  and the hint's own IIFE re-runs on the resulting reload, reappearing if still eligible and not
  dismissed. Verified live by simulating the exact update-bar creation code path against a page with
  `.ios-hint` already showing. A CSS-duplication finding (the two bars' near-identical fixed-bottom-bar
  layout rules aren't shared via a base class) was left as-is — cosmetic, and fixing it would mean
  touching the pre-existing `.update-bar` too, beyond this task's scope.
- **Status:** Active.
