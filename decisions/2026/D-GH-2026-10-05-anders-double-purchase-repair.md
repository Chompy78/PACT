# D-GH-2026-10-05-anders-double-purchase-repair — delete the duplicate subclass purchase from Anders Pipeleaf's sealed history

**Status:** DONE — applied to the live row 2026-10-05 12:53:13 UTC, verified by read-back. Owner-approved at each step.

## Context
Anders Pipeleaf (Amble) held one ability through both purchase doors: `Rogue|Soulknife|Psionic Power / Psychic Blades` via
`b.subAbilities` (seq 30, 8 AP) and `Rogue: Psionic Power / Psychic Blades` via `b.features` (seq 40, 7 AP + 100 gp + 21 days).
`compute()` charged both with no warning (111 AP vs 104). His history is sealed and the DM's 2026-10-04 repair had placed the
creation lock before seq 40. He is the only live character affected (all 53 checked).

## Options
- **Delete seq 40** and recompute the lock point. ← chosen
- **Refund** 7 AP + 100 gp + 21 days through the DM Console (append-only; the duplicate stays visible in the log).
- **Leave it**, and let the engine fix change only the computed total.

## Decision
Delete seq 40; place the lock by the standing owner rule (before the last purchase that takes spend past limit + drawbacks);
renumber; keep everything else byte-for-byte. One guarded transaction with `trg_pact_locked_history` and
`trg_pact_ap_budget_consistency` disabled for its length, rehearsed first in Docker against the live trigger definitions.

## Why
It gives the player back all three costs at once (they are derived from the log), leaves no duplicate for the P3 engine fix to
stumble over, and the 2026-10-04 repair already set the precedent of a one-off, backed-up, verified rewrite. A refund would have
been smaller but would have left the duplicate in a sealed log, and risked double-counting once the engine fix lands.

## Consequences
- Spend 111 → 104; the lock now sits before Hit Die 4; Sleight of Hand is a creation purchase.
- The history-lock trigger refuses this edit by design; it was disabled for one transaction. That is a privileged step and was
  taken with explicit owner approval — it is not a routine tool.
- Rollback: restore from the `character_backups` row captured at 12:53:13 UTC (fingerprint `93d2a60c…`).
- The cause is fixed by PR #587 (`D-GH-2026-10-05-subclass-double-purchase-guard`): the second purchase is now refused in both tools and a duplicate in an existing log is charged once. Anders's two review copies still carry the duplicate; they are not repaired.

Session note: `docs/sessions/2026-10-05-anders-double-purchase-repair.md`.
