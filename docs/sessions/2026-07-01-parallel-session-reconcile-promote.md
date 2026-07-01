# Session — 2026-07-01 · Parallel-session branch reconciliation, CharGen fix merge, preview → main promotion

*History / non-authoritative. Authoritative state: `CHANGELOG.md`, `docs/PACT_ROADMAP.md`.*

## Goal
The user was running multiple parallel Claude Code sessions against one shared working-tree
checkout. Build a `/next-task` command to pick up roadmap work safely under that setup, then use it
— which immediately surfaced the exact collision the command was designed to catch.

## What we did

### Root cause: one shared checkout, multiple sessions
A `git checkout` in one session moves the branch every other session is looking at. Mid-run, the
shared checkout flipped from `fix/cu-6-rename-dm-console` to `fix/chargen-live-sheet-save` — another
session's work, not this one's.

### `/next-task` command
Added `.claude/commands/next-task.md`: reads `AGENTS.md` + the roadmap, picks the top unblocked NOW
item (or an explicit `$ARGUMENTS` override so parallel sessions can be assigned different tasks),
waits for human OK, then runs a **collision check** (`git ls-remote`/`git branch --list` for the
target branch name) and an **effort check** (hard stop if not running at High effort) before doing
any work in an **isolated git worktree** — deliberately rooted at `C:\Users\JohnChow\pact-worktrees\`,
*outside* the `OneDrive - Aventa Solutions` sync tree, since parallel worktrees inside a
OneDrive-synced folder risk file-lock contention during git writes.

### The collision it caught
Running `/next-task` found `fix/chargen-live-sheet-save` already existed locally with an unpushed
commit — another session had independently fixed the same roadmap item ("CharGen → Live Sheet button
does not save character"). Worse: **local `preview` also had an unpushed direct commit** of the same
fix (bypassing the branch+PR rule), diverged from `origin/preview` by "ahead 1, behind 6" after other
sessions had separately landed CU-6, CU-4 graduation, and a session-log recovery upstream.

### Reconciliation
1. Reset local `preview` to `origin/preview` (`git branch -f`) — dropped the stray direct commit; it
   was a byte-identical duplicate of the one already on the feature branch, so nothing was lost.
2. Rebased `fix/chargen-live-sheet-save` onto the now-current `origin/preview`. One conflict in
   `docs/PACT_ROADMAP.md` — CU-4/CU-6 (already graduated upstream) vs. the CharGen item (being
   graduated by this commit). Resolved to an empty NOW bucket (nothing re-added, CharGen item
   removed). `CHANGELOG.md` and the new session-log file auto-merged cleanly.
3. Verified the parity gate live in-browser (not the stale Node-only instructions in
   `docs/HOW-TO-WORK.md`, which predates REV-01's real assertions): **5 passed / 0 failed**.
4. Pushed, opened PR #60, merged into `preview` (fast-forward, branch auto-deleted).
5. Promoted `preview → main` the same way as the prior session (`chore/promote-preview-to-main`
   branch, PR #61, merged) — no divergence, GitHub Pages now serves the fix.
6. `git fetch --prune` to clear stale remote-tracking refs for the deleted branches.

## Notes
- No `DECISIONS.md` entry — this was operational reconciliation, not an architectural change
  (matches the "mechanical promotion doesn't need a D-GH code" precedent from the prior session).
- The CharGen fix itself was already logged in `CHANGELOG.md` and
  `docs/sessions/2026-07-01-chargen-livesheet-save-fix.md` by the commit that introduced it; nothing
  further needed there.
- `/next-task` currently trusts the *checked-out working tree* for Step 1's reads. This session
  learned that's unsafe when the tree is shared — reading via `git show origin/preview:<path>`
  instead (as done here, by hand) would make the command itself collision-proof for Step 1, not just
  the branch-creation step. Worth folding into the command in a follow-up.
