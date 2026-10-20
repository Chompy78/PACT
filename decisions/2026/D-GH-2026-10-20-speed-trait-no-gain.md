# D-GH-2026-10-20-speed-trait-no-gain — a speed trait that would not raise your speed can't be bought

Status: Active. Rules `DATA.version` v0.382 → v0.383. Engine, CharGen, Live Sheet, the served Players Guide and the `pact-guide` master in this change.

## Context

The 2026-10-20 grants audit found that a Wood elf could pay 4 AP for `Elf: Wood Elf speed` and gain nothing: the Wood lineage already sets speed 35 (`DATA.lineageSpeed`). A probe on v0.382 showed Goliath has the same flaw: a Goliath already moves 35 (`DATA.speed`), and `Goliath: Long Stride (Speed 35)` cost it 4 AP for nothing. Both traits set a speed *floor* (`spdSet`), and compute() takes the highest floor without asking whether the trait raised it. A Human buying Long Stride correctly reaches 35.

## Options and owner pick

- BJ1: refuse or warn when a character that already moves 35 buys the trait; keep the traits.
- BJ2: drop the Wood lineage's free 35 so the trait is the only route (changes compute() output for every Wood elf).

Owner (2026-10-20): the speed traits exist so another species can buy them as a cross-race trait at creation, "same as Goliath". So the traits stay, and the purchase that adds nothing is refused, for Goliath and Wood elf alike.

## Decision

- New engine export `speedTraitAddsNothing(b, lab)`: for a `spdSet` trait, returns the speed the character already has (species, lineage, and any speed trait listed earlier) when the trait would not raise it, else 0.
- compute() warns on an owned one: "<trait> adds nothing: this character already moves N ft". It is not a ⛔ and not on `SOFT_WARN`, so `purchaseLegality()` refuses a NEW purchase on the Live Sheet while an existing owner's sheet shows it only as an advisory.
- CharGen greys the tick box with the same reason (an already-ticked box stays ticked); the 🎲 roller skips it; the Live Sheet's buy panel shows the reason.
- The price is unchanged, so no live total moves. Live check 2026-10-20: one character owns one (`Moss Stormspud (COPY)`, a Goliath with Long Stride, locked); it keeps the trait and the 6 AP it paid, and now shows the advisory.

## Why

Smallest change that stops AP being spent on nothing without touching anyone's speed or total. Fixtures CG-093 (Goliath), CG-094 (Wood elf) and CG-095 (Human control) pin it.
