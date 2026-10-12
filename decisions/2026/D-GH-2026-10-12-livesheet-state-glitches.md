# D-GH-2026-10-12-livesheet-state-glitches — Live Sheet Undo steps over appearance-only events; the past view shows no actions or present-day review

Status: **provisional — owner away, taken under standing instruction H2, reversible.** No database change: nothing to apply.

## Context

The 2026-10-12 Live Sheet/CharGen logic audit listed seven state glitches (task `fix/livesheet-state-glitches`). Two of them
hid a design choice:

- **Undo and appearance events (item 6, extended from the #635 review).** #635 made `pactWithAppearance()` insert a NEW
  appearance event at LOG index 0, so new characters are safe. But characters an older Live Sheet edited carry their
  appearance-only, cost-0 patch event at the LOG TAIL. The Live Sheet's Undo popped the tail, so the next Undo wiped hair,
  Backstory and the center panel's playerSheet coins until Redo — and any new action cleared REDO and made that permanent.
- **Needs-review tray while time-travelling (item 5).** `validate()` reads the present LOG (creation-lock state, `loadedRules`,
  purchases no longer in the rules, compute warnings, ignore-player-AP, unnamed spells) while the page shows a past sheet.

## Options

Undo:
- **A. Migrate** the tail event to index 0 on load — rewrites the LOG of live characters on open; a write the player didn't ask
  for, and one that has to survive locked/sealed history. Rejected.
- **B. Undo steps over** cost-0, appearance-only `buy/patch` events (and `rulesSnapshot`, which it already dropped at the tail):
  the target is the last event that is not skipped, removed with `splice`. Redo re-inserts it before the same number of skipped
  tail events, so Undo→Redo restores the exact original order. **Chosen.**
- C. Make appearance events undo barriers — would freeze every purchase made before a description edit. Rejected.

Tray:
- **Hide while scrubbed** (a "viewing the past" note) — chosen as the conservative option.
- Re-run validation against the scrubbed slice — every check would need an `uptoIdx` variant; more code and new ways to be wrong.

## Decision / Why

- Skipped = `type:'rulesSnapshot'`, or `type:'buy', cat:'patch'`, no/zero cost, whose patch has exactly one key, `appearance`,
  and no `dmEdit`. A legacy multi-field CharGen bundle (appearance plus anything else) is a real change and still undoes.
- The engine's `undoFloor()` still decides: skipped events are never barriers (`isUndoBarrier`), so if the last non-skipped
  event is below the floor, Undo is refused exactly as before — and a tail appearance event above a barrier no longer slips
  through as an "undoable" step. `undoFloor() >= sealedFloor()`, so nothing the server protects is ever removed; removing a
  post-floor event from the middle is the same history change, to the server, as removing it from the tail (its triggers
  compare filtered lists of protected projections, and appearance-only events have none).
- Redo's position is kept in a `WeakMap` beside REDO (never on the event, so nothing extra is saved). If the tail has changed
  so the recorded slot is no longer all skippable events, Redo appends, as before.
- Rule logic stays in `js/engine.js`; this is a Live Sheet history-UI rule only and never touches `compute()`.

## Status

Provisional (H2). Reversible by reverting the Live Sheet `undo()`/`redo()` hunk; no data is rewritten.
