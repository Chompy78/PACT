# D-GH-2026-10-15-names-slot-helper — one engine list of the language and spell slots a character owns; the gate counts languages and spells only

**Status:** IN FORCE. Shipped as PR 1 of `docs/plans/2026-10-15-names-before-spending.md` (`refactor/names-slot-helper`).
No behaviour change, no `DATA.version` bump. The gate itself (PR 2, `feat/names-before-spending`) is not built yet.

## Context

Owner request 2026-10-12: a locked character may not spend more AP while any language or spell slot it owns is still
unnamed. Names live in the ✎ Name spells & languages dialog (`openNames()`, a separate copy in CharGen and in the Live
Sheet). Each copy counted the slots itself, so a gate would have been a third count that could drift from what the dialogs
show.

Starting the work showed the two dialogs do **not** render the same slots. The Live Sheet's renders languages,
out-of-tradition cantrips, innate spells, discipline cantrips and known spells, Mystic Arcanum, fighting styles (and the
cantrips they grant), Metamagic, maneuvers, choice-grant spells and an epic-boon ability picker. CharGen's renders the same
minus Arcanum, fighting styles, Metamagic and maneuvers (it only carries those names through on save). A gate counting
"everything the engine knows about" could therefore leave a CharGen character with a blank slot it has no row to fill.

## Options

- **M1 — languages and spells only** (language, out-of-tradition cantrip, innate spell, discipline cantrip, known spell,
  Mystic Arcanum). Matches the owner's words.
- M2 — every slot the Live Sheet renders. Broader than the request, and half of it is not fillable in CharGen.
- **N1 — the helper takes a list of kinds; each tool passes what its dialog can render.** Smallest change, cannot strand a
  character.
- N2 — add Arcanum rows to CharGen's dialog first. The deeper fix, but a UI change; logged as the board task
  `feat/chargen-names-arcanum-rows` instead.

## Decision

`js/engine.js` exports `allNameableSlots(build)` (every owned slot, named or blank, in the order the dialogs list them, with
the dialog's own `data-k` key) and `unnamedChoices(build, {kinds, poolSize})` (the blank ones). Both dialogs build their
language and spell rows from `allNameableSlots`; the other rows stay in the dialog code. A slot with no legal name (the
tool's `poolSize` returns 0) is skipped, so nobody is stuck on a slot they cannot fill (owner decision I1). Languages never
need that: `campaignLanguages()` falls back to the standard list, so it is never empty.

## Why

One list means the dialog and the gate cannot disagree. M1 + N1 keep the gate to what the owner asked for and to what each
tool can actually show. The refactor was proven behaviour-neutral by snapshotting the dialog body before and after on two
seeded characters in both tools (byte-identical); `testing/scripts/names-dialog-e2e.mjs` keeps checking the rows against the
helper, and `names-slots-ci.mjs` pins the helper itself.

## Status

IN FORCE. Open follow-ups: PR 2 (the gate, the `rules.requireNames` DM switch, default on) and
`feat/chargen-names-arcanum-rows` (after which CharGen stops skipping Arcanum).
