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

## A purchase frozen at 0 while HD-blocked becomes free once Hit Dice rise — TODO
Branch `fix/blocked-purchase-freezes-at-zero`. Found by `/code-review ultra` on PR #471 and **created by
the HD gate in `D-GH-2026-08-27-feature-hd-gate`** — before that gate a purchase was simply priced, so this
path did not exist. An HD-blocked purchase costs 0 AP by design. `repriceDraft()` freezes that 0 into the
ledger; once the character is campaign-bound, repricing stops touching the log; and the Live Sheet prices a
level-up as the **Hit-Dice ladder step alone** (`_CTX_PRICERS.hd`, `tools/PACT-Live-Char-Sheet.html:777`),
never as a `compute()` delta — so nothing ever charges for the purchases that the level-up legalises. Net:
a 19 AP (origin) / 32 AP (cross-class) feature acquired for 0 AP, with the unearned AP still showing as
spendable in the frozen ledger the Live Sheet displays as "AP left". Verified by running the engine on
`[award 500; buy feature cost 0 at 1 HD; buy hd->17 cost 96]`: `compute().total 128` vs `economy().spent
96`, feature owned, **zero warnings**.
**Effort:** medium · **Risk:** high — damage scale is the driver: this is unearned spending power in the
frozen ledger of a live campaign character, and the frozen ledger is the AP model's source of truth
(see D-GH30 and `feat/ap-model-reconcile`). Ambiguity is medium — the fix could sit in `repriceDraft()`
(refuse to freeze a blocked purchase at 0), in the level-up pricer (charge the `compute()` delta), or in
the gate itself (refuse the purchase outright rather than blocking it at 0), and those are different
answers about what a "blocked" purchase IS.

```text
1. Reproduce first, in the tools rather than only the engine: pick a too-high-tier ability in CharGen at
   low HD, save, bind to a campaign, then level up in the Live Sheet and confirm the ability becomes owned
   with no charge and the ledger still shows the unearned AP.
2. Decide where the fix belongs -- this is the actual decision, record it in DECISIONS.md:
   (a) repriceDraft() refuses to freeze a blocked purchase (drop it, or freeze at its real cost),
   (b) the Live Sheet level-up charges the compute() delta rather than the ladder step alone, or
   (c) a blocked purchase is refused at the point of purchase instead of being held at 0.
   (b) is the most general but touches the AP model; (a) is the narrowest.
3. Whatever is chosen, a character who ALREADY holds a frozen 0-cost blocked purchase must be handled --
   25 live characters exist (the app is NOT pre-launch, see AGENTS.md). Check the live characters table
   for frozen 0-cost feature/subabil events before shipping.
4. Cover it with a tool-pricing-ci case, not just an engine fixture: the bug lives in the seam between
   repriceDraft(), the frozen ledger and the level-up pricer, which no engine-only fixture reaches.
```

**Done when:** levelling a character past a blocked purchase's Hit-Dice requirement either charges its
real cost or leaves it blocked; `compute().total` and `economy().spent` agree across that transition; a
`tool-pricing-ci` case covers the CharGen -> bind -> level-up path.

---

# Conventions
- One task per branch/commit; re-open `engine-parity.html` after each.
- Keep `js/engine.js` off-limits unless a task targets it.
- When a task here is done, move it to `CHANGELOG.md` — don't leave DONE items here.
