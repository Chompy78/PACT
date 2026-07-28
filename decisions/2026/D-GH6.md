# D-GH6 — Versioning scheme — three independent numbers

Status: Active

- **Context:** the header now displays version info and it was ambiguous which number means what.
- **Decision:** keep three independent counters: **(1) Tool/build version** — the `v0.x` in each tool's top comment, `<title>`, and header label (CharGen & Live Sheet bumped 0.106 → **0.107**); **(2) PACT rules version** — `DATA.version`, canonical and stamped on saved JSON, shown as "PACT rules · v0.322", kept in sync CharGen ↔ Live Sheet and bumped only when mechanics change; **(3) DM Console** — its own `TOOL_VERSION` counter (0.014 → **0.015**).
- **Why:** rules changes and cosmetic tool changes have different audiences and cadences; conflating them would force needless `DATA.version` bumps (and re-validation) for pure UI work.
- **Status:** IN FORCE.
