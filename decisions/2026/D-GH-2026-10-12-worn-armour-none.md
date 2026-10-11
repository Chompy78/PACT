# D-GH-2026-10-12-worn-armour-none — with no armour worn, AC is unarmoured

Status: Active. Engine + Live Sheet AC breakdown in this change. `DATA.version` v0.375 → v0.376 (`compute()`'s `ac` changes for
characters trained in armour who are not wearing any). AP totals, legality and warnings are unchanged for every log (104/104 parity).

## Context

When `wornArmour` was empty, `compute()` set AC from the best armour category the character was *trained* in: heavy 18, medium
13 + Dex (max 2), light 11 + Dex, else 10 + Dex. That fallback predates the "Worn armour" picker. Both tools now label the empty
choice "none / unarmoured (10 + Dex)", and the free pick logs "Worn armour — none (unarmoured)". So the sheet's AC disagreed with
the character's own history and with the picker's label. Found by the 2026-10-11 overnight audit. The Players Guide already treats
armour as something you wear; it never says training alone raises AC, so the guide needs no change.

## Options (owner chose G1)

- **G1** — "none" means unarmoured AC; drop the fallback.
- **G2** — keep the fallback and relabel the picker "best owned". No numbers change.

## Decision

1. `compute()`: with no (or an unknown) `wornArmour`, `ac = 10 + Dex`. Shield (+2) and Thin-Skinned (−1) apply as before. The
   medium/heavy "needs STR 10" warning is unchanged.
2. The Live Sheet's AC breakdown tooltip had its own copy of the fallback; it now matches.
3. Gate: `testing/scripts/worn-armour-ac-ci.mjs` (9 checks; 6 fail on the old engine), wired into `engine-parity.yml`.

## Blast radius (live, 2026-10-12, 37 rows, 35 with a history; no row changed since the 2026-10-11 snapshot)

10 characters lose 1 AC; all are light-trained with nothing worn. Two are campaign characters (Anders Pipeleaf 14 → 13, Moss
Stormspud 9 → 8); the other 8 are solo copies/checks of those or test characters (Bryn Marsh, Marius Stormholt, check-Anders
Tealeaf). Each player gets the old AC back by picking the light armour they actually wear (free, either tool). No data migration:
the stored history is right; only the derived number changes.

## Why

The history is the source of truth; a derived value that contradicts it is a bug. Training is the right to wear armour, not armour.
