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
4. `fix/species-pack-not-charged` — CharGen draft reconciliation; closes Anders (15 vs 33).

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
