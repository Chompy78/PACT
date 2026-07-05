# 2026-07-04 — theme selector fix, a `/pick-task` skill fix, and a worktree-cwd hiccup

## What this is
A record of the session that fixed `/pick-task`'s handling of difficulty-word arguments, then picked
and shipped the "CharGen/Live Sheet: theme selector hidden/clipped + no system dark-mode default"
roadmap task (PR #109) — plus a mid-session tooling hiccup worth flagging for future sessions.

## `/pick-task` fix
The user ran `/pick-task quick and fast`, expecting an easy/small task. The skill's Step 2 only
recognized `$ARGUMENTS` as either a specific task name or nothing — a difficulty descriptor like
"quick and fast" matched neither, so it silently fell through to the default rule (topmost 🔴 NOW
TODO), which happened to be "Live Sheet: undo doesn't work properly" — a bug needing root-cause
investigation, the opposite of quick. Fixed `.claude/commands/pick-task.md` Step 2 to treat
difficulty words ("quick"/"fast"/"easy"/"small"/"simple") as a filter: scan NOW→NEXT→LATER for a
genuinely small/low-risk item (docs-only, config, single-tool CSS/UI fix), explicitly excluding
anything touching `js/engine.js` rules logic, cross-tool migrations, or root-cause-investigation
items. Re-running the corrected logic against the same roadmap snapshot picked the theme-selector
task instead.

## The theme-selector fix (PR #109, merged as `e57fa64`)
Confirmed both roadmap-described bugs by reading the code rather than assuming the roadmap's
diagnosis was complete:
- CharGen's `.hd-row2` (which holds `#themesel`) is `display:none` below 768px, with no mobile
  substitute added — unlike `.hd-row3`'s action buttons, which do get re-surfaced in
  `.mobile-action-bar`. Fixed by adding a compact `#themeselMobile` select to `.hd-mobnav`, synced
  with the desktop select via `setTheme()`.
- `.hd-row2` had no `flex-wrap`, so at narrow/zoomed desktop widths the title/version/last-edited
  text and the theme dropdown (pushed right via `margin-left:auto`) could overflow and visually
  clip. Fixed with `flex-wrap:wrap`.
- Live Sheet's `#themesel` already lives inside its always-reachable "More" dropdown menu — no
  layout bug there, confirmed by reading its CSS (`.top{flex-wrap:wrap}` already handles narrow
  widths). Only needed the dark-mode-default part.
- Added `prefers-color-scheme: dark` fallback to both tools' theme-restore IIFE, matching
  `index.html`'s existing "saved choice wins, else system dark, else default" pattern.

**Deliberately not done:** the roadmap task suggested also moving the restore check inline into
`<head>` to avoid a flash of the wrong theme, matching `index.html`. Not done because `index.html`'s
theme system is `documentElement`-scoped (safe to set before `<body>` exists), while CharGen's/Live
Sheet's is `body`-scoped — porting the early-`<head>` trick would require converting every
`body[data-theme=...]` CSS selector in both tools first, a materially larger change than this fix's
scope. Logged as `D-GH24`, with the "flash on load" problem left as unclaimed follow-up work.

## The worktree-cwd hiccup (why this note exists)
Twice during this session, `Edit` calls using absolute paths under `/home/user/PACT/...` landed in
the **shared main repo checkout** instead of the active worktree
(`.claude/worktrees/fix+theme-selector-clipped`). Both times this happened right after a context
continuation ("Continue from where you left off") — the harness's cwd tracking had silently reverted
to the main repo, even though `EnterWorktree` had switched into the worktree earlier in the same
logical task. `Bash` calls without an explicit `cd` correctly reflected the reverted cwd (so
`git status` in the worktree came back clean both times, which is what surfaced the problem), but
`Edit`/`Write` calls take absolute paths and don't consult "current worktree" state — they'll happily
write wherever the path points, including the wrong checkout.

Recovered both times the same way: `git diff` in the main repo to capture the stray edits as a
patch, `git checkout --` to restore the main repo to clean, re-enter the worktree explicitly via
`EnterWorktree(path: ...)`, and re-apply (or, when the patch's context had drifted because the
worktree's base branch differed from the main repo's branch, redo the edits directly against the
worktree paths).

This is now logged as an `ai-lessons-learned` candidate (see below) — the concrete lesson is to
re-verify cwd (`pwd` / `git rev-parse --show-toplevel`) before the *first* `Edit`/`Write` call of any
turn that follows a context continuation, rather than trusting that an earlier `EnterWorktree` call's
directory context survived.

## Cross-project lesson pushed
One candidate drafted and pushed to `chompy78/ai-lessons-learned`: absolute-path `Edit`/`Write` calls
silently ignore worktree context after a session/context resume; verify cwd explicitly before the
first write of a resumed turn rather than assuming a prior `EnterWorktree` call's directory context
persisted.

## Open at end of session
- `fix/theme-selector-clipped` (local + `origin`) is merged and safe to delete — left for a separate
  explicit cleanup decision, not done as part of this note's branch.
- `origin/preview` was 4 commits ahead of `origin/main` at close; promoting was a separate explicit
  user decision for this same session (see this session's `/close-session` action list).
