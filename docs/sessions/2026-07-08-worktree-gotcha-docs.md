# 2026-07-08 — Fold proven worktree gotchas into /run-task

Follow-up to `docs/sessions/2026-07-08-dgh-numbering-collision-fix.md` (candidate #2 from that session's
workflow-improvement review, deferred at the time).

## Discussion
The cross-project `chompy78/ai-lessons-learned` repo indexes four worktree-related lessons under
`topics/claude-code-worktrees.md` (H-018, H-026, H-027, H-028) — and all four were sourced from *this*
repo's own past sessions (`fix/ios-save-export-reliability`, `fix/theme-selector-clipped`,
`fix/engine-build-export`, `feat/theme-random-artwork`). One (H-026, verify cwd after a context resume) was
already folded into `run-task.md` Step 4. The other three weren't documented anywhere in the skill, meaning
a future `/run-task` run would be relying on the agent independently remembering — or rediscovering —
gotchas this repo has already paid to learn three separate times.

## The fix
Added three caveats to `.claude/commands/run-task.md`, each right where it becomes relevant in the task
flow rather than as a separate reference section:
- **Step 4** — verify the new worktree's base with `git merge-base --is-ancestor origin/preview HEAD`
  immediately after `EnterWorktree`, before any edits (H-028).
- **Step 5** — if `preview_start` is needed to browser-verify a UI change from inside the worktree, it
  resolves `.claude/launch.json` against the *main* repo root, not the worktree's — write a temporary
  `launch.json` there pointed at the worktree's absolute path instead (H-018).
- **Step 8** — if `ExitWorktree(action: "remove")` refuses citing a commit count that looks too high, that
  count can include already-pushed upstream commits pulled in by Step 6's rebase, not just this session's
  unpushed work — confirm the branch is already pushed/in an open PR before treating `discard_changes: true`
  as safe (H-027).

Not touched: `docs/SKILLS.md`'s worktree summary and `AGENTS.md`'s existing "see `run-task.md` Step 4 for
the verified caveats" pointer — both stay accurate as-is; the new caveats live in the step where they're
actually actionable, matching the file's existing structure.

## Why no DECISIONS.md entry
This isn't a new architectural decision — it's transcribing three already-proven, already-cited fixes into
the skill that would hit them. The "why" for each is fully captured inline in `run-task.md` with a pointer
to the source lesson; nothing here would leave a future agent wondering why it was done this way.

## Verification
Docs-only change (a `.claude/commands/*.md` skill file); no `compute()`/`DATA` touched, so no
engine-parity run needed.
