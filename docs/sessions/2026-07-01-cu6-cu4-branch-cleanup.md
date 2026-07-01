# Session — 2026-07-01 · CU-6 rename, branch cleanup, CU-4, preview → main promotion

*History / non-authoritative. Authoritative state: `CHANGELOG.md`, `docs/PACT_ROADMAP.md`.*

## Goal
Work CU-6 (rename `DM Console.html` → `DM-Console.html`), then do general repo hygiene: merge
what's safely mergeable, delete stale branches, promote `preview` → `main`, and close out CU-4
(branch pruning) once that promotion landed.

## What we did

### CU-6 — DM Console rename
Renamed `tools/DM Console.html` → `tools/DM-Console.html` via `git mv`; updated every live
reference (`index.html` card link, `service-worker.js` PRE_CACHE entry, `AGENTS.md`,
`docs/VERSION-SYNC.md`). Left historical mentions (CHANGELOG.md, docs/sessions/, the code-review
doc) untouched — they describe past state. Verified via a local static server + Claude Preview:
engine-parity 5/0, DM Console loads cleanly at the new path with no console errors, index.html
card link resolves. Landed as PR #57.

### Concurrent-agent collision in the shared working directory
Mid-task, `git status`/`git branch --show-current` started returning branches and dirty files I
hadn't touched, and `git reflog` showed checkouts/commits I never issued. A second Claude Code
session was working the same on-disk checkout in parallel (on `fix/chargen-live-sheet-save`,
fixing the CharGen→Live Sheet save bug). Since HEAD, the index, and uncommitted edits are just
files on disk, two sessions sharing one checkout can stomp on each other's state. Worked around it
by using `git worktree add` for an isolated copy whenever a commit was needed, and did branch/PR
operations by pushing named refs rather than switching HEAD in the shared tree. No data was lost,
but it's fragile — flagged to the user that parallel sessions on the same clone should probably
use separate worktrees.

### Branch audit and cleanup
Surveyed all local + origin branches against `gh pr list`. Confirmed via content diff (not just
`git merge-base --is-ancestor`, since several were squash-merged) that the following were fully
superseded by already-merged PRs and safe to delete:
- Local: `docs/remove-ai-portrait-test`, `feat/campaign-rules-enforcement`,
  `feat/clone-features-roadmap`, `feat/livesheet-chargen-nudge`, `feat/local-ai-portrait`,
  `fix/cu-6-rename-dm-console` (post-merge).
- Origin: `fix/cu-2-dm-console-version` (PR #56, diffed byte-identical to `preview` modulo later
  cleanup) and `claude/remote-control-149hqs` (no PR ever opened; its one unique commit was
  byte-identical to content already on `preview` — a dead fork).

Two local branches (`docs/d-gh13-fix`, `feat/advancement-tracks`) were squash-merged but had
technically "unique" commits from git's perspective, so the harness blocked a force-delete without
explicit user confirmation. Before asking, checked both by hand:
- `docs/d-gh13-fix` — nothing left that wasn't already superseded in `preview`.
- `feat/advancement-tracks` — one real orphaned file: a REV-04 verification/memory session log
  committed to the branch *after* PR #53 had already merged, so it never reached `preview`.
  Recovered it via a new branch + PR #58 (docs-only, one file, 57 lines) rather than losing it.
  Merging PR #58 required the user's explicit go-ahead — the harness blocks an agent merging its
  own unreviewed PR on a vague instruction. Once the user confirmed, both branches were force-
  deleted.

### preview → main promotion
Diffed `origin/main` vs `origin/preview`: 14 commits ahead, no divergence. Merged cleanly in an
isolated worktree (no conflicts) — notably deletes `.claude/launch.json` from `main`, since that
file was already untracked on `preview` per REV-10 but `main` had never caught up. Pushed as PR
#59 (direct pushes to `main` are blocked for agents — production/GitHub-Pages branch, requires
human review) and merged on the user's instruction.

### CU-4 — branch pruning
With `main` caught up, checked every branch CU-4 named for deletion (`data/tools-v0.332`,
`engine/data-v0.332`, `feature/dual-source-ap`, `feature/live-sheet-dual-ap`,
`fix/engine-v0.332-data`, `task1/pwa-shell`, `task2/auth`, `task3/sql-data-model`,
`feature/campaign-play`, `feature/homepage-index`, `task2/auth-gate`) via `git show-ref` against
both local and origin refs. None existed — already cleaned up in an earlier session. Graduated
CU-4 as a no-op verification, logged in CHANGELOG.md.

### Roadmap corruption found on another branch
While checking the roadmap file, noticed `fix/chargen-live-sheet-save` (the other concurrent
session's branch) had its own "CharGen → Live Sheet button does not save character" TODO block
in `docs/PACT_ROADMAP.md` replaced by a stale, already-closed copy of the CU-6 TODO block —
likely a bad merge/rebase artifact from working off an older `preview` snapshot. This hadn't
touched shared `preview`/`main`, so nothing was fixed here directly (it's someone else's
in-progress branch); instead, wrote a paste-ready prompt for that session describing the
corruption and how to reconcile it before merging.

## Notes
- All roadmap/changelog graduations in this session were pushed directly to `preview` (docs-only,
  no branch/PR) per the established convention — matches how `add-roadmap-task` and prior
  graduations have been done.
- No `DECISIONS.md` entry — nothing this session involved a non-obvious architectural trade-off
  (a rename, a branch audit, and a mechanical promotion don't need a D-GH code).
- Parity gate unaffected throughout (no `js/engine.js` or `compute()` changes).
