# D-GH-2026-08-19-drawbacks-phobias-expansion — drawbacks are income, so price them by pain ÷ pay

**Status:** DONE · `DATA.version` v0.356 → **v0.357**

## Context

A 22-entry drawback proposal arrived, priced 16×1 AP and 6×2 AP. The existing 69 sit at
**1:6 · 2:22 · 3:18 · 4:9 · 5:9 · 6:4 · 8:1**, so AP 1 is a *rare* band (Illiterate, Forgetful,
Heavy Sleeper) and the proposal would have taken it from 9% to 24% of the list.

**The first review of it was wrong, and the correction is the point of this record.** It read the AP
number as a *cost* and concluded the cheap named phobias would undercut `Haunted / Phobia` at 3.
Drawbacks are **income** (`economy().drawbackEarned`), so the number is what the player *gains* — the
existing scale proves it, with the harshest entries carrying the biggest numbers (`Hexed Luck` 8,
`Leaden Reflexes` 6, `Vulnerable` 6). Under the correct reading the conclusion inverts: a named phobia
paying 2 for *more* pain than the generic's 3 is a **dead option**, not an undercutter.

## Decision

Price each drawback by **compensation ÷ expected pain**, which has two failure modes that are not
symmetric:

- **Over-paid** — real AP for a penalty that rarely bites or is cheaply mitigated. This is AP farming
  and the only one that threatens balance.
- **Under-paid** — little AP for a harsh penalty. Nobody takes it. A content problem, not an exploit.

### The frequency ladder for "disadvantage while X"

`Light-Blind` (6) is *literally* the shape most of these use — "disadvantage on attack rolls and
Perception checks while in bright light or direct sunlight" — and daylight is near-permanent for an
adventuring party. That anchors a ladder:

| Trigger frequency | AP |
|---|---|
| Near-permanent in a typical campaign | 6 |
| Common, scene-level | 3–4 |
| Genuinely occasional, DM-signposted | 2 |
| Rare / comedic | 1 |

This is why **Fear of the Dark is gated on "no light source within 30 feet"** rather than plain
darkness: written plainly it is near-permanent underground — Light-Blind's frequency at a third of
Light-Blind's pay. The narrow trigger makes it an event (a dropped torch, a separation) instead of a
permanent tax, and creates a real dependency on the party's light.

### Claustrophobic and Agoraphobic are a mirrored pair

The drafts bolted two mechanics together, triggered on "inside buildings" (most of an adventure), and
demanded a DC 12 save "to enter any space smaller than 10 feet wide" — a roll at nearly every dungeon
doorway. Both are now one clause, no extra rolls, mirrored on each other and on `Haunted / Phobia`'s
new 2 AP. They remain strongly campaign-dependent in opposite directions; `bannedDrawbacks` is the
existing lever (Amble already bans 10).

### `DATA.drawbackReq` — a gate, because price cannot fix variance

`Mana Leak` (disadvantage on all concentration) is brutal for a Wizard and **literally free AP for a
Fighter**. One number cannot serve both ends, so the fix is a requirement, not a price. New map keyed by
drawback — `{"Mana Leak":{caster:true}}` — checked in `compute()` beside `drawbackMaxStats`, emitting the
same **⛔** HARD-violation marker as `reqRace`/`minHD` and the stat caps. Keyed by data so the next
caster-only or class-only entry needs no code. Caster-ness is read from `b.traditions[].disciplines`,
which the engine already carries.

### Dropped, and why

| Dropped | Reason |
|---|---|
| `Familiar Face` | Strictly *narrower* than `Bad With Animals` at the same 1 AP — it dominates it, so one of the two is always dead |
| `Fear of Water` | Substantially the same penalty as `Can't Swim`; taking both paid 3 AP for one. Absorbed into `Can't Swim` as the DC 14 save |
| `Compulsive Collector` | No mechanical teeth — "you feel compelled to collect" is unenforceable, i.e. free AP. `Compulsion` (3) is the version that bites |
| `Sleepwalker` | 1-in-10 on a long rest with no consequence unless the DM invents one |
| `Light Sleeper` | **The name is already a 2 AP boon** ("wake at the first hint of danger"), paired with the `Heavy Sleeper` drawback |

## Why the reprices were safe

`Sluggish` 2→1, `Mana-Sick` 3→2, `Haunted / Phobia` 3→2 all *reduce* income, which would cut the
spendable AP of anyone holding them. A database check found **zero** characters holding any of the
three, and no parity fixture references them either, so `testing/expected/` needed no refresh —
the fixtures contain no drawbacks at all, which is itself a coverage gap worth closing later.

`Sluggish` at 1 also settles a neighbour: it is *guaranteed* to act last in round 1, whereas
`Overthinks Everything` is only probably later and has a visible-threat carve-out — so the latter is
milder and correctly stays at 1.

## Three things found on the way

1. **Object key order in `engine-data.js` is load-bearing.** Prepending the new entries broke two
   `tool-pricing-ci` checks that assert on the first drawbacks in iteration order (they expect
   `Asthmatic, Frail, Glass Frame` = 11 AP). New entries are **appended**.
2. **The `pact-guide` master had already diverged from the served copy** — independently of this
   change. The master still says caps are advisory ("The tool only warns, it does not block… DMs should
   enforce it"), and omits the cap sentence entirely on `Forgetful`, `Slow Study`, `Suggestible` and
   `Weak-Willed`, while the served copy carries the hard-enforcement wording that
   `b016331` introduced hours earlier. **This change did not resolve that** — the new rows were applied
   on top of each file's own prose so the divergence is neither widened nor silently overwritten. It
   needs its own reconciliation pass.
   Also noted: the guide's Body table is **not** alphabetical (`Missing Arm, Peg Leg, Old Wound,
   One-Eyed`). An early version of the edit sorted it and silently reordered three existing rows; the
   final version inserts order-preservingly instead.
3. **`guide-price-check.mjs` has zero drawback coverage**, so nothing mechanically verifies guide
   drawback prices against the engine — precisely the gap that produced the Grit divergence. Not closed
   here; flagged for its own task.

## Code review findings and fixes (same PR, before opening it)

`/code-review max` on the branch found the caster-gate mechanism this task built was **not actually
enforced anywhere a player would hit it**, plus gaps in the verification that let it look tested when it
wasn't. Ten findings; the first five compounded into one real outcome and were fixed here, the rest were
fixed or explicitly deferred:

1. **`_hasDisc` accepted a placeholder discipline.** CharGen's own UI creates a `{name:'(none)'}`
   discipline object the moment a player adds a Discipline card and leaves the select on its default — a
   zero-AP action the tool itself labels "nothing purchased for this slot yet" — and the gate's
   `(t.disciplines||[]).length` check counted it as a real Foundation. **Fixed**: matched the existing
   Arts-Foundation predicate exactly (`d.name && d.name!=='(none)'`), the same test at `engine.js:266`.
2. **Only `Mana Leak` was gated**, though `Ritual-Blind` and `Wild Surge` carry the identical printed
   requirement ("Requires a Spellcasting Foundation to take.") and were completely open — a larger free-AP
   hole (5 AP) than the one the mechanism was built to close (2 AP). **Fixed**: both added to
   `DATA.drawbackReq`. Checked first: zero live characters hold either, so extending the gate is safe.
3. **CharGen's checkbox guard only knew about `drawbackMaxStats`.** A non-caster could tick Mana Leak
   freely in the tool players actually build characters in — the ⛔ warning existed but nothing in the UI
   read it. **Fixed**: the same guard block that disables a stat-capped checkbox now also disables a
   caster-gated one.
4. **The comment beside that guard was false.** It claimed the engine's ⛔ warning "is what blocks the
   cloud save" — `_cgOverApBudget()`, the actual save gate, only checks `compute().remaining < 0` and
   never reads `.warnings` at all, so an already-held ⛔ violation of any kind (this one, or a pre-existing
   stat cap) does not block a save today. **Fixed the comment to say so.** Deliberately **not** wired to
   block saves on any ⛔ — the same paragraph explains that a drawback already held past its cap is left
   ticked on purpose, since silently un-ticking it would delete a purchase and refund AP behind the
   player's back; blocking the save instead would make that character permanently un-savable to the
   cloud with no way to clear the flag. That is a bigger, cross-tool question (see deferred items below).
5. **The random builder's `actDraw` candidate filter only checked `drawbackMaxStats`.** It could roll
   Mana Leak onto a Fighter, `tryAct` would then reject the whole action, and the roll was wasted.
   **Fixed**: filter now also respects `drawbackReq`.
6. **`verify-guide.mjs` had no reverse check** — nothing confirmed a `drawbackReq`-gated drawback's own
   prose actually states the requirement, mirroring the existing `cap:` sentence check. **Fixed**, and
   confirmed to fire (temporarily stripped the sentence from `engine-data.js`; the gate went red).
7. **`verify-guide.mjs` silently skipped any drawback with no guide row**, `continue`-ing past it with no
   record, while the PASS message still reported the full `DATA` count — a drawback added to the engine
   and forgotten in the guide would report as verified. **Fixed**: skips are now tracked (with a named
   exception for the 6 `Affliction —` entries that legitimately share one guide row) and a genuine miss
   fails the gate. Confirmed to fire (temporarily deleted a row; the gate went red).
8. **A `tool-pricing-ci.mjs` check measured a spendable delta against whatever the shared page's form
   already had ticked**, rather than a clean baseline — passing today only because nothing earlier in that
   file ticks a real checkbox, but fragile to reorder. **Fixed**: clears `b.drawbacks` before measuring
   `before`.
9. **This record's own heading said "two things" over a list of three.** Fixed to three.
10. **Deferred, not fixed here** — the Live Sheet's `takeDrawback()` calls `emit()` directly and never
    calls `legalCheck()` at all, so **no** drawback gate is enforced there, including the pre-existing
    `drawbackMaxStats` stat caps from `b016331` — contradicting that decision's own claim that "the Live
    Sheet's `buy()` already blocks anything not matched by SOFT_WARN." This is a structural gap across
    *all* drawback gates in one tool, not specific to this task's `drawbackReq` addition, and fixing it
    means routing drawback purchases through `legalCheck()`/`buy()` in a tool this task did not otherwise
    touch — exactly the kind of cross-tool, purchase-flow-control change that deserves its own task and a
    deliberate risk call, not a fix bolted onto an unrelated PR. Tracked as a NEXT-board task. The related
    `actDraw`/`tryAct` bookkeeping bug the reviewer also found — `_draws` increments before `tryAct`'s
    rollback and is never restored on rejection, silently costing a random-builder draw attempt — is
    pre-existing, not introduced by this task's `drawbackReq` addition (finding 5 above fixed only what
    *causes* more rejections, not the leak itself), and is folded into the same follow-up task since a fix
    to one touches the same code path as the other.

Re-verified after all fixes: `engine-parity-ci` 40/0, `tool-pricing-ci` 162/0, `verify-guide` 10/10 (with
the two new checks confirmed to fail-then-pass by deliberately breaking and restoring each condition),
`log-fuzz` 500/500.
