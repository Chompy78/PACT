# Session: feedback-widget checkbox layout + A6 graduation + a small roadmap sweep

**Date:** 2026-07-19 · **PRs:** #267, #269 (both merged into `preview`) ·
**Branch (this session's own, unmerged):** `claude/custom-commands-skills-dfmgbn` (A6 graduation only)

Why this note exists: two roadmap items landed together in one `/sweep-code-tasks` run, the sweep collided
with another session's already-in-flight work on two of its three eligible candidates, and mid-run
verification surfaced a second, previously-invisible bug that had to be spun out as its own task rather than
silently folded in or ignored.

## What happened, in order

1. **A6 graduation.** User confirmed the "tag releases to build version" roadmap item (A6) was already done
   (`v0.107` tagged 2026-07-17). Removed its `docs/TASK_BOARD.md` entry and logged the graduation in
   `CHANGELOG.md`, committed on this session's own designated branch (`claude/custom-commands-skills-dfmgbn`,
   commit `3aca0f2`) per the session's branch instructions — **not yet a PR**, since it wasn't asked for.

2. **`/add-code-task`**: formatted and committed a new low-risk task directly to `preview`
   (`fix/feedback-anon-checkbox-inline` — inline the feedback widget's "submit anonymously" checkbox with
   its contact note) per that skill's direct-commit carve-out.

3. **`/sweep-code-tasks low and medium effort. low risk` (batch cap 8, user-picked)**:
   - Of 6 `— TODO` tasks on the board, 3 were `Risk: high` (excluded outright) and 3 were `Risk: low`
     (eligible).
   - **Collision with another session:** 2 of the 3 eligible candidates (`fix/chargen-live-rules-version`,
     `docs/agents-version-refresh`) already had open PRs (#254, #255) from elsewhere — dropped at
     pre-flight per the branch-already-exists rule, not touched. (Both merged independently, by whoever
     opened them, later in this same session — confirmed via `pull_request_read` during this close-out.)
   - Only 1 candidate survived: `fix/feedback-anon-checkbox-inline`. Implemented, real-browser-verified
     (Playwright/Chromium against an isolated harness with a stubbed Supabase client, since the real
     `supabase-client.js` imports from `esm.sh` and this sandbox's network policy reset the connection —
     the stub let the exact same `js/feedback.js` file run in a real DOM without that dependency).
     Merged as **PR #267**.
   - **Mid-verification discovery:** the signed-out state showed an unexpected empty checkbox. Root-caused
     to a CSS specificity collision — `.pact-fb-anon{display:flex}` (present before this session, unrelated
     to the layout change) has the same specificity/origin as the browser's built-in
     `[hidden]{display:none}` and wins by source order, so `anonWrap.hidden = true` never actually hid the
     row. Confirmed this predates the session's own change by testing the unmodified file straight from
     `origin/preview`. Filed as its own task directly to `preview` per the sweep skill's Step 5 (no
     approval-wait, by design), immediately cleared the `Risk: low` bar, and got folded into the same run's
     queue rather than left for later. Fixed (`.pact-fb-anon:not([hidden])`) and merged as **PR #269**.
   - Circuit breaker never triggered — both merges were clean, no code-review findings, no CI configured
     on either PR (checked via `pull_request_read` → `get_status`, `total_count: 0`).

## Why a real-browser check mattered here (not just the parity gate)
`testing/tests/engine-parity.html` only covers `js/engine.js`'s `compute()`/replay logic — it has no
visibility into a plain DOM/CSS widget like `js/feedback.js`. The CSS specificity bug above would never
show up in that gate; it was only found because the task's own "Done when" required a real-browser check,
and the isolated-harness approach (stub the one network-dependent import, keep everything else real) made
that check possible in a sandboxed environment with no route to `esm.sh`.

## State at close-out
- `preview` has since moved further ahead (another session merged #254/#255 and added an unrelated roadmap
  task) — nothing in that drift is this session's own work; see `git log` for the current tip.
- `claude/custom-commands-skills-dfmgbn` (this session's A6 commit) is unmerged and now 12 commits behind
  `preview` — would need a rebase before any PR.
