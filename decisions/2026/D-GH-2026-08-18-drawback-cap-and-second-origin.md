# D-GH-2026-08-18-drawback-cap-and-second-origin — the drawback cap becomes real in a campaign and advisory outside one; the 2nd origin class goes 14 → 18

**Status:** Settled and implemented (`DATA.version` v0.351).

## Context

Two numbers, found together because one funded the other.

**The drawback cap did not exist.** `js/engine.js` carried the comment *"§14: drawbacks grant AP, but no
more than 14 AP total across a character"* above code that only warned. Measured: all 69 drawbacks
together granted **217 AP** — more than a level-11 character's entire feature budget after Hit Dice and
proficiency. A third figure lived in the Players Guide, which says **12**. So the project held three
different answers at once: guide 12, engine text 14, engine behaviour unlimited.

**The 2nd origin class cost 14 AP** — exactly the engine's stated drawback allowance. Two drawbacks
(Hexed Luck 8 + Leaden Reflexes 6) grant precisely 14 AP and raise **no warning at all**, so the
intended-maximum drawback load funded a whole second origin class for nothing. Measured against the
alternative, 14 AP paid for itself after **six** features — inside what almost anyone takes.

## Options

- **A1 — Enforce the cap everywhere.** Rejected: it changes what a purely local, offline character can
  already build, and there is no DM present to adjudicate the exception.
- **A2 — Leave it advisory and reword the comment.** Rejected: honest, but leaves 217 AP reachable in
  campaign play, where it matters most.
- **A3 — Enforced in a campaign, advisory outside one.** Chosen. A campaign has a DM whose ruling the
  number represents; a solo build does not.
- **B1 — Raise the 2nd origin price.** Chosen at **18**.
- **B2 — Leave it at 14 and rely on the enforced cap** to make funding it a real trade. Genuinely
  arguable — the defect was that 14 was *free*, not that it was 14 — but 18 also fixes the break-even,
  which the cap alone does not.

## Decision

**A3 + B1.** `compute(b, opts)` clamps the drawback grant when `opts.drawbackCap` is a finite number and
otherwise grants in full with an advisory warning. The default is **12**, matching the Players Guide, and
lives in `DATA.drawbackCap` so the engine, both tools and the guide quote one number. The DM Console
exposes it as an on/off plus a figure, defaulting **on at 12** for campaigns that predate the rule. The
2nd origin class line goes 14 → 18, moving its break-even from six features to eight.

## Why

The cap's split behaviour follows who can adjudicate. In a campaign the DM sets the number and the tools
hold the line; alone, the tools advise and the player decides. Enforcing everywhere would retroactively
invalidate offline builds; enforcing nowhere is what produced the 217 AP hole.

**12 rather than 14 because the guide is what players read.** Nothing depended on 14 — it was a figure in
a code comment that the code did not implement. Choosing 14 would have meant editing a player-facing rule
to match a comment; choosing 12 meant fixing the comment. The cheaper correction is the one that leaves
the published rules alone.

18 for the 2nd origin is set deliberately **above** the drawback allowance. At 14 the two numbers matched
exactly, which is what made it free. A second origin still carries its own hidden cost, unchanged: it
shifts you up the unlock ladder, so every later unlock costs 7/14/21 more.

## Status / verification

- `CG-016` and `CG-017` are the **same character** with and without a campaign — 26 AP granted versus 12.
  The pair pins both halves; neither alone would.
- The fixture format gained `_apOpts`, `compute()`'s campaign-side second argument. Without it the
  campaign-only half of any rule is untestable in parity — which is exactly how this cap shipped
  unenforced.
- `dm-console-ui-e2e` 89 → **94**: the panel round-trip asserts that an absent rule defaults ON at 12,
  an explicit opt-out stays off, and a DM-raised figure survives.
- `CG-009` moved 79 → 83; it is the only fixture with a 2nd origin class.
- Guide updated at four sites for the 18 AP price, and §14 now states that the cap is campaign-enforced
  and advisory otherwise.
