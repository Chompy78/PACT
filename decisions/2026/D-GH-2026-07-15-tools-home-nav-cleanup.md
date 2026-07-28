# D-GH-2026-07-15-tools-home-nav-cleanup — Home link added, no buttons removed (bars are responsive-exclusive)

Status: Active

- **Context:** the roadmap task "Tools: back-to-Home navigation + toolbar button cleanup" asked for two
  things — a "← Home" link in each of the three tools' headers, and to "audit/reduce cluttered toolbar
  buttons"; its Done-when explicitly wanted "measurably fewer or better-consolidated buttons." Adding the
  Home link is unambiguous; the button-reduction half needed an actual audit before cutting anything.
- **Options:** (A) remove/merge some header/toolbar buttons to literally satisfy "fewer buttons";
  (B) audit first and only remove what's genuinely redundant, per the task's own guardrail ("do not remove
  functionality players/DMs rely on without an equivalent path still available").
- **Decision:** B — added the Home link + `aria-label`s and removed **zero** buttons.
- **Why:** the audit found each tool's apparent "desktop bar vs. mobile bar" duplication is actually
  responsive-exclusive: the mobile bar (`#lmobar` / `.hd-mobnav` / `.mobile-action-bar`) is `display:none`
  on desktop and the desktop toolbar is hidden on narrow widths, swapped by a media query — they are never
  both on screen, so the "duplicate" undo/redo etc. are the *same* control at two breakpoints. DM Console's
  three `.topactions` buttons (Table view / Skill Matrix / AP Ledger) are distinct views, not redundant
  toggles. Removing any of these would drop reachable functionality on one form factor — exactly what the
  task said not to do. The genuine, safe wins were the Home link (placed in each tool's *always-visible*
  row — CharGen `.hd-row1`, Live Sheet `.top`, DM Console `.topbar` — so it survives on mobile) and
  `aria-label`s on the icon-only buttons touched (DM Console had 0). Display-only; no `DATA.version` bump.
- **Status:** In force. If a future "declutter" pass wants fewer *visible* controls, the lever is moving
  rare actions into an existing menu (like Live Sheet's `⋯ More`), not deleting responsive duplicates.
