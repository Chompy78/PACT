# PACT — skills & workflow (human-readable)

Plain-English guide to the custom **skills** (slash-commands) this project uses and how they chain into
the task lifecycle. The skill files themselves (`.claude/commands/*.md`) are written *for the agent to
execute* — dense and instructional. **This file is the human overview:** what each skill is for, when to
reach for it, and how they fit together.

> **Primary tool: Claude Code.** You run it in a terminal in the repo; it reads `AGENTS.md` automatically
> and works on tasks directly. **Microsoft 365 Copilot** plays exactly one role here — a *cold reviewer* of
> self-contained plans (see the review loop below). It is **not** repo-aware and never edits code.

Invoke a skill by typing `/<name>` (e.g. `/pick-task`). Skills are house workflows, not magic — each one is
just a scripted sequence Claude follows.

---

## The task lifecycle at a glance

Most work follows this spine. Skills slot in at each step; not every step needs one.

| Step | What happens | Skill |
|---|---|---|
| 1. Capture | Park a new idea/bug/change in the roadmap, house format | `/add-roadmap-task` |
| 2. Pick | Fetch live roadmap, choose the next task, pre-flight it (no edits yet) | `/pick-task` |
| 3. **Gate** | Decide: work alone, or plan-review first? (see rule below) | — |
| 3a. (Big/risky only) | Draft a self-contained plan → paste to M365 Copilot → triage critique | `/plan-for-review` |
| 4. Do the work | Worktree, edit, run the parity gate, self-review, log, commit, PR | `/run-task` |
| 5. Review the diff | Adversarial pass over the change before merge | `/code-review` |
| 6. Wrap up | Report-only check: docs, tests, tree, worktrees, sync | `/close-session` |
| (Housekeeping) | Prune merged branches/worktrees; mine the session for reusable lessons | `/cleanup-branches`, `/log-ai-lessons` |

**The gate rule (step 3):**

> Route through cold plan-review **only if a wrong approach would cost more than one implementation cycle
> to undo.** Trivial / single-file / mechanical work skips it and goes straight to `/run-task`.

---

## The cold-review loop (the one human-in-the-loop part)

For big or risky tasks (multi-file, engine/rules, tool-parity, ambiguous scope, or where a missing
test/criterion would cause rework):

1. **Claude drafts a self-contained plan** — `/plan-for-review`. Everything the reviewer needs is baked
   into the text (goal, files, assumptions vs. verified facts, risks, acceptance criteria, verification),
   because the reviewer can't see the repo.
2. **You paste that plan into M365 Copilot** and ask it to critique *plan quality, not code* — hidden
   assumptions, missing risks, overcomplication, unclear "done." (The plan already tells Copilot it has no
   repo access.)
3. **You paste Copilot's critique back to Claude.** Claude triages each point — accept / reject / defer /
   →test / →doc-note / →roadmap — treating every finding as a *hypothesis to verify against the real code*,
   not an order. It stops and asks you on anything touching security or where reviewers disagree.
4. **Then `/run-task`** builds the sharpened plan.

Why it works: the code-aware tool (Claude) does the thinking and bakes it into the plan, so Copilot's lack
of repo/code awareness stops mattering — it's reviewing the *writing*. Value is **avoided rework**, not
saved tokens. Claude is always the final authority.

**Also fine to send Copilot:** pure prose jobs — changelog wording, making a decision-history entry
clearer, plain-English explanations. **Never send:** secrets/keys, or anything where you'd trust its answer
*about the code* as ground truth.

---

## Skill reference

- **`/add-roadmap-task`** — Formats a feature/change/bug into PACT's house task format and adds it to
  `docs/PACT_ROADMAP.md`. Use it to capture work without derailing what you're doing. (The roadmap has a
  single writer; this is the sanctioned way to add.)

- **`/pick-task`** — Fetches live roadmap state, picks the next task, and pre-flights it (reads what's
  needed, flags whether a specialist agent or higher effort would help). **Read-only — no editing, no
  worktree.** This is step 1 of the two-step work pattern.

- **`/plan-for-review`** — Turns a task/idea into a **self-contained** markdown plan formatted for a cold
  reviewer (M365 Copilot, another AI, or a human) with no shared context. Opens with the gate rule and
  skips trivial work. It never implements anything — it's a drafting aid. See the review loop above.

- **`/run-task`** — Does the actual work for a picked task: creates an isolated worktree (branched off
  `preview`), edits, runs the engine-parity gate, self-reviews, updates the logs, and opens a PR. Step 2 of
  the work pattern. (Requires Claude Code v2.1.50+.)

- **`/code-review`** — Reviews the current diff for correctness bugs and cleanups before merge.
  `/code-review ultra` runs a deeper multi-agent cloud review (billed; you trigger it, not the agent).

- **`/close-session`** — A **report-only** wrap-up check: are docs updated, tests passing, working tree
  clean, worktrees tidied, everything synced? It tells you what's outstanding; it doesn't change anything.

- **`/cleanup-branches`** — Scans for merged/orphaned branches and worktrees and deletes only what you
  approve. Housekeeping between tasks.

- **`/log-ai-lessons`** — Mines a session/file for *generalizable* AI-coding lessons (not project-specific
  fixes) and drafts entries for the cross-project `ai-lessons-learned` log.

---

## Where the process rules live (so this doc stays a summary, not a second source of truth)

- **`AGENTS.md`** — the standing instructions Claude reads every session (architecture, hard rules, the
  Agent-guidance rubric that says *when* to reach for cold review, and the current Active Priorities).
- **`docs/HOW-TO-WORK.md`** — how to run/preview the app, the parity gate, fixtures, the per-task loop.
- **`docs/PACT_ROADMAP.md`** — the open task list. · **`CHANGELOG.md`** / **`DECISIONS.md`** — what / why.
- The individual `.claude/commands/*.md` files — the exact steps each skill executes.
