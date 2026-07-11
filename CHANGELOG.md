# PACT — Changelog

> One line per change, **newest first**. `DATA.version` is noted only when it changed.
> This is the scannable, going-forward log; the full pre-GitHub history is in
> `docs/history/CHANGELOG-full.md`. *Why* lives in `DECISIONS.md`; the messy middle in `docs/sessions/`.

- **2026-07-11 · docs — add a pre-release manual QA checklist** (`docs/HOW-TO-WORK.md`, `AGENTS.md`; no
  app code touched, `DATA.version` unchanged). Documents the cross-tool click-through the automated
  `engine-parity` gate can't cover: CharGen → export to Live Sheet → buy-off/ledger check → push to cloud
  → DM Console award-AP → console-error check at each step. `AGENTS.md`'s per-change checklist now points
  to it, scoped to release-shaped PRs.

- **2026-07-10 · fix(sql) — lock down remaining Supabase function EXECUTE grants (anon)** (D-GH15
  addendum; `sql/migrations/2026-07-10-lock-down-remaining-function-grants.sql`, `sql/rls-policies.sql`;
  no app code touched, `DATA.version` unchanged). Revoked the default Postgres EXECUTE-to-`PUBLIC` grant
  on the ~13 functions the security advisor still flagged, matching the earlier `award_ap` fix: the 3
  trigger-only functions lose EXECUTE entirely (fine — Postgres blocks direct calls to `returns trigger`
  functions regardless of grant); the 6 client-facing RPCs and 5 internal RLS-helper functions keep
  `authenticated` access, just lose the redundant `PUBLIC` grant. Verified live via
  `has_function_privilege`: all ~13 now show `anon_can_execute=false`; `get_advisors` shows no new
  findings post-migration. Pure hygiene/defense-in-depth — none of these were actually exploitable
  (every one gates on `auth.uid()`, which is `NULL` for `anon`).

- **2026-07-10 · docs — cross-check DECISIONS.md/CHANGELOG.md/roadmap and fix what they disagreed on**
  (`AGENTS.md`, `DECISIONS.md`, `CHANGELOG.md`, `docs/PACT_ROADMAP.md`,
  `docs/sessions/2026-07-08-dgh-numbering-collision-fix.md`,
  `docs/sessions/2026-07-10-docs-consistency-audit.md`; no code/rules change). One-time consistency pass.
  Found and fixed a previously-undetected **triple** `D-GH30` collision (three separate 2026-07-08
  decisions all claimed the same number, one of them within ~8 minutes of another) — renumbered the two
  later ones to `D-GH42`/`D-GH43` per the project's own documented renumber-on-merge fallback, with
  addendum notes and every cross-reference updated. Also fixed `AGENTS.md`'s "Active Priorities" section
  (still named the already-graduated engine-bridge migration as current focus, and still described
  `DATA`/`compute`/`MUT` as unbridged) and a stale `9/0`/`5/0` engine-parity pass count in `AGENTS.md`/the
  roadmap (11 places) that should have read the live `20/0` (`testing/expected/expected-results.csv`'s
  current row count; `testing/README.md` already had it right). Full findings — including one
  possibly-overstated CI-coverage CHANGELOG tag flagged but deliberately left for a human call, and a
  spot-check confirming no other roadmap items are secretly already-done — in
  `docs/sessions/2026-07-10-docs-consistency-audit.md`.
- **2026-07-10 · docs — fix the same stale `9 passed / 0 failed` parity count in `docs/HOW-TO-WORK.md`**
  (`docs/HOW-TO-WORK.md`; no code/rules change). Found during this branch's own parity verification, just
  outside the docs-consistency audit's declared `DECISIONS.md`/`CHANGELOG.md`/roadmap scope, but the same
  class of staleness already fixed there — both spots now correctly say **20**. The same section's
  fixture list (only enumerates 9 of the current 20 fixtures) and `expected-results.csv` column list
  (missing `new_engine_events_applied`) are also stale but left as a noted follow-up rather than fixed
  here — see `docs/sessions/2026-07-10-docs-consistency-audit.md` finding 4b.
- **2026-07-10 · docs(roadmap) — remove stale duplicate "Add Supabase advisor/log check" entry**
  (`docs/PACT_ROADMAP.md`; no code change). The step it asked for was already added to `AGENTS.md`'s
  per-change checklist and graduated to `CHANGELOG.md` on 2026-07-09 (commit `e770e26`) — this was a
  leftover duplicate that never got pruned from the roadmap. No further action needed.
- **2026-07-10 · fix(live-sheet) — reintroduce D-GH5's mobile app-shell so header/overlay buttons stop
  sticking on scroll** (`tools/PACT-Live-Char-Sheet.html`; display-only, `DATA.version` unchanged). D-GH5's
  static-header app-shell (body → non-scrolling flex column, `.layout` as the only scroll region) had never
  actually landed in this file — `.top` was unconditionally `position:sticky` at all viewport widths, so
  Export/Import/Cloud/Sheet-toggle/Campaign kept fighting the same mobile-Chrome repaint bug D-GH5 already
  diagnosed. Added a `@media(max-width:768px)` block (placed after every base rule it overrides, so cascade
  order doesn't silently re-enable `position:sticky`) implementing the app-shell for `.top`/`.eco`/`.bar`/
  `.layout`, plus a simpler fix for the printable-sheet overlay's `.shtop` (AI Portrait/Print/Close) —
  `position:static` there, so it scrolls away with the overlay's own content instead of staying pinned
  (`#sheetview` is its own scroll container, not the window, so it doesn't need the full app-shell
  treatment). Verified headless at 390×700 (mobile) and 1280×800 (desktop, unaffected) via Playwright:
  header now stays put through a 400px `.layout` scroll and `.shtop` correctly scrolls off after a 300px
  overlay scroll. Left `#lmobar` (bottom AP/Undo/Redo bar), `#buysearch` (pinned buy-list search), and
  `#apFloat` (floating AP badge) as intentionally fixed/sticky — none are in scope per the task's own
  "Save/Load/Share/Sheet/AI Portrait/Campaign" list. DM Console's `header.topbar` has the same unconditional
  `position:sticky` but no existing app-shell scaffold to extend into — left out of scope as a possible
  follow-up; CharGen already implements this exact pattern (`.stickyhead` + `.mobile-action-bar`, comment
  "M8"), so no change needed there; index.html has no equivalent header, just transient status
  banners (offline badge, SW-update bar), also left alone.
- **2026-07-10 · test(e2e) — extend the character-gen e2e harness to cover DM Console's roster import**
  (`testing/scripts/random-manual-e2e.mjs`, `.github/workflows/character-gen-e2e.yml`,
  `testing/README.md`; no app code touched, `DATA.version` unchanged). DM Console's roster view needs no
  cloud/auth — files land via a plain `<input type=file>`. The harness now exports its finished, leveled-
  up character via the same envelope the app's own Save button builds (`_cgEnvelope()`), drops it onto
  DM Console's real file input, switches into table view, and cross-checks the rendered roster row's
  species/class/HP/AC/AP-available against the source tool's own numbers — the one place `dmAnalyze()`
  could still drift from `js/engine.js` despite both going through the same bridge (D-GH36/D-GH37), since
  the risk here is envelope-shape, not computation. Also smoke-tests the Skill Matrix/AP Ledger overlays
  and the column-visibility toggle. DM Console's cloud/campaign features (sign-in, award AP, campaign
  rules) are intentionally not exercised — they need a live Supabase session, not just the CDN stub.
  Verified locally: 5/5 iterations passed across varied species/classes/levels. Also added
  `tools/DM-Console.html` to the CI workflow's trigger paths and corrected `testing/README.md`'s stale
  "9 passed / 0 failed" parity count to the current 20/0 baseline.
- **2026-07-10 · feat — engine module-bridge migration complete across all three tools** (`js/engine.js`,
  `tools/PACT-Live-Char-Sheet.html`, `tools/DM-Console.html`; parity 20/0, `DATA.version` unchanged).
  Bridged `activeEvents`/`economy`/`foldBuild` (and DM Console's `MUT`) from `js/engine.js` into Live
  Sheet and DM Console — the piece the D-GH26 "safe subset" pass (`DATA`/`compute`/`baseBuild`) left
  hand-copied. Live Sheet and DM Console call these with an index (`foldBuild(uptoIdx)`, for their
  time-travel/scrub UI) via a small local `eventsUpTo(uptoIdx)` helper that slices the tool's own `LOG`
  before handing it to the engine's array-parameter API — every existing call site's signature is
  unchanged, only the bodies now delegate instead of duplicating the fold/economy logic. This was paused
  once (D-GH36) over a real risk — the engine's real replay populates a per-trait `_raceTraitLocked` map
  the tools' old local folds never produced, and `compute()`'s racial-trait pricing depends on it — and
  resumed (D-GH37) once confirmed the app is pre-launch (no real characters to protect) and that no
  tool's UI actually triggers the `creationLocked`/`campaignBound` events this pricing mechanism depends
  on yet, so the risk doesn't functionally bite in production today regardless. Closes the
  `feat/engine-bridge-all-tools` roadmap item — see `DECISIONS.md` D-GH36/D-GH37 and
  `docs/sessions/2026-07-10-engine-bridge-switch-tool-and-live-bugs.md`.
- **2026-07-10 · fix(chargen) — unbounded AP inflation for any character with an active drawback, on every
  save/load/switch cycle (D-GH41, live-production bug)** (`js/engine.js`, `tools/PACT-CharGen-Webtool.html`;
  `DATA.version` unchanged, no pricing/table change — an internal-value exposure plus two bug fixes to
  code miscomputing an already-correct engine value). CharGen's `#budget` field shows the *combined*
  raw-award-plus-drawback-AP total, but two places (`_cgSyncAward()`'s Step-5 reconcile and
  `_buildEventBurst()`'s whole-LOG regeneration) wrote that combined number back in as if it were the raw
  award — while the drawback's own event kept separately contributing its AP on every future fold,
  compounding without bound on every autosave-restore, file load, and switch-tool handoff. `economy()` now
  exposes the `drawbackEarned` split it already computed internally; both call sites subtract it back out.
  Found and reproduced with the task owner's real uploaded character (one drawback, AP climbing +2 every
  cycle); verified fixed the same way — stable at the mathematically correct total across 4 repeated round
  trips. `engine-parity` 20/0.

- **2026-07-10 · test(ci) — headless Playwright e2e for character gen + advancement (REV-11)**
  (new `testing/scripts/random-manual-e2e.mjs`, `testing/package.json`; new
  `.github/workflows/character-gen-e2e.yml`; `testing/README.md`; no app code touched). Randomly drives
  the real CharGen and Live Sheet UI — species/class selects, ability steppers, skill checkboxes, the
  "Open in Live Sheet"/"Open in CharGen" switch buttons, "+ Award AP", "Level up", buy-panel tiles — with
  its own randomization (never the app's `randomizeBuild()`), and checks the result stays within budget
  and free of unresolved rule warnings. Runs in CI on PRs touching the two tools or `js/engine.js`/
  `js/character-store.js`. Stubs the CDN-hosted Supabase client (`js/supabase-client.js`'s `esm.sh`
  import) so engine boot works offline/in restricted network environments — Supabase is optional, the app
  already runs fully offline against `localStorage`.
- **2026-07-10 · refactor(save-format) — one unified save/export file for both tools (D-GH40)**
  (`js/character-store.js`, `tools/PACT-CharGen-Webtool.html`, `tools/PACT-Live-Char-Sheet.html`; no rules
  change; `DATA.version` unchanged). Replaces three divergent save/export shapes — one of which
  re-synthesized a fake LOG instead of the real one, two of which silently dropped `id` on a round trip —
  with a single canonical `{schema:'pact-character/1', rules, name, LOG, SEQ, id}` envelope both tools now
  write and both read (old shapes still load — nothing already saved is stranded). CharGen's separate
  "Export to Live Sheet" button/converter is removed as redundant. Found while manually testing the
  switch-tool feature ("this file won't load right"). Verified: the new module functions directly in plain
  Node, plus a full round trip in a real browser driving CharGen's actual UI (real button clicks) —
  including an old-format file still loading correctly.

- **2026-07-10 · fix(chargen) — ability-score +/- steppers never reached the LOG (D-GH39, live-production
  bug)** (`tools/PACT-CharGen-Webtool.html`; no rules change; `DATA.version` unchanged). `stepAbil()` set
  the field's value directly and re-rendered, but never dispatched an `input` event — since `st_STR`/etc
  are `readonly`, the stepper was the *only* way to change an ability score, so this silently broke AP
  costing and persistence for every ability-score edit in production. Found via manual testing of D-GH38's
  switch button on Android Chrome. Fixed by dispatching a real `input` event so the stepper goes through
  the same path as a typed value. Confirmed with a real button `.click()` in a headless browser: AP total
  now moves and the change reaches `LOG`.

- **2026-07-09 · feat(tools) — one-click switch between CharGen and Live Sheet on a shared
  `js/character-store.js` (D-GH38)** (new `js/character-store.js`; `tools/PACT-CharGen-Webtool.html`,
  `tools/PACT-Live-Char-Sheet.html`; `service-worker.js` precache + `CACHE_NAME` v2→v3; no rules change,
  `DATA.version` unchanged). Each tool gains an "Open in Live Sheet" / "Open in CharGen" button that carries
  the current character straight to the other tool — no file export/import. **Slice 0:** a shared module
  owns the tool-agnostic handoff transport (`writeHandoff`/`takeHandoff`/`sweepExpiredHandoffs`) plus the
  now-deduplicated `genCharId`; both tools import it (starts correcting the `js/`-shared / `tools/`-UI-only
  rule for persistence). **Slice 1:** the buttons + boot-consume — a same-origin `localStorage`
  per-transfer-key baton (`pact:handoff:<uuid>`, `?handoff=<uuid>` flag only), consume-once, 2-min expiry,
  orphan-key sweep on boot, `?handoff` stripped via `replaceState`. CharGen consumes via the existing
  verbatim `_cgApplyEnvelope` (preserves id); file export/import kept alongside (relabeled "LS file").
  Slice 2 (cloud/campaign round-trip) deferred, isolated so it never blocks the local feature. Two
  ride-along cleanups named but scoped out (dead `_cgBoot` LOG-regeneration scaffolding; wiring
  `creationLocked` into the switch). Plan + two cold reviews + Opus verification pass:
  `docs/plans/2026-07-09-chargen-livesheet-switch-button.md`.

- **2026-07-09 · refactor(tools) — bridge foldBuild/activeEvents/economy to js/engine.js in Live Sheet +
  DM Console (D-GH37)** (`tools/PACT-Live-Char-Sheet.html`, `tools/DM-Console.html`; no `compute()`/`DATA`
  table change; `engine-parity` 20/0). Both tools' local, hand-copied `foldBuild`/`activeEvents`/`economy`
  are now thin adapters over the imported `js/engine.js` versions — `activeEvents`/`economy`/`foldBuild`
  no longer have separate implementations anywhere in the codebase. Lifts D-GH36's pause: with this app
  still pre-launch (no real characters to protect), the racial-trait-pricing risk that paused this doesn't
  apply, and bridging actually fixes an existing inconsistency where CharGen and Live Sheet/DM Console
  disagreed on racial-trait pricing for identical characters (see D-GH37 for the full reasoning).

- **2026-07-09 · fix(dm-console) — bridge `MUT` to js/engine.js (D-GH36)** (`tools/DM-Console.html`; no rules
  change; engine untouched → `engine-parity` 20/0). DM Console now imports `MUT` from `js/engine.js` instead
  of a local copy, fixing two confirmed bugs: `found` previously had no else-branch for a second/later
  founded tradition (silently dropped it) and `dbound` wasn't handled at all (DM Console couldn't process
  that event type). The matching `foldBuild`/`activeEvents`/`economy` bridge (the other half of the same
  cold-reviewed plan) is **paused** — it conflicts with D-GH34's already-shipped racial-trait-pricing fix;
  see `docs/plans/2026-07-09-engine-bridge-live-dm-console.md` and D-GH36.

- **2026-07-09 · chore(release) — bump build v0.107 → v0.200; remove the v0 comparison snapshot**
  (`js/engine.js`, `tools/*.html`, `index.html`, `docs/VERSION-SYNC.md`; no rules change; `DATA.version`
  unchanged at v0.332; engine-parity 20/0). Release-prep for the Phase-2 CharGen rewrite (Steps 3–5 + the
  two fixes). Bumped `BUILD` and mirrored it across CharGen (line-1 comment, `<title>`, header `.sub`), the
  Live Sheet (line-1 comment) and DM Console (`TOOL_VERSION`) per `docs/VERSION-SYNC.md`; `index.html` reads
  `BUILD` live. Removed the frozen pre-Phase-2 comparison artifact — the "Character Generator — v0 snapshot"
  menu card in `index.html`, plus `tools/PACT-CharGen-Webtool-v0.html` and its pinned
  `js/engine-v0-snapshot.js` (nothing else referenced them). Smoke-tested: menu shows one CharGen card and
  "Build v0.200"; CharGen boots clean showing v0.200.

- **2026-07-09 · feat(chargen) — Phase 2 Step 4, Chunk D: Undo/Redo UI + keyboard shortcuts (Step 4 COMPLETE)**
  (`tools/PACT-CharGen-Webtool.html`; no rules change; engine untouched → `engine-parity` **20/0**). Final
  chunk: `↶ Undo` / `↷ Redo` buttons in the desktop header cluster and the mobile nav, enabled/disabled from
  live `HIST`/`REDO` depth (refreshed every `render()`, with step-count tooltips). Keyboard: Ctrl/Cmd-Z undo,
  Ctrl/Cmd-Shift-Z or Ctrl-Y redo — while actively typing in a text field (an open coalescing group) Ctrl-Z
  is left to the browser's native text undo; once the field seals it drives the app history. Verified in a
  real browser 13/13 (V6): boot-disabled state, enable/disable transitions across edit→undo→redo, all three
  shortcuts, mid-edit native-undo preservation, typing undisrupted; engine-parity harness re-run **20/0**.
  With this, **CharGen Step 4 is complete** — CharGen has trustworthy snapshot-based undo/redo and persists
  as an event log, matching the Live Sheet.

- **2026-07-09 · feat(chargen) — Phase 2 Step 4, Chunk C: event-log persistence `{schema,rules,name,budget,LOG,SEQ,id}`**
  (`tools/PACT-CharGen-Webtool.html`; no rules change; engine untouched → `engine-parity` stays 20/0). CharGen
  now saves and autosaves in the Live-Sheet-style event-log shape (schema tag `pact-chargen/1`) — a character
  is stored as *what the player did*. `name`/`budget` ride along top-level (Step-5 DOM shims `foldBuild`
  doesn't carry; omitting `budget` would reset it on reload — the F1 finding). `loadFile` now has three
  branches checked in order: (1) schema-tagged CharGen file — keyed **solely** on the schema tag, validates
  `LOG` is an array (errors without touching the build if not), and reinstates the **authoritative saved
  LOG** verbatim rather than trusting applyBuild's DOM re-derivation (which diverges on compute-managed
  fields parked in hidden controls, e.g. `size`) so save↔load is exact; (2) Live-Sheet export (untagged
  `LOG`) — unchanged, with class/species defaults; (3) legacy flat build — unchanged, so every pre-Step-4
  file still opens. Autosave moved to a versioned key with a one-time migration of the old flat-build key
  (applied, rewritten in the new shape, old key deleted). Share links stay flat (URL length). Verified in a
  real browser 15/15 (V5 + V8): envelope shape, save→reset→reload round-trip (canonical-equal, name+budget
  preserved), legacy-flat + Live-Sheet + missing-LOG-error paths, autosave migration+delete, and
  save→load→undo persisted stability.

- **2026-07-09 · feat(chargen) — Phase 2 Step 4, Chunk B: applyBuild/boot history integration (+ latent randomize-aliasing fix)**
  (`tools/PACT-CharGen-Webtool.html`; no rules change; engine untouched → `engine-parity` stays 20/0). Wires
  the Chunk-A history core into every whole-build-replacement flow so each is exactly ONE undoable step:
  `applyBuild` now suspends history across its whole DOM-write + LOG-rebuild body (via try/finally), and
  callers own the undo semantics — user file-load and Reset (new `resetBuild()`) push a single pre-action
  frame; randomize pushes one frame and suspends across `applyBuild` + the appearance/name resync; boot,
  autosave-restore, and shared-link load pass `{clearHistory:true}` (you can't undo to "before the character
  existed"), and the initial LOG seed is suspended + cleared. **Latent bug fixed along the way:**
  `randomizeRoll` mutated `readBuild()`'s result in place, but `foldBuild(LOG)` returns nested arrays that
  ALIAS the LOG event payloads — so randomize was silently corrupting the live LOG (harmless pre-Step-4
  because applyBuild rebuilt LOG from the DOM afterward, but the new undo frame snapshotted the corruption);
  fixed by deep-cloning the working build. Verified in a real browser 13/13 (V4): boot leaves history empty;
  load/reset/randomize each push exactly one frame; undo after each restores the pre-action build; randomize
  → undo → redo → undo stays canonical-identical with no history accumulation. Persistence shape + button UI
  are Chunks C/D.

- **2026-07-09 · feat(chargen) — Phase 2 Step 4, Chunk A: snapshot-based undo/redo history core (no UI yet)**
  (`tools/PACT-CharGen-Webtool.html`; no rules change; engine untouched → `engine-parity` stays 20/0). First
  chunk of the CharGen undo/redo + persistence work (see
  `docs/plans/2026-07-09-chargen-undo-persist-phase2-step4.md`). Adds a `HIST`/`REDO` snapshot stack (frames
  carry a deep-cloned LOG + the name/budget/id shims), a `commitHistory()` choke point wrapped into the four
  LOG-API functions, `restoreFrame()` (build-equality restore via `applyBuild`, per D5), and `undo()`/`redo()`
  — exercised from the console, not yet wired to buttons (Chunk D). Edit coalescing (D3): only user text
  keystrokes carry a coalesce key; consecutive same-field keystrokes within a 600 ms idle window collapse to
  one undo step, sealed permanently by blur / cross-field / discrete action / undo; net-zero groups are
  dropped (compared on the folded build, not raw LOG bytes). Verified in a real browser 16/16: V1 snapshot
  immutability, V2 undo round-trip (checkbox + patch field + add-row), V3 all four coalescing cases, V7 redo
  symmetry. applyBuild/boot suspension + button UI are Chunks B/D.
- **2026-07-09 · feat(chargen) — Phase 2 Step 5, Chunk B: frame simplification + Step-4 back-compat reconcile (Step 5 COMPLETE)**
  (`tools/PACT-CharGen-Webtool.html`; no rules change; engine untouched → `engine-parity` 20/0). Now that
  name/budget live in the LOG, the Step-4 undo frames no longer special-case them: `_snapshotFrame` drops
  the `name`/`budget` fields and `restoreFrame` no longer re-writes `#cname`/`#budget` (applyBuild paints
  them from `foldBuild(f.log)`) — which also removes the Step-4 wrinkle where undoing a buy could revert a
  later name edit (name/budget are now independently undoable). Adds a `_cgApplyEnvelope` reconcile: a
  pre-Step-5 (Step-4) saved file can hold a top-level name/budget that differs from a now-stale `name`/`award`
  in its LOG, so after reinstating the authoritative LOG we re-sync the singleton events to the top-level
  values (suspended → no undo frame; a no-op for already-consistent Step-5 files). Verified in a real browser
  10/10 (V4–V5): mixed-edit undo/redo round-trips build **and** name/budget, randomize→undo restores them,
  Step-5 save round-trips name/budget purely via the LOG, a simulated stale Step-4 file heals to its
  top-level values, and legacy flat builds still carry name/budget. **Step 5 complete** — CharGen is now
  fully event-sourced with no DOM-backed build fields.

- **2026-07-09 · feat(chargen) — Phase 2 Step 5, Chunk A: name + budget are first-class LOG events (shims retired)**
  (`tools/PACT-CharGen-Webtool.html`; no rules change; engine untouched → `engine-parity` 20/0). Wires live
  `#cname`/`#budget` edits to the engine's native `name`/`award` event types via a coalescing singleton-event
  helper (`_cgSyncSingletonEvent` → `_cgSyncName`/`_cgSyncAward`), routed through `onPatchFieldChange` so
  keystrokes collapse into one undo step. `readBuild()` is now simply `foldBuild(LOG)` — the last two DOM
  shims are gone and the build is FULLY event-sourced. `genName()` (🎲 Generate) now syncs the LOG name
  event too. The budget award is tagged `noLock` and, unlike the Live Sheet, does NOT lock undo history —
  budget stays a freely-editable creation parameter (CharGen's snapshot undo has no award-lock guard).
  Verified in a real browser 15/15 (V1–V3): live edits event-sourced with no DOM override, exactly one
  `name`+one `award` event, name/budget now first-class undo steps, singleton invariant + no-op skip,
  genName sync. Full Step-4 regression (66 checks) + parity stay green. restoreFrame/persistence
  simplification is Chunk B.

- **2026-07-09 · fix(chargen) — export burst dropped `size` and `wornArmour` (CharGen → Live Sheet)**
  (`tools/PACT-CharGen-Webtool.html`; no rules change; engine untouched → `engine-parity` 20/0). Two gaps in
  `_buildEventBurst`: (1) the `'Character size'` patch was **unconditionally** skipped by
  `skipZeroCostPatch`, so a Gnome's chosen size never reached the Live Sheet (removed the size clause — it
  now emits a 0-AP size event like the other free patches); (2) the Armour patch emitted only `armour` (the
  proficiency object), never `wornArmour` (the equipped-armour name), even though the ARMOUR slot is
  `{armour, wornArmour}` together — added `wornArmour` to the patch. Verified in a real browser: a
  Gnome-Small + Leather-Armour build round-trips both fields through export→fold; a default Medium / no-worn-
  armour build round-trips cleanly with no false data.
- **2026-07-09 · fix(chargen) — DM house-rules bar handlers threw `ReferenceError: ck is not defined`**
  (`tools/PACT-CharGen-Webtool.html`; no rules change; engine untouched). `dmAdd`, `dmDisableBuiltin`,
  `dmRemove`, and `dmToggleDisable` each ended with a stray `ck('artck',b.arts||[])` — a copy of
  `applyBuild`'s art re-tick, but `ck` (a local const inside `applyBuild`) and `b` aren't in scope in these
  handlers, so the call threw and the `render()` right after it never ran (grids rebuilt, arts unticked,
  totals stale). Removed the line: `buildArtGrid()` already re-ticks arts from `readBuild().arts` (the LOG)
  post-Step-3-flip, so the call was redundant as well as broken. Verified in a real browser (add / disable /
  toggle / remove custom boons+drawbacks all run without throwing).

- **2026-07-09 · chore(merge) — merge `preview` into `feat/chargen-emit-migration` (parity 16/0 → 20/0)**
  (`testing/`; no rules/tool-logic change). Brought the emit-migration branch up to date with `preview`,
  which had advanced with PR #131 (Live Sheet cloud-status label — auto-merged clean) and PR #136 (four
  new engine-parity fixtures). PR #136 introduced its own CG-004/005/006 + EV-002, colliding with the IDs
  this branch already used for the D-GH34 lock-fallback fixtures; resolved by renumbering PR #136's builds
  to **CG-007/008/009** and its drawback-buyoff event to **EV-010** (files `git mv`d, `test_id`s and CSV
  rows updated with "renumbered from PR #136" notes). The parity harness's one hardcoded prereq-gate
  assertion was repointed from `CG-004` to `CG-007` so it stays on PR #136's fixture (the real browser
  gate caught this — the node mirror did not). Harness now **20/0** (browser + node). No `DATA.version`
  change; both fixture sets coexist.

- **2026-07-09 · feat(chargen) — Phase 2 Step 3, Chunk 6: THE FLIP — CharGen is now event-sourced (emit-migration COMPLETE)**
  (`tools/PACT-CharGen-Webtool.html`; no rules change; `testing/tests/engine-parity.html` → 16/0). Final
  chunk of the CharGen emit()-migration. `readBuild()` now returns `foldBuild(LOG)` — the event LOG is the
  source of truth; a character *is* its LOG, and CharGen + the Live Sheet are interchangeable views over
  it. `name`/`budget` are read from the DOM as documented Step-3 shims (full event-sourcing of
  budget/awards is Step 5). The DOM stays the input layer (no full repaint — verified typing is
  undisrupted). All shadow-diff/audit scaffolding removed (`canonicalBuild()` retained). The strengthened
  Category-G audit caught a real post-flip bug — `annotate()` auto-unchecked prerequisite-invalid controls
  (expertise without its skill, cross-race trait after a species change, etc.) without retracting the LOG
  event, so `foldBuild(LOG)` kept counting them — fixed with `_cgReconcileChecklistDependents()`
  (retract-only, precision-guarded). Cold-reviewed plan
  (`docs/plans/2026-07-09-chargen-emit-migration-chunk6-flip.md`); the implementation diff independently
  reviewed (8/8 checks passed). Verified: parity 16/0, both LOG_SYNC_GUARDs consistent, all four plan
  invariants pass (Build Projection, LEFTOVER_STATE=0, Budget Validation, and the authoritative-LOG
  proof — suppressing an emit makes a control change stop sticking), full Chunk 0–5 regression green.

- **2026-07-09 · feat(chargen) — Phase 2 Step 3, Chunk 5: whole-build-replacement convergence (LOG synced after every load flow)**
  (`tools/PACT-CharGen-Webtool.html`; no rules change; `testing/tests/engine-parity.html` → 16/0). Seventh
  chunk of the CharGen emit()-migration plan. Every whole-build-replacement flow (loadFile — both the
  CharGen-flat and Live-Sheet-LOG branches — loadFromHash, autosave-restore, Reset, randomize) now rebuilds
  LOG from the freshly-written DOM via `replaceWholeLogFromBuild(_domReadBuild())`, so a mid-session load
  leaves LOG in sync with the loaded build (not just at boot). Reading `_domReadBuild()` rather than the
  passed build is load-bearing — randomize's scratch build never holds appearance/name, which go to the DOM
  only. Verified all five plan scenarios (flat load, Live-Sheet-LOG load, shared-link round-trip,
  pre-migration autosave restore, randomize) leave `foldBuild(LOG)` reproducing the DOM's structure and
  compute total; independently reviewed (8/8 passed). Incremental live typing of `name`/`budget` (which
  tie into the Chunk 6 `readBuild()` flip's reconstruction) is deferred to Chunk 6. No user-facing behavior
  change (Option A).

- **2026-07-09 · feat(chargen) — Phase 2 Step 3, Chunk 4B: traditions/disciplines → one coalescing TRADITIONS patch**
  (`tools/PACT-CharGen-Webtool.html`; no rules change; `testing/tests/engine-parity.html` → 16/0). Sixth
  and riskiest chunk of the CharGen emit()-migration plan (its own rollback boundary). The whole
  `traditions` array is serialized into a single `replacePatchSlot(PATCH_SLOTS.TRADITIONS, ...)` on every
  edit — NEVER a granular indexed `found`/`rank`/`cantrip`/`slot`/`known`/`dbound` event (the plan's hard
  LOG-invariant #7, actively asserted). A `closest('.tcard')` `#form` delegation handles all tradition
  controls (all class-only, no double-handling); the two inline ✕-removal onclicks were converted to
  helpers (the only user-visible change — verified behavior-preserving and more null-safe). The TRADITIONS
  patch carries `traditions` only, not `dabblerCantrips` (owned by the MISC slot since Chunk 2) — verified
  deterministic across interleaved edits. Verified with a caster-heavy golden build (Wizard+Warlock, pact
  slots, arcanum: DOM↔`foldBuild(LOG)` deep-match, total 242==242, one coalesced slot event) and both ✕
  buttons. Independently reviewed (9/9 checks passed, no fixes needed). No user-facing behavior change
  (Option A) beyond the internally-equivalent removal-button refactor.

- **2026-07-09 · feat(chargen) — Phase 2 Step 3, Chunk 4A: customProfs/freeSub wiring + patch-slot hardening + unlockclass fix**
  (`tools/PACT-CharGen-Webtool.html`; no rules change; `testing/tests/engine-parity.html` → 16/0). Fifth
  chunk of the CharGen emit()-migration plan. Wires `customProfs` and `freeSub` (coalescing-patch fields
  whose controls carry no `id`, so Chunk 2's id-keyed delegation missed them) via a new class-keyed patch
  delegation plus add/remove nudges. Extracts a shared `_cgSyncPatchSlot()` no-op-skip primitive (Chunk
  2's cascade had it inlined) and refactors the Category B handlers to use it. Fixes the real
  origin-class ↔ unlockedClasses divergence flagged by Chunk 3's review, via `_cgReconcileUnlockClass()`
  on IDENTITY-slot changes. Independently reviewed (8/8 checks passed, no fixes needed); a comprehensive
  mixed-editing test confirmed DOM and `foldBuild(LOG)` fully agree across all converted fields and total
  AP. No user-facing behavior change (Option A).

- **2026-07-09 · feat(chargen) — Phase 2 Step 3, Chunk 3: Category C add-row lists + unlockedClasses wired to LOG**
  (`tools/PACT-CharGen-Webtool.html`; no rules change; `testing/tests/engine-parity.html` → 16/0). Fourth
  chunk of the CharGen emit()-migration plan. `unlockedClasses` reused Chunk 1's checkbox-per-value
  mechanism (with a branch for `classunlock`'s `dataset.cls`-not-`value` quirk). `features`/
  `subAbilities`/`subSpellBundles` needed a new multiset-reconciliation function (`_cgSyncFlatCategory`)
  instead, since their add-row UI is dynamic and features can legitimately repeat — a plain set-diff
  would collapse two identical repeatable-feature picks into one LOG event. Found and closed three
  "direct assignment, no event fires" gaps (`addRow()`'s preset path, the row-removal button, and the
  autocomplete's `pick()`), the same class of bug Chunk 1's post-commit fix found for `annotate()`'s
  auto-corrections. Independently reviewed (8/8 checks passed); verified the repeatable-feature case
  directly (2 picks → 2 LOG entries; removing one row → exactly 1 remaining). One latent, pre-existing-
  class gap noted but not fixed (self-heals, invisible under Option A): flagged for Chunk 4A/6.

- **2026-07-09 · feat(chargen) — Phase 2 Step 3, Chunk 2: Category B scalar/object fields wired to replacePatchSlot()**
  (`tools/PACT-CharGen-Webtool.html`; no rules change; `testing/tests/engine-parity.html` → 16/0). Third
  chunk of the CharGen emit()-migration plan. All Category B scalar/object fields (stats, hd, profBonus,
  hardy/tough, weaponProf, armour, wornArmour, languages, attune, ki, sorcery, gold, martiallyBound,
  dabblerCantrips, houseRules/DM toggles, appearance, innate spells) now dual-write into `LOG` via
  `replacePatchSlot()`, id-keyed through one delegated `#form` listener. Found and closed a real taxonomy
  gap: `originClass`/`originClass2`/`species`/`species2`/`lineage` were genuine Category B fields missing
  from the cold-reviewed plan's entire field enumeration — grouped under the already-declared-but-unused
  `PATCH_SLOTS.IDENTITY`. Added three new canonical slots (`VIGOR`, `INNATE`, `MISC`) for other orphaned
  fields rather than overloading an unrelated existing slot. The STR<10 armour guard (Category F) is
  enforced both directly and via a STATS→ARMOUR re-patch cascade. An independent review before this
  landed found and fixed: a still-missing `lineage` field, needless LOG churn from an unconditional
  cascade and from `ap_*_lock` UI-only checkboxes false-matching the appearance-field prefix, and an
  undocumented `budget` exclusion. Verified: 21 fields directly confirmed matching between DOM and
  `foldBuild(LOG)`; the repeated-edit cost-delta invariant holds through the full UI path; full regression
  suite green.
- **2026-07-09 · fix(chargen) — Phase 2 Step 3, Chunk 1 follow-up: prevent duplicate LOG entries from DOM-side bypass unchecks**
  (`tools/PACT-CharGen-Webtool.html`; no rules change; `testing/tests/engine-parity.html` → 16/0). A second
  independent review of Chunk 1's diff (below) found a real bug after it had already landed:
  `onChecklistToggle`'s CHECK path had no duplicate guard, and several pre-existing `annotate()` DOM-side
  auto-corrections set `.checked=false` directly without dispatching a `change` event — meaning
  `retractFlatEvent()` never ran for them, leaving `LOG` with a stale entry the DOM no longer reflected. A
  later re-check of the same box would then emit a genuine duplicate `LOG` entry. Fixed with an idempotency
  guard: `onChecklistToggle` now no-ops on CHECK if `LOG` already has a matching `(cat, value)` entry.
  Verified by directly simulating the bypass scenario (before: 2 entries after re-check; after: stays at
  1) and confirming a normal check→uncheck→recheck cycle still correctly cycles 1→0→1. Full regression
  suite reconfirmed green.
- **2026-07-09 · feat(chargen) — Phase 2 Step 3, Chunk 1: Category A checkboxes + Category D grids wired to LOG**
  (`tools/PACT-CharGen-Webtool.html`; no rules change, `DATA.version` untouched; `testing/tests/engine-parity.html`
  → 16/0). Second chunk of the CharGen emit()-migration plan. All 12 flat checkbox categories (saves,
  skills, expertise, tool expertise, tools, instruments, masteries, racial traits, racial spells, boons,
  drawbacks, arts) now dual-write into `LOG` via one delegated listener (`onChecklistToggle`), in addition
  to the existing DOM-driven display — DOM stays authoritative (Option A) so this is not a user-visible
  change. Pricing is computed against the current full DOM-derived build, not `foldBuild(LOG)` (which is
  still stale for every category not yet converted) — confirmed to exactly reproduce the existing
  hardcoded drawback-cost formula via direct test. `buildArtGrid`/`buildBoonGrid`/`buildDrawGrid` (Category
  D) converted to read checked-state from `foldBuild(LOG)` instead of `ckVals()`, after tracing every call
  site (boot, `applyBuild`, `applyCampaignCode`, filter re-renders) to confirm the change is safe. Verified
  with real click/restore-flow browser tests plus the parity suite; independently reviewed. Surfaced (not
  fixed — tracked separately) a pre-existing bug: `dmAdd()`/`dmDisableBuiltin()`/`dmRemove()`/
  `dmToggleDisable()` throw `ReferenceError: ck is not defined` when called, unrelated to this chunk.
- **2026-07-09 · feat(chargen) — Phase 2 Step 3, Chunk 0: LOG mutation API + shadow-diff scaffolding (no behavior change)**
  (`tools/PACT-CharGen-Webtool.html`; no rules change, `DATA.version` untouched; `testing/tests/engine-parity.html`
  → 16/0). First chunk of the CharGen emit()-migration plan (cold-reviewed:
  `docs/plans/2026-07-09-chargen-emit-migration-phase2-step3.md`). Adds CharGen-local `LOG`/`SEQ` and the
  sole LOG-mutation surface (`emit`, `retractFlatEvent`, `replacePatchSlot`, `replaceWholeLogFromBuild`),
  a runtime-enforced `RETRACTABLE_FLAT_CATS` allowlist and `PATCH_SLOTS` registry, and a dev-only
  (`?cgShadow=1`) pre/post-render shadow-diff comparing the DOM-derived build against `foldBuild(LOG)`,
  backed by four LOG-invariant assertions. `readBuild()` (renamed original kept as `_domReadBuild()`) still
  returns the DOM-derived build — Option A, the flip to `foldBuild(LOG)` is deferred to the plan's final
  cleanup chunk — so this chunk changes no visible behavior; verified via a live DOM interaction (racial
  trait checkbox still re-prices correctly, `LOG` stays frozen at its boot snapshot since no handler is
  converted yet) and a full parity run. `buildToLiveLog()`'s event-burst logic is factored out into a
  shared `_buildEventBurst()`/`buildToEventLog()` (used to seed `LOG` once at boot) with no behavior change
  to `buildToLiveLog()` itself — confirmed via the same before/after round-trip check used for the D-GH34
  fix. Building the shadow-diff surfaced two pre-existing, unrelated gaps in the CharGen→Live-Sheet export
  burst (present before this chunk, not introduced by it): `size` is never exported (an unconditional
  `||` in `emitPatch`'s `skipZeroCostPatch` check always skips the "Character size" patch), and
  `wornArmour` has a real `MUT` mutator but was never wired into the burst at all. Deliberately not fixed
  here — output as a roadmap item for a human to fold in (see chat) rather than slipped into a
  "no behavior change" scaffolding chunk.
- **2026-07-09 · refactor(engine,chargen,testing) — post-D-GH34 code review cleanup pass**
  (`js/engine.js`; `tools/PACT-CharGen-Webtool.html`; `testing/tests/engine-parity.html`;
  `testing/fixtures/events/*`; `DATA.version` unchanged — no `compute()` behavior change;
  `testing/tests/engine-parity.html` → 16/0). Follow-up cleanup for six lower-priority findings
  from the D-GH34 code review, all verified to change no engine output: (1) `_replay()`'s two
  passes merged into one loop, with spend-classification logic factored into a shared
  `_spendCost()` helper used by both `_replay()` and `economy()`; (2) dead `SOFT_WARN`/`isAdvisory`
  regex clauses referencing the removed "priced at character-creation" warning text removed from
  both `tools/PACT-Live-Char-Sheet.html` and `tools/PACT-CharGen-Webtool.html`; (3) the v0 snapshot's
  pre-existing rule exception left as-is (already disclosed and intentional, no code change needed);
  (4) CharGen's `liveBase()` — a standalone scratch-object constructor that had drifted out of sync
  with the engine's `baseBuild()` — now derives from the imported `baseBuild()` with an explicit
  `inPlay=false` override; a naive delete-and-reuse of `baseBuild()` was checked first and found to
  silently regress `buildToLiveLog()`'s racial-trait export pricing (`baseBuild()`'s `inPlay:true`
  default now has real pricing meaning under D-GH34's fallback), so the override is kept and
  commented as load-bearing, not a leftover; (5) `_lsImportFold()`, a one-line pass-through wrapper
  left over from the D-GH33 swap to the real `foldBuild()`, deleted and inlined at its single call
  site; (6) the 8 near-identical `baseSnapshot` objects duplicated across `EV-002`–`EV-009` collapsed
  into one shared fixture (`testing/fixtures/events/_shared/base-halfling.json`), referenced via a new
  `baseSnapshotRef` field the harness's loader resolves relative to each fixture's own path. Verified
  via the full parity suite (still 16/0), a browser round-trip re-check of `buildToLiveLog()`'s racial-
  trait pricing (unchanged), and a live run of the browser test harness confirming every
  `baseSnapshotRef` resolves correctly.
- **2026-07-08 · fix(engine) — restore racial-trait pricing in Live Sheet & DM Console; wire noLock into CharGen's export (D-GH34)**
  (`js/engine.js`; `tools/PACT-CharGen-Webtool.html`; `DATA.version` v0.334→v0.335; 3 new fixtures
  `CG-004`–`CG-006`; `testing/tests/engine-parity.html` → 16/0). An 8-angle code review of D-GH31/32/33
  found a live, shipping regression: `compute()`'s racial-trait pricing had switched from an
  always-`true` whole-build flag to a per-trait map only the engine's own internal replay populates —
  and Live Sheet and DM Console each have their own separate, hand-copied local fold logic that never
  calls that replay, so racial-trait pricing in both tools silently and permanently dropped to the cheap
  creation rate for every character. A related display feature (the "paying a premium vs. creation-basis
  pricing" banner) went inert for the same reason. Separately, `buildToLiveLog()` never tagged its
  emitted events `noLock:true`, leaving the mechanism built specifically for that scenario (D-GH31)
  unused in the one function that needed it. Fixed via a cold-reviewed plan
  (`docs/plans/2026-07-08-racial-trait-pricing-regression-fix.md`): `compute()` now checks
  `_raceTraitLocked` by key **presence**, not truthiness, falling back to the old `inPlay`-based
  behavior when a trait has no entry at all — restoring the two affected tools' exact pre-regression
  pricing with no changes to either tool's own files. `buildToLiveLog()`'s single event-emission funnel
  now tags every event `noLock:true` unconditionally. Verified directly (both the pricing restoration and
  the noLock fix) and via three new fixtures, one specifically constructed so a future regression back to
  truthiness-only checking would fail a test instead of shipping silently. See D-GH34 for the full record
  and the general lesson about replay-derived engine state and independently-constructed callers.
- **2026-07-08 · fix(chargen) — import real js/engine.js MUT/foldBuild/activeEvents/economy/baseBuild; fixes a real multi-discipline import bug (D-GH33, Phase 2 step 2)**
  (`tools/PACT-CharGen-Webtool.html`; no rules change, `DATA.version` untouched by this step). CharGen's
  module bridge now imports `MUT`/`foldBuild`/`activeEvents`/`economy`/`baseBuild` from `js/engine.js`
  alongside its existing `DATA`/`compute`, replacing two local throwaway copies. A parity check (required
  by the Phase 2 plan before this swap) found real drift matching a divergence already documented for DM
  Console's separate local `MUT`: the local `found` mutator silently dropped a second discipline added to
  an already-founded tradition, and `dbound` (discipline-bound flag) didn't exist locally at all — so a
  multi-discipline or bound-discipline character exported from Live Sheet and re-imported into CharGen
  silently lost that data. Fixed automatically by the swap, verified in a real browser (a synthetic
  two-discipline-plus-`dbound` LOG now round-trips correctly; a representative build round-trips through
  export→import at an identical price). CharGen's live editing UI (~75 handler sites, `readBuild()`,
  `render()`) is untouched — only the import/export paths changed. See D-GH33.
- **2026-07-08 · feat(engine) — automatic `creationLocked` now requires campaign binding (D-GH32, Phase 2 step 1)**
  (`js/engine.js`; `DATA.version` v0.333→v0.334; 2 new fixtures `EV-008`/`EV-009`; `EV-003`/`EV-007`
  updated to include a `campaignBound` event; `testing/tests/engine-parity.html` → 13/0). First engine
  increment of Phase 2 (see `docs/plans/2026-07-08-chargen-livesheet-unification-phase2.md`): the
  automatic (threshold-crossing) `creationLocked` trigger now only fires for a character that has a
  `campaignBound` event somewhere in its LOG — a purely local, never-campaign-bound character (CharGen's
  standalone use case) never auto-locks via spend alone, only via an explicit action. The explicit
  `creationLocked` event stays unconditional. A late `campaignBound` event fires the automatic lock
  retroactively at the point of binding, not applied to purchases before it. `campaignBound` is unrelated
  to the existing `cat:'campaign'`/`b.campaign` mutator, which is Live Sheet's local offline house-rules
  code-paste feature (`applyCampaignCode()`) — flagged clearly in code comments and D-GH32 to prevent
  future confusion between the two. See D-GH32 for the full rationale.
- **2026-07-08 · chore — freeze a CharGen v0 snapshot for Phase 2 side-by-side comparison**
  (new `tools/PACT-CharGen-Webtool-v0.html`, new `js/engine-v0-snapshot.js`; `index.html` gets a new
  linked card; no rules change, `DATA.version` untouched). Ahead of the Phase 2 CharGen rewrite (the
  D-GH31 unification effort), snapshot the pre-Phase-2 tool + its exact engine dependency as of commit
  `eb113be` so the owner can compare old-vs-new behavior side by side once Phase 2 lands on the real
  `tools/PACT-CharGen-Webtool.html`. `PACT-CharGen-Webtool-v0.html` pins its module-bridge import to
  `js/engine-v0-snapshot.js` (a frozen copy of `js/engine.js`, `DATA.version` v0.333) instead of the live
  engine, so its behavior can't drift as Phase 2 work continues — deliberately breaks the "one engine"
  rule for this one throwaway comparison artifact only, flagged in both files' headers. Not added to
  `service-worker.js`'s `PRE_CACHE` list (a temporary comparison tool doesn't need offline pre-caching).
  Delete both files (and the `index.html` card) once the comparison is no longer needed.
- **2026-07-08 · feat(engine) — `creationLocked` event/threshold replaces the dead `b.inPlay` flag (D-GH31, Phase 1 of 3)**
  (`js/engine.js`; `DATA.version` v0.332→v0.333; 6 new fixtures `EV-002`–`EV-007`;
  `testing/tests/engine-parity.html` → 11/0). Engine-only phase of a larger CharGen/Live-Sheet
  unification: a new `creationLocked` LOG event, plus automatic inference once cumulative AP spend
  crosses `DATA.level1AP`, now drives racial/species-trait pricing — replacing a flag that was
  unconditionally `true` for every character and therefore inert. Tagging is **per-purchase** (via
  `_replay`), not a whole-build flag, specifically because a whole-build flag would reproduce D-GH30's
  exact bug shape (a later state retroactively repricing earlier purchases) — caught by a cold review of
  the implementation plan before any code was written. A second gap, found only by actually building and
  testing the mechanism: a one-shot import/creation burst above the anchor would self-trigger the
  automatic lock partway through, mispricing traits bought later in that same burst. Fixed with an
  event-level `noLock: true` flag that exempts specific events from the automatic-threshold accumulation
  (real AP accounting is unaffected) — verified by `EV-006`/`EV-007`. See D-GH31 for the full design
  record, the cold-review outcome, and a build-time correction (the implementation plan wrongly assumed
  `DATA.level1AP` didn't exist; it already did, as `50`). No tool UI changes in this phase — CharGen,
  Live Sheet, and DM Console are all untouched, so nothing about either tool's real behavior changes yet.
  Supersedes and closes the `feat/ap-model-reconcile` NEXT item (D-GH30's deferred follow-up).
- **2026-07-08 · docs — correct stale roadmap text around the engine module-bridge migration; graduate "Task 6"**
  (`docs/PACT_ROADMAP.md`; no code/rules change). `/pick-task` surfaced that the NOW item "Full engine
  module-bridge migration" still described the original all-seven-symbols scope even though a first pass
  already shipped a reduced "safe subset" (D-GH26, PR #121) — rewrote it to describe only the actually
  remaining work (`activeEvents`/`economy`/`foldBuild` reconciliation, CharGen's and DM Console's
  divergent `MUT`). Also found the separate NEXT item "Task 6 — CharGen module bridge migration" was
  already fully done by that same D-GH26 pass (CharGen's `DATA`/`compute()` bridge) but never graduated —
  removed it and updated the four other roadmap items that still gated on "Task 6" as if it were open
  (`feat/chargen-campaign-rules` now correctly blocked on CharGen not yet importing `validate()`, not the
  old gate; `feat/ap-by-level` and AUD-1's version-sync follow-up are now unblocked; `feat/save-integrity`'s
  stale coordination note dropped; AUD-1's main drift check narrowed to just `MUT`, since `DATA`/`compute`/
  `baseBuild` can no longer drift now that they're live imports).
- **2026-07-08 · docs — fold the `feat/ap-model-reconcile` item into the roadmap**
  (`docs/PACT_ROADMAP.md`, `AGENTS.md`; no code/rules change). The owner reviewed the output block from
  the prior commit and asked for it to be added directly — folds in the NEXT item deferred from D-GH30
  (whether `js/engine.js` should grow a frozen-ledger-aware remaining-AP export, or the current per-tool
  compute()/economy() split is the permanent design).
- **2026-07-08 · docs — session note for the AP-display fix; revert a roadmap single-writer slip**
  (`docs/sessions/2026-07-08-livesheet-ap-display-fix.md`; `docs/PACT_ROADMAP.md`, `AGENTS.md`; no
  code/rules change). `docs/PACT_ROADMAP.md` is single-writer — agents must output new items for the
  human to fold in, never append directly. The prior commit did that correctly when it *removed* the
  resolved `fix/livesheet-undo-bug` item, but then directly appended the new `feat/ap-model-reconcile`
  NEXT item instead of outputting it. This commit reverts that append (the item is re-posted as a plain
  output block below, for the owner to fold in by hand) and adds the session note documenting the wrong
  root-cause premise and the Option A/B decision behind D-GH30.
- **2026-07-08 · fix(live-sheet) — "AP left" now reads the frozen ledger instead of a retroactive recompute**
  (`tools/PACT-Live-Char-Sheet.html`; display-only, no `js/engine.js` change, no `DATA.version` bump).
  Investigating the reported `fix/livesheet-undo-bug` roadmap task disproved its premise — `undo()` was
  already correct (verified against a full LOG re-fold across every event type). The actual bug: buying a
  cross-class feature then binding that class (Martially/Magically Bound) made the headline "AP left"
  drift 1 AP above what the buy-gate would actually let you spend, because it read `compute().remaining`
  (which retroactively discounts earlier purchases of the bound class) instead of the frozen-ledger
  `economy().available` already used to gate purchases. Fixed all three "AP left" displays (desktop econ
  line, mobile sticky bar, floating badge) to read `eco.available`. See D-GH30 in `DECISIONS.md` for the
  full write-up and the deferred long-term reconciliation, now tracked as a new NEXT roadmap item
  (`feat/ap-model-reconcile`).
- **2026-07-09 · docs(agents) — add Supabase advisor/log check to the per-change checklist** (`AGENTS.md`;
  no code/rules change). Step 4 of the per-change checklist now requires running the Supabase advisor
  (`get_advisors`) and skimming recent logs (`get_logs`) after any migration/RLS/schema change, before
  opening the PR — this project has already been bitten twice by grant/RLS drift that internal guards
  masked (D-GH15, D-GH12). Closes roadmap item "Add Supabase advisor/log check to the per-change
  checklist".
- **2026-07-09 · docs(github) — add PR template with per-change checklist + review-cadence line**
  (`.github/pull_request_template.md`, new file; `docs/PACT_ROADMAP.md`). Every new PR against this repo
  now auto-populates with AGENTS.md's per-change checklist (parity gate, CHANGELOG/DECISIONS/sessions
  updates, roadmap graduation, version-sync check) plus a review-cadence reminder: run `/code-review`
  (low/medium) before merge, `/code-review ultra` specifically for PRs touching `js/engine.js` or `sql/`.
  Closes roadmap item "A2 — PR template with review-cadence checklist".
- **2026-07-09 · test — expand engine-parity coverage past the 5 budget/empty/over-budget fixtures** (`testing/tests/engine-parity.html`, `testing/fixtures/builds/CG-004..006-*.json`, `testing/fixtures/events/EV-002-drawback-buyoff.json`, `testing/expected/expected-results.csv`; test-coverage only — `js/engine.js`/`DATA` untouched, `DATA.version` unchanged). Audited `compute()`'s branches against the 5 existing fixtures and found no coverage of prereq-gate rejection, drawback buy-off, racial/mastery discount stacking, or multi-tradition spellcasting. Added 4 new fixtures, each captured via Node import of `js/engine.js` (the documented CLI-agent method in `docs/HOW-TO-WORK.md`) and hand-verified against the Player's Guide before pinning into the CSV: **CG-004** (expertise-without-skill + mastery-without-weapon-prof + duplicate-feature + medium-armour-without-STR-10 — all warn but stay valid, confirming gates inform rather than block), **CG-005** (a Halfling's non-pack racial trait re-priced from its 4 AP creation cost to 13 AP when bought in-play at Tier 4, plus 2-mastery ladder stacking), **CG-006** (two separate Arcane/Divine traditions each paying their own Foundation+Rank, vs. one tradition with 2 disciplines), and **EV-002** (a drawback bought then bought off at 3× cost — ends up fully absent from the folded build and its AP line, regardless of buy/buyoff event order, since `activeEvents()` pre-scans the whole log for `buyoff` entries before replay starts). Engine-parity now reports **9 passed / 0 failed**. See `docs/sessions/2026-07-09-expand-engine-parity-coverage.md` for the gap audit and the CG-003-style bespoke assertion added for CG-004.
- **2026-07-08 · chore(skills) — `/pick-task` and `/run-task` now suggest a Haiku/Sonnet/Opus engine tier per task**
  (`.claude/commands/pick-task.md`, `.claude/commands/run-task.md`; skill-only, no rules/code change).
  `pick-task`'s Step 3 "Check 2" was a binary Sonnet-floor/Opus-escalation check; it's now a three-tier
  recommendation — Haiku for tasks that came through Step 2's quick/difficulty filter (docs-only,
  config/manifest, single-file CSS/copy, isolated obvious-cause fixes), Sonnet as the floor for a normal
  full roadmap task, Opus only for real rework risk (engine rules logic, data-model/migration decisions,
  cross-tool contracts, genuine architectural trade-offs). Effort stays a separate axis (default High,
  escalate to `xhigh`/`max` only for genuinely ambiguous judgment calls). Step 4's hand-off now reports
  the suggested engine per task and tells the user to run `/model <engine>` first if the session isn't
  already on it, since neither skill can switch the running model itself; `run-task` restates the
  inherited suggestion before Step 4 (enter worktree) for the same reason.
- **2026-07-08 · fix — surface cloud/campaign status in CharGen + Live Sheet** (`tools/PACT-CharGen-Webtool.html`, `tools/PACT-Live-Char-Sheet.html`; display-only, no engine/`DATA.version` change; `js/engine.js` diff is empty — parity 5/0). CharGen now shows a persistent "🔒 Local only — not connected to any cloud campaign" badge in its header, and its local, text-code house-rules feature (previously labeled "🛡 Campaign" — a naming collision with the real cloud campaign system) is relabeled "🛡 House rules code" with a clarified tooltip and modal copy. Live Sheet gains a persistent status badge next to the ☁ Cloud button, outside its dropdown, showing sign-in state and — when the loaded character has a `campaign_id` — the campaign name plus whether the DM's rules were actually fetched: "☁ Campaign: <name> — DM rules active" vs a warning "⚠ Campaign: <name> — rules unavailable" if the fetch failed or returned nothing. No enforcement/validation behavior changed (`validate()`, `cloudRuleBarred()`, the live-filter pickers are untouched); the badge only reads state `refreshCloudCampaignRules()` and the cloud-character-load handler already compute. See DECISIONS.md D-GH42 (originally logged as D-GH30, renumbered — see its addendum).
  Closes the "Cloud/campaign state is invisible to players" roadmap item.
- **2026-07-08 · docs(skills) — fold three proven worktree gotchas into `/run-task`** (`.claude/commands/run-task.md`;
  no code/rules change). PACT sessions have independently hit and fixed three `EnterWorktree`/`preview_start`/
  `ExitWorktree` gotchas over the past week (now indexed as H-018/H-027/H-028 in the cross-project
  `ai-lessons-learned` repo, all three sourced from this repo's own past sessions): `EnterWorktree` can
  silently base a new worktree on a stale branch snapshot, `preview_start` resolves `launch.json` against
  the main repo root rather than the worktree's, and `ExitWorktree`'s "N commits will be discarded" refusal
  can count already-pushed upstream commits pulled in by a rebase. Adds a verify-the-base check to Step 4, a
  `preview_start`/`launch.json` caveat to Step 5, and an `ExitWorktree` refusal caveat to Step 8, so future
  `/run-task` runs don't rediscover the same three issues from scratch. `docs/sessions/2026-07-08-worktree-gotcha-docs.md`
  has the full context.
- **2026-07-08 · docs — fix the recurring D-GH decision-number collision (D-GH43, originally logged as
  D-GH30 — itself collided and was renumbered; see its addendum)** (`DECISIONS.md`,
  `AGENTS.md`; no code/rules change). Three prior collisions (D-GH19/20, D-GH25/27, D-GH26/28) all traced to
  computing "next number = highest + 1" from a stale local read instead of the live remote. Adds a documented
  rule — check `origin/preview`'s live `DECISIONS.md` before claiming a new number — plus formalizes
  renumber-on-merge as the accepted fallback if a collision still happens (the same pattern already used to
  resolve all three prior incidents, now made explicit policy instead of an ad hoc scramble). Sourced from
  the cross-project `ai-lessons-learned` repo's H-022 lesson (chompy78/ai-lessons-learned).
- **2026-07-05 · docs(sessions) — record the engine module-bridge safe-subset session** (`docs/sessions/2026-07-05-engine-bridge-safe-subset.md`; no code/rules change). Covers PR #121 / D-GH26: the roadmap task's premise being wrong (three of the seven "hand-copied" symbols are signature-incompatible `LOG`-closures, DM's `MUT` diverges), the owner's choice of the safe subset (`DATA`/`compute`/`baseBuild` + Live Sheet `MUT`) over the full migration, the ES-module-deferral `engine-ready` gating gotcha, in-browser verification, and the two rebases (PR #108/#109 bootstrap conflicts + D-GH24→26 number churn, with D-GH26 turning out to be the number preview reserved for this task).
- **2026-07-05 · docs(sessions) — record the BUILD-export/leaked-password/theme-artwork session**
  (`docs/sessions/2026-07-05-theme-artwork-and-worktree-base.md`; no code/rules change). Covers PRs
  #111, #113, #114, #120: the theme-artwork task's pivot history (SVG placeholders → real dark art →
  per-theme restructuring → restoring old assets into `midnight`), the `D-GH26` decision-number
  collision caught pre-merge, and a recurring `EnterWorktree` stale-base-branch gotcha worth
  checking for on every future worktree entry.

- **2026-07-05 · feat — dedicated per-theme homepage artwork for all 4 themes; swap the Player's Guide cover to webp**
  (`index.html`, `AGENTS.md`; new `assets/themes/{parchment,midnight,dragonfire,contrast}/*.webp`,
  `assets/pact-cover.webp`; deleted `pact-cover.jpg`, the now-superseded `assets/themes/light/`,
  `assets/themes/dark/`, and duplicate `images/` originals already archived in `source-assets/images/`;
  display-only, no `DATA.version` change). The project owner supplied dedicated banner art for all four
  named themes (2 images each), superseding the previous light/dark-bucket model from the prior entry —
  `artPools` in `index.html`'s theme-switcher script is now keyed by theme name directly
  (`parchment`/`midnight`/`dragonfire`/`contrast`), each re-rolling independently on switch with
  immediate-repeat avoidance, so a theme only ever shows art actually made for it. Also swaps the
  `<img class="cover">` Player's Guide thumbnail (and its `og:image`/`twitter:image` meta tags) from
  `pact-cover.jpg` to a smaller `assets/pact-cover.webp`, supplied by the project owner. The project owner
  also asked to keep the two original dark-theme book banners (`book-closed-banner.webp`,
  `book-open-banner.webp`, previously in the deleted `assets/themes/dark/`) rather than discard them —
  restored from git history into `assets/themes/midnight/` and added to `artPools.midnight` alongside its
  2 dedicated images (now 4 total in that pool; static asset pools are hand-listed in `index.html`, not
  auto-discovered from the directory — every file has to be named explicitly). Verified with a headless
  Chromium run cycling all 4 themes and 12 re-rolls within `midnight` alone, confirming each theme (and
  all 4 midnight variants) loads its own art and the cover image loads correctly; engine sanity check
  unaffected (asset-only change). See `DECISIONS.md` D-GH28's update for why the light/dark bucket model
  was retired.
- **2026-07-05 · feat — swap in real dark-theme homepage artwork; add a `source-assets/` originals archive**
- **2026-07-05 · docs — gate + tighten the `plan-for-review` skill for cold M365 Copilot review; add an AGENTS.md Active Priorities block**
  (`.claude/commands/plan-for-review.md`, `AGENTS.md`, `docs/HOW-TO-WORK.md`; new `docs/SKILLS.md`; no
  code/rules change). Formalises the observed-useful
  Claude→Copilot→Claude loop: Claude drafts a self-contained plan, M365 Copilot critiques it *cold* (no repo
  access, judging plan quality not code correctness), Claude triages the feedback and implements. The skill
  now opens with a trigger gate — *use cold review only if a wrong approach would cost more than one
  implementation cycle to undo* — so trivial/single-file/mechanical work skips it. The generated package is
  built from context already gathered while planning (no re-reading to pad), capped at ≤1.5 pages, and gains
  explicit **Assumptions-vs-verified-facts**, **Files involved**, **Verification**, and **Review outcome**
  sections; reviewer instructions are reframed for a no-repo cold reviewer with an anti-churn "say so if it's
  solid" note. Adds a short `## Active Priorities` block near the top of `AGENTS.md` (cached pointer to the
  roadmap, not a second copy, filled with the current 🔴 NOW focus) and documents the cold-review loop —
  with its trigger rule — in the AGENTS.md Agent-guidance rubric so future sessions know when to reach for
  it. Adds a human-readable `docs/SKILLS.md` (what each skill does + how they chain into the task lifecycle,
  plus the cold-review loop) and refreshes `docs/HOW-TO-WORK.md` to be Claude-Code-centric — Claude Code as
  the primary tool with M365 Copilot as cold reviewer only, dropping the stale "VS Code Copilot as co-equal
  coding tool" framing. Rationale and the rejected alternatives (OneDrive mirror, separate
  PACT-AI-CONTEXT.md, Copilot as repo-aware planner) are in `DECISIONS.md` D-GH29 and this session's notes;
  no `DATA.version` change.
  (`index.html`, `AGENTS.md`; new `source-assets/README.md`; moved `images/book-*.webp` →
  `assets/themes/dark/`, `images/originals/*` → `source-assets/images/`; deleted the now-superseded
  `starfield.svg`/`dragon-ember.svg` placeholders; no `DATA.version` change). The project owner supplied
  real dark-theme artwork (4 grimoire/spellbook `.webp` images); `artPools.dark` in `index.html` now uses
  those instead of the placeholder SVGs from the previous entry. Introduces `source-assets/` as a general
  (not image-specific) home for full-resolution originals behind any optimized/served asset, kept out of
  every agent's read path via a new `AGENTS.md` "don't read wholesale" bullet plus its own README
  explaining the optimize-then-commit workflow. Renumbers this branch's own `D-GH26` decision to `D-GH28`
  after a rebase surfaced that `D-GH26` is explicitly reserved for the engine module-bridge migration task
  — see `DECISIONS.md` D-GH28's addendum. Light theme pool unchanged (still placeholder SVGs; no real
  light-theme art supplied yet). Re-verified with the same headless Chromium theme-cycling check; engine
  sanity check unaffected (asset-only change).
- **2026-07-05 · fix — resolve a `D-GH25` collision on `preview`, plus a squash-merge duplicate line**
  (`DECISIONS.md`, `docs/PACT_ROADMAP.md`; no code/rules change). Two independent sessions both claimed
  `D-GH25` (this session's `/pick-task` batching decision, and PR #113's leaked-password-protection
  retirement) — both squash-merges landed cleanly with no conflict, silently concatenating the duplicate
  header instead of surfacing it, the same failure mode as the prior `D-GH19`/`D-GH20` incidents.
  Renumbered the batching decision to `D-GH27` (`D-GH26` stays reserved for the engine module-bridge
  migration task) and fixed the roadmap's now-stale "next free" reference. Also found and fixed an
  unrelated duplicated line in the `D-GH24` entry, introduced by the same squash-merge.
- **2026-07-04 · feat — theme-aware random homepage artwork** (`index.html`; new `assets/themes/light/*.svg`,
  `assets/themes/dark/*.svg`; display-only, no `DATA.version` change). Adds a decorative banner above the
  masthead that randomly picks one image from the active theme's pool on load and re-rolls on every theme
  switch — `parchment`/`contrast` draw from the light pool, `midnight`/`dragonfire` from the dark pool
  (matches the existing theme system's own light/dark split), with immediate-repeat avoidance so switching
  within the same bucket doesn't show the same image twice in a row. Artwork is hand-authored original SVG
  (no image-generation tool available, and fetching third-party art risked unclear licensing), palette-matched
  to each theme's existing CSS custom properties. Verified with a headless Chromium run cycling every theme
  option and confirming the art src/bucket pairing and image load (see D-GH28 for why SVG over photos).

- **2026-07-04 · docs — retire the "enable Supabase Auth leaked-password protection" roadmap item** (`docs/PACT_ROADMAP.md`, `DECISIONS.md` D-GH25; no code/rules change). Supabase gates this Auth feature behind a paid plan tier; the project owner declined to upgrade for it. Removed from the roadmap rather than left open indefinitely — the security advisor (`auth_leaked_password_protection`) will keep flagging it, so the gap stays visible without a stale TODO.
- **2026-07-04 · docs — session note + D-GH24 for the theme-selector fix's `<head>` trade-off**
  (`DECISIONS.md`, `docs/PACT_ROADMAP.md`, `docs/sessions/2026-07-04-theme-selector-and-worktree-cwd.md`;
  no code/rules change). Follow-up to PR #109: `D-GH24` records why the theme-restore check stayed at
  the end of `<body>` instead of moving inline into `<head>` like `index.html` (the tools' theme CSS is
  `body`-scoped, not `documentElement`-scoped, so the early-run trick isn't a drop-in port). The session
  note also covers the `/pick-task` difficulty-word fix and a mid-session worktree-cwd hiccup (absolute-path
  `Edit`/`Write` calls landed in the shared main repo instead of the active worktree after a context
  continuation). Also fixes `docs/PACT_ROADMAP.md`'s stale "next free is D-GH24" reference (now D-GH25).
- **2026-07-04 · feat — `/pick-task` can batch several quick, non-overlapping tasks into one PR**
  (`.claude/commands/pick-task.md`, `.claude/commands/run-task.md`, `AGENTS.md`; no code/rules change).
  When `/pick-task`'s difficulty-filter path (e.g. "quick"/"fast"/"easy") picks a task, it now also scans
  the rest of NOW/NEXT/LATER for up to 2 more independently small, low-risk, non-file-overlapping
  candidates, pre-flights each one separately (branch collision + effort/model escalation — a candidate
  that fires either drops out of the batch rather than blocking the primary pick), and offers a
  "batch `<primary>` + N more" option alongside "run just the primary" in its confirmation.
  `/run-task` now accepts multiple space-separated `<type/short-slug>` arguments: each task still gets
  its own edit, its own commit, and its own `CHANGELOG.md`/roadmap-graduation line — only the
  worktree/branch, the final `engine-parity` run, the rebase, and the PR are shared once across the
  batch, amortizing that fixed overhead instead of paying it per task. `AGENTS.md`'s "one task per
  branch" note now documents this as the one explicit exception (see `DECISIONS.md` D-GH27 — originally
  logged as D-GH25, renumbered after colliding with PR #113's independent use of the same number; see
  `docs/PACT_ROADMAP.md`'s follow-up fix in this same change).
- **2026-07-04 · feat — `/pick-task` ends with a clickable confirmation instead of copy-paste text**
  (`.claude/commands/pick-task.md`; no code/rules change). Step 4's hand-off now asks via
  `AskUserQuestion` whether to start work, with options to run `/run-task <slug>` immediately in the
  same turn, wait, or go back and choose a different roadmap item (looping back through Step 3's
  pre-flight for the new pick) — replacing the old "Say `/run-task <slug>`" line that had to be retyped.
- **2026-07-04 · fix — reliable Save/Export on iOS Safari & PWA, plus a CharGen autosave safety net**
  (`tools/PACT-CharGen-Webtool.html`, `tools/PACT-Live-Char-Sheet.html`; display/reliability-only, no
  `DATA.version` bump). Every blob+`<a download>` save/export site (CharGen `saveBuild()`,
  `exportToLiveSheet()`; Live Sheet `exportJSON()`) now feature-detects `navigator.canShare({files})`
  and, where available, hands the file to `navigator.share()` so it goes through the native Share sheet
  instead of the anchor-download trick, which iOS Safari/PWA is known to silently no-op or misroute to a
  new tab. Replaces CharGen's old UA-sniffed iOS data-URI branch entirely. `navigator.share()` rejection
  is now caught and flashed instead of failing silently (distinct message for a user cancel vs. a real
  failure); the desktop/Android anchor-download fallback is unchanged. Save/Export button tooltips are
  now set per-capability at load (e.g. "Save (via Share menu)" vs. "Save to Downloads") instead of one
  static string. CharGen also gains a `pactCharGenAutosave` localStorage safety net (mirrors Live Sheet's
  existing `save()`/`load()` pattern, raw build JSON only) — until now Export was CharGen's *only*
  persistence, so a failed/abandoned export meant total, permanent loss of the in-progress build.
- **2026-07-04 · feat — narrow `/pick-task` Step 1's fetch from four files to three** (`.claude/commands/pick-task.md`;
  no code/rules change). Drops the `testing/tests/engine-parity.html` `git show` (10KB) since it contributes
  nothing toward the "current expected pass count" fact — that number is just the row count in
  `testing/expected/expected-results.csv`, which is fetched separately and far cheaper (735B).
- **2026-07-04 · fix — theme selector reachable on mobile, no longer clips on desktop; add system
  dark-mode default** (`tools/PACT-CharGen-Webtool.html`, `tools/PACT-Live-Char-Sheet.html`;
  display-only, no `DATA.version` bump). CharGen's `.hd-row2` (title/version/last-edited/🎨 theme
  dropdown) was `display:none` below 768px with no mobile substitute — the theme selector was simply
  unreachable on phones. Added a compact `#themeselMobile` select to `.hd-mobnav`, kept in sync with the
  desktop `#themesel` via `setTheme()`. Also gave `.hd-row2` `flex-wrap:wrap` so it can no longer
  visually clip the dropdown at narrow/zoomed desktop widths (previously one non-wrapping flex row).
  Live Sheet's `#themesel` already lives inside its always-reachable "More" dropdown, so no layout
  change was needed there. Both tools' theme-restore IIFE now falls back to
  `prefers-color-scheme: dark` (mapped to the existing `dark` theme) when nothing is saved in
  `localStorage`, matching `index.html`'s pattern — first-time visitors on a dark-preferring device now
  get dark mode by default. Left the restore check running where it already did (near the end of
  `<body>`, not inline in `<head>` like `index.html`) — the tools' theme CSS is scoped to
  `body[data-theme=...]`, not `:root`/`html`, so an early `<head>`-run script can't apply the theme
  before body parses without also converting every theme selector; that's a larger refactor left for a
  follow-up rather than folded into this fix.
- **2026-07-04 · fix — add `BUILD` export to `js/engine.js`, wire `index.html` to read it live** (`js/engine.js` now exports `BUILD = "v0.107"`; `index.html` imports it in a new module-script block and renders it in the footer). Closes a docs/code drift found in a 2026-07-02 audit: `docs/VERSION-SYNC.md` and the 2026-07-01 CU-2 entry below both claimed this mechanism already existed — it didn't (`git log -S"export const BUILD"` had zero hits ever). This corrects that false claim. The three tools' hand-maintained version labels (CharGen title/header, Live Sheet comment, DM Console `TOOL_VERSION`) are unchanged for now — Task 6 (CharGen module-bridge migration) is the natural point to wire those to read `BUILD` live too. Display-only/tooling; `DATA.version` untouched; parity still 5/0.
- **2026-07-05 · feat(tools) — bridge `DATA`/`compute`/`baseBuild` onto `js/engine.js` in all three tools (safe subset of the engine module-bridge migration)** (`tools/PACT-CharGen-Webtool.html`, `tools/PACT-Live-Char-Sheet.html`, `tools/DM-Console.html`, `AGENTS.md`, `DECISIONS.md`; no rules change, `DATA.version` still v0.332). Each tool now imports `DATA`, `compute`, `baseBuild` (Live Sheet also `MUT`) from `js/engine.js` in a `<script type="module">` that copies them onto `window` and fires a new `engine-ready` event, on which each tool's UI bootstrap is gated. Deleted the inline `DATA`/`compute` (all three), `baseBuild` (Live Sheet, DM Console) and `MUT` (Live Sheet) copies; moved each tool's display-only `DATA.racialFx` map into its module bridge. CharGen got its first module bridge. **Not** bridged (deferred — a compat check found they'd break the tools): `activeEvents`/`economy`/`foldBuild` are index-based `LOG` closures in all three (not the engine's array API), CharGen's `MUT` is specialized export-bridge logic, and DM Console's `MUT` diverges from the engine's (stale `found`, missing `dbound`). See D-GH26. Verified in-browser: all three tools boot clean, a Live Sheet buy still emits one event, DM's `dmAnalyze` replays LS-001 to total 78, `engine-parity.html` → 5/0.
- **2026-07-04 · docs(sessions) — record the audit/checking roadmap-additions session** (`docs/sessions/2026-07-04-audit-roadmap-session.md`; no code/rules change). Session note covering 7 new audit/checking roadmap items (Supabase advisor/log checklist step, docs-consistency audit, pre-release QA checklist, rules-correctness review note, AUD-1 version-sync follow-up, plus LATER bullets A9/A10), REV-11's promotion to NEXT, the stale D-GH14 reservation fix (corrected to D-GH18), A2's promotion to NEXT with the `/code-review` cadence folded in, and two separate collisions with concurrent sessions' work on `preview` (a rejected push absorbing 86 commits, then a further fast-forward mid-close-out).
- **2026-07-04 · feat — add `.worktreeinclude`** (`.worktreeinclude`; no code/rules change). Copies
  `.claude/*.json` and `.claude/.fpp-reminder-state` — the actual gitignored config this repo has (PACT
  has no `.env`/build-step config at all) — into every new worktree `/run-task` creates.
- **2026-07-04 · feat — add YAML frontmatter to every `.claude/commands/*.md` skill** (all six command
  files; no code/rules change). Each now declares `description`/`argument-hint`; the report-only or
  draft-only ones (`close-session`, `plan-for-review`, `cleanup-branches`, `pick-task`) also get
  `disallowed-tools` as the actual hard gate (`allowed-tools` alone only pre-approves tools, it doesn't
  block them) — Edit/Write and any push/commit/merge/destructive-git tool are explicitly disallowed on
  those four.
- **2026-07-04 · feat — split `/next-task` into `/pick-task` + `/run-task`** (`.claude/commands/next-task.md`
  deleted; `.claude/commands/pick-task.md`, `.claude/commands/run-task.md` new; no code/rules change).
  `/pick-task` fetches live state, picks a task, and pre-flights it with no editing or worktree tools
  available at all; `/run-task <slug>` does the actual work. Splits one "go" that used to authorize the
  whole fetch→pick→edit→test→rebase→push→PR pipeline into two separate invocations, with a real tool-level
  gate (not just prompt wording) preventing `/pick-task` from touching anything.
- **2026-07-04 · feat — `/run-task` adopts native Claude Code worktrees (`EnterWorktree`)** (`run-task.md`,
  `.gitignore`, `AGENTS.md`, `DECISIONS.md` D-GH22; no code/rules change). Replaces ~30 lines of manual
  `git worktree add` / `-C <path>` arithmetic (which had a doubled-path bug: `pact-worktrees/pact-worktrees/<slug>`)
  with `EnterWorktree`/`ExitWorktree`. Worktrees now land at `.claude/worktrees/<slug>/` (added to
  `.gitignore`) instead of a sibling `pact-worktrees/` folder — supersedes the earlier "Option A" layout
  decision. Added a rebase-conflict gate in Step 6: a non-trivial conflict stops for a human look instead
  of resolving silently under the earlier "go."
- **2026-07-04 · feat — `/pick-task` Step 1 delegates to an Explore subagent** (`pick-task.md`,
  `DECISIONS.md` D-GH23; no code/rules change). The four `git show` fetches (`AGENTS.md`,
  `docs/PACT_ROADMAP.md`, `engine-parity.html`, `expected-results.csv`) are now delegated to an
  `Explore`-type subagent that returns only the derived facts, keeping the raw file content out of the
  picking session's own context — mirrors the pattern `/log-ai-lessons` already uses for glob input.
- **2026-07-04 · fix — remove `/add-roadmap-task`'s "test mode"** (`.claude/commands/add-roadmap-task.md`;
  no code/rules change). Never used, and its bare-word "test" trigger could misfire on a legitimate task
  like "add a task to write more engine tests," causing an unwanted second commit to `preview`.
- **2026-07-04 · fix — `/close-session` skips the test-gate check on docs-only sessions**
  (`.claude/commands/close-session.md`; no code/rules change). A session that only touched `docs/`,
  `CHANGELOG.md`, `DECISIONS.md`, or `PACT_ROADMAP.md` now gets "test gate — skipped, docs-only" instead
  of a false "can't confirm tests ran" flag. Also fixed a leftover bare `gh pr list` invocation in item 6
  to reference the GitHub MCP read tools instead.
- **2026-07-04 · fix — `/log-ai-lessons` Step 4 discloses the push-to-`main` consequence**
  (`.claude/commands/log-ai-lessons.md`; no code/rules change). The approval prompt said "Write C1 and
  C3?" without stating that approval commits and pushes to `main` on the external `ai-lessons-learned`
  repo — same class of hidden-consequence bug already fixed elsewhere in `/add-roadmap-task`.
- **2026-07-04 · feat — add `/cleanup-branches` skill** (`.claude/commands/cleanup-branches.md`; new file,
  no code/rules change). Does what `/close-session` item 6 identifies but refuses to act on: scans for
  merged/orphaned branches and worktrees, presents lettered cleanup candidates, and deletes only the ones
  explicitly approved (`-d` before escalating to `-D`). No push/edit/remote-write tools granted.
- **2026-07-03 · fix — resolve duplicate `D-GH19` reservation in `DECISIONS.md`** (`DECISIONS.md`, `.claude/commands/log-ai-lessons.md`; no code/rules change). Two independent sessions' merges landed the same day and both claimed `D-GH19` for unrelated decisions (`ai-lessons-learned` auto-load nudge vs. this session's Live Sheet mobile CSS cascade fix), with no separator between them — a clean auto-merge on both sides masked the collision until this was next read. Renumbered the `ai-lessons-learned` entry (chronologically later, already sorted at the top) to `D-GH20`, added the missing `---` separator, and fixed the one stale cross-reference in `.claude/commands/log-ai-lessons.md`. No other stale `D-GH19` references found.
- **2026-07-03 · chore — `/close-session`: loosen the session-note trigger from "spanned multiple areas" to "anything not fully captured by a one-line CHANGELOG entry"** (`.claude/commands/close-session.md`; no code/rules change). The prior bar ("real discussion or spanned multiple areas") would have let this same session skip its own note right up until the CSS cascade-order bug was found — scope, not surprise, isn't actually what makes a session worth narrating. New criteria: a root cause that differed from the task's diagnosis, a judgment call between valid approaches, a plan that changed mid-session, a collision with another session's work, or two-plus roadmap items done together. Explicitly not about task complexity or tool-call count.
- **2026-07-04 · docs(sessions) — record the `/plan-for-review` build, dogfood test, and rebase-time D-GH collision** (`docs/sessions/2026-07-04-plan-for-review-skill.md`; no code/rules change). Session note covering the skill's design, the 3-review dogfood pass and what it changed, and the D-GH20→D-GH21 collision caught mid-rebase (same failure mode as 2026-07-03's D-GH19 collision, this time before merge).
- **2026-07-04 · fix — rebase `D-GH20` → `D-GH21` collision before merge, not after** (`DECISIONS.md`; no code/rules change). This branch's own D-GH20 entry (see below) was drafted against a `main` that still had the old duplicate-`D-GH19` numbering; a same-day sibling session fixed that duplicate by renumbering it to D-GH20 and merged first. Rebasing this branch onto the updated `main` silently concatenated both entries under one `## D-GH20` heading with no conflict (git saw no overlapping lines) — the exact same collision mechanism as the 2026-07-03 `D-GH19` incident, just a rebase away from landing a third time. Caught during `/close-session`'s preview/main-sync check before this branch was pushed; renumbered this branch's entry to D-GH21 here instead of after another merge.
- **2026-07-04 · feat — `/plan-for-review`: add Step 7, handling returned review feedback** (`.claude/commands/plan-for-review.md`; no code/rules change). The skill previously ended at handoff with no guidance for when the user comes back with a reviewer's response. Added a step that: treats the response format as unconstrained (prose, bullets, a structured report — read for content, not shape); explicitly asks "anything else to add?" before triaging, since there may be more than one response (multiple reviewers/tools) arriving across separate turns; and triages rather than blindly applying — low-risk findings clearly consistent with repo conventions get applied directly, while anything touching security/secrets, contradicting a `DECISIONS.md` entry, showing reviewer disagreement, or genuinely uncertain gets surfaced to the user by name instead of auto-applied. Mirrors the manual triage just done on the skill's own first cross-AI review (3 independent responses, applied the consensus fixes, called out what was skipped and why).
- **2026-07-04 · fix — `/plan-for-review`: apply cross-AI review findings (workflow, filenames, scope, secrets)** (`.claude/commands/plan-for-review.md`; `DECISIONS.md` D-GH21; no code/rules change). Dogfooded the skill on itself — its own first output (a plan for adding `/plan-for-review`) was sent through three independent cold AI reviews, which converged on the same gaps. Fixed the triple/double-flagged ones: restated the workflow as explicit stages (draft → approval → write → optional commit → optional push) and stopped the template's "Done when" from folding in commit/push status; defined the `docs/plans/<date>-<slug>.md` filename algorithm (slug derivation, collision handling via `-2`/`-3`); added a step to check for and link a prior plan on the same topic (`Supersedes:` line); added an "Out of scope" template section; swapped "line numbers" for "files/functions/symbols" (durable references); let Reviewer instructions explicitly invite structural/redesign suggestions, not just gap-finding; and added an explicit never-inline-secrets instruction, since this doc is designed to leave the repo's trust boundary (see D-GH21).
- **2026-07-04 · fix — `/plan-for-review`: make Context inline-quoted, not file-referenced** (`.claude/commands/plan-for-review.md`; no code/rules change). The doc this skill produces is normally pasted into a *different* AI tool with no access to this repo — the original Context section said to "pull from AGENTS.md/DECISIONS.md," which a reviewer with no filesystem can't act on. Added an explicit assume-no-repo-access instruction: any rule/constraint/prior decision must be quoted or paraphrased inline, and the proposed approach should name concrete files/functions/line numbers where already known.
- **2026-07-04 · feat — add `/plan-for-review` skill: draft a plan as a self-contained file for cross-AI review** (`.claude/commands/plan-for-review.md`; new file, no code/rules change). Turns a task/idea into a written plan (goal, context, proposed approach, alternatives considered, risks/open questions, done-when) plus an explicit "Reviewer instructions" block, so a *different* AI session/model (or a person) can pick it up cold — no shared conversation context — and critique it without implementing anything. Follows the same draft-then-approve convention as `/log-ai-lessons`/`/add-roadmap-task`: shows the drafted content for approval before writing, then saves to `docs/plans/<date>-<slug>.md` and asks separately whether to commit it, since a handoff artifact for pasting into another AI tool doesn't always need to land in the repo.
- **2026-07-03 · feat — add `/log-ai-lessons` skill: mine a session/file for cross-project lessons** (`.claude/commands/log-ai-lessons.md`; new file, no code/rules change). The original `ai-lessons-learned` design named a `log-lesson` skill but it was never actually built — only `/close-session`'s item 9 existed, and that only looks at the current session as it's closing. This is the reusable, standalone version (named `/log-ai-lessons` to read more clearly against the repo's own name): point it at a file (an exported/teleported transcript, a `docs/sessions/*.md` entry, a `DECISIONS.md` excerpt) or a glob of many, or call it with no argument to mine the current conversation. For a directory/glob of several files it delegates the actual reading to a `general-purpose` agent so the bulk of the source content never enters the calling session's own context — only the drafted candidates come back. Follows the same report-then-approve convention as `/close-session`'s existing cross-project-hints check: drafts candidates in the `templates/log-lesson-snippet.md` shape, lists them for approval, and only writes/commits/pushes to `inbox/` on approved ones — never guesses an `H-###` id, since `scripts/curate.mjs` assigns the real one at curation time. Doubles as the mechanism for the still-open historical-backfill roadmap item (mining `docs/sessions/*.md` + `DECISIONS.md`) rather than a one-off delegated agent call.
- **2026-07-03 · fix — SessionStart hook: stop trying to auto-clone `ai-lessons-learned`, nudge the agent instead** (`.claude/hooks/session-start.sh`; no engine/rules change). Follow-up to the retest below: since `add_repo` can't be called from a non-interactive shell hook, and shouldn't be called unconditionally every session anyway, the hook no longer does any `git clone`/`AI_LESSONS_TOKEN` logic. In a remote session it now just prints a short fixed-cost reminder pointing at `chompy78/ai-lessons-learned` and telling the agent to call `add_repo` + read `INDEX.md` itself if the current task looks relevant — full pull-in only happens on sessions that actually need it, and `AI_LESSONS_TOKEN` is no longer read anywhere (can be deleted from the environment config). Chose this over auto-publishing a public mirror of `INDEX.md` (verified technically viable — `raw.githubusercontent.com` isn't subject to the session's GitHub-scoping proxy) because the repo is expected to hold a lot of private session detail over time and the user wants it to stay fully private, not just mostly private. See DECISIONS.md and the session doc's "Redesign decision" section.
- **2026-07-03 · docs — retest `ai-lessons-learned` clone: root cause was session GitHub scoping, not the PAT** (`docs/sessions/2026-07-03-ai-lessons-learned-setup.md`; no code change). Re-tested the clone that failed in the prior session, with the regenerated fine-grained PAT confirmed present as `AI_LESSONS_TOKEN`. Still failed identically — because the real blocker was never the token: this session's `github.com`/`api.github.com` traffic is routed through a policy-enforcing proxy that injects the session's own scoped GitHub App credentials, overriding any PAT in the URL/header, and rejects repos outside the session's explicit scope as "not found." Confirmed by probing `api.github.com` directly (valid 200 for `/user`, proxy-authored 403 for the repo) and by using `add_repo` (an agent tool, not shell) to grant scope, after which a plain unauthenticated clone succeeded immediately. This means `.claude/hooks/session-start.sh`'s raw-PAT approach can never work in a remote session regardless of configuration — flagged as a design gap to resolve in a follow-up, not fixed in this change. See the session doc's "Retest result" section for full detail.
- **2026-07-03 · feat — SessionStart hook loads cross-project `ai-lessons-learned` notes in remote sessions** (`.claude/hooks/session-start.sh`, `.claude/settings.json`; new files, no engine/rules change). Part of a new, separate `ai-lessons-learned` repo for durable, cross-project AI-coding lessons that shouldn't live inside PACT specifically (design/status in `docs/sessions/2026-07-03-ai-lessons-learned-setup.md`). On a persistent local machine, `~/.claude/CLAUDE.md` can `@`-import that repo's `INDEX.md` directly, but remote/cloud sessions have no persistent home directory for that to work — this hook covers that case instead: only when `CLAUDE_CODE_REMOTE=true` and an `AI_LESSONS_TOKEN` env var is present, it clones/pulls `ai-lessons-learned` and prints `INDEX.md` to stdout (surfaced by Claude Code as session context); fails silently on any error so a broken/missing token never blocks a session from starting. `.claude/settings.json` was force-added despite `.claude/*.json` being gitignored, since it currently holds only this hook registration — worth re-checking if local approvals start accumulating in that file later. End-to-end clone still failing as of this session (token/permission issue under investigation); hook's no-token and non-remote fallback paths verified working.
- **2026-07-03 · feat — `/close-session`: add cross-project hints check** (`.claude/commands/close-session.md`; no code/rules change). New checklist item 9 prompts the session to flag any lesson general to AI-assisted coding (not PACT-specific) for capture into the new `ai-lessons-learned` repo, following the skill's existing report-only + explicit-approval pattern — never writes anything without approval.
- **2026-07-03 · fix — `/next-task`: make worktree paths OS-agnostic** (`.claude/commands/next-task.md`; no code/rules change). Steps 4/6/8 hardcoded a Windows-only worktree path (`C:\Users\JohnChow\pact-worktrees\...`), which breaks the skill outright when run from a Linux remote session. Replaced with a portable pattern: derive the worktree root from `git rev-parse --show-toplevel`'s parent directory instead of a hardcoded OS-specific path.
- **2026-07-02 · chore — `/close-session`: re-check existing session notes for staleness, not just presence** (`.claude/commands/close-session.md`; no code/rules change). Caught live: the skill's docs-check step confirmed a session note existed and stopped there, without re-reading it against work that happened *after* it was written — a note covering two roadmap fixes went stale mid-session once a duplicate-PR discovery, a port, a merge-conflict resolution, and a final merge all happened afterward, and a second `/close-session` run still reported it as "done" on presence alone. Added an explicit instruction: if a note for the session already exists, re-read its content against everything that's happened since, every time this step runs.
- **2026-07-02 · fix — Live Sheet unusably cramped on small mobile screens (~375-400px)** (`tools/PACT-Live-Char-Sheet.html`; display-only, no `compute()`/`DATA.version` change; parity 5/0). Fixed the spell-slot grid forcing 9 columns at any width (now 5 at ≤600px, 3 at ≤400px), added a `@media(max-width:400px)` tier further narrowing `.spcols` to 1 column and `.shabrow`/`.shkpis` to 2, and added tap-to-collapse/expand on the three top-level cards (Buy/progress, Character, History & ledger) at ≤1000px, reusing the existing `.bgcat`/`.cath` ▾/▸ pattern — default state is all-open, no persistence (least new state-persistence machinery, per the roadmap task's own call). Bigger, previously-undiagnosed finding made while auditing the existing `@media(max-width:600px)` block: it sits *before* several unconditional base rules (`.abrow`, `.kpis`, `.ib`, `.cath`) in the stylesheet, so with equal CSS specificity those later base rules silently won the cascade — verified live with a headless browser (computed styles showed the un-overridden desktop values at a 375px viewport even though the mobile CSS "looked" correct). This meant the ability-score row never actually shrank from 6 to 3 columns on mobile, and the buy-button/category-header font/padding bumps never applied — the dominant cause of the reported cramping, beyond the specific gaps the roadmap task called out. Fixed with `!important` on the shadowed declarations, matching this same file's existing convention for the identical problem in its `@media print` overrides. Desktop/tablet (>1000px) layout confirmed unchanged. See DECISIONS.md D-GH19. Closes the "Live Sheet unusably cramped on small mobile screens" roadmap item.
- **2026-07-02 · fix — PWA stale-version bug: users never got the "new version ready" reload prompt** (`service-worker.js`, `index.html`, `login.html`, `tools/PACT-CharGen-Webtool.html`, `tools/PACT-Live-Char-Sheet.html`, `tools/DM-Console.html`; display/infrastructure-only, no engine/`DATA.version` change; parity unaffected). Three compounding causes, all fixed: (1) the service worker's network-first `fetch(e.request)` for `*.html`/`js/engine.js` had no cache-control override, so it could silently return a stale browser-cached response despite being "network-first" as a strategy — added `{cache:'no-store'}`. (2) No page proactively called `registration.update()`, leaving update checks to the browser's own (hours-to-24h) periodic timer — added `reg.update()` immediately on registration, plus again on `visibilitychange`(→visible) and `focus`, in all 5 pages' SW registration blocks (the immediate call was ported over from a duplicate fix in PR #97, opened independently in a parallel session for the same roadmap item — closed as superseded once this PR had everything from both). (3) `login.html`'s `updatefound` handler silently force-reloaded the instant a new SW installed, unlike the other four pages' dismissible banner-and-click-to-reload pattern — aligned it to the same banner. The "robust fallback layer" (an independent version-marker poll) from the roadmap task's diagnosis was deliberately deferred — it depends on the not-yet-landed `BUILD` export task and the task note explicitly said not to block on it. Verified via a headless browser: `service-worker.js`'s fetch now correctly bypasses the HTTP cache. Closes the "PWA stale-version bug" roadmap item.
- **2026-07-02 · chore — merge `/next-task` effort and model checks into one calibration step** (`.claude/commands/next-task.md`; no code/rules change). Previously Check 2 stopped every run to confirm the session was already at High effort, and Check 3 separately asked about switching to Opus — two potential interruptions even for the routine case. Merged into a single Check 2 that assumes High reasoning effort and Sonnet by default with no confirmation needed, and only asks once (covering both effort and model together) when the picked task actually warrants escalating to `xhigh`/`max` and/or Opus.

- **2026-07-02 · fix — Live Sheet: Magically/Martially Bound showed a contradictory "-2" cost badge** (`tools/PACT-Live-Char-Sheet.html`; display-only, no engine/`DATA.version` change; parity unaffected). Found during a post-hoc audit of the day's merged work: Feature A's `priceOf()` correctly returns `-2` for `mbound`/`dbound` (a negative "cost" is this codebase's existing convention for an AP-granting purchase, matching how drawbacks are priced), but `ib()`'s `costlbl` and `unaff` (afford-gate) logic only special-cased `cat==='drawback'`, not the two new categories. Net effect: the "Martially Bound"/"Magically Bound" buttons showed a literal "-2" badge right next to label text that already said "(+2 AP)" (self-contradictory), and — in the edge case of an already over-budget character (`eco.available` more negative than -2) — could be incorrectly hard-blocked as unaffordable with a nonsensical "needs -2 AP" message, even though the purchase only ever helps the budget. Extended both checks to include `mbound`/`dbound` alongside `drawback`, matching the existing convention exactly. No change to `compute()`/pricing math, which was already correct (verified: `d.bound` correctly drives both the `mbGain` AP credit and the per-level spell-cost discount in `js/engine.js`).
- **2026-07-02 · fix — apply REV-07 CSPRNG invite-code migration + pin missing function `search_path`s (live Supabase)** (`sql/migrations/2026-07-02-rev07-csprng-invite-codes.sql` execution only, no new repo file; DB-only, no engine/logic change; parity unaffected). Follow-up to the day's audit: the REV-07 migration file had been committed and merged but never actually applied to the live project — confirmed live via `pg_proc.prosrc`, `gen_invite_code()` was still on `random()`. Applied it live via the Supabase MCP; confirmed the deployed function now uses `gen_random_bytes()` and a sample code matches `^[A-Z0-9]{6}$`. Also found (Supabase security advisor) that `gen_invite_code` and `set_updated_at` were the only two functions in the schema missing a pinned `search_path`, unlike every other function — pinned both to `search_path=public` via `ALTER FUNCTION`, closing a schema-shadowing hardening gap. Closes the "Verify REV-07 invite-code migration live in Supabase" roadmap item. See DECISIONS.md D-GH17.
- **2026-07-02 · docs — fix AGENTS.md's stale "module bridge" claim** (`AGENTS.md`; no code change, parity unaffected). AGENTS.md's Architecture section claimed all three tools load `DATA`/`compute`/`MUT`/`baseBuild`/etc. from `js/engine.js` via a module bridge, with only CharGen still embedding its own copy — false on the live code. Verified directly: all three tools (CharGen, Live Sheet, DM Console) hand-copy `DATA`/`compute`/`MUT`/`baseBuild` and none import them from `js/engine.js`. What's actually bridged differs per tool and is narrower than claimed: Live Sheet's `<script type="module">` imports only `validate()` from the engine plus sync/auth/campaign helpers, firing `sync-ready`; DM Console's module script imports auth/campaign/dm helpers only — nothing from `js/engine.js`, not even `validate()` — firing `campaign-ready`; CharGen has no module bridge at all. Corrected the Architecture bullet to describe this accurately so a future agent can't ship an engine-only edit that silently no-ops in a tool while `engine-parity.html` stays green. See DECISIONS.md D-GH9.
- **2026-07-02 · fix — CharGen "⇆ Live Sheet" export crash on any species/racial trait** (`tools/PACT-CharGen-Webtool.html`; display/integration-only, no `compute()` output change, `DATA.version` untouched; parity 5/0). `buildToLiveLog()`'s local `liveBase()` — CharGen's own hand-copied duplicate of `js/engine.js`'s `baseBuild()` shape — was missing `racialTraits:[]`; the local MUT's unguarded `racial:(b,p)=>b.racialTraits.push(p.v)` threw `TypeError: Cannot read properties of undefined (reading 'push')` on export for any character with ≥1 species/racial trait, silently discarding the export (caught by `exportToLiveSheet()`'s own try/catch, so only a flash error + console.error, no raw crash — but nothing saved). Added `racialTraits:[]` to `liveBase()`. Ran the full sweep the roadmap task called for: diffed `liveBase()`'s field list against `baseBuild()`'s (found `languageNames`/`grantNames`/`dabblerCantripNames`/`innateNames`/`featNames`/`size`/`inPlay` also missing) and audited every other `.push()` in the local MUT for the same unguarded-missing-field pattern — no other gap found; every other push target is already initialized in `liveBase()`, and every read of the still-missing name/size fields elsewhere in the file is defensively `||[]`/`||{}`-guarded. `inPlay` specifically was NOT added — it drives racial-trait tier pricing and must stay unset (creation-basis) for a freshly-exported character; see DECISIONS.md D-GH18 for why. Verified in-browser (Playwright): selecting Elf + a racial trait and calling `buildToLiveLog()` threw pre-fix, succeeded post-fix with the trait present in the exported log; `testing/tests/engine-parity.html` still 5/0. Closes the "Fix crash exporting to Live Sheet when a species/racial trait is selected" roadmap item.
- **2026-07-02 · feat — Feature A: Live Sheet multi-tradition / multi-discipline spellcasting + Magically Bound** (`js/engine.js`, `tools/PACT-Live-Char-Sheet.html`; `compute()`/`DATA.version` untouched — both engine copies already priced multi-discipline and `d.bound` correctly, only the mutation layer was missing; parity 5/0). Players can now found more than one tradition and buy more than one discipline per tradition, each shown on its own row in the buy panel and the spell panel. Extended the `found` MUT to add a discipline to an already-open tradition (instead of only founding a fresh one) and added a `dbound` setter, in **both** `js/engine.js` and Live Sheet's own hand-copied MUT (see D-GH9 — Live Sheet does not actually consume `js/engine.js`'s MUT/compute/DATA via a bridge, despite `AGENTS.md`'s architecture section claiming otherwise). Per-discipline "Magically Bound": a one-way (undo-only) toggle that grants a flat +2 AP and applies a −1 spell discount (cantrips/slots/known, floor 1) to that discipline from then on; `priceOf` now special-cases `mbound`/`dbound` to a flat ±2 AP instead of a full recompute diff, which also fixes a pre-existing bug where taking Martially Bound retroactively discounted already-owned features of that class. "Subclass spell lists" moved from the "Class & subclass" bucket to "Magic" in `_catOf`. The "Add discipline" / "Open another tradition" buttons are hidden when the active campaign's `multiDisciplineAllowed` rule is `false` (reusing `window._cloudCampaignRules`, no new fetch), closing the multi-discipline gap D-GH16 flagged as pending. `ib()`'s tooltip now includes the `descr` text, not just the warning/reason. Verified in-browser: open a tradition, add a 2nd discipline to it, open a 2nd tradition, buy Magically Bound (flat +2, only future purchases on that discipline discount), and confirm the add-discipline/open-tradition buttons disappear under a `multiDisciplineAllowed:false` campaign. See DECISIONS.md D-GH9. Closes Feature A.
- **2026-07-02 · chore — ignore the `/close-session` reminder-hook state file** (`.gitignore`; no code change). `.claude/.fpp-reminder-state` (backoff-schedule state for the permission-allowlist reminder hook) wasn't covered by the existing `.claude/*.json` pattern since it has no extension — added an explicit `.claude/.fpp-reminder-state` line so it can't accidentally get committed.
- **2026-07-02 · fix — REV-07: source invite codes from a CSPRNG** (`sql/schema.sql`, `sql/migrations/2026-07-02-rev07-csprng-invite-codes.sql`; no engine/logic change; parity unaffected). `gen_invite_code()` built each of its 6 characters via `floor(random()*36)` — Postgres's non-cryptographic PRNG — even though invite codes function as shared secrets gating `join_campaign`/`join_as_dm`. Now pulls 6 bytes from pgcrypto's `gen_random_bytes()` (already enabled) and reduces each mod 36 onto the same `A-Z0-9` alphabet; code length and the `^[A-Z0-9]{6}$` check regex are unchanged. Code length and `join_campaign` rate-limiting were also suggested by the review but left as separate, lower-priority follow-ups — see D-GH17. Closes REV-07.
- **2026-07-02 · fix — drop legacy `award_xp`, lock down anon EXECUTE on `award_ap`** (`sql/migrations/2026-07-02-drop-legacy-award-xp-lock-award-ap.sql`, `sql/rls-policies.sql`; no engine/logic change; parity unaffected). Supabase's security advisor flagged both `award_xp` and `award_ap` as callable by the unauthenticated `anon` role via `/rest/v1/rpc/*`. `award_xp` was dead code left over from the XP → AP rename — zero references remained in `js/` or `sql/` — dropped outright. `award_ap` is live and was already internally guarded (`is_campaign_dm()` rejects any caller without a real `auth.uid()` match, so `anon` could never actually award anything), but had never had its default Postgres EXECUTE-to-`PUBLIC` grant revoked. Grant now matches intent (`authenticated`-only) instead of relying solely on the internal check. Verified live via `has_function_privilege('anon', ..., 'EXECUTE')` before/after. See D-GH15.
- **2026-07-02 · feat — DM campaign rules: live-filter banned masteries/boons in Live Sheet** (`tools/PACT-Live-Char-Sheet.html`; display-only, no engine/`DATA.version` change; `js/engine.js` diff is empty — parity unaffected). Follow-up to the DM campaign rules feature: previously a rule violation was only caught at "Save to cloud," forcing players to undo work built around a banned choice. Added `cloudRuleBarred()` and filtered it into the weapon-mastery and boon pickers (mirroring the existing `campBarred()` pattern for the older local rules code) so a banned-but-not-yet-purchased item never appears to select; already-owned items stay visible so they remain manageable. Campaign rules are now fetched on sign-in/session-ready (`refreshCloudCampaignRules()`), not just at the cloud-save click, so filtering is live from page load. Species/origin-class/multi-discipline bans still can't be live-filtered — Live Sheet has no picker for them at all (they're fixed at creation or not yet buildable) — so those remain enforced only at cloud push; closing that gap needs CharGen campaign-rule awareness, filed as a new roadmap item. See DECISIONS.md D-GH16.
- **2026-07-02 · fix — lower Live Sheet low-spend nudge threshold to 50 AP** (`tools/PACT-Live-Char-Sheet.html`; display-only, no engine/`DATA.version` change; `js/engine.js` diff is empty — parity unaffected). The CharGen nudge banner added in PR #74 fired below 70 AP spent; changed the `_apNudgeBanner` cutoff to 50 AP per user request. No other behaviour change.
- **2026-07-02 · feat — Live Sheet low-spend nudge toward CharGen** (`tools/PACT-Live-Char-Sheet.html`; display-only, no engine/`DATA.version` change; `js/engine.js` diff is empty — parity unaffected). Added a dismissible sticky banner (`_apNudgeBanner`, keyed off `economy(idx).spent`) shown in `render()` whenever the active character has spent under 70 AP, explaining that Live Sheet skips CharGen's character-creation discounts (race/origin bonuses) and pointing players to CharGen as the recommended starting point. Dismissal is remembered per-character (`window._apNudgeDismissedFor`, matched against `currentCharId()`) so importing or cloud-loading a different character shows it again automatically; `resetAll()` explicitly clears the flag so a freshly wiped character sees it too. Verified in-browser: banner shows at 0 AP spent, dismiss button hides it and survives a re-render, hides automatically once spend reaches 70+, and reappears after Reset. Closes the "Live Sheet low-spend warning" roadmap item.
- **2026-07-02 · fix — CU-7: surface Save/Load/Live Sheet actions on mobile CharGen** (`tools/PACT-CharGen-Webtool.html`; display-only, no engine/`DATA.version` change; parity 5/0). Desktop's character-action buttons (Save, Load, Sheet, Live Sheet, AI Portrait, Share, Name spells, Campaign, Info) live in the sticky header's `.hd-row3`, which is hidden below the 768px breakpoint in favour of `.hd-mobnav` (Random/Reset/section-jump only) — mobile players had no way to save, load, or export to the Live Sheet. Added a non-sticky `.mobile-action-bar` row, rendered outside the sticky header (between it and `.layout`) and shown only at the existing mobile breakpoint, reusing the same `onclick` handlers as the desktop buttons; Random/Reset stay in `.hd-mobnav` (already reachable) and the `#campind` indicator span was left off the mobile bar to avoid a duplicate-id conflict with its desktop copy. Desktop layout unchanged. Closes CU-7.
- **2026-07-02 · chore — clarify `/next-task` effort and model checks** (`.claude/commands/next-task.md`; no code/rules change). Check 2 now explains *why* "High" effort is the default floor (redo cost of a broken rebase or failed test suite in this shared-repo workflow) instead of just naming a threshold, and says not to reach for `xhigh`/`max` by default. Added Check 3: default to Sonnet, only recommend switching to Opus when the picked task has real rework risk (engine rules logic, data-model/migration decisions, cross-tool contracts) — not just because it "sounds important".
- **2026-07-02 · feat — DM campaign rules: configure and enforce on cloud push** (`js/engine.js`, `js/campaign.js`, `sql/schema.sql`, `sql/migrations/2026-07-02-campaign-rules.sql`, `tools/DM-Console.html`, `tools/PACT-Live-Char-Sheet.html`; new `campaigns.rules` jsonb column, no RLS change needed — existing `campaigns_update` row policy already restricts writes to DMs; `js/engine.js` gains a new `validate(build, campaignRules)` export, `compute()` untouched, `DATA.version` unchanged). DMs can now set banned species/origin-species/origin-classes/weapon-masteries/boons, a multi-discipline-allowed toggle, and freeform house-rule toggles per campaign from a new "Campaign Rules" panel in DM Console; players can see but not edit them. Live Sheet's "☁ Save to cloud" now fetches the character's campaign rules and calls `validate()` before pushing — a rule-violating build is blocked with a clear per-rule error and never reaches Supabase. Local/offline autosave and solo (non-campaign) play are unaffected. Parity 5/0. See DECISIONS.md D-GH14. Closes the "DM campaign rules" roadmap item.
- **2026-07-01 · chore — add `/close-session` command** (`.claude/commands/close-session.md`; no code/rules change). Report-only checklist for wrapping up a session: docs (CHANGELOG/DECISIONS/sessions), roadmap graduation, test gate, working-tree state, this session's worktree, a repo-wide branch/worktree sweep, preview/main sync status, and open PRs — surfaces further actions as a flat `A1`/`A2`/... list for a single yes/no reply instead of one-at-a-time prompts. Promoted preview → main in the same session (PR #69).
- **2026-07-01 · chore — simplify `/next-task` command wording** (`.claude/commands/next-task.md`; no code/rules change). Reworded all 8 steps in plainer, less jargon-heavy language for readability; the effort-gate hard stop (Step 3) and every other rule kept as-is. Promoted preview → main in the same session (PR #64).
- **2026-07-01 · fix — standardise CharGen toolbar spacing** (`tools/PACT-CharGen-Webtool.html`; display-only, no engine/`DATA.version` change; parity 5/0). The `#campind` campaign-indicator span carried an inline `margin-left:6px` on top of the toolbar's own `gap:8px` flex spacing, widening the visible gap between the Campaign and Live Sheet buttons versus every other adjacent button pair. Removed the inline margin so spacing is controlled solely by the shared toolbar `gap`.

- **2026-07-01 · fix — REV-06: offline delete no longer resurrects on reconnect** (`js/sync.js`; no engine/logic change; parity 5/0). `deleteCharacter` previously ran `lsRemove` even when offline (server delete only attempted if online), so the local copy vanished but the server row survived — the next `syncAll`/`listCharacters` pull brought the "deleted" character back. Added a `pact-deletes` tombstone list: `deleteCharacter` now always removes local + records the id as pending, and attempts the server delete immediately if online. `syncAll`/`reconcile` replay any pending deletes first (and exclude tombstoned ids from the reconcile pass so a same-round pull can't resurrect them before the delete lands); `listCharacters` filters tombstoned ids out of both the online and offline result sets. A tombstone clears only once the server delete actually succeeds. Closes REV-06.
- **2026-07-01 · fix — REV-05: sync compares parsed instants, not raw timestamp strings** (`js/sync.js`; no engine/compute change; parity 5/0). `reconcile()`'s last-write-wins check did `local.updated_at > server.updated_at` as a plain string comparison — this breaks when one side's ISO timestamp uses `Z` and the other `+00:00`, or when sub-second precision differs, causing a false "local is newer" (or vice versa) and a lost update. Extracted the comparison into an exported `isNewerInstant(a, b)` helper (`Date.parse(a) > Date.parse(b)`) and added `testing/tests/sync-timestamp.html`, a browser-run regression test covering mixed `Z`/`+00:00` formats and differing sub-second precision (5/5 passing). Closes REV-05.

- **2026-07-01 · chore — CU-4: prune merged branches** — verified `data/tools-v0.332`, `engine/data-v0.332`, `feature/dual-source-ap`, `feature/live-sheet-dual-ap`, `fix/engine-v0.332-data`, `task1/pwa-shell`, `task2/auth`, `task3/sql-data-model`, `feature/campaign-play`, `feature/homepage-index`, and `task2/auth-gate` no longer exist locally or on origin (already cleaned up in an earlier session); `git branch -a` now shows only `main`, `preview`, and active in-flight branches. No code change.

- **2026-07-01 · chore — CU-6: rename `DM Console.html` → `DM-Console.html`** (`tools/DM Console.html` → `tools/DM-Console.html`; `index.html` card link, `service-worker.js` PRE_CACHE entry, `AGENTS.md`, `docs/VERSION-SYNC.md` updated to match). No engine/logic change; parity unaffected — verified 5/0 and console loads at the new path with the SW precache URL updated.
- **2026-07-01 · fix — CharGen → Live Sheet export silently failed to save on blocked storage** (`tools/PACT-CharGen-Webtool.html`, `tools/PACT-Live-Char-Sheet.html`; display/integration-only, no engine/compute change; parity 5/0). Root cause: Live Sheet's `save()`/`load()` swallowed `localStorage` errors in an empty `catch(e){}` — when storage was blocked (private/incognito browsing, quota, disabled storage) the import flow still showed "Loaded character." with nothing actually persisted, so the character vanished on reload. `exportToLiveSheet()` in CharGen had the same silent-failure shape (bare `onclick`, no outer `try/catch`, so a thrown error became an invisible unhandled rejection — the reported "button does nothing"). Both now `console.error` and surface a visible `flash()` warning on failure; the normal save/export path is unchanged (confirmed via engine-parity 5/0 and a manual export → import → reload round trip). Closes the CharGen → Live Sheet roadmap item.

- **2026-07-01 · docs — CU-1: single-source agent docs** (`CLAUDE.md` stub → `@AGENTS.md`, `.github/copilot-instructions.md` pointer stub, `docs/HOW-TO-WORK.md` three-copies chore removed; no code change). Closes REV-08. `git grep -l "Master copy"` returns nothing outside the roadmap task description itself.

- **2026-07-01 · chore — REV-10: stop tracking `.claude/` JSON config files** (`.gitignore`, `.claude/launch.json` untracked; no code change). Replaced blanket `.claude/` ignore with `.claude/*.json` so machine-specific config (`launch.json`, `settings*.json`) is ignored while project-specific agent + command definitions remain tracked. Closes REV-10.
- **2026-07-02 · fix — close stored-XSS gap in custom tools/instruments (CharGen + Live Sheet)** (`tools/PACT-CharGen-Webtool.html`, `tools/PACT-Live-Char-Sheet.html`; no engine/logic change; parity 5/0). The character-sheet "Tools & Instruments" renderer interpolated `b.customProfs` (free text from the "+ custom tool/instrument" field) directly into an `innerHTML` string with no escaping, unlike every other player-controlled field in the same renderer. Wrapped it in the existing `_csEsc()` helper (already used two lines below for lineage spell names) in both files. Relates to the not-yet-enforced REV-12 invariant in `docs/PACT_ROADMAP.md`. `DATA.version` unchanged.

- **2026-07-01 · chore — CU-3: tidy repo root and test files** (`index.old.html` + `.tmp-verify.mjs` deleted; `campaign-test.html` + `sync-test.html` moved to `testing/` with relative paths updated to `../js/` and `../login.html`; `testing/README.md` replaced stray repo description with a proper harness index). Closes REV-09. No engine/logic change; parity unaffected.
- **2026-07-01 · chore — CU-2: sync DM Console build version to v0.107** (`tools/DM Console.html` `TOOL_VERSION` v0.015 → v0.107; `docs/VERSION-SYNC.md` already committed). All three tools now mirror `BUILD` in `js/engine.js`; `index.html` reads it live. No engine/logic change; parity unaffected.

- **2026-06-30 · fix — REV-04: close campaign-join bypass in RLS** (`sql/rls-policies.sql`, `sql/migrations/2026-06-30-rev04-campaign-rls.sql`; no engine/logic change; parity unaffected). Removed `campaign_id` from the player column-level UPDATE grant — `join_campaign()` (SECURITY DEFINER) is now the sole writer. Also tightened the INSERT policy with `AND campaign_id IS NULL` so a player cannot insert a character pre-joined to an arbitrary campaign; `join_campaign()` bypasses RLS as a SECURITY DEFINER function and is unaffected. `DATA.version` unchanged.

- **2026-06-30 · fix — REV-03: service worker now uses network-first for `*.html` + `js/engine.js`** (`service-worker.js`; no engine/logic change; parity 5/0). Added `NETWORK_FIRST_RE` regex; HTML pages and `engine.js` now try the network first and fall back to cache only when offline — so a deployed rules fix reaches returning users on the very next page load without clearing storage. Icons and supporting JS files remain cache-first. `DATA.version` unchanged. (D-GH11)

- **2026-06-29 · feature — auth bar on menu: optional sign-in, no redirect gate** (`index.html`; no engine change; parity unaffected). Added a small `<script type="module">` auth block that imports `js/auth.js` and shows a "Sign in" button when signed out or "Signed in as X · Log out" when signed in. Every page (menu + tools) is open to everyone — no redirect gate. Cloud save/sync activates only when a session exists.

- **2026-06-30 · fix — REV-02: service worker now skips caching for cross-origin requests** (`service-worker.js`; no engine/logic change; parity 5/0). Added an origin guard (`url.origin !== self.location.origin → return`) to the fetch handler so Supabase API calls, esm.sh CDN responses, and any other cross-origin GETs are never intercepted or cached. Previously the handler claimed same-origin filtering in a comment but had no actual check, causing stale API responses and potential cross-user data to accumulate in Cache Storage. `DATA.version` unchanged.

- **2026-06-30 · fix — REV-01: regression gate now asserts real values** (`testing/tests/engine-parity.html`, `testing/expected/expected-results.csv`; no engine/logic change). Rewrote the parity runner so each test compares `compute()` / `rebuildStateFromEvents()` output against a confirmed baseline in `expected-results.csv` — previously `pass` was hard-coded `true` and all CSV columns were blank. Added two modes: "Capture baseline" (dumps CSV rows from live engine output for human review) and "Run tests (assert)" (fetches the CSV and fails if any actual differs from expected). CG-003 additionally asserts `remaining < 0` and that the first warning starts with "OVER BUDGET". LS-001/EV-001 assert `.ok`, `.total`, and `.eventsApplied`. Baseline captured and confirmed at engine v0.332: CG-001 (2 AP / 0 warn), CG-002 (50 AP / 0 warn), CG-003 (67 AP / 1 warn / over by 17), LS-001 (78 AP / 1 warn / 28 events), EV-001 (68 AP / 0 warn / 7 events). Gate now reports a real FAILED test when engine output changes. `DATA.version` unchanged.
- **2026-06-30 · docs — CU-5: fix duplicate D-GH7 in DECISIONS.md** (`DECISIONS.md`, `docs/sessions/2026-06-29-header-redesign-mobile-pin-pwa-task1.md`; no code change; parity unaffected). Renamed the older "PWA SW registration" entry from `D-GH7` to `D-GH8`; updated the two session-file backreferences. The campaign-play entry (`D-GH7 · Campaign play: dual-source AP…`) and all its callers (`js/campaign.js`, `sql/schema.sql`, migration, `CHANGELOG.md`) remain unchanged. Every `D-GH#` is now unique.

- **2026-06-30 · fix — Task 5 hardening: SW pre-cache, offline login, update flow, maskable icon, preconnect** (`service-worker.js`, `login.html`, `manifest.json`, `index.html`; no engine/logic change; parity 5/0). Added `login.html` + five JS modules (`auth`, `sync`, `campaign`, `dm`, `supabase-client`) to `PRE_CACHE` so tool pages work offline from a cold install; bumped `CACHE_NAME` to `pact-v2`. Removed unconditional `self.skipWaiting()` from the SW install handler so the update-notification UI (already wired in `index.html`) can fire correctly — SW now only skips waiting when the client posts the message. Added SW registration + update handler to `login.html` (was the one page missing it — hard FAIL in audit). Added `"purpose":"maskable"` to the 512-px manifest icon (Android adaptive-icon fix). Added `<link rel="preconnect">` for `esm.sh` and the Supabase origin in `index.html`. `DATA.version` unchanged.

- **2026-06-30 · feature — dual-source AP budget: `compute(b, opts)` and `rebuildStateFromEvents(base, events, opts)` now accept `{ dmAp, ignorePlayerAp }`** (`js/engine.js`; engine-parity **5/0**). When `dmAp` is provided it is added to the player-log AP (or replaces it when `ignorePlayerAp: true`). Returns `budget` (spendable total), `playerAp`, `dmAp`, and `spendable`; `remaining` and `status` reflect the adjusted budget. Fully backward-compatible — callers with no opts see identical output. `DATA.version` unchanged.
- **2026-06-30 · feature — Live Sheet dual-source AP: cloud-loaded characters now blend DM-granted AP into the budget** (`tools/PACT-Live-Char-Sheet.html`, `js/sync.js`; no engine/DATA change; parity 5/0). When a character is loaded from the ☁ Cloud menu, `rec.ap` (DM-granted, server-authoritative) is stored as `window._dmAp`; if the character belongs to a campaign with `ignore_player_ap: true`, only DM AP counts toward the spendable budget. `render()` and `refreshBuy()` now adjust `b.budget = (ignorePlayerAp ? 0 : eco.earned) + dmAp` before calling `compute()`, so `r.remaining` (AP left), the buy-panel affordability checks, and the "OVER BUDGET" warning all reflect the correct figure. The ecoline bar gains a `· X from DM` chip when dmAp > 0 (with an "Y player AP ignored" prefix when the campaign flag is set). `sync.js` reconcile and listCharacters selects now include `campaign_id` so the load handler can look up `ignore_player_ap` via `listMyCampaigns()`. `DATA.version` unchanged.

- **2026-06-30 · feature — Task 4 UI: campaign roster + cloud save in DM Console and Live Sheet** (`tools/DM Console.html`, `tools/PACT-Live-Char-Sheet.html`; no engine/logic change). **DM Console**: added module bridge importing `auth.js`/`campaign.js`/`dm.js`; new "Campaign (cloud)" panel in the bottom toolbar (auth status, campaign selector, player/DM invite codes with copy, ignore-player-AP toggle); new "Campaign Roster" section above the card grid (live roster from Supabase with DM-AP column, per-character Award AP form with note, 📒 history modal showing amount/DM/note/date). **Live Sheet**: added module bridge importing `auth.js`/`sync.js` + `initSync()`; new ☁ Cloud button in the top bar (next to Sheet) — dropdown shows auth status, Save to cloud (saves `{LOG,SEQ,rules}` blob via `saveCharacter()`), and a list of the user's saved livesheet characters to load from cloud (sets `LOG`/`SEQ`/`loadedRules` globals and calls `save()`+`render()`). `DATA.version` unchanged.

- **2026-06-30 · feature — landing page redesign to match the Player's Guide** (engine untouched — parity unaffected; `index.html`, `docs/PACT-Players-Guide.html`, new `pact-cover.jpg`). Rebuilt `index.html` in the guide's parchment "tome" style on shared CSS tokens (`--ink/--accent/--rule/--head`). Added a subtle theme picker (Parchment/Midnight/Dragonfire/High contrast) with an **"Auto · match device"** default that follows `prefers-color-scheme` and persists to one `localStorage` key (`pact-theme`); added link-preview metadata (Open Graph/Twitter, image → absolute Pages URL `https://chompy78.github.io/PACT/pact-cover.jpg`), an inline SVG favicon, `theme-color`, focus-visible + reduced-motion a11y (AA contrast verified), wayfinding ("Start here", For-players/For-DMs grouping with icons), a PWA install button (`beforeinstallprompt`), and an offline badge. Removed the dev-only Engine Parity Tests card and the `js/engine.js` masthead jargon. **Externalized the cover image** to a shared `pact-cover.jpg`: landing page references `pact-cover.jpg`, the guide now references `../pact-cover.jpg` (index ~420 KB → ~23 KB; guide ~1.06 MB → ~656 KB). No tool pages, engine, or save data changed; all links/wiring preserved 1:1. Verified in-browser: cover loads, 3 cards + hero render, theme switch + Auto-revert work, zero console errors. `DATA.version` unchanged.
- **2026-06-29 · data — tools refreshed to the corrected v0.332 DATA** (`tools/*.html`; no engine/logic change). Replaced each tool's embedded `const DATA={…}` block with the audited v0.332 dataset (now md5-identical across CharGen / Live Sheet / DM Console **and** `engine.js`). CharGen's static version labels (title + header) bumped v0.322→v0.332; Live Sheet & DM Console already render `DATA.version` dynamically. Browser-verified all three: load with no console errors, `compute()` prices on the new ladders (1st Expertise **5 AP**, 20 Focus **110 AP**), Barbarian "Path of the World Tree", Dragonborn "Draconic flight" sticker 9; 318 features / 33 invocations; pages display v0.332. (Tools still embed their own DATA+compute — Option B import refactor remains a later task.) `DATA.version` **v0.332**.

- **2026-06-29 · fix — correct the v0.332 engine DATA (PR #23 shipped an incomplete build)** (`js/engine.js`; engine-parity **5/0**). PR #23 merged the divergent `Downloads` export: only **106 of 318** `features`, **0 of 33** Eldritch Invocations, and missing the Dragonborn "Draconic flight" reprice (handoff change #4). Replaced `DATA` with the audited **handoff v0.332** dataset while keeping the repo's ES-module code byte-for-byte unchanged (no `compute()`/logic change). Now: 318 features, 33 invocations, Draconic flight T4 Situational (origin 9 / cross 13), expertise N+4 ladder, Focus Gentle ladder, Barbarian "Path of the World Tree". Verified against the handoff's 6-point checklist (all PASS) and DATA byte-identical to the handoff build. `DATA.version` stays **v0.332**.

- **2026-06-29 · data — engine rules data refresh, `DATA.version` v0.322 → v0.332** (`js/engine.js`). Dropped-in an externally-updated `engine.js` — **data-only**: the `DATA` object changed (new features + revised AP costs) while every function and export is byte-for-byte identical (verified via diff). Parity test still **5/0** on all fixtures at v0.332. *(Superseded — the dropped-in file was an incomplete export; corrected by the entry above.)*

- **2026-06-29 · feature — campaign-play backend: co-DMs, AP award ledger, ignore-player-AP** (`sql/schema.sql`, `sql/rls-policies.sql`, new `sql/migrations/2026-06-29-codm-ap-ledger.sql`; no engine/tool changes). New `campaign_dms` table (multiple DMs per campaign; owner auto-added; join via new `dm_invite_code`/`join_as_dm` or owner `promote_to_dm`/`remove_dm`). New `ap_awards` ledger — `award_ap(char, amount, note)` now records who/when/how much and bumps the running `characters.ap`. New `campaigns.ignore_player_ap` toggle for the dual-source AP model. `is_campaign_dm()` now checks membership; RLS + grants updated for both new tables. Run the migration on existing DBs. See `DECISIONS.md` D-GH7.

- **2026-06-29 · feature — Task 1 complete: SW registration added to `tools/*.html`** (engine untouched — parity unaffected; `tools/*.html` only). Added the shared service-worker registration block + `<link rel="manifest" href="/PACT/manifest.json">` to all three tool pages (CharGen, Live Sheet, DM Console), using absolute `/PACT/` paths, with an in-page "new version ready / Reload" bar on `updatefound`. Finishes the SW snippet deferred from the PWA-shell entry below.

- **2026-06-29 · fix — Mobile CharGen header now stays pinned** (engine untouched; `tools/PACT-CharGen-Webtool.html`). On mobile (≤768px) the page switched to an app-shell: `body` is a flex column at `100dvh; overflow:hidden`, the header is a static `flex:0 0 auto` bar, and `.layout` becomes the scroll area (`flex:1; overflow-y:auto`). Fixes the header scrolling off on real mobile Chrome (a compositor repaint issue that `fixed`/`sticky` + GPU hints couldn't solve). Desktop keeps `position:sticky` + window scroll; "Jump to section" uses `scrollIntoView` on the inner area. See D-GH5.

- **2026-06-29 · chore — Version bump + header polish** (engine untouched; all three `tools/*.html`). CharGen & Live Sheet build → **v0.107**; DM Console `TOOL_VERSION` → **v0.015**. Header now surfaces both the Web Tool build (v0.107) and the PACT rules version (`DATA.version` v0.322, unchanged) and shows a ⚠ warning icon beside the AP total on row 1. Removed the now-unused `.topbar` CSS from CharGen. `DATA.version` unchanged. See D-GH6.

- **2026-06-29 · feature — Task 1: PWA shell** (engine-parity 5/5; new files only). Added `manifest.json` (standalone, scope+start_url `/PACT/`), `service-worker.js` (cache-first, pre-caches all tool pages + engine, skips icon failures gracefully, "reload to update" banner), `404.html` (GitHub Pages SPA redirect), placeholder icons 192/512/180 in `icons/`. SW registration + manifest link added to `index.html`. SW snippet for `tools/*.html` deferred — prompt provided separately.

## How to add an entry
Add at the TOP. Format:
`- **<date> · <type> — <headline>** (<proof: tests pass, files touched>). <what changed, condensed>.`
`<type>` ∈ `feature · rule · fix · data · UI · tooling · docs`. Note `DATA.version` only if it changed.

---

- **2026-06-29 · fix — rename XP → AP across the cloud backend** (`js/sync.js`, `js/dm.js`, harnesses; SQL + docs renamed on the data-model branch). PACT's DM-awarded currency is **AP**, not XP: `characters.xp` → `characters.ap`, `award_xp()` → `award_ap()`, and every client reference. Live DBs need the one-off `alter table … rename column xp to ap;` + function recreate.

- **2026-06-29 · feature — Task 4 (partial): campaigns + DM AP logic** (new files `js/campaign.js`, `js/dm.js`, `campaign-test.html`; no engine/tool changes). `campaign.js`: create campaign (auto invite code), join via `join_campaign()` RPC, regenerate code (DM-only), list campaigns tagged by per-campaign role. `dm.js`: read roster (player name + character + ap), award/deduct ap via `award_ap()` RPC, read raw stats for inspection. `campaign-test.html` exercises create/join/regen/roster/award end-to-end. DM Console UI wiring deferred until tool HTML edits settle.

- **2026-06-29 · feature — Task 3 (partial): cloud save + offline sync** (new files `js/sync.js`, `sync-test.html`; no engine/tool changes). Supabase-primary, localStorage-fallback character persistence: save/load/list/delete, last-write-wins by `updated_at`, dirty-flag retry on reconnect, `initSync()` auto-reconciles on load + the `online` event. Only raw `stats` is stored; `ap` is never pushed from local and is overwritten from the server on pull. `sync-test.html` harness verifies it end-to-end.

- **2026-06-29 · feature — Task 2 (partial): standalone login screen** (new file `login.html`; no engine/tool changes). Self-contained sign-in / register / forgot-password page wired to `js/auth.js`, themed to match `index.html`. Lets auth be tested end-to-end before the per-page auth gate is wired in.

- **2026-06-29 · feature — Task 2 (partial): Supabase client + auth helpers** (new files `js/supabase-client.js`, `js/auth.js`; no HTML/engine changes; engine-parity unaffected). Single shared Supabase client (publishable key, RLS-protected; supabase-js loaded from CDN, no build step). Pure-logic auth module: register/login/logout, forgot + update password, current user/session, auth-change subscription, profile fetch. No global role read (roles are per-campaign, D-GH4). Login UI + HTML wiring deferred to the next step.

- **2026-06-29 · UI — CharGen: header fully redesigned with 4-row desktop layout (Row 1: name+AP+warn icon; Row 2: title+versions+timestamp; Row 3: all action buttons, wraps; Row 4: section nav) and 2-row mobile layout (Row 1: name+AP; Row 2: Random+Reset+section jump). New 768px breakpoint for header only; existing 600px breakpoint unchanged. `DATA.version` unchanged.**

- **2026-06-28 · UI — Both tools: "Last edited" timestamp now reads from document.lastModified (HTTP header set by GitHub Pages from the commit date) instead of a hardcoded string. UI-only; `DATA.version` unchanged.**

- **2026-06-28 · UI — CharGen: AP indicator is now the sticky mini-header (#mtop): character name on left, "X / Y AP" pill on right. Removed #apFloat floating pill (not wanted in CharGen) and #chip (topbar duplicate). UI-only; `DATA.version` unchanged.**

- **2026-06-28 · UI — CharGen: removed mobile bottom AP bar (#mobar); replaced with a floating pill (#apFloat, top-right) identical to the Live Sheet — shows remaining AP, flashes on change, turns red when over budget. UI-only; `DATA.version` unchanged.**

- **2026-06-28 · UI — Live Sheet mobile improvements: header buttons become icon-only (text labels hidden), version/last-edited metadata hidden; DM toolbar scrolls horizontally; category headers get larger tap targets; bottom bar gets thumb-reachable Undo/Redo buttons alongside AP display. UI-only; `DATA.version` unchanged.**

- **2026-06-28 · UI — Live Sheet buy panel — renamed 'Expertise' group to 'Skill expertise'. UI-only; `DATA.version` unchanged.**

- **2026-06-28 · UI — Live Sheet buy panel — moved 'Tools & instruments' and 'Tool expertise' to sit directly after 'Expertise' (before 'Languages') in the Proficiencies group. UI-only; `DATA.version` unchanged.**

- **2026-06-28 · UI — Live Sheet buy panel — boons and drawbacks now grouped by category (matching CharGen); boons show their effect description like drawbacks; AP moved inline next to the item name to save vertical space. UI-only; `DATA.version` unchanged.**

- **2026-06-28 · UI — Live Sheet buy panel — moved weapon masteries from the 'Languages & masteries' group into 'Weapons & armour'; renamed the languages group to 'Languages'. UI-only; `DATA.version` unchanged.**

- **2026-06-29 · fix — suppress zero-cost non-purchase entries in CharGen→Live Sheet exports** (`DATA.version`
  stayed **v0.322**; exporter-only fix). The export log now skips non-purchase setup entries like
  innate-spell defaults and character-size state, so the Live Sheet no longer shows them as if they were
  bought purchases.

- **2026-06-29 · fix — make CharGen→Live Sheet export create a file again** (`DATA.version`
  stayed **v0.322**; exporter-only fix). The Live Sheet export button now completes its save/download
  path successfully by avoiding a broken mutator reference during event-log generation, so CharGen can
  produce a downloadable Live-Sheet JSON file again.

- **2026-06-29 · fix — make CharGen→Live Sheet export emit native per-item events** (`DATA.version`
  stayed **v0.322**; `compute()` unchanged; exporter-only change). CharGen export now emits discrete
  native buy events for boons, drawbacks, skills, saves, expertise, tools, masteries, racial traits,
  arts, features, subclasses, and other itemized purchases so imported characters behave like native
  Live-Sheet buys, including drawback buy-off and per-line ledger entries.

- **2026-06-28 · data — apply PHB page numbers and drawback text updates to `js/engine.js`** (`DATA.version`
  stayed **v0.322**; `compute()` unchanged; display-only data only). Added `page: 214` to the 8 weapon
  masteries, added PHB `page` values to the 41 listed arts/techniques, and replaced the 10 listed
  `drawbackFx` strings with the fuller Players Guide wording. Verified `testing/tests/engine-parity.html`
  reports **5 passed / 0 failed**.

- **2026-06-28 · data — fill PHB page numbers + sync drawback text into `js/engine.js`** (`DATA.version`
  stays **v0.322** — display data only, `compute()` unchanged; engine-parity unaffected). Weapon-mastery
  PHB pages → `DATA.masteryFx[*].page` = **214** (all 8). Arts & Techniques pages → `page` added to **41 of
  43** `DATA.arts[*]` (matched to the PHB feat list; *Blessed Warrior* + *Druidic Warrior* have no PHB feat
  entry, left page-less). Drawback descriptions reconciled against the **Players Guide v0.324**: 53 already
  identical, **10 synced** to the guide's fuller wording (added DEX/WIS "cap" clauses — already enforced by
  `DATA.drawbackMaxStats`, so display-only). Land it via `docs/ENGINE-DATA-UPDATE.md`. See `DECISIONS.md` D-014.

<!-- Full pre-GitHub history (the v0.x build series, 119 condensed lines): docs/history/CHANGELOG-full.md -->
