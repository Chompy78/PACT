# D-GH-2026-08-05-grit-ladder-correction — Grit is priced by which purchase it is, not by your tier

Status: Active. Rules **correction** (owner), not a rules change — the intent was always per-purchase;
the guide's wording and the code both said tier. `DATA.version` v0.338 → v0.339.

## Context

Found while auditing why CharGen and the Live Sheet disagreed by 39 AP on levelling a character 1→5.
Attributing that gap line by line showed Grit contributing 21 of it, because Grit's price rose with
character level. The owner's response: it should not — *"grit should cost the same amount irrespective of
character level. grit 1:2, 2:4, 3:6, 4:9 etc."*

The old code (`js/engine.js`, the Grit line in `compute()`) read:

```js
for(let n=1;n<=tough;n++) toughAP += [2,4,6,9,12,15,18][tier-1] + Math.max(0,n-vgcap);
```

The ladder was indexed by the character's **tier**, so every Grit purchase cost the same and that cost
climbed as the character levelled:

| Grit ranks | was @L1 | was @L5 | was @L9 | now (any level) |
|---|---:|---:|---:|---:|
| 3 | 6 | 27 | 36 | **12** |
| 5 | 13 | 48 | 63 | **35** |

## Decision

**Index the ladder by purchase number.** Your first Grit costs 2, your second 4, your third 6, and none
of it depends on level. Past the seven-entry table the steps run 2, 4, 6, 8, 10 — so the 8th costs 20,
the 9th 24, then 30, 38, 48. The table has to extend because both tools let a player buy well past seven:
CharGen's dropdown goes to 12 and the Live Sheet's buy panel has no ceiling at all.

**The past-CON-mod surcharge is a flat +1 per purchase**, not the escalating `max(0, n − CONmod)` the code
applied (which made the 4th +1, the 5th +2, the 6th +3). The guide's "+1 AP per purchase past your CON
modifier" reads as flat, and the owner confirmed it.

**Vigor is deliberately NOT changed.** It really is tier-locked — *"each rank costs the Passive band of
your current Hit-Dice tier"* — so with Vigor, buying early is genuinely cheaper and waiting costs more.
The two are priced on different principles on purpose; they should not be tidied into a shared helper.

## Why this is a correction, not a change

Both the guide and the code said "tier", and agreed with each other — so this was never a
code-drifted-from-spec bug that a test could have caught by comparing them. The guide says
*"Situational by tier — 2 / 4 / 6 / 9 / 12 / 15 / 18"* in three places
(`docs/PACT-Players-Guide.html` lines 671 and 675 ×2), and the old code implemented exactly that,
faithfully. **The guide is the thing that needs rewording**, and that is outstanding — it is the owner's
to do, like the `lean` budget track.

Worth stating plainly because it is the trap here: the two artefacts agreeing is not evidence of
correctness when both were derived from the same wrong wording.

## Test coverage — it had none, and that is the more alarming finding

**All 23 fixtures carried `tough: 0`.** No parity test touched Grit pricing at all, so the gate could
never have caught the tier indexing, and could not have caught a regression either. The bug survived
because nothing looked, not because the looking was hard.

Added CG-010 / CG-011: the same Grit-10 build at HD 1 and HD 9. Both must report a Grit line of **147**,
which spans the seven-entry table *and* the extrapolation past it, and pins level-independence — if Grit
is ever priced by tier again, CG-011's total moves while CG-010's does not. Parity 24/0 → **26/0**,
verified by reverting the fix (both new fixtures fail; the other 24 pass).

## Also corrected

Two plainly wrong CharGen labels on the same control: it read **"Grit (+5 HP)"** and the HP formula hint
read **"Toughness×5"**, where the engine (`tough*4`), the guide ("+4 HP per purchase") and the Live Sheet
("Grit +4 HP") all say 4. Display-only, no version implication of their own.

## Consequence

This removes over half of the CharGen-vs-Live-Sheet divergence that prompted the audit: of the 39 AP gap
on levelling 1→5, Grit contributed 21 and Vigor 18. With Grit level-independent only Vigor's 18 remains.
Fewer things scale with tier, so fewer things can be retroactively re-priced.

## Related

- `decisions/2026/D-GH-2026-08-05-pricing-model.md` — the pricing model this was found under; its open
  question on pre-lock reconciliation shrinks but does not close.
- `docs/PACT-Players-Guide.html` — needs rewording, see above.
