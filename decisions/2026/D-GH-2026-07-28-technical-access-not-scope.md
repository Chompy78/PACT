# D-GH-2026-07-28-technical-access-not-scope — Add a "technical access ≠ scope" rule to AGENTS.md

Status: Active

- **Context:** Direct testing on Home AI Server (a different project sharing this AI_templates standard)
  confirmed a real gap: a session with broad, non-enforced filesystem/connector access (there, a Windows
  app's drive mapping covering multiple projects, not a project-scoped one) reasoned it *would* edit a
  different project's files if asked, since it saw no rule stopping it.
- **Options:** Leave it as an unstated assumption; or state it explicitly in AGENTS.md, matching the
  standard-level rule now added to AI_templates' `AGENTS_TEMPLATE.md`/`AI_RULES.md`.
- **Decision:** State it explicitly.
- **Why:** The Home AI Server test showed the assumption doesn't hold — a session without an enforced
  technical boundary needs to actually be told, not just expected to infer it.
- **Status:** Active. See AI_templates' `D-2026-07-28-technical-access-not-scope` for the full reasoning.
