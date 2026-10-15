# D-GH-2026-10-15-livesheet-armour-ac — AC follows what you wear and your class features; the best formula wins

Status: Active. Engine, Live Sheet, CharGen, Players Guide (served copy and the `pact-guide` master) in this change.
`DATA.version` v0.376 → v0.377 (`compute()`'s `ac` changes for characters who own an unarmoured class feature and wear no armour).
AP totals, legality and warnings are unchanged for every existing fixture (105/105 old vs new, AC included).

## Context

Owner request 2026-10-14 (decision AK1: a full rules change is allowed): a Live Sheet dropdown for the armour the character is
WEARING (none / each armour / shield on-off), with the AC following it and the character's class features — Barbarian Unarmored
Defense, Monk Unarmored Defense, Draconic Resilience, Mage Armor — using the best applicable formula.

What the engine already had (v0.376): a free `wornArmour` LOG event (Live Sheet `setWornArmour()`, CharGen's post-lock step), AC =
the worn armour's base or 10 + Dex, then +2 whenever the character was **trained** in shields, −1 for Thin-Skinned. No class
formula was applied anywhere, and there was no way to say "the shield is not in my hand" — which Monk Unarmored Defense needs.

## Options

- **A1 — engine formulas + a new free `shieldWorn` field, Mage Armor as a `wornArmour` value (chosen).** All rules in `compute()`;
  the tools only record choices and display `compute()`'s answer.
- A2 — apply Mage Armor automatically whenever the character knows the spell. Rejected: the spell has to be cast (a slot, 8 hours),
  and an ally can cast it on someone who does not know it. Picking it is the honest input.
- A3 — a shield-in-hand field that defaults to "not carried". Rejected: every existing shield-trained character would lose 2 AC.

## Decision

1. **Inputs (all cost 0, logged so they sync and the DM sees them):** `b.wornArmour` — an armour name, `""` for none, or
   `MAGE_ARMOR` (`"Mage Armor"`, new engine export) while the spell is up; `b.shieldWorn` — new; `false` = shield set down,
   absent = carried whenever trained (every save before v0.377 keeps its shield bonus). New MUT `shieldWorn`.
2. **Formula:** worn armour → its base (heavy no Dex, medium Dex ≤ 2, light full Dex), exactly as before. No armour → the best of:
   10 + Dex; Mage Armor 13 + Dex (only when picked); Barbarian Unarmored Defense 10 + Dex + Con; Monk Unarmored Defense
   10 + Dex + Wis (not with a shield in hand); Draconic Resilience 10 + Dex + Cha. Then +2 for a shield in hand (needs shield
   training), −1 Thin-Skinned. A feature counts only if it is **owned the way pricing counts it** — not blocked by its Hit-Dice gate
   or a missing prerequisite, not the uncounted second copy of a two-door subclass ability (Draconic Resilience is sold through both
   `features` and `subAbilities`).
3. **No new warnings.** `compute().warnings` feeds `purchaseLegality()`, so a "Monk UD needs no shield" warning would have made
   buying Monk Unarmored Defense look illegal to a shield-trained character. Advice goes in the new additive `acInfo`
   (`{src, base, parts, shield, shieldTrained, thinSkinned, options, notes}`), which the Live Sheet's AC tooltip now reads instead of
   re-deriving the breakdown itself.
4. **Live Sheet:** a "Wearing" row under the stats KPIs — the worn-armour `<select>` (shared with the buy menu's, one builder
   `_wornArmourSel()`), a Shield box (`setShieldWorn()`), and the formula used. **CharGen:** a Mage Armor option and a
   "Shield in hand" box. The box only becomes a stored value once touched (or loaded from a save that has one), so no existing
   character's Armour patch gains a key — the server's freeze protects every non-exempt patch key in pre-lock history. Locked
   characters record it as a `shieldWorn` buy event, like `wornArmour`. **DM Console:** unchanged; it shows `compute().ac`.
5. **Guide:** a "How your sheet works out your AC" callout after "Mage Armor vs. worn armour" (§13), in the served copy and the
   `pact-guide` master.

## Blast radius (live, 2026-10-15, 40 rows)

The change can only raise AC, and only for a character who owns one of the three features and wears no armour (the shield default
preserves every existing shield bonus). 3 rows mention Unarmored Defense or Draconic Resilience; all three are Anders Pipeleaf
(DEX 16, CON 12, Barbarian Unarmored Defense bought at Hit Die 6, "Worn armour — none"): the campaign character and two solo DM
copies, **AC 13 → 14**. No row carries Mage Armor or a `shieldWorn` value yet. Every repo fixture: 0 of 105 change.

## Why

AC is a rules value, so it belongs in `compute()` — the tools must agree by construction, not by three copies of a formula. The
worn choices are inputs in the LOG (like appearance), never stored derived values.

## Gates

`engine-parity` 113/0 (8 new `CG-071`–`CG-078` fixtures with a new optional `_expectAc` assertion in both the Node and browser
runners; 5 fail on the old engine), `worn-armour-ac-ci.mjs` 23/0 (14 new checks), new `livesheet-armour-ac-e2e.mjs` 23/0 across
all three tools (7 fail on old code), tool-pricing, legality, priceOf, post-lock parity fuzz (0 mismatches), guide checks.

## Open (owner questions)

- The Defense Fighting Style (+1 AC while wearing armour) is still "apply manually" on the sheet, as are magic items.
- Draconic Resilience's hit-point increase is not applied by `compute()` (AC only, as requested).
