# D-GH-2026-07-11-dgh-numbering-scheme — Retire sequential D-GH numbers; use D-GH-\<date\>-\<slug\>

Status: Active

- **Context:** the sequential `D-GH<N>` scheme collided repeatedly — at least D-GH19/20, D-GH25/27,
  D-GH26/28, D-GH30/42/43 (a triple), D-GH44/45, D-GH46/47, and D-GH47/48/49 (a chain), documented in this
  file's own "Addendum" notes. Each collision happened because "next = highest + 1" is a shared mutable
  counter across concurrent sessions/branches; AGENTS.md already told sessions to check the *live* remote
  before claiming a number, but that check still leaves a race — nothing stops a different branch from
  merging its own claim in the gap between the check and the merge. The most recent instance
  (`feat/ap-by-level` claiming D-GH48, colliding with the already-merged Feature B's D-GH48) happened
  *after* the live-remote check was followed correctly, proving the check-then-claim pattern can't be
  patched into being race-free — it needs a different mechanism, not more diligence.
- **Options:** (A) keep sequential numbers, add a mechanical pre-push guard that fails loudly on a
  duplicate (shrinks the pain of a collision, doesn't prevent it). (B) a shared append-only ledger file
  as the source of truth for "next number" (turns a silent semantic collision into a git push rejection,
  but is still a shared mutable resource every session must touch correctly). (C) drop global sequential
  numbers entirely in favor of an ID derived from data that's already unique by construction.
- **Decision:** (C). New decision codes use `D-GH-<YYYY-MM-DD>-<branch-slug>` (e.g.
  `D-GH-2026-07-11-ap-by-level`) — today's date plus the task's own branch slug (the part after `type/`).
  Existing `D-GH1`–`D-GH49` entries are NOT renumbered; they stay as historical sequential IDs. Only new
  entries use the date-slug form. Updated `AGENTS.md`'s "Multiple sessions" section and the
  `/add-roadmap-task` and `/pick-task` skills to match — neither needs a live-remote lookup anymore.
- **Why:** the branch slug is already guaranteed unique by the pre-existing "one task per branch" rule, so
  concatenating it with a date makes an ID that cannot collide without also violating a rule that's already
  enforced — there is no shared counter left to race on, so no amount of concurrency can reproduce this
  class of bug again. This trades away "the number tells you recency" (DECISIONS.md's "newest at the top"
  ordering already provides that positionally) for eliminating the *ongoing* cost: no live-remote check
  before claiming, no renumbering, no addendum notes, ever — a one-time convention change instead of a
  recurring tax paid on every single task. Rejected (A) and (B) because both keep the shared-counter
  design and only change how loudly or how late a collision surfaces, which doesn't stop the underlying
  race from happening — this project has already spent real session time on repeated collision cleanup, so
  a fix that still requires per-session discipline to *avoid* the failure (rather than making the failure
  structurally impossible) doesn't pay for itself.
- **Status:** DONE. `AGENTS.md`, `.claude/commands/add-roadmap-task.md`, and `.claude/commands/pick-task.md`
  updated. Docs-only; no `js/engine.js` or `DATA.version` change; `testing/tests/engine-parity.html`
  unaffected.

---
