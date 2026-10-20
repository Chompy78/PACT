# D-GH-2026-10-20-primal-order-magician-warden — Primal Order and Divine Order split into their 2024 options; the proficiency one is free and the ladders charge for it

Status: Active. Rules `DATA.version` v0.379 → v0.380. Engine data, engine, both tools (cantrip picker, page numbers, version literals), the **served**
Players Guide and the **`pact-guide` master** (edited through the connector, owner approval AC) in this change. Plan: `docs/plans/2026-10-20-primal-order-magician-warden.md`
(two rounds of cold review, both archived under `docs/plans/cold-reviews/`).

## Context

`Druid: Primal Order` and `Cleric: Divine Order (Protector/Thaumaturge)` were ordinary priced features (5 AP, tier 1) that the engine did nothing with. The 2024
rules give each a choice: Druid **Magician** (one Druid cantrip + a Wisdom bonus to Arcana/Nature checks) or **Warden** (martial weapons + Medium armour); Cleric
**Thaumaturge** (one Cleric cantrip + a Wisdom bonus to Arcana/Religion checks) or **Protector** (martial weapons + Heavy armour). The owner's concern: an option that
hands out proficiency which PACT sells separately (martial 8, Medium armour 4 + Light 2, Heavy 6, Simple 1) must never cost less than buying those. One live character
(four rows: main, old copy, DM copy, test copy) owned the Druid one, with no Simple weapons and no armour; nobody owned the Cleric one (40 characters, checked 2026-10-20).

## Options and owner picks

- Shape: one feature with a stored choice (E2) vs two feature keys. **Two keys** (the reviewers agreed): the player sees the same thing, it needs no new choice mechanism, and
  both can be bought (owner: not mutually exclusive).
- Warden/Protector price (H1/G1/H-series): a priced 12 AP feature needing Simple and Light first cannot use `prereq` (it only reads features) and double-charges anyone who
  also buys the proficiencies; a 15 AP bundle double-charges owners of Simple or Light. **H1 chosen:** no price of its own (`free:true`), `grantsProf` switches the four (five)
  flags on, and the existing lines charge for the union. A purchase's frozen cost is a compute delta (`priceOf`), so the ledger records exactly 15 (Warden) / 21 (Protector),
  and 0 for anything already owned.
- Magician/Thaumaturge: **6 AP** (owner picks I2, V1a); data origin 6 / cross 7.
- The live owner (Q3, Y1, Z1): the old key is kept as a retired item (`bar:true`, the existing flag Weapon Mastery uses) at its recorded 5 AP, **not aliased** (an alias to
  Magician would have raised that character's total by 1 AP and the player chose Warden). It keeps granting all martial weapons and Medium armour **without** Simple or Light,
  for the 5 AP already paid (`grandfather`: displayed, never priced, no warning). A DM can still zero the purchase with the shipped `dmDiscount` if they ever want the new Warden.
- Guide loophole rule (AB1): none added; the existing section on the DM's final say over any purchase is relied on.

## Decision

1. Data: `Druid: Primal Order (Magician)`, `(Warden)` and `Cleric: Divine Order (Protector)`, `(Thaumaturge)` added; both old keys `bar:true`, the Druid one with `grandfather`.
2. Engine: `profGrants(b, owned?, blocked?)` returns priced and displayed flags; `compute()` prices `priced`; `weaponSheetDefaults()` and `armourEligible()` read the displayed
   ones. `f.free` forces the feature's own price to 0 *after* the cross-class and Martially Bound adjustments (otherwise a Martially Bound buyer pays the floor of 1 —
   found by a mutation check, pinned in `prof-grants-ci.mjs`). `skillMods()` gains `bonus` from `checkBonus`. `grantedSpells()` lists a feature's cantrip. `foldBuild()` is
   deliberately untouched (CharGen repaints its checkboxes from the fold and would save derived flags as raw ones).
3. Tools: a cantrip row per owned cantrip feature in the ✎ Name dialogs of the Live Sheet and CharGen (`fsc::<feature label>::<i>`, the existing fighting-style cantrip map;
   CharGen merges into the saved map rather than replacing it). Live Sheet skill hover text shows the bonus. Page-number maps and the three rules-version literals updated.
4. Guide (both copies): the two class tables, one paragraph in the weapon-proficiency section, and the three worked examples — the War Priest archetype now shows Protector
   (21 + shield 2 replaces the separate armour and weapon lines, total unchanged), and the two pregens' separate 5 AP "Divine Order" line becomes two Weapon Masteries (also 5).
   `guide-price-check.mjs`'s reviewed list now names the Warden and Protector rows with a reason.
5. Tests: `prof-grants-ci.mjs` (48 assertions, in `engine-parity.yml`), `feature-cantrip-picker-e2e.mjs` (18, in `economy-ui.yml`).

## Why

The guide's own checker already treated a barred feature with no printed price as "the ladder sells it" (Weapon Mastery), which was the guide's original reading of
"Buy (skill grant → ladder)". The owner chose to keep the options as real features instead, so the engine had to make the proficiency real *and* never undercut the ladders.
Deriving flags at compute time keeps the log raw-only, and a free feature is safe only with the explicit `free` flag.

## Open / not done here

- **Free proficiency from feats (Chef, Crafter, Musician)** — owner rule: the granted proficiency is added and makes later skills/tools dearer ("counted first", the opposite of
  the guide's "counted last"). Not in this change; it needs a picker and a second price path. Task on the board.
- The wider audit (below) found other abilities that sell a grant the engine does not give; the board carries a task per cluster.
- The `pact-guide` project's own CHANGELOG/TASK_BOARD and its generated `py/` files were not touched; its sync will pick the change up. The `documents-rules` stamp was not
  advanced (a deliberate reconciliation action by that project's tool).
