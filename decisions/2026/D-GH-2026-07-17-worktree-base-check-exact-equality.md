# D-GH-2026-07-17-worktree-base-check-exact-equality — ancestry checks can't detect a post-promotion mis-base

Status: Active

- **Context:** entering a fresh worktree for a `docs/SKILLS.md` sync task, right after promoting
  `preview` → `main` (PR #248) earlier the same session. The worktree-base check appeared to pass, work
  proceeded, and the subsequent `git rebase origin/preview` tried to replay **196 commits**, including
  a `Merge pull request #95` from far back in the repo's history — the unmistakable signature of a
  worktree based on the wrong branch.
- **Options:**
  1. Keep the ancestry check (`git merge-base --is-ancestor origin/preview HEAD`, as documented in
     `run-task.md`, or the tighter `git merge-base HEAD origin/preview` compared against
     `origin/preview`'s own SHA, which this session had been using ad hoc after catching this class of
     bug twice earlier) and just re-run it more carefully.
  2. Switch to an exact-equality check: `git rev-parse HEAD` must literally equal `git rev-parse
     origin/preview`.
- **Decision:** (2). Neither ancestry form is actually safe. The moment `preview` is promoted into
  `main` via a merge commit, `origin/preview`'s tip becomes an ancestor of `origin/main`'s tip **by
  construction** — that's the entire point of the merge. So if `EnterWorktree` silently bases a new
  worktree on `origin/main` instead of `origin/preview` (its documented, recurring failure mode —
  `worktree.baseRef: 'fresh'` branches from the repo's *GitHub default branch*, and this repo's default
  is `preview`, but the resolution has been observed to pick `main` before), an ancestry check against
  `origin/preview` still reports "yes, reachable" — truthfully, but uselessly, since reachable-via-main
  is not the same as based-on-preview. Exact equality has no such gap: right after a fresh
  `EnterWorktree` call with zero edits made, HEAD **must** be bit-identical to whatever ref it branched
  from, full stop — there's no valid state where it's merely "related to" the intended base.
- **Why:** this was found because the failure mode recurred a *third* time in one session, twice caught
  by the (already-insufficient) ad hoc ancestry check and once slipping past it entirely — the pattern
  of "the documented fix works, but only detects the failure mode it was written for, not related
  failure modes with the same root cause" is exactly what an exact-equality check closes, since it
  doesn't reason about *why* HEAD might be wrong, only *whether* it matches.
- **Status:** Active — `run-task.md` Step 4 updated; `sweep-tasks.md`'s worktree re-entry flow was
  checked and needs no equivalent fix, since it unconditionally `git reset --hard`s onto the target
  feature branch immediately after `EnterWorktree` regardless of what any check would report.
