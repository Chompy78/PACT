# Session — 2026-07-02 · Two roadmap items: Live Sheet undo bug, iOS Save/Export reliability

*History / non-authoritative. Authoritative state: `docs/PACT_ROADMAP.md`.*

## Goal
User reported two problems from real usage and asked for them to be filed as roadmap tasks: (1) undo
misbehaving in the Live Sheet, and (2) Save/Export not working on iOS, causing lost work. Neither was
implemented this session — both were investigated enough to write a well-scoped `docs/PACT_ROADMAP.md`
entry, then committed directly to `preview` via the `/add-roadmap-task` skill (docs-only, no branch/PR).

## Item 1 — Live Sheet undo bug

The user's initial report ("the floor in the live gender... undo doesn't work properly") was garbled,
almost certainly voice-transcribed. Grepped `tools/PACT-Live-Char-Sheet.html` for `undo` and found a
plausible match: Martially Bound / Magically Bound toggles apply a permanent "−1 AP, floor 1" discount
whose own tooltip text says "reverse only by undo" (lines ~1099, ~1142-1143), while `undo()` itself
(line 797) just pops the last `LOG` entry and re-renders — no special-casing visible for a floored,
permanent discount.

Asked the user to confirm this specific mechanism; the answer was too vague to confirm ("error in the
live sheet"). Rather than guess, filed the task as a general investigation with the floor-1 hypothesis
included as the first lead to check, not asserted as the confirmed cause — the fix must come from
actually reproducing the bug against `compute()`/`rebuildStateFromEvents()`, not from this session's
guess.

Filed as **🔴 NOW** (undo/redo is core to the event-sourced history model — a broken undo can corrupt
derived state, which is a correctness issue, not cosmetic).

## Item 2 — iOS Save/Export reliability

User described the impact in plain terms: Apple users click Save and nothing happens, losing their
character. Asked to brainstorm options before building anything (exploratory question, not a build
request yet).

### Research before recommending
- Found both CharGen and Live Sheet's Save/Export use the classic `Blob` + `<a download>` trick
  (`tools/PACT-Live-Char-Sheet.html` lines 804-805, 1866; CharGen equivalents). This pattern is known to
  be unreliable in iOS Safari and especially inside an installed iOS PWA — it often just opens the raw
  JSON in a new tab instead of triggering a save, because iOS Safari doesn't expose the same
  silent-write-to-disk capability desktop/Android browsers do (a deliberate sandboxing choice, not a bug
  to route around).
- Identified the Web Share API (`navigator.share` with a `File`) as the right fix for iOS: it hands off
  to the native share sheet (Save to Files, AirDrop, Mail), which iOS has supported reliably since
  iOS 15. `showSaveFilePicker`/File System Access API was ruled out — Safari doesn't implement it at all.
  Recommended detecting capability (`navigator.canShare({files:[...]})`) rather than sniffing user-agent,
  and leaving the existing download-link path untouched on desktop/Android where it already works —
  explicitly recommended *against* forcing one unified behavior across all platforms, since the
  share-sheet would only add a needless extra tap on platforms where the direct download already works.

### Severity investigation — found an important asymmetry
Before filing the task, checked whether "Save fails" actually means "character is lost," since that
framing drives priority and scope:
- **Live Sheet auto-saves to `localStorage` on every action** (`save()`, line ~802) — confirmed via
  grep. A failed Export does not lose the character immediately; it only blocks backup/transfer/sharing
  with a DM.
- **CharGen has no such autosave** — grepped for `localStorage.setItem` writing any character-data key
  and found none; only the theme preference persists. Export is CharGen's *only* persistence mechanism.
  A silently-failed Export there is total, permanent loss the moment the tab closes or refreshes.
- Also flagged, as a reinforcing (not primary) point: iOS Safari's Intelligent Tracking Prevention is
  documented to purge script-writable storage after ~7 days of no interaction with a site — so even Live
  Sheet's `localStorage` safety net isn't permanent on iOS, which is an argument for still fixing Export
  there even though the immediate-loss risk is lower than CharGen's.

Surfaced this asymmetry to the user before finalizing the task and asked whether to split it into two
roadmap items or keep one combined item with CharGen's severity called out explicitly. User chose the
combined version (recommended option) — kept as one task, but wrote CharGen's no-fallback-persistence
gap as the higher-priority half inside it, and added a new requirement not in the original ask: CharGen
should also gain a minimal `localStorage` autosave of the in-progress build (mirroring Live Sheet's
existing pattern) as a safety net independent of Export ever working.

Filed as **🔴 NOW**, placed directly after the PWA stale-version task at the top of that bucket.

## Outcome
Both items are now in `docs/PACT_ROADMAP.md`'s 🔴 NOW bucket, committed directly to `preview`:
- `0d972c6` — Live Sheet undo bug (investigation-scoped, floor-1 discount as the lead to check first).
- `6fe135d` — iOS Save/Export reliability (Web Share API + capability detection + CharGen autosave
  safety net), branch `fix/ios-save-export-reliability` reserved for whoever picks it up.

Neither was implemented this session — no code was touched, so `engine-parity.html` was not re-run.
