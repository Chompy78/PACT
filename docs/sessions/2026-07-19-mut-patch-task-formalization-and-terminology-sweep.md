# Session: pick-task collision, a wrong backlog assumption caught, a terminology sweep, and a real promotion conflict

**Date:** 2026-07-19 · **Task-board additions:** `feat/warn-missing-data-refs` (new TODO, not yet built) ·
**PR:** #274 (merged into `main`, with manual conflict resolution — see item 6 below)

Why this note exists: a routine `/pick-code-task` on two named tasks hit two different snags in the
same turn — one task turned out already merged by another session, the other wasn't a formal task at
all — and formalizing the second one via `/add-code-task` surfaced that the task's own originating
assumption (what to rename `MUT.patch` to) was factually wrong once actually traced through the code.
The same root collision (another session's PR #273) resurfaced later the same session as a real,
unresolvable-by-GitHub merge conflict during a `preview`→`main` promotion. Worth preserving so a future
session doesn't re-trust that same wrong assumption, recognizes this collision pattern, and has a
worked example of resolving a genuine cross-session conflict on `main` rather than punting on it.

## What happened, in order

1. **`/pick-code-task` on two named tasks, run back to back.** A live `git show origin/preview:...` fetch
   (delegated to an Explore subagent, per the skill's own convention) came back with a surprise: the
   remote already had a branch `docs/close-code-session-note-no-pause` for the first named task
   ("Harden close-code-session's session-note step against implicit pausing"). Checked its PR status
   directly — **PR #273**, already merged straight to `main` (bypassing `preview`, per that other
   session's own explicit request, noted in its PR body). The task was simply done; nothing to pick.

2. **The second named task** ("General engine maintainability — rename/restrict MUT.patch") turned out
   not to be a formal `— TODO` task at all — it was a loose backlog bullet under docs/TASK_BOARD.md's
   "Improvements" section, with no branch name, no step list, no "Done when." Asked the user how to
   proceed (options: formalize it via `/add-code-task` first, pick a different real task, force through
   an invented branch/steps anyway, or stop) — picked "formalize it first."

3. **Formalizing it caught a real error before it shipped.** The backlog note's own text assumed
   `MUT.patch` was import-only (its code comment says "imported-from-generator bundle") and suggested
   renaming it to `importPatch`. Tracing every real call site before writing the formal task (not just
   trusting the note) found this assumption wrong: `MUT.patch` is also CharGen's *everyday live in-app
   editing* mutator, reached via a frozen `PATCH_SLOTS` object and `replacePatchSlot()` — identity,
   stats, HD/prof, economy, languages, attunement, ki, sorcery, armour, weapon prof, appearance, house
   rules, custom profs, and more, not just the one-shot import-fold burst. Renaming it to `importPatch`
   as originally suggested would have shipped a name that actively misleads. Also disproved a second,
   related assumption along the way: a naive "restrict to `baseBuild()`'s own declared keys" allowlist
   would have broken the real `houseRules` feature, since that field is legitimately patched but isn't
   part of `baseBuild()`'s initial literal shape at all.

   The formalized task (`chore/mut-patch-restrict`) now makes "audit every real call site first" its own
   explicit first step, rather than assuming the rename/allowlist can be decided up front — and its Risk
   tag moved from the original note's implied medium to a fully-justified `high` across all three factors
   (ambiguity, damage scale, damage likelihood), since the true usage scope turned out bigger and less
   automatically-tested (CharGen's live editing UI has no automated coverage at all) than the note
   assumed.

4. **A related, separate task got added too.** Discussing `MUT.patch`'s priority led to a plain-English
   question about what happens if abilities are added/removed/changed in the rules content generally.
   Traced `compute()`'s actual DATA lookups (racial traits, boons, drawbacks) and confirmed: removing an
   ability doesn't crash anything, but a character who already has it silently loses its cost/effect on
   next recompute, with zero warning shown anywhere. That's a real, separate, currently-unaddressed gap —
   filed as its own new task, `feat/warn-missing-data-refs`, tagged `Risk: medium` (unlike the MUT.patch
   task, this one *is* eligible for `/sweep-code-tasks` if picked up later).

5. **A terminology sweep, unrelated to the above but same session.** The user asked why "roadmap" kept
   showing up instead of "task board." Checked: not a stale filename reference (the file has always been
   `docs/TASK_BOARD.md`) — `AGENTS.md` itself just uses "roadmap" as informal vocabulary for the same
   thing, throughout. Confirmed real scope (9 live files, ~38 occurrences) before doing anything, per the
   user's explicit go-ahead swept all of them (`AGENTS.md`, `docs/SKILLS.md`, `docs/HOW-TO-WORK.md`, all
   6 `.claude/commands/*.md` files) — including updating `/add-code-task`'s own future-commit-message
   template, so new task-board-addition commits use `docs(task-board): ...` going forward, not
   `docs(roadmap): ...`. Left `CHANGELOG.md`/`DECISIONS.md`/`docs/sessions/*.md` untouched, matching the
   precedent already set by the earlier `-code-` command rename (dated historical record, not rewritten).

6. **The same PR #273 collision resurfaced as a real merge conflict during promotion.** Asked to promote
   `preview`→`main`, opened PR #274 and attempted the standard merge — GitHub rejected it (`405 Pull
   Request has merge conflicts`). Root cause: PR #273 had merged straight to `main` (bypassing `preview`,
   per that session's own explicit request), so `main` held a commit `preview` never received, while
   `preview` held 4 commits of its own `main` lacked — genuine divergence, not a transient error.

   Used `git merge-tree` to simulate the merge *before* touching anything, rather than guessing: only
   **one** of the three flagged files (`.claude/commands/close-code-session.md`) had a real,
   unresolvable-by-3-way-merge conflict — both sessions had edited the same lines (one adding "don't
   pause for a reply" wording, this session's terminology sweep correcting "roadmap"→"task board"
   nearby). `CHANGELOG.md` and `docs/TASK_BOARD.md` were flagged too but auto-merged cleanly with no
   actual markers — worth knowing that `git merge-tree`'s "changed in both" label doesn't by itself mean
   unresolvable; check for actual `<<<<<<<` markers before assuming every flagged file needs manual work.

   Resolved by merging `main` into local `preview` (the standard fix for a conflicting PR — resolve on
   the source branch, then the PR merges cleanly), combining both legitimate edits in the one real
   conflict rather than picking a side, and catching a second, subtler issue the auto-merge introduced
   on its own: `CHANGELOG.md`'s two new entries landed in the wrong order (a 2026-07-19 entry above a
   2026-07-20 one, violating the file's own "newest first" rule) — git's merge doesn't understand date
   semantics, only text proximity, so a clean auto-merge still needs a human/agent read-through before
   trusting it. Re-ran `engine-parity` (20/0) before completing the merge commit, pushed, confirmed
   `main` was now a true ancestor of `preview`, then merged PR #274 with a real 2-parent merge commit
   (matching the repo's existing `chore(release): promote preview → main` convention, not squash — squash
   would have broken the ancestry property other tooling, e.g. `run-code-task.md`'s worktree-base check,
   already relies on).

## Why this is worth remembering

Three lessons for future sessions specifically:
- **A backlog note's own suggested fix can be based on a wrong assumption about scope** — this is exactly
  what `/add-code-task`'s "read live context first" step exists to catch, and it worked here. Don't
  skip straight to formatting a task from its one-line description; trace the real code first when the
  note proposes a rename or a behavior change, especially for something as central as an engine mutator.
- **Another session can finish a task in the gap between when you last checked the board and when you
  act on it.** The live-fetch-before-picking discipline `/pick-code-task` already follows caught this
  cleanly (PR #273 merging elsewhere) rather than this session duplicating already-done work.
- **A "merge conflicts" error from GitHub's PR API is a real signal to investigate, not retry blindly** —
  `git merge-tree` against the merge-base let this session see the *exact* scope of the problem (one
  file, one hunk) before touching anything, and a clean auto-merge still needs a sanity read (the
  CHANGELOG ordering slip) rather than trusting "no conflict markers" as proof of correctness.

## Status

`chore/mut-patch-restrict` and `feat/warn-missing-data-refs` both sit on `docs/TASK_BOARD.md` as open
`— TODO` items, not yet built. The terminology sweep and the promotion are both fully shipped — `main`
and `preview` are in sync as of commit `9a8ff07` on `main`.
