# D-GH21 — `/plan-for-review` output is a trust-boundary crossing artifact — secrets excluded by instruction, not by gate

Status: Active

- **Context:** the new `/plan-for-review` skill (`.claude/commands/plan-for-review.md`) drafts a plan and
  writes it to `docs/plans/<date>-<slug>.md`, explicitly designed so a *different* AI tool with no repo
  access can review it cold. That means the doc is expected to leave PACT's trust boundary (pasted into
  an unrelated third-party AI/chat), unlike every other skill's output, which stays inside this repo/session.
- **Options considered:** (A) no special handling — same as any other docs file; (B) instruct the drafting
  step to never inline secrets/credentials/tokens, describing constraints instead of quoting values; (C)
  add an automated scan (e.g. a gitleaks-style check) before the file is written.
- **Decision:** (B) — an explicit instruction in the skill (Step 3) to paraphrase the *existence* of a
  constraint rather than quote sensitive values, plus keeping the write→commit→push stages separate and
  each individually opt-in, so a drafted plan doesn't leave the local filesystem (let alone the repo)
  without an explicit ask.
- **Why:** this was flagged independently by three cold-reviewer passes run against the skill's own first
  output (a plan for adding itself) — confirming the risk is real, not hypothetical, for a skill whose
  entire purpose is producing self-contained docs for an external reader. (C) was rejected as
  disproportionate machinery for a docs-only, human-in-the-loop workflow (every write already requires
  explicit approval per Step 5); revisit if `docs/plans/` usage grows enough that an automated check
  becomes worth the overhead.
- **Status:** DONE. No secret has ever actually been written via this skill; this is a preventive
  instruction, not a response to an incident.
