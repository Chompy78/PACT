# D-GH-2026-10-11-reckless-rework — Reckless becomes a Wisdom save to back off, worth 3 AP

**Status:** DONE on branch `claude/eloquent-hypatia-55hkzp`; `DATA.version` bumped **v0.373 → v0.374** (originally v0.372 → v0.373; renumbered when #610 took v0.373 first). Players Guide changed in both the served copy and the `pact-guide` master.

## Context

Reckless (Mind, +2 AP, WIS ≤ 10) read: "You cannot take the Dodge or the Disengage action." The owner judged it too harsh. It was the only Mind drawback that removed actions outright and permanently, and its real cost swung with class: it ruined Rogue (Cunning Action), Monk and fragile-caster builds while costing a Barbarian who never Dodges almost nothing. That made it either crippling or free AP. Its price also sat level with Suggestible (+2), whose penalty is much narrower.

## Options

- **A1. A Wisdom save to back off (chosen).** DC 12 Wis save when you try to Dodge or Disengage; on a failure you can't take that action this turn, but the action isn't spent. The WIS cap is kept. This matches the save-gated wording of Merciful, Quick to Quarrel and Berserk Temper. With WIS ≤ 10 you fail about half the time, so it's unreliable for every class but a lockout for none.
- **A2. Banned only while above half HP.** No roll, but it only bites early in a fight.
- **A3. Keep the ban and raise it to 4 AP.** This widens the Barbarian loophole. Rejected.

AP value (owner's B choice): **3** (B1). That is level with Faltering Resolve, another save-style penalty with the WIS cap, and below Berserk Temper (4), whose forced rage is harsher. 4 (B2) would have over-rewarded the softer A1 wording.

## Decision

`drawbackFx.Reckless` reworded and the drawback's price raised from 2 to 3 in `js/engine-data.js`. The Players Guide row was changed to match, both here and in `pact-guide`'s master. Measured before the change: **0 of 32** live characters carry Reckless, so nothing is repriced.

## Why

The penalty now applies at the moment you would act cautiously, for every class, rather than being all-or-nothing by build. The higher price reflects that the WIS cap plus a coin-flip on two core defensive actions is a broader cost than Suggestible's.
