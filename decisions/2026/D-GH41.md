# D-GH41 — CharGen's budget/drawback conflation caused unbounded AP inflation on every save/load/switch cycle

Status: Active

- **Context:** the task owner reported that saving and reloading a character in CharGen added AP, and each
  subsequent CharGen↔Live Sheet switch round trip added *more* — a real, uploaded character
  (Thalindra Stonefist, one active drawback worth 2 AP) went 52 → 54 → 56 → 58 → 60 → 62 across repeated
  cycles, never stabilizing. Reproduced deterministically in a real headless browser using the task
  owner's exact uploaded file, driven through the actual `?handoff=` consume path (not a simulated
  shortcut): budget climbed by exactly +2 (the drawback's AP value) every single cycle.
- **Root cause, precisely traced:** CharGen's single editable "AP budget" field (`#budget`) is painted from
  `foldBuild(LOG).budget`, which the engine defines as `economy(LOG).earned` — **raw award total PLUS any
  active drawback's AP grant, combined.** Two independent places then treated that *combined* number as if
  it were the *raw* award and wrote it into a new `award` event, while the drawback's own `buy` event
  stayed in the LOG and kept separately contributing its AP on every future fold:
  1. `_cgSyncAward()` (the Step-5 name/budget reconcile, called on every autosave-restore, file load, and
     handoff-consume) read the DOM's current (combined) budget value and wrote it straight into a new
     singleton `award` event.
  2. `_buildEventBurst()` (used by `_cgBoot()`'s unconditional whole-LOG regeneration from the DOM — see
     the still-open Cleanup A item, D-GH38) independently did the exact same thing, and *also* re-emitted
     the drawback purchase in the same pass.
  Every full character-apply cycle re-added the drawback's AP on top of an already-inflated award,
  compounding without bound. Both cold reviews of D-GH38 and this session's own earlier verification passes
  missed it because none of the test characters used in this session had an active drawback until the task
  owner's real, more complex upload did — a nudge that a synthetic single-species/no-drawback test
  character is not a sufficient stand-in for a real one.
- **Decision:** `js/engine.js`'s `economy()` already computed the drawback-earned component internally but
  never returned it — a small, purely additive change now exposes it (`{earned, spent, available,
  drawbackEarned}`), so CharGen can isolate "raw award" without re-deriving drawback/bought-off filtering
  logic itself (the project's own rule: never reimplement rules logic outside `engine.js`). Both broken
  call sites now subtract the drawback contribution back out before writing an award amount:
  `_cgSyncAward()` uses the engine's own `economy(LOG).drawbackEarned`; `_buildEventBurst()` (which has a
  folded build, not raw events) subtracts `sum(DATA.drawbacks[v] for v of b.drawbacks)` — the same lookup
  table it already reads on the very next line, not new rules logic.
- **Why:** fixing this by reading the engine's own already-computed split (rather than re-filtering
  bought-off drawbacks locally in CharGen) keeps the fix aligned with the project's single-source-of-truth
  rule and is less likely to drift from `economy()`'s own logic in the future.
- **Status:** DONE. Verified with the task owner's exact uploaded file, driven through the real `?handoff=`
  consume path in a real headless browser: budget now stabilizes at 54 (52 raw award + 2 drawback,
  mathematically correct) across 4 repeated round trips, flat — no more compounding. Re-verified the plain
  save/reload path the same way (also stable at 54). `testing/tests/engine-parity.html` → 20/0 (confirms
  the additive `economy()` change is safe). `DATA.version` unchanged (no pricing/rules table changed, only
  an internal-value exposure and two bug fixes to code that was miscomputing an already-correct engine
  calculation).
- **Follow-up, not done here:** `_buildEventBurst()`'s independent bug is only reachable because
  `_cgBoot()`'s whole-LOG regeneration from the DOM runs unconditionally on every boot (D-GH38's Cleanup A,
  still open) — removing that dead scaffolding would eliminate this entire class of "two places compute
  the same derived value and one of them re-persists it as raw input" risk, not just this one instance of it.
