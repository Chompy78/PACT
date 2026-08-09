# D-GH-2026-08-09-sheet-tab-appearance-not-persisted — the fillable Sheet's Appearance/Background fields were silently local-only

Status: Active. Fixed 2026-08-09.

## Context

Owner report, live: *"when i go from chargen to live sheet and back, all the character descriptions
disappear. They don't seem to save to the cloud file either when i click save."*

The shared `renderCharSheet()`/`hydrateSheet()`/`_mfIn()`/`_mfTa()`/`csSave()`/`csLoad()` machinery
(duplicated verbatim in both `tools/PACT-CharGen-Webtool.html` and `tools/PACT-Live-Char-Sheet.html`,
same as `renderCharSheet` itself and `buildPortraitPrompts` — this codebase's established pattern for
shared logic in a no-build-step, single-self-contained-file architecture) renders the "📋 Sheet" tab's
form fields with a `data-mf` attribute and a `data-seed` attribute (the field's initial value). On open,
`hydrateSheet(id)` fills each field from a **local, per-tool, per-character-id `localStorage` scratchpad**
(`csLoad`/`_sheetStoreKey()` = `PACT_SHEET_KEY + ':' + SHEET_TOOL`, where `SHEET_TOOL` is `'chargen'` or
`'livesheet'` — two entirely separate namespaces) if a stored value exists, falling back to `data-seed`
otherwise. On edit, `onSheetField()` writes back to that same scratchpad only, via `csSave()`.

This is the correct design for genuinely scratch, table-only fields with no LOG concept: Player Name,
Alignment, Background/Other, Allies & Organisations, Backstory & Notes, Inspiration, and the spell-slot
trackers. **It is the wrong design for the Appearance grid (gender/age/height/build/hair/eyes/skin/marks/
voice) and the Background & Personality block (hometown/faith/ambition/fear/prized/companion/Description)
— these ARE `b.appearance`, real character data that CharGen's own "Setup & Character Description" panel
writes into the LOG via `PATCH_SLOTS.APPEARANCE`/`replacePatchSlot()`.** The Sheet tab exposes the exact
same fields through a completely disconnected, non-LOG, non-cloud-synced local cache.

Consequence, exactly matching the report:
1. Edit Description on the Sheet tab in CharGen → saved only to `pactSheetStore:chargen[id]`.
2. Switch to Live Sheet → its Sheet tab reads `pactSheetStore:livesheet[id]` (a different, empty
   namespace for this character) → falls back to `data-seed`, which is the real (unedited) `b.appearance`
   → **looks like the edit vanished.**
3. Cloud Save → `buildCharacterEnvelope()` only ever carries `{schema,rules,name,LOG,SEQ,id,campaignId}`
   → the scratchpad edit was **never part of what Save sends**, so it was never actually saved to the
   cloud, with no error to say so.

**Worse for Live Sheet specifically**: Live Sheet has no Setup-panel equivalent of CharGen's — the Sheet
tab is the *only* place these fields are ever shown or edited there. Every appearance/background edit
made in Live Sheet was, before this fix, unconditionally lost the moment the tab closed and reopened
(or synced), not merely on a tool switch.

## Options

- **A — leave it, document it as an intentional "print sheet is a scratch pad" design.** Rejected: these
  specific fields are indistinguishable in the UI from the genuinely-scratch ones, and they visibly
  mirror `b.appearance` — nothing tells a player "this one doesn't save." Confirmed live data loss, not a
  documentation gap.
- **B — make the WHOLE Sheet tab LOG-backed** (Player Name, Alignment, Notes, spell trackers included).
  Rejected: those fields have no `b.appearance`/build-model equivalent at all; inventing LOG event shapes
  for "player's own name" or "session notes" is new scope this report didn't ask for and the owner didn't
  request.
- **C — wire only the `b.appearance`-backed subset into the LOG, keep the rest as local scratch** (chosen).
  Matches the actual data model: these fields already have a real, LOG-backed home (CharGen's Setup
  panel writes them there); the Sheet tab should be a second *view* onto that same data, not a second,
  disconnected copy of it.

## Decision

The 16 Sheet-tab fields that map onto `b.appearance` keys (`gender, age, height, build, hair, eyes, skin,
marks, voice, hometown, faith, ambition, fear, prized, companion, overall`) are now LOG-backed:

- **`hydrateSheet()`**: for these fields, always paint `data-seed` (the live value, freshly computed from
  the current build on every render) — never the local-scratch `stored` value. The scratch layer is
  bypassed for them entirely, so it can no longer shadow the real data going forward.
- **`onSheetField()`**: for these fields, route to a new tool-local `_shCommitAppearanceField(key, v)`
  instead of `csSave()`. Merges `key` into the **full current `b.appearance`** (read via `readBuild()` in
  CharGen / `foldBuild(null)` in Live Sheet) before writing — critical, because the Sheet only exposes a
  *subset* of the appearance keys; a naive write of just the visible subset would silently wipe the
  CharGen-only fields (`nose, demeanour, quirk, likes, dislikes, father, mother, profession, familyfor,
  famevent, secret, drink`) the first time anyone touched the Sheet tab.
- **CharGen's `_shCommitAppearanceField`** calls `_cgSyncPatchSlot(PATCH_SLOTS.APPEARANCE, {appearance:
  merged})` — the exact mechanism the Setup panel's own `ap_*` fields already use (`onPatchFieldChange` →
  `_cgSyncPatchSlot`), so a Sheet-tab edit and a Setup-panel edit of the same character can never fight
  each other, and the no-op-skip / labeling / re-pricing behavior is inherited for free. Also mirrors the
  new value into the Setup panel's own `#ap_<key>` field if it isn't the currently-focused element, so
  the two views never visibly disagree while both are reachable.
- **Live Sheet's `_shCommitAppearanceField`** has no `PATCH_SLOTS` to reuse (Live Sheet never needed a
  coalescing-patch system before this). It finds the LATEST existing LOG event carrying an `appearance`
  patch and replaces it **in place at that array index**, or appends one if none exists yet — never
  appends a fresh event on every edit. Position-stability matters for two reasons: it mirrors
  `replacePatchSlot()`'s own rule ("position is what makes a ledger readable" — a moved line reads as a
  new purchase), and it keeps a cost:0 appearance edit from ever landing at the very end of the LOG,
  where `undo()` (which pops the last entry) could silently undo the player's *description* edit instead
  of their last real purchase on the next click.
- Both tools' `SHEET_APPEARANCE_FIELDS` list is a plain array constant, kept identical across the two
  duplicated files by hand (same maintenance shape as every other piece of shared logic in this
  architecture — there is no shared module to import from).

## Why

**Because the data already has one true home (the LOG), and a second, disconnected local copy of a
subset of it is a data-loss trap by construction** — any UI surface that shows LOG-backed data must
either be read-only or write back to the LOG; a silent third state ("looks editable, isn't really") is
strictly worse than either. The merge-with-full-object and position-stable-replace choices both follow
directly from the same principle: a fix that itself corrupts adjacent fields, or that fights `undo()`,
would just be trading one data-loss bug for another.

**Pre-existing local-scratch data for these 16 field keys, from before this fix, is not migrated or
recovered.** A player who had typed an edit that got silently swallowed into the old scratchpad has no
way for the app to know that value was ever "the intended one" versus abandoned draft text — the LOG
value (cloud-synced, cross-tool) is the only trustworthy source of truth to fall back to, which is
exactly what `hydrateSheet()` now always shows.

## Verification

New gate assertions in `testing/scripts/tool-pricing-ci.mjs` (both tools): a committed field lands in
`b.appearance` and never in `csLoad()`; a second commit coalesces (CharGen) or replaces in place (Live
Sheet) rather than appending a duplicate LOG event; other appearance fields not shown on the Sheet
survive an edit untouched; a stale local-scratch value is ignored in favor of the live LOG value on
re-render; a genuinely-scratch field (Player Name) is confirmed to still round-trip via the old
mechanism, unaffected. `engine-parity` 29/0 and the rest of `tool-pricing-ci` unaffected —
`js/engine.js` untouched. Confirmed red first: reverting only the two tool-file changes (keeping the new
test) threw `ReferenceError: _shCommitAppearanceField is not defined` and failed the gate, before the
fix was restored.

## Related

- `js/character-store.js`'s `buildCharacterEnvelope()` — confirms what a cloud Save actually contains
  (`{schema,rules,name,LOG,SEQ,id,campaignId}`); the local scratchpad was never part of it.
- `replacePatchSlot()` (CharGen) — the position-stability precedent Live Sheet's new
  `_shCommitAppearanceField` deliberately mirrors, despite having no shared code path with it.
- `D-GH-2026-08-05-creation-vs-awarded-ap` / `D-GH-2026-08-06-creation-lock-survives-reload` — the most
  recent prior examples of a board-described bug turning out to have a different root cause than
  assumed; this one was found independently (not from the task board) but fits the same pattern of
  "verify the actual mechanism before proposing a fix."
