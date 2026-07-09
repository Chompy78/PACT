# Phase 2: Unify CharGen and Live Sheet as interchangeable views over a shared character model

## Status

Design is settled. This document supersedes an earlier draft (`phase2-plan-preview.md`, which proposed
Option C — save-format-only unification, never written to disk) — rejected during review as optimising
for the wrong end-state; see "Design decisions & rationale" below.

## Goal

**The character is the LOG.** CharGen and Live Sheet become two interchangeable UI views over a single
shared character model. A user can create a character in CharGen, save it, open it in Live Sheet,
continue playing, reopen it in CharGen, continue editing, switch back to Live Sheet — at any point, with
no conversion step and no loss of information.

The two HTML files remain physically separate for now (merging into one file is out of scope) but stop
being sibling implementations. They become views mounted against the same append-only LOG, using the same
engine mutators, sharing the same undo/redo/economy machinery.

## Architectural principle

Every design decision within this phase (and later phases) should be evaluated against a single question:

> **Does this move CharGen closer to becoming another UI over the shared character model, or does it
> reinforce two separate implementations that merely share a file format?**

Optimise for the former.

## Design decisions & rationale

The following decisions are settled and should not be re-litigated during implementation without
escalation. They came out of a long design discussion; the short "why" is captured here so a fresh reader
doesn't have to reconstruct the argument.

### 1. CharGen adopts Live Sheet's runtime model, not the other way around

Live Sheet already has the correct architecture: append-only `LOG`, `emit()`, `foldBuild()`, `MUT`
mutators, `economy()`, `undo`/`redo`, `viewAt` time-travel. CharGen has the wrong one: no persistent state
object, `readBuild()` re-derives from DOM on every call, ~75 handler sites mutate DOM directly.

Phase 2 rewrites CharGen to use Live Sheet's model. All ~75 handler sites are touched. This is explicitly
in scope — it's the point of the phase.

### 2. Undo/redo is in Phase 2, not deferred

The original plan deferred undo/redo. That was correct for Option C (save-format only). Under the
interchangeable-views requirement, undo/redo is unavoidable: CharGen must operate on the LOG in real time,
and un-checking a committed selection must be a real reversing event (not silent state rewrite), because
the LOG must remain append-only if both views are to see consistent state.

CharGen inherits Live Sheet's existing undo/redo machinery mostly for free. No per-category "reverse"
mutators are needed — the truncate-forward model handles reversal by popping/redoing events, not by
inverting them.

### 3. Truncate-forward undo, no per-category remove mutators

Un-doing a committed selection removes that event and every event after it (the subsequent history
depends on it). To scope the cost, the inline undo button labels itself when it removes more than the
leaf event (e.g., "↶ 4" or "Undo (+4 later)").

A general per-category "remove" mutator (Option B in the original doc) is explicitly out of scope.
Truncate-forward + global Redo covers the real use cases at a fraction of the engine surface.

### 4. Awards carry an explicit `lock: boolean` field (Version B)

Today's rule "AP awards lock your history" is hard-coded in `undo()` (with a `!disc` escape hatch). This
becomes an explicit `lock` field on award events:

- **Default `true`** when the field is absent (backward compat) and when the DM's "+ Award AP" flow
  emits (matches today's behaviour).
- **`false`** on Discount awards (matches existing `disc:true` behaviour), CharGen's starting-budget
  award, and any DM house-rule bonus awards.

`undo()` checks `lock`, not `!disc`. Error message reworded to be honest about *which* award locked
history.

### 5. CharGen emits award events for its starting budget

The DM-set budget (default 50 AP) that CharGen currently tracks as a magic number becomes one or more
award events at the head of the LOG, tagged `lock: false`. House-rule bonuses become additional
`lock: false` awards. `economy()` handles both tools identically — the two parallel data models (CharGen's
"budget", Live Sheet's "earned") collapse into one.

### 6. `creationLocked` has four triggers, all emitting the same event

1. **Explicit user action** — a "Finalise character" button. Primary intended path.
2. **Threshold-based auto-fire** — cumulative AP spend (excluding `noLock:true` events) crosses
   `DATA.level1AP`, **but only if** the character has a `campaignBound` event in its LOG. Locally-only
   characters never auto-lock via the threshold.
3. **Campaign binding** — retroactively fires at the moment of binding if the character is already
   past-threshold.
4. **First locking AP award** — the DM awarding real session AP (`lock:true`) to a still-unlocked
   character auto-fires `creationLocked` immediately before the award event.

The LOG doesn't care which trigger fired; downstream logic treats `creationLocked` uniformly.

### 7. `campaignBound` is a LOG event carrying a campaign ID

A `campaignBound` event marks when a character joins a campaign. It carries a campaign ID payload. The
event is the signal that gates the threshold-based auto-lock (decision 6.2 above).

The DM's campaign screen produces a token that pushes the campaign's rules version and starting AP to the
player tool; redeeming the token emits the `campaignBound` event with the campaign ID.

### 8. "Unbind" is fork, not detach

There is no operation that mutates a campaign-bound character to remove its campaign tag. What's
colloquially called "unbind" is really **fork**:

- Produces a **new local copy** of the character with a fresh `charId` and no campaign binding.
- The **campaign character is completely untouched** (invisible on the original — no `forked` event is
  emitted, no state changes).
- The **fork remains locked**. It's the same character, minus the campaign binding. Not a
  reset-to-creation-mode.

"Clone as template" (fork that resets to unlocked creation) is a separate future feature, explicitly out
of scope for this phase.

### 9. The DM sees in-creation characters in their campaign

Characters that are `campaignBound` but not yet `creationLocked` are visible to the DM with a status
indicator distinguishing them from locked characters. Detail of the DM UI is Phase 3+; Phase 2 just
ensures the data is queryable.

### 10. Redo does not survive save/reload

Matches Live Sheet's existing behaviour: `save()` persists `LOG`, `SEQ`, `rules`, `id` — not `REDO`.
Reload = empty redo stack. This is deliberate; it avoids cross-session redo-state ambiguity.

### 11. UX is phone-first

Most users are on phone. Design implications:

- **Global Undo/Redo buttons** in the app chrome, always visible, showing enabled/disabled state. Live
  Sheet already has these in `#lmobar-acts`; CharGen inherits the pattern.
- **Committed selections become pills** with an inline undo button. Scope label when non-trivial (e.g.,
  "↶ 4" or "Undo (+4 later)"). Icon-plus-badge preferred over prose for space.
- **No keyboard shortcuts** (phone-first).
- **No transient toast** (redundant with persistent Redo).
- **No confirmation modals** (scope label on button + Redo affordance handles safety).

### 12. Two files, physically separate; renamed as part of Phase 2

The two HTML files remain physically separate. Merging into one file with a view toggle is out of scope.

Both files are renamed. Current names (`PACT-CharGen-Webtool.html` and `PACT-Live-Char-Sheet.html`) frame
the tools as separate implementations; post-Phase-2 that framing is wrong. New names TBD (candidates:
`PACT-Player-Tool-Builder.html` + `PACT-Player-Tool-Sheet.html`, or similar). Naming decision is a task
within Phase 2, not a prerequisite.

### 13. The LOG plays two subtly different roles

- **Live-authored LOG**: each event is a real user action in real temporal order. Editing history in the
  strict sense.
- **Canonically-serialized LOG**: emitted by the legacy-import path for flat-JSON CharGen saves. Events
  represent "here is the current state, expressed as events" — not real editing history. Timestamps and
  ordering are synthetic.

Both are valid LOGs; consumers must not assume ordering reflects real editing chronology.

### 14. Schema versioning separate from rules versioning

Existing `RULES` / `loadedRules` / `DATA.version` machinery tracks the rules content version. A separate
`schema` field is added to saved files to version the LOG structure independently. New-format saves emit
`schema: "2"`; absent `schema` field means legacy v1 (flat build). This lets the LOG structure evolve
without rules churn, and vice versa.

## Assumptions vs. verified facts

### Verified (from reading `PACT-Live-Char-Sheet.html` and `PACT-CharGen-Webtool.html`)

- Live Sheet's runtime model is exactly the architecture Phase 2 needs: `LOG`, `REDO`, `SEQ`, `viewAt`,
  `emit()`, `undo()`, `redo()`, `foldBuild()`, `activeEvents()`, `economy()`, `MUT` — all present and
  working.
- `save()` persists `{LOG, SEQ, rules, id}` — deliberately not `REDO`.
- The current "awards lock history" rule lives on one line in `undo()`; the `!disc` check is the only
  existing per-award exemption.
- CharGen already imports `DATA` and `compute` from `js/engine.js`. `MUT`, `foldBuild`, `activeEvents`,
  `economy`, `baseBuild` are what still need to be moved from CharGen-local throwaways to real engine
  imports.
- Live Sheet has a phone-first bottom bar (`#lmobar`) with Undo/Redo buttons already implemented —
  CharGen's pattern to match.
- CharGen's `exportToLiveSheet()` and `buildToLiveLog()` become unnecessary once CharGen is event-sourced
  (files become interchangeable; no synthesis needed).
- Cloud save and campaign concepts exist in the current UI (`cloudBtn`, `cloudMenu`, `campchip`), but
  their relationship to the engine is not yet verified from the code alone.

### Assumed (should be confirmed during implementation)

- Cloud-save and campaign-binding are separable concepts (a user can have personal cloud saves not bound
  to a campaign). If they're actually one-to-one today, the `campaignBound` event still works but the
  terminology in the plan should reflect that.
- The DM screen already produces some kind of token for player onboarding, or the token-issuance flow is
  straightforward to add. If the DM screen doesn't exist yet in a useful form, that's Phase 3+ scope and
  Phase 2 should stub the token-redeem path.
- Rewriting ~75 handler sites is mechanical work with a predictable failure mode (a missed site continues
  to mutate DOM instead of emitting). Not architecturally hard; just tedious. If any handler proves
  genuinely resistant to the event-sourced pattern, that's a signal to escalate before working around it.

## Proposed approach — sequenced

Ordering deliberately puts the risky architectural work first (recoverable through git) and the
mostly-mechanical rename late (safe and easy). If capacity requires splitting into 2a/2b, the natural cut
is between step 8 and step 9.

1. **Engine module surface expansion.** Extend `js/engine.js` to export `MUT`, `foldBuild`,
   `activeEvents`, `economy`, `baseBuild`, `emit` (or the necessary helpers). Add support for the new
   event types (`campaignBound`) and the `lock` field on award events. No HTML file changes yet.
2. **CharGen imports the expanded engine surface.** Replace CharGen's two local throwaway copies of
   `MUT`/`foldBuild`/`activeEvents`/`economy` with real imports. CharGen still runs on DOM-derived state
   at this point — just sourcing shared functions. Confirm no regression via existing tests and manual
   play-through.
3. **CharGen's handlers rewritten to emit.** The ~75 sites. Each becomes: user action → `emit(event)` →
   LOG grows → render from folded LOG. `readBuild()` becomes `foldBuild(null)`; DOM stops being state,
   becomes render output. This is the large mechanical lift.
4. **CharGen adopts LOG-as-state.** Pill UI with inline undo button (icon + scope badge). Global
   Undo/Redo in chrome. Persistent state in `localStorage` under a CharGen-specific key that stores the
   same `{LOG, SEQ, rules, id, schema}` shape as Live Sheet.
5. **Award/lock semantics.** Add `lock` field to award events, default `true` when absent, explicit
   `false` for Discounts, CharGen's starting budget, and house-rule bonuses. Update `undo()` to check
   `lock` instead of `!disc`. CharGen's budget input emits a `lock:false` award instead of setting a
   magic number.
6. **Campaign binding & lock triggers.** Add `campaignBound` event type carrying a campaign ID. Wire the
   four `creationLocked` triggers (explicit button, threshold + campaign-bound, campaign-binding
   retroactive, first locking award). DM token flow for pushing rules + starting AP into the player tool.
7. **Fork behaviour.** "Unbind" action forks the character: new `charId`, campaign tag stripped, LOG
   copied verbatim, locked stays locked. Original untouched. `currentCharId()` updated to know when it's
   minting a new id for a fork versus reusing.
8. **Backward compat + determinism.** Legacy flat-JSON CharGen saves import via the existing
   `_lsImportFold`-adjacent path, producing canonically-serialized LOGs. Add a determinism fixture:
   import the same flat-JSON twice, assert byte-identical LOG output.
9. **File rename + preamble rewrite + `SHEET_TOOL` update.** Both HTML files renamed to reflect the new
   "two views on one model" reality. Preamble comments and AI session context blocks rewritten.
   `SHEET_TOOL` string updated to match new file identifiers.
10. **Documentation updates.** `PACT-CONTEXT.md`, any roadmap docs, the plan's own "Review outcome"
    section (see bottom of file).

## Files involved

- **`js/engine.js`** — surface expansion (step 1). New exports: `MUT`, `foldBuild`, `activeEvents`,
  `economy`, `baseBuild`, `emit` (or the helpers those functions need). New event-type support:
  `campaignBound`, `lock` field on awards.
- **`PACT-CharGen-Webtool.html`** (to be renamed) — the largest set of changes. All ~75 handler sites
  rewritten. Local throwaway copies of engine functions deleted. `readBuild()` becomes `foldBuild(null)`.
  `applyBuild()` retires or becomes render-only. `saveBuild()`, autosave, `loadFile()`,
  `exportToLiveSheet()`, `buildToLiveLog()` either simplified or deleted. Persistent state schema updated
  (`{LOG, SEQ, rules, id, schema}`). Pill UI with inline undo. Global Undo/Redo added to chrome.
- **`PACT-Live-Char-Sheet.html`** (to be renamed) — smaller changes. `undo()` updated to check `lock`
  field. `award()` and DM "+ Award AP" flow emit `lock:true` explicitly. Discount emits `lock:false`
  explicitly. `campaignBound` event handling. `schema` field on save. Preamble rewritten. `SHEET_TOOL`
  string updated.
- **`testing/tests/engine-parity.html`** — new fixtures: CharGen-native LOG round-trips correctly through
  `foldBuild` and prices identically to what CharGen shows; legacy flat-JSON import produces
  byte-identical LOGs on repeated import (canonical serialization determinism); `lock`-field behaviour
  (undoing across a `lock:true` award is blocked; across `lock:false` succeeds); `campaignBound` +
  threshold (locally-only character past threshold does NOT auto-lock; the same character with
  `campaignBound` DOES auto-lock at the moment of binding).
- **`PACT-CONTEXT.md`** and any roadmap docs — updated to reflect the new architecture and file names.

## Out of scope (deferred, not rejected)

- **Physical merge** of the two HTML files into one file with a view toggle.
- **"Clone as template"** — fork that resets to unlocked creation mode. Separate future feature; would
  require truncating the LOG before `creationLocked` or introducing a `creationUnlocked` event.
- **Per-category "remove" mutators** (Option B from the original plan). Not needed under truncate-forward
  undo.
- **DM-side campaign management UI** beyond the "in-creation characters show a status indicator"
  requirement. Full DM screen is Phase 3+.
- **Per-campaign lock policy configuration** (DM toggling "lock on award" defaults). Lock-by-default +
  Discount opt-out covers real needs today.
- **Undoing across a locking-award boundary** by any mechanism. Once the DM awards session AP, pre-award
  history is genuinely committed. Live Sheet's existing behaviour stands.
- **Sunset of legacy flat-JSON save format.** Backward-compat read stays indefinitely. Sunset is a
  separate decision.

## Risks / open questions

- **Cloud-save vs. campaign-binding as concepts.** Assumed separable; needs code confirmation during
  step 6. If they're one-to-one today, terminology in the plan should still centre on `campaignBound`
  (the semantic that matters), with cloud-save-status as an implementation correlation.
- **DM token flow.** Assumed to exist or be straightforward to add. If the DM screen isn't ready to
  produce tokens, step 6 stubs the redeem path and Phase 3 completes the loop. Not a blocker for Phase 2's
  architectural work.
- **~75 handler sites is an estimate.** The real number could be higher or lower once the rewrite is
  underway. Not architecturally significant, but worth flagging as an unknown of the mechanical work's
  size.
- **Latent bugs in `_lsImportFold` become CharGen-facing.** Post-Phase-2, CharGen's own save→reload cycle
  goes through the fold path. Any bug there that's been hiding (because it's only exercised on Live-Sheet
  imports today) becomes a CharGen regression. Determinism fixture in step 8 catches some of this; manual
  play-through of the full round-trip is still needed.
- **Behaviour parity between engine's `MUT`/`foldBuild`/`activeEvents`/`economy` and CharGen's local
  throwaway copies.** They *should* be equivalent, but if they've drifted, swapping them in step 2
  introduces regressions that look like save-format bugs. Verify parity before step 3.
- **Naming decision.** Placeholder names carry through most of the work; actual rename happens in step 9.
  If the name debate blocks the phase's completion, revert to descriptive placeholders and defer the
  rename to Phase 2.5.

## Verification

### Automated (`engine-parity.html`)

- All existing fixtures still pass (baseline).
- CharGen-native LOG round-trips through `foldBuild` and prices identically to `compute()` on the same
  input.
- Legacy flat-JSON import → LOG → re-import → LOG produces byte-identical output (canonical-serialization
  determinism).
- `lock:true` award blocks pre-award undo; `lock:false` does not.
- Threshold crossing without `campaignBound` does NOT auto-fire `creationLocked`; the same crossing with
  `campaignBound` DOES.
- Fork produces a new `charId`, campaign character's LOG unchanged.

### Manual (browser)

- Build a character in CharGen exercising every major category (racial traits, multi-discipline
  spellcasting, drawbacks, unlocked classes). Save. Reload. Character is identical (define "identical" as
  deep-equal on the rendered flat build, not on DOM state).
- Same character opens in Live Sheet, renders identically, prices identically.
- Continue playing in Live Sheet (award AP, buy things, undo something).
- Open in CharGen again. Live Sheet's in-play buys are present, undoable via the same truncate-forward
  mechanism. Awards with `lock:true` block undoing across them, in both views.
- Fork a campaign-bound character. Original untouched; copy has new `charId`, no campaign tag, locked
  stays locked.
- Old-format flat-JSON CharGen save (e.g., `CG-002-valid-50ap-build.json`) still loads correctly.

### Cross-view interchangeability check

The verification that matters most: **a fresh user should not be able to tell they're using two different
files.** Switching views should feel like switching tabs, not like exporting/importing between tools.

## Done when

1. `js/engine.js` exports the expanded surface; both HTML files import from it; no local throwaway copies
   of engine-shaped functions remain in CharGen.
2. All ~75 CharGen handler sites emit events; `readBuild()` returns `foldBuild(null)`; DOM is render
   output, not state.
3. CharGen has pill UI with inline undo (with scope labels) and global Undo/Redo in chrome, matching
   Live Sheet's phone-first pattern.
4. Awards carry `lock`; `undo()` respects it; CharGen's budget emits as a `lock:false` award; existing
   Discount behaviour is preserved via `lock:false`.
5. `campaignBound` event exists; four `creationLocked` triggers are wired; DM token flow at least stubbed
   (real integration may be Phase 3).
6. Fork produces a new-`charId` local copy; campaign character untouched.
7. Legacy flat-JSON saves still load; canonical-serialization determinism fixture passes.
8. `schema` field on new-format saves; old saves detected by absence and loaded via legacy path.
9. Both files renamed; preambles rewritten to reflect the "two views on one model" architecture;
   `SHEET_TOOL` and AI session context blocks updated; `PACT-CONTEXT.md` and roadmap docs updated.
10. `engine-parity.html` reports all fixtures passing (baseline plus the new Phase 2 fixtures).
11. Manual cross-view interchangeability check passes: a character created in one view is fully editable
    in the other with no export/import step.

---

## Implementation notes (added while starting Phase 2 — corrections to this plan's own claims)

- **Step 1 is much smaller than described.** `js/engine.js` **already exports** `MUT`, `foldBuild`,
  `activeEvents`, `economy`, and `baseBuild` — verified directly (`export const MUT` at line 390,
  `export function activeEvents`/`economy`/`foldBuild`/`baseBuild` similarly present). This predates
  Phase 2 (it's part of the D-GH26 safe-subset groundwork). There is no `emit` export and none is
  needed — `emit()` is a thin, tool-local wrapper around each tool's own `LOG`/`SEQ`/`REDO` variables
  (`ev.seq=SEQ++; ev.ts=Date.now(); LOG.push(ev); ...`), not rules logic, so it correctly stays
  tool-local in both Live Sheet and (after Phase 2) CharGen.
- **The `lock` field is not an engine.js change at all.** `undo()` is tool-local (per this repo's own
  architecture notes — LOG-array manipulation, not "derive state from LOG" rules logic), so decision #4's
  `lock`-field check lives entirely in each tool's own `undo()`, not in the shared engine module.
- **The one real engine-side addition** is gating Phase 1's existing `creationLocked` automatic-threshold
  inference (in `_replay`, `js/engine.js`) on a new `campaignBound` LOG event having occurred first
  (decision #6.2) — this is genuinely new, small, scoped engine work, not "surface expansion" of
  already-exported functions. **Done** (see D-GH32): `DATA.version` v0.333→v0.334, two existing D-GH31
  fixtures updated, two new fixtures (`EV-008`/`EV-009`) added, `engine-parity.html` → 13/0.
- **Step 2 done (see D-GH33).** The parity check the plan itself required before swapping found real
  drift: CharGen's local `found` mutator silently dropped a second discipline added to an
  already-founded tradition (no else-branch), and `dbound` didn't exist locally at all — matching a
  divergence this project had already documented for DM Console's separate local `MUT` copy. Fixed
  automatically as a byproduct of the swap (not a separate patch). CharGen's module bridge now imports
  `MUT`/`foldBuild`/`activeEvents`/`economy`/`baseBuild` from `js/engine.js`; both local throwaway
  copies (`_lsImportFold`'s full local re-implementation, `buildToLiveLog`'s smaller `MUT` subset) are
  deleted. Verified in a real browser: clean boot, the multi-discipline/`dbound` fix confirmed working,
  and a representative build round-trips through export→import at an identical `compute()` price.
  CharGen's live editing UI (~75 handler sites, `readBuild`/`render`) is untouched — exactly as scoped.
  `js/engine-v0-snapshot.js` (the frozen comparison copy) is deliberately left un-updated, so it stays a
  clean pre-Phase-2 baseline for the eventual side-by-side comparison.

**Next up: Step 3** (rewiring all ~75 CharGen handler sites to `emit()` instead of mutating DOM directly)
— the large mechanical lift, not yet started as of this note.
