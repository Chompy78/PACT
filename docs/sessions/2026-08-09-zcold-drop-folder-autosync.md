# 2026-08-09 — building an auto-pushed drop folder, and the branch-checkout trap that reshaped it

Started as a small ask — "let me drop files in a `z-cold` folder and have them pushed to GitHub" — and
went through three real designs before landing on one that actually holds up. Also touched `PACT_Players`,
which got the identical treatment in parallel; see its own session note for that side.

## Why the downloaded tool didn't fit

The owner had already downloaded `git-auto-sync_1.5` for this. Checking its actual `--help` output (not
assuming from the README) showed it only watches/commits at **whole-repo** granularity — `daemon add
<repoPath>` has no subfolder scoping. Pointing it at a real project clone would auto-push *any* change
anywhere in the repo, not just a drop folder — a non-starter for a repo with real in-progress work in it.

## Attempt 1: plain tracked folder + scoped script

Simplest fix for the scoping problem: don't use `git-auto-sync` at all. A small PowerShell loop polling
every ~5s, running `git add z-cold z-uploads` (pathspec-scoped, so it can never sweep in unrelated edits)
→ commit → pull --rebase → push. Worked, and fast — but only survived as long as `preview` stayed checked
out.

It broke on the sibling repo first: `PACT_Players` got switched to a feature branch mid-session for
unrelated context, and its drop folders vanished from disk. Root cause is structural, not a bug — `git
checkout` swaps the working tree to match whatever branch is current, and the folders were only tracked on
`main`. The same failure mode was always latent here too, just hadn't been triggered yet.

## Attempt 2 (rejected) and Attempt 3 (shipped): decoupling from whatever branch is checked out

A nested sparse-clone-plus-symlink design was sketched but abandoned once the real constraint became
clear: git refuses to check the same branch out in two places at once, so nothing keeps a folder "always
checked out" on `preview` itself while the main working copy is elsewhere.

What shipped instead: a **dedicated orphan branch** (originally `zcold-data`, renamed to `zcold` at the
owner's request partway through — see below) holding only `z-cold`/`z-uploads`, checked out permanently
into its own **git worktree** outside the repo (`~/dev/zcold-sync/worktrees/PACT`), linked into the real
repo folder via a Windows **junction**. `preview` no longer tracks these folders at all — `.gitignore`'d —
so no future branch switch, on either repo, can make them disappear again. Full reasoning in
`D-GH-2026-08-09-zcold-autosync-setup`.

The watcher script itself (`~/dev/zcold-sync/zcold-watch.ps1`) isn't part of this repo — it's a single
shared script on the owner's machine covering every project's worktree, run as Windows Scheduled Task
`ZColdSync`.

## The incident: an existing folder got swept up mid-build

While the watcher was already live (attempt 1's version, before the worktree redesign), the owner moved
the contents of a pre-existing `z-cold-reviews/` folder (23 AI-model review `.md` files, unrelated to this
work) into the new `z-cold/`. The watcher did exactly what it was built to do and auto-pushed it within
seconds — before there was any chance to ask first. Caught immediately via `git status` showing 23
pending deletions at the old path; confirmed with the owner that the move was intentional, then finalized
cleanly (old path's removal committed) and carried the content through into the final worktree design so
nothing was lost.

## Branch rename mid-session

The branch was originally named `zcold-data`. The owner asked to rename it to `zcold` partway through —
done via `git branch -m` + push-new/delete-old on the remote in both repos, then the watcher config,
worktree READMEs, and this project's own `DECISIONS.md`/`CHANGELOG.md` text (already drafted with the old
name) all updated to match before this session closed.

## Net result

`z-cold`/`z-uploads` in the `PACT` working copy are junctions into
`~/dev/zcold-sync/worktrees/PACT`, permanently on branch `zcold`, auto-synced every ~5s, completely
decoupled from whatever branch `preview` happens to be on. Verified end-to-end (drop → committed → pushed
→ confirmed on the remote) twice, before and after the rename.

**Next session should know:** to add another project to this pattern, it's a repeatable set of steps
(orphan branch via plumbing, worktree, junction, `.gitignore`, one more `$Config` entry in
`zcold-watch.ps1`) — not yet extracted into a script of its own, since only two repos use it so far.
