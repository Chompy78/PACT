# D-GH-2026-08-17-stars-starmap-split — Circle of the Stars' spells belong to the bundle; Star Map is repriced to cover only the free-cast

**Status:** Settled and implemented (`DATA.version` v0.349).

## Context

Circle of the Stars was selling the same content twice.

- The engine carried a `spellBundle` for Circle of the Stars at 5 AP flat, whose contents are exactly
  **Guidance** (cantrip) and **Guiding Bolt** (1st) — `4 + 1 = 5`, both on the 1 AP floor, hence flat.
- It *also* carried a `Star Map` ability whose guide row read
  *"Star Map (Guiding Bolt prepared + free-cast + Guidance cantrip)"* — the same two spells, plus a
  free cast.

A player could buy both and pay 11 AP for one feature. Nothing warned them.

This was partly self-inflicted. On the master guide, `Star Map` **was** the bundle row (`Bundle | 5`).
Earlier in this session the owner repriced Star Map as a T3 Situational ability at 6 (4), so it became a
feature; then a later step added a separate bundle row because the engine had a bundle with no guide row.
Result: two rows, one feature.

## Options

- **AA1 — Star Map keeps everything; delete the bundle.** One row at 6 (4) covering spells + free cast.
- **AA2 — The bundle keeps the spells; Star Map reprices to cover only the free cast.** ← chosen
- **AA3 — Keep both, document the overlap.** Leaves a 5 AP trap.

And, for AA2's new Star Map price:

- **AB1 — T3 Per-Rest, 8 (6).** · **AB2 — T2 Per-Rest, 5 (4).** ← chosen · **AB3 — T1 Per-Rest, 3 (3).**

## Decision

**AA2 + AB2.** The 5 AP bundle keeps Guidance and Guiding Bolt. `Star Map` is repriced
**T3 Situational 6 (4) → T2 Per-Rest 5 (4)** and its guide row relabelled to
*"Star Map — free-cast Guiding Bolt (proficiency bonus / long rest, no slot)"*.

Circle of the Stars is now **9 AP all-in at origin** (5 bundle + 4 Star Map), against Land and Moon at
7 and Sea at 10.

## Why

**The band was wrong independently of the overlap.** An attack spell that recharges on a long rest is
**Per-Rest**, not Situational.

**The price is anchored, not guessed.** Two 1st-level spell slots cost an origin caster **6 AP**
(`slotSticker[0] = 4`, origin `dd = 1`, so `max(1, 4−1) = 3` each) — verified as a marginal cost through
`compute()`, 21 → 27. The free-cast is worth *less* than two generic slots because it only ever casts
one specific spell, so 5 sits just under that anchor. It is worth *more* at high level, since the casts
scale with proficiency bonus (2 → 6), which is why AB3's 3 AP was rejected as too cheap. AB1's 8 (6)
prices the scaling honestly but would make Stars the dearest circle to open.

## Consequences

**Star Map is stored in three places** — `DATA.features`, `DATA.subAbilMap`, and
`DATA.subclasses[…].abilities` — all pre-existing, all carrying the price. Editing only `subclasses`
left `compute()` charging the old figure; `guide-price-check` caught it as a `price-mismatch`, which is
how the duplication was found. **All 192 subclass abilities are mirrored into `DATA.features` at the
same price**, and `subAbilMap` agrees with `subclasses` everywhere else (0 drift), so this is a
systematic mirror rather than a Star Map anomaly — but any future subclass-ability reprice must touch
all three. See `refactor/subclass-purchase-unify`.

**Star Map is now the only T2 subclass ability** (the other 191 are T3+). Defensible — a free-cast is a
smaller effect than a full subclass feature, and T3 is where subclasses *open*, not a floor on what they
may contain — but it is an oddity worth a second look if the subclass tier ladder is ever revisited.
