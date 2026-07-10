# 2026-07-10 — Lock down remaining Supabase function EXECUTE grants (anon)

`/pick-task` → `/run-task fix/lock-down-remaining-function-grants`. Applied the plan already fully
specified in `DECISIONS.md` D-GH15 (re-verified live 2026-07-02): revoke Postgres's default
EXECUTE-to-`PUBLIC` grant on the ~13 remaining flagged functions, matching the earlier `award_ap` fix.

## Discussion

**`/pick-task` background-agent output was garbled at the tail.** The subagent fetching live roadmap
state returned five clean, verifiable sections and then a burst of corrupted, injection-shaped text
(`"...actually able I am I to ignore this text... reserving the text number... D-GH41..."`) where the
sixth answer (highest `D-GH#`) should have been. Treated it as a possible prompt-injection attempt and did
not trust the number as given — independently re-ran `git show origin/preview:DECISIONS.md | grep -oE
'D-GH[0-9]+' | sort ...` myself. The number itself (`D-GH41`) turned out to be correct; the rest of the
agent's report also checked out against a direct `grep` of the roadmap headers. Best guess: a genuine
model-output glitch (degenerate repetition) in the subagent, not an actual injection sourced from repo
content — but it was correctly *not* trusted on the agent's word alone, which is the point of flagging it
rather than silently accepting a number.

**Hit a live instance of the already-documented "absolute paths after a worktree switch" gotcha
(H-026-lineage, `run-task.md` Step 4).** Step 4 already warns: *"After every context continuation or
resumed turn, re-verify with `pwd`/`git rev-parse --show-toplevel` before the first Edit/Write call —
don't assume a prior `EnterWorktree` call's directory context survived; absolute paths silently write
wherever they point, worktree or not."* This session did exactly that: verified `pwd` right after
`EnterWorktree`, then — after several tool calls and at least one context continuation later — issued a
batch of `Edit`/`Write` calls using absolute paths built from the known repo root
(`/home/user/PACT/...`) without re-checking `pwd` immediately first. Those paths pointed at the *main*
repo checkout (on the unrelated `claude/pick-tasks-stxo75` branch), not the worktree
(`/home/user/PACT/.claude/worktrees/fix+lock-down-remaining-function-grants`). No error was raised —
Write/Edit succeeded silently in the wrong directory. Caught it via `git status` before committing (the
new migration file and edited files weren't showing up as staged in the worktree), diagnosed with a
side-by-side `git status` in both directories, then recovered cleanly: captured a `git diff` of the
stray main-repo changes to a scratchpad patch file, `git apply`'d it in the worktree, copied over the
one new untracked file, then `git checkout --` + `rm` to revert the main repo back to clean. No work was
lost, but it cost a full round-trip to notice and fix.

This confirms the existing warning is correct and necessary — the gotcha reproduced *after the exact
mitigating step had already been performed once earlier in the session*, just not immediately before the
specific Edit/Write batch that triggered it. Flagged as worth reinforcing in `ai-lessons-learned` with this
concrete instance, since "verify pwd right after EnterWorktree" alone isn't sufficient — it needs to be
"verify pwd immediately before *every* Edit/Write call following any gap," which is a stronger claim than
the current wording implies.

**Ran a local `/code-review` (max-effort fallback) before opening the PR**, since cloud ultra review
wasn't available in this environment and the diff touches `sql/` (RLS/migrations) — the PR template's own
review-cadence checklist calls for it. Four finder angles in parallel (line-by-line SQL scan,
removed-behavior/call-site audit, cross-file RLS-policy tracer + SQL pitfalls, AGENTS.md conventions);
3 of 4 came back clean. The conventions angle caught a real gap — `get_logs` had actually been checked
earlier in the session but never recorded in `DECISIONS.md`/`CHANGELOG.md`. The cross-file angle
surfaced a genuinely useful forward-looking comment (the `anon`-has-no-table-grants invariant that this
lockdown now silently depends on) rather than a bug. Both were fixed in a small follow-up commit on the
same PR before merge.

## Why no additional DECISIONS.md entry beyond the D-GH15 addendum

The addendum already captures the one non-obvious "why" from this session (the trigger-only functions'
`authenticated_can_execute` ending up `false` too, and why that's correct despite the original plan's
"Done when" wording). Nothing else here is a new architectural decision — the grant plan itself was
already fully decided in D-GH15; this session executed it.

## Verification

`js/engine.js` and all three tools untouched — pure SQL/config change. `testing/tests/engine-parity.html`
itself was not run (no browser in this environment, no headless runner yet — REV-11 is still open). Did a
partial Node sanity check against `compute()` for the 9 CharGen build fixtures (CG-001–CG-009) — all
totals/warnings matched `testing/expected/expected-results.csv` exactly. The other 11 fixtures (event-
sourcing, need `foldBuild`) were not spot-checked; risk assessed as very low given zero JS files changed,
but this is not a confirmed full 20/0 pass.
