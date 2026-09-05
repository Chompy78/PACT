# 2026-09-05 — a branch cleanup deleted `main`, and the two lookups that didn't work first

**Decision:** `D-GH-2026-09-05-branch-cleanup-incident`. Follows the same session's roller Hit-Dice
close-out (PR #525) and the `roll-headless.mjs` headless-roller addition — this note covers only the
branch-cleanup half.

## How it started

The owner asked to "clean up" the repo's branches after PR #525 merged — 91 at the time. The obvious first
move, `git branch -r --merged origin/preview`, reported **zero** branches merged. Not a bug in the check —
this repo squash-merges every ordinary feature PR (confirmed: `git log --merges` on `preview` is empty),
and a squash creates a brand-new commit combining the PR's changes, so the original branch's commits are
never ancestors of anything on `preview`. Git ancestry is simply the wrong question for this workflow.

The right question is "does this branch have a merged PR", so the next attempt used the GitHub MCP
server's `list_pull_requests` in bulk (`state: closed`, a minimal `fields` projection to keep the payload
small over ~525 PRs). Every single result came back `merged: false` — including PRs independently
confirmed merged seconds later with a per-PR `pull_request_read(method: get)` call on the exact same
number, which correctly returned `true`. The bulk-list mode's `merged` field just isn't trustworthy here;
paying the round-trip cost per PR wasn't practical at that scale from this session.

So the recommendation handed to the owner was to run it from a local terminal with `gh`, whose own
`merged` field is accurate: `gh pr list --state merged --json headRefName | sort -u > merged-branches.txt`,
then `xargs -a merged-branches.txt -I{} git push origin --delete {}`.

## What that script actually deleted

It worked — 85 real stale branches went, cleanly, dropping 91 down to 6 on the owner's first check. But
buried in the same run: `error: unable to delete '...' : remote ref does not exist` lines for branches
already gone (harmless, expected), and — not flagged as an error at all — `main` was deleted.

Root cause, found by checking: two historical PRs (#17 and #37) have `head.ref: "main"` — a PR opened
*from* `main` itself, which is unusual but real, and at least one of them was genuinely merged. `gh pr
list --state merged` correctly reported that, `main` landed in `merged-branches.txt` next to every real
stale branch name, and the blind `xargs` delete removed it with the same command that cleaned up
everything else. The script was accurate about merge status and still wrong, because it never excluded
the repo's own branch names before trusting the list.

## The part that could have been a second incident

`preview` — the branch this whole cleanup was framed around protecting — carries the **identical**
exposure. Dozens of real promotion PRs (`preview`→`main`) have `head.ref: "preview"`, confirmed merged
(checked PR #520 directly). `preview` was in `merged-branches.txt` too. It didn't go down, and the reason
has nothing to do with anything this session or script did: **GitHub itself refuses to delete a
repository's configured default branch via git push, unconditionally, server-side** — and `preview` holds
that status in this repo, per `AGENTS.md`. `main` had no equivalent protection, because it isn't the
default branch and carries no branch-protection rule of its own.

Worth being explicit about the shape of this: `preview`'s safety was incidental to it being the default
branch, not to anything that recognized it as important. If the default branch designation ever moves
(plausible — `main` is the one actually serving GitHub Pages), whichever branch loses that status loses
the protection with it, silently, and nothing else stands in the way next time.

## Recovery

`main`'s last commit before deletion, `00706c0dd2d0577eeebece8e134e1fb10143e800`, was still a live commit
object on GitHub's side — checked with `git cat-file -t` locally (present) and the API's `get_commit`
(present) before touching anything, rather than assuming a dangling commit survives indefinitely. This
session's own attempt to push it back onto `refs/heads/main` was declined by the session's own permission
classifier — a "let the user decide" denial explaining itself and naming the settings path to allow it,
distinct from the hard platform-level 403 a cloud session hits when it tries to delete a branch that isn't
its own working branch. The owner ran the identical push from a local terminal with real git credentials;
it succeeded immediately. Verified byte-exact afterward two independent ways — raw `git ls-remote --heads`
and the GitHub API's `list_branches` — before saying it was fixed.

## What's still open

- **Branch protection on `main`** ("Restrict deletions", "Restrict force pushes") — recommended, not yet
  applied. No tool available in this session's GitHub MCP server exposes branch-protection settings
  (checked twice, searched broadly); it needs the web UI or a `gh api` call from a terminal, both handed
  to the owner as exact steps.
- **Two orphaned branches** (`claude/amble-character-dms-awards-igww1s`,
  `claude/tools-review-issues-y00cx8`) — individually content-checked and confirmed to carry nothing
  unique (one's tip is byte-identical to merged PR #448's head under a different branch name; the other's
  tip is a routine version-sync already an ancestor of `main`), but not yet deleted as of this note.

## Worth generalizing

The actual lesson isn't "check git ancestry" or "use `gh` over the MCP bulk-list mode" — those are this
repo's specific facts. It's that **a branch name appearing on any "safe to delete" list, however it was
derived, still needs to be checked against the repository's own protected/default/production branch names
before a bulk delete runs against it.** A historical PR can legitimately have a protected branch as its
head; "this name is in the merged list" and "this name is safe to delete" are different claims, and only
one of them was actually verified here before the script ran. `/log-lesson-universal-jc` is reserved for
explicit user invocation (an agent can't trigger it on its own), so this is flagged here as a candidate
for `ai-lessons-learned` rather than actually logged — run it manually if it's worth capturing there.
