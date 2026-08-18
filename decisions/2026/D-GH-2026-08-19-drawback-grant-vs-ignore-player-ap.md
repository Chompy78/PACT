# D-GH-2026-08-19-drawback-grant-vs-ignore-player-ap — a drawback survives `ignore_player_ap`

**Status:** DECIDED · shipped in `DATA.version` **v0.356**
**Supersedes:** the `ignorePlayerAp` half of `D-GH-2026-08-19-drawback-single-count` (v0.355), which
placed the drawback grant inside the bracket by default rather than by decision.

## Context

`ignore_player_ap` is a campaign toggle meaning *"your AP comes from me, not from your award history."*
It drops the player's own AP pool from the spendable ceiling without refunding or rewriting anything
already bought. One campaign uses it: Amble.

v0.355 made a drawback **income** (model (b) — it raises the budget rather than discounting the cost).
That created a question nobody had needed to answer before, because under the older double-count both
toggle states happened to land on the same `remaining` for the case that was checked: **is drawback AP
part of "your award history"?**

v0.355 answered it implicitly — the grant sat inside the `ignorePlayerAp` bracket, so it was dropped
with everything else. That was not a decision; it fell out of the two-pool model's shape.

Measured on the v0.355 engine, a character with two drawbacks (14 AP) and no award events, in a campaign
granting 37 DM AP:

```text
ignore_player_ap OFF -> spendable 51
ignore_player_ap ON  -> spendable 37     <- the drawbacks paid nothing
```

## Options

```text
A. Grant is dropped (v0.355 behaviour). "Your AP comes only from me" includes AP earned by
   accepting a penalty. Consistent with treating the grant as player-side income.
   Cost: the character stays permanently Hexed and Leaden-Reflexed and gets NOTHING for it,
   while the panel still lists both drawbacks as active and the ledger still itemises them.
   Nothing on screen says the AP was deleted.
B. Grant survives. A drawback is a TRADE the character made, not AP the player accrued, so the
   toggle - which is about awards - does not reach it.
   Cost: a player-controlled AP source remains in a pool the DM declared exclusive.
```

## Decision

**B**, by the owner, in their own words: *"they just get the AP, it's not considered a grant but a trade
for a drawback."*

```js
// v0.355
const spendable = (ignorePlayerAp ? 0 : (playerAp + _dGranted)) + dmAp;
// v0.356
const spendable = (ignorePlayerAp ? 0 : playerAp) + _dGranted + dmAp;
```

`playerAp` (awards) is what the toggle governs. The drawback grant is composed outside it.

## Why

The toggle's own wording is about **awards** — it is `ignore_player_ap`, and `b.budget` has meant
*awards only* since v0.355. A drawback is not an award; it is a price the character pays at every
session in exchange for build resources. Option A charged that price and withheld the goods, and did so
invisibly: every surface still displayed the drawbacks as live.

**This is not an uncapped side door.** `_dGranted` is already capped before this line, so a DM who wants
to limit drawback AP in such a campaign sets `drawbackCap` — the control built for exactly that job —
rather than relying on `ignore_player_ap` to suppress it as a side effect. The two controls now do one
thing each.

## `earnedWithDm()` had to move with it

`earnedWithDm(eco, opts)` is the **frozen-ledger** AP ceiling the Live Sheet displays, and it read
`(ignorePlayerAp ? 0 : eco.earned) + dmAp`. Since `eco.earned = awards + drawbackEarned`, leaving it
alone would have made the recompute and the frozen ledger disagree by exactly the grant for every
character in such a campaign — the D-GH30 display-divergence failure mode again. It now carves out the
same exception:

```js
return (ignorePlayerAp ? drawbackEarned : playerEarned) + dmAp;
```

Verified on `EV-019` under 37 DM AP: `compute().budget` and `earnedWithDm()` agree at 130 (toggle off)
and 51 (toggle on).

## Live effect

`dm-console-ui-e2e`'s `Anders` fixture is described in its own comment as *"real numbers from the live
Amble campaign"*: awards **0**, drawbacks **+6**, frozen spend 21, DM AP 33. His AP-left goes **12 → 18**.
This is a real character in the one campaign with the toggle on, not a synthetic case.

## Verification

- **`CG-019`/`CG-020`** — the fixture pair the original task asked for: a character with drawbacks and
  **no award events**, priced under both toggle states. Identical builds, only `_apOpts` differs; both
  report spendable 51 / total 46 / remaining 5. Parity 38 → **40**.
  Confirmed to bite: reverting the one-line composition change fails `CG-020` (spendable 37, remaining
  −9, flipping `new_engine_valid` and adding an OVER BUDGET warning) — so the CSV catches it despite
  having no column for the value of `budget` or `remaining`.
- **`log-fuzz` gains a `ceilingDrift` invariant** — `compute().budget === earnedWithDm(economy(LOG))`
  under `{ignorePlayerAp}`, `{ignorePlayerAp, dmAp}` and `{dmAp}`. Reverting the change trips it on 3
  of 500 logs. This is the assertion that would have caught the two surfaces diverging.
- **`dm-console-ui-e2e` 94 → 96.** The old "the switch is honoured" check became degenerate (Anders has
  no awards, so both states now read 18 and it proved nothing). Replaced with an awarded variant that
  pins the split the model actually makes: with a 10 AP award on top, ON reads 18 and OFF reads 28 — the
  10 AP gap **is** the switch, and a regression would show 8 and 28.
- All gates green at v0.356: parity 40/0, tool-pricing 134/0, chargen-flows 66/66, dm-console-ui 96/96,
  sw-cache pass, log-fuzz 500/500 (2000/2000 on a second seed), four sync gates 54/0, verify-guide 9/9.

## Guide

No change needed: the Players Guide does not describe `ignore_player_ap` at all — it is a campaign
control that lives in the DM Console, not a player-facing rule. Checked by search before concluding this.
