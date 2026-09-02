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

## CharGen displays a rules version 25 releases stale — `v0.339` against a live `v0.364` — TODO
Branch `fix/chargen-stale-rules-label`. Noticed during the v1.499 promotion, while confirming the build
sync had touched no rules string. CharGen hardcodes the rules version in **two places a player actually
sees**:
- `<title>PACT Character Generator — Web Tool v1.499 · Rules v0.339</title>`
- the header chip: `<span id="cgPactver" class="hd-pactver">PACT rules · v0.339</span>`

`DATA.version` has been `v0.364` since D-GH-2026-08-31 (the creation-ceiling mechanics change). So the tool
has been telling players it runs a rules set it has not run for twenty-five versions. `index.html` already
solves exactly this problem for the BUILD number by reading `BUILD` live and never being hand-edited —
`docs/VERSION-SYNC.md` calls that out as the reason it "can never drift". The rules label should work the
same way.

**Deliberately NOT fixed during the promotion that found it:** `docs/VERSION-SYNC.md` step 3 says a
promotion touches the BUILD labels and nothing else, and the rules axis is bumped only when mechanics
change. Widening a release commit to carry a display fix is how the two axes get conflated, which that
document exists to prevent.
**Effort:** small · **Risk:** low — display-only, no rules logic, no `DATA.version` bump (editing a display
label is a docs-class change per AGENTS.md). Ambiguity is the only real factor: decide once whether the
other stale `v0.3xx` strings in all three tools are displayed or merely historical comments.

```text
1. Make CharGen read the rules version LIVE from the engine, the way index.html reads BUILD — the engine
   is already bridged into the tool (DATA is on window after engine-ready), so this is a render-time
   assignment, not new plumbing. The <title> needs setting in JS since it cannot template itself.
2. Audit the other hardcoded v0.3xx strings before assuming they are all bugs:
     Live Sheet  — v0.303, v0.309, v0.314, v0.322, v0.339
     DM Console  — v0.351, v0.356
   Most are probably historical notes in comments/changelog blocks, which SHOULD stay pinned. Only the
   ones rendered to a user are in scope; say in the PR which were which.
3. Add a check to an existing gate asserting no DISPLAYED rules string disagrees with DATA.version, so
   this cannot silently rot again. That guard is the durable half of the task — the label fix alone just
   resets the clock.
```

**Done when:** CharGen's title and header chip show `DATA.version`'s live value, every other hardcoded
`v0.3xx` in the three tools is either fixed or documented as a deliberate historical reference, and a gate
fails if a displayed rules version drifts from `DATA.version` again.

## `sql/rls-policies.sql` never received any of the session-seal work — a fresh install has no seal, and re-running it reverts one — TODO
Branch `fix/rls-policies-seal-backport`. `sql/rls-policies.sql` is this repo's maintained, declared-
re-runnable baseline ("Apply AFTER schema.sql. Safe to re-run"). Every prior migration in this family was
back-ported into it — 2026-08-10 and 2026-08-22 both were. The session-seal work (2026-09-01, PR #492) was
**not**, and neither was the 2026-09-02 restore. So the baseline currently:
- still defines the **pre-seal** `pact_ap_ledger_protected` (no `sessionSeal`, no `payload.v`) and
  `pact_enforce_locked_history` (campaign-only, award-only);
- defines **neither** `seal_character_history` nor `award_ap_and_seal` at all;
- **re-grants** the EXECUTE on both trigger functions that
  `sql/migrations/2026-09-01-revoke-trigger-function-execute.sql` revokes — while that migration's own
  header claims it exists so the live grant state "would be reproducible from `sql/` alone."

**Effort:** small–medium · **Risk:** medium — ambiguity is low (the live definitions are readable from
`pg_proc`), but damage scale is high: this file is what a rebuild applies, and the failure is silent in both
directions. **NOT sweep-eligible** — it touches the security boundary.

```text
1. Read the LIVE definitions back from the database, not from the migration files:
     select proname, pg_get_functiondef(oid) from pg_proc
      where proname in ('dm_edit_character_log','award_ap_and_seal','seal_character_history',
                        'pact_ap_ledger_protected','pact_enforce_locked_history');
   This is the whole point of the task. Rebuilding from a dated migration is what caused
   D-GH-2026-09-02-session-seal-stale-base in the first place.
2. Update rls-policies.sql to match live, exactly: the amended trigger pair, both seal RPCs, and the
   REVOKE (not the GRANT) on pact_enforce_locked_history / pact_ap_ledger_protected.
3. Then prove it: apply schema.sql + rls-policies.sql to a scratch database and diff the resulting
   pg_proc bodies and pg_proc.proacl against production. A visual read of the file is NOT the check —
   the bug this task fixes was invisible to exactly that.
4. While there: add a note at the top of the migrations directory saying dated migration files are
   historical records and the baseline is rls-policies.sql. Two production regressions in two days came
   from reading a dated file as current.
```

**Done when:** a database built from `schema.sql` + `rls-policies.sql` alone has function bodies and
EXECUTE grants matching production for all five functions above (verified by diff, not by eye), placing a
seal works on that fresh database, and re-running `rls-policies.sql` against production leaves
`pact_enforce_locked_history` amended and the trigger-function EXECUTE still revoked.

---

# Conventions
- One task per branch/commit; re-open `engine-parity.html` after each.
- Keep `js/engine.js` off-limits unless a task targets it.
- When a task here is done, move it to `CHANGELOG.md` — don't leave DONE items here.

