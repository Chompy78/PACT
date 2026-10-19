# D-GH-2026-10-20-heroic-inspiration-boons — hold 2 or 3 Heroic Inspiration; Blazing Moment fires on 18+; boons gain an engine-enforced `prereq`

Status: Active. Engine data, engine, both tools' version literals and the **served** Players Guide copy in this change.
`DATA.version` v0.377 → v0.378. **The `pact-guide` master is NOT updated — see "Open: the guide master" below.**
Parity 117 → 121 (four new fixtures, CG-083…086); every existing fixture's total and warnings are unchanged.

## Context

Owner request 2026-10-14, three rules changes: (1) a boon to hold up to 2 Heroic Inspiration at once, (2) a boon for 3 that needs
the first, (3) Blazing Moment regains on an 18+ reroll instead of 19+. The task said to make the 3-point boon a prerequisite
"like the Bard Inspiration die ladder". That ladder is made of class **features**, which carry `prereq`. **Boons had no prerequisite
mechanism at all**: `compute()` priced them on AP and Hit Dice only, and the Guide's "Feature: Renewed Fire" cell on Blazing Moment is
prose that nothing enforces.

## Options

Prices (owner pick I1): Twofold Inspiration HD 3 / 7 AP; Threefold Inspiration HD 5 / 10 AP — beside Touched by Fortune (HD 3 / 8) and
Renewed Fire (HD 5 / 10). Extra capacity only helps with a refill source, so it prices below an effect that fires on its own.

Blazing Moment (owner pick J1): fx wording only, **price stays 14 AP**. 14 is already the top of the HD 9 band (13–14), and a reprice would
change the AP of every live character who owns it. The regain chance on a reroll rises from 10% to 15%; that is accepted as a
stronger effect for the same price. Not measured against live characters (K2) — nothing about their AP changes, so there was
nothing to measure.

Prerequisite for the 3-point boon (owner pick L2):
- L1 — prose only, like Blazing Moment today. Smallest, but "needs" is not enforced.
- **L2 — engine enforces an optional boon `prereq` (chosen).**
- L3 — warn but allow, like the Arts "(DM check)" notes. Rejected: a non-`⛔` warning behaves unpredictably across the tools.

## Decision

1. `DATA.boons` gains **Twofold Inspiration** and **Threefold Inspiration** (cat Magic, in `boonList` after Renewed Fire). Threefold carries
   `prereq: ["Twofold Inspiration"]`. Blazing Moment's `fx` reads 18.
2. `compute()` reads a boon's `prereq` the way it reads a feature's: a fixed point over the owned boons, run in the same place as the Hit-Dice
   gate so the epic-boon ability fold (which reads `b.boons` early) sees blocked boons as not owned. A boon whose prerequisite is not
   owned, or is itself blocked, costs 0 AP, grants nothing and raises `⛔ <boon> — blocked: needs <prereq> (not counted, not owned)`. A boon
   blocked by Hit Dice keeps the "needs N Hit Dice" wording.
3. **No tool code changed beyond the version literals.** `purchaseLegality()` treats a new `⛔ … blocked` warning as a hard refusal, so the
   Live Sheet and CharGen's after-lock purchases refuse Threefold without Twofold on their own.
4. **Only the new boon has a `prereq`.** Blazing Moment ← Renewed Fire and Renewed Fire ← Resourceful in the Guide stay prose. Giving them a
   `prereq` would block existing characters' purchases; that needs its own measurement and decision.
5. House-rule boons (`b.houseRules.boons`) may declare a `prereq` too; the lookup uses the same house-rule-first order as pricing.

## Verification

`engine-parity-ci` 121/0 (CG-083 Threefold alone is blocked with the prerequisite wording; CG-084 both owned, Threefold listed first, 17 AP
on top of the HD ladder; CG-085 Twofold alone is a positive control; CG-086 too few Hit Dice keeps the Hit-Dice wording).
`engine-legality-ci` 95,058/0, `engine-priceof-ci` 9,461/0, `engine-wallet-ci` 66,589/0 (the first two replay 258 builds, now including
the new fixtures), `version-label-ci` 10/0, `tool-pricing-ci` 191/0, `random-quality-ci` 82/0, plus the other `engine-parity.yml`
gates. `verify-guide.mjs` 11/11 and `guide-price-check.mjs` exit 0 on the served copy.

## Open: the guide master (`pact-guide`)

The task asked for the Guide change in the `pact-guide` master first. It was **deliberately not made**:
- The master's boon section has already diverged from the engine: different Renewed Fire wording, Defiant Spark and Undying Ember
  (not in the engine), and a Blazing Moment move — a pending engine sync is planned in `pact-guide/plans/engine-sync-2026-08-27-fortune-boons.md`.
- The master states, in prose, **"You can never hold more than one Heroic Inspiration at a time"**. That is the opposite of the new boons.
  Whether the rule is rewritten, or Twofold/Threefold are folded into that fortune-boons reconciliation, is the owner's call.
- The served copy has no such sentence, so it is consistent with the engine as it now stands.

Until the master is reconciled, a transfer from `pact-guide` to this repo's `docs/PACT-Players-Guide.html` would silently drop the two rows
and the 18+ wording (see `docs/VERSION-SYNC.md` and the existing "pact-guide master has drifted" task on the NEXT board).
