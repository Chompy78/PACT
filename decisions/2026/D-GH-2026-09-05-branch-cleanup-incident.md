# D-GH-2026-09-05-branch-cleanup-incident — a merged-PR branch sweep deleted `main`, and why `preview` survived

**Status:** Recovered · `main` restored to its exact pre-deletion commit · branch-protection on `main` still
outstanding (owner action, not something a cloud session or this bot's GitHub tools can set).

## Context

Asked to "clean up" the repo's branches (91 at the time). Two independent lookups turned out to be
unreliable for this repo's specific shape, and trusting the second one anyway triggered a real incident.

**Lookup 1 — `git branch --merged` is not a valid safety check in a squash-merge repo.** This repo squash-
merges ordinary feature PRs (confirmed: `git log --merges` on `preview` is empty — a linear history of
single commits, each referencing its PR number). A squash creates a brand-new commit object combining the
PR's changes; the original branch's commits are never its ancestors. So `git branch -r --merged
origin/preview` reported **zero** branches as merged — including branches whose content had unambiguously
shipped (verified against `preview`'s own CHANGELOG). Correctly abandoned in favour of asking GitHub which
branches had a **merged pull request**, which is the real safety signal in a squash-merge workflow.

**Lookup 2 — the GitHub MCP tool's bulk PR list has an unreliable `merged` field.** `list_pull_requests`
with `state: closed` and a minimal `fields` projection returned `merged: false` for every single PR in the
result set, including PRs independently confirmed merged (`pull_request_read` with `method: get` on the
same PR number correctly returned `merged: true`). Bulk-list mode could not be trusted for this; a
per-PR `get` call is accurate but costs one API round-trip each, impractical at ~525 PRs.

**The recommendation that followed — `gh pr list --state merged --json headRefName | sort -u | xargs git
push origin --delete` — was accurate about *merged status* (`gh`'s own field is reliable, unlike the MCP
bulk-list mode above) but never excluded the repository's own protected branch names.** Two historical
PRs (#17, #37) had `head.ref: "main"` — a PR opened *from* `main` at some point, unusual but real — and at
least one was genuinely merged. `main` landed in the resulting `merged-branches.txt` alongside every real
stale branch, and the blind `xargs` delete removed it along with 84 legitimate ones.

**`preview` carried the identical exposure and did not go down.** PR #520 (a real `preview`→`main`
promotion) has `head.ref: "preview"`, `merged: true` — confirmed directly. `preview` was in the same
`merged-branches.txt`. It survived because **GitHub refuses to delete a repository's configured default
branch via git push, unconditionally, server-side** — and `preview` is this repo's actual GitHub default
branch. `main` had no equivalent protection because it isn't the default branch and had no branch
protection rule of its own.

## Recovery

`main`'s last commit before deletion (`00706c0dd2d0577eeebece8e134e1fb10143e800`) was still a live object on
GitHub's side — confirmed via `git cat-file -t` locally and the API's `get_commit` before touching anything.
Restored by pushing that exact SHA onto `refs/heads/main` from a local terminal with real git credentials
(a cloud session's own attempt at the identical push was declined by this session's own permission
classifier — a "let the user decide" denial, not the platform-level 403 that blocks a cloud session from
deleting a non-own branch). Verified byte-exact afterward via both `git ls-remote --heads` and the GitHub
API, from two independent tools.

## Why this matters going forward

- **A branch name appearing in a "merged" list is not sufficient confirmation that deleting it is safe.**
  The list has to be checked against the repo's own protected/default/production branch names before any
  bulk delete runs, every time — a historical PR can legitimately have a protected branch as its head.
- **Only `preview`'s status as the configured *default* branch protected it — not any explicit rule.**
  If the default branch is ever repointed (a plausible future action, e.g. if `main` were made default
  instead), whichever branch loses default status loses this protection with it, silently.
- **`main` has no protection today, and the live GitHub Pages site is served from it.** Recommended:
  enable "Restrict deletions" and "Restrict force pushes" on `main` via repo branch-protection settings —
  outside this bot's available GitHub tools (checked; no branch-protection endpoint is exposed), so it's
  an owner action, given as exact `gh api`/web-UI steps rather than done here.

## Verification

`main` at `00706c0dd2d0577eeebece8e134e1fb10143e800` — confirmed via `git ls-remote --heads origin main`
(raw git) and `list_branches` (GitHub API), independently agreeing. `preview` unchanged throughout at
`62a50ef42040ef872526aefc9c3fd4494d6f4769` (pre-restoration) — confirmed never actually deleted despite
being in the same target list. The two remaining non-default, non-`zcold` branches
(`claude/amble-character-dms-awards-igww1s`, `claude/tools-review-issues-y00cx8`) were individually
content-checked before recommending their deletion: the latter's tip commit is byte-identical to the head
of merged PR #448 (already shipped under a different branch name); the former's tip is a routine
version-sync commit already an ancestor of `main`'s current history. Neither carries unique unmerged work.
