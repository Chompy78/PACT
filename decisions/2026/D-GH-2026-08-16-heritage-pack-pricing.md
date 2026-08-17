# D-GH-2026-08-16-heritage-pack-pricing — In-pack species traits carry their real MASTER price; the pack, not a zeroed field, is what makes them free

**Status:** Settled and implemented (`DATA.version` v0.344).

## Context

Every trait belonging to a heritage pack was stored in `DATA.racial` with `origin: 0`. That is not a
price — it is a stand-in for "the pack already paid for this". It worked, but it made pack membership
and pricing the *same fact*, and that coupling has a failure mode: **the moment a trait leaves a pack,
it becomes free rather than priced**, silently, with nothing to catch it.

That is not hypothetical. It is exactly what this session found:

- `Goliath: Long Stride (Speed 35)` sat at `origin: 0` while **not** being pack-flagged — a genuinely
  free T1 trait, and nobody had noticed.
- Three more traits (`Elf: Fey Ancestry`, `Orc: Relentless Endurance`, `Dragonborn: Breath Weapon`)
  were being moved out of their packs in this very change. Under the old model each would have landed
  at 0 AP until a human hand-assigned a price.

Meanwhile the **Players Guide had already solved this**. Appendix B prints in-pack traits at their
real `MASTER[tier][band]` value with a separate `In pack: Yes` column doing the "you don't pay this"
work — Darkvision 60 ft shows `origin 5`, not `0`. Every guide figure matched `MASTER` exactly. The
engine's `origin: 0` was the outlier, not the guide.

## Options

- **O1 — Give in-pack traits their real `MASTER[tier][band]` origin price, and add a `r.pack && isO → 0`
  guard in `compute()` so the origin race still pays nothing.** Price and pack membership become
  independent facts.
- **O2 — Remove origin prices from in-pack traits entirely** (the owner's initial instinct: "you can't
  buy them without a pack anyway"). Conceptually the tightest model.
- **O3 — Leave `origin: 0` as-is** and hand-assign a price whenever a trait leaves a pack.

## Decision

**O1.**

## Why

- **It makes the bug class structurally impossible.** Moving a trait in or out of a pack no longer
  changes its price, so the Long Stride defect cannot recur. Under O2 or O3, every future membership
  change is another chance to ship a free trait.
- **O2 doesn't survive contact with the code.** `engine.js`'s racial loop does `_rc = r.origin` and adds
  it straight into the AP sum — `origin: null` yields `NaN`, not "unbuyable". O2 therefore needs the
  same engine guard as O1 *plus* a sentinel value, and it discards the "what is this worth" information
  the guide already publishes. It is more work for strictly less information.
- **It unifies on what the guide already did.** The guide was the more correct artefact here; O1 moves
  the engine to meet it rather than degrading the guide to match a placeholder. All 29 Appendix B trait
  rows reconcile against the engine with zero mismatches after this change.
- **It is output-neutral, so it is cheap to verify.** Origin-race characters paid 0 before (field was 0)
  and pay 0 after (guard returns 0). `engine-parity-ci` stayed at 30 passed / 0 failed across the whole
  change, and `testing/expected/` needed no regeneration — the gate is a real safety net here rather
  than a rewrite.
- **Cross-race pricing is untouched.** Non-origin buyers still pay `cross` through the existing
  branches; only the origin-race path is guarded.

## Consequences

- `DATA.version` v0.343 → **v0.344** (a mechanics change, bumped exactly once, in the engine).
- Rules changes landing alongside, all owner-specified: `Elf: Fey Ancestry`, `Orc: Relentless Endurance`
  and `Dragonborn: Breath Weapon` leave their packs; `Orc: Adrenaline Rush` corrected T2 → T1 with
  `cross: 4`; `Goliath: Long Stride` repriced to At-Will 4/5; new `Elf: Wood Elf speed` (At-Will 4/5)
  added — the guide listed it as an Elf lineage option but the engine had no such entry at all.
- Heritage-pack value spread narrows from **7–13 AP to 7–10 AP** against a flat 5 AP price. Pack prices
  were deliberately left unchanged (owner's call); whether the residual 2–5 AP spread is intended is a
  balance question, not a data one.
- `DATA.packBasics` (display-only) updated to match the new membership.

## Notes

Found while re-verifying the 2026-08 guide audit. Worth recording that the audit's own account was
wrong here in the useful direction: Appendix B correctly showed these three traits as *not* in-pack,
and an earlier commit in this session "corrected" the guide toward the engine before the engine was
understood to be the defective side. Treat that audit as a pointer to where to look, never as a source
of fixes — see also the sticker-vs-origin errors in its findings #36, #41 and #42.
