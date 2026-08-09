# D-GH-2026-08-09-zcold-autosync-setup

**Context.** The owner wanted a way to drop files into a folder inside their local clone and have them
pushed to GitHub automatically, without needing to remember to commit/push, and without that automation
touching any of their normal in-progress work elsewhere in the repo. They'd already downloaded
`git-auto-sync_1.5` for this.

**Options considered.**
1. `git-auto-sync`'s daemon, pointed at the whole repo clone — rejected: it watches/commits at
   whole-repo granularity (confirmed via `--help` on `watch`/`daemon add`, no subfolder scoping exists),
   so it would auto-push unrelated in-progress edits anywhere in the repo, not just the drop folder.
2. A nested nested-clone + junction trick (second sparse clone of the same remote/branch, symlinked in)
   — abandoned mid-design once the branch-locking problem below was understood; superseded by option 4.
3. `z-cold`/`z-uploads` as plain tracked folders on `preview`, auto-committed by a small polling script
   scoped to just those paths (`git add z-cold z-uploads`) — implemented first as the "quick" version.
   Failed in practice: switching the *sibling* `PACT_Players` repo to a feature branch made its
   drop-folders vanish from disk, because git checkout swaps the working tree to match whatever branch is
   current, and the folders were only tracked on `main`/`preview`. Root cause is structural (git can't
   check out two different branches into one worktree at once), so this would recur for PACT too the
   first time `preview` isn't checked out.
4. **[Chosen]** A dedicated orphan branch (`zcold`) holding only `z-cold`/`z-uploads`, checked out
   permanently into its own **git worktree** (outside the repo, at
   `~/dev/zcold-sync/worktrees/PACT`), linked into the real repo folder via a Windows **junction**
   (`New-Item -ItemType Junction`). `preview` (and every other branch) no longer tracks these folders at
   all — they're `.gitignore`'d — so no branch switch can ever make them disappear again.

**Decision.** Implemented option 4, for both this repo and `PACT_Players`. A small external PowerShell
script (`~/dev/zcold-sync/zcold-watch.ps1`, **not part of this repo** — lives once on the owner's machine
and covers every project) polls both worktrees every ~5s; when either has new/changed/deleted files under
`z-cold`/`z-uploads`, it stages *only those paths*, commits, rebase-pulls, and pushes to that repo's
`zcold` branch. Runs as Windows Scheduled Task `ZColdSync`, starting at logon.

**Why.** A worktree is the only way to have a path be "always checked out" independent of whatever branch
the human has open in their normal working copy — git explicitly refuses to check the same branch out
twice, which is what ruled out keeping the content on `preview` itself. The trade-off: dropped files are
technically on a separate branch, so browsing them on github.com means switching to `zcold` rather
than seeing them under `preview`'s normal tree. Locally this is invisible — the junction makes
`z-cold`/`z-uploads` look and behave like ordinary folders regardless.

**Incident during setup:** the owner had a pre-existing `z-cold-reviews/` folder (23 AI-model review
`.md` files) and moved its contents into the new `z-cold/` while the (at-that-point whole-repo-unaware)
watcher was already running — it auto-committed and pushed that content within seconds, before this
worktree design was in place. Confirmed intentional with the owner and finalized as a clean move (old
path's deletion committed, content preserved under the new `zcold` branch).

**Status:** DECIDED and SHIPPED (2026-08-09). `z-cold`/`z-uploads` junctions live in the repo root;
`.gitignore` carries the exclusion; `zcold` branch pushed to `origin`. No open follow-up.
