# D-GH-2026-10-20-apply-numeric-grants — the sheet applies the AC, HP and speed that six abilities grant

Status: Active. Rules `DATA.version` v0.384 → v0.385. Engine, Live Sheet (explanations), the served Players Guide and the `pact-guide` master in this change.

## Context

The 2026-10-20 grants audit found six abilities that are priced and described, but whose number `compute()` never added: College of Dance's Dazzling Footwork (Unarmored Defense), Boon of Fortitude (+40 HP), and the speed grants Monk Unarmored Movement, Barbarian Fast Movement, Speedy and Boon of Speed. A player paid for a bonus the sheet did not show.

## Options and owner pick

- BK1: make the engine apply them (a correctness fix; rules version bump and tests).
- BK2: leave them as description text only.

Owner (2026-10-20): BK1.

## Decision

All in `compute()`, each counted only when the ability is owned and counted for pricing (`_ownsEff` for features and subclass abilities; boons and arts only when not blocked by their Hit Dice gate or prerequisite):

- **Dazzling Footwork:** a new unarmoured AC formula, 10 + Dex + Cha, with no armour and no shield in hand (2024 PHB; the Monk's rule). With a shield in hand it gives a note and the same "set the shield down" nudge Monk Unarmored Defense has.
- **Boon of Fortitude:** Hit Point maximum +40 (`hpFortitude` in the result).
- **Speed:** Unarmored Movement +10, or its highest bought step (+15/+20/+25/+30; the steps do not stack), only with no armour and no shield in hand; Fast Movement +10 unless wearing heavy armour; Speedy +10; Boon of Speed +30. They add after the species/lineage/trait floor and before drawback penalties. `speedInfo {base, parts, notes}` lists each, and the Live Sheet's Speed and HP explanations name them.

No price changes. Live check 2026-10-20: no character owns any of the six (positive controls: Unarmored Defense and Sneak Attack, 3 each), so no live sheet changes.

The 2024 numbers are from memory of the PHB, as the audit's were; they match the data's own `fx` text where it has any (Boon of Fortitude, Speedy, Boon of Speed).

## Why

These are a correctness fix, not a rules choice: the price was already being charged. `testing/scripts/numeric-grants-ci.mjs` (22 assertions, in `engine-parity.yml`) pins each grant, its conditions and that no price moved, since engine-parity pins only AP totals and warnings.
