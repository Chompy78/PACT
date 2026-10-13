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

## Creation-lock integrity — server guard, stale-copy bug, Amble repair — TODO
```
Continue the creation-lock work handed over on 2026-10-04. Read
docs/sessions/2026-10-04-creation-lock-restart.md FIRST — it holds the live state, every owner decision
(do not re-ask them), and the work order. In short: (1) re-check the six Amble characters are still
locked and re-lock any that are not; ask the owner for their verdict on the six "lock check (DM copy)"
characters; (2) settle decision T (recommended: test on a Supabase branch); (3) test, then apply
sql/migrations/2026-10-04-creation-lock-guard.sql (server guard D1 + L1 campaign moves + S1 backup
retention) with owner approval, run advisors/logs, mirror into sql/schema.sql; (4) root-cause the
stale-local-copy overwrite that unlocked Skylar (2 Oct) and Archer (3 Oct); (5) Part 3: backdate each
Amble lock to its agreed point with owner sign-off of before/after AP and gold/downtime; (6) Part 1b:
CharGen whole-log rebuilds merge instead of rewrite.
```
**Done when:** the guard is live and tested (a player save that drops or reopens a lock is refused), all
six Amble characters carry their lock at the agreed point (owner signed off), the stale-copy cause is
fixed or tracked, and CHANGELOG/DECISIONS record it.

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

## fix/blank-character-rows — blank "New Character" rows keep being inserted into the cloud — TODO
Branch `fix/blank-character-rows`. **Effort:** medium · **Risk:** medium — driven by damage scale: the fix sits in `js/sync.js`'s push path, which every cloud save in both tools goes through, so a guard that's too broad could refuse a real save.

```text
FOUND 2026-10-08 (live check while helping a player who could not load his character): public.characters holds 30 active
rows that are pure column defaults — name 'New Character', kind 'livesheet', stats '{}' — across 5 owners, created
2026-08-08 → 2026-10-08. One owner has 16; one player got five within ~6 seconds (2026-10-08 11:47 UTC), and they
cluttered his character list so badly he could not find the right one.

Every tool's saveCharacter() call passes real stats, so the rows are not coming from a normal save. An insert with ALL
defaults means the pushed record had no name, kind or stats. Prime suspects: noteEdit() and setAutosaveEnabled() in
js/sync.js both write a bare local placeholder ({id, editSeq…} / {id, dirty:false, …}) with no stats, and
pushCharacter() INSERTs whatever record it is handed when no server row exists (reconcile()'s dirty-record retry is one
route there).

DO:
  1. Find the exact path that pushes a stats-less local record, and reproduce it in a test.
  2. Shallow fix: pushCharacter() refuses to INSERT a record with no stats.LOG.
     Deeper fix (preferred if low risk): a stats-less local record can never be marked for push — placeholders stay
     local-only metadata. Present both with tradeoffs before choosing (AGENTS.md "Fix depth").
  3. Do NOT delete the existing 30 blank rows here — that is a separate cleanup needing owner approval.

Related gaps found the same day, NOT in scope (record them if left open): the duplicate-name guard (_lsRenameGuard, #545)
runs only on Live Sheet's Rename — not on save, import or load — and CharGen has no such guard at all.
```
**Done when:** a test reproduces a blank-row insert on the old code and passes on the new; `engine-parity.html` reports 0 failed; a live re-check after the fix reaches `main` shows no blank rows created after that date.


## feat/livesheet-buy-fullpage — Live Sheet: let the Buy / progress panel expand to the whole page — TODO
Branch `feat/livesheet-buy-fullpage`. **Effort:** small · **Risk:** low — UI-only CSS/JS in one tool; driven by ambiguity (what
"expanded" looks like), not damage: `buy()` and the engine are untouched.
```
Owner request 2026-10-12: buying is cramped in the 300px Buy / progress column. Add an "expand" control on the Buy /
progress heading in tools/PACT-Live-Char-Sheet.html that makes that panel fill the whole page width (the Character and
History & ledger panels hide or fold while it is expanded), with an obvious way back. Remember the choice per browser,
like the desktop panel fold added in PR #630 (CSS :has() rules under @media(min-width:1001px); fold state in localStorage
'pactLsPanelFold' via _lsPanelFoldInit()). When expanded, lay the buy groups out in several columns so the extra width is
actually used. Phones (<=1000px) already show one full-width column — decide whether expand means anything there and say
so. Keep the AP left / spend figures visible while expanded. UI only: buy() behaviour unchanged, no DATA.version bump.
Extend testing/scripts/livesheet-center-panel-e2e.mjs (or add an e2e) for expand / restore / remembered-after-reload and a
purchase made while expanded.
```
**Done when:** on desktop one click expands Buy / progress to the full page width with its groups in several columns, one
click restores the normal three-panel layout, the choice survives a reload, a purchase made while expanded is recorded
exactly as in the normal layout, and the e2e covering this passes.

## Fold the player-award-after-lock migration into the baseline (applied 2026-10-13) — TODO
**Effort:** small · **Risk:** medium — baseline/drift-guard edits only, but a mistaken fold is how the 2026-09-02 regression happened.

```text
APPLIED to production 2026-10-13 (migration `server_player_award_after_lock`, owner decision N1, during feat/dm-ap-discount):
the live function matched 2026-09-03-dm-zero-player-ap.sql; 0 campaign award amounts were non-numbers; afterwards the new
version is live, `authenticated` cannot execute it, and postgres logs show no errors. The migration header, the decision
record's Status and a CHANGELOG line already say APPLIED. NOT done that day: re-measure 2(a) — no creation-locked or sealed
campaign character whose stored award total would rise — not needed for the apply (it only refuses future saves), but record it.

Still to do, in an "applied" PR (per sql/migrations/README.md; precedents #580→#598, #600→#608):
  - fold the new pact_enforce_player_ap_ceiling() + its trigger, revoke and comment into sql/rls-policies.sql, and fold
    2026-09-03's dm_zero_player_ap() too (applied 2026-09-03, never folded);
  - add pact_enforce_player_ap_ceiling to rls-baseline-test.sql's drift list (21 → 22 functions since feat/dm-ap-discount),
    \ir the 2026-10-12 migration there, and assert the trigger function is NOT callable by authenticated.
COORDINATE with the campaign house-rules work (session pact-cf, branch chore/campaign-house-rules-sync-preview): its
harness BASE already loads the live 09-03/10-12 files, and it also edits rls-policies.sql.
```
**Done when:** rls-policies.sql carries the applied function, the drift guard covers it (and passes in sql-guards CI), and the
2(a) re-measure is recorded in the decision record.

## fix/server-negative-cost-after-lock — a locked character can still gain AP through a negative client-stamped cost — TODO
**Effort:** medium · **Risk:** high — a trigger change on every campaign character save; needs a live measurement and owner approval to apply.

```text
Found in review of #644 (fix/server-player-award-after-lock), which closed the AWARD route only. Costs are stamped by the
client, and pact_ap_ledger_spend() trusts them: a `buy` with cat:'drawback' counts -cost as earned AP, and any other buy/buyoff/
names cost is summed as spent. So on a creation-locked or sealed campaign character a modified client can still append
(1) a drawback buy with a large negative cost (a refund bigger than the drawback is worth), or (2) a non-drawback buy with a
negative cost, and get spendable AP. Both predate #644.
DO: MEASURE live first — campaign characters with a negative cost on any non-drawback buy/buyoff/names, and the range of drawback
costs. Then decide (H2 if the owner is away) a server rule that stays SQL-only arithmetic (never re-price in SQL — engine.js
is the only pricing source): e.g. refuse cost < 0 on non-drawback events for campaign characters, and on a locked/sealed one
refuse a rise in drawback earnings by anyone but the DM (mirroring pact_enforce_player_ap_ceiling). Rehearse in the Docker
harness (testing/scripts/creation-lock-guard-test/, run-award.sh pattern) incl. legitimate post-lock drawbacks the tools allow.
```
**Done when:** the harness refuses both negative-cost routes on a locked campaign character and accepts every legitimate save the
tools make; the live measurement is recorded; the owner has applied it and the advisors are clean.

---

# Conventions
- One task per branch/commit; re-open `engine-parity.html` after each.
- Keep `js/engine.js` off-limits unless a task targets it.
- When a task here is done, move it to `CHANGELOG.md` — don't leave DONE items here.
