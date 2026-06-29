# PACT — instructions for AI coding agents

> **Master copy.** Copy this file to `CLAUDE.md` (Claude Code reads that) and to
> `.github/copilot-instructions.md` (VS Code Copilot reads that). Keep all three identical —
> edit this one, then re-copy. (Some tools also read `AGENTS.md` directly.)

PACT is a static, vanilla-JS tabletop-RPG tool suite. No frameworks, no build step, no npm.
Hosted on GitHub Pages at https://chompy78.github.io/PACT/ (served from the repo root).

## Architecture — read before editing
- `js/engine.js` is the SINGLE SOURCE OF TRUTH for all game rules. Plain browser ES module.
  Exports: `DATA`, `compute(build)`, `rebuildStateFromEvents(base, events)`, `baseBuild`, `MUT`,
  `activeEvents`, `economy`, `foldBuild`. Never duplicate or re-implement rules logic anywhere else.
- Three UI-only tools in `tools/`: `PACT-CharGen-Webtool.html`, `PACT-Live-Char-Sheet.html`,
  `DM Console.html`. Each loads the engine via a "module bridge": a `<script type="module">` that
  imports `../js/engine.js`, copies the API onto `window`, and dispatches an `engine-ready` event; the
  tool's classic UI script is gated on that event. `tools/` and `js/` must stay siblings so
  `../js/engine.js` resolves.
- Persistence today: localStorage + JSON import/export only. Character data: CharGen = a flat build
  JSON; Live Sheet = an event log `{ LOG, SEQ, rules }`. All derived stats (HP, AC, AP, warnings) come
  from `compute()` / `rebuildStateFromEvents()` at runtime — never store derived values.
- **CharGen → Live Sheet export (D-GH3):** the export button in CharGen produces a Live Sheet JSON by
  emitting discrete native buy events (one per itemized purchase: boons, drawbacks, skills, saves,
  expertise, tools, masteries, racial traits, arts, features, subclasses, etc.) plus structural patches
  for scalar/blob fields. Imported characters must be indistinguishable from hand-built ones — drawbacks
  must remain buy-off-able and ledger entries must appear per line. Zero-cost non-purchase setup entries
  (innate-spell defaults, character-size state) are suppressed from the export log.

## Hard rules for any change
- Keep the three tools working and their UI unchanged unless the task says to change it.
- Vanilla JS only. No frameworks, bundlers, TypeScript, or npm dependencies.
- GitHub Pages only — no server-side code. Any service-worker scope and manifest `start_url` must be `/PACT/`.
- Regression gate: after any change, `testing/tests/engine-parity.html` must still report 5 passed / 0
  failed. If you touch `engine.js`, keep its public API stable and re-confirm the tests.

## Rules version vs display data (don't over-bump the version)
- `DATA.version` (currently `v0.322`) is the **rules** version. Bump it ONLY when the *mechanics* change
  (ladders, prices, gates, what `compute()` does).
- Some `DATA` maps are **display-only** and are never read by `compute()`: `masteryFx`, `drawbackFx`,
  `racialFx`, and the `page` fields on `arts` / `masteryFx` (PHB page numbers shown in tooltips). Editing
  those is a documentation change — do NOT bump `DATA.version`; just log it in `CHANGELOG.md`.

## Project memory — LOG AS YOU GO (this is how context survives between sessions)
Before you finish a task / open a PR, update whichever apply (newest entries at the TOP):
- **`CHANGELOG.md`** (repo root) — *what* changed. One condensed line per change.
- **`DECISIONS.md`** (repo root) — *why*, whenever you make/reverse an architectural/process choice
  (**Context → Options → Decision → Why → Status**).
- **`docs/sessions/<date>-<topic>.md`** — the *discussion*: what was explored and landed on (history).
These are the project's memory; updating them is part of the change, not an afterthought.

## File map
- **App:** `index.html` (menu) · `js/engine.js` · `tools/*.html` · `docs/PACT-Players-Guide.html`.
- **Testing:** `testing/tests/engine-parity.html` (run this; expect 5/0) ·
  `testing/expected/expected-results.csv` · `testing/fixtures/builds/` (CG-001 empty, CG-002 valid-50ap,
  CG-003 over-budget) · `testing/fixtures/live-sheets/` (LS-001 clean generator export) ·
  `testing/fixtures/events/` (EV-001 award-and-purchase) · `testing/pack-manifest.json` ·
  `testing/scripts/compare-results.js`.
- **Live logs (repo root):** `CHANGELOG.md` · `DECISIONS.md`.
- **Docs folder:** `docs/sessions/` (per-session narratives) · `docs/history/` (archived pre-GitHub
  history — full changelog, old INDEX/CONTEXT, fuzz harness; non-authoritative) · `docs/PWA-BUILD-PLAN.md`
  (roadmap) · `docs/HOW-TO-WORK.md` (the working guide) · `docs/ENGINE-DATA-UPDATE.md` + `docs/engine-data-update.json` (data task reference, now complete).

## Where new work goes (planned — the PWA + Supabase build)
Tasks 1–5 are still TODO; full prompts and done-criteria are in `docs/PWA-BUILD-PLAN.md`.
- Repo root: `manifest.json`, `service-worker.js`, `404.html`.
- `js/`: `supabase-client.js`, `auth.js`, `sync.js`, `campaign.js`, `dm.js`.
- `sql/`: `schema.sql`, `rls-policies.sql`.
- Store only the build JSON / event log in the DB (`characters.stats`); the engine derives the rest.
  `ap` (the DM-awarded points column) is server-authoritative and DM-only.

## Per-change checklist
1. Work on a branch, one task at a time.
2. Edit `js/engine.js` ONLY if the task targets the engine; otherwise treat its public API as fixed.
3. Open `testing/tests/engine-parity.html` → expect **5 passed / 0 failed**. If the task changed
   `compute()` output, update `testing/expected/` in the same change and say so.
4. Update `CHANGELOG.md` (+ `DECISIONS.md` / `docs/sessions/` if they apply).
5. Open a PR; let the agent draft the PR body from the changelog entry.
