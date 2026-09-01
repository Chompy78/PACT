# D-GH-2026-09-01-undo-barrier-shared — one undo-barrier rule for both player tools

**Status:** Implemented · branch `claude/everything-on-main-kx82ur` · **step 1 of 2** — the groundwork
for a DM-triggered per-session history seal, which is deliberately NOT in this change (see
*Deferred*, and the `feat/session-seal` task on `docs/TASK_BOARD_NEXT.md`).

## Context

The owner asked what happens to undo when a DM awards AP, whether it applies to both sheets, and
whether drawbacks stop being purchasable past the creation lock. Answering it turned up that the rule
"this part of the history can no longer be taken back" had been hand-written **three times**, once per
tool, and that two of the three copies were wrong — in different directions, for the same character.

**What was actually true before this change:**

| Award path | Writes to the LOG? | Blocked undo in Live Sheet | Blocked undo in CharGen |
|---|---|---|---|
| DM Console → "Award AP" (`award_ap` RPC → `characters.ap`) | **No** | No | No |
| Live Sheet's own "+ Award AP" button | Yes, `{type:'award'}` | **Yes** | **No** |
| DM Console → grant a boon (`dm_edit_character_log`) | Yes, `[buy, award]` | **Yes** | **Yes** |

Two defects fall out of that table:

1. **CharGen's barrier was half the Live Sheet's.** Its `undo()` checked only `dmEdit`, while the
   comment directly above it claimed to "mirror the Live Sheet's award-event undo barrier". It did not.
   A plain `award` event — a redeemed grant code (`PACT-Live-Char-Sheet.html`, grant redemption), or the
   itemised DM awards a **clone** migrates into its log — was an absolute barrier in one tool and freely
   undoable in the other. Since D-GH40 gave both tools one save envelope, that is one character with two
   answers, not two populations.
2. **`creationLocked` was not a barrier in either tool.** `finishCreating()` / `cgFinishCreating()` both
   tell the player, in the confirm dialog they must accept, *"Only your DM can reopen creation
   afterwards."* That was false: the event is neither `award` nor `dmEdit`, so one Undo click popped it
   straight back off and reopened creation. CharGen had already been bitten by a **different** route to
   the same end (`applyBuild`'s DOM rebuild dropping the event, fixed earlier and commented at
   `restoreFrame`); the undo-pop route was never covered.

Worth recording because it was checked and is **not** a defect: drawbacks remain fully purchasable and
selectable after the creation lock, in both tools, by design. `wouldExceedCeiling()` returns false for
`cost <= 0` ("a drawback must never be refused by the ceiling it raises") and false outright once
locked; the Live Sheet's `buy()` skips the AP-availability check for `cat==='drawback'`; CharGen
disables a drawback checkbox only for a `DATA.drawbackMaxStats` stat cap, a `DATA.drawbackReq`
caster-only requirement, or a DM/campaign ban. The ceiling's drawback half is deliberately live rather
than snapshotted (owner decision G2) precisely so a drawback hands back the room it paid for.

## Options

- **A1 — one shared rule in `js/engine.js`, both tools ask it.** *(chosen)*
- **A2 — patch the two broken spots where they sit.** Smallest diff; leaves three hand-written copies of
  one rule, which is the arrangement that produced both defects in the first place.
- **A3 — fix only the `creationLocked` gap.** Leaves the CharGen/Live Sheet award asymmetry standing, in
  which case the comment claiming they mirror each other has to be rewritten to say they don't.

## Decision

A1. `js/engine.js` gains `isUndoBarrier(event)` and `undoFloor(events)`; both tools call `undoFloor`
through their existing `engine-ready` window bridge. Barriers are: any `dmEdit` event, any `award`
without `disc`, and `creationLocked`. A discretionary award (`disc:true`, the Live Sheet's
"+ Discount") stays exempt — it is an in-play top-up a DM may well want back.

**Exported as a FLOOR, not a predicate, and that shape is load-bearing.** The Live Sheet pops one event
off the tail, so a per-event "may I pop this?" test happens to behave like a floor there. CharGen's does
not: its undo restores whole earlier **snapshots** of the log, so a frame captured before a barrier
arrived — a DM edit syncing down mid-session is the live case — jumps clean past the barrier and takes
it, and everything under it, with it. A count of locked leading events is the one form that answers both
tools, and it is also the form step 2's seal needs.

CharGen's guard therefore compares the **target frame's** floor against the live log's, rather than
testing the tail; `_sealOpenGroup()` moved above the check so the frame being judged exists by then.

## Why

- The failure mode is silent. Nothing crashes when an undo barrier is too weak — a player just quietly
  erases something their DM did, and nobody finds out until the numbers disagree at the table.
- `AGENTS.md` already names this exact pattern as "the drift shape this project keeps paying for": a
  canonical rule with hand-written mirrors in the tools that quietly keep the old behaviour. Two of
  three mirrors had already drifted here, and one of them carried a comment asserting it hadn't.
- Purely a history rule. It reads no prices and never touches `compute()`, so it cannot move a
  character's AP — which is why `DATA.version` is **not** bumped (display/behaviour only, no mechanics
  change) and `testing/expected/` needs no update.

## Deferred — known gaps this change does NOT close

Recorded explicitly so the next session does not mistake them for oversights:

1. **The DM Console's "Award AP" still cannot lock anything**, because it writes to the `characters.ap`
   column and never to the character's history. This is the single biggest reason the owner's actual
   request ("each session, a lock goes in, triggered by me awarding AP") is not yet met.
2. **Un-ticking a checkbox in CharGen deletes the purchase from the log outright** —
   `retractFlatEvent()` splices the entry out mid-log, with no undo involved and no barrier check on
   that path at all. A lock wired only to the Undo button leaves every checkbox live, so *"anything
   already bought can't be unselected"* is not yet true.
3. **Whole-build replacement paths** (🎲 Randomise, file load, applyBuild) rebuild the log from the DOM
   and can therefore drop barrier events. Same family as (2), pre-existing, and step 2's to close.
4. A seal can only ever apply to **campaign-bound** characters: only a DM can write a server-stamped
   `dmEdit` event, so a purely local character has nobody to authorise one.

## Verification

- `node testing/scripts/engine-parity-ci.mjs` → **0 failed** (73 passed).
- `node testing/scripts/tool-pricing-ci.mjs` → **0 failed** (184 passed), including the pre-existing
  "CharGen — a DM edit locks history the same way it does in the Live Sheet". One earlier run reported a
  `harness — CharGen never became ready` readiness flake; it did not reproduce.
- `node testing/scripts/undo-barrier-ci.mjs` → **0 failed** (19 passed) — new, committed with this
  change. Covers the predicate, the floor, and CharGen's snapshot guard.
