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

## Addendum — DM Console e2e coverage + an unconfirmed bug report

After the above landed and a first `/close-session` pass wrapped it up (roadmap graduation for
`feat/engine-bridge-all-tools`, branch/lessons cleanup — see CHANGELOG for the graduation entry), the
session continued with two more threads:

1. **Extended `testing/scripts/random-manual-e2e.mjs` (PR #146's harness) to cover DM Console.**
   DM Console's roster view turned out to need no cloud/auth at all — character files land via a plain
   `<input type=file>` read by `handleFiles()`/`dmAnalyze()`, entirely separate from the sign-in/campaign
   features. The harness now exports the finished, leveled-up character via the same envelope the app's
   own Save button builds, drops it onto DM Console's real file input, switches into table view (the only
   view with an AP-available column), and cross-checks the rendered row against the source tool's own
   species/class/HP/AC/AP-available. Verified locally at 5/5 iterations across varied species/classes/
   levels before committing. DM Console's cloud-gated features (sign-in, award AP, campaign rules) are
   intentionally still not covered — flagged inline in the harness and `testing/README.md`, not a silent
   gap.

2. **A bug report that didn't hold up under live reproduction.** The user reported — secondhand, from
   "another session" that had apparently built a similar harness — that a `position:fixed` feature-search
   autocomplete menu double-counts scroll offset and renders off-screen after scrolling, worked around
   there with a forced `scrollTo(0)` plus an oversized (8000px) viewport rather than fixing the app. Asked
   to "just fix it," this session instead reproduced live with Playwright first (per this session's own
   established verification method above) rather than patching blind:
   - Static read of all three known `position:fixed` autocomplete menus (CharGen's "Chosen features"
     search-all box `_featAC()`, CharGen's other spell/feature autocomplete, Live Sheet's) found all three
     position via plain `getBoundingClientRect()` with no scroll offset added anywhere — already the
     *correct* approach for `position:fixed`.
   - Two live repros — scrolling before opening the menu, and scrolling (via mouse wheel) while it was
     already open — both showed the menu recalculating correctly on every scroll event (a capture-phase
     `window` scroll listener), landing within 0px of the expected position both times.
   - Could not reproduce the reported symptom against current `preview`/`main` code. No fix was applied —
     applying one against code that already measures correctly risks a regression for a bug that isn't
     there. Reported back to the user asking for more specific repro details (exact tool/input, desktop vs.
     mobile) rather than guessing further; mobile's `position:fixed`-vs-visual-viewport behaviour under an
     on-screen keyboard is the most likely real cause if the original report came from a real device, since
     that wouldn't show up in either desktop-Playwright repro tried here.
   - No roadmap item or DECISIONS entry was added for this — there's nothing confirmed yet to schedule or
     decide. If a future session gets a live-reproducible case, start there rather than re-deriving this
     investigation.
