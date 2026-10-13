# D-GH-2026-10-13-livesheet-sheet-view-desc — the Live Sheet's 📋 Sheet shares the Character panel's description block; ⓘ never invents effect text

**Status:** IN FORCE. Shipped in PR #653, released in `v1.657`. Display-only; no `DATA.version` bump.

## Context

The owner asked (2026-10-13) for the Character panel and the 📋 Sheet view to "be the same": the description should sit
with the rest of the appearance fields in a collapsed-by-default panel, as it now does on the Character panel (#650). They
also asked for "a (i) and hover" on each effect (owner option H1: features & traits). Two constraints:

- `renderCharSheet()` is a **shared renderer copied into both tools**. CharGen and the Live Sheet carry near-identical
  copies, kept in step on purpose.
- The rules data has effect text only for boons, arts, masteries, drawbacks, maneuvers, metamagic and a few racial and
  lineage traits. The 364 class features, 192 subclass abilities and most of the 38 racial traits have none: at most a PHB
  page (`FEAT_PG`).

## Options

- **Sheet view.** (a) Copy the new block's markup into `renderCharSheet()` in both tools. (b) Reuse the Character panel's
  own `_lsDescBlock()` in the Live Sheet only, through a `ctx` hook. (c) Merge the two Sheet renderers.
- **ⓘ text.** (a) Write effect summaries for the ~600 abilities now. (b) Show rules-data text where it exists, and a PHB
  page pointer otherwise.

## Decision

- **Sheet view: (b).** `renderSheet()` passes `ctx.descBlock = _lsDescBlock(b,{sheet:1})`. `renderCharSheet()` then
  replaces its Appearance, Background & Personality, Allies and Backstory boxes with that block. Player name, Alignment and
  Background stay in the sheet header, and `opts.sheet` leaves them out of the block. The block carries
  `data-lshost="sheetbody"`. `render()` only redraws `#sheet`, so `_lsDescRefreshSheetView()` redraws the Sheet's copy after
  an edit, and focus is restored per host. The block opens itself on `beforeprint`.
- **ⓘ: (b).** One lookup, `_lsFx(kind,key)`, feeds both views. Rules text if present, otherwise "See the Players Handbook,
  p.N", otherwise no ⓘ. The Sheet's ⓘ is gated on `ctx.fx` and hidden in print.

## Why

- **One function, two places, can't drift.** Copying the markup (a) would have rebuilt the duplication the owner was
  complaining about, inside one tool. Reusing `_lsDescBlock()` means a future change lands in both views at once.
- **CharGen keeps its Sheet.** `ctx.descBlock` and `ctx.fx` are only ever set by the Live Sheet. This is the same
  established pattern as `ctx.noSpell` (B1, v0.100), whose comment already says "CharGen never sets ctx.noSpell, so its
  sheet is unchanged (parity holds)". CharGen has its own appearance editor on its Setup panel, and merging the two Sheet
  renderers (c) is a refactor well past what was asked.
- **No invented rules text.** An ⓘ is read as rules. Effect text written ad hoc for ~600 abilities, without reconciling it
  against the Players Guide, would be the guide-vs-engine drift `AGENTS.md` forbids, in a third place. The real text is
  queued as `feat/feature-effect-text` on `docs/TASK_BOARD_NEXT.md`.
- **Side fix.** The Character panel's maneuver and metamagic hovers had looked those *arrays* up by name, so they were
  always empty. `_lsFx()` searches arrays and maps, which fixes them.

## Consequences

- The two tools' Sheet views now differ in their appearance section and in the ⓘ buttons. A future "make both Sheets
  identical" task has to decide whether CharGen adopts the block too. It would need `_lsDescBlock()` moved into
  `js/ui-helpers.js`.
- Tests that typed into the Live Sheet Sheet's old `[data-mf="notes"]` Backstory box now use
  `#sheetbody .lsdesc [data-lsd="backstory"]`, which commits on change (`livesheet-name-notes-e2e`, `cloud-e2e`).
