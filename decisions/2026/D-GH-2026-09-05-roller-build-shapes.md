# D-GH-2026-09-05-roller-build-shapes — the roller's Hit Dice ceiling was a label, not a rule

**Status:** Implemented · fixes landed directly on `preview` (commits `3ae4096`, `4d8a4dd`) ·
this record + its regression gates land via `claude/random-char-generator-1thuv6` · closes the
`feat/roller-build-shapes` entry on `docs/TASK_BOARD_NOW.md`.

## Context

John raised this after rebuilding the PACT campaign's combat model: it needed a spread of realistic
parties to test against, and the 🎲 roller couldn't produce one. Rolling several hundred characters and
comparing them against **six real player sheets at 75-98 AP** found three faults:

1. **Grit was missing from the spend pool.** The weighted `kit` bucket offered Vigor but never Grit, so
   the roller could not build a durable character at all.
2. **Hit Dice were pinned to the AP-level cap.** Every rolled character got exactly 1 Hit Die at every
   budget (min == max at every rung), while the six real sheets carry 1, 3, 3, 3, 4 and 5. Rolled
   characters landed at 6-13 HP where the real party ran 9-35.
3. **A silent fallback built a level-9 character on any budget** whenever `apLevel` was out of scope
   (the campaign's analysis harness extracts `randomizeRoll`'s source and evaluates it outside the tool),
   degrading quietly instead of failing.

## Options

- **A — raise the level-cap constant.** Cheap, but the cap's premise (Hit Dice track the budget's
  *level*) is what's wrong; raising the number just moves where the same mismatch bites.
- **B — drop the cap entirely.** Reopens the exact blowout the cap was added to stop: a "level 20" ask
  on a 127 AP (Lv 3) budget sinking the whole spend into Hit Dice.
- **C — redefine the ceiling as affordability, not level.** *(chosen)*

## Decision

The Hit Dice ceiling is now **the highest Hit Dice whose cumulative cost stays inside a fixed share
(`_HD_SHARE = 0.18`) of the budget**, floored at the level the budget names (so the existing CI floor
check — "HD reaches the level the budget pays for" — still holds). With no level explicitly requested,
the roll draws **uniformly across that affordable band** rather than pinning to its floor, and it is
bought *before* the spend pool so the AP is committed up front, the way a player actually buys it.

The silent `: 9` fallback is gone. If `apLevel` isn't in scope, `randomizeRoll` now flashes a message and
throws rather than quietly building a level-9 character.

Grit (`tough`) now sits in the `kit` bucket beside Vigor (`hardy`) at equal weight.

## Why

- **`compute()` never ties `b.hd` to the AP budget.** Hit Dice are an ordinary purchase priced off
  `DATA.HD`, clamped only to 1-20. `js/ap-by-level.js` documents its ladder as *"cumulative AP a
  complete level-N build is expected to have spent"* — an expectation, not a rule — and the six real
  Amble sheets prove the gap directly: 83-85 AP spent with Hit Dice 1, 3, 3, 4, 4, 5, where `apLevel`
  says "Lv 1".
- **Affordability self-tapers, so the original blowout stays prevented.** Hit Dice are cheap at the
  bottom of the ladder (HD 5 is 14 AP, 17% of an 85 AP build) and dear at the top (HD 20 is 130 AP), so
  79 AP reaches HD 5, 295 AP reaches one step past its level (HD 11 vs 10), and 535 AP earns nothing
  extra beyond the level it already names. A "level 20 on a level-3 budget" request still can't happen.
- **A uniform draw across the band, not a pin to its floor, is what produces variance.** The floor-only
  version passed every existing gate and still had zero Hit-Dice variance at a given budget — the actual
  symptom John reported — because "reaches the level" and "varies" are different properties, and only
  the second one is what makes a rolled party resemble a real one.
- **Failing loud beats guessing.** The old fallback produced a plausible-looking but wrong character
  (HD 8-9, 27-57 HP on a 79 AP budget) with nothing to report it. A thrown error is discoverable; a
  quiet level-9 character is not.

## What this session added on top of the landed fix

The three faults above were already fixed and proven (288 rolls/rung, HD spread 1-5, hit points 6-42,
every real character's HD/HP falling inside the rolled range) by the time this session picked the task
up — see commits `3ae4096` and `4d8a4dd`, authored by a separate Claude session working directly against
`preview`. What was still open was the project's own closing half: nothing had graduated the task off
`docs/TASK_BOARD_NOW.md`, no `CHANGELOG.md` entry existed, and — the substantive gap —
**`testing/scripts/random-quality-ci.mjs` had no assertion that would have caught either original bug**
(neither "HD is pinned to one value at a budget" nor "Grit is unreachable" was checked; the gate would
have passed the pre-fix code as readily as the post-fix one). This session added both as gates, verified
each against the actual regression: temporarily reverting the affordability change reproduces "HD varies"
failing (min == max == the level), and temporarily removing Grit from the kit-bucket pool reproduces
"Grit is reachable" failing (0 of N rolls take any).

One correction to the new "HD varies" gate itself, found while proving it: at the top budget (535 AP,
Lv 20) every roll legitimately lands on HD 20 — the engine's own hard ceiling (`Math.min(20, …)`), not a
level-cap artifact — so a pin *at* 20 is correct behaviour and only a pin *below* 20 fails the check.

## Verification

`testing/scripts/random-quality-ci.mjs`: **74 passed / 0 failed** (was 70/0 before this session's two new
checks), run three times clean. `testing/scripts/engine-parity-ci.mjs`: **73 passed / 0 failed** — no
`js/engine.js` change, so this is a confirmation, not new information. No `DATA.version` bump and no
Players Guide edit: the generator only consumes `compute()`, it defines nothing.
