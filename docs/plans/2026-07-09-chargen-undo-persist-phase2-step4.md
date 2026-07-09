# Phase 2 Step 4 — CharGen undo/redo + event-log persistence (plan)

> **Status:** REVIEWED — two cold reviews folded in (see *Review reconciliation* below); ready to implement.
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

## Review reconciliation (two cold passes)
Two independent reviews ran against the DRAFT: an internal first pass (findings F1–F14) and an external
cold reviewer. Where they agreed, folded straight in; the one conflict was adjudicated against the code.
- **D5 (conflict, resolved against code):** the internal pass proposed making `LOG=f.log` the *default*
  restore (F2); the external reviewer argued to keep the DOM-rebuild default and treat `LOG=f.log` as a
  fallback only. Checking `_buildEventBurst` in the code showed CharGen's LOG is *already* regenerated
  synthetically on every whole-build op, so the build-equality contract is already in force — **external
  reviewer's position adopted; F2 reversed.** See D5.
- **D3 (both, folded):** coalescing evaluated lazily on the next mutation (no timer); cross-field and blur
  boundaries made normative + permanent; only user text edits carry a coalesce key; seal-before-undo;
  no-op dedupe; paused-typing = two steps.
- **D6 (internal F1 survives + external, folded):** `budget` added to the save envelope (fixes a
  self-contradiction the external pass missed); load keys solely on `schema`, validates `LOG`; autosave
  deletes the old key after migration.
- **Verification (both, folded):** added V3 paused-typing, V4 randomize→undo→redo→undo, V7 redo symmetry,
  V8 persisted stability incl. `name`/`budget`.
- **Architecture (external observation, noted):** CharGen becomes an **event-sourced editor with snapshot
  history**, not a replayable event-history editor — the right choice given `replacePatchSlot()` /
  `retractFlatEvent()` make the LOG non-append-only, and it bounds undo complexity. This is *why* CharGen
  deliberately diverges from the Live Sheet's append-only pop-undo.

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
*(Tightened after both cold reviews — the group-boundary rules below are normative, not illustrative.)*

`onPatchFieldChange` fires on **both `input` and `change`**, so a text field emits a `replacePatchSlot`
per keystroke. Without coalescing, "type a 12-char name" would be 12 undo steps. Rules:

**Who supplies a coalesce key.** *Only* mutations that originate from **user text editing** (a text /
number / `textarea` `input` event) supply a non-null `coalesceKey` (= that field's `id`). **Everything
else passes `coalesceKey = null` and is always its own undo step:** `<select>`/checkbox/radio `change`
events, add/remove row, tradition edits, reconcile, load/reset/randomize, **and any internal or
programmatic `replacePatchSlot` call not driven by a user keystroke**. This prevents accidental grouping of
non-typing mutations. The key is derived from the **field id**, never the value.

**When a group extends (coalesces).** Coalescing is evaluated **lazily, on the next mutation** — there is
no timer callback that "fires." When a keystroke mutation arrives, it *continues* the current group (pushes
**no** new frame) iff **all** hold: (a) same non-null `coalesceKey` as the group in progress; (b) the group
has not been sealed; (c) elapsed time since the previous committed mutation ≤ `COALESCE_MS` (~600 ms).
Otherwise it **seals** the current group and starts a new one (pushing one pre-edit frame).

**What seals a group (normative, permanent).** A group is sealed by any of: a `blur`/focus-change of the
edited control; a mutation with a **different** `coalesceKey` (cross-field boundary — always a new group,
even if typed 20 ms later); a `null`-key (discrete) mutation; the elapsed-time check above failing on the
next keystroke; **or any undo/redo invocation** (undo/redo first seals the open group, *then* restores —
so undo can never land mid-word). **Sealing is permanent:** once a control has blurred, a later edit to the
same field starts a fresh group — focus returning does not re-open the old group.

**Undo granularity (stated UX).** A coalesced burst is one undo step *including* sub-window pauses: `type
"abc" · wait 200 ms · type "def"` (200 ms < `COALESCE_MS`) undoes as one step removing `"abcdef"`. A pause
**longer** than `COALESCE_MS` between keystrokes seals the first group, so `type · long-pause · type`
becomes **two** undo steps (verified by V3).

**No-op dedupe.** When a group seals, if its net LOG equals the pre-group LOG (an edit that changed
nothing — retyping the same value, toggling to the same state), the pre-group frame is discarded so "Undo"
never restores an identical state or drifts the step count. (Compared once at seal time, not per keystroke,
to stay cheap.)

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

**The contract is build equality, not event equality (settled).** `applyBuild` calls
`replaceWholeLogFromBuild(_domReadBuild())` at its end, i.e. restore rebuilds LOG **from the DOM it just
wrote**, not from `f.log` directly. This is deliberate and stays the **default** — restore does *not* force
`LOG=f.log`. Rationale, verified against the code: CharGen's LOG is **already** regenerated on every
whole-build operation (load/reset/randomize/boot) by `_buildEventBurst`, which fabricates a *synthetic*
event burst with fresh `seq`/`ts` and blanket `noLock` tags — its own comment states it is "**NOT** a
live-authored editing history." So exact event identity was never a CharGen guarantee; the LOG is a
**build-equality artifact**, and the user-visible invariant is the *build*, not the event stream.
Consequences of this choice, stated so an implementer doesn't re-litigate it:
- There is exactly **one** canonical LOG builder (`_buildEventBurst` via `applyBuild`). Restore reuses it
  rather than introducing a second path.
- Forcing `LOG=f.log` by default would create that second path **and mask** an `applyBuild`/`_buildEventBurst`
  divergence bug instead of surfacing it. We want V2 to *catch* such a bug, not hide it.

*Fallback (only if V2 fails):* if V2 ever finds a field that does not round-trip
(`foldBuild → DOM → _domReadBuild → foldBuild` diverges), the remedy is to set `LOG=f.log` *after* the
`applyBuild` DOM write for that release — but that is a **bug-containment fallback**, not the default, and
the underlying round-trip defect must still be fixed. V2 (strengthened below) is the real gate.

*(This reverses finding F2 of this repo's own first-pass review, which proposed making `LOG=f.log` the
default; the second cold reviewer and the `_buildEventBurst` code both show the build-equality contract is
already in force, so the DOM-rebuild default stands.)*

### D6 — Persistence in `{LOG, SEQ, rules, id, schema}` shape (with back-compat)
- **Save** (`saveBuild`): write `{schema:'pact-chargen/1', rules:DATA.version, name, budget, LOG, SEQ, id}`
  instead of the flat build. `name` **and `budget`** are top-level fields: both are Step-5 DOM shims that
  `foldBuild(LOG)` does **not** carry, so omitting `budget` would silently reset the player's chosen budget
  to `DATA.level1AP` on every reload (this was finding F1 — the earlier draft's envelope dropped `budget`
  while the load branch below claimed to read it, a self-contradiction). `name` mirrors the Live Sheet
  export.
- **Load** (`loadFile`): three branches, checked **in this order**, keyed on shape —
  1. **`d.schema === 'pact-chargen/1'`** (the *only* discriminator — the earlier draft's "or came-from-CharGen"
     heuristic was undefined and is dropped; pre-Step-4 CharGen never wrote LOG files, so every untagged
     `d.LOG` is a Live Sheet export and belongs to branch 2). **Validate `Array.isArray(d.LOG)` first**; if
     the file claims the schema but `LOG` is missing/not an array, show an explicit "couldn't read this
     PACT file" error and leave the current build untouched — never silently fold to an empty build (that
     would look like data loss). On success: load LOG directly, then `applyBuild(foldBuild(d.LOG))` with
     `name`/`budget` taken from `d`. No "defaults" guessing.
  2. `d.LOG` **without** the CharGen schema = a **Live Sheet** export: the existing branch — fold + fill
     class/species defaults + the existing flash. Unchanged.
  3. **Flat build** (legacy CharGen saves, shared links, older files): the existing `applyBuild(d)` branch.
     Unchanged — the back-compat guarantee (every file saved before Step 4 still opens; flat builds already
     carry `budget`).
- **Autosave**: switch `_cgAutosave`/`_cgRestoreAutosave` to store
  `{schema, rules, LOG, SEQ, id, name, budget}`. Restore reads **new key → else old flat-build key →
  migrate**; on a successful migration from the old key, **write the new key and then delete the old key**
  so stale flat-build state cannot linger and shadow later edits. (Accepted narrow edge: a user who upgrades
  then is served an *older* cached tool version by the PWA service worker would find no old-key autosave —
  their data still exists under the new key for the current version; this one-time downgrade gap is
  tolerated rather than dual-writing both keys forever.)
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
- **Chunk A — history core (no UI):** `HIST`/`REDO` (with an optional depth cap ~100 frames, oldest
  dropped, since each frame is a full LOG clone), `commitHistory`, `restoreFrame` (DOM-rebuild default per
  D5), `_histSuspended` guard, wrap the four LOG-API functions, coalescing rule. `undo()`/`redo()` exist
  and are unit-exercised from the console but not yet wired to buttons. Verify V1–V3, V7. *(May be
  sequenced internally as A1 = snapshot + restore core + V1/V2/V7, then A2 = coalescing + V3, so restore
  correctness is proven before coalescing complexity lands — one commit either way.)*
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
  coalesces across the boundary; **`type · pause > COALESCE_MS · type` on one field = exactly 2 undo
  steps** (proves the lazy elapsed-time seal), while `type · pause < COALESCE_MS · type` = 1 step; a no-op
  edit (retype the same value) adds **0** steps.
- **V4 — Whole-load = one step:** load/reset/randomize each push exactly one frame; boot/autosave/shared
  load leave `HIST.length === 0`; one undo after a load fully restores the pre-load build
  (`canonicalBuild` equal); **`randomize → undo → redo → undo` leaves HIST/REDO depths consistent and the
  build canonical-identical each time** (repeated whole-build restores accumulate no hidden history).
- **V5 — Persistence back-compat:** a file saved by *pre-Step-4* CharGen (flat build), a Live-Sheet export,
  and a *new* `{schema:'pact-chargen/1'}` file all load to the identical folded build; a new save reloaded
  round-trips (`canonicalBuild` equal) **and preserves `name` and `budget`**; a schema-tagged file with a
  missing/invalid `LOG` errors without touching the current build; old-key autosave migrates **and the old
  key is gone afterward**.
- **V6 — UI + parity:** buttons enable/disable correctly, Ctrl-Z/Ctrl-Shift-Z work, typing stays
  undisrupted, `testing/tests/engine-parity.html` still **20/0** (engine untouched, so by construction —
  spot-checked).
- **V7 — Redo symmetry:** for the V2 sequence, `edit → undo → redo` returns a build `canonicalBuild`-equal
  to the pre-undo state, and REDO is correctly cleared by the next fresh edit.
- **V8 — Persisted stability across undo:** `save → load → undo → save` yields a `canonicalBuild`-identical
  LOG, and `name`/`budget` survive the round-trip (guards the F1 shim-persistence path end-to-end).

## Rollback
Each chunk is one commit. Chunk A–B are additive (new globals + wrappers that no-op when
`_histSuspended`); reverting them leaves Step-3 behaviour intact. Chunk C's load path keeps all legacy
branches, so reverting the save shape does not strand files. Chunk D is pure UI. The D5 round-trip risk has
a documented bug-containment fallback (`LOG=f.log` after the DOM write, adopted only if V2 finds a
non-round-tripping field) that does not require reverting the chunk.

## Explicitly out of scope (deferred)
- Folding `name`/`budget` into the LOG (**Step 5** — budget-as-award + AP-award lock semantics; retires the
  D1 name/budget frame fields).
- A full history/timeline panel or time-travel slider (Live-Sheet-style) in CharGen.
- File renames (the `-v0` snapshot cleanup).
- The two pre-existing bugs (DM Console `ck is not defined`; export burst `size`/`wornArmour` gaps) — done
  as separate `fix/` branches after this.
