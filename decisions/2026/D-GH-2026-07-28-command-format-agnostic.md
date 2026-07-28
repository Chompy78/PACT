# D-GH-2026-07-28-command-format-agnostic — Harden task-board/decisions commands against a future file-shape migration

Status: Active

- **Context:** While migrating `homelife` and `wildlife-explorer` (two other repos that ported PACT's
  `.claude/commands/*.md` scaffold) off a single `DECISIONS.md`/`TASK_BOARD.md` into a split shape — a
  thin `DECISIONS.md` index over per-decision `decisions/<year>/D-*.md` records, plus `TASK_BOARD_NOW.md`/
  `_NEXT.md`/`_LATER.md` — it turned out both projects' ported command files hardcoded the old single-file
  paths and formats, and needed synchronized updates in the same push as each project's own migration.
  PACT is the origin of this scaffold — its own `DECISIONS.md` (367KB, 110+ decisions) and `CHANGELOG.md`
  (271KB) are large enough to be a genuine future migration candidate, and anything still porting from
  PACT (e.g. `PetDetective`) inherits whatever shape PACT's own commands assume today.
- **Options:** (i) leave the commands as-is, fix them only when/if PACT itself migrates; (ii) harden the
  commands now to check for either shape, independent of and ahead of any actual content migration.
- **Decision:** (ii).
- **Why:** Option (i) means paying the same "synchronize command updates with the file-shape change"
  cost homelife and wildlife-explorer just paid, at exactly the moment PACT's own migration is already a
  large, risky change (110+ decisions, a 271KB changelog) — worse timing to also be debugging command
  behavior. Option (ii) is a small, isolated, content-free change today, and means PACT's eventual
  migration (whenever it happens) touches only `DECISIONS.md`/`CHANGELOG.md`/`TASK_BOARD.md` themselves,
  not the command files — and any project still porting this scaffold from PACT inherits commands that
  already work correctly against either shape, with nothing to fix later.
- **Status:** Active. No content migration performed — `DECISIONS.md`/`CHANGELOG.md`/`docs/TASK_BOARD.md`
  are still today's single-file shape; that migration is tracked separately (see `ai-templates`'
  `D-2026-07-28-decisions-task-board-split-pattern`, which names PACT and PACT-Campaign as the two
  remaining candidates from a cross-project survey).
