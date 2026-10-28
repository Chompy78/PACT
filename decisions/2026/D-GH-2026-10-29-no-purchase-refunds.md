# D-GH-2026-10-29-no-purchase-refunds — lowering a raised ability score gives no AP back (rules v0.388)

**Context.** Owner rule (2026-10-04): you can't un-buy anything except drawbacks. Before the creation lock a dump below 10 stays exactly as the
Players Guide has it, but lowering a score that was raised above 10 must not return AP; after the lock nothing bought can be lowered. `compute()`
prices a final build, not a history, so a log that raised STR to 14 (9 AP) and later lowered it to 12 was charged only 4: the player kept 5 AP.

**Live measurement** (read-only, 2026-10-29; all 38 live logs folded with the old and the new engine, `compute().total` compared). Seven totals
move, all of them logs that lower a score from above 10: Caspian (+11) and Skylar (+4) in Amble, Kaelen Dawnbreaker (+22) and Marius Stormholt
(+17) solo, the DM "lock check" copies of Caspian (+11) and Skylar (+4), and "Archer (DM copy)" (+5; not on the 2026-10-27 list, it lowers CON
14->12 and CHA 10->8). Every other character is unchanged. Skylar's lock-check copy goes from +2 to -2 AP left (one new warning); Kaelen was
already over budget and goes further over. Event-sourced campaign characters keep their frozen ledger either way.

**Options.**

- **Q1 — where does the memory live?**
  - A. `_replay` keeps the highest score each ability has held (`b.statsHigh`), and `compute()` prices a score through `_abilPrice(score, high)`.
  - B. Leave `compute()` alone and have each tool refuse a lowering. Does not cover imports or DM edits, which the rule requires.
  - **Decision: A.** The running maximum is a local in `_replay`, re-stamped on the build after every event, so a `patch` event (an
    `Object.assign` onto the build) cannot wipe it by carrying its own `statsHigh`.

- **Q2 — the price formula.** The task text said "the part below 10 pays out". Read literally for a score dumped from 14 to 8:
  `price = ABIL[min(score,10)] + ABIL[max(high,score,10)]` = -4 + 9 = 5. The bracketed recommendation on the board (price a score below 10 at
  its own value) would give -4 and refund the 9 AP paid for the climb, which is the loophole this task closes. **Decision: the sum.** For any
  build never lowered the high equals the score, so the price is the plain ladder price and no existing total moves.

- **Q3 — a draft that was never saved.** CharGen rewrites its single stats event in place, so a draft's log only ever holds the final scores
  and nothing is "bought" yet. The fold-based memory therefore leaves an unsaved draft free to edit, with no special case.

- **Q4 — after the lock.** The server freeze (`pact_enforce_locked_history`) and CharGen's post-lock path already reject a lowering. If one
  reaches the engine through an import or a DM edit, `statsHigh` makes it refund nothing (pinned by EV-045), so the engine needs no pricing
  exception and the Guide sentence is simply "After creation a score cannot be lowered at all". No new server rule: the existing append-only
  guard covers a locked character, and a pre-lock server rule would break CharGen's in-place rewrite.

- **Q5 — the four live characters.** Frozen ledgers stay as they are; only compute()-based totals (CharGen, the DM copies) move. **Left alone;
  listed to the owner above.**

**Also changed.** `priceOf('abil')` (the "raise a score" quote) goes through the same `_abilPrice`, so re-buying a score that was lowered costs
only what was not already paid. CharGen's per-score AP label shows the same figure `compute()` charges.

**Version.** `DATA.version` v0.387 -> v0.388, once, in the engine; the three tool labels follow. The Players Guide gained one paragraph under
"Raising stats" in BOTH the served copy and the `pact-guide` master.

**Pinned by** parity fixtures EV-041 (14 then 12 keeps 9; was 4), EV-042 (14 then 8: 5; was -4), EV-043 (14, 12, 14: 9), EV-044 (a plain dump
to 8 still pays -4), EV-045 (a lowering after the lock refunds nothing). EV-041 and EV-042 fail on the old engine; EV-043 and EV-044 are guards.
`engine-parity` 145 passed / 0 failed.
