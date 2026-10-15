# D-GH-2026-10-15-livesheet-sheet-layout — the Live Sheet's 📋 Sheet IS the Character panel's body (one renderer)

**Status:** IN FORCE. Display only; no `DATA.version` bump. Supersedes the "Sheet view" half of
`D-GH-2026-10-13-livesheet-sheet-view-desc` (its ⓘ half still stands).

## Context

Owner request 2026-10-14 (`feat/livesheet-sheet-layout`) had three parts. Skills should be colour-coded by ability. The
description *paragraph* should always show, with only the fields collapsing. And the Character panel and the 📋 Sheet should
"match more closely — same sections, order, labels and styling … prefer one shared renderer over two copies".

Before this change the two views were two different layouts. The panel was `render()` (name, Stats · Skills · General,
Spellcasting, coins/weapons/notes). The Sheet was `renderCharSheet()`, a fillable sheet copied into both CharGen and the
Live Sheet. It had its own header fields, separate abilities/saves/skills boxes, a device-local attacks table, equipment and
coins, and an AP ledger. #653 had already made the two share one block (the description) through a `ctx` hook.

## Options

- (a) Keep `renderCharSheet()` and restyle both views towards each other. That leaves two renderers that drift — the thing
  the owner asked to avoid.
- (b) Grow `ctx` hooks until `renderCharSheet()` delegates every section to the panel's code. CharGen's copy would carry
  dead branches, and the "keep both copies in step" rule would cover code that one tool never runs.
- (c) **The Sheet renders the panel's own body.** Then it adds only what a printed, at-the-table sheet needs.

## Decision

(c).
- The block in `render()` that builds the Character panel now runs as `_lsCharBody(b, r, eco, opts)`.
  `renderSheet()` calls it with `{sheet:1, noSpell}` on the present build. The function is (re)defined in place inside
  `render()`, so the block keeps its position and history. Edits that parallel branches make inside it (armour/AC, weapons)
  still rebase. Its `b`, `r`, `m` and `eco` are its own parameters.
- What the old Sheet showed and the panel did not is added to the panel's General column, so both views now carry it:
  species · lineage · size, languages, proficiencies, species traits (bought plus heritage-pack, with ⓘ), subclass
  abilities, ancestry (non-spell lineages) and bonds. Passive Perception sits under Skills (from `skillMods()`).
- The Sheet's extras come after the body (`_lsTableExtras()`): **At the table** (current/temp HP, Hit Dice left, death saves,
  inspiration, spell slots used, bond notes — all device-local as before), **Older notes on this device**, and the
  **AP Ledger**.
- **Older notes on this device:** the old layout's device-local equipment, coin, attack-table, typed spell list and prepared
  lists. This box appears only when something was typed there. Coins, weapons and notes now live in the character itself
  (`appearance.playerSheet`), so the duplicates are gone from the layout. But nothing a player typed is hidden: it stays
  editable until they move it.
- While the Sheet is open, `render()` redraws it, so an edit in either view shows in both. This replaces the per-block
  `_lsDescRefreshSheetView()` redraw.
- The Live Sheet's copy of `renderCharSheet()` is deleted. CharGen keeps its own: that is CharGen's Sheet tab, which this
  request did not cover. The file-header "shared, duplicated code" note says so.
- Skills use one ability-colour map, `_CSABCOL`, the same one the Stats card, its saves and the spell strip read
  (`feat/livesheet-saves-in-stats-card` made the panel use it).
- The description block is a plain `div.lsdesc`. The paragraph sits outside the fold, and `details.lsdfold` holds the
  fields and the backstory (open state `LS_DESC_OPEN`). Player name, Alignment and Background are in the fields in both
  views now, since the Sheet header that also carried them is gone.

## Why

- One renderer is the only arrangement where "the same sections, order, labels and styling" stays true without someone
  remembering to update two places. The new e2e asserts it: the Sheet's section outline must *start with* the panel's
  outline, exactly, and five representative elements must compute the same styles in both.
- Deleting the dead Live Sheet copy removes a "keep in step" obligation that no longer protects anything.
- Hiding device-local text a player typed would read as data loss. Showing it only when present costs nothing for everyone
  else.

## Status / follow-ups

- CharGen's Sheet tab still uses `renderCharSheet()`. Bringing it onto the same body would need the panel's renderer outside
  the Live Sheet (e.g. `js/ui-helpers.js`), and the request did not ask for it.
- The Backstory paragraph folds with the fields (the owner named only the description paragraph). If wanted, moving it
  outside the fold is a one-line change in `_lsDescBlock()`.
