# D-GH-2026-08-27-feature-hd-gate — class abilities are Hit-Dice gated in the engine, via one shared `requiredHD()`

**Date:** 2026-08-27 · **Branch:** `feat/feature-hd-gate` · **Status:** Accepted, implemented
**Rules version:** `DATA.version` v0.359 → **v0.360** (`compute()` output changed)

## Context

The Players Guide states the rule as an absolute — *"You can never buy an ability before you own the
Hit Dice, and hence the equivalent level, it requires"* — and gives the worked example *"Extra Attack is
a T4 feature gated behind 5 Hit Dice."* `DATA.tierHD` has carried the mapping all along
(`{1:1, 2:2, 3:3, 4:5, 5:9, 6:13, 7:17}`).

`js/engine.js` never implemented it. Verified before starting: a 1 HD Fighter could buy `Extra Attack`
**and** `Extra Attack (3rd)` (T7) and `compute()` returned only `"OVER BUDGET by 32 AP"`.

The rule was implemented in three places with three different answers:

| | before |
|---|---|
| `js/engine.js` (authoritative) | no gate at all |
| Live Sheet | **five** inline `b.hd < DATA.tierHD[x.tier]` copies across its four pickers — and they disagreed with each other: three omitted the `lvl` floor that a fourth applied. (`grep -c DATA.tierHD` on `preview` returns 8: these five, plus two racial-trait sites deliberately kept, plus one comment.) |
| CharGen | no class-ability gate (it used `tierHD` for racial traits only) |
| DM Console | no picker; but it *renders* rosters, so it displays the result |

That divergence is the root cause, not an incidental detail: the component meant to be authoritative was
the one with no opinion, so whichever UI a character was built in decided whether the rule existed.

## Options

- **A1 — Soft warning**, like boons/arts today: still priced, still owned. Rejected: the Guide states an
  absolute, and an advisory gate drifts again the moment a tool stops rendering the warning — which is
  exactly how this bug arose.
- **A2 — `⛔` warning but still priced/owned**, like racial `minHD`. Rejected as primary (zero fixture
  churn, but leaves an illegal character representable).
- **A3 — Hard block: 0 AP, not owned, itemised under "Blocked purchases".** **Chosen.** Reuses the
  machinery `f.prereq` already had.
- **B1/B2/B3 — derive the gate from tier / author `hd` on all 551 entries / derive with an optional
  per-item floor.** **B3 chosen** — no bulk duplication of what `tier` already says, with an escape hatch.
- **I1/I2 — add the check inline in `compute()` and leave the tools alone / export ONE eligibility
  function every caller shares.** **I2 chosen.** See Why.

## Decision

1. **`js/engine.js` exports `requiredHD(item)`** — the single definition, returning
   `max(DATA.tierHD[tier], item.hd, item.lvl)`. (A `canPurchase()` convenience predicate and an
   `effectiveTier` parameter were drafted and then removed before merge: PR #471's review found both had
   zero call sites, and `effectiveTier` existed only for the stepped escalation that was cut.) `hd`/`lvl` are
   additional **floors, never overrides**: an item may raise its own requirement above its tier's, never
   lower it. The `lvl` term folds in the pre-existing Warlock-invocation level gate so callers get one
   number instead of combining two rules themselves.
2. **`compute()` gates both purchase paths on it** — the `DATA.features` loop and the `DATA.subAbilMap`
   loop — feeding one shared `blockedAP`/`_BLI` and one "Blocked purchases" ledger line. All 192 subclass
   abilities are mirrored into `DATA.features`, so gating one loop would guard one of two identical doors:
   the precise failure that got the v0.353 §11 access gate removed.
3. **The HD check seeds the existing `_blockedFeat` fixed point rather than running after it.** A hard
   block means not-owned, so anything naming an HD-blocked feature as its prerequisite must block
   transitively. A later pass would leave those dependents reading their prerequisite as owned.
4. **Live Sheet's five class-ability copies are deleted** and call `requiredHD()`; **CharGen imports it** and annotates
   each ability option with its requirement. Only the racial-trait site remains local — racial traits gate
   on `minHD`, a different field with different messaging, and are out of scope here.
5. **Stepped (`rep`) features are gated on their own tier, NOT an escalated step tier.** Considered and
   rejected — see Why.

## Why

**Why one exported function (I2) and not an inline check (I1).** The bug was not "the engine forgot a
check"; it was "the rule had three implementations and the authoritative component had none." An inline
check adds an eighth copy and leaves the next divergence available. Exporting one function makes the
divergence unrepresentable, and it cost almost nothing because the two tools with class-ability pickers
(CharGen and the Live Sheet) already have module
bridges (Live Sheet and DM Console from the start, CharGen since D-GH26). The five Live Sheet copies had
*already* drifted from each other over the `lvl` floor, which is the concrete evidence that they would
have drifted again.

**Why no stepped-tier escalation.** An earlier draft gated `rep` features on `min(7, tier + n - 1)`.
Dropped after measurement: it changes **nothing** — fixture impact is byte-identical with and without it —
because exactly **one** entry in the dataset is `rep` (`Sorcerer: Metamagic`), and its price is overridden
to a flat `2N` two lines below, so the escalated-tier expression is dead code for the only thing it
applies to. Worse, the draft justified it with a Guide sentence (*"You may buy the next step only once you
own the Hit Dice shown"*) that turns out to sit in the **Proficiency Bonus** section, about the +2→+6
ladder — not stepped class features. And the Guide lists Metamagic explicitly as having **"no level
gate"**, so gating it would have been a rules *change* requiring its own Guide edit, not the rules
catch-up this is. The 17-HD-to-finish-a-ladder consequence people expect from step escalation comes from
individually authored tiers (`Sneak Attack (10d6)` is authored T7), not from any escalation rule.

**Why a hard block was safe despite live data.** The plan originally assumed the app was pre-launch, per
D-GH37. **That assumption was false and was checked rather than inherited:** the live Supabase project
holds 25 characters across 8 owners and 4 campaigns, one updated the day before this change. Evaluating
the gate against the real data found **one** affected character — `Archer`, not campaign-bound, at 2 HD
holding a T3 subclass ability, fixable by buying one Hit Die. No Amble character is affected. `AGENTS.md`'s
pre-launch line is stale and is corrected separately.

## Status

**Accepted, implemented.** `engine-parity` 70/70, `tool-pricing` 176/176.

Fifteen existing fixtures needed their `hd` raised. Every one was re-baselined by *raising HD until the
gate is met and re-deriving*, never by regenerating expected output: each new total decomposes into
"HD-ladder cost + purchases that became legal", and the four prerequisite regression fixtures
(`CG-022`, `CG-027`, `CG-030`, `CG-031`) show **+0 newly-legal purchases** and retain their original
prereq warning strings byte-for-byte — proof they still block for the prerequisite reason rather than
passing on the new gate. Five new fixtures (`CG-045`–`CG-049`) cover: direct HD block, exact-threshold
boundary, the subclass door, both gates firing at once, and the `lvl` floor exceeding its tier.

## Deferred (own task-board items)

- **Mirrored subclass double-charge.** Buying one ability through *both* collections in one build charges
  twice with no warning (verified: 134 / 134 / 140). Pre-existing; the v0.353 comment's
  `refactor/subclass-purchase-unify` is the real fix.
- **Per-step level granularity.** The Guide labels `Sneak Attack (9d6, L17)` and `(10d6, L19)` — both
  authored T7. A seven-tier gate cannot express L19, so tier-derived gating is a coarse approximation of
  what the Guide actually publishes.
- **HD event vocabulary.** CharGen writes HD as a replace-in-place `cat:'patch'` slot (`PATCH_SLOTS.HD_PROF`);
  the Live Sheet appends `cat:'hd'` events. So CharGen-authored characters carry **no HD history**, which
  makes purchase-time ("legal when bought") gating impossible for them — the principled answer to a
  character whose HD is later reduced by undo.
- **`DATA.tierHD` T1–T3 vs the Guide.** The Guide's published table lists only T4–T7. Its prose says
  *"Powers available from level 4 onwards with no chain requirement are Tier 3"* while `tierHD[3] = 3`.
  Needs a rules-owner ruling on which is authoritative.

## Addendum — `/code-review ultra` on PR #471 (2026-08-27)

The review found a **live regression this change introduced**, plus a set of accuracy and consistency
defects. Fixed before merge:

**Blocked must mean "grants nothing", not just "costs nothing" — the load-bearing correction.**
Ownership resolution (`_ownedFeatSet` / `_blockedFeat` / `_hdBlockedFeat`) originally sat next to the
pricing loop that consumes it, ~180 lines *below* the ability-score fold. That fold reads raw
`b.features` for `Barbarian: Primal Champion`'s +4 STR/+4 CON, so a 1 HD Barbarian got the stats — and the
HP/AC/save-DC knock-ons — **for 0 AP**, while `compute()` reported the feature as "not counted, not owned".
Verified: `total 0, STR 14, CON 14, hp 8` where the same build cost 19 AP before this PR. The block is now
resolved *before* any mechanical effect reads `b.features`, and `CG-050` is the regression fixture. The
general rule this establishes: **any future effect that reads `b.features` must consult `_blockedFeat`**,
which is why the resolution now sits at the top of `compute()` with a comment saying so.

Also fixed: `canPurchase()` and `requiredHD()`'s `effectiveTier` parameter were removed (zero call sites —
`effectiveTier` existed only for the cut stepped escalation); the warning for a `lvl`-floor block no longer
mislabels itself as a tier requirement (`"needs 12 Hit Dice (T5)"` claimed a T5 ability needs 12 HD, false
for every other T5 ability — now `"(level gate)"`); the maneuver-affordability tests were running on a
character whose Combat Superiority was itself blocked, silently inverting their premise; CharGen's
"Blocked purchases" help text explained only the prerequisite cause; and `EV-016` was restored to a
10-line insertion after a writer pass had reflowed all 46.

**Corrected claims.** This record said the Live Sheet carried "seven" copies. It carried **five**
class-ability sites; `grep -c` returns 8 including two racial sites this record separately says were kept,
plus a comment. It also said "all three tools call" the export — DM Console has no class-ability picker
and imports nothing — and that CharGen annotates "each ability option", when only the class-feature grid
is annotated. All corrected here, in `DECISIONS.md` and in `CHANGELOG.md`.

**One review finding was a false positive:** that three of the four deferred items were never filed. They
were — commit `7ae7678` on `preview`. The review ran against this branch, which predates it.

**Open, not fixed here** — see the task board: a purchase frozen at `cost 0` while HD-blocked can become
fully owned for free once HD rises, because the Live Sheet prices a level-up as the Hit-Dice ladder alone
and never as a `compute()` delta; the Live Sheet's buy panel still renders an HD-blocked feature as
"already purchased"; and CharGen's subclass-ability picker has no HD annotation.
