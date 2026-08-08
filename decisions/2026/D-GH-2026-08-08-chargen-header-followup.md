# D-GH-2026-08-08-chargen-header-followup

**Context.** After `D-GH-2026-08-08-chargen-local-cloud-split-new-character` shipped (splitting CharGen's
header into 📁 Local / ☁ Cloud dropdowns), the owner reviewed the actual rendered result and reported three
problems in one message: the theme selector sits on its own separate header line, the mobile version is
"stale," and the ☁ Cloud menu has no New Character option. Each was verified against the real rendered page
(headless-Chromium screenshots at multiple widths, not assumed from reading the markup) before being fixed.

**Finding 1 — theme selector wraps.** Screenshotted `.hd-row2` at 1440/1280/1024/900/769px. It held a
single line at 1280px+ but wrapped the theme `<select>` onto its own second line at 1024px and below —
a very common laptop/half-screen browser width, not an edge case. Root cause: adding the 📁 Local
dropdown (D-GH-2026-08-08-chargen-local-cloud-split-new-character) pushed `.hd-row2`'s total content width
over the available space at that breakpoint; `flex-wrap` moved the last item (theme, pinned right via
`margin-left:auto`) to a new line.

**Finding 2 — mobile has no cloud access at all.** Confirmed by screenshotting the page at 400px width:
`.hd-mobnav`/`.mobile-action-bar` (mobile's separate button set) have Undo/Redo/Random/New Character/
Save/Load/Sheet/etc., but nothing reaches sign-in, campaign join, cloud save, cloud load, or the Autosave
toggle. This is not new — `.hd-row2`/`.hd-row3` (where cloud controls live) have been `display:none` below
768px since before this session — but it read very differently as a "gap nobody would notice" before the
Local/Cloud split made desktop's cloud access prominent and well-labeled; the asymmetry became the
complaint.

**Finding 3 — Cloud menu has no New Character option.** Confirmed by reading `renderCgCloudMenu()`: New
Character (D-GH-2026-08-08-chargen-local-cloud-split-new-character) was added only to the 📁 Local menu.
Since New Character's own fix in that same decision flushes a pending *cloud* autosave before detaching,
it is already a cloud-aware action, not a purely local one — omitting it from ☁ Cloud was an inconsistency,
not a deliberate scoping choice.

**Fixes:**
1. `@media(max-width:1150px){ .hd-row2 .sub,.hd-pactver{display:none} }` — hides the two build/rules
   version labels (both duplicated elsewhere: the Info panel and DM Console's footer already show
   equivalent info) below that width, freeing enough space to keep the interactive controls (sign-in/
   campaign status, Local, Cloud, theme) on one line down to 900px (verified).
2. A "☁ Cloud" trigger button added to `.mobile-action-bar` (`#cgCloudBtnM`). Rather than duplicating the
   entire rich cloud-menu markup for mobile — real risk of ID collisions across two live copies of the
   same `id="cgCloudSaveBtn"`/`id="cgJoinCode"`/etc. — the single existing `#cgCloudMenu` element is
   reparented (`appendChild`) into whichever trigger's wrapper was clicked, immediately before opening.
   Also fixed `.mobile-action-bar`'s `overflow-x:auto`, which (per the CSS overflow spec) implicitly
   turns `overflow-y` into `auto` as well once either axis leaves `visible` — clipping the dropdown
   vertically instead of letting it overlay below the bar the way every other `.moremenu` location does.
   Fixed with an explicit `overflow-y:visible`.
3. A same-session edge case was caught by an actual headless round-trip test (open the mobile menu,
   resize to desktop without closing it first, click the desktop trigger) rather than assumed safe: a
   naive `classList.toggle('open')` on reparent would close the menu instead of moving-and-showing it,
   because it was already `.open` from the mobile click. Fixed: reparenting now always sets `.open`
   (shows it at the new location); only a click on the SAME already-current trigger toggles closed.
4. "🆕 New Character" added to the ☁ Cloud menu (both signed-in and signed-out branches), wired through
   the same `newCharacter()`/confirm-text path as the 📁 Local menu's copy.

**Verification:** `engine-parity-ci.mjs` 29/0, `audit.py` 0 failed (no rules/`compute()` involvement, no
`DATA.version` change). Headless-Chromium checks: theme selector stays on `.hd-row2`'s line at
900/1024/1151px; Local and Cloud menus both still open/close correctly on desktop; New Character from the
Cloud menu mints a different `currentCharId()`; the mobile Cloud menu opens with non-zero dimensions and
visible content after reparenting; a full mobile→desktop→mobile resize round-trip re-opens correctly at
each step (this is what caught Fix 3 above — the first version of the reparenting logic failed this
specific check).

**Status:** DECIDED and SHIPPED (2026-08-08, branch `claude/header-save-state-clarity-bt6sjy`).
