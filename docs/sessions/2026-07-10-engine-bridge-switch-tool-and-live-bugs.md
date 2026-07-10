# 2026-07-10 — engine-bridge completion, switch-tool feature, and two live production bugs

## Arc

This session closed out three related threads in one sitting:

1. **Engine-bridge completion** (D-GH36, D-GH37) — bridged `foldBuild`/`activeEvents`/`economy` (and,
   for DM Console, `MUT`) from `js/engine.js` into Live Sheet and DM Console, finishing the migration
   `docs/PACT_ROADMAP.md`'s NOW item `feat/engine-bridge-all-tools` was tracking. This had been paused
   once already (D-GH36) over a real risk — the engine's real replay populates a per-trait
   `_raceTraitLocked` map the tools' old local folds never produced, and `compute()`'s racial-trait
   pricing depends on it. The pause was lifted (D-GH37) once confirmed the app is pre-launch (no real
   characters to protect), and after finding no tool's UI actually triggers the `creationLocked` /
   `campaignBound` events this pricing mechanism depends on yet — so the risk doesn't functionally bite
   in production today regardless.

2. **CharGen ↔ Live Sheet switch-tool feature** (D-GH38) — the user asked for a single click to move a
   character between the two tools. A prior plan had explicitly rejected physically merging the two
   HTML files; this session confirmed that decision still holds and built a lightweight one-click switch
   instead, backed by a new shared module `js/character-store.js` (transport/storage/validation only —
   it does not apply payloads to tool runtime, matching the ownership boundary `engine.js` already draws
   between rules and UI). The plan went through two rounds of external cold review plus an Opus
   verification pass before implementation; the verification pass caught a real defect the reviews
   missed — CharGen's untagged-import branch (`loadFile()` branch 2) never reads `d.id`, so reusing it
   for the handoff-consume path would have silently minted a new random character id on every
   Live-Sheet→CharGen switch. Fixed by routing the switch through the id-preserving `_cgApplyEnvelope()`
   path instead.

3. **Two live production bugs**, both found by the user manually testing on Android Chrome after the
   switch-tool feature deployed straight to `main` (pre-launch, no PR gate):
   - **D-GH39** — CharGen's ability-score +/− steppers mutated the (readonly) input's `.value` directly
     without dispatching an `input` event, so AP costing and persistence silently never saw stepper-driven
     ability changes. The user's exact symptom ("used the steppers, CharGen's own AP total didn't move")
     pinpointed the code path directly.
   - **D-GH41** (more severe) — CharGen's `#budget` field displayed `economy(LOG).earned`, which
     combines raw award *and* drawback earnings, but `_cgSyncAward()` and the import path's
     `_buildEventBurst()` both wrote that combined figure back as a *new* raw `award` event while the
     drawback buy event kept independently contributing on every future fold — an unbounded compounding
     AP inflation on every save/reload/switch cycle. The user's minimal test character (no drawback)
     never showed it; their real uploaded character (one drawback) reproduced it deterministically
     (52→54→56→58→60→62 AP over repeated cycles). Fixed via an additive `economy()` change (exposing
     `drawbackEarned` instead of re-deriving it ad hoc at each call site) plus the arithmetic correction
     at both call sites — kept inside `engine.js` + its two callers, per the "never re-implement rules
     logic outside engine.js" rule.

   Fixing D-GH41 while investigating also surfaced D-GH40: CharGen's native save, CharGen's now-removed
   "Export to Live Sheet" button, and Live Sheet's native save/export were three divergent shapes (one
   re-synthesized a fake LOG with no `id`; the others dropped or never restored `id` on import). Unified
   into one `CHAR_SCHEMA = 'pact-character/1'` envelope, with back-compat parsing for all three legacy
   shapes, and removed the redundant "Export to Live Sheet" button per explicit user confirmation.

## Collision with a parallel session

On pushing the D-GH41 fix, `origin/preview` had moved ahead — PR #146 (a separate session's headless
Playwright e2e harness for CharGen/Live Sheet, notably stubbing the CDN-hosted Supabase import) had
merged first. Resolved with a clean `git merge origin/preview` — no conflicts, disjoint files.

## Verification method

Every fix in this session was confirmed with a real headless-browser run (Playwright + Chromium against
a local `http-server`), not just static code reading — this is what caught the exact compounding
mechanism behind D-GH41 (two independent contributing writers, not one) and confirmed the id-preservation
fix for the switch-tool feature actually round-trips correctly.

## Numbering

D-GH36 through D-GH41 were all claimed and merged in this session, checked against the live remote each
time per `AGENTS.md`'s D-GH numbering convention — no collisions this round.

## Follow-ups intentionally left open

- Slice 2 of the switch-tool plan (cloud/campaign round-trip verification) — deferred, not yet done.
- "Cleanup A" — CharGen boot still regenerates its LOG from the DOM on every boot
  (`replaceWholeLogFromBuild(_domReadBuild())`); confirmed compute-equivalent (not corrupting) but
  cosmetically redundant. Not fixed this session.
- "Follow-on B" — wiring the engine's `creationLocked`/`campaignBound` triggers into the switch button
  so the D-GH36/37 pricing risk becomes load-bearing (it currently isn't, in any tool).
