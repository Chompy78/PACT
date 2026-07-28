# D-GH1 — Repo layout: one shared `js/engine.js`, tools are UI-only, deploy via GitHub Pages

Status: Active

- **Context:** moving PACT from Cowork (engine inlined into each standalone HTML tool) to GitHub Pages.
- **Options:** (i) standalone single-file tools with the engine inlined in each; (ii) centralise the engine
  in one `js/engine.js` and have the tools import it via a module bridge; (iii) both.
- **Decision:** (ii) — `js/engine.js` is the single source of truth; `tools/*.html` import it; the site is
  served by GitHub Pages at `/PACT/`.
- **Why:** one engine to edit means the three tools can never silently diverge; Pages gives a free public
  URL. Trade-off: tools are no longer single-file/offline (the PWA task restores offline via a service worker).
- **Status:** IN FORCE.
