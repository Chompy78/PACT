# Session: pick-task collision, a wrong backlog assumption caught, and a terminology sweep

**Date:** 2026-07-19 · **Task-board additions:** `feat/warn-missing-data-refs` (new TODO, not yet built)

Why this note exists: a routine `/pick-code-task` on two named tasks hit two different snags in the
same turn — one task turned out already merged by another session, the other wasn't a formal task at
all — and formalizing the second one via `/add-code-task` surfaced that the task's own originating
assumption (what to rename `MUT.patch` to) was factually wrong once actually traced through the code.
Worth preserving so a future session doesn't re-trust that same wrong assumption, and so the collision
pattern (another session finishing a task mid-pick) is on record.

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

## Why this is worth remembering

Two lessons for future sessions specifically:
- **A backlog note's own suggested fix can be based on a wrong assumption about scope** — this is exactly
  what `/add-code-task`'s "read live context first" step exists to catch, and it worked here. Don't
  skip straight to formatting a task from its one-line description; trace the real code first when the
  note proposes a rename or a behavior change, especially for something as central as an engine mutator.
- **Another session can finish a task in the gap between when you last checked the board and when you
  act on it.** The live-fetch-before-picking discipline `/pick-code-task` already follows caught this
  cleanly (PR #273 merging elsewhere) rather than this session duplicating already-done work.

## Status

`chore/mut-patch-restrict` and `feat/warn-missing-data-refs` both sit on `docs/TASK_BOARD.md` as open
`— TODO` items, not yet built. The terminology sweep is fully shipped (commit `6dcb477`).
