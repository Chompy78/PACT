# D-GH-2026-07-14-shared-ui-helpers — esc()/flash()/_csCopy() consolidated into one shared js/ui-helpers.js

Status: Active

- **Context:** a code-audit recommendation (from a broader project review) flagged that
  `PACT-Live-Char-Sheet.html` alone defined `esc()` three separate times, each with different escaping
  coverage — one dropped `>` entirely, another dropped quote-escaping entirely, and none escaped single
  quotes. CharGen and DM Console each had their own separate `esc()` copy too. `flash()` (a toast helper)
  and `_csCopy()` (a 3-tier clipboard-copy fallback: Clipboard API → `execCommand` textarea →
  `window.prompt`) were duplicated verbatim between CharGen and Live Sheet, including two further nested
  `esc()` shadows inside `_spellAC()`, an autocomplete widget itself copy-pasted between the two tools.
  Each copy was correctly scoped to its own closure (no runtime shadowing bug), but which escaping
  behavior was in effect for any given render call depended on which closure the call site happened to be
  in — a latent risk if a call site ever interpolated into a single-quoted HTML attribute.
- **Options:** (a) leave the duplicates in place and just patch each one's quote-escaping individually;
  (b) consolidate into one canonical `esc()`/`flash()`/`_csCopy()` in a new shared, plain (non-module)
  `js/ui-helpers.js`, loaded via `<script src>` before each tool's own inline script; (c) go further and
  also fold the `pactTheme` `localStorage` setter (duplicated one-liner inside each tool's `setTheme()`)
  into the same shared file.
- **Decision:** (b). Also investigated (c) but rejected it once the actual code was inspected: each tool's
  `setTheme()` does more than set `localStorage` — CharGen's also syncs two `<select>` elements
  (`#themesel`/`#themeselMobile`) that don't exist in the other tools, so `setTheme()` itself isn't a true
  duplicate, only one internal line of it is. Extracting that single line into a shared helper would trade
  one duplicated line for an indirection that still needs a tool-specific wrapper around it — not worth it.
  DM Console's clipboard-copy pattern (button-text feedback + `execCommand` fallback, no `flash()`
  dependency) was also left alone — inspection showed it's a genuinely different shape from
  CharGen/Live Sheet's `_csCopy()`, not a third duplicate of it.
- **Why:** `esc()` in particular is a security-relevant helper per `AGENTS.md`'s stored-XSS invariant
  (REV-12) — having three silently-different implementations of "the thing that keeps cloud data safe to
  render" is the kind of inconsistency that's easy to introduce a real gap into later (e.g. a new call site
  copy-pasted from the *wrong* nearby `esc()`). Consolidating to one canonical version, loaded once, removes
  that ambiguity structurally rather than by convention. Scoping the change to esc/flash/_csCopy (not
  forcing setTheme's one line into the same file) kept the diff honest about what's actually duplicated
  versus what only looks similar at a glance.
- **Status:** Shipped. `js/ui-helpers.js` added; local duplicates removed from all three tools.
  `testing/scripts/engine-parity-ci.mjs` unaffected (20/0 — UI-only, no `js/engine.js`/`DATA.version`
  change). Verified in a real headless-Chromium pass: all three tools resolve `esc`/`flash`/`_csCopy` as
  globals, `esc()` correctly escapes `& < > " '`, `flash()` renders the expected toast, no new console
  errors.
