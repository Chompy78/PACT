# D-GH24 — CharGen/Live Sheet theme-restore check stays at the bottom of `<body>`, not inline in `<head>`

Status: Active

- **Context:** the theme-selector fix (PR #109) added a `prefers-color-scheme: dark` fallback to both
  tools' theme-restore IIFE, matching `index.html`'s "saved choice wins, else system dark, else default"
  logic. The roadmap task that spawned this fix explicitly suggested also moving the check inline into
  `<head>` (as `index.html` does) to avoid a flash of the wrong theme before JS runs, and asked to "note
  in the PR if that's not practical and why."
- **Options considered:** (A) move the restore IIFE into an inline `<head>` `<script>`, matching
  `index.html`'s pattern exactly; (B) leave the check where it already ran (near the end of `<body>`,
  after the header markup), only adding the `matchMedia` fallback in place.
- **Decision:** (B).
- **Why:** `index.html`'s theme system is `documentElement`-scoped (`html[data-theme=...]`), which is set
  before `<body>` exists — that's *why* it can safely run in `<head>`. CharGen's and Live Sheet's theme
  CSS is `body`-scoped (`body[data-theme="dark"]`, etc., dozens of selectors across both files'
  stylesheets) and `document.body` doesn't exist yet while `<head>` is parsing, so the same early-run
  trick isn't a drop-in port — it would require converting every `body[data-theme=...]` selector in both
  tools to `html[data-theme=...]` first, a materially larger and riskier CSS change than this fix's scope
  (mobile-hidden + desktop-clipped selector, plus the dark-mode default). A future agent picking up the
  "flash of wrong theme on load" follow-up should start from the CSS-scope conversion, not from the
  restore-script's position — the script's position was never the blocker.
- **Status:** DONE (for this fix's scope). The `<head>`-timed version remains open as unclaimed follow-up
  work, not currently tracked as its own roadmap item.
