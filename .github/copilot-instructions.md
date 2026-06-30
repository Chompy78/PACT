<!-- Destination: .github/copilot-instructions.md -->
# PACT — instructions for AI coding agents

**Full instructions live in [`/AGENTS.md`](../AGENTS.md) at the repo root — read it before making any
change.** This stub repeats only the safety-critical rules so they are always in front of you.

PACT is a static, vanilla-JS tabletop-RPG tool suite. No frameworks, no build step, no npm.
Hosted on GitHub Pages at https://chompy78.github.io/PACT/ (served from the `main` branch root).

## Hard rules (the non-negotiables — `AGENTS.md` has the rest)
- `js/engine.js` is the SINGLE SOURCE OF TRUTH for all game rules. Never duplicate or re-implement
  rules logic anywhere else. Don't read it end-to-end unless your task targets the engine.
- Keep the three `tools/*.html` working and their UI unchanged unless the task says to change it.
- Vanilla JS only. No frameworks, bundlers, TypeScript, or npm dependencies.
- GitHub Pages only — no server-side code. Service-worker scope and manifest `start_url` must be `/PACT/`.
- Regression gate: after any change, `testing/tests/engine-parity.html` must report **5 passed / 0 failed**.
- Log as you go: update `CHANGELOG.md` (what), `DECISIONS.md` (why), and graduate finished items out of
  `docs/PACT_ROADMAP.md` into `CHANGELOG.md`.
- `docs/PACT_ROADMAP.md` has a single writer — don't append to it directly; output new items for the
  human to consolidate.

→ For architecture, the module bridge, the export contract, version rules, and the token budget, **read
[`/AGENTS.md`](../AGENTS.md).**
