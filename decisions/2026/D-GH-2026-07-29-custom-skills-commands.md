# D-GH-2026-07-29-custom-skills-commands — Strengthen `/make-code-cold-plan-review` with cross-vendor/adversarial/consensus guidance

Status: Active

- **Context:** Asked to research how others structure cross-AI plan/code review and whether
  `/make-code-cold-plan-review` could be improved. Web research turned up a consistent pattern across
  cross-vendor review write-ups, adversarial-review papers, and multi-agent-debate/peer-review literature:
  (1) a reviewer from the *same model family* as the author tends to repeat that family's own blind spots —
  cross-vendor review is the part that pays; (2) asking a reviewer to "check this over" produces
  rubber-stamping, while asking it to actively try to refute the plan produces real critique; (3) treating
  two same-family reviews as two independent votes overstates consensus — agreement is a stronger signal
  only across genuinely different model families; (4) the same session that authored a plan is a biased
  judge of criticism against that plan (the "don't let it grade its own homework" problem), which mattered
  here because Step 7's triage was previously done entirely by the drafting session itself.
- **Options:** (i) leave the skill as-is — it already sends the plan to "a different AI" by design, so the
  gap is arguably cosmetic; (ii) fold the above four findings into the skill: explicit cross-vendor guidance
  in Step 4, an adversarial reframe of the generated "Reviewer instructions" plus per-finding
  severity/confidence tags, a structured agree/disagree matrix in the "Review outcome" stub (replacing free
  text), and routing any `blocking`/disputed finding through a fresh, context-free `Agent` call in Step 7
  before the drafting session decides.
- **Decision:** (ii), all four changes, per explicit user selection after being shown the options.
- **Why:** The skill's stated purpose is to get a genuinely independent perspective on a plan — every one of
  the four gaps identified undercuts that goal in a way the research says matters: unstated vendor
  preference lets a user unknowingly ask the same model family twice; a "check it over" framing invites the
  exact rubber-stamping the skill exists to avoid; unweighted consensus tracking would let two same-family
  reviews look like two independent confirmations when they're not; and self-triage on contested findings
  reintroduces the single point of bias the whole external-review workflow was built to route around. All
  four are additive edits to existing sections (Step 4's package format, the generated reviewer-instructions
  text, the Review-outcome stub, Step 7's triage bullets) — no step was removed or reordered, so the
  skill's existing draft → approval → write → optional commit/push flow is unchanged.
- **Status:** Active. Added `Agent` to the command's `allowed-tools` frontmatter since Step 7's
  disinterested-second-look step now needs it. No prior plans in `docs/plans/` were affected — this changes
  the skill's *template and process*, not any specific plan document already produced by it.

## Addendum (2026-07-29) — `/code-review` findings on PR #276, fixed same-day

Running `/code-review` against this PR surfaced two follow-on issues in the change above, both fixed in the
same PR:

1. **Step 7 triage gap.** The original triage bullets defined what to do for `minor`/`moderate` findings
   (apply directly) and for `blocking`/disputed findings (route through a disinterested `Agent` pass), but
   never said what happens *after* that agent pass confirms a `blocking` finding with no reviewer
   disagreement — leaving the session with no defined next step for that case. A second, related ambiguity:
   the phrase "reflects reviewers disagreeing with each other ... including after the disinterested-agent
   pass, if it didn't resolve the disagreement" was compatible with two different readings of whether
   disagreement was an unconditional stop-trigger or one only the agent pass could clear. Fixed by making
   `blocking` severity an unconditional return-to-user trigger regardless of what the agent pass finds (the
   agent's job is to sharpen the recommendation, not to authorize unilateral action on a blocking issue),
   and by making an *unresolved* disagreement (after the agent pass) an unconditional stop, while a
   *resolved* non-blocking disagreement may be applied directly per the normal minor/moderate rule.
2. **`docs/SKILLS.md` drift.** This file is the project's stated human-readable authority on what each
   skill does (see its own header: "This file is the human overview"), but the original change updated only
   the skill file itself, not this description. Fixed by updating both the "cold-review loop" walkthrough
   and the one-line skill-reference bullet to describe the cross-vendor guidance, adversarial/severity-
   confidence framing, the disinterested-agent second opinion, and the structured outcome table.

No new Context/Options/Decision structure needed for these — both are corrections to the same-day decision
above, not a new design choice.
