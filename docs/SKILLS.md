# PACT — skills & workflow (human-readable)

Plain-English guide to the custom **skills** (slash-commands) this project uses and how they chain into
the task lifecycle. The skill files themselves (`.claude/commands/*.md`) are written *for the agent to
execute* — dense and instructional. **This file is the human overview:** what each skill is for, when to
reach for it, and how they fit together.

> **Primary tool: Claude Code.** You run it in a terminal in the repo; it reads `AGENTS.md` automatically
> and works on tasks directly. **Microsoft 365 Copilot** plays exactly one role here — a *cold reviewer* of
> self-contained plans (see the review loop below). It is **not** repo-aware and never edits code.

Invoke a skill by typing `/<name>` (e.g. `/pick-code-task`). Skills are house workflows, not magic — each one is
just a scripted sequence Claude follows.

**Naming convention (2026-07-19):** every Claude Code command name carries `-code-`, to distinguish it at
a glance from the author's separate Claude.ai chat-side Skills (which carry `-chat-` instead, e.g.
`next-chat-task`, `close-chat`). All 8 of this project's commands were renamed to match:

| Old name | New name |
|---|---|
| `add-task` | `add-code-task` |
| `cleanup-branches` | `cleanup-code-branches` |
| `close-session` | `close-code-session` |
| `log-ai-lessons` | `log-code-lesson` |
| `pick-task` | `pick-code-task` |
| `plan-for-review` | `make-code-cold-plan-review` |
| `run-task` | `run-code-task` |
| `sweep-tasks` | `sweep-code-tasks` |

The old names still appear verbatim throughout `CHANGELOG.md`, `DECISIONS.md`, and `docs/sessions/` —
those are dated historical records of what a command was called *at the time*, deliberately left
unrewritten. This table is the map from any old name you find there to what it's called now.

---

## The task lifecycle at a glance

Most work follows this spine. Skills slot in at each step; not every step needs one.

| Step | What happens | Skill |
|---|---|---|
| 1. Capture | Park a new idea/bug/change on the task board, house format | `/add-code-task` |
| 2. Pick | Fetch live task-board state, choose the next task, pre-flight it (no edits yet) | `/pick-code-task` |
| 3. **Gate** | Decide: work alone, or plan-review first? (see rule below) | — |
| 3a. (Big/risky only) | Draft a self-contained plan → paste to M365 Copilot → triage critique | `/make-code-cold-plan-review` |
| 4. Do the work | Worktree, edit, run the parity gate, self-review, log, commit, PR | `/run-code-task` |
| 5. Review the diff | Adversarial pass over the change before merge | `/code-review` |
| 6. Wrap up | Writes the session's docs, graduates finished tasks, proposes a ready commit | `/close-code-session` |
| (Housekeeping) | Prune merged branches/worktrees; mine the session for reusable lessons | `/cleanup-code-branches`, `/log-code-lesson` |
| (Unattended batch) | Runs steps 2-5 in a loop over every task tagged Risk: low/medium (never high), no per-task confirmation, merging as it goes | `/sweep-code-tasks` |

**The gate rule (step 3):**

> Route through cold plan-review **only if a wrong approach would cost more than one implementation cycle
> to undo.** Trivial / single-file / mechanical work skips it and goes straight to `/run-code-task`.

---

## The cold-review loop (the one human-in-the-loop part)

For big or risky tasks (multi-file, engine/rules, tool-parity, ambiguous scope, or where a missing
test/criterion would cause rework):

1. **Claude drafts a self-contained plan** — `/make-code-cold-plan-review`. Everything the reviewer needs is baked
   into the text (goal, files, assumptions vs. verified facts, risks, acceptance criteria, verification),
   because the reviewer can't see the repo.
2. **You paste that plan into M365 Copilot** and ask it to critique *plan quality, not code* — hidden
   assumptions, missing risks, overcomplication, unclear "done." (The plan already tells Copilot it has no
   repo access.)
3. **You paste Copilot's critique back to Claude.** Claude triages each point — accept / reject / defer /
   →test / →doc-note / →task-board — treating every finding as a *hypothesis to verify against the real code*,
   not an order. It stops and asks you on anything touching security or where reviewers disagree.
4. **Then `/run-code-task`** builds the sharpened plan.

Why it works: the code-aware tool (Claude) does the thinking and bakes it into the plan, so Copilot's lack
of repo/code awareness stops mattering — it's reviewing the *writing*. Value is **avoided rework**, not
saved tokens. Claude is always the final authority.

**Also fine to send Copilot:** pure prose jobs — changelog wording, making a decision-history entry
clearer, plain-English explanations. **Never send:** secrets/keys, or anything where you'd trust its answer
*about the code* as ground truth.

---

## Skill reference

- **`/add-code-task`** — Formats a feature/change/bug into PACT's house task format and adds it to
  `docs/TASK_BOARD.md`. Use it to capture work without derailing what you're doing. (The task board has a
  single writer — `/add-code-task` and `/sweep-code-tasks` are the only two things allowed to commit to it
  directly; everything else outputs the formatted task for you to fold in.) Every task gets an
  **Effort** tag (`low`/`medium`/`high`, informational) and a **Risk** tag — scored from three named
  factors (ambiguity, damage scale, damage likelihood), worst-of combined — that `/sweep-code-tasks` uses as
  its sole safety gate. Any cross-tool or architectural-migration task is always rated high on
  ambiguity (and so lands at `Risk: high`), even when a specific existing pattern exists to copy —
  don't round that down just because the copy step itself looks mechanical.

- **`/pick-code-task`** — Fetches live task-board state, picks the next task, and pre-flights it (reads what's
  needed, flags whether a specialist agent or higher effort would help). **Read-only — no editing, no
  worktree.** This is step 1 of the two-step work pattern.

- **`/make-code-cold-plan-review`** — Turns a task/idea into a **self-contained** markdown plan formatted for a cold
  reviewer (M365 Copilot, another AI, or a human) with no shared context. Opens with the gate rule and
  skips trivial work. It never implements anything — it's a drafting aid. See the review loop above.

- **`/run-code-task`** — Does the actual work for a picked task: creates an isolated worktree (branched off
  `preview`), edits, runs the engine-parity gate, self-reviews, updates the logs, and opens a PR. Step 2 of
  the work pattern. (Requires Claude Code v2.1.50+.)

- **`/code-review`** — Reviews the current diff for correctness bugs and cleanups before merge, at a
  tier you name (`low`/`medium`/`high`/`ultra`) or that `/sweep-code-tasks` picks for you based on a task's
  Risk. `/code-review ultra` normally runs a deeper multi-agent cloud review, but silently falls back to
  a local max-effort pass if cloud review isn't available in the current environment (e.g. this remote
  session) — check the skill's own output for which one actually ran.

- **`/close-code-session`** — Wrap-up that **writes** the session's `CHANGELOG`/`DECISIONS`/session-note,
  graduates finished tasks out of `TASK_BOARD.md`, verifies tests/tree/worktrees/sync, then **proposes a
  ready-to-run commit** for you to review. It never stages, commits, pushes, merges, or deletes — every
  side-effect past the doc-writes waits for your explicit go.

- **`/cleanup-code-branches`** — Scans for merged/orphaned branches and worktrees and deletes only what you
  approve. Housekeeping between tasks.

- **`/sweep-code-tasks`** — The unattended version of steps 2-5: loops over every task-board task tagged
  `Risk: low` or `Risk: medium` (`Risk: high` is an absolute veto, no exception, regardless of
  Effort — Effort doesn't gate eligibility at all, only ordering/review-tier sizing), running each
  through `/run-code-task` → `/code-review` (tier scaled to Risk, not just file path) → merge with no
  per-task confirmation. A diff-size sanity check flags tasks whose real diff outgrew their tag; a
  consecutive-failure circuit breaker halts the whole sweep after 2 failures in a row rather than
  grinding through a systemic problem; anything above `Risk: low` requires real (not just
  parity-gate) verification before merging. Adds any newly-surfaced task it discovers to the board in
  `/add-code-task`'s format (skipping that skill's normal approval-wait, since this skill is unattended by
  design) and folds it into the same run if it also clears the bar. Asks once, up front, how many
  tasks to attempt (a bare number — free text with a number embedded in it, like a version reference,
  doesn't count); if a queued task gets dropped or parked partway through, the next eligible task
  backfills that slot so the run still aims for the number you asked for, not fewer. Everything after
  that first prompt runs hands-off. Logs every run — attempted, not just shipped — to
  `docs/sweep-log.md`. Never promotes `preview` → `main` — that stays a separate, explicit call.

- **`/log-code-lesson`** — Mines a session/file for *generalizable* AI-coding lessons (not project-specific
  fixes) and drafts entries for the cross-project `ai-lessons-learned` log.

---

## Where the process rules live (so this doc stays a summary, not a second source of truth)

- **`AGENTS.md`** — the standing instructions Claude reads every session (architecture, hard rules, the
  Agent-guidance rubric that says *when* to reach for cold review, and the current Active Priorities).
- **`docs/HOW-TO-WORK.md`** — how to run/preview the app, the parity gate, fixtures, the per-task loop.
- **`docs/TASK_BOARD.md`** — the open task list. · **`CHANGELOG.md`** / **`DECISIONS.md`** — what / why.
- **`docs/sweep-log.md`** — what `/sweep-code-tasks` attempted each run, not just what shipped.
- The individual `.claude/commands/*.md` files — the exact steps each skill executes.
