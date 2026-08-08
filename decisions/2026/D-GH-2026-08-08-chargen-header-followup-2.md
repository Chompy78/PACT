# D-GH-2026-08-08-chargen-header-followup-2

**Context.** After `D-GH-2026-08-08-chargen-header-followup` shipped (theme-selector wrap fix, mobile
cloud access, New Character in the Cloud menu), the owner continued reviewing the mobile experience and
flagged two more gaps, plus a standing instruction: stop taking screenshots without asking first.

**Finding 1 — no consolidated Local menu on mobile.** Mobile had individual buttons for New Character
(`.hd-mobnav`), Save, and Load (`.mobile-action-bar`) — the same three actions desktop's 📁 Local dropdown
groups together, but scattered across two different mobile bars with no unifying label. The previous
follow-up added a mobile ☁ Cloud trigger but didn't extend the same treatment to Local.

**Finding 2 — no way to see the app/rules version on mobile.** `.hd-row2`'s "Web Tool · vX" / "PACT rules ·
vX" labels are `display:none` below 1150px (from the first header-followup fix), and `.hd-row2` itself is
`display:none` below 768px — so a mobile user had no path to either version number at all, not even
through the Info panel, which only carried the file's last-modified date at that point.

**Fixes:**
1. Added `#cgLocalBtnM` to `.mobile-action-bar`, reusing the exact reparent-the-one-menu-element
   technique built for the mobile Cloud button in the previous follow-up (including its "reparenting
   always shows the menu at its new location, never toggles closed" fix) — `_cgWireLocalMenu()` was
   generalized to accept both the desktop `#cgLocalBtn` and mobile `#cgLocalBtnM` triggers. The
   now-redundant standalone New Character (`.hd-mobnav`) and Save/Load (`.mobile-action-bar`) buttons
   were removed, matching how desktop replaced its own standalone buttons with the Local dropdown.
2. Added a version line to the Info panel (`#infoVersions`) that copies the header's `.sub`/`#cgPactver`
   spans' live `textContent` at page load — deliberately NOT a third hand-maintained copy of the version
   strings (which would have added a third location for `audit.py`'s existing build-version-mirror check
   to need extending, and a third place to drift). `display:none` on the source elements doesn't clear
   their `textContent`, so this reads correctly regardless of which breakpoint hid them.

**Verification note — no screenshots this round**, per explicit instruction. Used DOM-state assertions
instead (element rects for non-zero size/visibility, `classList` for open/closed state, `textContent` for
menu/version content) via headless Chromium — the same class of check used throughout this session
alongside screenshots, just without the image capture step. Confirmed: the mobile Local menu opens with
non-zero dimensions and contains all three actions; clicking New Character from it mints a different
`currentCharId()`; a mobile→desktop resize round-trip re-opens the Local menu correctly (the same edge
case class the Cloud menu fix caught); the Info panel's version line reads correctly (e.g. "Web Tool ·
v1.386 · PACT rules · v0.339") on both mobile and desktop viewports. `engine-parity-ci.mjs` 29/0,
`audit.py` 0 failed — no rules/`compute()` involvement, no `DATA.version` change.

**Status:** DECIDED and SHIPPED (2026-08-08, branch `claude/header-save-state-clarity-bt6sjy`).
