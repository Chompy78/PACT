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

## epicBoonAbil is silently dropped on a CharGen round-trip — TODO
Branch `fix/chargen-preserve-epicboonabil`. Found while auditing the pricing model
(`decisions/2026/D-GH-2026-08-05-pricing-model.md`); unrelated to it. Filed NOW because it is silent
data loss on a supported path, not a display bug.
**Effort:** low · **Risk:** low — ambiguity low (one obviously-right fix: carry the field through the
two places that already carry its siblings); damage scale low (one field on one character); damage
likelihood low (additive, and the parity gate plus a round-trip fixture check it) — worst-of lands at low.

```text
1. Only the Live Sheet ever SETS epicBoonAbil, via the `names` event (tools/PACT-Live-Char-Sheet.html
   :1499-1509), applied by MUT.names (js/engine.js:485).
2. CharGen never reads it: _domReadBuild() has no such field, and CG_NAMES (tools/PACT-CharGen-Webtool
   .html:2842) is built as {dab,inn,feat,lang,grants,tr} with no `eb`. So the `names` event emitted by
   _buildEventBurst omits it, and replaceWholeLogFromBuild() rebuilds a log without it.
3. Net: open a Live-Sheet character with epic boons in CharGen and its ability choices vanish. The
   character then permanently shows "<boon>: choose an ability to raise (+2)" (js/engine.js:110).
4. Fix: carry epicBoonAbil through _domReadBuild() and CG_NAMES so a round-trip preserves it. It is a
   display/entitlement field, not a price — compute() reads it only via the stat bump at :110.
5. DATA.version does NOT move (no rules or compute() change).
```
**Done when:** a Live-Sheet character with epicBoonAbil set is opened in CharGen, saved, reopened in the
Live Sheet, and still has its ability choices; a fixture covers the round-trip; engine-parity 24/0.


# Conventions
- One task per branch/commit; re-open `engine-parity.html` after each.
- Keep `js/engine.js` off-limits unless a task targets it.
- When a task here is done, move it to `CHANGELOG.md` — don't leave DONE items here.
