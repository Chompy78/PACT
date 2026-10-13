# D-GH5 — Mobile header uses an "app-shell" layout, not `position:fixed/sticky`

Status: Active

- **Context:** after the header rebuild, the header would not stay pinned on a real Pixel, even though it worked on desktop and in a narrow desktop window.
- **Investigation:** a self-reporting diagnostic proved the header was *positioned* correctly on the phone — `getBoundingClientRect().top === 0` at full scroll, `scrollingElement === <html>`, no inner scrollers — but it wasn't being **repainted** at top:0 while the whole window scrolled a heavy (~500 KB) page (a mobile-Chrome compositor limitation). A `transform:translateZ(0)` GPU hint didn't fix it; switching `fixed`↔`sticky` made no difference.
- **Options:** (i) keep fighting the compositor with GPU hints / position tweaks; (ii) stop scrolling the window on mobile altogether and adopt an app-shell.
- **Decision:** (ii), mobile (≤768px) only: `body` becomes a flex column with `height:100dvh; overflow:hidden`; the header is a **static** `flex:0 0 auto` bar; `.layout` becomes its own scroll area (`flex:1; overflow-y:auto`). The header is no longer inside the scrolling region, so it can't scroll away. Desktop keeps `position:sticky` + window scroll. "Jump to section" scrolls the inner area via `scrollIntoView` when the header is static. **Header information architecture** alongside this: desktop = 4 rows (name+AP · title+versions+last-edited+theme · action buttons · nav chips); mobile = 2 rows (name+AP · Random/Reset/Jump-to-section). Breakpoints kept independent: header 768px, layout grid 920px, phone tuning 600/380px.
- **Why:** robust on real hardware and the correct base for the planned PWA (app-shell is the standard PWA layout). Trade-off: in a plain browser tab the mobile address bar no longer auto-hides on scroll — moot once installed as a PWA.
- **Status:** IN FORCE.

## Addendum — 2026-10-13 (Live Sheet): what stays pinned, and the one scroll area

Still IN FORCE; this records how the Live Sheet applies it after owner feedback that the pinned area took about half a phone screen.

- **The scroll region is `#lsScroll`, not `.layout`.** A wrapper around the AP summary (`#eco`), the DM bar and the three panels. On ≤768px it is the only element that scrolls (`flex:1; overflow-y:auto; overscroll-behavior:contain`); `body` stays the non-scrolling flex column this decision introduced.
- **Only `.top` is pinned, and on a phone (≤600px) it holds only what the owner asked for:** row 1 = ← Home · "Live Sheet" · the character's name (ellipsised); row 2 = the buttons, small enough to fit without sideways scrolling. Undo/Redo are dropped from it there because the fixed bottom bar (`#lmobar`) already has them; the floating AP pill is hidden for the same reason.
- **The tip/version banners are inserted into `#lsScroll` on ≤768px** (`_lsBannerHost()`), so they scroll away instead of stacking on the pinned header. Desktop keeps them at the top of `body`, unchanged.
- Nothing here re-pins anything with `position:fixed/sticky` — the repaint bug this decision avoids cannot return through these changes.

PRs #650 (first pass: one sideways-scrolling row) and #652 (the two-row header above). Measured headless at 360/390px, ~78px tall; not yet confirmed on real hardware.
