# 2026-10-13 — Live Sheet Character panel rework, DM language editor, two releases

The owner opened with a layout request for the Live Sheet's centre panel. The rest of the session was a run of follow-ups
sent mid-work, each on the screen they were using. They ended in two `preview` → `main` releases (`v1.657`, `v1.660`).

## What shipped (all display-only; `DATA.version` stayed `v0.376`)

- **#650: Character panel.** Name and class on top. Then three columns: **Stats · Skills · General** (sized by a container
  query on the panel's own width, so folding Buy/History reflows it). Then Spellcasting, coins/weapons/notes, Needs review.
  The Appearance & description block is collapsed by default, edited in place, and has **🪶 Regenerate paragraph**. The
  paragraph writer moved into `pactComposeDescription()` (`js/ui-helpers.js`), and CharGen's Auto-write now calls it too.
  The AP line reads **"N AP left = player + DM + drawbacks − spent"**, from `compute()`'s own pools.
- **#651: DM Console languages.** The owner "found it but can't see how to edit it". Cause: Campaign Rules start locked,
  and the unlock controls are out of sight of the box. A 🔒 note now sits on the box (owner option **C2**, languages only).
  The standard languages became tick boxes, so Common can be unticked (**E1**). The saved `{list, strict}` shape is
  unchanged.
- **#652: wider panels and the phone header.** Drag Buy/History wider. On a phone the pinned header is only the sheet name,
  the character name and the buttons, in two rows. That fulfils the owner's "the fixed header should only have…".
- **#653: Sheet view parity and ⓘ.** See `D-GH-2026-10-13-livesheet-sheet-view-desc`. It also added an **Open full sheet**
  button and a one-time tip ("people ignore it").
- **#656: D-GH5 addendum.** The phone app-shell's scroll area is now `#lsScroll`. Only `.top` is pinned.
- **Data (live).** Amble NPCs Bram Cotter Ch8-12 and Wren Ashdown Ch8-12 went from 130 to **138** DM AP, via
  `award_ap(…, 8)` run as the DM (guarded on 130).

## Worth remembering

- **The owner was testing on the live site.** "Still can't…" reports arrived while the fixes were only on `preview`.
  GitHub Pages serves `main`. Say where a change is actually visible before treating a repeat report as a failed fix.
- **The phone layout was iterated twice.** The first pass (one sideways-scrolling header row, #650) was not what the owner
  meant. The spec that landed (#652) was theirs: "name of the sheet, the buttons and character name". The report that
  "if I scroll on the header it expands but doesn't contract" was never reproduced headless. `overscroll-behavior` was the
  best guess, and confirmation on real hardware is still owed.
- **"Expand out" meant widen.** The first fix made the folded Buy strip a clearer click target. Only the second report
  ("still can't be made larger") made it clear the owner wanted the panel wider, hence drag-to-widen.
- **Test trap.** `livesheet-center-panel-e2e` stubs `window.confirm = () => true` for its weapon checks. A later check that
  relies on a real confirm dialog has to restore or re-stub it.
- **Settings collision.** The owner's uncommitted `.claude/settings.json` edit (allow `execute_sql` unprompted) was the same
  change reverted earlier that day as accidental (`0525482`). The owner chose **J1**: it stays in the git-ignored
  `settings.local.json`, and the shared file was restored.
- **Collision with another session.** `feat/dm-ap-discount` (#649) merged into `preview` minutes after `v1.657` shipped.
  The owner then asked to "merge to main", which became the second release, `v1.660`. Its migrations were already applied,
  so this put client and server back in step.

## Owner letters this session

A1 (compact pinned header, keep D-GH5) · B1 (campaign language list) · C2 (lock note on languages only) · D1 (push +
PRs) · E1 (tick boxes) · F1 (merge) · H1 (ⓘ on features & traits) · I1 (merge #652 then #653) · J1 (settings stay local)
· K1/K2/K4 (D-GH5 note, delete branches, release) · K3 → two NEXT tasks: `feat/dm-rules-lock-bars`,
`feat/feature-effect-text`.
