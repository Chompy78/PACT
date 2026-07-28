# D-GH-2026-07-28-decisions-changelog-task-board-split — Migrate DECISIONS.md, CHANGELOG.md, and docs/TASK_BOARD.md to the AI_templates split-file pattern

Status: Active

- **Context:** PACT was the origin of the `.claude/commands/*.md` scaffold and the last of the surveyed
  projects still on a single-file `DECISIONS.md`/`CHANGELOG.md`/`docs/TASK_BOARD.md` shape (see
  `D-GH-2026-07-28-command-format-agnostic`, which hardened the command files ahead of this exact
  migration). At the time of this change: `DECISIONS.md` was 371,703 bytes over 112 full decision
  records (plus one orphaned index-only entry, see below); `CHANGELOG.md` was 271,870 bytes over 262
  dated entries; `docs/TASK_BOARD.md` was 35,953 bytes. All three were well past the ~30-40KB-per-file
  graduation heuristic documented in `ai-templates`' `D-2026-07-28-decisions-task-board-split-pattern`.
- **Options:** (i) leave all three as single files, now the clear outlier among every other project
  using this standard; (ii) apply the same DECISIONS.md/TASK_BOARD.md split already proven on
  AI_home_server, homelife, wildlife-explorer, ai-templates, and PACT-Campaign, and additionally design a
  CHANGELOG.md split (no prior project's CHANGELOG.md was large enough to need one); (iii) split
  DECISIONS.md/TASK_BOARD.md only, leave CHANGELOG.md as one file like every prior migration.
- **Decision:** (ii) — split all three. For `CHANGELOG.md` specifically, rather than inventing a new
  per-entry-file pattern (changelog entries are read as a scrolling list, not jumped to individually the
  way a decision is), this project already had its own precedent for exactly this problem:
  `docs/history/CHANGELOG-full.md` holds the pre-GitHub condensed history, explicitly marked
  non-authoritative and never auto-read (see D-002/D-003). Extended that same rotation *idea* — but not
  the same folder: `docs/history/README.md` explicitly scopes that folder to "history from before the
  move to GitHub," and this rotation is post-GitHub content, so it goes in a new sibling file instead:
  `docs/CHANGELOG-archive-2026-06-29-to-2026-07-16.md`. Entries from 2026-06-28 through 2026-07-16 (238
  entries, ~233KB — including 19 entries that had been sitting past the old file's own
  "## How to add an entry" template section, an older bottom-of-file appending habit predating the
  "add at TOP" convention) moved verbatim there; entries from 2026-07-17 onward (43 entries, ~40KB)
  stayed live in `CHANGELOG.md` — a clean date boundary that also lands within the same ~30-40KB
  heuristic used for DECISIONS.md/TASK_BOARD.md.
- **Why:** Splitting DECISIONS.md and TASK_BOARD.md reuses a pattern already verified correct on five
  other projects — no new design risk there. CHANGELOG.md's shape is different enough (append-only,
  read-as-a-list, occasionally pointed at by ID from a decision) that copying the DECISIONS.md
  thin-index-plus-per-record pattern onto it would add indirection with no real benefit; reusing this
  project's own existing archive-rotation convention instead keeps the fix consistent with a decision
  this project already made about itself, rather than introducing a second, competing "how do old
  records get filed" convention.
- **Data-quality note:** the original `DECISIONS.md` index listed one entry,
  `D-GH-2026-07-17-shared-auth-change-helper`, with no matching full `## ` record anywhere in the file —
  an orphaned index-only summary, not something introduced by this migration. Rather than fabricate a
  Context/Options/Why record that never existed, its own file preserves the original index-line summary
  verbatim, with a note explaining the gap.
- **Status:** Active. `docs/TASK_BOARD.md` had no in-flight work in its NOW band at migration time
  (confirmed via `git status`/fresh read before starting). Byte counts and verification results are in
  the corresponding `CHANGELOG.md` entry.
