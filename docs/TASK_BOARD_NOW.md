# PACT — Task Board

> Written for agentic assistants (VS Code Copilot & Claude Code). With `AGENTS.md` committed, you don't
> repeat project context — **paste one task at a time**, review the diff, accept. Each task ends with a
> **Done when** check.
>
> **Rules for this file** (see `AGENTS.md`):
> 1. Holds only **open / planned** work. When a task is DONE, **move it into `CHANGELOG.md`** in the same change.
> 2. **Single writer.** Agents: *output* new items in this format for the human to fold in — don't append directly.
> 3. One task per branch. The open git branch is the "in flight" signal.
>
> **`REV-NN` items** come from the 2026-06-29 code review. Full evidence, code, and acceptance criteria
> live in **`docs/PACT-Code-Review-2026-06-29.md`** — commit that file alongside this task board so the
> pointers resolve. Findings are filed by severity: HIGH → Now, MEDIUM → Next, LOW → Later.

Completed work (PWA shell, auth, cloud sync, campaigns, hardening, landing-page redesign, PHB data,
**REV-01** regression gate, **REV-02** SW same-origin cache fix, **REV-03** SW network-first,
**CU-1** agent docs, **CU-2** version sync, **CU-3** repo tidy, **CU-6** DM Console rename, **CU-4** branch
prune, PWA stale-version reload-prompt fix, Live Sheet mobile density/collapse) has landed and graduated
to `CHANGELOG.md`.

---

> **Format note (2026-07-28):** split from a single `docs/TASK_BOARD.md` into `TASK_BOARD_NOW.md`/`_NEXT.md`/`_LATER.md` by the existing NOW/NEXT/LATER bands — see `decisions/2026/D-GH-2026-07-28-decisions-changelog-task-board-split.md`. Same rules apply to all three files.

---

# 🔴 NOW — high-severity fixes + cleanup

## Find where `~/.claude/skills/` syncs from, and confirm the close-session patch survived — TODO
Branch `docs/skills-sync-provenance`. `close-session-logging-core.md` — shared by `close-code-session-jc`
and `close-chat-jc`, so it governs every session close in this project — was patched on 2026-08-30 to fix
three faults that between them nearly lost four cold reviews: it checked `z-cold/processed/` but never
`z-cold/` root, relocation ran as a copy rather than a move, and it could not see a `z-cold/` that lives
on a branch instead of the working tree (see `D-GH-2026-08-30-archive-hd-gate-cold-reviews`).

**That patch exists on this machine only.** `~/.claude/skills/` is not a git repo, and `ai-templates` — the
upstream those skills come from — is not checked out here (only PACT is under `Documents/GitHub/`). So
nothing in this repo can tell whether the next sync preserves the fix or silently reverts it, and a revert
is invisible: the symptom is a close-session run reporting "clean" while sitting on unfiled reviews, which
is exactly how the original loss went unnoticed for weeks.
**Effort:** small · **Risk:** low — read-only investigation plus a written note; nothing here edits the
engine, the tools, or another project. Ambiguity is the highest of the three factors (we genuinely do not
know what writes that directory) but it is bounded by the task being to *find out and record*, not to
change anything. Sweep-eligible.

```text
1. Identify what writes C:\Users\user\.claude\skills\. Candidates worth checking in order: a scheduled
   task or script on this machine; the home-server MCP connector (the same route pact-guide uses); a
   manual copy the owner performs. Do NOT edit ai-templates from a PACT session — see AGENTS.md's
   "Technical Access ≠ Scope" and AI_templates' D-2026-07-28-technical-access-not-scope.
2. Write the answer down where a future session will find it — a short "where skills come from" note in
   AGENTS.md's Shell environment section is the natural home, since that is already where machine-specific
   facts (the gh path) live. One or two sentences; this is provenance, not a procedure.
3. Confirm the patch is still present in the local file: it is the "Cold-review processed-file relocation"
   section, and it should contain all four of "z-cold/ ROOT as well as", "MOVE, not a copy", "may not be in
   the working tree", and "content hash, not filename".
4. If it has reverted, re-apply it AND note in the same AGENTS.md line that the sync is one-way downward,
   so the next person knows a local edit there is temporary by nature.
5. While in AGENTS.md: its "Shell environment notes" currently gives the gh CLI path as a WinGet directory
   under a JohnChow user profile. That path does not resolve on this machine — gh is at
   /c/Program Files/GitHub CLI/gh. Correct it in the same commit; it is the same class of stale
   machine-fact and was hit repeatedly on 2026-09-01.
```

**Done when:** AGENTS.md records what writes `~/.claude/skills/` and whether that sync is one-way, the
local `close-session-logging-core.md` is confirmed to carry all four patched clauses (or has been
re-applied), and the stale `gh` path in AGENTS.md's Shell environment notes is corrected.

## `file://` no longer works in any tool — and all three still claim it must — TODO
Branch `fix/file-protocol-support-or-drop-the-claim`. **Found on 2026-09-02 while disproving a wrong task**
(see the correction note below). Measured in headless Chromium, opening each tool directly off disk:

| tool | engine loaded | `DATA.version` |
|---|---|---|
| CharGen | **no** | `null` |
| Live Sheet | **no** | `null` |
| DM Console | **no** | `null` |

Browsers block ES modules over `file://`, so the `engine-ready` bridge introduced by D-GH26 never runs,
`window.DATA` never exists, and the tool is not merely degraded — it is non-functional. Every version
label falls back to its hardcoded literal, which is the visible symptom that led here.

Each tool's own header still lists this under **HARD CONSTRAINTS (do not break)**: *"Must run by opening
the file directly (file://)"*. That constraint has silently not held since the safe-subset migration.
`AGENTS.md`'s working discipline says the shipped artifact wins over the written guide — so either the
claim goes, or the capability comes back.
**Effort:** medium · **Risk:** medium — ambiguity is the whole of it: this is a product decision before
it is a code one, and the two answers lead to completely different work. **NOT sweep-eligible.**

```text
0. OWNER DECISION FIRST — is opening a tool straight off disk still a supported use?
   It is a real scenario for this project: a player handed a .html file, no server, no network. But it
   has been broken since D-GH26 and nobody reported it, which is itself evidence about how much it is
   used. Record the answer as a decision either way.
1a. IF IT MUST WORK: the engine has to reach the tools without ES modules. An inline/classic-script
    build step is the obvious route and is BARRED by AGENTS.md ("no build step"), so this needs its own
    decision, not an implementation. Do not start here without one.
1b. IF IT MAY GO: delete the claim from all three tools' HARD CONSTRAINTS blocks and say plainly what
    replaces it (served over http, i.e. GitHub Pages or the local dev server) — leaving a false
    "do not break" line is worse than having no line, because the next agent will defend it.
2. Either way, note it in docs/HOW-TO-WORK.md next to the dev-server instructions, since that is where
   someone looks when the file they double-clicked does nothing.
```

**Done when:** the owner's answer is recorded as a decision, and either `file://` genuinely works in all
three tools (verified by loading each off disk and confirming `window.DATA` is present), or the HARD
CONSTRAINTS line is gone from all three with its replacement stated.

---

# Conventions
- One task per branch/commit; re-open `engine-parity.html` after each.
- Keep `js/engine.js` off-limits unless a task targets it.
- When a task here is done, move it to `CHANGELOG.md` — don't leave DONE items here.

