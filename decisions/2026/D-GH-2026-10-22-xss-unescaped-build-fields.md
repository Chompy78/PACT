# D-GH-2026-10-22-xss-unescaped-build-fields — numeric build fields are coerced in the fold, and every render site is escaped too

Status: **accepted 2026-10-22** (branch `fix/xss-unescaped-build-fields`). No mechanics change: `DATA.version` and `BUILD` unchanged.

## Context

`MUT.patch` is `Object.assign(b, clone(p.patch))`, so a saved LOG can carry a `buy`/`patch` event that sets any build field to
any JSON value. `compute()` coerces its numeric inputs, but only on its own copy (`Object.assign({}, b)`); `foldBuild()` returned
the raw build, which is what the tools read for display. A hostile LOG could therefore leave an HTML string in `hd`,
`languages`, `ki`, `sorcery`, `hardy`, `tough`, `attune`, `traditions[].rank` or `disciplines[].slots[]`, and several render
sites concatenated those straight into `innerHTML` or an attribute:

- DM Console: `hd: b.hd` in the roster record, rendered raw in the roster table, cards and the detail header (a DM viewing the
  roster is the victim); discipline `cantrips`/`pactSlots`/`known` in the casting summary and known-spells overlay.
- Live Sheet: `t.rank`, `d.slots[]` in the spellcasting card; `b.hd`, `b.ki`, `b.sorcery`, `b.languages` in the sheet tooltips,
  KPI strip and Languages line.
- CharGen: `addRow('subabil'|'subbundle', preset)` put the raw preset text into `innerHTML` whenever it was not in the dataset
  (reached from `#b=` links, file import, autosave, cloud load, `?viewChar`).

This breaks the standing invariant that anything a signed-in user can set and another user's browser renders passes `esc()` (REV-12).

## Options

- A. Escape/coerce at each render site only (shallow). Cheap, but every future site that reads a build field has to remember.
- B. Coerce once in `foldBuild()` (deep). Makes the bad state unrepresentable for every consumer, present and future.
- C. Both.

## Decision

C. Deep: `foldBuild()` now ends with `_coerceFoldedNumerics(b)`, which applies exactly the rules `compute()` applies to its copy
(`Number(x)||0` for hardy, tough, gold, extraClasses, dabblerCantrips, languages, budget, profBonus, attune, ki, sorcery;
`hd` clamped to 1..20 by `Math.floor(Number(hd)||1)`) plus the nested fields compute() never normalised (tradition `rank`,
discipline `cantrips`/`pactSlots`, and the `slots`/`known`/`arcanum` arrays, mapped to numbers, padded to 9/9/4). `hd` uses
compute()'s clamp rather than `MUT.hd`'s: `MUT.hd` is a mutator for a purchased value, while this is the fold's output, and
matching compute() means `compute(foldBuild(L))` is identical with or without the coercion. Shallow: the listed render sites now
wrap the field in `Number(...)`/`esc(...)`, and CharGen `addRow` escapes the preset text in both the label and the hidden-input
value (it renders an unknown preset as inert text rather than dropping the row, which would change what the reconciler sees).

## Why

Both layers because they fail differently: the fold covers consumers nobody has audited, the site escapes keep working if a
tool ever reads a build that did not come through `foldBuild`. Honest data is untouched (numbers stay numbers; compute() output
for every fixture is byte-identical, parity 0 failed). The stored LOG is never rewritten; only the derived build is.

## Status

Accepted. Regression gate: `testing/scripts/fold-numeric-coercion-ci.mjs` (wired into `engine-parity.yml`). Not covered: free-text
fields (`name`, `languageNames`, `customProfs`, feature names), which the tools already pass through `esc()`; this record does
not re-audit them.
