# Phase 2 Step 4 — CharGen undo/redo + event-log persistence (plan)

> **Status:** DRAFT — for cold review before implementation.
> **Branch:** `feat/chargen-undo-persist` (from `preview`, post-emit-migration merge / PR #137).
> **Scope:** `tools/PACT-CharGen-Webtool.html` only. No `js/engine.js` change, no `DATA.version` bump.
> **Prereq (DONE):** Step 3 — CharGen is event-sourced; `readBuild() = foldBuild(LOG)` with `name`/`budget`
> as documented DOM-backed shims. The LOG mutation API (`emit`, `retractFlatEvent`, `replacePatchSlot`,
> `replaceWholeLogFromBuild`) is the only code allowed to change `LOG`. `applyBuild(build)` is the
> canonical whole-build → full-DOM-resync primitive (writes every form control, then rebuilds LOG from the
> DOM via `replaceWholeLogFromBuild(_domReadBuild())`).

## Background for a reviewer with no repo access
*(You are judging plan quality, not code — you have no access to the files. Here is everything you need.)*

**What PACT/CharGen is.** A static, vanilla-JS tabletop-RPG character builder — one big HTML file
(`PACT-CharGen-Webtool.html`) with inline `<script>`. No frameworks, no build step. A "build" is a plain
JSON object describing a character (species, class, stats, chosen skills/feats/spells, etc.). A shared
rules engine (`engine.js`) exposes `compute(build)` → AP cost + warnings, and `foldBuild(events)` → replays
an event log into a build.

**Event-sourcing (just finished, Step 3).** CharGen used to keep character state in the DOM (the form
controls *were* the truth). Step 3 flipped it to an **append-mostly event LOG**: every user action produces
an event, and `readBuild() = foldBuild(LOG)` — the LOG is now the source of truth. Two exceptions remain as
deliberate "shims": the character **name** and **budget** (starting AP) are still read straight from their
input fields, not the LOG (folding them in is Step 5).

**The four functions that may change the LOG** (nothing else touches it directly):
- `emit(ev)` — append one event (e.g. tick a skill). *Append-only.*
- `retractFlatEvent(cat, pred)` — **remove** a matching event from the middle (e.g. untick a skill).
- `replacePatchSlot(slot, patch, label)` — for scalar/grouped fields (stats, armour, languages…): **drops
  the slot's previous event and appends a fresh one** (so a field only ever has one current event). Called
  on **every keystroke** of a text field.
- `replaceWholeLogFromBuild(build)` — **throw away the whole LOG and rebuild it** from a build. Used on
  file load, reset, randomize.

**`applyBuild(build)`** is the one function that writes a whole build into *every* form control and then
calls `replaceWholeLogFromBuild(_domReadBuild())` to resync the LOG from what it just wrote. It is the
canonical "repaint the entire UI from a build" primitive. Critically, the normal per-edit `render()` does
**not** repaint form controls (that would disrupt typing) — only `applyBuild` does a full repaint.

**Live Sheet** is CharGen's sibling tool (actual-play tracker). Its LOG is *pure append-only*, so its
`undo()` is literally `REDO.push(LOG.pop())`. It persists as `{LOG, SEQ, rules, id}`. CharGen currently
persists a *flat build object* instead. Step 4 aligns CharGen's persistence toward the Live Sheet's shape
and gives it undo/redo — but CharGen's non-append-only LOG means it **cannot** reuse the pop-based undo.

`canonicalBuild(b)` (already exists) normalises a build for equality checks (sorts unordered arrays, treats
missing/null/empty as equal) — used in the verification invariants below.

## Goal (plain English)
Give CharGen the same trustworthy history the Live Sheet has: **Undo / Redo** buttons that step through
edits, and **file/autosave persistence in the event-log shape** (`{LOG, SEQ, rules, id, schema}`) so a
CharGen character is stored as *what the player did*, not a derived snapshot. The tool's visible layout and
existing flows stay unchanged except for two new toolbar buttons (Undo/Redo) and one small "N steps"
affordance.

## Why CharGen's undo cannot copy the Live Sheet's
The Live Sheet's `LOG` is **pure append-only** — `emit()` only ever pushes, so `undo()` is a single
`LOG.pop()` onto a REDO stack. CharGen's `LOG` is **not** append-only:
- `replacePatchSlot(slot,…)` **filters the slot's prior event out and appends a new one** (coalescing).
- `retractFlatEvent(cat,pred)` **splices** an event out of the middle.
- `_cgReconcileChecklistDependents()` retracts *several* events in one user action.
- `replaceWholeLogFromBuild()` **replaces the entire LOG**.

So "the last event" is not a meaningful unit to pop. Undo in CharGen must restore a **whole-LOG
snapshot**, and — because after the Chunk-6 flip `render()` deliberately does **not** repaint form controls
(to keep typing undisrupted) — it must also **resync the DOM** so the next edit reads correct control
state. `applyBuild(foldBuild(snapshot))` already does a full DOM resync; we build undo on that primitive.

## Design decisions (the parts a reviewer should scrutinise)

### D1 — Snapshot-based history, not event-pop
`HIST` and `REDO` are arrays of **immutable history frames**. A frame captures everything needed to
restore an editing state:
```
frame = { log: <deep clone of LOG>, seq: SEQ, name: <#cname value>, budget: <#budget value> }
```
`name`/`budget` are captured because they are DOM-backed shims (Step 5 will fold them into the LOG; until
then they are real user-editable state that `foldBuild` does not carry). Deep-clone via
`JSON.parse(JSON.stringify(LOG))` — LOG events are plain JSON already.

### D2 — One central choke point: `commitHistory(coalesceKey?)`
Every mutation currently calls the LOG API then `render()`. We introduce a single function the mutation
paths call **before mutating**:
```
commitHistory(coalesceKey)   // push current frame onto HIST, clear REDO — subject to the coalesce rule below
```
Rather than sprinkle calls across dozens of handlers, we wrap the **four** LOG-mutation API functions
(`emit`, `retractFlatEvent`, `replacePatchSlot`, `replaceWholeLogFromBuild`) so each snapshots *the state
as it was before this call* into HIST. This is the same "one delegated choke point, not N call sites"
discipline used across Step 3. `replaceWholeLogFromBuild` is special-cased (see D4).

### D3 — Edit coalescing (the crux)
`onPatchFieldChange` fires on **both `input` and `change`**, so a text field emits a `replacePatchSlot`
per keystroke. Without coalescing, "type a 12-char name" would be 12 undo steps. Rule:
- Each history push carries a `coalesceKey` (for patch slots, the key is the slot id + field id; for
  checkbox/flat/reconcile actions the key is `null` = never coalesces).
- If the **immediately-previous** HIST frame was pushed with the **same non-null key** within a short
  idle window (`COALESCE_MS`, ~600 ms) **and** no other action intervened, **do not push a new frame** —
  the in-progress frame already represents the pre-edit state, so the whole burst of keystrokes collapses
  to one undo step. A blur/`change`, a different control, or the idle timeout "seals" the current
  coalescing group so the next edit starts a fresh frame.
- Discrete actions (checkbox toggle, add/remove row, tradition edits, load/reset/randomize) always pass
  `coalesceKey = null` → always their own undo step.

*Reviewer note:* the coalescing key must be derived from the **field**, not the value, so that editing the
same field repeatedly coalesces but tabbing to a different field does not.

### D4 — Whole-LOG replacement (`applyBuild`, load, reset, randomize) = a single, non-coalescing step
`applyBuild` ends by calling `replaceWholeLogFromBuild(_domReadBuild())`. We must **not** let the many
intermediate LOG nudges `applyBuild` makes while writing the DOM (add-row/add-disc fire mutations
mid-write) each create undo frames. Approach: a re-entrancy guard `_histSuspended`. `applyBuild` sets it
around its body; while suspended the wrapped mutation API skips `commitHistory`. `applyBuild` then pushes
**exactly one** frame representing the pre-load state (so a load/reset/randomize is a single undoable
step). Boot-time restores (`_cgBoot`, autosave restore, shared-link) suspend history *and* do not push a
frame and then **clear** HIST/REDO — you cannot undo "before the character existed".

### D5 — Undo / Redo semantics
```
undo(): if !HIST.length return;
        REDO.push(currentFrame()); restoreFrame(HIST.pop());
redo(): if !REDO.length return;
        HIST.push(currentFrame()); restoreFrame(REDO.pop());
```
`restoreFrame(f)`: set `LOG = f.log` (clone), `SEQ = f.seq`, then **resync the DOM** by calling
`applyBuild(foldBuild(LOG))` **with history suspended and with name/budget overridden from the frame**
(applyBuild otherwise reads name/budget from the build, which foldBuild leaves stale/empty). Net effect:
LOG restored, every form control repainted to match, name/budget preserved, no new history frame, autosave
written. This reuses the single most-exercised resync path in the file rather than inventing a second one.

*Reviewer note / risk:* `applyBuild` calls `replaceWholeLogFromBuild(_domReadBuild())` at its end, i.e. it
rebuilds LOG **from the DOM it just wrote**, not from `f.log` directly. This is safe **iff**
`foldBuild → DOM → _domReadBuild → foldBuild` round-trips (the Step-3 shadow-diff proved DOM↔LOG parity
for every converted category). The verification plan (V2) re-proves this round-trip explicitly for undo,
because a single non-round-tripping field would make undo silently lossy. If any field fails to
round-trip, the fallback is to set `LOG=f.log` directly *after* the `applyBuild` DOM write instead of
trusting the rebuild — documented as the rollback for this risk.

### D6 — Persistence in `{LOG, SEQ, rules, id, schema}` shape (with back-compat)
- **Save** (`saveBuild`): write `{schema:'pact-chargen/1', rules:DATA.version, name, LOG, SEQ, id}` instead
  of the flat build. `name` stays a top-level convenience field (mirrors the Live Sheet export).
- **Load** (`loadFile`): three branches, detected by shape —
  1. `d.schema==='pact-chargen/1'` **or** (`d.LOG` && came-from-CharGen): load LOG directly, then
     `applyBuild(foldBuild(d.LOG))` with name/budget from `d`. No "defaults" guessing.
  2. `d.LOG` from the **Live Sheet** (no CharGen schema): the existing branch — fold + fill class/species
     defaults + the existing flash. Unchanged.
  3. **Flat build** (legacy CharGen saves, shared links, older files): the existing `applyBuild(d)` branch.
     Unchanged — this is the back-compat guarantee (every file saved before Step 4 still opens).
- **Autosave**: switch `_cgAutosave`/`_cgRestoreAutosave` to store `{schema,rules,LOG,SEQ,id,name,budget}`.
  Restore folds it. Keep reading the **old** flat-build autosave key as a fallback so an in-progress build
  from before the upgrade is not lost on first load after deploy (read new key → else old key → migrate).
- **Share link**: **keep encoding the flat build** (`readBuild()`), not the LOG. Rationale: LOG is
  materially larger than the folded build, and URL length is the binding constraint for shared links; the
  flat build already round-trips through `applyBuild`. (Explicitly *not* changing link format — noted so a
  reviewer doesn't read it as an oversight.)

*Schema field:* `schema:'pact-chargen/1'` is the forward-compat hook — a future format bump becomes `/2`
and load can branch on it. The Live Sheet does not currently stamp a schema; we are **adding** one on the
CharGen side only, which is backward-compatible (old loaders ignore an unknown key).

### D7 — UI: two buttons + a count, nothing else moves
Add `↶ Undo` / `↷ Redo` buttons to the existing header button cluster (next to 💾 Save / ↺ Reset), both
desktop (`hd-actions`) and the mobile nav row, matching the existing `.btn.ghost` styling. Disabled state
(greyed) when the respective stack is empty. Optional tiny "N" affordance = `HIST.length` shown in the
button title/tooltip (not a new panel — keeps the layout promise). Keyboard: Ctrl/Cmd-Z → undo,
Ctrl/Cmd-Shift-Z and Ctrl-Y → redo, ignored when focus is in a text input mid-edit *unless* the field is
sealed (so browser-native text undo still works inside a field). **No full history/ledger panel** in this
step (the Live Sheet's ledger is its own thing; CharGen's "pill UI" here means the compact Undo/Redo
control, per the roadmap's Step-4 line — a richer timeline is out of scope).

## Chunk breakdown (each independently reviewed + committed, per Step-3 discipline)
- **Chunk A — history core (no UI):** `HIST`/`REDO`, `commitHistory`, `restoreFrame`, `_histSuspended`
  guard, wrap the four LOG-API functions, coalescing rule. `undo()`/`redo()` exist and are unit-exercised
  from the console but not yet wired to buttons. Verify V1–V3.
- **Chunk B — applyBuild / boot integration:** single-frame-per-load, boot/autosave/shared-link clear
  history, randomize/reset = one undo step. Verify V4.
- **Chunk C — persistence:** `{schema,…}` save shape; three-branch load with full back-compat; autosave
  migration; leave share link flat. Verify V5 (round-trip every legacy format).
- **Chunk D — UI wiring:** Undo/Redo buttons (desktop + mobile), disabled states, keyboard shortcuts,
  tooltips. Verify V6 in a real browser (Playwright).

## Verification invariants (all must hold before merge)
- **V1 — Snapshot immutability:** after `commitHistory()`, mutating `LOG` does not mutate the stored frame
  (deep-clone proof: push, mutate LOG, assert frame.log unchanged).
- **V2 — Undo round-trip fidelity:** for a scripted sequence covering *every* converted category (all 13
  checklist cats, every patch slot, add/remove rows, traditions, unlock-class, drawback buy-off), do
  `edit → snapshot build S1 → edit → undo → snapshot build S2`; assert `canonicalBuild(S1) ===
  canonicalBuild(S2)` for each step. This is the D5 round-trip proof.
- **V3 — Coalescing:** typing N chars into one text field then blurring = exactly **1** undo step; N
  toggles of N different checkboxes = **N** steps; a text edit followed by a checkbox toggle never
  coalesces across the boundary.
- **V4 — Whole-load = one step:** load/reset/randomize each push exactly one frame; boot/autosave/shared
  load leave `HIST.length === 0`; one undo after a load fully restores the pre-load build
  (`canonicalBuild` equal).
- **V5 — Persistence back-compat:** a file saved by *pre-Step-4* CharGen (flat build), a Live-Sheet export,
  and a *new* `{schema:'pact-chargen/1'}` file all load to the identical folded build; a new save reloaded
  round-trips (`canonicalBuild` equal); old-key autosave migrates.
- **V6 — UI + parity:** buttons enable/disable correctly, Ctrl-Z/Ctrl-Shift-Z work, typing stays
  undisrupted, `testing/tests/engine-parity.html` still **20/0** (engine untouched, so by construction —
  spot-checked).

## Rollback
Each chunk is one commit. Chunk A–B are additive (new globals + wrappers that no-op when
`_histSuspended`); reverting them leaves Step-3 behaviour intact. Chunk C's load path keeps all legacy
branches, so reverting the save shape does not strand files. Chunk D is pure UI. The D5 round-trip risk has
a documented in-place fallback (`LOG=f.log` after the DOM write) that does not require reverting the chunk.

## Explicitly out of scope (deferred)
- Folding `name`/`budget` into the LOG (**Step 5** — budget-as-award + AP-award lock semantics; retires the
  D1 name/budget frame fields).
- A full history/timeline panel or time-travel slider (Live-Sheet-style) in CharGen.
- File renames (the `-v0` snapshot cleanup).
- The two pre-existing bugs (DM Console `ck is not defined`; export burst `size`/`wornArmour` gaps) — done
  as separate `fix/` branches after this.
