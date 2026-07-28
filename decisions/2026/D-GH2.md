# D-GH2 — Carry the changelog / decisions / narrative discipline into the GitHub repo

Status: Active

- **Context:** the pre-GitHub Cowork project kept a rich `CHANGELOG.md`, `DECISIONS.md`, and session
  narratives. The new GitHub repo had an architecture instructions file (`pact-agent-instructions.md`) but
  no logging discipline — so context would stop travelling between AI sessions.
- **Options:** (i) keep the logging notes only in Cowork; (ii) move the three logging docs into the repo and
  make the AI-agent instructions require updating them on every change.
- **Decision:** (ii). One master instructions file (`AGENTS.md`, copied to `CLAUDE.md` +
  `.github/copilot-instructions.md`) now carries BOTH the architecture/PWA plan AND a "log as you go" rule
  that points every agent at `CHANGELOG.md` / `DECISIONS.md` / `docs/sessions/`.
- **Why:** in-repo docs version with the code and show up in every diff/PR, so the discipline is enforced by
  review instead of memory; one master file copied to the tool-specific names means Copilot and Claude both
  follow identical rules without re-pasting context each session.
- **Status:** IN FORCE.
