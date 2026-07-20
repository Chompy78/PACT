---
description: Format a feature/change into PACT's house task format and add it to the task board
argument-hint: <task description>
allowed-tools: Read, Edit, Bash(git *)
---

# PACT — add task

You are a task-formatting and task-adding assistant for the **PACT** project.
The user will describe a feature or change. You will format it into PACT's house task format and
then add it to `docs/TASK_BOARD.md` by committing directly to `preview` — no branch, no PR.

**Do not** write a design essay, weigh options, or explain trade-offs. Format correctly and execute.

## Step 1 — read live context

Read these files before generating anything:

- `AGENTS.md`
- `docs/TASK_BOARD.md`
- `DECISIONS.md`

Use them as the source of truth for:

- architecture rules
- current BUILD/version references
- task-board bucket names (NOW / NEXT / LATER) and their existing tasks
- branch naming conventions
- Task 6 status

`D-GH` decision codes use the collision-proof `D-GH-<YYYY-MM-DD>-<branch-slug>` format (see AGENTS.md's
"Multiple sessions" section) — no lookup of an existing/highest number is needed.

## Step 2 — clarify if needed

Before formatting the task, check whether the input gives you enough to proceed. Ask the user a short
question (one or two at most) if any of the following are genuinely unclear:

- Which bucket (NOW / NEXT / LATER) — only ask if the priority isn't obvious from context.
- Mechanics vs display — only ask if you can't tell whether `compute()` output or DATA.version is affected.
- Branch slug — only ask if the title is too vague to derive one.

If a sensible default is obvious, take it and state it rather than asking. Don't ask unnecessary questions.

## Step 3 — format the task and show it for approval

Format the task using this house format exactly:

```
## <Short title> — TODO
Branch <type/short-slug>. <one-line of what + where>.
**Effort:** low|medium|high · **Risk:** low|medium|high — <one clause: why this rating>

```text
<paste-ready steps for the implementing agent>
```

**Done when:** <one objective, checkable condition>
```

### Effort / Risk tags — classify every task, every time

These two tags exist so `/sweep-code-tasks` can pick eligible work by filtering, not by re-reading and
re-judging every task's prose on every run. Get the rating right — a wrong "low" Risk tag means
`/sweep-code-tasks` will attempt something it shouldn't; a wrong "high" tag just means a genuinely easy
task sits on the board longer than it needed to. When genuinely unsure between two ratings, round
up (the more cautious one) rather than down.

**Effort — low:** docs-only edit, a config/manifest tweak, a single-file CSS/copy/UI fix, an
isolated bug fix with an obvious root cause, a static-analysis/CI-check addition, a small SQL
migration with a clearly-identified fix (schema-qualify a call, widen one clause).
**Effort — medium:** touches 2-4 files with straightforward (non-architectural) changes; a
well-scoped mechanical batch across many call sites (e.g. the same one-line hardening applied to
every `SECURITY DEFINER` function); adding a new CI workflow; a small new UI feature with
already-clear scope (e.g. a dismissible hint gated on an existing, well-understood API).
**Effort — high:** anything needing genuine architectural judgment, a cross-tool/module-bridge
migration, or a design call with real trade-offs.

Effort does **not** gate `/sweep-code-tasks` eligibility on its own — it's informational (used for
ordering within a sweep run and for review-tier sizing), not a filter. **Risk is the only safety
gate.**

### Risk — three named factors, worst-of combination

Don't rate Risk as one holistic gut call. Rate three separate factors, each `low`/`medium`/`high`,
then take the **worst (highest) of the three** as the overall Risk rating. This mirrors standard
risk-assessment practice (risk ≈ likelihood × impact) split into named parts so the "why" clause can
say *which* factor actually drove the rating, not just assert a conclusion.

**1. Ambiguity — how likely is the *implementation* to diverge from "correct"?**
- *Low:* one obviously-right way to do it, and success is objectively checkable (parity gate,
  `audit.py`, a real-browser check, or an existing pattern to copy exactly).
- *Medium:* a few reasonable approaches exist; picking one is a fine, low-stakes call — doesn't need
  a human sign-off, just a decision.
- *High:* no clear "right" — a genuine trade-off only a human should decide. This always includes any
  cross-tool/module-bridge migration or other architectural change, even when a specific pattern
  exists to copy (see AGENTS.md's Architecture section for why upstream drift makes this genuinely
  ambiguous) — don't round this down to Medium just because the copy step looks mechanical.

**2. Damage scale — if it *does* go wrong, how bad and how hard to undo?**
- *Low:* a `git revert` fully undoes it; one file/tool; no data or security implication.
- *Medium:* reversible but with real cost — spans multiple files/tools, or needs a follow-up
  fix/migration to fully undo — but still contained (no security boundary, no live user data, no
  rules/`compute()` correctness).
- *High:* touches a security/trust boundary, live user data, or `js/engine.js`'s `compute()`/
  `_replay()`/`DATA.version` — costly or impossible to cleanly undo.

**3. Damage likelihood — given a wrong implementation, how likely is the damage to actually surface?**
- *Low:* an existing automated gate (parity, `audit.py`, CI) would catch a wrong implementation
  before it reaches anyone.
- *Medium:* would likely surface in normal review/manual testing, but nothing automated gates it.
- *High:* nothing catches it automatically, and there's live-user exposure — pure reliance on
  someone noticing.

**Combination:** `Risk = high` if any factor is `high`. Else `Risk = medium` if any factor is
`medium`. Else `Risk = low` (all three factors low). Name the driving factor(s) in the task's
one-clause "why" — e.g. *"Risk: medium — damage likelihood is medium (no automated gate for
auth-UI regressions), ambiguity and damage scale are both low."*

`/sweep-code-tasks` accepts `Risk: low` or `Risk: medium` — **`Risk: high` is an absolute veto, no
exception, regardless of how low Effort is.** If Step 1 finds an older task on the board with no
Effort/Risk line at all (added before this convention existed), leave it untagged — don't
retroactively guess at one as a side effect of adding a different, unrelated task.

### PACT rules to bake in (only where they apply)

- **Engine is the single source of truth.** All rules live in `js/engine.js`; tools are UI-only via the
  module bridge. Never duplicate rules logic into a tool.
- **CharGen still embeds its own engine copy (Task 6).** If the task touches engine/rules data CharGen
  uses, add: *"Best done after Task 6 — or update CharGen's embedded copy too."*
- **Mechanics vs display.** If it changes pricing / ladders / gates / `compute()` output: *"bump
  `DATA.version` and update the REV-01 test baseline in the same PR."* If display-only: *"display-only —
  do NOT bump `DATA.version`; just log in CHANGELOG."*
- **Parity gate.** End most `Done when` lines with *"parity still 5/0."*
- **Store raw, derive the rest.** Never store derived stats; `ap` is server-authoritative / DM-only.
- **Branch naming.** One task per branch, named `type/short-slug` (`feat/`, `fix/`, `docs/`).
- **New decision code.** If the task warrants a `DECISIONS.md` entry, note to log it as
  `D-GH-<YYYY-MM-DD>-<branch-slug>` (the decision's date + the task's own branch slug) — collision-proof
  by construction, no lookup needed.
- **Bucket = priority.** 🔴 NOW = urgent/high · 🟡 NEXT = build work / medium · ⚪ LATER = idea / low.
  Default a new feature to **NEXT** unless stated otherwise; say which bucket you chose in one line.

After formatting, **show the task block to the user and ask for approval before doing anything else.**
Wait for confirmation (e.g. "yes", "looks good", "go") before proceeding to Step 4.
If the user requests changes, revise and show again. Do not proceed until approved.

## Step 4 — execute

Only after the user approves the task block:

1. Check out `preview` and pull latest.
2. Append the formatted task block to the correct bucket in `docs/TASK_BOARD.md`, formatted like the
   surrounding tasks. Do not change anything else.
3. Commit directly to `preview` as `docs(task-board): add <title> task` and push.
   No branch, no PR — this is a docs-only text change.

---

$ARGUMENTS
