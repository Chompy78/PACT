# D-GH29 — M365 Copilot is used only as a cold reviewer of self-contained plans — never as a repo-aware assistant

Status: Active

- **Context:** the project owner wanted to cut Claude Code token usage by routing project/doc review
  through **Microsoft 365 Copilot (Business)** (via M365 Chat / SharePoint / OneDrive / Edge — explicitly
  *not* GitHub or VS Code Copilot). M365 Copilot has no local repo access, no git, no code execution, and
  no repo-level code understanding; it only grounds on content explicitly given to it. Parsing 10 recent
  session transcripts showed the token premise was wrong anyway: cost is dominated by cache reads (~235M
  tokens = standing context re-read every turn), while *all* doc reads combined were ~114k — a rounding
  error. But one pattern had independently proven useful in practice: Claude drafting a plan and Copilot
  critiquing it.
- **Options considered:** (A) full pipeline — Copilot reviews the repo (via a OneDrive mirror), generates
  implementation task packs, Claude validates/implements; (B) keep only **Claude → Copilot → Claude cold
  plan review** — Claude writes a self-contained plan, Copilot critiques *plan quality* (no repo access),
  Claude triages and implements; (C) drop Copilot from the coding workflow entirely.
- **Decision:** (B). The `/plan-for-review` skill produces a self-contained plan; the human pastes it to
  M365 Copilot for a cold critique (logic/scope/assumptions/risks/acceptance/verification), then pastes the
  critique back for Claude to triage (accept/reject/defer/→test/→doc/→roadmap). Gated by: *use cold review
  only if a wrong approach would cost more than one implementation cycle to undo.* Rejected the OneDrive
  mirror, a separate `PACT-AI-CONTEXT.md`, and any Copilot-generated code/architecture.
- **Why:** the value is **avoided rework**, not saved tokens — and it works *because* the plan is
  self-contained, so Copilot's lack of repo/code awareness stops mattering (it reviews the writing, not the
  code). (A) was rejected because it assumes a code-awareness Copilot doesn't have (blind task packs Claude
  must re-derive), targets a token problem the data disproved, and the OneDrive mirror adds a `robocopy
  /MIR` data-loss footgun + indexing lag for no real gain; a separate context file duplicates `AGENTS.md`.
  (C) throws away a pattern the owner confirmed useful. Claude stays the final authority and verifies every
  Copilot finding against the actual code before acting.
- **Status:** DONE (PR #124). The *when* lives in `AGENTS.md`'s Agent-guidance rubric; the *how* in
  `docs/SKILLS.md` and `.claude/commands/plan-for-review.md`.
