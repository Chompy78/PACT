# Plan — stored character size stops lying (`fix/stored-size`)

Date: 2026-10-11 · Status: implemented; data correction applied to live 2026-10-11 · Decision ID: `D-GH-2026-10-11-stored-size` · Owner choice: I3

## Goal
A character's saved data must not say "Small" when the character is Medium. Anything that reads the raw database (another
AI session, a report, a future feature) currently gets the wrong size for most characters.

## Context (self-contained)
- PACT is a vanilla-JS tabletop-RPG tool suite. Characters are saved as an event log (`stats.LOG`); the build is folded from it, and
  derived values (HP, AC, **size**) come from one rules engine, `js/engine.js` `compute(build)`. Rule: never store derived values.
- Size rule (in `compute()`): only Halfling, Gnome and Tiefling combinations can be Small or choose; everyone else is Medium, and
  `compute()` IGNORES the stored `build.size` unless the size is choosable. All tools display `compute().size`.
- The character generator (CharGen) has a size dropdown that is hidden when size isn't choosable — and is deliberately parked at
  "Small" while hidden. Saving reads that hidden dropdown, so every non-choosable character stores `size: "Small"` in two patch events
  ("Character size" and "Identity").
- Server "freeze": once a character is creation-locked, session-sealed or awarded, the history UP TO that point may not be rewritten
  (a trigger compares the protected events before/after). Events APPENDED after it are allowed (that is how in-play purchases work).
  Size is a protected field, so rewriting the old events in place is refused; appending a new event is not.
- Live data (measured 2026-10-11 by running the real engine over every row): 37 characters; **23 store "Small" while the engine says
  Medium**, all non-choosable (placeholders, not choices); 12 of the 23 are locked/sealed, 6 campaign-bound (real players' characters),
  1 archived. 0 engine errors. 6 rows store no size at all.

## Verified vs. assumed
Verified: the 23 count and list (engine run on live logs); the freeze trigger only refuses shrinking/rewriting the protected prefix
(read its full source); all three tools display `compute().size`. Assumed: no code path reads the stored size directly when it isn't
choosable (grep found none); appending a 0-AP size patch has no AP/budget effect (patch events are excluded from spend sums).

## Proposed approach
1. **Engine:** extract the size rule from `compute()` into an exported `sizeOf(build) -> {size, choosable}`; `compute()` calls it.
   No behaviour change; parity fixtures unchanged; no `DATA.version` bump (no rules change).
2. **CharGen write path:** when reading the form into a build, if `sizeOf(build).choosable` is false, store `sizeOf(build).size`
   instead of the hidden dropdown's value. The dropdown's on-screen behaviour (hidden, parked at Small for a later Gnome) is unchanged.
3. **One-off data correction** for the 23 rows: append ONE event per character — `{type:'buy', cat:'patch', cost:0,
   payload:{patch:{size:'Medium'}}, label:'Size corrected to Medium (stored value was a placeholder)', systemEdit:true}` with the next
   `seq` and `SEQ` bumped. Run as a migration-style admin SQL with the exact id list, guarded: only if the row's last stored size is still
   "Small", run inside one transaction, re-measured immediately before. Row backups are taken automatically by an existing trigger.
   No freeze change and no new server function (the I3 "DM function" proved unnecessary — appends already pass the freeze).
4. Tests: a CharGen browser check (a Human saved after the fix stores Medium; a choosable Gnome+Human still stores the player's choice);
   `engine-parity` 0 failed; a check that `sizeOf` and `compute().size` agree for every species pair.

## Out of scope / alternatives
- Rewriting the old events in place — refused by the freeze, and would falsify history. Rejected.
- Removing `size` from saves when not choosable — older saves still carry it; doesn't fix raw readers. Rejected.
- Documentation only ("ignore stored size") — readers that skip the note still get it wrong. Kept as an addition, not instead.

## Risks
- A player's stale browser tab saving afterwards could drop the appended correction (the freeze allows dropping post-lock events).
  Harmless — the engine never used it — and step 2 makes the next save from CharGen store the right size anyway.
- Writing to real players' saves: one 0-AP event each; measured list; guarded by the expected old value.

## Verification
Before: 23 mismatches. After: re-run the same engine scan → 0 mismatches, 0 errors, every row's `compute()` output (HP, AC, AP totals)
identical before and after. `engine-parity` 0 failed; tool-pricing and CharGen browser suites pass.

## Reviewer instructions
1. First line: your model name/version. 2. Judge logic, scope, risk — not code you can't see. 3. Answer: Does this achieve the goal?
Shaky assumptions? Better alternative? What's missing (especially anything that could change a character's play numbers, or a reader
that still sees "Small")? Is the verification objectively checkable? Split? 4. Output Markdown named `stored-size-review-<model>.md`.

## Review outcome
Two API reviewers, 2026-10-11 (`docs/plans/cold-reviews/2026-10-11-*-stored-size.md`):
- **Both** (Gemini `gemini-3.1-flash-lite`, self-ID wrong as GPT-4o; nemotron, self-ID correct): a raw reader taking the FIRST size
  event still sees "Small". **Accepted → doc-note:** AGENTS.md's data rule now says fold/compute, last patch wins, `size` is the trap.
- Gemini: state the rollback. **Accepted:** one statement, aborts unless exactly 23 rows change, automatic row backups.
- Gemini: add a "migrated" schema flag. **Rejected:** the event's label + `systemEdit` already mark it; nothing would read a flag.
- nemotron: validate in the save path so every tool is covered. **Checked:** the Live Sheet never writes `size`; CharGen is the only
  writer, and step 2 is exactly that validation.
- nemotron: null out the stored field instead. **Rejected:** rewriting sealed history (refused by the freeze) and no help to readers.
- nemotron: a `getLatestSize()` helper. **Rejected as a new function:** `sizeOf(foldBuild(LOG))` is that helper; the note names it.
Result as applied: 23 → 0 mismatches; all 37 characters' play outputs identical before/after.
