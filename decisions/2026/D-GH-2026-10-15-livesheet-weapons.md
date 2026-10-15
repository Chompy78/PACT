# D-GH-2026-10-15-livesheet-weapons — the standard weapon table lives in `js/engine.js`; a picked weapon stays linked to its definition; DM weapons and the campaign weapon list live in `campaigns.rules`

**Status:** IN FORCE. Shipped in PR #667 (`feat/livesheet-weapons`). Display/sheet data only; no `DATA.version` bump.
Revised the same day by owner decisions **AL2**, **AM2** and the campaign weapon list (see the Addendum) — the "copy, not
reference" choice below was **reversed** by AL2.

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

## Addendum (2026-10-15) — owner decisions AL2, AM2 and the campaign weapon list; review fixes

**AL2 — a DM's edit reaches every sheet (reverses "copy, not reference").** Each sheet weapon stores `ref`: `'std:<id>'` (a
standard weapon), `'camp:<id>'` (a campaign weapon) or `'atk:spell'`. Campaign weapons now carry a **stable id** (DM Console
generates one per new row; a pre-id entry gets `'n-<name>'`), so a rename keeps every sheet linked. Every read of the sheet
(`_psGet()`) refreshes dice, type, properties, range, reach and attack ability from the current definition, and the Live
Sheet saves that refresh once (into the same single appearance event) so the character's own copy follows. **This
overwrites any player edit to those stats** — which is why AM2 locks them. The entry's name follows a rename only while
the player kept the weapon's own name (`base` records it); a name the player chose is kept.

**AM2 — linked stats are read-only.** On standard and campaign weapons the dice, type, properties, normal/long range,
reach and attack ability are disabled on the sheet, and `_psEdit()` ignores a forced edit to them. The player keeps the
name, proficiency tick, magic bonus and notes (the magic bonus is a property of the player's own weapon, not the weapon
type — a judgement call, flagged to the owner). A spell attack locks only its ability. Free-text entries (no ref) and
every weapon saved before this stay fully editable — no data loss. If a linked definition disappears (the DM deleted it,
or the character left the campaign) the entry keeps its last stats, is flagged, and becomes editable, since nothing can
update it any more.

**The campaign weapon list** — `rules.weaponList = {list:[standard ids], strict}`, modelled on `rules.languages`. DM
Console ticks the standard weapons (all ticked saves `[]`); "Only offer the ticked weapons" (strict) OFF offers every
standard weapon, ON only the ticked ones. The campaign's own weapons and the Unarmed Strike are always offered. A weapon
already on a sheet is never removed: it shows "not on this campaign's weapon list" (and stays selected in its picker).

**Review fixes.** Notes show on the one-line view (older weapons kept range/properties there). At most
`CUSTOM_WEAPON_MAX` = 50 campaign weapons (rules are copied into every bound character's LOG as a `rulesSnapshot`); the
chosen list is bounded by the 38 standard ids. `campaignWeapons()` no longer strips `&` (rendering escapes it), splits
properties only on commas outside brackets, and no longer drops a custom weapon named like a standard one — it is its own
weapon with its own ref, and DM Console shows a note on that row. A custom weapon with category "other" sets proficiency
off deterministically. ✎ is hidden on an unnamed row; the open/closed row state resets when another character loads.

**MERGE NOTE — feat/campaign-house-rules.** DM Console's Save rules builds the blob key by key. Whichever of this PR and
`feat/campaign-house-rules` merges second must keep **both** `customWeapons` and `weaponList` in that literal **and** the
house-rules branch's `charHouseRules` handling (`_rulesBlobForSave()` / `_rulesKeepChr()`). Tracked on
`docs/TASK_BOARD_NEXT.md` ("feat/campaign-house-rules merge — keep customWeapons + weaponList…").
