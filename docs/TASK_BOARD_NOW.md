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

## Random roller: two build shapes it still cannot produce — TODO
Branch `feat/roller-build-shapes-2`. Follow-on from the Grit and Hit-Dice fixes closed in #525. Evidence is
**3,264 characters rolled through `testing/scripts/roll-headless.mjs`** — the real tool in a real browser,
eight themes across thirty-four AP rungs — compared against **six real player sheets** at 75-98 AP. Both
faults are the same kind: the roller produces characters that are **legal but not what a player would
build**, and both are places where the rolled spread still fails to cover a real party.

**1. The attack floor — no roll can come out below +4 to hit.** Steps 2 and 2c of `randomizeRoll()`
unconditionally prime the casting stat to 14 and the primary favoured ability to 16 before anything else is
bought, so with prof +2 the minimum attack is +4. Measured across 96 rolls at 85 AP: **minimum +4, and only
9 rolls even reach it.** The real party contains a wizard at **+3**, which the roller cannot produce at any
budget. **Real players leave a stat mediocre; the roller cannot.** This is now the ONLY axis on which the
rolled spread fails to bracket the real party — hit points, AC, attack count and spell slots all bracket it
since #525. Loosening the priming has a wide blast radius (caster slot caps key off the casting stat), which
is why it was left alone during the Hit-Dice work rather than bundled into it.

**2. Half of all rolls wear nothing, and cannot fix it with money.** At 85 AP, **46 of 96 rolls have AC
exactly 10 + DEX**. Of those 46, **one has light armour proficiency and none has shield proficiency** — so a
25 GP armour allowance and a 25 GP shield allowance between them buy two characters a single point of AC.
Armour and shield proficiency come out of the `kit` bucket and compete with weapons, Vigor and Grit; when the
bucket does not buy them, the character is unarmoured **and untrainable**. Concentrated by theme: `face` 9,
`zealot` 7, `battlecaster` 6, `scholar` 6, `trickster` 6, against `bruiser` 3. A character with no armour
proficiency at all is an odd thing to produce at 85 AP, and it happens about half the time.

**Worth a deliberate look while in here: silent fallback instead of a loud failure has now appeared twice in
this tool chain.** The level-9 `_lvlCap` fallback fixed in #525 built a plausible-but-wrong character rather
than failing; and the campaign's own `gen_random_spread.mjs` silently ignored `--budgets`, so a run asking
for one rung rolled all thirty-four and the caller compared an empty bin (fixed campaign-side 2026-09-07).
Two instances suggests looking for a third rather than waiting for it.

**Not faults, but worth recording since a single-theme pool hides both:** theme matters more than anything
else measured — at 85 AP a `bruiser` runs 8-31 hit points against a `scholar`'s 6-18, nearly twice apart at
the same budget. And `bruiser` and `zealot` carry the **lowest** median Hit Dice while holding the most hit
points, buying survivability through armour and Grit instead.

**Done when:** a rolled character can come out below +4 to hit where the build justifies it; a character that
buys no armour proficiency is either rare or a deliberate theme choice; and
`testing/scripts/random-quality-ci.mjs` still passes its legality, level-tracking, coherence, theme and
diversity gates. Evidence and the comparison harness live in the campaign repo at
`cm-pact-campaign/analysis/2026-09-07-real-party/` — `adapt_headless.mjs` reshapes roll-headless output into
the row form that analysis reads, and reshapes only.

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

> **Measured 2026-09-03 from a cloud session — partial answer, and it reframes step 3.** In this
> container the skills live at `~/.claude/skills/synced/<uuid>/`, and **`close-session-logging-core.md` is
> not there at all.** Every `-jc` skill folder holds only `SKILL.md`. That is not the sync dropping
> siblings: Anthropic-authored skills in the *same* tree do carry theirs — `pdf/` has `FORMS.md` +
> `REFERENCE.md`, `skill-creator/` has `references/`, `docx`/`pptx`/`xlsx` have `scripts/`. So the
> mechanism transports sibling files fine, and this one is absent from whatever source feeds that tree.
>
> **Consequence, which is worse than the provenance question:** `close-code-session-jc` and
> `close-chat-jc` both delegate four documented procedures to that file — DECISIONS format detection,
> task-board graduation, cold-review relocation, and the session-name suggestion. For any session running
> off the synced skills, those four procedures point at nothing. Hit live while running
> `/close-code-session-jc` on 2026-09-03; the close was completed by judgement instead.
>
> **What this does NOT answer.** `~/.claude/skills/synced/<uuid>/` (cloud) and
> `C:\Users\user\.claude\skills\` (Windows) may be different distribution channels — nothing here
> shows they share a source. Step 1 still needs a local session, and step 3's "confirm the patch is still
> present in the local file" is untouched by this: the Windows copy was not inspected. Steps 2, 4 and 5
> stand as written.
>
> Worth folding into step 2's AGENTS.md note either way: a `-jc` skill's sibling files do not reach a
> cloud session, so any procedure a skill delegates to one is unavailable there by construction.

**Done when:** AGENTS.md records what writes `~/.claude/skills/` and whether that sync is one-way, the
local `close-session-logging-core.md` is confirmed to carry all four patched clauses (or has been
re-applied), the stale `gh` path in AGENTS.md's Shell environment notes is corrected, and the
sibling-file gap above is either fixed at the source or recorded as a known limitation of cloud sessions.

---

# Conventions
- One task per branch/commit; re-open `engine-parity.html` after each.
- Keep `js/engine.js` off-limits unless a task targets it.
- When a task here is done, move it to `CHANGELOG.md` — don't leave DONE items here.

