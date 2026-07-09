# Phase 2 Step 5 — fold name + budget into the LOG (retire the DOM shims)

> **Status:** DRAFT — for review before implementation.
> **Branch:** `feat/chargen-name-budget-events` (from `preview`, post-Step-4 merge).
> **Scope:** `tools/PACT-CharGen-Webtool.html` only. **No `js/engine.js` change** — the engine already
> folds both event types (verified: line 512 `if (e.type==='name') b.name=e.name`; line 456 `award → earned`
> → `b.budget = base + earned`). `engine-parity` stays 20/0 by construction.

## Goal
Retire the last two Step-3 compatibility shims. Today `readBuild()` overrides `b.name` and `b.budget` from
the DOM (`#cname`, `#budget`) because CharGen's *live* edits to those fields don't update the LOG. Step 5
wires them to the LOG's native event types — a `name` event and an `award` event — so a CharGen character
is **fully** event-sourced: `readBuild() = foldBuild(LOG)` with no DOM overrides.

## Why the machinery already exists
- The engine's `foldBuild` applies `name` events (`b.name = e.name`, last wins) and derives `budget` from
  `award` events (`b.budget = baseBudget + Σ award.amount`). CharGen imports the **real** engine `foldBuild`
  (D-GH33), so this Just Works once the events are in the LOG.
- CharGen's export burst (`_buildEventBurst`) and boot seed already emit `{type:'award',…}` and
  `{type:'name',…}`. So the LOG *already contains* an award + name event after any whole-build rebuild
  (boot/load/reset/randomize). They just go **stale** on live edits — which is exactly what the shim papers
  over. Step 5 keeps them fresh.

## The one semantic to get right: NO award-locking (the roadmap's "AP-award lock semantics")
In the **Live Sheet**, an `award` event *locks undo history* (you can't undo buys made before an award) —
appropriate for actual play. CharGen is a **creation** tool: budget is a freely-editable creation
parameter, and undo must work across budget edits. CharGen's snapshot-based undo (Step 4) has **no**
award-lock guard, so this is automatically correct — but the plan states it explicitly so no one adds
Live-Sheet-style locking here. The budget award is also irrelevant to the creation-pricing lock
(`_spent` counts buys, not awards; CharGen emits no `campaignBound`, so D-GH32's automatic lock never
fires). We tag the live award `noLock:true` to match the export burst's convention (a no-op for awards,
but consistent and future-proof if the character is later exported/imported).

## Design

### D1 — Coalescing singleton events (`name`, `award`)
A LOG carries **at most one** `name` event and **at most one** `award` event (budget). Editing the field
replaces that singleton (filter-out-and-append), exactly like `replacePatchSlot` does for patch slots — but
these are `type:'name'`/`type:'award'`, not `cat:'patch'`. New helper, mirroring `replacePatchSlot`'s
structure so it participates in undo the same way:
```
function _cgSyncSingletonEvent(type, makeEvent){   // type: 'name' | 'award'
  const without = LOG.filter(e => e.type !== type);
  const cur = LOG.find(e => e.type === type);
  const next = makeEvent();
  if (cur && JSON.stringify({...cur,seq:0,ts:0}) === JSON.stringify({...next,seq:0,ts:0})) return; // no-op skip
  commitHistory();                                  // Step-4 undo integration
  LOG = without.concat([{...next, seq:SEQ++, ts:Date.now(), rules:DATA.version}]);
  render();
}
function _cgSyncName(){ const nm=val('cname')||'';
  _cgSyncSingletonEvent('name', ()=>({type:'name', name:nm, label:'Name — '+(nm||'(unnamed)')})); }
function _cgSyncAward(){ const amt=+val('budget')||DATA.level1AP;
  _cgSyncSingletonEvent('award', ()=>({type:'award', amount:amt, note:'Budget', noLock:true,
                                        label:'Award — budget ('+amt+' AP)'})); }
```
Ordering is irrelevant (economy sums awards; fold takes the last name; the ledger renders from
`compute().lines`, not raw events — verified), so append is safe and simplest.

### D2 — Wire the two fields
`#cname` and `#budget` are deliberately *excluded* from `PATCH_FIELD_SLOT` (they were shims). Route them at
the top of `onPatchFieldChange` (which the existing text-input delegation already calls, and which already
sets the Step-4 coalesce key for these textish fields, so keystrokes coalesce into one undo step):
```
if (id === 'cname')  { _cgSyncName();  return; }
if (id === 'budget') { _cgSyncAward(); return; }
```

### D3 — Retire the shims
`readBuild()` becomes `return foldBuild(LOG);` (drop the `b.name`/`b.budget` DOM overrides and the shim
comment). Because `#budget` still needs a sane default when empty, `_cgSyncAward` falls back to
`DATA.level1AP`, and the boot award is seeded from the DOM default as today.

### D4 — Undo frames no longer special-case name/budget
Step-4's `restoreFrame` set `#cname`/`#budget` from the frame (because they were outside the LOG). Now
`applyBuild(foldBuild(f.log))` repaints them from the folded build (the LOG carries them), so the frame's
`name`/`budget` fields and the post-`applyBuild` overrides in `restoreFrame` become **redundant** — remove
them. `_snapshotFrame` drops `name`/`budget` (keeps `log`, `seq`, `id`). This also removes the Step-4
"undoing a buy reverts a later name edit" limitation — name/budget are now first-class undo steps.

### D5 — Persistence: envelope + Step-4 back-compat
- The envelope's top-level `name`/`budget` become **derivable** from the LOG. Keep writing `name`
  top-level (mirrors the Live Sheet export shape); `budget` may stay for human-readability but is no longer
  authoritative.
- **Back-compat risk (transition):** a *Step-4*-saved envelope may hold a top-level `budget` that differs
  from its LOG's (stale) award — and Chunk C's load reinstates the authoritative LOG, which would show the
  stale award, ignoring the top-level budget. Fix in `_cgApplyEnvelope`: after reinstating `LOG=d.LOG`,
  **reconcile** — if `d.budget`/`d.name` are present and differ from `foldBuild(LOG)`, update the LOG's
  award/name singleton to the envelope's top-level value (via `_cgSyncSingletonEvent` with history
  suspended). Step-5 files are already consistent, so this is a no-op for them; it only heals older files.
- Legacy flat builds (branch 3) and Live-Sheet exports (branch 2) are unaffected — `applyBuild` →
  `_buildEventBurst` emits fresh award/name from the build, as today.

## Chunks
- **Chunk A** — `_cgSyncSingletonEvent` + `_cgSyncName`/`_cgSyncAward`, wire into `onPatchFieldChange`, drop
  the `readBuild()` shims. Verify V1–V3.
- **Chunk B** — simplify `restoreFrame`/`_snapshotFrame` (drop name/budget capture) + the `_cgApplyEnvelope`
  reconcile for Step-4 files. Verify V4–V5.

## Verification (browser, Playwright)
- **V1 — Live edit is event-sourced:** type a name / change budget → `foldBuild(LOG).name`/`.budget` match
  the fields with **no** DOM override in `readBuild()`; exactly one `name` and one `award` event in LOG.
- **V2 — Coalescing + undo:** typing a name = one undo step; undo restores the prior name; a budget change
  then undo restores the prior budget (name/budget now first-class undo steps).
- **V3 — Singleton invariant:** many name/budget edits never accumulate >1 `name`/`award` event; no-op
  re-entry of the same value adds no event and no undo step.
- **V4 — Frame simplification:** undo/redo across mixed edits (checkbox + name + budget + stat) round-trips
  `canonicalBuild` **and** name/budget; `randomize→undo` restores pre-randomize name/budget.
- **V5 — Persistence:** a Step-5 save round-trips name+budget through the LOG (no top-level reliance); a
  **simulated Step-4 file** (top-level budget ≠ stale LOG award) loads to the **top-level** budget (reconcile
  heals it); legacy flat + Live-Sheet loads still carry name/budget; engine-parity 20/0.
- Full Step-4 regression (Chunks A–D) stays green.

## Rollback
Chunk A is additive (two new sync functions + two routing lines) plus a 3-line `readBuild()` change;
reverting restores the shims. Chunk B is a simplification + one reconcile block; reverting leaves name/budget
captured in frames (harmless). No engine or schema change to roll back.

## Out of scope
- File renames (the `-v0` snapshot cleanup).
- Any Live-Sheet award-locking behavior (explicitly *not* wanted in CharGen — see the semantic note).
