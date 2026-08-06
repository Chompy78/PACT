# D-GH-2026-08-05-pricing-model — prices freeze at purchase; the creation lock is what decides how a purchase is quoted

Status: Active — supersedes decision **H2** in `D-GH-2026-08-04-species-pack-ledger-drift`. Not built;
scoped as four branches (see *Work split* below).

**Supersedes:** the `H2 — the invariant route` decision in
`decisions/2026/D-GH-2026-08-04-species-pack-ledger-drift.md`. H2 said: *make the recorded cost of every
event equal `compute()`'s own delta by construction.* That is the defect restated as a goal — see
*Why H2 was wrong* below. The rest of that record (the reproduction, the two wrong diagnoses, the
mechanism) still stands and is worth reading first.

## Context

`fix/species-pack-not-charged` was pre-flighted, planned, and sent for two rounds of external cold
review (five reviewers, then four; artefacts under `zUser-Uploads/`). Both rounds refuted the plan's
central mechanism. The second round's findings, plus two code audits, moved the diagnosis three times
before it settled. This record captures where it landed and — deliberately — what was wrong on the way,
because two of the wrong answers are recorded in the repo as decisions and would otherwise be built.

The reproduction is unchanged: Anders Tealeaf computes to **33 AP** and his frozen ledger sums to
**15**. The identity patch records **−5** for setting Halfling + Gnome, and the four pack-included
traits record **0** each.

## The rules model (owner, this session)

Three statements, in force together. They are not in tension; conflating them is what produced the
earlier wrong diagnoses.

1. **Price ladders that scale with context are intended.** Vigor rank N genuinely costs more bought at
   tier 3 than at tier 1. That is design, not drift.
2. **A purchase's price freezes when it is made.** Nothing later — a level-up, a class unlock, another
   purchase — may change what an earlier purchase cost. (1) applies only to *new* purchases.
3. **Therefore `compute().total` and the ledger sum answer different questions and are *supposed* to
   diverge.** `compute()` re-prices the whole build at today's context: *"what would this cost to build
   today."* The ledger records *"what was paid."* The Live Sheet already prints both, as
   "paid X · Y at today's prices" (`tools/PACT-Live-Char-Sheet.html:774-776`).

## The actual defect

`priceOf()` (`tools/PACT-Live-Char-Sheet.html:503-511`) quotes a purchase as a **whole-build delta**:

```js
const before = compute(cur).total;
const cand = clone(cur); (MUT[cat]||(()=>{}))(cand, payload);
return compute(cand).total - before;
```

It asks *"how much bigger does my whole character get?"* rather than *"what does this thing cost?"*.
When the thing being bought also changes how other things are priced, the quote sweeps up the
re-pricing of everything already owned — and that number is then **frozen into the log**, so it is not
a display glitch but a permanent mis-record.

**This was already known and patched three times, never generalised.** `priceOf` escapes the diff for
`abil` (looks the price up in `DATA.ABIL` directly) and for `mbound`/`dbound` (hardcoded flat `-2`),
with an inline comment on the latter stating that a full recompute diff *"would also retroactively
discount already-owned features/spells (the refund bug)."*

Live unpatched instances found this session:

| Instance | Effect |
|---|---|
| **Level Up** (`tools/PACT-Live-Char-Sheet.html:902`) | charges the hit-die step **plus** a full re-price of the existing Vigor and Grit stacks at the new tier |
| **Class unlock** (`tools/PACT-Live-Char-Sheet.html:971`) | quotes the unlock cost **minus** a retroactive discount on every already-owned feature of that class; can reach zero or negative |
| **Species set/change** (CharGen `replacePatchSlot`, `tools/PACT-CharGen-Webtool.html:2037-2048`) | the species-pack bug |

**Epic boons are NOT a fourth instance** — an earlier draft asserted they were. `MUT.boon` only pushes
the label and never sets `epicBoonAbil`, so the candidate build carries no stat bump and the quote comes
out as exactly the boon's listed price. Correct answer, accidental mechanism.

## Why H2 was wrong

H2 aimed to make each event's recorded cost equal `compute()`'s delta by construction. But
`compute()`'s delta *is* what `priceOf` already returns — it is the contaminated number. Building
toward that invariant would formalise the defect. The related acceptance test (*"frozen sum must equal
`compute().total`"*) is also wrong **as a general property**: statement 2 above guarantees the two
diverge for any character who has levelled or unlocked. It is right only for a character built entirely
at one context — which is what the task board's own step-6 gate actually named.

## Decision

### D1 — Quoting basis: listed price for context changes

A purchase that changes the pricing context is quoted from its own rules table, never by whole-build
diff. The three existing escapes are retired into that rule rather than joined by a fourth. Six of the
eight context-change prices are already reachable as `DATA` (`pack`, `unlockCum`, `HD`, `profCum`,
`ABIL`, `boons[].ap`); two are inline literals needing an additive `DATA` key — the 2nd-origin class
`14` (`js/engine.js:219`) and the bound `-2` (`js/engine.js:262,368,375`). Note the exact
correspondence: **the two escapes that return a hardcoded constant are precisely the two categories
whose price was never in `DATA`.** The escapes exist where the data was missing.

### D2 — The mode follows the character, not the tool

An earlier draft made CharGen a draft surface and the Live Sheet a ledger. Rejected: reopening a played
character in CharGen would launder it. Instead the **creation lock** decides, so it travels with the
character:

- **Before the lock** — the character is a draft. Re-pricing the whole build on any change is correct,
  and the ledger reconciles to `compute()` at one context. This is what makes changing species in
  CharGen re-price already-selected traits **correct**, not contamination.
- **After the lock** — every purchase freezes; context changes take listed prices; nothing may re-price
  a past purchase.

This also explains why `b._raceTraitLocked` stamps **per trait**: one character can hold purchases from
both sides of the lock.

### D3 — The lock trigger: first spend past a threshold

Already implemented and fixture-covered (`js/engine.js:634-655`, fixtures EV-003/EV-007/EV-009):

```js
const _autoArmed = _cfgAuto === undefined ? _campaignBound : !!_cfgAuto;
const _thr = (_cfgThreshold === undefined || _cfgThreshold === null) ? DATA.level1AP : _cfgThreshold;
if (_autoArmed && !_explicitUnlocked && _spent > _thr) _locked = true;
```

The gap is **emit-side only**. Nothing in any tool emits `creationLocked` or `campaignBound`; CharGen
emits `creationLockConfig` on the invite path alone (`tools/PACT-CharGen-Webtool.html:998`) with a
`threshold` but never `auto`, so `_locked` is `false` for every character in the app today.

**Offline flow (owner):** arm the lock at character creation by emitting
`creationLockConfig {auto:true}` with **no** threshold, so it falls back to `DATA.level1AP` — currently
**79**, from `LEVEL_BUDGET_CURVES.standard = {l1:79, inc:24}` and documented in `js/ap-by-level.js` as
"the creation lock's fallback threshold". A prompt on first character generation asks the player to
confirm or customise that figure (natural options are the documented presets: Standard 79, Generous 83,
Level-0 prelude 55, custom). It re-appears until confirmed or until spend passes the default, and an
unconfirmed character carries a small warning that clears on either. Arming by default is deliberate:
without it, dismissing the prompt forever would mean creation pricing never ends.

### D4 — The threshold is stored as an event, not a save-file field

`creationLockConfig` lives in the `LOG`, and the `LOG` *is* the save envelope
(`{schema:'pact-character/1', rules, name, LOG, SEQ, id}`) for both local files and the cloud `stats`
column. So it persists offline and online with **no schema bump and no migration**, survives the
CharGen ↔ Live Sheet handoff, and replays in order. A new top-level envelope field was rejected: easier
to read, but costs a schema version bump across both tools and the cloud column to solve something
already solved.

**Hard constraint — config events must APPEND, never replace.** `_replay` applies config in log order,
so a replaced-and-moved event would apply a raised threshold *retroactively* and could un-trip a lock
that had already fired. That is a straight retroactive-unlock exploit. This matters because CharGen's
two existing edit helpers, `replacePatchSlot` and `_cgSyncSingletonEvent`, both work by
filter-and-append — they delete the original and append a replacement. That is the house pattern for
editable fields, so wiring a threshold editor through either one out of habit is the natural mistake.

### D5 — Undo reverses the lock, by design

`_locked` is a local in `_replay`, reset on every replay (`js/engine.js:627`) — it is **pure derived
state, not a persisted ratchet**. Remove the purchase that crossed the threshold and the character
returns to unlocked. This is correct: if the purchase was undone, the AP was not spent, so creation has
not ended. A lock surviving undo would make a mis-click permanently cost creation pricing.

Not exploitable in the obvious direction — being locked never makes anything *cheaper* (the locked
branch re-prices own-species non-pack traits on the Master table at current tier, which is dearer:
the guide's "always hard to grow into your heritage late").

Two consequences to hold:

- **Frozen prices do not reverse with the lock.** A purchase made while locked keeps its post-lock
  price even if the character later reverts to unlocked. The Live Sheet is protected by accident (undo
  is strictly LIFO), but CharGen's `retractFlatEvent` splices from anywhere in the log, so a CharGen
  character can end up unlocked while holding events priced at locked rates.
- **An explicit lock action would be undoable** like any other event, if a "finish character" button is
  ever added.

### D6 — Migration: grandfather now, one reconciliation pass later (owner, 2026-08-05)

Every character built before this work carries an under-recorded ledger — Anders is 15 against
`compute()`'s 33 — and the Live Sheet's `priceOf()` had been freezing contaminated figures into logs for
every context change (Level Up, class unlock). Two routes were open: leave them permanently
grandfathered under the app's stated "prices freeze, never retroactively corrected" rule, or correct them.

**Decided: neither of the pricing branches touches existing characters.** They are grandfathered *for
now*, deliberately as a holding position rather than a permanent one. A separate one-off reconciliation
pass comes later and fixes everything about these characters in one go, rather than each fix carrying its
own partial migration.

Why this way round:

- It keeps the four pricing branches to one job each. A migration bolted onto `fix/species-pack-not-charged`
  would correct pack accounting while leaving the Level Up and class-unlock over/under-charges in the same
  logs untouched — a half-corrected ledger is harder to reason about than an uncorrected one.
- By the time all four have landed there is exactly one definition of "correct" to reconcile against.
  Reconciling against a moving target is how the drift got here.
- Pre-launch, so the corpus is small and known (Anders, Fenwick, Cedric and a handful of others). The cost
  of waiting is low and the cost of getting it wrong twice is not.

**Consequence to hold on to:** until that pass runs, a pre-existing character's frozen ledger will not
equal `compute().total` even where the new rules say it should, and no gate should assert that it does.
The invariant applies to characters built *after* this work, which is what the acceptance test scopes.

Tracked as `fix/ledger-reconciliation-pass` on the task board.

## Work split

One task per branch, in dependency order. Parts 2–4 do nothing until part 1 exists.

1. `docs/pricing-model-decisions` — this record; reverse H2; task-board amendments.
2. `feat/creation-lock-wiring` — emit `creationLockConfig {auto:true}` at creation; the confirm prompt;
   the unconfirmed warning. **Append-only** config events.
3. `fix/livesheet-context-pricing` — listed prices for context changes; two new `DATA` keys.
4. `fix/species-pack-not-charged` — CharGen draft reconciliation; closes Anders (15 vs 33). **DONE**
   2026-08-05 — shipped as `repriceDraft()` plus in-place patch-slot replacement; see D7.

### D7 — Draft reconciliation runs as an engine pass, not a tool pricer (2026-08-05, part 4)

Part 4 shipped as `repriceDraft(log)` in `js/engine.js`, called from every LOG-mutating path in CharGen.
Three things about it were not obvious from D2 and are worth recording, because each was found the hard
way rather than reasoned out:

- **It lives in the engine, not the tool.** The walk needs `_replay`'s per-trait `_raceTraitLocked`
  stamping (racial pricing depends on it) and its lock bookkeeping. A tool-local copy is exactly the
  duplication that produced D-GH36's `found`/`dbound` drift. `_replay` gained one optional callback
  parameter; `foldBuild`/`rebuildStateFromEvents` pass two arguments and are unaffected.
- **Re-pricing is all-or-nothing per log, because the lock's POSITION is a function of the costs being
  rewritten.** Either the log is a draft and every purchase re-prices, or the lock has fired somewhere
  and nothing is touched. There is deliberately no per-event mode.

  The first version had one, and a code review showed it broke both ways. It was not idempotent — the
  lock point advanced one event per pass, so convergence was O(events after the lock), not the one or
  two passes claimed; user-visibly, `economy(LOG).spent` read 86 after one call and 67 after the next
  unrelated edit, a 19 AP jump with no purchase behind it, autosaved in that state. And it broke the
  very guarantee it claimed to keep: editing a locked character's species put the new quote at the old
  event's index, which sits *before* the lock, so the pass treated it as draft state and re-derived
  purchases made while locked — a trait frozen at 6 AP silently became 2, straight against D5.

  Deciding once for the whole log removes both. The lock position is read from what was actually paid,
  never from what the pass is about to write, so a second call cannot move anything. Where a re-price
  pushes a draft past its own threshold, the new costs stand as that draft's final reconciliation and
  the next call sees a locked log and leaves it alone — a fixed point after one pass, by construction.
  Exported as `isCreationDraft(log)` so callers and gates ask the engine rather than re-deriving it.
- **Drawbacks are excluded, because their recorded cost is income.** `economy()` reports it under
  `earned`, never `spent`, and `foldBuild` feeds that into `b.budget`. An earlier version re-priced them
  and moved `compute()` output as a result. Re-pricing answers "what was paid" and must not restate what
  was earned.

A second, independent defect was fixed alongside it: `replacePatchSlot()` filter-and-appended, so
editing any patch slot moved its event to the END of the log. Changing species therefore re-sorted the
ledger to put the identity line *after* the traits it prices, which is what made that line come out
negative. It now replaces in place, keeping the original `seq`. Safe because `PATCH_FIELD_SLOT` maps
each field to exactly one slot, so no two patch events write the same field and their relative order
cannot change the folded build. This is **not** the D4 rule in reverse — D4 forbids *moving* a config
event, which replace-in-place guarantees.

The two are genuinely separable: re-pricing alone fixes the ledger *sum* but leaves the negative line;
in-place replacement alone fixes the line but not the sum. The gate asserts both, and was verified by
reintroducing each half independently.

Two further review findings, both fixed: `_cgApplyEnvelope` reinstates a saved LOG verbatim *after*
`applyBuild()` and so discarded the re-price that `replaceWholeLogFromBuild` had just done — meaning a
loaded file kept its stale ledger until some later unrelated edit made it jump, which is precisely the
path a pre-existing under-recorded character arrives by. And the fuzzer's reconciliation invariant was
scoped on whether the lock *could* fire rather than whether it *did*, which excluded every
CharGen-shaped log, since `_cgEnsureLockArmed()` stamps `creationLockConfig{auto:true}` into all of them.

**Still open after this branch:** CharGen's `replacePatchSlot()` still quotes a context change as a
whole-build delta, so a *locked* character editing species is quoted at −4 rather than the pack's listed
price. D1 was implemented for the Live Sheet's `priceOf()` only. Tracked as `fix/chargen-context-pricing`.

### D8 — Vigor is stamped per rank; the pre-lock reconciliation question closes (2026-08-05)

The open question below asked whether a pre-lock Live Sheet character should reconcile, because levelling
1→5 with a Vigor/Grit stack left the ledger at 44 against a `compute()` of 83. It is answered, and not by
picking a side: **both numbers were right and the model was wrong.** `compute()` had no way to know *when*
a Vigor rank was bought, so it re-priced the whole stack at today's tier.

Vigor now carries `b._vigorRankTier`, an array stamping each rank with the tier in force when it was
bought — the same idea as `_raceTraitLocked`, which has always priced species traits at the lock state at
purchase. `_replay` fills it just before the mutator runs (the only point where the previous rank total is
still visible), and `compute()` prices each rank from its own stamp, falling back to today's tier for an
unstamped build. Presence, not truthiness, is the signal, exactly as the species code does it — a rank
tier of 1 is legitimate, so a 0-vs-missing test would misread a real entry.

The result is that the ledger and `compute()` agree by construction rather than by convention, and the
owner's rule — *buying early really is cheaper* — becomes a permanent property of the character instead
of something two pricers have to remember separately. In one build: two ranks bought at tier 1 stay at 10
AP after levelling to tier 4, while a third rank bought after the level-up costs the tier-4 rate of 14.
Both halves of the asymmetry, pinned by fixture EV-015.

Combined with the Grit correction (`D-GH-2026-08-05-grit-ladder-correction`), the CharGen-vs-Live-Sheet
levelling divergence is gone: levelling 1→5 with Vigor 2 / Grit 3 now quotes **12 in both tools**, where
CharGen quoted 51. One divergence remains — `unlockclass`, where CharGen quotes **−6** against the Live
Sheet's 7 for a character owning four features of that class. Same root cause (a whole-build delta
sweeping in a retroactive discount), same shape of fix (stamp each feature with whether its class was
unlocked when it was bought). Tracked as `fix/chargen-context-pricing`.

**Coverage note.** Vigor was, like Grit, entirely ungated — every fixture carried `hardy: 0` and no event
fixture bought Vigor at all. Two rules mechanics in a row turned out to have no test touching them; that
is worth treating as a pattern rather than two coincidences when deciding what to gate next.

## Open question (ANSWERED — see D8) — should a PRE-LOCK Live Sheet character reconcile? (raised 2026-08-05)

D1 and D2 conflict for one case that neither anticipated, and part 4 deliberately did not resolve it.

Measured in a real browser on a fresh Live Sheet character, well under the 79 AP threshold and therefore
a draft by D2's definition: buy CON 16, Vigor 2, Grit 3 — ledger and `compute()` agree at 32. Then level
1→2 and 2→5. Listed pricing (D1) charges the Hit-Die steps, 2 and 10; `compute()` re-prices the whole
Vigor/Grit stack at the new tier. The ledger ends at **44 against a `compute()` of 83**.

Neither rule is being violated — that is the problem:

- **D2 says a draft reconciles**, which would mean the Live Sheet needs `repriceDraft` too.
- **D1 says a context change takes its listed price**, and levelling up is a real context change even
  during creation, which would mean the divergence is correct and D2's wording ("the ledger reconciles
  to `compute()` at one context") needs narrowing to *"while no context change has occurred"*.

CharGen is unaffected either way: it builds a character at one level, and its edits are revisions of a
single draft rather than progression. The question only bites where a pre-lock character levels up.
Tracked as `fix/livesheet-draft-reconcile` on the task board; it needs a rules answer before code.

## Open question — campaign vs player threshold precedence

A player who picks 83 offline and later joins a campaign running 79 will hold both config events;
last-write-wins means the campaign's overrides from that point. That is probably right — the table's
rules beat the player's preference — but it should be a stated rule rather than an accident of event
order, and it is undecided whether joining a campaign *after* locking should re-open anything. Does not
block parts 1–4; bites only on the campaign-join path.

## Why

Three special-case escapes already exist for this exact failure and did not converge; a fourth would not
either. Three of four round-2 reviewers independently rejected "just add another escape" as the weaker
option, and the one that argued for it was outvoted across vendor families. Putting the mode on the
character rather than the tool is what makes the rule un-launderable, and it costs only the emit side of
a mechanism the engine already implements and already has fixtures for.

## Related

- `decisions/2026/D-GH-2026-08-04-species-pack-ledger-drift.md` — the reproduction and mechanism; its
  H2 decision is superseded here.
- `zUser-Uploads/old/` — round-1 cold reviews (5); `zUser-Uploads/` — round-2 (4).
- Incidental defects found during the audits, unrelated to this model and needing their own entries:
  `buyManeuver()` emits without an affordability check (`tools/PACT-Live-Char-Sheet.html:1497`); buying
  an epic boon in the Live Sheet is hard-blocked on the first attempt by construction; `epicBoonAbil` is
  silently dropped on a CharGen round-trip.
