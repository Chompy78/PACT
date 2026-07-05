# 2026-07-05 — M365 Copilot as a cold plan reviewer (workflow decision)

## Context
The project owner was iterating (via copy-paste between two AIs) on a proposed workflow to cut Claude Code
token usage by routing project/doc review through **Microsoft 365 Copilot (Business)** — explicitly *not*
GitHub/VS Code Copilot. Assumed constraints for M365 Copilot: can read OneDrive/SharePoint content the user
can access, general chat capability, **no local repo access, no git, no code execution, no repo-level code
understanding** unless files are explicitly pasted in.

## What the data showed
Parsed 10 recent PACT session transcripts (`~/.claude/projects/.../*.jsonl`). Findings:
- **Cache reads dominate cost** (~235M tokens across the 10 sessions) — i.e. standing context re-read every
  turn. This scales with *session length × context size*, not with doc reads.
- **All `Read` tool content combined was ~114k tokens**; the roadmap/changelog/decisions trio the owner
  worried about was **~45k across all 10 sessions** — a rounding error.
- The "don't read `engine.js` wholesale" rule is working (only ~3.4k tokens over 4 reads).
- Conclusion: the token-saving premise for the whole Copilot pipeline **did not hold**. The real cost lever
  is shorter/more-focused sessions and keeping big reads inside subagents — nothing Copilot touches.

## Decision
Keep only the part that had *independently* proven useful: **Claude → Copilot → Claude plan review.** It
works because Claude bakes all context into a self-contained plan, so Copilot's lack of repo/code awareness
stops mattering — it reviews the *writing*, not the code. Value is **avoided rework** (bad plans, unclear
scope, missing tests/criteria), not raw tokens.

**Rule:** use cold review only if a wrong approach would cost more than one implementation cycle to undo.

### Rejected / cut
- **OneDrive mirror + robocopy** — solved a token problem that isn't real; `/MIR` carries a data-loss
  footgun; indexing lag; and the review loop doesn't need repo access anyway. (Owner has OneDrive *for
  Business*, so grounding was possible — still not worth it.)
- **Separate `PACT-AI-CONTEXT.md`** — duplicates `AGENTS.md`; violates single-source-of-truth.
- **Copilot as repo-aware planner / code reasoner / architecture recommender** — it can't see the code;
  Claude stays the final authority and verifies every Copilot finding against the actual code.

## Changes made this session
- Tightened `.claude/commands/plan-for-review.md`: trigger gate; skip trivial work; build the package from
  already-gathered context (no re-reading to pad); ≤1.5-page cap; added Assumptions-vs-verified-facts,
  Files involved, Verification, and Review-outcome sections; reframed reviewer instructions for a no-repo
  cold reviewer with an anti-churn note; Step-7 accept/reject/defer/→test/→doc/→roadmap triage.
- Added `## Active Priorities` block near the top of `AGENTS.md` (blank fields for the owner to fill).

## Open follow-ups
- Owner to fill the five `Active Priorities` fields.
- Optional: a `dev/learnings.md` entry — *M365 Copilot ≠ GitHub Copilot; use it as a cold reviewer of
  self-contained artifacts, not a repo-aware assistant; Claude Code cost is dominated by cache reads
  (context × turns), not doc reads — measure transcripts before optimising.*
