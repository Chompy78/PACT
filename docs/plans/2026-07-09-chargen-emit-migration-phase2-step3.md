# Plan: Rewrite CharGen's live-editing handlers to `emit()` (Phase 2, Step 3)

## Status
**Cold-reviewed and amended.** Reviewer approved the core design (`user action → CharGen-local LOG
mutation helper → LOG changes → foldBuild(LOG) → render from folded build`) and requested 18 amendments,
all folded in below. **Chunks 0, 1, 2, 3, and 4A are DONE** (see "Chunk log" at the bottom); Chunks 4B–6 remain.

## Chunk log

- **Chunk 0 — DONE (2026-07-09).** `LOG`/`SEQ`, the LOG mutation API (`emit`, `retractFlatEvent`,
  `replacePatchSlot`, `replaceWholeLogFromBuild`), `RETRACTABLE_FLAT_CATS`, `PATCH_SLOTS`,
  `buildToEventLog`/`nextSeq` (via a `_buildEventBurst` extracted from `buildToLiveLog`, confirmed
  behavior-preserving by round-trip), the pre/post-render shadow-diff (`?cgShadow=1`), the four dev
  assertions, the temporary state-event audit marker, and the initial `LOG` bootstrap at boot all landed.
  `readBuild()` still returns `_domReadBuild()` (Option A — untouched). Verified: `engine-parity.html`
  16/0 unaffected; a live DOM interaction (checking a racial trait) still re-prices correctly with `LOG`
  staying frozen at its boot snapshot (no handler converted yet, as expected); shadow-diff at boot is
  clean except one pre-existing, separately-tracked gap (`size` never exported by the burst — see
  CHANGELOG). `wornArmour` (also never exported by the burst) didn't surface at boot because CharGen's
  default value for it is empty on both sides; it's the same class of gap and is tracked with `size`.
  Neither was fixed in this chunk (would change `buildToLiveLog`'s live export behavior — out of scope
  for a "no behavior change" scaffolding chunk).
- **Chunk 1 — DONE (2026-07-09).** Category A (12 flat checkbox categories — saves/skills/expertise/
  toolExpertise/tools/instruments/masteries/racialTraits/racialSpells/boons/drawbacks/arts) wired to
  `emit()`/`retractFlatEvent()` via one delegated `#form` listener (`onChecklistToggle`/
  `_cgWireChecklistDelegation`) rather than touching each of the ~12 checkbox-generation call sites
  individually — lower "missed site" risk. Pricing is computed against `_domReadBuild()` (the current
  full build), not `foldBuild(LOG)` — LOG is still stale for every not-yet-converted category through
  Chunk 5, so pricing off it would use wrong context for anything context-dependent (e.g. racial-trait
  own/cross-race pricing); confirmed by direct test that this exactly reproduces the existing hardcoded
  drawback-cost formula. A `raceTraitLegal()` pre-emit guard (Category F) lands with this chunk; the OLD
  DOM-side auto-correction in `annotate()` deliberately stays active in parallel until Chunk 6 (Option A —
  DOM remains authoritative until then). Category D (`buildArtGrid`/`buildBoonGrid`/`buildDrawGrid`) also
  converted to read membership from `foldBuild(LOG)` instead of `ckVals()`, after tracing every call site:
  safe because `applyBuild()` always follows its own call to these three grid builders with a direct
  `ck('artck',...)`-style DOM write that overwrites whatever the grid computed, and the AP-total displays
  are recomputed from `compute()`'s ledger by `annotate()` afterward, not from the grid builder's own
  calculation — verified with a real restore-flow test (`applyBuild()` with arts/boons/drawbacks preset).
  Verified: `engine-parity.html` 16/0 unaffected; all 12 checkbox categories independently confirmed
  matching between DOM and `foldBuild(LOG)` after interaction (via direct API + real click tests); the
  transient shadow-diff divergence during a single click's event cascade (multiple `render()` calls firing
  before `LOG` catches up) was traced via a `console.warn` stack-trace to confirm it fully resolves by the
  final `emit()`-triggered render — not a bug, an artifact of the pre-existing dual `input`+`change`
  generic listeners. One pre-existing, unrelated bug surfaced and NOT fixed here (output as a roadmap item
  for a human to fold in): `dmAdd()`/`dmDisableBuiltin()`/`dmRemove()`/`dmToggleDisable()` throw
  `ReferenceError: ck is not defined` (confirmed pre-existing, not introduced by this chunk).

  **Post-commit fix (independent review):** a second independent review of this chunk's diff (after it
  landed) found a real, non-hypothetical bug in `onChecklistToggle`'s CHECK path: several pre-existing
  `annotate()` DOM-side auto-corrections (racial/linspell/expertise/toolexpertise/boon/drawback/art) set
  `.checked=false` directly without dispatching a `change` event, so `retractFlatEvent()` never runs for
  them and `LOG` is left with a stale entry the DOM no longer reflects; re-checking the same box later
  would then emit a genuine duplicate `LOG` entry (`MUT`'s flat-push mutators have no dedup). Fixed with an
  idempotency guard — `onChecklistToggle` now no-ops on CHECK if `LOG` already has a matching entry for
  that `(cat, value)` pair. Verified directly: simulated the exact bypass scenario (force-uncheck without
  a `change` event, then a normal re-check) — before the fix this produced 2 entries, after the fix it
  stays at 1; a normal check→uncheck→recheck cycle (all via real `change` events) still correctly cycles
  1→0→1. Full regression suite (parity, boot, round-trip, 12-category sweep) reconfirmed green. The same
  review flagged a minor, lower-severity ordering note in `applyCampaignCode()` (calls `render()` before
  the three Category-D grid rebuilds, not after) — shares the same root cause but doesn't itself create
  `LOG` duplicates (campaign-code application never emits/retracts events), so it's left as a one-frame
  possible display staleness, not fixed.
- **Chunk 2 — DONE (2026-07-09).** Category B scalar/object fields wired to `replacePatchSlot()` via one
  delegated `#form` listener (`onPatchFieldChange`/`_cgWirePatchDelegation`, id-keyed rather than
  class-keyed since these fields don't share Category A's checkbox-class pattern). Every slot's patch is
  always built as the *full* field set for that slot from a fresh `_domReadBuild()` (`_cgSlotPatch`),
  never just the one field that changed — required because `replacePatchSlot()` replaces a slot's whole
  LOG event on every write, so a partial patch would silently drop a co-located field's value.
  **Taxonomy gap found and resolved**: `originClass`/`originClass2`/`species`/`species2`/`lineage` are
  genuine Category B fields (confirmed via `_buildEventBurst`) missing from every category (A-G) in the
  cold-reviewed plan's enumeration. Grouped under the already-declared-but-unused `PATCH_SLOTS.IDENTITY`
  alongside `size` (also missing from the plan). Two more orphaned fields (`hardy`/`tough` "Vigor & Grit",
  `innate` spell counts) and two fields with no fitting slot (`martiallyBound`, `dabblerCantrips`) got
  three new canonical slots added to the registry (`VIGOR`, `INNATE`, `MISC`) rather than being crammed
  into a semantically-unrelated existing slot. `name` and `budget` are deliberately excluded — both use a
  different event mechanism (`type:'name'`/`type:'award'`, not `cat:'patch'`), deferred to Chunk 5. The
  STR<10 armour guard (Category F) is enforced two ways: directly in `_cgSlotPatch`'s `ARMOUR` case, and
  via a cascade in `onPatchFieldChange` that re-patches `ARMOUR` whenever `STATS` changes (without it, a
  stale illegal armour patch could sit in `LOG` until the next unrelated armour edit, since the OLD
  DOM-side correction bypasses change events the same way Chunk 1's `annotate()` guards did).
  Verified: `engine-parity.html` 16/0 unaffected; 21 fields directly tested matching between DOM and
  `foldBuild(LOG)` after interaction; the repeated-edit cost-delta invariant holds through the full UI
  path (raising a stat in 3 steps vs. one direct edit — same total, one slot event, no accumulation);
  the STR<10 cascade fires correctly.

  **Pre-commit fixes (independent review, before this chunk landed):** an independent review of the
  diff, run before committing, found: (1) `lineage` (confirmed via the same `_buildEventBurst`
  cross-check that found the other IDENTITY-slot fields) was still missing — added to `PATCH_FIELD_SLOT`
  and `_cgSlotPatch`'s `IDENTITY` case, verified directly; (2) the STATS→ARMOUR cascade fired
  unconditionally on *any* stat edit (not just STR crossing the threshold), producing needless no-op
  `LOG` churn — fixed by comparing the recomputed armour patch against the current LOG event and skipping
  the write when unchanged, verified an unrelated stat edit (CHA) no longer touches the armour slot's
  `seq`; (3) the `ap_` prefix match for the `APPEARANCE` slot false-positively matched ~15 `ap_*_lock`
  UI-only "don't randomize" checkboxes (never read by `_domReadBuild()`) — fixed by excluding `_lock`-suffixed
  ids, verified toggling one no longer creates an appearance patch; (4) `budget`'s exclusion (same
  reasoning as `name`) was undocumented — added a one-line comment. Full regression suite reconfirmed
  green after all four fixes.
- **Chunk 3 — DONE (2026-07-09).** Category C (add-row lists: `features`/`subAbilities`/`subSpellBundles`)
  plus `unlockedClasses`. `unlockedClasses` reused the existing Chunk 1 `CHECKLIST_CAT`/`onChecklistToggle`
  mechanism (a stable checkbox-per-value control, same shape as Category A) — with one wrinkle:
  `classunlock` checkboxes carry no `value` attribute (defaults to `"on"`), so `onChecklistToggle` now
  branches to read `el.dataset.cls` for that one class, plus a guard mirroring `_domReadBuild()`'s own
  origin-class exclusion filter exactly.

  `feat2`/`subabil`/`subbundle` needed a genuinely different mechanism: unlike Category A's stable
  one-checkbox-per-value model, these rows are dynamic (added via `addRow()`, sometimes free-typed,
  removed via a `✕` button that fires no event) and features can legitimately repeat
  (`DATA.features[x].rep`). Introduced a *multiset reconciliation* function (`_cgSyncFlatCategory(cat)`)
  that compares the DOM's current value **counts** (not just set membership — a plain set-diff would
  silently collapse two identical repeatable-feature rows into one LOG event) against LOG's current
  counts for the whole category, and retracts/emits exactly the difference. Invoked from the existing
  delegated `#form` listener (for genuine typing) plus three explicit call sites added where the code
  sets a row's value via direct `.value=` assignment without dispatching any event — `addRow()`'s preset
  path, the `✕` removal handler, and the autocomplete's `pick()` function — all three confirmed to be
  real gaps (same class of "bypass" issue Chunk 1's post-commit fix found for `annotate()`'s
  auto-corrections). Gating (Warlock discipline / Tasha / needsKi / needsSorc / prerequisite /
  duplicate-block) is NOT re-implemented — `buildClassPickers()`'s `.classpick` and `buildSubPickers()`'s
  `.subpick` change handlers already gate before calling `addRow()`, so by the time a row exists the pick
  has already passed those checks. One new guard added: a feat2 row's free-typed value must be a real
  `DATA.features` key before being emitted, since `rowsVals()` performs no such validation and a
  mid-typing string would otherwise reach the reconciler.

  Verified, independently reviewed (8/8 checks passed): the multiset reconciliation traced by hand for
  both the 2-picks-of-a-repeatable-feature case (emits exactly 2) and the stale-LOG-has-more-than-DOM
  case (retracts exactly the difference); confirmed via a real click test (2 picks → 2 DOM + 2 LOG
  entries; removing one row → 1/1 remaining, not 0/0 or 2/1); feature/subability/subbundle add+remove via
  their real dropdown flows; `unlockedClasses` check/uncheck with the origin-class exclusion; full
  regression suite green throughout. One latent, pre-existing-class gap noted (not fixed — same
  self-healing pattern already accepted for Chunk 1's `annotate()` bypasses): if a class is unlocked via
  checkbox and *later* becomes the character's origin class, no cascade retracts the now-redundant
  `unlockclass` LOG entry — invisible under Option A (DOM stays authoritative through Chunk 5) and
  self-heals via the existing idempotency guard on the next real toggle, but flagged here for Chunk 4A/6
  to explicitly check via the shadow-diff before the `readBuild()` flip.
- **Chunk 4A — DONE (2026-07-09).** Coalescing-patch infrastructure hardening, three parts.
  (1) Wired `customProfs` (`.cprofrow` text inputs, a dynamic add-row list) and `freeSub` (`.freesub`
  `<select>`s) into `replacePatchSlot()`. Both are coalescing-patch fields but their controls carry no
  `id`, so Chunk 2's id-keyed `_cgWirePatchDelegation` never reached them — added a class-keyed
  delegation (`_cgWirePatchClassDelegation` + `PATCH_CLASS_SLOT`), plus explicit sync nudges in `addRow()`
  and the `✕` removal handler for the cprof add/remove-fires-no-event gaps (same pattern Chunk 3 used).
  Verified add/type/remove coalesces to a single `customProfs` slot event; `freeSub` tracks correctly.
  (2) Extracted `_cgSyncPatchSlot(slot, dom)` — the "replace this slot's patch from DOM, skip if
  byte-identical to what LOG holds" primitive that Chunk 2's STATS→ARMOUR cascade had inlined — and
  refactored both that cascade and `onPatchFieldChange`'s main path to use it (fewer redundant LOG events;
  behavior-equivalent under Option A, confirmed no Chunk 2 regression).
  (3) Fixed the real `unlockclass` divergence flagged by Chunk 3's review: `unlockedClasses` depends on the
  origin class, but changing the origin toggles no checkbox, so a class unlocked before it became the
  origin left a stale LOG entry. Added `_cgReconcileUnlockClass()` (a full set-reconcile — retract LOG
  entries not in DOM, emit DOM entries not in LOG), called on IDENTITY-slot changes. Verified both
  branches directly (retract: origin→unlocked-class drops the stale entry; emit: a forced-stale LOG
  re-syncs), no double-emit with `onChecklistToggle` (both sides guarded), no duplicates.
  Independently reviewed (8/8 checks passed, no fixes needed). A comprehensive mixed-editing test (fields
  across Categories A/B/C/4A + unlockclass) confirmed DOM and `foldBuild(LOG)` fully agree on all fields
  and total AP afterward. Full regression suite green throughout; `engine-parity.html` 16/0.
- Chunks 4B–6: not started.

Builds directly on Phase 2 Steps 1–2, both DONE (see D-GH33 and the "Implementation notes" section at the
bottom of `docs/plans/2026-07-08-chargen-livesheet-unification-phase2.md`). `js/engine.js` already exports
`MUT`, `foldBuild`, `activeEvents`, `economy`, `baseBuild`, `compute`, `DATA`; CharGen's module bridge
(`tools/PACT-CharGen-Webtool.html` lines 443–453) already imports all seven onto `window`, replacing its
two former local throwaway copies. CharGen's own live-editing UI (`readBuild()`/`render()`/the ~80
handler sites) is completely untouched by Steps 1–2 and is this document's entire scope.

## Goal
Make CharGen's live-editing runtime event-sourced, matching Live Sheet's existing architecture, with
**no other behavior change**: every user action becomes `emit(event)` (or one of its sibling LOG-mutation
helpers — see "LOG mutation API" below) → `LOG` grows → the UI re-renders from `foldBuild(LOG)`.
`readBuild()` becomes a thin wrapper around `foldBuild(LOG)`; DOM stops being the source of truth and
becomes pure render output. This is purely a state-layer rewrite so that a *later* step (Step 4,
explicitly out of scope here) can add pill UI and global Undo/Redo on top of a LOG that already exists and
is already correct. No new UI, no undo button, no lock/economy/campaign semantics.

## LOG invariants for Step 3

These are design rules *and* implementation review checks — every chunk's diff should be checked against
this list before landing, and several are backed by dev-only runtime assertions (see "Dev assertions"
below).

1. `foldBuild(LOG)` is deterministic.
2. `foldBuild(LOG)` must not mutate `LOG`.
3. Every event in `LOG` must replay successfully from `baseBuild()`.
4. `render()` must not mutate build state.
5. `annotate()` must be render-only after migration. It may style, label, disable controls, show
   warnings, and update explanatory text, but it must not correct state by changing `.checked`, `.value`,
   `LOG`, `SEQ`, or any build-owning variable.
6. Category A/C flat-push events are the only events that may be retracted in place.
7. Indexed tradition/discipline events (`found`, `rank`, `cantrip`, `slot`, `known`, `dbound`) must not be
   emitted or retracted by any CharGen live-edit handler in Step 3.
8. Traditions/disciplines are represented as one coalescing bulk patch during Step 3.
9. Autosave persists only the folded flat build state, not `LOG`, `SEQ`, timestamps, or event history.
10. Reloading autosave in Step 3 intentionally collapses granular in-session history into a fresh
    canonical event log.

## Assumptions vs. verified facts

### Verified this session (by reading the actual files, not the phase-2 plan's summary of them)
- CharGen's module bridge already imports `DATA, compute, MUT, foldBuild, activeEvents, economy,
  baseBuild` from `js/engine.js` (lines 443–453) and mirrors them onto `window`.
- `readBuild()` (line 1153) re-derives the entire build by querying ~60 distinct DOM ids/classes live
  (`val()`, `chk()`, `ckVals()`, `rowsVals()`, `document.querySelectorAll('.tcard')`, etc.). No
  persistent state object exists anywhere in the file today.
- **Most of CharGen's ~80 raw handler occurrences are not per-field handlers at all.** A single pair of
  delegated listeners at the very end of boot,
  `$('form').addEventListener('input',render);$('form').addEventListener('change',render);` (line 2313),
  catches every bubbling `input`/`change` event from anywhere inside `#form` and calls `render()`, which
  just calls `readBuild()` again and repaints derived, read-only output (totals, warnings, ledger,
  per-item prices via `annotate()`). The DOM input elements *are* the state; nothing "handles" most
  individual fields except this one generic re-render. (Raw counts confirmed by grep: 67 `onclick=`, 10
  `onchange=`, 37 `addEventListener(...)`, 4 `oninput=` — 118 occurrences total, heavily overlapping with
  structural code, not 1:1 with "editable fields.")
- The individually-bound sites fall into a small number of repeating shapes: row add/remove (`addRow`
  line 1051, the per-row `.btn.x` remove handler), dynamic card construction (`addTrad`/`addDisc` for the
  traditions/disciplines editor, each wiring its own delegated `input`/`change` listener onto the new
  card), filterable-grid rebuilds (`buildBoonGrid`/`buildDrawGrid`/`buildArtGrid`, wired from 3 filter
  `oninput`s plus 4 other call sites), and a handful of bespoke multi-step flows (`applyCampaignCode`,
  `randomizeBuild`/`randomizeRoll`, `loadFile`/`applyBuild`, `openNames`/`saveNames`).
- `applyBuild(b)` (line 1506) is the sole "write a flat build object onto the DOM" function. It is used
  by `loadFile` (both the CharGen-native branch and the Live-Sheet-LOG-import branch, via
  `foldBuild(d.LOG)`), `loadFromHash` (shared link), `_cgRestoreAutosave()`, and `randomizeRoll()`. It
  sets `.value`/`.checked` on ~60 elements directly, rebuilds the boon/draw/art grids and the
  tradition/discipline cards from scratch, and calls `render()` twice.
- `buildToLiveLog(b)` (line 1441, the CharGen→Live-Sheet export path) already contains a working,
  precedented "flat build → well-formed event burst" converter: a local `ev()` funnel that stamps
  `seq`/`ts`/`noLock:true` and pushes onto a scratch array; an `emitPatch(label, patch)` helper that
  diffs cost via clone+`compute()` before/after and skips no-op patches; an `evItem(label, cat, v,
  fixedCost)` helper that runs `MUT[cat]` on a running scratch build and prices the delta the same way.
  Every event is deliberately tagged `noLock:true` — a real, already-fixed bug (D-GH34) explains why: this
  burst represents "declare current state as events," not real editing history, and must not
  retroactively fire `creationLocked`'s AP-threshold auto-lock.
- `js/engine.js`'s `MUT` map (line 405) already has a mutator for essentially every field CharGen edits:
  `hd, prof, abil, skill, expertise, toolexpertise, save, lineage, wornArmour, racialspell, feature, art,
  boon, tool, instrument, mastery, language, vigor, grit, armour, wprof, species, oclass, racial,
  drawback, attune, ki, sorcery, mbound, subbundle, unlockclass, freesub, subabil, tasharule`, plus the
  indexed tradition/discipline ops `found, rank, cantrip, slot, known, dbound`, plus bulk `patch`
  (`Object.assign(b,p.patch)`) and `campaign`/`names`/`create`. **`buildToLiveLog()`'s existing call
  sequence is therefore a complete, already-tested enumeration of the exact event vocabulary Step 3
  needs** — Step 3's job per handler site is "emit the same kind of small event `buildToLiveLog` already
  proves works, immediately at click-time, instead of waiting to synthesize it at export time."
- **Critical distinction confirmed by reading the mutators themselves:** the flat list-push mutators
  (`skill`, `save`, `expertise`, `toolexpertise`, `tool`, `instrument`, `mastery`, `racial`, `racialspell`,
  `boon`, `drawback`, `art`, `feature`, `subabil`, `subbundle`, `unlockclass`) push onto arrays with **no
  positional/index dependency from other events**. The tradition/discipline mutators (`found`, `rank`,
  `cantrip`, `slot`, `known`, `dbound`) address `b.traditions[p.ti].disciplines[p.di]` **by numeric
  index** — removing or reordering one of these events out-of-sequence would silently corrupt every later
  event's `ti`/`di` reference. This asymmetry is the single most important fact driving the handler-taxonomy
  design below, and is now enforced at runtime, not just documented (see "Retractable-category allowlist").
- Live Sheet's own live-editing UI already emits most of these categories one at a time through a single
  funnel, `buy(cat,payload,label)` (line 440), used by dozens of call sites. `buy()` additionally does
  affordability gating (blocks if `cost > eco.available`), duplicate-ownership blocking, and hard/soft
  rules-warning confirm dialogs (lines 440–455). **CharGen has none of this today** — confirmed by
  reading `render()`: it shows `r.total`/`r.budget` and a status line/meter but never blocks an input;
  building past budget is a first-class, always-allowed CharGen workflow, not a bug.
- `render()` (line 2081) contains a live DOM-correction case: when STR drops below 10 it force-unchecks
  `#a_med`/`#a_heavy` and recurses into `render()`. `annotate()` (line 1673) contains an equivalent case
  for `.racck` (illegal cross-race trait): `if(_oo&&e.checked)e.checked=false;`. Both are "the DOM lied,
  fix it" corrections that must be relocated to pre-emit guards (LOG invariant #5) — once state lives in
  LOG, `annotate()` has nothing left to correct.
- `_cgAutosave(b)`, called at the end of every `render()`, persists the *entire flat build*
  (`readBuild()`'s return value) to `localStorage['pactCharGenAutosave']` on every keystroke. This is
  CharGen's only current persistence and is a plain flat-JSON contract, distinct from and predating the
  phase plan's Step-4-scoped `{LOG,SEQ,rules,id,schema}` shape. See "Autosave compatibility invariant"
  below for the explicit contract this migration must preserve.
- `testing/tests/engine-parity.html` drives fixtures purely by calling `compute()`/`rebuildStateFromEvents()`
  on JSON fixtures loaded over HTTP; it never touches either tool's HTML/DOM. It **cannot** detect a
  CharGen-internal wiring bug (a handler that still mutates DOM instead of emitting) — confirmed by
  reading the test harness itself. This is why the shadow-diff scaffolding (strengthened per review, see
  below) is load-bearing for this migration, not a nice-to-have.

### Assumed (should be confirmed while implementing, not architecturally risky)
- No caller reads `readBuild()` expecting a mid-edit value that never fired `input`/`change` (e.g. some
  other function reading `.value` directly, off the debounce/blur path). A grep of `readBuild()` call
  sites (`_cgHasDisc`/`_cgHasKi`/`_cgHasWarlock`, `openNames`, `shareLink`, `saveBuild`,
  `exportToLiveSheet`, `randomizeRoll`, `buildBoonGrid`, `buildDrawGrid`) found none of this, but wasn't
  exhaustive for `setTimeout`/debounce-driven callers. Category G's programmatic-writer audit (below) is
  the mechanism for closing this gap thoroughly.
- The strengthened shadow-diff technique (pre-render *and* post-render comparison, canonicalized) isn't a
  pattern used anywhere else in this codebase — it's a proposal for this migration specifically, worth a
  short spike in Chunk 0 before relying on it as the primary detection mechanism.

## Proposed approach

### Target architecture
Add, near the existing module-bridge script, a CharGen-local (not engine-exported — matches Live Sheet's
own precedent, per the phase plan's "Implementation notes" correction that `emit()` correctly stays
tool-local) `LOG`/`SEQ`:

```js
let LOG = []; let SEQ = 1;
```

`readBuild()`'s eventual target shape:
```js
function readBuild(){ return foldBuild(LOG); }
```
but **the flip to this one-liner is deliberately deferred to the final cleanup chunk** — see "Chunk
source-of-truth policy" below. Until then, `readBuild()` keeps calling the renamed original DOM-reader,
`_domReadBuild()`, while `foldBuild(LOG)` is built and shadow-checked in parallel.

`render()` is split into four single-purpose phases (previously one function did DOM-reading,
DOM-writing/correcting, and painting all at once):
```js
function render(){
  const b = readBuild();          // Chunks 0-5: _domReadBuild(); Chunk 6+: foldBuild(LOG)
  const r = compute(b);
  paintFormControls(b);           // writes editable .value/.checked from state — replaces applyBuild()'s DOM-writing half
  paintDerivedOutputs(b, r);      // totals, warnings, ledger — this is roughly today's render() body
  annotate(b, r);                 // styles/labels/disables/explains ONLY — no state correction (LOG invariant #5)
  _cgAutosave(b);
}
```
`applyBuild(b)` collapses to a thin wrapper: `function applyBuild(b){ replaceWholeLogFromBuild(b); }` (see
LOG mutation API below) — it no longer writes DOM directly at all; `paintFormControls(b)`, called from
`render()` after every `emit()`/`replaceWholeLogFromBuild()`, is the only place that writes `.value`/
`.checked` from state. This directly addresses the risk that `applyBuild()`'s DOM-writing half survives
the migration as an undetected second, DOM-owns-state code path.

CG_CAMPAIGN/CG_NAMES/HOUSE — CharGen's existing non-DOM module-level state — fold naturally into this
model via the `campaign`/`names`/`patch` MUT categories `buildToLiveLog` already uses for them, under the
`PATCH_SLOTS.CAMPAIGN`/`PATCH_SLOTS.NAMES` slots (see "Patch slot registry" below).

### LOG mutation API

No code outside this helper family may mutate `LOG` directly (push, splice, reassign, or otherwise). Every
path that changes `LOG` must consistently handle event sequencing, autosave, re-render, and (during
migration) shadow/dev checks — funneling all mutation through these four functions is what guarantees that.

```js
function emit(ev){
  ev.seq = SEQ++; ev.ts = Date.now(); ev.rules = ev.rules || DATA.version;
  LOG.push(ev);
  render();
}

function retractFlatEvent(cat, predicate){
  if (!RETRACTABLE_FLAT_CATS.has(cat))
    throw new Error(`retractFlatEvent: '${cat}' is not in RETRACTABLE_FLAT_CATS — indexed/coalescing categories must not be retracted in place`);
  const i = LOG.findIndex(e => e.type==='buy' && e.cat===cat && predicate(e));
  if (i === -1) return;
  LOG.splice(i, 1);
  render();
}

function replacePatchSlot(slot, patch, label){
  if (!Object.values(PATCH_SLOTS).includes(slot))
    throw new Error(`replacePatchSlot: '${slot}' is not a canonical PATCH_SLOTS value`);
  // price the delta against the build with this slot's PRIOR event removed (not the current full LOG,
  // which would double-count this slot's own earlier contribution — see "Coalescing patch cost delta")
  const withoutSlot = LOG.filter(e => !(e.type==='buy' && e.cat==='patch' && e._slot===slot));
  const before = compute(foldBuild(withoutSlot)).total;
  const after  = compute(foldBuild([...withoutSlot, {type:'buy',cat:'patch',payload:{patch},_slot:slot}])).total;
  LOG = [...withoutSlot, {type:'buy',cat:'patch',payload:{patch},cost:after-before,label,_slot:slot}];
  render(); // note: LOG reassigned wholesale here, not spliced — SEQ/seq stamping happens in a follow-up
            // pass over the new tail event, kept out of this sketch for brevity; the real implementation
            // must still assign seq/ts/rules to the new slot event exactly as emit() does
}

function replaceWholeLogFromBuild(b, opts){
  LOG = buildToEventLog(b, opts);   // canonicalized burst, every event noLock:true — see Chunk 0
  SEQ = nextSeq(LOG);
  render();
}
```
(The `replacePatchSlot` sketch above elides the seq/ts stamping step for readability; the real
implementation stamps the new slot event through the same logic `emit()` uses, so no mutation path skips
sequencing.)

### Retractable-category allowlist (enforced at runtime, not just documented)

```js
const RETRACTABLE_FLAT_CATS = new Set([
  'save', 'skill', 'expertise', 'toolexpertise', 'tool', 'instrument', 'mastery',
  'racial', 'racialspell', 'boon', 'drawback', 'art',
  'feature', 'subabil', 'subbundle', 'unlockclass'
]);
```
`retractFlatEvent()` throws if called with any category outside this set — most importantly, it must
never be reachable for `'found'`, `'rank'`, `'cantrip'`, `'slot'`, `'known'`, `'dbound'`. This directly
protects the headline risk (indexed tradition/discipline event corruption) with a runtime guard, not just
a taxonomy in a markdown file.

### Patch slot registry

`_slot` values are no longer ad hoc strings invented per handler — a typo would silently produce a
duplicate patch event instead of replacing the old one, since `replacePatchSlot()`'s dedup logic matches
on exact `_slot` equality. Fixed registry:

```js
const PATCH_SLOTS = Object.freeze({
  IDENTITY: 'identity', STATS: 'stats', HD_PROF: 'hdProf', ECONOMY: 'economy',
  LANGUAGES: 'languages', ATTUNEMENT: 'attunement', KI: 'ki', SORCERY: 'sorcery',
  ARMOUR: 'armour', WEAPON_PROF: 'weaponProf', APPEARANCE: 'appearance',
  HOUSE_RULES: 'houseRules', CUSTOM_PROFS: 'customProfs', FREE_SUB: 'freeSub',
  TRADITIONS: 'traditions', NAMES: 'names', CAMPAIGN: 'campaign'
});
```
Rule: **all coalescing patch events must use one of these canonical values; handlers must not inline a
string literal for `_slot`.**

### Coalescing patch cost delta

For `replacePatchSlot(slot, patch, label)`, repeated edits to the same slot must be priced against the
state *with that slot's own prior event removed*, not against the current full LOG (which still contains
the old contribution and would double-count it). Invariant: **raising a stat 10 → 12 → 14 across multiple
edits must produce the same final total cost as one direct edit 10 → 14.** This must be explicitly manually
tested (see Verification) and is a good target for the optional new automated fixture in Chunk 6.

### Handler conversion taxonomy
The organizing axis is **coalesce vs. append vs. append-with-safe-removal**, driven directly by the
MUT-mutator distinction verified above, now backed by the runtime allowlist and slot registry.

**Category A — flat single-instance checkbox lists** (`saves/skills/expertise/toolExpertise/tools/
instruments/masteries/racialTraits/racialSpells/boons/drawbacks/arts`; MUT categories `save/skill/
expertise/toolexpertise/tool/instrument/mastery/racial/racialspell/boon/drawback/art`). One `emit({type:
'buy',cat,...})` per check; on uncheck, `retractFlatEvent(cat, predicate)` — safe *only* because these
mutators are flat pushes with no positional dependents, and now enforced by `RETRACTABLE_FLAT_CATS`. This
preserves today's exact UX (freely uncheck any previously-checked box, not just the most recent one)
without needing Step 4's general truncate-forward undo. It's invisible plumbing behind an *existing*
interaction, not a new undo affordance — no new button, no scope label, same checkbox behaving the same
way.

Illustrative before/after (real excerpt, then a representative — not literal-final — rewrite):
```js
// before — readBuild() (line 1168):
racialTraits:ckVals('racck'), ... saves:ckVals('saveck'),skills:ckVals('skillck'),expertise:ckVals('expck'),
// before — annotate() (line 1706-7), the post-hoc DOM correction that must be RETIRED (LOG invariant #5):
document.querySelectorAll('.racck').forEach(e=>{const rr=DATA.racial[e.value];...
  if(_oo&&e.checked)e.checked=false; e.disabled=((!ok&&!e.checked)||_oo); ...});
```
```js
// after — one dispatch table mined directly from readBuild()'s own ckVals() call sites:
const CHECKLIST_CAT = {racck:'racial', saveck:'save', skillck:'skill', expck:'expertise',
  toolexpck:'toolexpertise', mastck:'mastery', toolck:'tool', instck:'instrument',
  boonck:'boon', drawck:'drawback', artck:'art', linspellck:'racialspell'};
function onChecklistToggle(el){
  const cls = [...el.classList].find(c=>c in CHECKLIST_CAT); if(!cls) return;
  const cat = CHECKLIST_CAT[cls], v = el.value;
  if(el.checked){
    if(cat==='racial' && !raceTraitLegal(v)){ el.checked=false; return; } // pre-emit guard — lands WITH this handler (Category F rule)
    const cur=foldBuild(LOG), before=compute(cur).total;
    const cand=JSON.parse(JSON.stringify(cur)); (MUT[cat]||(()=>{}))(cand,{v});
    emit({type:'buy',cat,payload:{v},cost:compute(cand).total-before,level:cur.hd,label:catLabel(cat,v)});
  } else {
    retractFlatEvent(cat, e=>e.payload&&e.payload.v===v);
  }
}
```

**Category B — coalescing patches** (`name, stats, hd, profBonus, hardy/tough, languages, attune, ki,
sorcery, wornArmour, martiallyBound, gold, dabblerCantrips, size, weaponProf, armour, appearance,
houseRules/DM toggles, customProfs, freeSub, traditions/disciplines as one bulk field`). Every field in a
named slot (a `PATCH_SLOTS` value) *replaces* — not appends to — that slot's single LOG event via
`replacePatchSlot(slot, patch, label)`, exactly mirroring `buildToLiveLog`'s existing `emitPatch(label,
patch)` pattern.

**Traditions/disciplines specifically are Category B, not granular per-spell events, for Step 3 — this is
a hard rule, not a preference.** No Step 3 CharGen live-edit handler may emit or retract granular
tradition/discipline events (`found`, `rank`, `cantrip`, `slot`, `known`, `dbound`); the whole
`traditions` array is one coalescing patch under `PATCH_SLOTS.TRADITIONS`, exactly like `buildToLiveLog`
already does (`emitPatch('Spellcasting',{traditions:b.traditions,...})`). Today's UI already supports
deleting an *arbitrary* tradition/discipline card positionally (not historically), so this sidesteps the
general "safely remove an arbitrary indexed event and reindex everything after it" problem — explicitly
Step 4/undo-machinery territory — while keeping LOG the source of truth and arbitrary add/remove/reorder
working exactly as it does today.

**Category C — add-row lists with real MUT categories** (`features` via `feat2` rows, `subAbilities` via
`subabil` rows, `subSpellBundles` via `subbundle` rows, `unlockedClasses`). Same append/retract-in-place
pattern as Category A (these mutators are flat pushes too, all present in `RETRACTABLE_FLAT_CATS`),
sourced from the `addRow`/`.btn.x` remove-button flow instead of a static checkbox grid. The existing
gating checks in `classpick`/`subpick`'s `change` handlers (the `flash()` calls for "requires Warlock
discipline," "already bought," etc., lines 1215–1221) move to become pre-emit guards **in this same
chunk**, not a later generic cleanup pass (Category F rule, below).

**Category D — filterable grid rebuilds** (`buildBoonGrid`/`buildDrawGrid`/`buildArtGrid`). Currently
preserve checked-state across an innerHTML rebuild by reading `ckVals()` first; after conversion, read
current membership from `foldBuild(LOG)` instead. Converted **alongside Category A**, in the same chunk —
not deferred to late in the sequence — since boons/drawbacks/arts become LOG-owned in that same chunk, and
leaving the grids reading `ckVals()` afterward would temporarily reintroduce DOM-as-state behavior for
those categories specifically. All three grids converted explicitly (they're near-duplicated code; easy to
convert two and miss the third).

**Category E — whole-build replacement flows** (`loadFile`/`applyBuild`, `loadFromHash`/`shareLink`,
`_cgRestoreAutosave`, `randomizeRoll`). Converge on `replaceWholeLogFromBuild(b)` / `buildToEventLog(b,
opts)` (the LOG-mutation-API helpers defined above — a generalization of `buildToLiveLog`'s existing
`ev`/`emitPatch`/`evItem` funnel, already proven, already fixture-covered via D-GH34).
`randomizeRoll()` keeps mutating its in-memory scratch `b` object exactly as it does today (it already
uses MUT-shaped closures on a plain object, not DOM) — only its *last line* changes, from `applyBuild(b)`
to `replaceWholeLogFromBuild(b)`. `shareLink()`/`saveBuild()`/`exportToLiveSheet()` are read-only
consumers — trivial one-line swap from `readBuild()` to the same call, since `readBuild()` itself
eventually returns `foldBuild(LOG)`.

**Category F — derived auto-corrections** (STR<10 armour auto-uncheck, illegal cross-race trait
auto-uncheck, disabled-class-picker options, Warlock/Tasha/Ki/Sorcery/prerequisite gating). **These guards
move with the handler chunk that owns the state they guard, not as a separate late cleanup pass**: the
racial cross-race guard lands in the Category A chunk, the STR<10 armour guard lands in the Category B
chunk that converts armour/stats, and the Warlock/Tasha/Ki/Sorcery/prerequisite guards land in the
Category C chunk. Net user-visible behavior is identical (same flash message, same auto-uncheck), just
triggered before the event exists rather than corrected after. Once every guard has moved, `annotate()`'s
purity (LOG invariant #5 — no `.checked`/`.value` writes) is verified directly, not assumed.

**Category G — programmatic DOM/state writer audit (new).** Beyond the five taxonomy categories above,
every function that writes `.value`, `.checked`, `innerHTML`, appends/removes DOM nodes, or rebuilds
editable controls must be classified as one of:
1. **render-only** — writes DOM from `foldBuild(LOG)` (i.e. `paintFormControls`/`paintDerivedOutputs`).
2. **import-only** — replaces `LOG` from a flat build via `buildToEventLog()`/`replaceWholeLogFromBuild()`.
3. **non-state UI** — filters, modals, search boxes, display-only elements; not build state.
4. **migration target** — still mutates DOM as state; must be converted.

Grep targets for the audit: `.value =`, `.checked =`, `.innerHTML =`, `appendChild`, `replaceChildren`,
`insertAdjacentHTML`, `.remove()`, plus the named functions `addRow`, `addTrad`, `addDisc`. This exists
specifically to catch hidden helper routines that mutate controls programmatically without going through
a user-facing `input`/`change` event — the class of bug the Category A–F taxonomy alone could miss because
it's organized around user-facing handlers, not around every code path that happens to touch the DOM.

### Shadow-diff detection strategy (strengthened)

Post-render-only comparison can miss a real bug: a control changes → no event is emitted → `render()`
repaints from `LOG` → the DOM snaps back → post-render DOM and LOG now agree again, hiding the miss. Shadow
mode therefore compares **both before and after** each repaint:

```js
function render(){
  if (CG_SHADOW){
    shadowCompare('pre-render', canonicalBuild(_domReadBuild()), canonicalBuild(foldBuild(LOG)));
  }
  const b = readBuild();
  const r = compute(b);
  paintFormControls(b); paintDerivedOutputs(b, r); annotate(b, r);
  if (CG_SHADOW){
    shadowCompare('post-render', canonicalBuild(_domReadBuild()), canonicalBuild(b));
  }
}
```
`canonicalBuild()` sorts logically-unordered arrays, normalizes `undefined`/`null`, and strips transient
UI-only fields before comparing — comparing raw objects would false-positive on harmless ordering
differences. Shadow check hierarchy (do not rely on step 2 alone — two different builds can share a cost):
1. Compare canonicalized `fromDOM` vs canonicalized `fromLOG` field-by-field.
2. Compare key computed outputs, especially `compute(fromDOM).total` vs `compute(fromLOG).total`.
3. Compare important warnings/flags if available.

**Temporary state-event audit** (Chunks 0–5 only): a capture-phase listener on `#form` records every
user-facing `input`/`change` event; if the event's target looks like a state control and no handler called
`emit()`/`retractFlatEvent()`/`replacePatchSlot()` in response, shadow mode warns. Doesn't need to be
perfect — it exists to catch the common migration miss (a control still relying on the generic
`input`/`change` → `render()` fallback with no real LOG mutation behind it), not to be a general-purpose
static analyzer.

### Dev assertions (guardrails only — do not let these become their own project)

```js
assertFoldDoesNotMutateLog(LOG)          // LOG invariant #2
assertNoUnsafeRetracts(LOG)              // backs RETRACTABLE_FLAT_CATS at the LOG level, not just the API entry point
assertNoLiveIndexedTraditionEvents(LOG)  // LOG invariant #7 — most important of the four
assertPatchSlotsKnown(LOG)               // every _slot value is a PATCH_SLOTS member
```
Must not break the existing import/export paths that intentionally use the older `found`/`rank`/etc.
event vocabulary (the engine-level fixtures and Live-Sheet-format imports still legitimately use these
events; the assertion targets CharGen's *live-edit handlers specifically emitting or retracting* them, not
their mere presence in an imported LOG).

### Chunk source-of-truth policy — Option A (explicit)

Two viable policies were considered:
- **Option A (chosen):** `_domReadBuild()` stays the production source (`readBuild()` calls it) through
  Chunks 0–5, while `LOG` is built and shadow-checked in parallel. `readBuild()` flips to the one-line
  `foldBuild(LOG)` alias only in the final cleanup chunk. Fewer visible breakages mid-migration; each
  category chunk lands independently without depending on every other category being done. Trade-off:
  LOG-as-actual-source doesn't get fully exercised until the very end.
- **Option B (rejected for now):** flip `readBuild()` to `foldBuild(LOG)` early, so a missed handler fails
  loudly (the control visibly toggles, then snaps back on next render). Rejected because it makes every
  category chunk visibly broken for any field not yet converted, which is a worse fit for landing chunks
  independently and getting each one reviewed/merged on its own.

**Option A is the policy for this plan.** The flip point is explicit: Chunk 6 (cleanup) is where
`readBuild()` changes from `_domReadBuild()` to `foldBuild(LOG)`, after shadow-diff has been clean across
every category for at least one full manual pass.

### Sequencing / batching strategy

Land as independently-verifiable chunks, each staying green on `engine-parity.html` (unaffected —
`compute()` itself is untouched by this whole step) plus a repeatable manual regression pass. Resequenced
per review to pull forward the minimal LOG-bootstrap machinery and the grid conversions, and to split the
traditions/disciplines work into its own rollback boundary.

- **Chunk 0 — scaffolding.** `LOG`, `SEQ`, `emit()`, `retractFlatEvent()`, `replacePatchSlot()`,
  `RETRACTABLE_FLAT_CATS`, `PATCH_SLOTS`, `buildToEventLog(b, opts)`, `nextSeq(LOG)`,
  `replaceWholeLogFromBuild(b)` (minimal — full convergence of every whole-build-replacement call site is
  still Chunk 5, but the helper itself and an initial `LOG` bootstrap from the current DOM-derived build
  land here so every later chunk has a reliable way to seed/replace `LOG`). Rename the current DOM-reading
  logic to `_domReadBuild()`; `readBuild()` still calls it (Option A). Add the shadow-diff scaffold
  (pre-render + post-render, canonicalized, computed-output secondary check), the dev assertions, and the
  temporary state-event audit marker. Nothing user-facing changes yet.
- **Chunk 1 — Category A + Category D.** Flat checkbox lists (~12 field groups) converted to
  `emit()`/`retractFlatEvent()`; `buildBoonGrid`/`buildDrawGrid`/`buildArtGrid` converted to read
  membership from `foldBuild(LOG)` in the same chunk. The racial cross-race guard (Category F) moves here
  with the racial-trait handler. Verify: `engine-parity` unaffected; shadow-diff clean for these fields;
  manually exercise every checkbox category and all three grids against a captured golden reference build.
- **Chunk 2 — Category B, scalar/object fields.** Stats, hd, profBonus, vigor/grit, weaponProf, armour,
  appearance, houseRules/DM toggles, languages, attune/ki/sorcery, wornArmour, martiallyBound, gold, size —
  via `replacePatchSlot()` and the `PATCH_SLOTS` registry. The STR<10 armour auto-uncheck guard (Category
  F) moves here with the armour/stats handler. Verify the guard specifically, plus the repeated-edit
  cost-delta invariant (raise a stat in 3 steps; confirm total cost equals one direct raise — see
  Verification).
- **Chunk 3 — Category C.** `feat2`/`subabil`/`subbundle`/`unlockedClasses` add-row lists via
  `emit()`/`retractFlatEvent()`. Warlock/Tasha/Ki/Sorcery/prerequisite gating guards (Category F) move
  here with the feature/list handlers. Verify the gating flashes still fire at the right times.
- **Chunk 4A — coalescing-patch infrastructure hardening.** Any remaining low-risk `PATCH_SLOTS` fields
  not already covered by Chunk 2 (`customProfs`, `freeSub`), plus hardening `replacePatchSlot()`'s
  cost-delta logic and the `assertPatchSlotsKnown` check. A dedicated, smaller chunk specifically so the
  patch-slot machinery is solid *before* the riskiest chunk uses it.
- **Chunk 4B — traditions/disciplines bulk patch.** `addTrad()`/`addDisc()`/`refreshDiscOpts()` and the
  nested-card flows converted to one `replacePatchSlot(PATCH_SLOTS.TRADITIONS, ...)` call. Add
  `assertNoLiveIndexedTraditionEvents` as an active check for this chunk specifically. The riskiest chunk
  in the whole migration gets its own rollback boundary, separate from Chunk 4A's lower-risk
  infrastructure work. Verify with a caster-heavy manual build (multiple traditions, pact slots, arcanum)
  diffed against a golden reference, plus the traditions/disciplines regression test in Verification.
- **Chunk 5 — Category E.** `buildToEventLog()`/`replaceWholeLogFromBuild()` full convergence:
  `loadFile()`, `loadFromHash()`, `_cgRestoreAutosave()`, `randomizeRoll()`, `applyBuild()` (collapsed to
  a thin wrapper). `buildToLiveLog()`'s export funnel is reconciled with `buildToEventLog()` naming (a
  shared implementation, not two parallel converters). Verify: an existing CharGen-format fixture (e.g.
  `CG-002-valid-50ap-build.json`) still loads correctly; a Live-Sheet-LOG-format file still loads via
  `foldBuild(d.LOG)`; shared-link round-trip; a **pre-migration** autosave blob still restores; randomize
  still produces a legal, budget-respecting character.
- **Chunk 6 — cleanup + flip.** `readBuild()` finalizes as the one-line `foldBuild(LOG)` alias (the
  Option A flip point). Remove the Chunk 0 shadow-diff scaffolding, `_domReadBuild()`, and the temporary
  state-event audit marker. Delete now-dead direct-DOM-write code inside the old `applyBuild()`/
  `annotate()` that Categories A/B/C/F's guard-relocation made redundant. Verify `annotate()` purity
  directly (grep for `.checked =`/`.value =` inside it — should be zero). Confirm `_cgAutosave` still
  writes the same flat-JSON shape under the same key (Autosave compatibility invariant, below).

## Files involved
- **`tools/PACT-CharGen-Webtool.html`** — the entire change. `readBuild()`, `render()` (split into
  `paintFormControls`/`paintDerivedOutputs`/`annotate`), `applyBuild()` (collapsed to a thin wrapper),
  `annotate()` (guard relocation + purity), `buildBoonGrid()`/`buildDrawGrid()`/`buildArtGrid()`,
  `addRow()`/row-remove handlers, `addTrad()`/`addDisc()`/`refreshDiscOpts()`, `randomizeRoll()`'s last
  line, `loadFile()`, `loadFromHash()`, `_cgRestoreAutosave()`, `buildToLiveLog()` (reconciled with the new
  `buildToEventLog()`), `_cgAutosave()`'s input source. New: `LOG`, `SEQ`, `emit()`, `retractFlatEvent()`,
  `replacePatchSlot()`, `replaceWholeLogFromBuild()`, `buildToEventLog()`, `nextSeq()`,
  `RETRACTABLE_FLAT_CATS`, `PATCH_SLOTS`, the dev assertions, the Chunk-0 shadow-diff scaffold (temporary,
  removed in Chunk 6).
- **`js/engine.js`** — **no changes expected.** `compute()` is untouched; Step 3 only wires CharGen's own
  UI/state layer onto the already-exported `MUT`/`foldBuild`/`activeEvents`/`economy`/`baseBuild`.
- **`testing/tests/engine-parity.html` / `testing/fixtures/`** — no changes required for existing
  fixtures (they exercise `compute()`/`rebuildStateFromEvents()` directly, not CharGen's DOM, and stay
  valid since `compute()` doesn't change). **Optional enhancement, recommended but not required:** after
  Chunk 6, hand-export one full LOG produced by the new CharGen UI as a new fixture (e.g.
  `CG-007-chargen-native-log-round-trip.json`) and add a parity assertion that
  `compute(foldBuild(thatLOG)).total` matches a hand-verified expected number, plus a fixture covering the
  repeated-edit-same-final-total invariant.

## Out of scope (Step 4+ territory — explicitly not touched here)
- Pill UI, inline per-purchase undo buttons, scope labels ("↶ 4"), global Undo/Redo buttons in chrome.
- `REDO`/`viewAt` time-travel — Step 3's `LOG` has no redo stack and no history-browsing view.
- The `{LOG,SEQ,rules,id,schema}` localStorage persistence shape — autosave stays flat-JSON, same key,
  same contract (see Autosave compatibility invariant).
- `lock` field on award events, `undo()` semantics, campaign-bound/`creationLocked` triggers, fork,
  file rename, `SHEET_TOOL` updates — all untouched.
- Live Sheet's affordability/duplicate/legality **blocking** behavior (`buy()`'s gating) — CharGen keeps
  its current "build past budget freely, show a warning" UX.
- General truncate-forward "remove an arbitrary event and everything depending on it" — `retractFlatEvent`
  is a splice-in-place operation scoped to `RETRACTABLE_FLAT_CATS` only, not a general undo primitive, and
  must never touch indexed tradition/discipline events (enforced at runtime).
- Granular per-spell-pick (`found`/`rank`/`cantrip`/`slot`/`known`/`dbound`) live event sourcing for the
  traditions/disciplines editor — stays one coalescing bulk patch under `PATCH_SLOTS.TRADITIONS` for the
  whole of Step 3 (hard rule, backed by `assertNoLiveIndexedTraditionEvents`).
- Option B (early flip of `readBuild()` to `foldBuild(LOG)`) — considered and explicitly rejected in favor
  of Option A for this plan.

## Autosave compatibility invariant

Explicit statement, not left implicit: autosave remains a **folded-build persistence contract** in Step 3.
`_cgAutosave()` must save only the flat result of `foldBuild(LOG)` (or, pre-Chunk-6, its DOM-derived
equivalent) under the existing `pactCharGenAutosave` key. It must not persist or depend on `SEQ`, event
timestamps, event identity, or granular `LOG` history. `_cgRestoreAutosave()` must continue to load
pre-migration flat-JSON blobs and convert them into a fresh canonical `LOG` through the same whole-build
replacement path (`replaceWholeLogFromBuild`) used by the file/hash/randomize flows. This keeps Step 3
correctly separated from Step 4's LOG-shaped persistence work.

## Risks / open questions
- **Headline risk — index corruption if the flat-push/indexed-mutator distinction is bypassed.** Mitigated
  architecturally (traditions/disciplines stay Category B for all of Step 3) *and* at runtime
  (`RETRACTABLE_FLAT_CATS` throws on misuse; `assertNoLiveIndexedTraditionEvents` is an active dev check
  during Chunk 4B specifically).
- **"Missed site" failure mode changes character across the migration, by design (Option A).** During
  Chunks 0–5, a missed site is a silent divergence between `foldBuild(LOG)` and `_domReadBuild()` —
  exactly what the strengthened (pre- *and* post-render) shadow-diff is built to catch; a post-render-only
  check could miss a "control changes, no event emitted, DOM snaps back" case that the pre-render check
  catches. After Chunk 6's flip, a missed site instead fails *loud* (control toggles, then visibly
  snaps back on next render) — an obvious manual-testing signal. The state-event audit marker is a second,
  independent net for the case where a control's `input`/`change` never reaches any LOG-mutation call at
  all.
- **Coalescing-patch cost-delta correctness.** `replacePatchSlot`'s delta must be priced against the
  build with that slot's *own prior event removed*, not the current full LOG. Explicit manual test
  required (see Verification) and a good target for the optional new fixture in Chunk 6.
- **Patch-slot typos silently duplicating events.** Mitigated by the frozen `PATCH_SLOTS` registry plus
  `assertPatchSlotsKnown` — a handler cannot invent an inline `_slot` string that `replacePatchSlot`
  would silently accept.
- **Pre-migration autosave compatibility.** Explicit manual test case: load an old, pre-migration autosave
  after Chunk 5 lands, confirm it converts correctly via `replaceWholeLogFromBuild`.
- **`engine-parity.html`'s structural blind spot is a known, separately-tracked gap** (per the
  racial-trait-pricing-regression-fix plan's own Risks section: "no headless runner for the full HTML
  tools exists yet"). Step 3 does not attempt to build that infrastructure; it relies on the strengthened
  shadow-diff (migration-time only), the Category G programmatic-writer audit, manual golden-build
  checklists, and the optional new fixture (Chunk 6) as partial, pragmatic mitigations — not a full
  solution.
- **Grid-regen churn** is addressed by pulling `buildBoonGrid`/`buildDrawGrid`/`buildArtGrid` forward into
  Chunk 1 rather than leaving them until Chunk 5, closing the window where they'd read stale `ckVals()`
  after their categories become LOG-owned.
- **Perf** — Category B's before/after `compute()` delta pricing runs up to two `compute()` calls per
  input event instead of `render()`'s existing one. `buildToLiveLog` already does this same pattern with
  no reported perf issue, and CharGen builds are single-character scale, so this is noted as considered,
  not treated as a blocker.

## Verification

### Automated
- `testing/tests/engine-parity.html` stays green at its current baseline (16/0) after every chunk —
  `compute()` is untouched by this step, so no `DATA.version` bump is expected.
- Optional (recommended): one new fixture asserting a real CharGen-native LOG (captured post-Chunk-6)
  folds and prices identically to a hand-verified expected total, plus a fixture covering the
  repeated-edit-same-final-total invariant.

### Manual (browser), per chunk
- Before starting Chunk 1, capture 2–3 "golden" reference builds (a simple martial build, a multi-tradition
  caster, and a build exercising racial traits/drawbacks/boons near the pricing-lock threshold) as JSON
  snapshots with their hand-verified `compute()` totals from the *current, pre-Step-3* CharGen. After each
  chunk, reproduce each golden build click-by-click in the migrated UI and confirm an identical final
  price and field set (deep-equal on the rendered flat build, not on DOM state).
- Chunk-0-specific: the shadow-diff console check reports zero divergence, both pre- and post-render, for
  every field touched by later chunks (spot-check with a manual `LOG` seeded from a golden build).
- Chunk-1-specific: all three grids (`buildBoonGrid`/`buildDrawGrid`/`buildArtGrid`) preserve checked
  state across a filter/search change.
- Chunk-2-specific: STR<10 still auto-deselects Medium/Heavy armour with the same flash message.
  **Repeated scalar edit test:** raise a stat (or another `PATCH_SLOTS` field) in multiple steps; compare
  final `compute(foldBuild(LOG)).total` against one direct edit to the same final value — must match.
- Chunk-3-specific: Warlock/Tasha/Ki/Sorcery/prerequisite gating flashes still fire correctly for feature
  picks.
- Chunk-4B-specific (traditions/disciplines regression): create a multi-tradition caster; add/remove
  arbitrary tradition and discipline cards; confirm the final folded build and computed total match a
  pre-migration golden build.
- Chunk-5-specific: load `testing/fixtures/builds/CG-002-valid-50ap-build.json` (or equivalent); load a
  Live-Sheet-exported `-livesheet.json` file; round-trip a shared link; restore a pre-migration autosave;
  run "🎲 Randomize" and confirm the result stays within budget with no new hard warnings.
- Chunk-6-specific (annotate purity test): after guard relocation, grep `annotate()`'s body and confirm it
  contains no `.checked =` or `.value =` assignment.
- Programmatic writer audit (Category G, run once before Chunk 6 closes): grep the whole file for
  `.value =`, `.checked =`, `.innerHTML =`, `appendChild`, `replaceChildren`, `insertAdjacentHTML`,
  `.remove()`; classify every hit as render-only / import-only / non-state UI / migration target; confirm
  zero remain classified "migration target."
- After Chunk 6: the full CharGen UI works end-to-end with no visible behavior change from before Step 3
  started — every category of control, every existing flash/warning message, identical.

## Done when
1. `LOG`/`SEQ`/`emit()`/`retractFlatEvent()`/`replacePatchSlot()`/`replaceWholeLogFromBuild()` exist in
   CharGen as the sole `LOG`-mutation surface; `readBuild()` is the one-line `foldBuild(LOG)` alias; no
   handler site mutates DOM elements as state (DOM is render output only, verified by the Category G
   audit finding zero remaining "migration target" writers).
2. All ~80 raw handler sites are converted per the taxonomy above, including the grid conversions
   (Chunk 1) and the split traditions/disciplines work (Chunks 4A/4B).
3. `RETRACTABLE_FLAT_CATS` and `PATCH_SLOTS` are the only ways to retract/patch, both enforced at runtime;
   `assertNoLiveIndexedTraditionEvents` confirms no live handler ever emits/retracts a granular
   tradition/discipline event.
4. `engine-parity.html` stays at its current baseline (16/0); no `DATA.version` bump.
5. The Chunk-0 shadow-diff scaffolding, `_domReadBuild()`, and the state-event audit marker are removed;
   no migration-only code remains in the shipped file.
6. All manual golden-build checks (per Verification) pass with zero deviation from pre-Step-3 CharGen
   behavior — including the STR-armour guard, the racial-trait cross-race guard, feature-gating flashes,
   the repeated-edit cost-delta invariant, and the "freely uncheck any previously-checked box" interaction.
7. `annotate()` is verified render-only (no `.checked`/`.value` assignment) — LOG invariant #5 confirmed,
   not assumed.
8. `_cgAutosave`/`_cgRestoreAutosave` still round-trip the same flat-JSON contract under the same
   localStorage key, including loading a pre-migration autosave for the first time post-migration
   (Autosave compatibility invariant confirmed).
9. `CHANGELOG.md` records the change; `DECISIONS.md` gets an entry covering the flat-push-vs-indexed
   removal-safety distinction (and its runtime enforcement), the deliberate persistence-contract seam
   deferring `{LOG,SEQ,rules,id,schema}` to Step 4, and the Option A source-of-truth policy — all
   findable by a future agent working on Step 4.

---

## Review outcome

Cold-reviewed 2026-07-09. Reviewer's final position: **"Proceed with the plan, please amend it before
implementation."** All 18 requested amendments folded into this revision:
1. LOG invariants section — added.
2. Single LOG mutation API (`emit`/`retractFlatEvent`/`replacePatchSlot`/`replaceWholeLogFromBuild`) —
   added, formalized as the sole `LOG`-mutation surface.
3. Runtime-enforced `RETRACTABLE_FLAT_CATS` allowlist — added.
4. Hard rule forbidding live granular tradition/discipline events — added, backed by
   `assertNoLiveIndexedTraditionEvents`.
5. `PATCH_SLOTS` fixed registry — added.
6. Coalescing patch cost-delta rule made precise, with an explicit manual test — added.
7. `paintFormControls`/`paintDerivedOutputs`/`annotate` render-ownership split; `applyBuild` collapsed to
   a thin wrapper — added to Target architecture.
8. Category G (programmatic DOM/state writer audit) — added to the taxonomy and Verification.
9. Shadow-diff strengthened with pre- *and* post-render comparison, canonicalization, and a
   computed-output secondary check — added.
10. Temporary state-event audit marker — added to Chunk 0 and the shadow-diff section.
11. Minimal `buildToEventLog`/`nextSeq`/initial LOG bootstrap moved into Chunk 0 (full convergence stays
    in Chunk 5) — resequenced.
12. Grid conversions (`buildBoonGrid`/`buildDrawGrid`/`buildArtGrid`) moved into Chunk 1 alongside
    Category A — resequenced.
13. Chunk 4 split into 4A (patch infrastructure hardening) and 4B (traditions/disciplines bulk patch) —
    resequenced.
14. Category F guards now land with their owning handler's chunk, not a late generic cleanup — restated
    explicitly per category.
15. Autosave compatibility invariant — added as its own explicit section.
16. Chunk source-of-truth policy — added explicitly; Option A chosen (defer the `readBuild()` flip to
    Chunk 6), Option B documented as considered-and-rejected.
17. Dev assertions — added (`assertFoldDoesNotMutateLog`, `assertNoUnsafeRetracts`,
    `assertNoLiveIndexedTraditionEvents`, `assertPatchSlotsKnown`).
18. Verification section expanded with the repeated-edit test, grid rebuild test, programmatic writer
    audit, annotate purity test, autosave legacy test, and traditions/disciplines regression test.

No further review round requested by the reviewer ("proceed... with those additions"). Ready to write to
`docs/plans/` and begin Chunk 0.
