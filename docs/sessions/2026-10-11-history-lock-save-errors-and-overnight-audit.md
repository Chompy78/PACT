# 2026-10-11/12 — "Not saved — history is locked" on Wren, deleted characters coming back, overnight tool audit, release v1.624

PRs: #619, #620, #622, #623 into `preview`; promotion #624 → `main` (build `v1.624`, tag `v1.624`, rules `v0.375` from #617).
Decisions: `D-GH-2026-10-11-patch-fold-aliasing`, `D-GH-2026-10-11-sync-no-resurrect`.

## What the owner reported

Editing Wren Ashdown Ch8-12 (a CharGen-built, locked, sealed campaign character) in the Live Sheet: every save refused with
"Not saved — part of this character's history is locked on the server". Later narrowed to "when I select armour" — buying Light armour
training.

## How it was found

- Postgres logs: `PACT: locked character history cannot be rewritten (protected event 9 changed)`, every attempt.
- Item 9 of Wren's protected projection = LOG #12, the creation `Armour` patch (`light:false`).
- The device's stored copy matched the server exactly, so the bad payload existed only in memory at save time.
- Browser reproduction with Wren's real LOG (both tools, DM AP injected — without it the buy is refused for lack of AP, which hid the
  bug in the first two attempts): the tools append a correct `armour` buy, and the creation patch flips to `light:true`.
- Cause: `MUT.patch` = `Object.assign(b, p.patch)` — shallow, so the build's nested objects were the event's own. Every in-place MUT
  (armour, abil, list pushes, spell rank/slot/known/cantrip, freesub) wrote back into the stored patch on each fold.

## Live data

- Scan of 37 characters: only Archer already had a creation patch altered (Spellcasting carries three later buys). AP, frozen costs and
  build unaffected; left as is (would need a protected-event rewrite).
- Wren's "only 94 DM AP" was a display moment before campaign data loaded; server `ap` was 130 throughout; it later showed 142
  (130 DM + 12 drawback).

## Second bug, found from the same logs

~20 refused INSERTs per page load from the owner's browser: `reconcile()` re-uploaded every local record the server didn't have. On that
device 39 such records: 33 `noteEdit()` placeholders `{id, editSeq}`, 6 adopted-blank rows purged by the 2026-10-10 blank-row job, and a
deleted 35-event Bram Cotter Ch8-12 copy that was re-inserted but for the unique-name rule. Fixed in #620 (owner D2).

## Overnight audit (owner asked; Haiku subagents, local only, no sign-in)

- Real-data engine sweep: 35 characters × 43 MUT categories + pairs = 1,645 runs, 0 history rewrites with the fix; 853 with the old
  `MUT.patch` (harness sanity check).
- CharGen: 560 controls exercised pre-lock; 531 post-lock actions on a campaign character, 0 protected-prefix violations; save/reload
  identical.
- Live Sheet: 6 real characters + blank, ~35 purchase kinds each, undo/redo exact, sealed prefix never changed, no page errors.
- Fixed from the audit: Live Sheet had no viewport meta (#622); `_csCopy()` reported success on a refused clipboard write (#623).
- Rejected: "post-lock Budget change moves the award past the lock" on a SOLO character — by design (`_cgLockFloor()` comment: the server
  freezes only campaign characters), no refusal path.

## Open — for the owner (not added to the task board: `/add-code-task` needs approval)

1. "Worn armour — none (unarmoured)" still gets the best OWNED armour's AC (`compute()` falls back to legacy auto-pick when `wornArmour`
   is empty). Changing it changes AC for existing characters — a rules decision.
2. Suspected, unconfirmed: one CharGen skill tick added 2 events and undo did not revert it, seen once in a fast automated walk; an
   isolated repro was clean.
3. Cosmetic: at 390 px the Live Sheet's AP badge overlaps the header title.
4. Archer's creation Spellcasting patch stays altered (history view only).
