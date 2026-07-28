# D-GH38 — One-click tool switch on a shared js/character-store.js module (not a file merge)

Status: Active

- **Context:** moving an in-progress character CharGen→Live Sheet was a manual export-file/import-file
  dance, with no reverse direction at all. The user first asked to *merge* the two tools into one HTML file
  with a mode toggle. That was declined in favour of a lighter design (and is consistent with the
  already-executed Phase 2 decision, `docs/plans/2026-07-08-...`, which explicitly kept the two files
  separate as "two views over one shared LOG" and listed physical merge as out of scope): keep the files
  separate, add a one-click button that hands the character to the other tool so it *feels* like switching
  tabs. Because Phase 2 already made both tools event-sourced over an identical LOG (and D-GH33/36/37
  bridged the fold/economy/MUT functions), a raw LOG now folds identically in either tool with no
  conversion — so a live handoff is finally possible.
- **Options considered / decisions:** (1) **Shared module first, not hand-copied glue.** A new
  `js/character-store.js` owns the tool-agnostic handoff transport (`writeHandoff`/`takeHandoff`/
  `sweepExpiredHandoffs`) plus the byte-identical `genCharId` migrated out of both tools — rather than
  copy that logic into two 300–500KB HTML files. This starts correcting the repo's own
  `js/`-holds-shared-logic / `tools/`-are-UI-only rule for persistence. **Ownership boundary:** the module
  does transport/storage/validation only; *applying* a consumed character to a tool's runtime stays
  tool-local (`_cgApplyEnvelope` for CharGen, an `importJSON`-style assignment for Live Sheet), exactly as
  `engine.js` is shared while `emit`/`undo` are local. (2) **localStorage baton, per-transfer UUID key,
  not the URL and not a fixed key.** The character rides in `localStorage['pact:handoff:<uuid>']`; only a
  short `?handoff=<uuid>` flag goes in the URL (URLs have length limits a big LOG would exceed). A
  *per-transfer* key (vs. one fixed key) avoids a two-tab race where simultaneous switches clobber a shared
  key — at the cost of an orphan-key sweep on every boot (an interrupted navigation otherwise leaks its
  key forever). 2-minute expiry; consume-once (the key is always deleted on read); `?handoff` stripped via
  `replaceState` so a reload never re-triggers. (3) **CharGen consume uses `_cgApplyEnvelope`, NOT the
  untagged "branch 2" import path** — branch 2 rebuilds via `foldBuild`+`applyBuild` and never reads the
  incoming id (would mint a new one, breaking id-stability); this was an actual bug caught in an earlier
  plan draft by reading the code. (4) **File export/import kept alongside** the new button (relabeled
  "LS file"), not replaced.
- **Why:** the shared-module-first sequencing makes each tool's switch diff smaller (not larger) and pays
  down real duplication instead of adding a third copy; the localStorage+per-transfer-key transport is the
  cheapest design that is both length-safe and race-safe; reusing each tool's existing verbatim-load
  primitive keeps the consume path free of new parsing logic and preserves id.
- **Status:** DONE for Slices 0–1 (shared module + the buttons/boot-consume in both tools), on branch
  `claude/html-tools-engine-errors-j2qb7w`. **Slice 2 (cloud/campaign-bound round-trip) is deferred** —
  isolated by design so it never blocks the local feature; the fallback if a bound character doesn't
  round-trip cleanly is to disable the switch button for campaign-bound characters (logged then). **Two
  adjacent items this feature leads into but deliberately did NOT bundle:** removing CharGen's dead
  `_cgBoot` `replaceWholeLogFromBuild` scaffolding (obsolete Phase-2-Step-3 seed code — harmless today
  since `compute()` is authoritative over derived fields, verified in a browser, but it defeats verbatim-LOG
  restoration on autosave; needs its own change + test), and wiring the engine's built-but-unused
  `creationLocked` "finalise" trigger into the CharGen→Live Sheet switch (a real rules/UX decision).
  **Verification:** `js/character-store.js` proven in a real headless browser (all exports present, a
  handoff payload round-trips, consume-once deletes the key); `_cgApplyEnvelope` separately browser-proven
  to preserve id; both tools' classic scripts syntax-check clean; engine-parity untouched (no rules
  change, `DATA.version` unchanged). Full cross-tool navigation and Live Sheet's runtime remain
  production-verify items (the sandbox can't load Live Sheet's Supabase-CDN module graph — the known
  D-GH37 limitation). Full plan + both cold reviews + the Opus verification pass:
  `docs/plans/2026-07-09-chargen-livesheet-switch-button.md`.
