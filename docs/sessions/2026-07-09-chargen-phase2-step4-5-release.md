# 2026-07-09 — CharGen Phase 2 Steps 4–5, two fixes, and the v0.200 release

## Scope of the sitting
One long session that did, in order:
1. Finished merging the **Step 3** emit-migration (`feat/chargen-emit-migration` → `preview`, PR #137),
   resolving a fixture-ID collision with PR #136 (renumbered its CG-004/5/6 + EV-002 to CG-007/8/9 + EV-010)
   and superseding PR #129.
2. **Step 4** — CharGen undo/redo + event-log persistence, four cold-reviewed chunks (A–D), PR #140.
3. **Bug 4** (DM house-rules bar `ReferenceError: ck is not defined`, PR #138) and **Bug 5** (export burst
   dropped `size`/`wornArmour`, PR #139).
4. **Step 5** — name/budget folded into the LOG as native `name`/`award` events, PR #141.
5. **Release-prep** — build `v0.107 → v0.200`, removed the `-v0` comparison snapshot + menu card, PR #142.
6. **Promoted `preview` → `main`** (PR #143) — v0.200 is now live on GitHub Pages.

Everything CharGen-only except the cosmetic `BUILD` bump; `DATA.version` unchanged (v0.332); engine-parity
stayed 20/0 throughout.

## Why this note exists (things a future agent could second-guess)
- **The undo restore contract (build-equality) — and my own review being reversed.** My internal first-pass
  review of the Step-4 plan raised finding **F2**: make `LOG = f.log` the default on undo restore to
  preserve exact event identity. The external cold reviewer disagreed, and checking `_buildEventBurst` in
  the code settled it *against* me — CharGen's LOG is already regenerated synthetically on every whole-build
  op, so the contract is build-equality, and the DOM-rebuild default is correct (it surfaces
  `applyBuild`/`_buildEventBurst` divergence bugs instead of masking them). F2 was reversed. Written up as
  **D-GH35**.
- **Two mid-session surprises that changed the implementation** (neither was in the plan):
  - **Randomize was silently corrupting the live LOG.** `let b = readBuild()` returns nested arrays that
    *alias* the LOG event payloads, and `randomizeRoll` mutated `b` in place. Masked pre-Step-4 because
    `applyBuild` rebuilt the LOG from the DOM afterward; Step-4 undo (which snapshots the LOG) surfaced it.
    Fixed by deep-cloning the working build. (This is the cross-project lesson — see below.)
  - **`size` does not round-trip through `applyBuild`'s DOM.** It's compute-managed and parked in a hidden
    control (charsize select forced to 'Small' when not choosable), so the DOM re-derivation flips it. Led
    to the decision that a *native file load* reinstates the authoritative saved LOG (`_cgApplyEnvelope`),
    while *undo* keeps the DOM-rebuild — different contracts, on purpose (D-GH35).
- **Step 5 needed no engine change** — the engine already folds `name`→`b.name` (engine.js:512) and derives
  `budget` from `award` amounts (engine.js:456). Two gaps found while wiring: `genName()` set `#cname`
  directly (bypassing the sync), and a stale-award back-compat edge for Step-4-saved files (healed by a
  reconcile in `_cgApplyEnvelope`).
- **CHANGELOG merge collisions (benign).** The two `fix/*` branches and Step 4 all prepended a CHANGELOG
  entry at the same spot; GitHub flagged them "dirty" but `git merge origin/preview` auto-resolved every
  one (distinct adjacent lines). Merged fixes-first, Step 4 last.

## OPEN — production bug, undiagnosed (handed to a separate session)
**Symptom (user-reported, live on v0.200):** *"whenever I try to add an ability in the CharGen sheet, it
doesn't add any APs or add to the AP ledger."*

**Diagnosis state when the session was closed (incomplete):**
- "Ability" not yet confirmed. Leading candidate: a **subclass ability** (section 8, added via a `.subpick`
  `<select>` → `onchange` at ~line 1910 → `addRow('subabil', v)`). Boons are also labelled "extra abilities
  costing AP" — not ruled out.
- `addRow('subabil')` bakes the value into `innerHTML` and dispatches no input/change event, but it *does*
  have an explicit nudge: `_cgSyncFlatCategory(RECONCILE_CAT['subabilrow'])` (= `'subabil'`) at ~line 1085.
  So the reconcile *should* fire — was about to read **`_cgSyncFlatCategory`** (~line 1560) to check whether
  it prices/reconciles correctly (a 0-cost or no-op result would match the symptom) when the session closed.
- Suspicion: this is a Step-3/4/5-era wiring regression where the add path emits no LOG event (or a
  zero-cost one), so post-flip (`readBuild = foldBuild(LOG)`) it neither costs AP nor shows in the ledger.
- **Next step for whoever picks it up:** reproduce in a browser (pick a subclass ability from the section-8
  dropdown), watch whether `LOG` gains a `subabil` buy event with a non-zero `cost`, and whether
  `compute(readBuild()).total` moves. Then trace `_cgSyncFlatCategory` and the `subabil` reconcile pricing.

## Test/verification
All in-browser (Playwright/Chromium, service-worker stubbed). Per-chunk suites: Step-4 A–D (16/13/15/13),
Step-5 A–B (15/10), Bug 4 (6), Bug 5 (6), engine-parity 20/0, release smoke-test (menu shows one CharGen
card + "Build v0.200"; CharGen boots at v0.200). Scratchpad test files live outside the repo.
