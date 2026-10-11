# D-GH-2026-10-11-quick-patch-split — Quick Patch keeps the revive with limited uses; Staunch the Bleeding is the new cheap stabiliser

**Status:** DONE on branch `claude/eloquent-hypatia-55hkzp`; rides the `DATA.version` **v0.373** bump already on that branch (`D-GH-2026-10-11-reckless-rework`). Players Guide changed in both the served copy and the `pact-guide` master.

## Context

Quick Patch (boon, Skill & Utility, 3 AP) read: "As an action, stabilize a dying creature and grant it 1 HP without a kit." The owner judged it overpowered. Its uses were unlimited, and getting an ally from 0 to 1 HP is the biggest action-economy swing in a fight. The Healer feat costs the same 3 AP but is capped at Proficiency Bonus uses. Measured on 2026-10-11: **6 of 35** live characters own Quick Patch.

## Options

- **D1. Stabilise only (0 HP), as a Bonus Action, priced at 1 AP.** This reprices the 6 owners.
- **D2. Keep the 1 HP but limit uses (chosen).**
- **D3. Stabilise only, kept at 3 AP.** Nearly worthless next to a DC 10 Medicine check, a Healer's Kit or *Spare the Dying*.

How to limit the uses: **E1, Proficiency Bonus uses per Long Rest (chosen)**, which matches Healer, scales with level and is one counter to track. The alternative, E2, was once per creature per Long Rest; it was briefly committed and then replaced.

Price: kept at 3 AP. 4 was considered and rejected: the limited Quick Patch is weaker than Healer at 3, and 4 would leave each of the 6 owners 1 AP short.

The owner then also wanted a cheap Bonus Action stabiliser. That needs a second boon. **G1: the revive keeps the name "Quick Patch"; the new boon is named Staunch the Bleeding (chosen).** G2, giving "Quick Patch" to the stabiliser, was rejected: characters store boons by name, so G2 would quietly turn 6 owners' revive into a weaker, differently priced boon, or need a migration of live character data.

## Decision

- `boons["Quick Patch"].fx` now reads: "…grant it 1 HP, without a kit. You can do this a number of times equal to your Proficiency Bonus, regaining all uses when you finish a Long Rest." Still 3 AP.
- A new boon, `boons["Staunch the Bleeding"]` (`hd` 1, 2 AP, Skill & Utility): "As a Bonus Action, stabilize a dying creature without a kit. It stays at 0 HP." It is added to `boonList` in alphabetical order. 2 AP matches Quick Hands (Use an Object as a Bonus Action), and no Skill & Utility boon costs less.
- Fixtures CG-069 (Staunch the Bleeding costs 2) and CG-070 (control: Quick Patch still costs 3).

## Why

This keeps the revive fantasy while ending the down-and-up-again loop. It gives players a cheap, reliable stabiliser. And because no stored name changes meaning, live characters are left untouched.

## Note

The `pact-guide` master's Skill & Utility boon table has no "Touched by Fortune" row, while the served copy has one. That difference was already there before this change; it was left alone and is worth reconciling separately.
