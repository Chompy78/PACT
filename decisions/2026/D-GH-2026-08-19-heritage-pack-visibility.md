# D-GH-2026-08-19-heritage-pack-visibility — pack traits are derived, exported, and never stored

**Status:** DONE · no `DATA.version` bump (`compute()`'s pricing output is unchanged; `packTraits` is an
additive derived field)

## Context

Reported from real use: *"in chargen, when i species pack it does not tick the items included in the
heritage pack, and they do not show in livesheet."*

A heritage pack is charged as **one** line — `add("Heritage pack", DATA.pack[b.species])` — and its
member traits are then owned **implicitly**: `compute()`'s `_ownsR` treats them as held whether or not
they appear in `b.racialTraits`, which is what makes prerequisite checks resolve.

That ownership was **derived and never exported**, so no UI could render it:

- **CharGen** left the checkboxes unticked while their own price label read `in pack` — the grid said
  "you have this" and "you don't" in the same row.
- **The Live Sheet's character sheet** built *Features & Traits* from `b.racialTraits` alone, so the
  traits were absent from the sheet entirely.

(The Live Sheet's *buy* panel was already correct — it filters `&& !DATA.racial[l].pack`, so it never
offered them for sale. An early guess that it did was wrong and checked before acting on.)

## Decision

Export the derived ownership; do **not** write it into the build.

`packTraitsFor(species, species2)` is a new pure-`DATA` export in `js/engine.js`, and `compute()`
additionally returns the same list as `packTraits`. Pure `DATA` matters: CharGen needs it inside
`readBuild()`, which runs *before* `compute()`.

## Why the tools must not tick these into `b.racialTraits`

That is the obvious fix and it is a trap. In-pack traits price at 0 **only while the pack is yours**
(`isO && r.pack -> 0`); stored and then followed by a species change, they re-price at the **cross**
rate. Measured on the shipped engine:

```text
racialTraits: ['Dwarf: Dwarven Resilience']
  species Dwarf -> "Species traits"  0 AP
  species Elf   -> "Species traits"  3 AP     <- silent overcharge
```

Pack membership is derived from species and must stay derived — the same *"never store derived values"*
rule the persistence model already states. So CharGen ticks the boxes for **visibility** and
`_cgStripPackTraits()` removes them again in `readBuild()`, using the engine's list rather than testing
`rr.race === b.species` locally (that test is rules logic).

## The fix's own first version had the bug it was preventing

Ticking without **un**-ticking left the *previous* species' pack boxes set after a species change. Those
are no longer in the current pack, so `_cgStripPackTraits` did not strip them and they entered the build
as **cross-race purchases** — exactly the overcharge above.

The gate caught it, not a human: the check read `[.., 4, 2]` where `[.., 2, 0]` was expected — four boxes
ticked, two traits stored, on a character whose pack grants two. Fixed with a `data-packTick` marker, so
a later render undoes exactly the ticks the pack made and nothing else. A player's own cross-race tick of
another species' pack trait is legal, carries no marker, and is never touched.

This is why the 4th value in that assertion is load-bearing rather than incidental.

## Verification

`tool-pricing-ci` 143 → **146**, then → **148** with the version checks below.

- CharGen ticks and disables every trait the Dwarf pack grants, ticks **only** the current pack, and
  stores none of them.
- Switching Dwarf → Elf un-ticks the old pack and still stores nothing.
- The Live Sheet's character sheet lists both pack traits, with `b.racialTraits` still empty.

Parity 40/0 (unchanged — no pricing moved), plus all other gates green.
