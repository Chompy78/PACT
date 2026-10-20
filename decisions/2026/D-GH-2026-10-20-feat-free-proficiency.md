# D-GH-2026-10-20-feat-free-proficiency — Chef and Musician hand out free tools; they count first, so later ones cost more

Status: Active. Rules `DATA.version` v0.380 → v0.381. Engine data, engine, both tools (picker rows, sheet lists, version literals), the **served** Players Guide and the
**`pact-guide` master** (owner approval AC) in this change. Part of `docs/plans/2026-10-20-primal-order-magician-warden.md` (owner decision W3/X1); follows
`D-GH-2026-10-20-primal-order-magician-warden`.

## Context

The Guide said a few feats — Chef, Crafter, Musician — "throw in a skill or tool proficiency", that it "simply rides along" at no extra cost, counts toward how many
proficiencies you own, and that during creation "the free one is treated as the last bought" so it never inflates other prices. The engine did none of it: a comment at
the tools line recorded that the old free-grant fields had been removed as never used, and a Musician simply paid for every instrument. Two other Guide sentences said feats
are stripped of tool grants, contradicting the first. Live data (2026-10-20, 40 characters): nobody owns Chef or Musician, and the data has no Crafter.

## Decision

Owner rule: the free proficiency is **added** to the build and **counts toward the number owned from the start** — "no longer the weird costing we had before" — so the tools and
instruments bought after it are dearer.

1. `DATA.arts[k].freeProf = {tools:[fixed names], instruments:N, toolPicks:N}`. Chef `{tools:["Cook's utensils"]}`; Musician `{instruments:3}` (the player names them).
2. `freeProfs(b, blocked?)` derives the free slots and names each call; nothing is stored but the player's picks (`b.freeProfNames[feat]`, `names` event key `fp`).
3. `compute()`: the tools line is `table[paid + free] − table[free]` over the cumulative `DATA.tools`. A slot counts named or not, so naming later changes no price. A named pick
   that the character also bought is priced once (dropped from `paid`). A Hit-Dice-blocked feat grants nothing. With no such feat the line is byte-identical to before — pinned
   for 0–4 bought tools in `prof-grants-ci.mjs`, and a mutation check (old formula back) fails 6 assertions.
4. Skills are not touched: no existing feat grants one (Skilled and Skill Expert are not in the data), and Bard Bonus Skills is an unresolved separate question.
5. Tools: ✎ Name dialog rows `fp::<feat>::<i>` in the Live Sheet and CharGen; CharGen sends the saved map with the rendered rows merged in (the `names` handler replaces the map).
   The picks are editable (a free pick has no cost to change). The sheets list free names as owned and the buy menu shows them owned.
6. Guide (both copies): the "Feats that grant a skill or tool" paragraph rewritten (and its "counted last" sentence removed), plus the two stripped-of-grants sentences naming the exception.

## Why counted first

Counting the free ones first means they use up the cheap early rungs of the ladder, so a Musician pays more for the next tool than a non-Musician does. That is the point of the
owner's rule: the free proficiency is never a way to get the ladder's cheap rungs twice.

## Not done

Crafter (not in the data). Tavern Brawler's improvised-weapon claim and the other feats the wide audit found are on the board. The `documents-rules` stamp was not advanced.
