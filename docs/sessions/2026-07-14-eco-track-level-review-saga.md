# 2026-07-14 — Live Sheet eco-line/Track-Level curve unification + review saga

## Context
Picked via `/pick-task easy`: the 🟡 NEXT roadmap task "Live Sheet economy-line: tuned-curve vs
earned-AP pace readout" (`feat/livesheet-eco-track-level`) — a follow-up from `feat/advancement-tracks`
(PR #206), which had unified the header's `≈ Track-Level` chip onto the campaign's DM-tuned
`levelBudgetCurve` but left the separate `#eco` line's "Lv" chip reading `eco.earned` against the old
fixed `DATA.levelAP` ladder. The task asked for a decision among three framed options — (a) keep it as a
pure earned-AP pace readout, (b) move it onto the tuned curve, or (c) show both, clearly labelled — and
implementation. Landed on effectively (c), with the curve mismatch itself fixed as part of it (see
`D-GH-2026-07-14-livesheet-eco-track-level` in `DECISIONS.md` for the full reasoning).

Then, at the user's request, ran an independent multi-angle `/code-review` (8 finder agents + 1-vote
verification per candidate) against the merged PR. It surfaced 6 findings that survived verification.
4 were fixed inline in a follow-up PR (#211); 2 needed a design call spanning other tool files and were
filed as roadmap tasks instead (`D-GH-2026-07-14-livesheet-eco-track-level-review-followups`).

## Tooling: `EnterWorktree(name:)` failed with a spurious EEXIST
`EnterWorktree(name: "feat/livesheet-eco-track-level")` failed twice with `EEXIST: file already exists,
mkdir '...\.claude\worktrees'` — the parent directory clearly already existed (and was writable; another
session's worktree was already inside it). Root cause unconfirmed, but plausibly a race with a concurrent
session's own worktree creation touching the same parent directory at the same Windows-filesystem moment.

**Workaround:** manual `git worktree add -b <branch> .claude/worktrees/<sanitized-name> origin/preview`,
then `EnterWorktree(path: <that path>)` to attach the session to the already-created worktree. This
succeeded cleanly and is the fallback worth reaching for immediately rather than retrying `name:` a third
time — it produced the identical location `EnterWorktree` would have used.

**Follow-on cost:** because the worktree was entered via `path:` rather than created via `name:`, this
session was never tracked as the worktree's "owner" — `ExitWorktree(action: "remove")` later refused with
"this session is not the owner." Had to `ExitWorktree(action: "keep")`, then manually `git worktree
remove` from the main repo. That itself partially failed too (see below).

## Real merge conflict with a concurrent session (PR #210)
Mid-session, `docs/PACT_ROADMAP.md` — a file this repo's own `AGENTS.md` explicitly flags as
single-writer, "agents output new items in this format for the human to fold in, don't append directly"
— collided anyway: another concurrent session inserted a new task (`Tools: back-to-Home navigation...`)
in the exact same location this session's commit was deleting its own now-completed task from. `git
rebase origin/preview` surfaced a real conflict, not a stale one. Resolution was mechanical once seen —
keep the deletion, keep the other session's insertion — but it needed a real `git merge-tree`/rebase to
even see the shape of it. **Lesson:** an explicit "don't append directly" house rule is necessary but not
sufficient in a genuinely concurrent multi-agent workflow — collisions still happen, and the fix is to
treat conflict resolution as a routine step (verify what each side actually changed, resolve, re-test),
not an exceptional one.

## GitHub's `mergeable`/`mergeStateStatus` lagged real state (twice)
After merging PR #210, PR #211 (opened before #210 merged) started reporting `mergeable: CONFLICTING`.
A local `git merge-tree` against the base/branch/`origin/preview` triple showed **no actual conflict
markers** — and a real `git rebase origin/preview` on PR #211's branch completed cleanly with zero
conflicts. The GitHub API's cached mergeability field had not yet recomputed after a nearby merge; it
looked identical to a real conflict from the API alone. This happened a second time later in the same
session (PR #211 vs. a concurrent PR #212 landing on `preview`) with the same false-positive shape.

**Lesson for future sessions:** `gh pr view --json mergeable,mergeStateStatus` is a *hint*, not ground
truth, especially in the seconds/minutes after the base branch or the PR's own branch changes. Before
treating a reported conflict as real (and before asking the user to weigh in on how to resolve it),
verify with a stateless local check — `git merge-tree <base> <ours> <theirs>` for a quick look, and a real
`git rebase`/`git merge --no-commit` attempt as the actual ground truth — since the API field can say
`CONFLICTING` or `UNKNOWN` for a window even when the real merge is clean.

## Safety-classifier gate on an unreviewed self-authored merge
An initial `gh pr merge 210 --merge` attempt (immediately after the user picked "merge, then review" from
a lettered option list) was blocked by the auto-mode permission classifier: "merging its own self-authored
PR into the protected `preview` branch with no visible evidence of human approval." The user's prior
answer *was* the approval, but the classifier couldn't see that context in the bare command. Resolved by
explaining the situation and getting an explicit `AskUserQuestion` confirmation before retrying — worth
remembering that even an already-confirmed user choice may need re-stating in a way a safety layer can see,
rather than assuming the harness carries context the gate itself can inspect.

## Outcome
- PR #210 (original unification) — merged.
- PR #211 (4 review-follow-up fixes: triple curve resolution per render, explicit-`0` discarded,
  negative/zero `inc` breaking monotonicity, a truthy-check "top level" mislabel) — merged, rebased
  cleanly over the concurrent PR #212 despite the false-conflict signal above.
- PR #213 (roadmap tasks for the 2 deferred findings: DM Console's untuned roster, the level-lookup loop
  duplicated across 3 tool files) — merged.
- `testing/scripts/engine-parity-ci.mjs` stayed 20/0 through every step (display-only throughout, no
  `js/engine.js`/`DATA.version` involvement).
- Branches for all three merged PRs cleaned up (local + remote) in the same close-session pass as this
  note.
