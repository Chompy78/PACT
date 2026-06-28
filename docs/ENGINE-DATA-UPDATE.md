# Task 0 — land the PHB page numbers + drawback text (do this first)

> **Why this isn't just "replace engine.js":** the snapshot you shared exports only `DATA`, `compute`,
> `rebuildStateFromEvents`, while your live `js/engine.js` (per `AGENTS.md`) also exports `baseBuild`, `MUT`,
> `activeEvents`, `economy`, `foldBuild`. So the snapshot is **behind your live repo** — overwriting the live
> engine with a snapshot-based file would drop those exports. Instead, apply this as a **surgical DATA edit**
> to whatever your current `js/engine.js` is. It only touches `DATA`; `compute()` is unchanged; `DATA.version`
> stays `v0.322`.

## Paste this to Claude Code / Copilot
```
In js/engine.js, update DATA only (do not change compute() or DATA.version — these are display-only
fields the engine never reads). Apply exactly the changes in engine-data-update.json:

1. DATA.masteryFx — set page: 214 on all 8 entries
   (Cleave, Graze, Nick, Push, Sap, Slow, Topple, Vex).
2. DATA.arts — add a page field to the 41 entries listed under "arts_add_page" (name -> PHB page).
   Leave Blessed Warrior and Druidic Warrior with NO page (they have no PHB feat entry).
3. DATA.drawbackFx — replace the string for each of the 10 entries under "drawbackFx_replace_strings"
   with the exact value given.

Then open testing/tests/engine-parity.html and confirm 5 passed / 0 failed (it must be unchanged,
because compute() is untouched). Add a CHANGELOG.md entry and commit on a branch.
```

Attach **`engine-data-update.json`** (in this folder) so the agent has the exact page numbers and strings.

## The data (also in engine-data-update.json)
- **Weapon-mastery pages →** `DATA.masteryFx[*].page = 214` for: Cleave, Graze, Nick, Push, Sap, Slow, Topple, Vex.
- **Arts & Techniques pages →** add `page` to 41 of 43 arts (e.g. Healer 201, Lucky 201, Actor 202,
  Crossbow Expert 203, Great Weapon Master 204, Sentinel 207, Archery 209, Two-Weapon Fighting 210 …; full
  list in the JSON). **Blessed Warrior** and **Druidic Warrior** stay page-less.
- **Drawback text →** replace 10 `drawbackFx` strings to match Players Guide v0.324 (Missing Arm, Peg Leg,
  Slow-Footed, Berserk Temper, Faltering Resolve, Reckless, Hexed Luck, Mana-Sick, Soul Debt, Prophesied
  Doom). These add DEX/WIS "cap" wording that `DATA.drawbackMaxStats` already enforces — display only.

## If your live repo turns out to match the snapshot exactly
Then the ready-made `js/engine.js` I delivered last turn (`output/github-update/js/engine.js`) is a valid
drop-in. But **verify first**: open your live `js/engine.js` and check it exports `foldBuild` etc. If it does,
use the surgical edit above instead of the drop-in.

## Done when
`engine-parity.html` is still 5/5, and the three tools show "(PHB p.N)" on masteries/arts and the fuller
drawback text in their tooltips.
