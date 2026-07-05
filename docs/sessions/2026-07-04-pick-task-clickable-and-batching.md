# 2026-07-04 — `/pick-task`: clickable confirmation, then task batching

## What this is
A record of the session that turned `/pick-task`'s Step 4 hand-off from copy-paste text into a
clickable confirmation, then — on a direct follow-up question from the user — extended it so several
small, unrelated roadmap tasks can ride one branch/PR together. Written mostly for the design
tradeoffs a future agent could reasonably second-guess, since neither change was a bug fix with an
obvious "right" answer.

## Clickable confirmation (commit `b60c707`)
The user asked for `/pick-task`'s final line — "Say `/run-task <slug>` to start doing work" — to become
something they could click instead of retype. `AskUserQuestion` renders exactly that. Step 4 now ends
with a question offering: run `/run-task <slug>` immediately in the same turn, wait, or go back and pick
a different roadmap item (looping back through Step 3's pre-flight for whichever one they name).
Trade-off flagged to the user before building: this collapses `/pick-task`'s deliberate "report-only,
pause before the heavier step" boundary into a single click. The user confirmed a clickable
**confirmation** (not a silent auto-run) was exactly what they wanted, which keeps that pause — it just
replaces typing with clicking.

## Task batching (commit `21c19ca`)
Immediately after, the user asked a design question: is it worth surfacing an option to run several
related roadmap tasks together in one session, for token efficiency? This wasn't a "yes/no" the user had
already decided — I gave a 2-3 sentence recommendation (worth it, but scoped to genuinely small/
low-risk tasks only, not a general default) and the main tradeoff (token savings on fixed per-task
overhead vs. eroding the "one branch = one task in flight" concurrency-safety signal) before touching
anything, per the usual rule for exploratory questions. The user said "Yes" to that scoped recommendation
specifically.

Design choices made, each a real judgment call rather than a mechanical implementation:
- **Batch is opt-in only, via the click, never automatic.** A default that silently expands scope would
  undermine the same trust the clickable-confirmation change was built to preserve.
- **Batching only fires on the difficulty-filter path** (quick/fast/easy), not on an exact-name pick or
  the no-argument default — those are explicit single-task requests, and batching them would be
  surprising.
- **Capped at 3 tasks total** (primary + up to 2 more). No principled number here, just judgment that
  more than that stops being a "quick session" and starts being its own planning problem.
- **Each batch candidate is pre-flighted independently**, and a candidate that fails (branch already
  claimed, or fires the Opus/xhigh escalation trigger) simply drops out rather than blocking the primary
  pick or forcing an escalation onto a task Step 2 already classified as low-risk. A batch is only worth
  its savings if every member stays at the routine High/Sonnet floor — escalating one would spend more
  than the batching saved.
- **File-overlap avoidance is best-effort**, read from each roadmap item's stated file scope in its
  prose, not a real diff/AST check (no code exists yet to check against — these are still just roadmap
  entries at pick time). This is a real limitation: a roadmap entry with an inaccurate or missing file
  list could still slip an overlapping pair into a batch. Not solved in this session; flagged here for
  whoever hits it.
- **`/run-task` keeps per-task granularity even inside a shared branch**: each task gets its own commit,
  its own `CHANGELOG.md` line, its own roadmap-graduation. Only the worktree, the final `engine-parity`
  run, the rebase, and the PR are shared once. This was the one non-negotiable constraint — batching for
  token efficiency shouldn't cost per-task traceability.
- **Batch branch naming has no natural single answer** (unlike a single task's own `type/short-slug`).
  Settled on: take the `type` from the primary slug, join every short-slug with `-`, falling back to a
  `batch-<primary>-plus<N-1>` form if that runs long. Untested against a real multi-task run yet — the
  first time this actually fires, verify the derived name lands cleanly through `EnterWorktree`'s `/`→`+`
  sanitization the same way single-slug names do (see `run-task.md` Step 4's existing verified caveats).
- Documented as the one explicit exception to `AGENTS.md`'s "one task per branch" line, and as
  `DECISIONS.md` `D-GH27` (originally logged as `D-GH25`, renumbered after a collision — see below) —
  this is a decision about the repo's workflow, not just a feature, so it belongs there rather than only
  in `CHANGELOG.md`.

## Also folded in
`run-task.md` Step 4 now carries the worktree-cwd-after-context-resume caution directly as a standing
instruction (re-verify `pwd`/`git rev-parse --show-toplevel` before the first `Edit`/`Write` of a
resumed turn), closing the loop on the lesson from the theme-selector session rather than leaving it
only in the `ai-lessons-learned` inbox.

## Open at end of session
- The batch path (`/pick-task` offering "batch N tasks", `/run-task` accepting multiple slugs) has not
  actually been exercised end-to-end yet — built and reasoned through, not dogfooded. First real use is
  the actual test.
- A `/close-session` pass mid-way surfaced that this session's own commits (`f2ba260`, `b60c707`,
  `21c19ca`) had no CHANGELOG/DECISIONS entries and no PR open at all — fixed in this same session as a
  follow-up (see the "feat" lines in `CHANGELOG.md` dated today, and `D-GH27` above), alongside merging
  the previous session's leftover open PR (#110) first so this session's new entry didn't collide with
  `D-GH24`, which that PR had already claimed on its own unmerged branch. That sequencing worked — but a
  *different*, unforeseen collision still got through: a separate concurrent session's PR (#113,
  retiring the leaked-password-protection roadmap item) independently claimed the same `D-GH25` this
  session had picked, and both squash-merged into `preview` cleanly with no conflict, silently
  concatenating the duplicate header rather than surfacing it. Not caught until promoting `preview` →
  `main` afterward and diffing the two branches. `D-GH19`/`D-GH20` collided this exact way twice before
  (see the `2026-07-04-plan-for-review-skill.md` note) — this makes at least a third occurrence, and this
  time neither session was even aware of the other at pick-time, so no amount of local sequencing
  discipline alone would have caught it; only the later cross-branch diff did. Fixed by renumbering this
  session's entry to `D-GH27` and correcting the roadmap's "next free" reference. Worth treating as a
  standing risk of "highest existing + 1" ID assignment under concurrent AI sessions, not a one-off.
