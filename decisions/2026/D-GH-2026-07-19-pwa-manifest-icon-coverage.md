# D-GH-2026-07-19-pwa-manifest-icon-coverage — finish the PWA-completeness audit's two deferred items

Status: Active

- **Context:** `D-GH-2026-07-19-pwa-cache-bump`'s audit found two lower-stakes gaps and deliberately left
  them unfixed: `login.html`/`docs/PACT-Players-Guide.html` never declared `<link rel="manifest">`, and the
  new `apple-touch-icon` `<link>` had only been added to `index.html`, not the other five HTML entry
  points. Asked directly to close both.
- **Options:** (a) fix both gaps on every entry point that's missing them. (b) fix only the entry points a
  user is realistically likely to bookmark/install from directly (skip the Player's Guide, e.g.). (c) skip
  DM Console's apple-touch-icon, consistent with its favicon exclusion.
- **Decision:** (a), including DM Console for the apple-touch-icon tag (explicitly rejecting (c)).
- **Why:** (b) optimizes for a guess about user behavior with no real cost saved — the fix is one `<link>`
  line per file, so completeness costs nothing and avoids a future "why does X page not have this" question.
  Rejected (c) because the DM-Console favicon exclusion was never reasoned beyond a bare statement in
  `CHANGELOG.md`, and the two icons serve different purposes: a browser tab icon is cosmetic per-tab
  branding, while `apple-touch-icon` determines what a DM sees on their home screen after installing the
  *app* — DM Console is one of the three tools this PWA suite installs, so there's no basis for treating it
  differently there. Used the absolute `/PACT/...` path (matching `manifest.json`) rather than copying the
  tools' existing favicon's relative-path style, for consistency with the canonical manifest reference
  rather than propagating a second path convention.
- **Status:** Active. Verified: all 5 edited files parse via Python's `html.parser` with no errors; `js/
  engine.js` untouched; `testing/tests/engine-parity.html` → 20 passed / 0 failed.
