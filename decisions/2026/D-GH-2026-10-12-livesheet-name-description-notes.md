# D-GH-2026-10-12-livesheet-name-description-notes — notes move into the LOG as appearance sub-keys, one shared appearance writer, one-time copy-in

Status: **provisional — owner away, taken under standing instruction H2, reversible.** The owner chose the deep fix (A2) on
2026-10-12; the sub-decisions below (Q1–Q7) were taken by the implementing agent, each picking the most conservative option.
No database change: nothing to apply.

## Context

Owner report 2026-10-12: "I cannot change the name and see the description when I should be able to." The audit found the
server and every lock/seal/campaign state allow both; the bugs were UI placement and per-device storage:

- Rename existed only in the Live Sheet's "🛠 DM tools" strip (off-screen on phones), untrimmed, blank accepted.
- The Live Sheet never showed `b.appearance` (CharGen writes 32 keys; the Sheet showed 16).
- Player Name, Alignment, Background/Other, Allies and Backstory & Notes were `csSave()` scratch in
  `localStorage['pactCharSheetManual:<tool>']` — per tool and per device, never in the LOG or the cloud.
- Found while planning, and worse than the task said: CharGen's Setup-panel appearance edit and 🎲 Randomise rebuilt
  `appearance` from its 32 DOM controls only, so the first edit **silently wiped** the Live Sheet's center-panel sheet
  (`appearance.playerSheet`, #630) — a live data-loss bug. The Live Sheet's own appearance writer dropped CharGen's `_slot`
  tag (so CharGen's edits were then shadowed or duplicated) and appended at the tail when there was no appearance event,
  where the next Undo popped it and wiped every appearance field.

## Options (data shape)

- **New top-level patch keys** (`patch.notes` …) — refused by the server after a lock: the freeze is fail-closed on field
  names (`pact_patch_exempt_keys()` = appearance, houseRules, gold). Would need a migration and an advisor run.
- **Sub-keys of `appearance`** — the whole `appearance` field is exempt, so any sub-key is editable in every state.
  No migration. Chosen.
- A namespace (`appearance.system_data.*`) — rejected in cold review triage: no collision with the 32 CharGen keys or
  `playerSheet`; flat keys match the existing convention.

## Decision

1. Keys `playerName`, `alignment`, `background`, `allies`, `backstory` inside `b.appearance` (`backstory`, not `notes`, to
   stay clear of `playerSheet.notes`). Map in `js/ui-helpers.js` `PACT_SHEET_LOG_FIELDS`. Absent key = never migrated;
   `''` = the player cleared it.
2. **One writer**, `pactWithAppearance()` in `js/ui-helpers.js`, used by both tools: rewrite only `payload.patch.appearance`
   of the LAST appearance-carrying event in place (keeping seq, cost, label, `_slot`, every other patch key), or, when there
   is none, insert a new appearance-only event at **LOG index 0**. CharGen's `_cgSyncPatchSlot(APPEARANCE)` merges the DOM's
   32 keys over the folded appearance, so non-DOM keys are carried; Randomise re-applies them (same character).
3. **One-time copy-in** of existing local values (`pactNotesCopyInPlan()`), from either tool's bucket, after render, for keys
   the LOG lacks. Not an undo step; never in the DM read-only view, a CharGen DM copy, or while time-travelling.
4. Live Sheet: ✎ Rename on the character card and on the Sheet's Character Name; a read-only "Appearance & description"
   block on the Character panel showing every appearance key (escaped, read from `foldBuild(idx)`).

### H2 sub-decisions (provisional)

- **Q1** Two different local values (CharGen vs Live Sheet on one device) → **keep both, joined** (`"A / B"`, or a labelled
  paragraph separator for textareas), current tool first. Never pick one: no data is dropped.
- **Q2** Delete the local scratch after copy-in → **no**. Kept for rollback/manual recovery; the five fields stop reading it.
- **Q3** A player may name a character "… (DM copy)" → **no**, refused in the Live Sheet (reserved for DM snapshots; it
  triggers CharGen's DM-copy banner).
- **Q4** Inline-editable Sheet name field → **no**, a ✎ button (one `name` event per rename, not per keystroke; the async
  duplicate-name guard runs once).
- **Q5** DM Console shows the new notes → **not in this change** (follow-up).
- **Q6** Collapse duplicate appearance events already in live data → **no**. Removing one could shrink the server-protected
  list if it is a bundle; the fold only reads the last, which is what the writer targets.
- **Q7** Make the 16 extra CharGen appearance keys editable on the Live Sheet Sheet → **no** (read-only panel shows them all;
  editing stays in CharGen). Smallest Live Sheet hunk while another session works on that file.
- **D1 (review of PR #635)** Reset and an id-less import must not re-import stale device-local notes. The local scratch is kept
  (Q2) and Reset keeps the character id, so the copy-in brought frozen pre-migration values back into a freshly wiped
  character (probe: "NEW story v2" → after Reset "OLD pre-migration story") and pushed them. Two layers:
  (a) Reset and an id-less import write the five keys as `''` — present means "cleared", so the copy-in skips them;
  (b) an imported file with **no id** now mints a **fresh id** instead of inheriting the previous character's. Verified before
  the fix: it kept the previous `__charId`, so the next cloud push overwrote the PREVIOUS character's row with the imported one.
  This matches CharGen, whose `applyBuild()` already does `__charId=(b&&b.id)||genCharId()`. The existing "don't import over a
  sealed character" refusal for id-less files is left as it is (it is now merely stricter than needed).
- Rename-guard exemptions now match the server's unique index exactly (`'new character'`, `'character'`, `'… (dm copy)'`).

## Why

- **Index 0, proved server-safe.** Every server check on `characters` compares filtered lists or sums, never absolute LOG
  indices: `pact_ap_ledger_protected()` (the protected projection list), `pact_lock_family()` (creation-lock guard),
  `pact_ap_ledger_spend()` (budget), award sums (player AP ceiling). An appearance-only event projects to NULL, so it joins
  none of them. Proved on real Postgres in the Docker harness (`testing/scripts/creation-lock-guard-test/run-freeze.sh`,
  five new `notes:` cases in `freeze-cases.sql`): inserting at index 0 is **allowed** for a LOCKED, a SEALED and a
  locked+sealed+awarded campaign character at stage 1 and stage 2; adding the new sub-keys to a pre-lock mixed
  (hd + appearance) event is allowed; and a new top-level `patch.notes` key is still **refused** — why the fields are
  sub-keys. No `LOG[0]`/seq-sort dependency in `js/` or the tools (grepped). A JS port of the projection in
  `testing/scripts/appearance-notes-ci.mjs` checks the same for the writer's actual output.
- **Not the tail**: the Live Sheet's undo pops the tail, so an appended cost-0 appearance event becomes the undo target.
- **In place, last event**: matches the fold (last writer wins), keeps a bundle's protected projection byte-identical, and
  never moves a line in the ledger.
- **CharGen commits the Sheet fields on blur, not per keystroke**: CharGen's `render()` rebuilds an open Sheet; the rebuild
  now puts the focus/caret back, a field still being typed in is flushed on `pagehide`/hidden, and a render mid-typing carries
  the uncommitted text across.

## Status

Provisional (H2), reversible: the writer and copy-in are client-only; the old local scratch is untouched, so reverting the
client restores the old behaviour with nothing lost. Known limitation: a second device whose local value differs from one a
first device already copied in is not merged (the key is present); its scratch stays in localStorage. Follow-ups: DM Console
display of the notes (Q5); the remaining device-only Sheet fields (HP / Temp HP / Hit Dice left — a separate LATER task).
