---
description: Turn a task/idea into a self-contained plan formatted for a cold AI/human reviewer
argument-hint: [task or idea — omit to use this session's existing plan]
allowed-tools: Read, Grep, Glob, Edit, Bash(git add *), Bash(git commit *)
disallowed-tools: Bash(git push *)
---

# PACT — draft a plan for cross-AI review

You turn a task or idea into a written plan, then save it as a self-contained markdown file formatted
for a *different* AI (a separate session, a different model, or a human reviewer with no shared context)
to read cold and critique. This is a planning/drafting aid, not an execution skill — it never implements
anything itself.

Stages, in order: **draft → approval → write → optional commit → optional push.** Only the first three
are ever required; treat committing and pushing as a separate decision the user makes afterward, not
something to bake into whether the plan itself is "done."

## Step 1 — figure out what needs a plan

- `$ARGUMENTS` is whatever text followed this command when invoked. If it describes a task or idea, plan
  for that.
- If `$ARGUMENTS` is empty, check whether this session already worked out a plan earlier in the
  conversation (e.g. via Claude Code's own plan mode) — if so, use that as the starting material instead
  of re-deriving it from scratch.
- If neither gives you enough to go on, ask the user directly what they want a plan for. Don't guess.

**Trigger rule — only run this skill when external review would pay for itself:**

> Use Copilot/cold review only if a wrong approach would cost **more than one implementation cycle to undo.**

So skip it — and just tell the user to proceed directly — for one-line, single-file, or mechanical changes,
or anything where the approach is obvious and the blast radius is small; the review round-trip costs more
than it saves there. Reach for it when the task touches multiple files, has architectural implications,
changes `compute()` output/rules, involves tool-parity work, has contested/unclear scope, or you're
genuinely uncertain about the framing. For a genuinely large effort, split it into more than one linked
plan rather than one unreviewable mega-doc — say so and propose the split instead of forcing everything
into one file.

## Step 2 — check for an existing plan on the same topic

Look in `docs/plans/` for a prior plan that overlaps this one (same feature/area). If you find one:
- Ask whether this is a revision of that plan or a genuinely new one.
- If it's a revision, add a line near the top of the new plan: `Supersedes: docs/plans/<old-file>.md`, and
  say so to the user rather than silently producing an unrelated-looking duplicate.

## Step 3 — do the actual planning

Research whatever the plan touches (read the relevant files; check `AGENTS.md` / `docs/PACT_ROADMAP.md` /
`DECISIONS.md` for constraints that apply) and work out a real plan, not a placeholder. Think through:
- the concrete goal, and how you'd know it's done
- the proposed approach, broken into ordered steps, naming concrete files/functions/symbols where you
  already know them (prefer these over line numbers — they rot on the next edit; names don't)
- alternatives you considered and why you didn't pick them — even briefly, since a reviewer without your
  research can't tell "the only option" from "the option you happened to think of first"
- what's explicitly out of scope, so a reviewer doesn't suggest expanding it
- risks and open questions you're genuinely unsure about
- which files/areas the plan touches

Assume the reviewer has **no access to this repo** — the usual destination for this doc is being pasted
into a different AI tool with nothing but the text you hand it. Any rule, constraint, or prior decision
that shapes the plan needs to be quoted or paraphrased inline in the Context section; a reference like
"see AGENTS.md" is useless to a reader who can't open that file. When you state something as fact (a repo
rule, a prior decision), write it so the reviewer can tell it's a fact you verified — don't blur it with
things you're assuming or guessing.

**Never inline secrets, credentials, tokens, or anything private** into the plan — this document is
expected to leave the repo's trust boundary (pasted into an unrelated AI tool). Paraphrase the *existence*
of a constraint ("the DB key must stay server-side") without quoting the value itself.

Don't skip the alternatives/risks/out-of-scope sections just because the plan feels obvious to you. The
point of this skill is to hand the plan to someone with none of your context, so make the reasoning
visible, not just the conclusion.

**Build the package from what you already gathered while planning — do not re-read files just to pad it.**
The reviewer needs your reasoning, not a repo tour. **Target ≤1.5 pages / one screen the reviewer can hold
at once;** if it won't fit, that's the Step-1 signal to split into linked plans, not to write a mega-doc.
Keep an explicit line between **things you verified in the code** and **things you're assuming** — the cold
reviewer is especially good at attacking hidden assumptions, so surface them pre-sorted rather than blurred
into the approach.

## Step 4 — package it for a cold reviewer

Write the plan into this exact shape so another AI (or person) can pick it up with zero prior context and
give a useful review. The "Reviewer instructions" section is part of the generated document itself — you
write it, not the person invoking this skill:

```markdown
# Plan: <short title>

<Supersedes: docs/plans/<old-file>.md — only if Step 2 found a prior version>

## Goal
<what this plan achieves and why, in a sentence or two — assume the reader has never heard of this task>

## Context
<the constraints/background a reviewer needs, quoted or paraphrased inline — not "see AGENTS.md", since
the reviewer likely can't open it: relevant repo rules, prior decisions, why this is being done now. Never
include secrets/credentials/tokens themselves — describe the constraint, not the value.>

## Assumptions vs. verified facts
- **Verified (checked in the code/docs):** <facts you confirmed — so the reviewer knows these are solid>
- **Assumed (not yet confirmed):** <guesses the plan rests on — the reviewer is invited to attack these>

## Proposed approach
1. <step>
2. <step>
...

## Files involved
- <path — what changes in it and why. Name concrete files/functions/symbols, not line numbers (they rot).>

## Out of scope
- <things this plan deliberately does not attempt, so a reviewer doesn't suggest scope creep>

## Alternatives considered
- <alternative> — rejected because <reason>

## Risks / open questions
- <anything genuinely uncertain that a reviewer should weigh in on>

## Verification
<how you'll prove the goal was actually met — concrete, runnable checks, not "it works". For PACT that
almost always includes `testing/tests/engine-parity.html` → 5/0, plus any task-specific check (a fixture,
a manual UI step, version numbers mirrored per VERSION-SYNC.md). The reviewer should be able to spot a
missing verification step from this alone.>

## Done when
<the objective, checkable condition(s) for the plan's own deliverable. Do not fold "committed"/"pushed"
into this — those are separate optional stages this skill's workflow handles after the plan is written,
not part of what makes the plan itself complete.>

---

## Reviewer instructions
**Before anything else, state which AI model and settings you are** — e.g. "GPT-5 (default)", "Claude
Opus 4.x (extended thinking)", "Gemini 2.x Pro", or "human reviewer" — as the very first line of your
response. Whatever model or tool is reading this, identify yourself and any relevant mode/effort setting:
the author uses this to weight your findings and to tell multiple reviewers apart. (This instruction is
deliberately generic — it does not assume any particular tool.)

You are reviewing this plan **cold, with no access to the codebase** — only the text above. You are a
general reasoner, not a code analyzer: judge the plan's **logic, clarity, scope, and risk — not code
correctness you cannot verify.** If the plan relies on knowledge you don't have, that itself is a finding.
Find gaps, unstated risks, and better alternatives — including structural/redesign suggestions, not just
"missing detail" — but do not implement anything. Specifically:
1. Does the proposed approach actually achieve the stated goal?
2. Which of the plan's **assumptions** look shaky, and what happens if one is wrong?
3. Is anything in "Alternatives considered" actually better, or is the plan overcomplicated for the goal?
4. What's missing — an edge case, a risk, a dependency, a **verification step** the plan doesn't mention?
5. Are "Verification" and "Done when" objectively checkable, or do they hide ambiguity?
6. Should this task be split? Is anything in "Out of scope" actually load-bearing?

Write your findings as a plain list (gaps found, suggested improvements, verdict) — don't rewrite the plan
yourself unless asked. **If a section is genuinely solid, say so briefly rather than inventing concerns** —
false findings cost the implementer a wasted cycle.

**Deliver your review as a Markdown (`.md`) file** so the author can save it directly. Lead the file with
your model/settings line from above, then the findings. **Name the file relevantly and include your own
model name** — pattern `<plan-topic>-review-<your-model>.md` (e.g. `feedback-widget-review-gpt5.md`,
`feedback-widget-review-gemini-pro.md`). If you genuinely can't emit a file, instead give the whole review
as one copy-pasteable Markdown code block, still led by the model line and still naming what the file
would be called.

---

## Review outcome (fill in after the review + implementation — not part of the cold review)
- Reviewers (models): <which models/tools reviewed, from each review's self-ID line — e.g. GPT-5, Claude Opus, Gemini Pro>
- Reviewer findings: <N> → accept <A> / reject <R> / defer+convert <C>
- Materially changed the plan? <yes/no — one line on what changed>
- Without the review, what would have happened: <one line — a real risk caught, or "nothing, plan was fine">
```

## Step 5 — show it before writing anything

Show the drafted file content to the user and ask for approval before writing it to disk — same
convention as this repo's other drafting skills (`/log-ai-lessons`, `/add-roadmap-task`). If they want
changes, revise and show again. Do not proceed until approved.

**Present the plan as one clean copy-paste block**, because its whole purpose is to be dumped into another
AI tool. Emit the entire plan (everything from `# Plan:` through the end of the `## Reviewer instructions`
section — the Review-outcome stub can be omitted from the pasted copy since it's for later) inside a single
fenced code block whose fence is **four backticks, not the usual three**. Four is required: the plan body
itself contains three-backtick code blocks (the `## Proposed approach` examples, etc.), and a three-backtick
outer wrapper would be closed early by the first inner one — mid-plan — which is exactly what makes the
block painful to copy. A four-backtick fence is not closed by the inner three-backtick blocks, so the whole
plan stays selectable as one unit. Once written to disk in Step 6, the saved `.md` file is the equivalent
"download / save" copy for anyone who'd rather grab the file than copy from chat — so the user always has
both a copy-paste path and a file path.

## Step 6 — write the file

Once approved:
- **Filename:** `docs/plans/<date>-<slug>.md` (create `docs/plans/` if it doesn't exist). `<date>` is
  today's date, `YYYY-MM-DD`. `<slug>` is the plan's short title, lower-cased, spaces to hyphens,
  punctuation stripped. If that exact filename already exists and isn't the same plan being revised,
  append `-2`, `-3`, etc. rather than overwriting.
- Tell the user the path.

Then, as a **separate** question, ask whether they also want it committed — this is a handoff artifact
for another AI/reviewer, so it's fine to leave it as a local, uncommitted file if they're just going to
paste it elsewhere. If they do want it committed, commit it directly (docs-only, no code/rules change)
and ask which branch (default `preview`, matching `/add-roadmap-task`'s convention, unless told
otherwise). Pushing is a further, equally separate ask — don't assume commit implies push.

## Step 7 — handle returned review feedback

The user may come back later in the same conversation and paste in what a reviewer said. Expect this
loosely, not rigidly:
- **Format is not fixed.** It could be free prose, a bulleted list, a structured multi-section report, or
  something else entirely — read it for content, don't expect any particular shape.
- **There may be more than one response** (different reviewers, different AI tools, or the same reviewer
  asked twice). Don't assume a single paste is the whole picture: after the first one arrives, ask
  "any other review responses to add before I go through this, or is that everything?" and wait for an
  explicit answer before triaging. If more come in, ask again the same way until the user says that's all.
- **Capture each review's declared model.** Step 4's reviewer instructions ask every reviewer to open with
  its model + settings, so record which model produced which review as you read them (it may also be in the
  review's filename). This sharpens the agree/disagree analysis below — two *different* models agreeing is a
  stronger signal than the same model asked twice, and two near-identical reviews may just be one model run
  twice rather than independent confirmation — and it feeds the "Reviewers (models)" line in the Review
  outcome stub.
- Once you have everything, **triage, don't blindly apply**:
  - If multiple responses came in, note where they agree vs. disagree — agreement across independent
    reviewers is a stronger signal than a single opinion; disagreement is itself a finding worth surfacing,
    not something to silently resolve by picking one side.
  - Apply a finding directly (edit the plan or, if it's feedback on the skill itself, the skill file) only
    when it's low-risk and clearly correct against this repo's own stated conventions.
  - Stop and ask the user before acting on anything that: touches security/secrets, contradicts an
    existing `DECISIONS.md` entry, reflects reviewers disagreeing with each other, or is a change you're
    genuinely not confident about. Say specifically which finding and why you're pausing on it — don't
    make the user re-read the whole review to figure out what needs their call.
- Summarize what you applied, what you skipped (and why), and what's waiting on the user's decision.
- **Categorise each finding** as one of: accept / reject / defer / →test / →doc-note / →roadmap item — and
  treat every finding as a hypothesis to verify against the actual code, not an instruction (a cold reviewer
  with no repo access will sometimes be wrong precisely *because* it couldn't see the code).
- If the plan file was written to disk, fill in its **"Review outcome"** stub (which models reviewed,
  findings count, whether the review materially changed the plan, what it caught). This is the only tracking
  we keep — a few one-line entries across plans tell you whether the review loop is earning its keep or is
  theatre.

---

$ARGUMENTS
