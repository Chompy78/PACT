# D-GH-2026-08-10-expand-random-names — random name pools roughly tripled/quadrupled

Status: **Active**, 2026-08-10.

## Context

Owner report, same session: "i keep getting the same name." `genName()` pools a naming style's `first`/
`last` arrays from `NAMEDATA`, filtered by the chosen style checkboxes plus any race/class influence
toggle, then picks one of each uniformly at random. Measured before touching anything: each of the six
styles (`heroic`, `rugged`, `elvish`, `dark`, `mystic`, `common`) held only ~12-16 first names and ~8-10
last names — small enough that repeats become noticeable well before a DM has rolled through a dozen
NPCs, let alone tested the feature repeatedly in one sitting.

## Decision

Expanded every style's `first` and `last` array roughly 3-4x (final floor: ≥40 first names, ≥25 last
names per style — see exact counts in the Verification gate, which checks the live data rather than a
number typed into this doc). **Additive, not a rewrite** — every original name is still present, always
at the front of its array, so no existing save data or expectation shifts; the new names are appended
after. Same `NAMEDATA` shape (`{style:{first:[...],last:[...]}}`), same six style keys, same
`RACE_STYLE`/`CLASS_STYLE` influence mapping — `genName()` itself needed no code change at all, only more
data for it to draw from.

Each style's new names were written to match its existing theme (confirmed by re-reading the *existing*
names in each pool before adding to it, not invented in isolation): `heroic` stays noble/medieval-English,
`rugged` stays guttural dwarf/orc-coded, `elvish` stays flowing/elven-fantasy-convention, `dark` stays
gothic/villain-coded, `mystic` stays ethereal/arcane, `common` stays plain folk names — so a style's
"flavour" doesn't drift as its pool grows.

## Why this shape, not something else

- **Not** a move to a probability-weighted or Markov-generated name scheme — the ask was specifically
  "expand the tables," and the existing uniform-pick-from-array mechanism already works; a bigger table
  is the minimal change that solves the actual reported problem (repeats), not a rewrite of the generator.
- **Not** a per-species/per-class dedicated pool restructure — `RACE_STYLE`/`CLASS_STYLE` already blend
  multiple styles' pools together for a given species/class (e.g. Human → `common`+`heroic` combined),
  so growing the shared per-style pools benefits every combination that draws from them, without touching
  the blending logic at all.

## Verification

`testing/scripts/tool-pricing-ci.mjs`: 2 new checks — every style has ≥40 first / ≥25 last names with no
duplicate entries within a style's own list (a pasted-twice name would reduce real variety without
showing up as a raw count regression, so both are asserted); the original heroic names are still present
(confirms additive, not a silent replacement). 134/0 overall. `engine-parity-ci.mjs` unaffected, 30/0 —
pure data addition, no rules/pricing logic touched, no `DATA.version` change (this is `NAMEDATA`, a
CharGen-local flavour table, not the shared `js/engine-data.js` rules dataset).

## Related

- `D-GH-2026-08-10-custom-appearance-fields` — same session, same area of the Setup panel, bundled onto
  one branch/PR per AGENTS.md's low-risk-batch allowance; each still has its own decision record and
  `CHANGELOG.md` line.
