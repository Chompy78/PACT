# D-GH-2026-08-19-award-drawback-double-subtract — a character lost 4 AP on every open

**Status:** FIXED · display/plumbing only, no `DATA.version` bump · **this was a live data-loss bug**

## The report

> *"each time i open moss stormspud from the DM screen in chargen or refresh, the AP budget decreases
> by 4."*

Moss has exactly **4 AP of drawbacks**. Reproduced immediately, and it compounds without bound:

```text
open 1  award 79 -> 75      spendable 79
open 2  award 75 -> 71      spendable 75
open 3  award 71 -> 67      spendable 71
open 4  award 67 -> 63      spendable 67
open 5  award 63 -> 59      spendable 63
```

Every open rewrote the character's own award event lower and saved it. This is not a display fault —
**the character's stored log was being edited downward, permanently, once per open.**

## Cause — a correct fix that v0.355 turned into a bug, in two places

`D-GH41` established that `b.budget` was the **combined** figure (`economy().earned` = awards +
`drawbackEarned`). Writing that combined total back as a raw `award` event double-counted the drawbacks,
because the drawback buy events in the LOG contribute their own AP on every fold. So two sites correctly
subtracted the drawback total back out before emitting the award:

- `_cgSyncAward()` — runs on **every** autosave-restore, file load and switch-tool handoff.
- `_buildEventBurst()` — runs on **every** whole-build regeneration.

**v0.355 moved that split into the engine.** `foldBuild()` now sets `b.budget = earned − drawbackEarned`,
i.e. awards only, and `compute()` derives the grant from `b.drawbacks`. Both subtractions were left in
place, and each became a **second** subtraction of the same number.

`applyBuild()` sets the `#budget` field from `b.budget`, so the loss fed straight back in: field 79 →
award 75 → next fold's `b.budget` 75 → field 75 → award 71.

## Fix

Both sites emit `b.budget` / `val('budget')` unchanged. The invariant, stated at both sites so the next
reader cannot re-derive the old one: **`b.budget`, the `#budget` field and the award event's amount are
all the raw award now. No conversion belongs anywhere on this path.**

## Why nothing caught it

Every gate opened a character **once**. `chargen-flows` loads and asserts; `tool-pricing-ci` loads and
asserts; parity folds a fixture and prices it. Nothing exercised **load → regenerate → reconcile more
than once**, which is the only way an idempotence failure shows itself.

`tool-pricing-ci` now runs that cycle five times on a character with drawbacks and asserts the award
event and spendable total are unchanged (148 → **150**). The fixture deliberately has a non-zero drawback
total, so a re-introduced subtraction cannot hide behind the two figures being equal.

Confirmed to bite: restoring either subtraction reproduces `79 79 79 79 79` → `79 75 71 67 63`.

## Damage already done

The fix stops the drain; it does **not** restore AP already lost. Any character with drawbacks that was
opened in CharGen while v0.355 or v0.356 was live has lost `drawbackAP × (number of opens)` from its
award event. Moss is the known case. Affected characters need their award corrected by hand or by a DM
award — there is no safe automatic repair, because the log records no distinction between AP lost to this
bug and AP a DM legitimately adjusted.

## Scope

Introduced by v0.355 (PR #424) and live on `main` from that promotion until this fix. It affects only
characters **with drawbacks**, and only via CharGen — the Live Sheet does not run either code path.
