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
UPDATE 2026-10-13 (PR #654, campaign house rules — applied to production 2026-10-20): route (1) is closed there — a drawback grants at most its
effective value (AB1, a generated server price list), a name grants once (F1), and a new player drawback after the lock is refused
unless the campaign allows post-lock drawbacks. A new buyoff must name its target and pay rate × value (R2-5), which also closes a
negative-cost BUYOFF. What remains is F2 (round-2 review of #654, R2-2/R2-4, pre-existing): a negative cost on any other
non-drawback event — a buy of any other cat (e.g. skill), or a `names` event — lowers server spend in EVERY campaign mode, locked or
not (harness cases R2-2 and R2-4 in run-house-rules.sh pin it as allowed today). A clamp must still allow the categories that
legitimately carry a negative cost: Martially/Magically Bound (cat mbound / dbound) are AP-granting bindings with a negative cost.
```
**Done when:** the harness refuses both negative-cost routes on a locked campaign character and accepts every legitimate save the
tools make; the live measurement is recorded; the owner has applied it and the advisors are clean.

---

# Conventions
- One task per branch/commit; re-open `engine-parity.html` after each.
- Keep `js/engine.js` off-limits unless a task targets it.
- When a task here is done, move it to `CHANGELOG.md` — don't leave DONE items here.
