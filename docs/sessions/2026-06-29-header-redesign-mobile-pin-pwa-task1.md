# Session — 2026-06-29 · Header redesign, mobile-sticky fix, version bumps, PWA Task 1

*History / non-authoritative. Authoritative state: `CHANGELOG.md`, `DECISIONS.md` (D-GH5, D-GH6, D-GH8).*

## Goal
Reorganise the tool header into a clean, information-rich layout, get it to stay pinned on real
mobile hardware, bump the cosmetic tool versions, and finish PWA Task 1 by registering the service
worker on the tool pages themselves.

## What we did
- **Header redesign.** Restructured into a 4-row desktop / 2-row mobile layout. It now surfaces both
  the Web Tool build (v0.107) and the PACT rules version (v0.322), adds a ⚠ warning icon beside the
  AP total on row 1, and drops the now-unused `.topbar` CSS from CharGen.
- **Mobile-sticky fix (the hard part).** The rebuild was correct on desktop but the header scrolled
  off on a real Pixel. A methodical bisection cleared, in turn, the CSS, the static DOM, page weight
  (a 1,500-section heavy static page still pinned fine), the `ResizeObserver`, and any touch/scroll
  listeners. A diagnostic injected into the live page finally showed the header was *computed* as
  pinned (`top:0`) even on the phone — it just wasn't being repainted during window scroll. The fix:
  stop scrolling the window on mobile altogether. On ≤768px the page is now an **app-shell** — `body`
  is a flex column at `100dvh; overflow:hidden`, the header is a static `flex:0 0 auto` bar, and
  `.layout` is the inner scroll area. Holds on real hardware and doubles as the PWA foundation.
- **Version bumps.** CharGen & Live Sheet build → v0.107; DM Console `TOOL_VERSION` → v0.015.
  `DATA.version` left at v0.322 (no mechanics changed).
- **PWA Task 1 complete.** The shared service-worker registration block + `<link rel="manifest">`
  were added to all three tool pages (absolute `/PACT/` paths, "new version ready / Reload" bar on
  `updatefound`), finishing the snippet that had been deferred from the PWA-shell work.

## Notes / follow-ups
- `js/engine.js` was **not** touched (commit `ffcbb16` changed only the three `tools/*.html`), so
  engine parity is logically unaffected. The `engine-parity.html` test was not re-run in a browser
  this session — worth a quick 5/0 confirmation before the next release tag.
- This session's new decisions are **D-GH5–D-GH8**. The previously-dangling **D-GH4** ("roles are
  per-campaign") was independently written by the Task 3 SQL data-model work (PR #20) as "D-GH4 ·
  Data model: per-campaign non-exclusive roles…", which lands on the same branch; my interim back-fill
  was dropped during rebase in favour of that fuller canonical version.
