# D-GH-2026-08-06-creation-lock-survives-reload — creation ends by being RECORDED, not re-derived

Status: Active. Shipped 2026-08-06. Owner decision (H2, 2026-08-06). No `DATA.version` change — the
engine is untouched; this is CharGen emitting an event the engine has always understood.

## Context

A CharGen character could never stay locked. Both of the engine's lock paths were dead there:

- **Automatic** (`_spent > threshold`, `js/engine.js:766`) — `_buildEventBurst` tags every event
  `noLock:true`, so `_spent` never accumulates. That tagging is not an oversight: it is the fix for
  **D-GH34**, where an imported higher-budget character self-tripped the threshold partway through the
  burst's *synthetic serialization order* and had its racial traits re-priced at that arbitrary boundary.
- **Explicit** (`creationLocked`) — described at `js/engine.js:671` as *"the primary intended trigger,
  e.g. a 'Finalise character' button"*. **No tool had ever emitted one.** CharGen's only mention of the
  event was inside a comment.

And because `_locked` is derived state rebuilt on every `_replay()`, there was nothing to survive a
reload even if it had fired.

## Options

- **H1 — an explicit "Finalise character" action.** The engine's own documented design, and unambiguous.
  Rejected by the owner: players forget to click it, and a character that never finishes creation never
  leaves creation pricing.
- **H2 — auto-emit `creationLocked` once creation spend crosses the threshold** (chosen).
- **H3 — remove the blanket `noLock` tagging**, as `feat/creation-vs-awarded-ap` step 4 proposed.
  Rejected: it reopens D-GH34. The burst's order is synthetic, so the lock would fall at an arbitrary
  point in it rather than where the player actually crossed the threshold.

## Decision

**`_cgRepriceDraft()` appends a `creationLocked` event once `economy(LOG).spent` exceeds the threshold.**

It resolves the existing state by mirroring `_replay()` exactly (`js/engine.js:749-756`): `creationLocked`
locks and clears the unlock, `creationUnlocked` sets the unlock, `creationLockConfig` re-arms by clearing
it. It fires only when armed, only when strictly over, and never when an explicit unlock is in force.

It lives inside `_cgRepriceDraft()` rather than at each call site, and reprices *before* deciding — the
lock must be judged on reconciled costs, and appending the event makes `isCreationDraft()` false, which
is what correctly stops further repricing.

## Why

**Because recording it is what makes it survive.** A LOG entry is replayed like any other; derived state
is not. This is the same reasoning as D4's appended `creationLockConfig` threshold.

**And because it keeps D-GH34 fixed rather than trading one bug for another.** The burst's events stay
`noLock`, so the lock is appended *after* the whole burst. Measured on an imported over-budget character:
140 AP spent against a 79 threshold, the lock is the **last** event, **12** buys precede it and **0**
follow, every burst buy still carries `noLock:true`, and every racial trait is still stamped pre-lock.
H3 would have put that boundary in the middle of a synthetic ordering.

**On what this does not do.** `feat/creation-vs-awarded-ap`'s Done-when also wants a 5th-level starting
character to get creation pricing *only for the creation-AP portion* — the first 79 AP at creation
prices, the rest post-lock. This does not deliver that, and cannot: the burst emits in canonical order,
not purchase order, so there is no honest place inside it to draw that line. Splitting pricing within an
import needs the burst to carry a real purchase sequence, which is a larger change. That half of the task
stays open, and this record exists partly to stop a future reader assuming it was covered.

## Outstanding

**A DM-applied lock that a player cannot undo** (owner, 2026-08-06, explicitly "ideally but not
critical"). Today `creationUnlocked` clears *any* `creationLocked` regardless of origin, so the engine
would first need to distinguish who locked it — an authored field on the event, plus a rule that a
player-issued unlock cannot clear a DM-issued lock. Tracked as its own task; it needs a signed-in
campaign to verify, which the session that wrote this had no credentials for.

## Addendum, same day — undo/redo was silently discarding the lock

Recording the lock as an event exposed a path that destroys it. `restoreFrame()` (undo/redo) set
`LOG = _histClone(f.log)` and then called `applyBuild(foldBuild(LOG))`, which **rebuilds the LOG from the
DOM** — a deliberate choice under D5's "build-equality contract". The DOM has no control representing a
`creationLocked` event, so the rebuild dropped it: **one undo un-locked a locked character.** It also
re-emitted the purchases in canonical rather than click order, so the boundary moved.

Measured, building six ability raises in the order CHA, WIS, INT, CON, DEX, STR:

| | order | lock | purchases before the lock |
|---|---|---|---|
| before undo | `CHA,WIS,INT,CON,DEX,STR` | present | 4 |
| after undo → redo (broken) | lost | present | **6** |
| after undo → redo (fixed) | `CHA,WIS,INT,CON,DEX,STR` | present | **4** |

The boundary moving from 4 to 6 means two purchases that had been priced post-lock silently became
creation-priced. `restoreFrame()` now reinstates the frame's LOG verbatim after letting `applyBuild()`
repaint the controls — **superseding D5's DOM-rebuild default for undo/redo only**. This is the same call
`_cgApplyEnvelope()` already makes, for the same stated reason: applyBuild's DOM re-derivation diverges on
anything the DOM cannot represent. A frame is a snapshot of an already-reconciled state, so it needs no
repricing on the way back in.

The remaining order-destroying paths are randomize, the shared `#b=` link, and legacy flat-file import —
all cases where the character arrives whole and no click order ever existed. Tracked as
`feat/randomize-emits-in-order`.

## Related

- `decisions/2026/D-GH-2026-08-05-creation-vs-awarded-ap.md` — its *Outstanding* named removing `noLock`
  as the way to fix this. That is now answered differently, and superseded to say so.
- D-GH34 — the burst mispricing the `noLock` tagging fixed, preserved here.
- D-GH32 — a never-campaign-bound character never auto-locks; honoured by the `armed` check.
