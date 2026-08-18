# D-GH-2026-08-17-renamed-feature-aliases — a renamed `DATA.features` key silently deletes the purchase from every saved character, so renames need an alias map

**Status:** Settled and implemented (`DATA.featureAliases`, shipped with v0.350; no version bump of
its own — it changes no price).

## Context

A character is stored as a LOG of events. A `feature` purchase event holds whatever key existed on
the day it was recorded. `compute()`'s feature loop begins:

```js
for (const lab of (b.features||[])) { const f = DATA.features[lab]; if (!f) continue;
```

That `continue` is the whole problem. When a key is renamed or split, every saved character holding
the old key loses the feature **and the AP it cost**, with no warning, no ledger line, and nothing in
the UI to indicate anything went missing. It reads as if the player never bought it.

This branch did it twice:

| Removed key | Became | Where |
|---|---|---|
| `Druid: Elemental Fury / Improved circle` | `Druid: Elemental Fury` + `Druid: Improved Elemental Fury` | v0.346 (split a conflated key) |
| `Paladin: Aura expansions` | `Paladin: Aura range → 30 ft (L18)` | v0.345 (stepped-ladder rename) |

Both were correct rules changes. Neither shipped a migration.

## Options

- **B1 — Keep the old keys as hidden duplicates** in `DATA.features`. Rejected: they would re-appear
  in pickers and search unless every consumer learned to filter them, and the duplicate prices would
  need maintaining alongside the real ones forever.
- **B2 — A one-off backfill script** that rewrites saved LOGs. Rejected: local files and cloud rows
  both hold LOGs, files can be re-imported from any backup at any time, and a backfill cannot reach a
  JSON file sitting on someone's disk. It fixes the copies you can see.
- **B3 — An alias map consulted at read time.** Chosen. `DATA.featureAliases` maps old key → current
  key; `FEAT_ALIAS()` resolves it at both funnels: `MUT.feature` (so LOG replay normalises the build)
  and `compute()`'s lookup (so a build handed in directly still prices). Old data keeps working
  wherever it turns up, forever, with no migration step to run or forget.

## Decision

B3. `DATA.featureAliases` in `js/engine-data.js`, `FEAT_ALIAS` exported from `js/engine.js`, applied
at the two funnels. **Add an entry whenever a `DATA.features` key is renamed or removed** — the rule
is written at the map's definition site, where someone doing the rename will actually be standing.

## Why

The failure mode is silent data loss on files nobody is tracking, which rules out anything that has
to be *run*. A read-time alias costs one property lookup per feature and makes the bad state
unrepresentable rather than merely repaired.

The narrower reason this is recorded at all: nothing in the repo said a `DATA.features` rename was a
breaking change. Two happened in one branch, by two different mechanisms (a split and a stepped-ladder
rename), and neither author noticed — so the next one won't either unless the rule lives next to the
map.

## Status / verification

Fixture `CG-015` is a build whose **only** two features are the removed keys. It expects a
`Class features` line of 43 (11 + 32), so if the aliases ever stop resolving the fixture drops to a
missing line and parity goes red — the fixture asserts the migration, not just the arithmetic.
