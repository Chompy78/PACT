# docs/history — archived, non-authoritative

This folder preserves the project's history from **before** the move to GitHub. None of it is the live
source of truth — the current rules live in `js/engine.js`, and the current docs are `AGENTS.md` +
`CHANGELOG.md` + `DECISIONS.md` at the repo root. Keep this for back-story only.

⚠️ The older docs here describe an **earlier architecture**: the engine was *inlined* into each standalone
HTML tool and verified by a 46-gate Node audit (`tests/audit-all.cjs`) with a `src/engine/` source + a
`build.cjs` re-inline step. That was replaced by the current model — one shared `js/engine.js` imported by
the tools, on GitHub Pages. So references in these files to `src/engine/`, `scripts/build.cjs`,
`audit-all.cjs`, or a "build counter" are historical, not instructions.

## Contents
- `CHANGELOG-full.md` — the full condensed version history of the v0.x build series (what the root
  `CHANGELOG.md` continues from).
- `cowork-INDEX.md` / `cowork-PACT-CONTEXT.md` / `cowork-RESTART-STATUS-v0.322.md` — the pre-GitHub
  front-door / deep-authority / current-state docs (now superseded by `AGENTS.md`).
- `RESTART-STATUS-history.md` — even older superseded status sections.
- `CONTEXT-history-v0313.md` — a superseded rules-port WIP note.
- `PACT-ki-sorcery-resource-audit.md` — a one-time resource-tag audit (tags already applied in the engine).
- `fuzz/` — the deterministic property/metamorphic stress harness + its plan (long-running, manual; written
  against the old engine structure — kept for reference, not runnable as-is here).

Per-session narratives live one level up in `docs/sessions/`.
