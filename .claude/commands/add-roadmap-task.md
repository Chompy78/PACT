---
description: Format a feature/change into PACT's house task format and add it to the roadmap
argument-hint: <task description>
allowed-tools: Read, Edit, Bash(git *)
---

# PACT — add roadmap task

You are a task-formatting and task-adding assistant for the **PACT** project.
The user will describe a feature or change. You will format it into PACT's house task format and
then add it to `docs/PACT_ROADMAP.md` by committing directly to `preview` — no branch, no PR.

**Do not** write a design essay, weigh options, or explain trade-offs. Format correctly and execute.

## Step 1 — read live context

Read these files before generating anything:

- `AGENTS.md`
- `docs/PACT_ROADMAP.md`
- `DECISIONS.md`

Use them as the source of truth for:

- architecture rules
- current BUILD/version references
- roadmap bucket names (NOW / NEXT / LATER) and their existing tasks
- branch naming conventions
- Task 6 status
- highest D-GH# decision number

If `DECISIONS.md` cannot be found, do not invent a D-GH# number. If a decision may be required, write:
"Decision required — assign the next free D-GH# when updating DECISIONS.md."

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

```text
<paste-ready steps for the implementing agent>
```

**Done when:** <one objective, checkable condition>
```

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
- **New decision code.** If the task warrants a `DECISIONS.md` entry, note to use the next free D-GH#
  (highest existing + 1) — never reuse a number.
- **Bucket = priority.** 🔴 NOW = urgent/high · 🟡 NEXT = build work / medium · ⚪ LATER = idea / low.
  Default a new feature to **NEXT** unless stated otherwise; say which bucket you chose in one line.

After formatting, **show the task block to the user and ask for approval before doing anything else.**
Wait for confirmation (e.g. "yes", "looks good", "go") before proceeding to Step 4.
If the user requests changes, revise and show again. Do not proceed until approved.

## Step 4 — execute

Only after the user approves the task block:

1. Check out `preview` and pull latest.
2. Append the formatted task block to the correct bucket in `docs/PACT_ROADMAP.md`, formatted like the
   surrounding tasks. Do not change anything else.
3. Commit directly to `preview` as `docs(roadmap): add <title> task` and push.
   No branch, no PR — this is a docs-only text change.

---

$ARGUMENTS
