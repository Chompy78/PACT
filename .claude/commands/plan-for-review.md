# PACT — draft a plan for cross-AI review

You turn a task or idea into a written plan, then save it as a self-contained markdown file formatted
for a *different* AI (a separate session, a different model, or a human reviewer with no shared context)
to read cold and critique. This is a planning/drafting aid, not an execution skill — it never implements
anything itself.

## Step 1 — figure out what needs a plan

- If `$ARGUMENTS` describes a task or idea, plan for that.
- If `$ARGUMENTS` is empty, check whether this session already worked out a plan earlier in the
  conversation (e.g. via Claude Code's own plan mode) — if so, use that as the starting material instead
  of re-deriving it from scratch.
- If neither gives you enough to go on, ask the user directly what they want a plan for. Don't guess.

## Step 2 — do the actual planning

Research whatever the plan touches (read the relevant files; check `AGENTS.md` / `docs/PACT_ROADMAP.md` /
`DECISIONS.md` for constraints that apply) and work out a real plan, not a placeholder. Think through:
- the concrete goal, and how you'd know it's done
- the proposed approach, broken into ordered steps, naming concrete files/functions/line numbers where you
  already know them
- alternatives you considered and why you didn't pick them — even briefly, since a reviewer without your
  research can't tell "the only option" from "the option you happened to think of first"
- risks and open questions you're genuinely unsure about
- which files/areas the plan touches

Assume the reviewer has **no access to this repo** — the usual destination for this doc is being pasted
into a different AI tool with nothing but the text you hand it. Any rule, constraint, or prior decision
that shapes the plan needs to be quoted or paraphrased inline in Step 3's Context section; a reference
like "see AGENTS.md" is useless to a reader who can't open that file.

Don't skip the alternatives/risks sections just because the plan feels obvious to you. The point of this
skill is to hand the plan to someone with none of your context, so make the reasoning visible, not just
the conclusion.

## Step 3 — package it for a cold reviewer

Write the plan into this exact shape so another AI (or person) can pick it up with zero prior context and
give a useful review:

```markdown
# Plan: <short title>

## Goal
<what this plan achieves and why, in a sentence or two — assume the reader has never heard of this task>

## Context
<the constraints/background a reviewer needs, quoted or paraphrased inline — not "see AGENTS.md", since
the reviewer likely can't open it: relevant repo rules, prior decisions, why this is being done now>

## Proposed approach
1. <step>
2. <step>
...

## Alternatives considered
- <alternative> — rejected because <reason>

## Risks / open questions
- <anything genuinely uncertain that a reviewer should weigh in on>

## Done when
<objective, checkable condition>

---

## Reviewer instructions
You are reviewing this plan cold, with no context beyond what's written above. Your job is to find gaps,
unstated risks, and better alternatives — not to implement anything. Specifically:
1. Does the proposed approach actually achieve the stated goal?
2. Is anything in "Alternatives considered" actually better than the chosen approach?
3. What's missing — an edge case, a risk, a dependency the plan doesn't mention?
4. Is "Done when" actually checkable, or does it hide ambiguity?

Write your findings as a plain list (gaps found, suggested improvements, verdict) — don't rewrite the
plan yourself unless asked.
```

## Step 4 — show it before writing anything

Show the drafted file content to the user and ask for approval before writing it to disk — same
convention as this repo's other drafting skills (`/log-ai-lessons`, `/add-roadmap-task`). If they want
changes, revise and show again. Do not proceed until approved.

## Step 5 — write the file

Once approved, write it to `docs/plans/<date>-<slug>.md` (create the `docs/plans/` directory if it
doesn't exist yet). Tell the user the path, then ask whether they also want it committed — this is a
handoff artifact for another AI/reviewer, so it's fine to leave it as a local, uncommitted file if
they're just going to paste it elsewhere. If they do want it committed, commit it directly (docs-only,
no code/rules change) and ask which branch (default `preview`, matching `/add-roadmap-task`'s
convention, unless told otherwise).

---

$ARGUMENTS
