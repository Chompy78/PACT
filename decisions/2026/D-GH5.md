# D-GH5 — Mobile header uses an "app-shell" layout, not `position:fixed/sticky`

Status: Active

- **Context:** after the header rebuild, the header would not stay pinned on a real Pixel, even though it worked on desktop and in a narrow desktop window.
- **Investigation:** a self-reporting diagnostic proved the header was *positioned* correctly on the phone — `getBoundingClientRect().top === 0` at full scroll, `scrollingElement === <html>`, no inner scrollers — but it wasn't being **repainted** at top:0 while the whole window scrolled a heavy (~500 KB) page (a mobile-Chrome compositor limitation). A `transform:translateZ(0)` GPU hint didn't fix it; switching `fixed`↔`sticky` made no difference.
- **Options:** (i) keep fighting the compositor with GPU hints / position tweaks; (ii) stop scrolling the window on mobile altogether and adopt an app-shell.
- **Decision:** (ii), mobile (≤768px) only: `body` becomes a flex column with `height:100dvh; overflow:hidden`; the header is a **static** `flex:0 0 auto` bar; `.layout` becomes its own scroll area (`flex:1; overflow-y:auto`). The header is no longer inside the scrolling region, so it can't scroll away. Desktop keeps `position:sticky` + window scroll. "Jump to section" scrolls the inner area via `scrollIntoView` when the header is static. **Header information architecture** alongside this: desktop = 4 rows (name+AP · title+versions+last-edited+theme · action buttons · nav chips); mobile = 2 rows (name+AP · Random/Reset/Jump-to-section). Breakpoints kept independent: header 768px, layout grid 920px, phone tuning 600/380px.
- **Why:** robust on real hardware and the correct base for the planned PWA (app-shell is the standard PWA layout). Trade-off: in a plain browser tab the mobile address bar no longer auto-hides on scroll — moot once installed as a PWA.
- **Status:** IN FORCE.
