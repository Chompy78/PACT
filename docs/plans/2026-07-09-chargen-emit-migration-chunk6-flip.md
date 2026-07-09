# Plan: CharGen emit()-migration — Chunk 6 (the readBuild flip + cleanup)

Extends (does not supersede): `docs/plans/2026-07-09-chargen-emit-migration-phase2-step3.md` (the master
Step-3 plan; Chunks 0–5 are DONE). **Cold-reviewed 2026-07-09 — minimal flip approved; 10 findings folded
in (see "Review outcome" at the bottom).**

## Goal
Make CharGen's event log (`LOG`) the actual source of truth for what the character *is*, by flipping
`readBuild()` from "read the form fields" to "replay the LOG" — the payoff of the whole migration, and what
makes CharGen an interchangeable event-sourced view alongside the Live Sheet. Done without changing any
visible behavior.

## Context
- PACT is a static vanilla-JS RPG tool suite (no build step, no frameworks). `js/engine.js` is the single
  source of truth for rules; `compute()`/`foldBuild()`/`baseBuild()` etc. are imported by the tools.
  `foldBuild(events)` replays an event log onto a fresh `baseBuild()` and returns a flat character build.
- Chunks 0–5 (all committed, each independently reviewed) built a CharGen-local `LOG` and kept it in perfect
  sync with the form DOM on every edit, add/remove, traditions/disciplines change, and whole-build load — but
  *nothing reads it for display yet*. This is "Option A": `readBuild()` still returns `_domReadBuild()`
  (reads the form), and a dev-only "shadow-diff" (`?cgShadow=1`) continuously checks LOG vs. DOM agreement.
  So a hidden LOG/DOM disagreement is currently harmless (the form wins).
- **Verified this session in a live browser:** the *spending* (compute total) is fully event-sourced —
  `compute(foldBuild(LOG)).total === compute(_domReadBuild()).total` after a mixed editing session. Two
  fields lag deliberately: `name` and `budget`. `foldBuild(LOG).budget` returns a stale value (the boot
  default, 50) even when the DOM shows a different value (77), and its award event is *also* stale;
  `foldBuild(LOG).name` is empty with zero name events — because live typing of those two was never wired
  to LOG (deferred here).
- Repo rule (from `AGENTS.md`, verified): vanilla JS only; keep the three tools working and UI unchanged
  unless the task says otherwise; `testing/tests/engine-parity.html` must stay green (currently **16/0**)
  after any change; don't re-implement rules logic outside `engine.js`.
- The Live Sheet — the architectural model CharGen is converging toward — keeps its DOM inputs as the
  *input mechanism* (buttons produce events) and derives its *display* from `foldBuild(LOG)`. It does not
  repaint its input controls from the LOG.

### Approved architecture (cold-reviewed)
```
DOM controls  →  emit()  →  LOG (authoritative state)  →  foldBuild(LOG)  →  character build
                                                              ↓
                                    readBuild() = LOG projection + temporary name/budget shim
                                                              ↓
                                         annotate()  →  LOG-derived UI corrections only
```
**No full `paintFormControls()`/control-repaint layer will be introduced unless a concrete post-flip
divergence scenario is demonstrated.** The DOM stays the input layer (matching the Live Sheet). Moving to a
`DOM → LOG → repaint DOM → reread DOM` model is explicitly rejected: it causes cursor jumps, focus/selection
loss, needless recreation of dynamic controls, and permanent two-way sync complexity.

## Assumptions vs. verified facts
- **Verified:** `foldBuild(LOG)` reproduces the full build EXCEPT `name` (empty, no name events) and `budget`
  (stale — DOM 77 vs. fold 50, and the award event itself reads 50). Spending/structure match exactly. The
  delegations keep every editable field synced DOM→LOG on each edit. `annotate()` currently performs two
  DOM-side corrections — unchecking Medium/Heavy armour when STR<10, and unchecking an origin-only racial
  trait taken cross-race — and the pre-emit guards for those already exist (Chunks 1/2) so the LOG side is
  already correct. The only direct `foldBuild(LOG)` call sites in CharGen (outside the shadow scaffolding)
  are the three grid builders, which read membership arrays (`.arts`/`.boons`/`.drawbacks`) only — never
  `budget` — so no stale-budget path exists today.
- **Assumed (reviewer endorsed, but stated as the load-bearing bet):** keeping the form DOM as the input
  layer + `annotate`'s guarded-field corrections keeps form and LOG in agreement after the flip, so a full
  repaint is not needed. Reading `name`/`budget` from the DOM inside the flipped `readBuild()` is an
  acceptable Step-3 shim, with full event-sourcing of budget/awards left to the master plan's Step 5.

## Core invariant (revised per review)
> `annotate()` must never **originate** gameplay state. Any DOM writes it performs must only be UI
> corrections that reflect state already present in `LOG`/`foldBuild()`.

Under this rule the two known corrections are acceptable and are classified as **`LOG_SYNC_GUARD`** (not
ordinary state writes): the STR<10 armour correction and the origin-only cross-race trait correction. They
do not create state — they make the controls reflect already-determined LOG legality. A `LOG_SYNC_GUARD`
writer, by definition: does not emit events, does not modify `LOG`, does not create gameplay state.

## Proposed approach (minimal, Live-Sheet-aligned flip)
1. **Flip `readBuild()`** to `const b = foldBuild(LOG); b.name = val('cname'); b.budget = +val('budget')||DATA.level1AP; return b;`
   with the loud shim comment:
   ```
   // Step-3 compatibility shim.
   // Character state now comes from foldBuild(LOG).
   //
   // Name and budget remain DOM-backed until later migration steps:
   // - live name edits are not yet event-sourced
   // - budget/award-history event sourcing belongs to Step 5
   //
   // Do not add additional DOM-backed build fields here.
   ```
   `_domReadBuild()` stays (still the pricing-context reader for the delegations and the load-flow resync —
   it is NOT removed).
2. **Keep the DOM as the input layer.** No `paintFormControls`. `annotate()`'s two corrections stay,
   reframed/commented as `LOG_SYNC_GUARD`.
3. **Audit direct `foldBuild(LOG)` call sites.** Post-flip rule: display/render paths obtain state through
   `readBuild()`; only debug/testing helpers may call `foldBuild(LOG)` directly (this matters because
   `budget` is reattached only in `readBuild()`, so a display path bypassing it could show stale budget).
   Switch the three grid builders to `readBuild()` (harmless — they read membership, which is identical
   either way) or leave them with an explicit justification comment; either way, classify them.
4. **Remove migration scaffolding:** `CG_SHADOW`, `shadowCompare`, the four `assert*` dev checks,
   `_cgWireStateEventAudit`, and their `render()` shadow block. **Keep `canonicalBuild()`** (small, generic,
   and reused by the verification invariants below). Keep the boot-level
   `replaceWholeLogFromBuild(_domReadBuild())` (fresh-boot seed) and `_domReadBuild()`.
5. **Category-G audit (strengthened).** Grep the whole file for every DOM-writer form:
   `.value =`, `.checked =`, `selectedIndex =`, `setAttribute(`, `removeAttribute(`, `.innerHTML =`,
   `.textContent =`, `appendChild(`, `replaceChildren(`, `.remove(`, `classList.`, `disabled =`. Classify
   each as exactly one of: `STATE_IMPORT` (applyBuild), `VIEW_RENDER`, `TEMP_STEP3` (the name/budget shim),
   `NON_STATE_UI`, `LOG_SYNC_GUARD`, or `LEFTOVER_STATE`. **Acceptance: `LEFTOVER_STATE = 0`; expect
   `LOG_SYNC_GUARD` = exactly the two annotate corrections** unless another case is explicitly justified.

## Files involved
- `tools/PACT-CharGen-Webtool.html` — `readBuild()` (the flip + name/budget shim); the direct-`foldBuild(LOG)`
  display-path audit; delete the shadow-diff/audit scaffolding block and its `render()` hooks (keep
  `canonicalBuild()`); the Category-G audit sweep. No other tool or `js/engine.js` change expected.
- `CHANGELOG.md` / the master plan's Chunk log — updated.

## Out of scope
- Undo/redo, pill UI, LOG-shaped `{LOG,SEQ,rules,id,schema}` persistence — Phase-2 **Step 4**.
- Full event-sourcing of `budget`/awards (and "AP awards lock history" semantics) — Phase-2 **Step 5**.
- File renames / `SHEET_TOOL` changes — a later Step-3 item.
- The two pre-existing bugs already logged as roadmap items (the `dmAdd`/etc. `ReferenceError`; the
  `size`/`wornArmour` export-burst gaps).

## Alternatives considered
- **Full paint-split (`paintFormControls` repaints every control from `foldBuild(LOG)` on each render;
  `annotate` becomes literally state-free).** Rejected (reviewer concurred): repainting live
  `<input>`/`<select>` on every keystroke fights the user (cursor/focus/selection loss) and rebuilds all
  tradition cards/rows per edit; it isn't how the Live Sheet works. Only reconsidered if a concrete
  post-flip divergence path that survives the emit-driven architecture is demonstrated.
- **Reattach `budget` by summing award events** instead of reading the DOM. Rejected: verified the award
  event is itself stale on live budget edits (returns 50, not the DOM's 77), so this would be *less* correct
  than the DOM read unless live budget→award wiring is added — which is Step 5's scope.

## Risks / open questions
- **The load-bearing bet:** "keep DOM as input + `annotate` `LOG_SYNC_GUARD` corrections" is sufficient after
  the flip. Mitigation: the Category-G audit + the load/import build-projection invariant + the one-time
  authoritative-LOG check (below) are designed to surface any divergence path that survives.
- **Step-4 forward note (not a Chunk-6 blocker):** the rejection of full repaint applies to *ordinary editing
  renders*. Future *whole-LOG replacement* operations (undo, redo, reset, import) may still require targeted
  form-control synchronization if CharGen's persistent controls cannot naturally reflect replaced LOG state.
  Flagged for Step 4, not solved here.
- Reading `name`/`budget` from the DOM means the in-memory LOG still doesn't capture live edits of those two;
  only export/save (which rebuilds the burst from `readBuild()`) captures them. Accepted for Step 3.

## Verification
- `testing/tests/engine-parity.html` → **16/0** (unchanged; no `compute()`/rules change, no `DATA.version`
  bump).
- **Build Projection Invariant** — after every load/import flow (`populate DOM →
  replaceWholeLogFromBuild(_domReadBuild()) → render`):
  `canonical(readBuild()) == canonical(foldBuild(LOG) + name/budget shim)`. Run for all five whole-build
  flows (flat load, Live-Sheet-LOG load, shared-link round-trip, pre-migration autosave restore, randomize).
- **DOM Writer Audit Invariant** — the Category-G sweep yields `LEFTOVER_STATE = 0`.
- **Guard Correction Invariant** — the `LOG_SYNC_GUARD` writers emit no events, modify no `LOG`, create no
  gameplay state; they only align controls with already-computed LOG legality (verify the STR<10 armour and
  cross-race trait corrections still fire, still change no LOG).
- **Budget Validation** — live budget edits, affordability checks, warnings, ledger display, and remaining-AP
  all behave exactly as before the flip (specifically because budget is DOM-read through `readBuild()`).
- **Authoritative-LOG one-time check** — temporarily disable/force-fail one `emit` path; confirm that after
  the flip the control change *disappears or becomes visibly incorrect* on the next render (proving the DOM
  can no longer silently mask an event failure — before the flip it would have hidden it). Not permanent test
  infrastructure; validated once, then reverted.
- Full manual pass exercising every category (checkboxes, stats/armour incl. STR<10, add-row features,
  traditions/disciplines, customProfs/freeSub, unlockedClasses, name+budget) shows zero visible change from
  pre-flip CharGen (deep-equal on the rendered build).
- Typing in text inputs (name, custom prof) is not disrupted (no cursor jump) — the symptom the rejected
  full-repaint alternative would cause.

## Done when
`readBuild()` returns `foldBuild(LOG)` (+ name/budget shim); the shadow-diff/audit scaffolding is gone
(`canonicalBuild()` retained); the strengthened Category-G sweep is clean (`LEFTOVER_STATE = 0`); all
verification invariants above pass; parity 16/0; and a full manual pass shows zero visible change from
pre-flip CharGen.

---

## Reviewer instructions
You are reviewing this plan **cold, with no access to the codebase** — only the text above. You are a
general reasoner, not a code analyzer: judge the plan's **logic, clarity, scope, and risk — not code
correctness you cannot verify.** If the plan relies on knowledge you don't have, that itself is a finding.
Find gaps, unstated risks, and better alternatives — including structural/redesign suggestions — but do not
implement anything. Specifically:
1. Does the proposed approach actually achieve the stated goal?
2. Which of the plan's **assumptions** look shaky, and what happens if one is wrong?
3. Is anything in "Alternatives considered" actually better, or is the plan overcomplicated for the goal?
4. What's missing — an edge case, a risk, a dependency, a **verification step** the plan doesn't mention?
5. Are "Verification" and "Done when" objectively checkable, or do they hide ambiguity?
6. Should this task be split? Is anything in "Out of scope" actually load-bearing?

Write your findings as a plain list (gaps found, suggested improvements, verdict) — don't rewrite the plan
yourself unless asked. **If a section is genuinely solid, say so briefly rather than inventing concerns.**

---

## Review outcome (first cold review, 2026-07-09)
- Reviewer findings: **10 → accept 10 / reject 0 / defer+convert 0.** Verdict: "Proceed with the minimal
  flip. Confidence in the architecture is high." No rejection of the core approach; all findings were
  clarifications/strengthening.
- Materially changed the plan? **Yes (hardening, not direction).** Key changes: (1) the core invariant was
  reframed from "annotate must never write `.checked`/`.value`" to "annotate must never *originate* gameplay
  state," with the two known corrections classified as `LOG_SYNC_GUARD`; (2) added an explicit "no full
  repaint unless a concrete divergence is demonstrated" principle + the approved architecture diagram;
  (3) added the loud name/budget shim comment; (4) added the direct-`foldBuild(LOG)` display-path audit;
  (5) expanded the Category-G grep set and adopted a 6-way classification with `LEFTOVER_STATE = 0`;
  (6) retained `canonicalBuild()`; (7) added the Build Projection load/import invariant; (8) added the
  one-time authoritative-LOG (emit-failure) check; (9) added the Step-4 targeted-sync forward note;
  (10) added four explicit verification invariants.
- Without the review, what would have happened: the flip would likely still have worked (the direction was
  right), but the annotate-purity invariant would have been stated too strictly (risking a needless
  refactor or a false "violation"), and the verification would have been weaker — no `LEFTOVER_STATE = 0`
  audit gate, no build-projection invariant, and no positive proof that the LOG is actually authoritative
  post-flip. The review turned a plausible flip into a checkable one.

## Implementation outcome (2026-07-09) — DONE
- Implemented as the minimal flip exactly as planned. **The strengthened Category-G audit paid off
  immediately:** it caught a real post-flip bug — `annotate()`'s dependency auto-unchecks (expertise
  without its skill, tool-expertise without its tool, cross-race trait after a species change,
  wrong-lineage racial spell, DM-toggle-disabled boons/drawbacks) unchecked the DOM control but never
  retracted the LOG event, so `foldBuild(LOG)` kept counting a purchase the UI showed as unchecked.
  Without the audit gate this would have shipped as a silent mispricing. Fixed with
  `_cgReconcileChecklistDependents()` (retract-only, run after annotate corrects the DOM).
- **A second independent review of the diff** (8 checks) passed all 8; verdict "correct and safe to
  commit." Its one low-severity concern (a LOG value with no rendered checkbox could be retracted on an
  unrelated toggle — not a regression vs. pre-flip) was closed with a precision guard: retract only when a
  checkbox exists but is unchecked.
- All four verification invariants confirmed in-browser: Build Projection, DOM Writer Audit
  (`LEFTOVER_STATE = 0`), Budget Validation, and the one-time authoritative-LOG check (suppressing `emit`
  makes a control change stop sticking — the definitive proof the flip is real). Typing undisrupted;
  parity 16/0; full Chunk 0–5 regression green.
