# D-GH-2026-10-20-epic-boon-escalating-price — each epic boon costs more than the one before

Status: Active. Rules `DATA.version` v0.384 -> v0.385. Engine data, `compute()`, CharGen's boon list label, the served Players Guide and the `pact-guide` master in this change.

## Context

All twelve epic boons were a flat 25 AP at Hit Die 19, so a character could take all twelve for 300 AP. The owner asked that each cost more than the last "so people don't buy them all". No saved character owned an epic boon (live check 2026-10-20), so no frozen ledger diverges.

## Options and owner pick

- S1 a step table by boons already owned (**chosen**, with the owner's approval of the numbers 25, 30, 36, 43, 51, 60, 70, 81, 93, 106, 120, 135; the order bought decides who pays what).
- S2 a flat surcharge growing by a fixed amount: simpler, but flat at the top. S3 a hard cap plus a flat price: does not raise the cost.

## Decision

1. Data: `DATA.epicBoonSteps` (twelve numbers; the last repeats if more epic boons are ever added). The boons keep their printed `ap: 25` as the first-boon price.
2. `compute()`: in the Boons loop the Nth non-blocked printed epic boon uses step N. A blocked boon (Hit Dice below its gate) is not counted; a DM house-rules re-price of a printed epic boon wins over the step and still counts; a DM custom boon (not in `DATA.boons`) never counts. The +2 ability fold reads `b.boons` unchanged.
3. Frozen cost: a purchase's cost is the `compute()` delta (`priceOf`), so the second epic boon freezes at 30. The Live Sheet's buy panel already quotes `priceOf`, so it shows the right figure. A DM removing a boon follows the existing rule: the original cost stays as spend, the others re-price in `compute()` only.
4. The gate: **19**. The 2024 text gives every Epic Boon feat the prerequisite "Level 19+" and every class takes its Epic Boon at level 19; PACT Hit Dice map one-to-one onto levels. The Guide's "Hit Die 17" confused the Tier-7 band threshold with the boon level and is corrected.
5. Guide (both copies): the Epic Boons paragraph states the ladder and the gate; the table's price column header reads "AP (first boon)". CharGen's boon list shows "25+ AP" with a title note.
6. Tests: `epic-boon-price-ci` (19): the twelve steps, the 850 total, order, a plain boon untouched, a blocked boon, a DM custom boon, a DM re-price, a mutation control.

## Why

A step table is the shape the engine already uses for skills and tools, it lets the owner set every step, and the cost rising with each purchase is exactly the intent. Counting only printed epic boons keeps DM-written boons priced by the DM.

## Not done here

PACT gives each epic boon a +2 to one ability (max 30); the 2024 feats give +1. The Guide already documents the +2 as a PACT change. Left as is.
