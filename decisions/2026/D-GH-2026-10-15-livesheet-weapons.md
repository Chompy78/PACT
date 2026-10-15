# D-GH-2026-10-15-livesheet-weapons — the standard weapon table lives in `js/engine.js`; a picked weapon is copied onto the sheet; DM weapons are `rules.customWeapons`

**Status:** IN FORCE. Shipped in the `feat/livesheet-weapons` PR. Display/sheet data only; no `DATA.version` bump.

## Context

Owner request 2026-10-14 (`docs/TASK_BOARD_NEXT.md`, `feat/livesheet-weapons`): the Live Sheet's weapons panel should be
"Weapons & attacks", offer every Players Handbook simple + martial weapon (dice, type, properties, range), let the DM add
campaign weapons, give every entry range fields (normal / long, melee reach) and show each weapon on one line.

Before this the rules data had **no weapon table at all**: the panel (`b.appearance.playerSheet.weapons`, #630) was free
entry, and the engine's `weaponAttack()` only turned an ability/proficiency/magic-bonus choice into to-hit and damage bonus.

## Options

- **Where the weapon table lives.** (a) `DATA.weapons` in `js/engine-data.js`. (b) A new `js/weapons-data.js` module.
  (c) A `WEAPONS` export in `js/engine.js` beside `weaponAttack()`.
- **How a picked weapon is stored.** (a) By reference (`wid` only; stats looked up at render). (b) Copied: the picked
  entry's dice/type/properties/range are written onto the sheet entry, `wid` kept as provenance.
- **DM weapons.** (a) A new table + RLS. (b) A key in `campaigns.rules`, edited in DM Console's Campaign Rules.

## Decision

- **Table: (c).** `export const WEAPONS` (38 PHB weapons + Unarmed Strike) and two helpers, `weaponSheetDefaults(w, b)`
  (attack ability from the properties; proficiency from `b.weaponProf`, or null when the build can't say) and
  `campaignWeapons(rules)` (standard list + the cleaned campaign list). `weaponAttack()` gains `ab:'SPELL'` (spell attack
  from `compute()`'s `castMod`/`prof`), additively.
- **Storage: (b), copy.** Every field stays editable on the sheet.
- **DM weapons: (b)**, `rules.customWeapons = [{n,dice,type,cat,kind,props,rn,rl,reach}]`, carried by the whole-blob
  **Save rules** (it builds the blob key by key, so a key it doesn't name is wiped on save). Its own key, separate from
  `feat/campaign-house-rules`' `rules.charHouseRules`.

## Why

- **(c) over (a):** `engine-data.js` is one ~200 KB line, so any edit there collides with every parallel branch touching
  `DATA` (armour/AC was in flight). `compute()` never reads the table (weapons cost no AP; only proficiency does), so it is
  not a rules change either way and needn't be in `DATA`. **(c) over (b):** a new module imported by `engine.js` must
  itself be network-first and pre-cached in `service-worker.js` (the rule that file encodes), and `pact-guide` vendors
  `engine.js` — one more import is one more file to keep in step, for a ~4 KB table.
- **Copy, not reference:** a DM editing or deleting a campaign weapon, or a character leaving the campaign, must not
  silently change a weapon already on a character's sheet; the player can also adjust any value (magic weapon, house rule).
- **`campaigns.rules`:** players already read it (live, or from the LOG's `rulesSnapshot` offline), the DM already edits it
  in one place, and the server has no key whitelist, so no migration is needed. DM text crosses users (REV-12), so the
  engine strips markup on save **and** on every read, and both tools render it through `esc()` into attributes; nothing
  DM-typed goes into an `onclick` (rows are addressed by `data-*` index).
- **Proficiency:** the build records "N martial weapons" without saying which, so `weaponSheetDefaults` returns null there
  and the player's tick is kept, rather than guessing.
