# 2026-07-17 — /code-review ultra on the merged sweep-tasks skill, /sweep-tasks live run, promote

## What happened, in order

1. **`/code-review ultra` on the already-merged `/sweep-tasks`/`/add-task` skill** (PRs #243/#244, the
   full feature since the last `preview`→`main` promotion). Four finder-agent passes (3 initial + 1
   gap-sweep) surfaced 16 candidate findings, deduped to 15 under the review's cap. Fixed all 15 in
   `docs/sweep-tasks-review-fixes` (PR #245): worktree/branch leaks on park paths, `TaskList` entries
   left stuck `in_progress`, no cap-backfill on drop/park, an undefined bumped-to-`ultra` review tier,
   an undefined PR-number-capture mechanism, unvalidated `$ARGUMENTS` batch-size parsing, unguarded
   direct pushes to `preview`, a diff-size-check contradiction with `add-task.md`'s own Effort:medium
   example, a missing cross-tool-migration Ambiguity callout, plus stale-doc fixes in
   `docs/TASK_BOARD.md` and `AGENTS.md`.

2. **Self-review cascade — the fix pass got reviewed too.** Before merging PR #245, ran `/code-review
   high` against the fix commit itself (not just the original skill). That pass found **9 new gaps the
   fix pass had introduced**, the most notable being a genuinely wrong fix: the stray-branch-name
   correction initially named the branch `worktree-<slug>`, but `run-task.md`'s actual `EnterWorktree`
   convention substitutes `+` for `/` in the full `type/short-slug` (`worktree-<type+short-slug>`). This
   was only caught because the self-review checked the claim against `run-task.md` directly rather than
   trusting the first fix's memory of the convention — worth generalizing: **a fix that references
   another file's documented behavior should be verified against that file, not written from recall.**
   Fixed all 9, merged PR #245.

3. **The worktree-base gotcha (AGENTS.md's documented known issue) recurred a third time** in this
   session, once per worktree entered (PR #245's fix-round worktree, and again for PR #246's). Each
   time, `EnterWorktree` silently based on a stale snapshot; each time, the sharper check
   (`git merge-base HEAD origin/preview` must equal `origin/preview`'s exact SHA, not the weaker
   `--is-ancestor` check the doc shows) caught it before any work was lost. The fix documented in
   AGENTS.md works — it's just not preventive, only detective, so it keeps firing.

4. **A new gotcha, not previously documented: a shared checkout can serve a stale Skill.** Invoking
   `/sweep-tasks` initially loaded the *pre-risk-model-v2* version of the skill's own instructions (the
   old binary `Effort ≤ medium AND Risk: low` gate), because the main session's local checkout
   (`/home/user/PACT`, branch `preview`) was still sitting at PR #243's merge — it had never been
   fast-forwarded past PR #244 or #245, even though `origin/preview` had both. The `Skill` tool reads
   `.claude/commands/*.md` from the *local working directory*, not from `origin`, so a session that
   only ever pushes from worktrees (never updating its own root checkout) can silently execute an old
   version of its own tooling. Caught because the loaded skill text visibly didn't match what had just
   been written (wrong gate wording). Fixed with `git fetch && git merge --ff-only origin/preview` on
   the root checkout, then re-invoked — this is the durable lesson, and is worth a cross-project
   `ai-lessons-learned` entry (drafted below, not yet pushed).

5. **Ran `/sweep-tasks 1` for real** (once loaded correctly). One eligible task: "Shared
   `onAuthChange(event, session)` wrapper" (`Risk: medium`). The other open roadmap task, "Engine review
   cleanup," is `Risk: high` and correctly never became a candidate.

6. **Implemented the task** (PR #246): added `onSessionChange(session)` to `js/auth.js`, migrated
   CharGen's 3 call sites and DM Console's 1 to it. Left Live Sheet's single call site on the raw
   `onAuthChange`, since it genuinely needs the event string for a `SIGNED_OUT`-specific branch — a
   deliberate resolution of a real tension in the task's own text (step 1 explicitly permitted this
   carve-out; the "Done when" line's "all 5 call sites use it" read more strictly). Logged as
   `D-GH-2026-07-17-shared-auth-change-helper` with the full reasoning, since a future agent could
   reasonably read "Done when: all 5" and conclude the task wasn't actually finished.

7. **`/code-review medium` on PR #246** — correctness angle came back fully clean (no findings);
   cleanup/altitude/conventions angle found 2 real issues: CharGen and DM Console still imported/bridged
   the now-unused raw `onAuthChange` after migrating their only call sites, and Live Sheet bridged the
   now-unused `onSessionChange`; separately, the CHANGELOG's lead sentence read as if Live Sheet's
   historical bug site was now structurally protected too, when it deliberately wasn't. Both fixed.

8. **Live-verification requirement (mandatory, `Risk: medium`).** Attempted a full real-browser sign-in
   flow via Playwright, serving the worktree locally. Discovered this sandbox cannot reach the
   `esm.sh` CDN (which serves `@supabase/supabase-js`) even through the configured agent proxy —
   `curl` through the identical proxy succeeded, but Chromium consistently got `ERR_CONNECTION_RESET`
   regardless of `--proxy-server`, `--proxy-bypass-list`, or `--ignore-certificate-errors` combinations
   tried. This looks like a Chromium-specific request-shape quirk against this particular proxy/CDN
   pair, not a code defect — but it means full end-to-end signed-in browser verification isn't
   currently possible from this environment for anything that loads the Supabase CDN. Substituted two
   partial but real checks instead of silently skipping the requirement: (a) a Node-level functional
   test that mocks Supabase's `onAuthStateChange(cb)` emitter and confirms `onSessionChange` correctly
   unwraps `(event, session)` → `session` on both `SIGNED_IN` and `SIGNED_OUT`; (b) a 3-tool headless
   page-load smoke check confirming no `pageerror`/crash and correct graceful degradation when the CDN
   is unreachable (exactly the behavior the tools' own code comments say they're designed for). Recorded
   this limitation explicitly rather than treating the partial checks as if they were the full thing.

9. **CI passed** (`audit`, `lighthouse`, and the real `character-gen-e2e` suite, which drives all three
   tools) on PR #246 — merged. Worktree/branch discard was verified safe first (local tip ==
   `origin/refactor/shared-auth-change-helper` == the just-merged PR) before `discard_changes: true`.

10. **Promoted `preview` → `main` on explicit request** ("promote"). Followed the established pattern
    (a PR from `preview` into `main`, matching the shape of earlier promotions like PR #242) rather than
    a direct fast-forward, so it goes through the same CI gate as any other PR. Waited for `audit`/
    `lighthouse`/`e2e` via a `Monitor` poll loop (not a raw `sleep`, which this environment blocks for
    standalone waits) before merging. `origin/main` and `origin/preview` are now in sync (0 commits
    apart).

## Why this is worth keeping as a note

Three of `/close-session`'s trigger conditions are genuinely met, not just technically met: (a) the
Live-Sheet-carve-out is a design choice a future agent could reasonably second-guess against the task's
own literal "Done when" wording — the reasoning needs to survive independently of this session's context;
(b) the stale-checkout-serves-a-stale-Skill discovery is a real mid-session pivot (the sweep had to be
aborted and restarted once the local checkout was resynced) and is generalizable beyond this repo; (c)
three separate pieces of work (two rounds of skill-file fixes, one roadmap task, one promotion) landed in
a single sitting, cascading from one review into the next.

## Candidate `ai-lessons-learned` entry (drafted, not pushed — needs approval)

- **Trigger:** invoking a Claude Code skill/slash-command (or any prompt file read from the local
  working tree) in a session whose root checkout is a long-lived shared directory that worktrees branch
  off of, but that the session itself rarely `git pull`s.
- **Rule:** a skill's instructions are read from the *local* filesystem at invocation time, not from
  `origin` — a root checkout that's fallen behind `origin/<default-branch>` (because all the session's
  actual commits happened in short-lived worktrees that got merged and torn down) will silently execute
  an outdated version of its own tooling, with no error, no warning, just wrong/old instructions. Before
  invoking a skill whose own file may have changed recently (especially right after merging a PR that
  touched `.claude/commands/`), fast-forward the root checkout first: `git fetch origin <branch> &&
  git merge --ff-only origin/<branch>`.
