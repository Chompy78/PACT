# D-GH-2026-10-11-creation-lock-enforcement — the creation lock is visible, refuses other species' traits, and freezes creation Vigor

Status: Active. Engine + CharGen + Live Sheet in this change. `DATA.version` v0.374 → v0.375 (`compute()` output changes for
locked characters with creation Vigor). Blast radius measured against live Supabase on 2026-10-11: 37 characters, 19 locked,
**2 change** (Wren Ashdown Ch8-12 138 → 126 AP, Caspian 107 → 101), both cheaper; **0** trip the new cross-species refusal.

## Context

The owner reported three bugs on 2026-10-11:

1. CharGen and the Live Sheet gave no sign that a character had finished creation. Both just hid the "Finish creating"
   button, so a locked character looked the same as a legacy one with no creation limit.
2. After the lock, CharGen still sold traits from another species. Guide §10: "other-race traits may be taken only at character
   creation. Once play begins, you can no longer add a different race's abilities." The engine priced a cross-race trait at its
   `cross` price whether or not the character was locked, and enforced nothing.
3. Vigor bought during creation re-priced upward when Hit Dice rose after the lock. `compute()` already prices each Vigor rank at
   the tier stamped on it (`_vigorRankTier`), but only `cat:'vigor'` events are stamped. During creation CharGen writes Vigor as
   a `patch` of `hardy`, so those ranks had no stamp and fell back to today's tier. Reproduced in a real browser: 2 ranks at 10 AP
   became 28 AP after levelling to 5 Hit Dice post-lock, in both tools.

## Options (owner chose A2, B1, C1, D1)

- Vigor: **A1** emit `cat:'vigor'` events from CharGen during creation (new characters only); **A2** freeze unstamped ranks in
  the engine at the lock (fixes existing characters too); A3 both.
- Cross-species: **B1** an engine hard warning, enforced through `purchaseLegality()` in both tools, plus CharGen greying the
  boxes; B2 a CharGen-only guard (rules logic outside the engine, forbidden by AGENTS.md).
- Indicator: **C1** a "🔒 Creation finished" label where the button was; C2 a banner.
- Process: **D1** one branch with tests; D2 cold plan review first.

## Decision

1. `_replay()` runs the lock timeline once with a trailing probe, so it knows the lock state after the whole log as well as
   entering each event. From the first locked event on, any owned Vigor rank without a stamp is stamped at the tier in force
   right then, *before* that event's mutator runs, so an HD purchase can never raise the price of ranks bought before it. Drafts
   are untouched: before the lock, what you pay is what it costs to build today. A `patch` that lowers `hardy` drops the
   removed ranks' stamps, as the `cat:'vigor'` branch already did.
2. `_replay()` sets `b._creationLocked` (derived, never saved). `compute()` pushes a hard
   "⛔ X: traits from another species can only be taken at character creation" warning for a cross-species trait whose own
   `_raceTraitLocked` stamp is true, or which has no stamp on a locked build (the candidate `purchaseLegality()` prices). Traits
   bought during creation keep their false stamp and are unaffected. It deliberately does not reuse the `b.inPlay` fallback that
   own-race pricing uses: `baseBuild()` sets that true unconditionally, which would refuse every cross-species trait at creation
   for a build that never went through `_replay()`.
3. CharGen disables unowned other-species trait boxes once locked, with a tooltip. Both tools show a
   "🔒 Creation finished" label whenever `creationCeiling().locked` is true (not gated on `enforced`, so characters locked before
   ceilings existed show it too).

## Why

The engine is the only place the rule can live without drifting, and both tools already route post-lock purchases through
`purchaseLegality()`, so one warning closes CharGen and the Live Sheet together. Freezing at the lock rather than changing
CharGen's write path repairs the characters that already exist, and it needs no data migration because the stamps are
re-derived on every fold. The Players Guide already says what the engine now does (Vigor is priced at the tier you buy it at;
other-race traits are creation-only), so no guide change was needed.

## Verification

`testing/scripts/creation-lock-enforcement-e2e.mjs` (new; fails 6 of 11 on the previous code, passes 11 of 11 now).
engine-parity 104/0, tool-pricing 189/0, engine-legality 76971/0, engine-priceof 7701/0, post-lock-parity-fuzz 0 mismatches,
version-label 10/0, live-sheet-unlock 25/0, economy-ui 155 passed, lineage-spell-gates 26/0.
