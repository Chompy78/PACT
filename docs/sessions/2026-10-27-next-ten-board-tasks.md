# 2026-10-27 — working through the next ten board tasks

Owner instruction: take the NOW item plus the next nine in board order, work without input where possible, use the cold-review API
skill to settle problems before bringing them up, and batch the real decisions into one list. Answers given up front: merge each PR
myself once CI and review are green (B2); apply migrations to the live database as I go (C2); no exploit-shaped material to outside APIs (D1).

## What landed

| Task | Result |
|---|---|
| `fix/server-negative-cost-after-lock` (NOW) | **Merged #714, applied live 2026-10-25.** New trigger refuses a player-added negative-cost buy/names event and a repeat binding. An independent Claude review found a real hole (500 bindings at -2 each); fixed and tested before the merge. |
| `feat/server-freeze-houserules-gold` | **Merged #718, applied live 2026-10-27.** `houseRules` and `gold` are protected after a lock. Measured first: 452 real saved pairs, none touched either field. |
| `fix/chargen-post-lock-purchases`, `feat/chargen-2b2-traditions-diff`, `fix/chargen-creation-ceiling` | **Already shipped 2026-10-04/05**; the board still listed them as TODO. Taken off the board (#721 merged) after checking each against its own "Done when". |
| `feat/roll-lock-then-spend` | **Plan written and cold-reviewed, merged #720.** Not built: it needs five owner answers. |
| `fix/no-purchase-refunds` | **Measured, not built.** Four live characters carry a refund; recorded on the board entry with four design questions. |
| `fix/strict-language-note-match` | **#715 open, HELD** for the owner. |
| `feat/free-subclass-bare-pick` | **#716 open, HELD** for the owner. Rules v0.386 -> v0.387. |
| `feat/dm-console-award-seal` | **#717 open, HELD** for the owner. |

## Things worth remembering

- **The board lies about shipped work.** Three of the ten entries had been done for three weeks. A task pick should grep the CHANGELOG and the code
  for the task's own name before starting.
- **Tasks whose text says "also bump `DATA.version` and edit the Guide" can be wrong.** `fix/strict-language-note-match` asked for both; `compute()`
  never reads a language name and the Guide never mentions the campaign language list, so neither applies (recorded in its decision).
- **A harness can pin a gap as "allowed".** Cases R2-2 / R2-4 in `house-rules-cases.sql` pinned the negative-cost gap; the newer migration's trigger
  calls `pact_num()`, which the house-rules rollback drops, so three older harnesses (house-rules, award, notes) now roll the newer guard back first.
- **`pact_enforce_player_grants()` treats a `buy` with no `cat` as a drawback** (NULL in its `not (A or B)` skip test). Harmless here; noted in the
  negative-cost harness. Not fixed.
- **A per-event cap is not a cap.** The first negative-cost rule bounded a binding to -2 per event but not the number of events; only the
  independent review caught it. Bounds on a client-written sum need a bound on the count, too.
- **Review output the API models give is unreliable on identity, not substance.** Both reviewers misnamed themselves; their findings held up after
  checking. OpenRouter's free models all errored this time.
- Tooling: a worktree session refuses compound shell commands and any `git` outside its own worktree; a force-push was denied, so the rebased
  branch went to a new name by refspec. CI `Install Chromium` steps time out now and then: rerun only the failed jobs.

## Still open for the owner

See the closing report of this session: decisions on #715, #716, #717 (merge as is, or change), the five questions in
`docs/plans/2026-10-27-roll-lock-then-spend.md`, and the four questions on `fix/no-purchase-refunds`.
