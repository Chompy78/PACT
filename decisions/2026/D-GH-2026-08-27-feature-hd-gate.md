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

### Addendum, round 2 — second `/code-review ultra` (2026-08-27)

The re-run found that **two of round 1's own fixes were incomplete**, both verified by execution before
being accepted:

- **The level-up quote was still short.** Charging the fall in the "Blocked purchases" line missed the
  *other* lines that move when a purchase is legalised: a blocked subclass ability is skipped by the
  engine's `subUsed[]` marking, so unblocking it adds a 15 AP "Subclass unlocks" line (measured: real
  delta 32, quoted 17), and an unblocked invocation re-enters the breadth surcharge. Replaced with the
  difference of two deltas — the real one, and the same one on a build with every currently-HD-blocked
  purchase stripped — so anything re-pricing for other reasons (the unstamped Vigor/Grit stack this
  escape exists for) cancels between them and only the unblocking cost survives. The new
  `tool-pricing-ci` case asserts the quote equals the **full** `compute()` delta, not any one line of it;
  round 1's case used `Fighter: Extra Attack`, which has no knock-on line and so could not catch this.
- **CharGen's class-feature annotation never rendered.** `annotate()` rewrites every `.classpick`
  option's `textContent` wholesale on each render, overwriting the tag `buildClassPickers()` set at init.
  The affordance existed only between boot and the first render. Both pickers now apply it through one
  `_cgHdTag()` helper inside `annotate()`.

Also fixed: `_inertNote()` detected only the Hit-Dice block, so a held feature blocked by a missing
prerequisite still rendered as "Already purchased" — failing the same Done-when the HD case was fixed for
(the prereq arm checks direct prerequisites only, which is stated in the code rather than implied);
DM Console rendered class features from the raw build array, showing a blocked feature as held (its
subclass section was already safe, so this was the remaining unguarded door of the two); and two comments
that had become false — the adoption claim ("all three tools import it" — DM Console has no picker) and
the Warlock-level note still calling that gate "unchanged, still advisory" when `requiredHD()` now folds
`lvl` in as a floor.

**Not fixed, left open:** a character holding an expensive inert purchase can be hard-blocked from
levelling, because the quote now carries that purchase's full cost and no discard path exists; and four
`DATA.tierHD[x.tier]` re-derivations remain for racial traits, which `requiredHD()` was meant to own.

### Addendum, round 3 — the gate extended to Arts and Boons (2026-08-27)

The original change scoped to class abilities, leaving **Arts & Techniques and Boons advisory**: `compute()`
warned "needs N+ Hit Dice" and then charged and granted them anyway, so a 1 HD character could hold and use
a 3 HD Art. Owner direction: gate them the same way. Done.

**The epic-boon trap, caught before it shipped this time.** The `_flat` ability fold reads `b.boons`
directly to apply each Epic boon's +2, roughly 400 lines above the boon pricing loop. Blocking boons at the
loop alone would have handed a 1 HD character a free +2 — the identical shape of the Primal Champion
regression from round 1. Arts and boons are therefore resolved into blocked sets **at the top of
`compute()`, beside the feature sets and before the fold**, and `blockedAP`/`_BLI` were hoisted with them
so the arts loop (which runs well before the feature loop) feeds the same single "Blocked purchases" line.
That line now emits after the boons loop, so all four datasets contribute to one row. `CG-052` is the
regression: a blocked Epic boon at 1 HD leaves STR at 10 and totals 0; at 17 HD it prices and grants.

**Live data checked first, per the task's own step 1.** Eleven of the 25 live characters hold Arts or
Boons; **none** holds one above their Hit Dice, so this enforces against zero existing characters.

**On the 3-vs-4 question for the general-feat pool: 3 is correct and was not changed.** `DATA.tierHD`
describes each tier as a *band* of levels gated at the band floor — T3 = levels 3–4, T7 = levels 17–20 —
which the Guide confirms in its own words ("Tier-7 — gated behind Hit Die 17, the level-19 threshold in the
2024 rules"). A level-4 general feat sits in the T3 band and gates at 3, by the same rule that puts a
level-19 Epic boon at 17. Moving Arts to 4 would make them the only thing in the game gated mid-band. The
2024 categories map cleanly onto what the data already had: Origin (L1) and Fighting Style (L1) at 1 HD,
general feats (L4+) at 3 HD, Epic Boons (L19+) at 17 HD.

Note for whoever takes the racial-trait de-duplication task: both tools read `ar.hd` / `bo.hd` directly
rather than calling `requiredHD()`, so Arts and Boons carry the same re-derivation the racial sites do.

### Addendum, round 4 — tier demoted to pricing-only; true levels authored where known (2026-08-27)

**Owner ruling:** "the Tiers are really just for costings." `requiredHD()` changed accordingly —
an item's own `hd`/`lvl` is now the authoritative Hit-Dice requirement and **overrides tier in both
directions** (it can sit below the tier band as well as above); tier's `tierHD` lookup is only the
**fallback** for an item that states no level of its own, not the intended source of truth.

**What was actually authored, and why not further.** Checked before writing anything: the Guide states a
true level for roughly 11 of the 720 purchasable abilities. Of those, 4 already matched their gate.
Authored the rest:
- **26 general-feat Arts**, `hd` 3 → 4 (2024: general feats are level 4+).
- **12 Epic Boons**, `hd` 17 → 19 (2024: Epic Boon feats are level 19+; the Guide already said so in
  prose — "gated behind Hit Die 17, the level-19 threshold" — the *data* just hadn't caught up).
- **2 class features whose own name already states a level their gate missed:**
  `Paladin: Aura range → 30 ft (L18)` (was 17, gains `lvl:18`) and
  `Rogue: Improved Cunning Strike (L11)` (was 9, gains `lvl:11` — a genuine tightening, since L11 sits
  below its T5/9-HD default).

**The other ~550 class features and subclass abilities were deliberately NOT touched.** No source in this
repo or the Guide states their true level, so authoring them would mean inventing numbers — the exact
mistake already made twice earlier in this same session (the "level 4" misreading, and the first
"5 characters break" query). Left resolving to their tier band's floor via the new fallback, which is
explicitly interim, not the intended end state — restated in code comments and the task board so it is
not lost.

**Live data checked before any of the 40 values changed:** none of the 11 characters holding an Art, Boon
or the two named features holds one of the 40 moved entries. Zero characters affected.

**Fixture discipline held, with one correction to my own arithmetic.** `CG-051`/`CG-052` needed only
their warning text updated (both fixtures were already below the new thresholds). `CG-015` needed `hd`
raised 17→18 (still proves both legacy feature-alias keys resolve; total moved by exactly the Hit-Dice
ladder step). `EV-018` needed its `hd` event raised 17→19. Its total was first hand-computed at 121 by
composing known deltas outside the engine — **wrong**, because Epic-boon pricing also depends on
`_vigorRankTier`-style purchase-time context the hand arithmetic didn't reproduce. Caught by re-deriving
through the real `rebuildStateFromEvents`/`compute()` pipeline rather than trusting the hand total; the
correct value is 167. Four `tool-pricing-ci` sites hard-coded a `h<=17` leveling ceiling for tests
specifically about Epic Boons and needed raising to 19; one of those inlined a Boon-of-Fate purchase whose
own `level:17` field needed the same correction.

engine-parity 73/73, tool-pricing 180/180 (3 consecutive runs). `DATA.version` bumped again for this round.

### Addendum, round 5 — the remaining ~550 abilities authored; 4 bundled features split (2026-08-27)

Closes `docs/TASK_BOARD_NEXT.md`'s "Author true 5e levels for the ~550 abilities still falling back to
tier". Round 4 explicitly deferred this because no source existed. The owner then supplied one: a real
extraction of the 2024 PHB, `docs/phb-rules-final.jsonl` (1,576 entries with page numbers), pushed to
`preview`.

**The source needed a human pass, not a blind script.** An automated match (`level\s+(\d+)` against the
extracted text) hit 351 of 468 Class Feature entries, but spot-checking caught two traps worth naming so
they aren't rediscovered: `"starting at level N"` marks an *upgrade* to a feature already owned, not its
unlock, and `Druid: Archdruid`'s only "level 4" is *"a level 4 spell slot"* — a spell-slot level, not a
character level. Both are filtered in the extraction script, but the automated pass still left 50 rows
with more than one candidate level and 87 rows the matcher couldn't find at all. The owner's own research
(not this session's) resolved every one of those, cross-checked page-by-page against the PHB, with an
honest confidence tag on each row — 577 High, 27 Medium.

**Applied:** 280 `lvl` overrides — 278 High-confidence, all tightening a gate above its tier-band floor;
2 Medium-confidence (`Warlock: Far Scribe` 9→5, `Warlock: Rebuke of the Talisman` 2→3 — both flagged "2014
version, not in 2024 PHB core, best guess", applied on explicit owner instruction rather than left as a
guess with no record). Only 2 of the 280 *loosen* a gate below its tier floor (`Paladin: Harness Divine
Power` 3→2, `Warlock: Far Scribe`); `requiredHD()`'s round-4 change to override tier in both directions is
what makes that expressible at all.

**Four PACT features were bundling separately-leveled 2024 abilities under one name and one price** —
an artifact of how the source list was originally compiled, not the real rules. Split, each re-tiered by
its own now-known level using the engine's own existing tier-shift pricing formula (the same one `rep`
features already use: `stick = MASTER[tier][band]; origin = max(1, stick-(tier-1)); cross = stick+tier`),
holding the original bundle's `band` constant per split (band encodes a feature's *shape* — passive vs.
per-rest vs. at-will — which splitting doesn't change):
- `Fighter: Tactical Mind/Shift/Master` → three features, L2/L5/L9.
- `Monk: Empowered Strikes/Self-Restoration` → two, L6/L10.
- `Monk: Perfect Focus/Body and Mind` → two, L15/L20.
- `Ranger: Roving/Tireless` → two, L6/L10.

Checked before splitting: zero live characters hold any of the four bundled keys, so no migration or
alias was needed — a straight delete-and-replace.

**Live data checked before anything moved, as every prior round in this record has done:** of the 8 live
characters holding a class feature or subclass ability, exactly one is affected — `Archer`, unbound, not
in a campaign, already known-blocked since round 1 (`Wizard | Evoker | Potent Cantrip`, T3). No new
character became blocked; no Amble character is affected.

**8 fixtures needed re-baselining**, all abilities whose true level sits above the old T7=17 ceiling
(Sneak Attack 10d6 = L19, Primal Champion = L20, etc.): `CG-022/023/025/026/027/028/029` had `hd` raised to
the new minimum and their totals re-derived through `compute()` — the two prereq-regression fixtures
(`CG-022`, `CG-027`) keep exactly one warning, the prereq one, proving they still test what they were
written to test. `CG-050` is the one exception to "raise HD": it exists to prove a *blocked* purchase
grants nothing, so raising its HD to 20 would make Primal Champion legal and defeat the fixture — its `hd`
stays at 1 and only its expected warning text (`needs 20 Hit Dice`, was 17) was updated.

`DATA.version` bumped once for this round. engine-parity 73/73, tool-pricing 180/180 (2 consecutive clean
runs after the known harness-readiness flake on unrelated checks).

**Not done here, filed separately:**
- **`docs/PACT-Players-Guide.html` was not updated in this round**, though the task's own step 5 asks for
  it in the same batch. ~280 numbers moved; the Guide sync is real, separate work reached through the
  `pact-guide` project (see `AGENTS.md`'s "A mechanics change isn't finished until the engine AND the
  guide land it"). Filed as its own task rather than rushed.
- **The source `phb-rules-final.jsonl` itself still has the 4 bundled entries** this round split on the
  PACT side. Fixing the JSONL at its source (splitting each into its correctly-separated sub-entries with
  correct page numbers) is filed as its own task so a future re-extraction doesn't need this same manual
  re-adjudication.
- **Racial traits (38 entries) still re-derive `DATA.tierHD` locally** rather than calling `requiredHD()`
  — unchanged from round 3's note, still open on the board.
