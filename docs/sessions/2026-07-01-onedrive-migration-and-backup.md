# 2026-07-01 — OneDrive migration, nightly backup, and skill wording pass

## What happened

Started from a request to make `/next-task` easier to understand and to check whether its
always-ask-for-High-effort behavior was working as designed (it was — Step 3's effort gate is an
intentional hard stop, not a bug). Reworded the whole command in plainer language, no functional change.
Same pass produced `/close-session`: a report-only checklist for wrapping up a session (docs, roadmap
graduation, test gate, working tree, worktrees, branch sweep, preview/main sync, open PRs), with findings
surfaced as a flat `A1`/`A2`/... action list so the user answers once instead of confirming each item
individually.

Along the way, a promotion-to-main pass (`git worktree prune`) surfaced a Windows-specific problem: the
main PACT checkout lived inside a OneDrive-synced folder
(`C:\Users\JohnChow\OneDrive - Aventa Solutions\Documents\GitHub\PACT`), and OneDrive's Files-On-Demand
had converted files under `.git/worktrees/*` into `ReparsePoint` cloud placeholders. Git's own delete
calls fail against those — confirmed non-transient (retried after a pause, failed identically both
times) — leaving 7 stale, undeletable metadata directories accumulated from past worktree sessions
(`pact-cleanup`, `pact-cu4`, `pact-promote`, `pact-session`, `sync-tombstone-deletes`,
`sync-tombstone-deletes1`, `toolbar-gap`). Cosmetic on its own, but the real risk is that every git write
in the main checkout (commit/checkout/index) was racing OneDrive's background sync on the same files — a
known source of repo corruption on Windows over time, not just leftover folders.

## Decision and execution

Moved the main checkout to `C:\Users\JohnChow\dev\PACT` (outside any cloud-sync folder), matching where
`pact-worktrees/` already lived. Execution notes:
- A plain `mv` failed with "Device or resource busy" twice — once because the shell's own cwd was inside
  the folder being moved, and again because OneDrive's sync processes (`OneDrive.exe`,
  `OneDrive.Sync.Service.exe`, `FileCoAuth.exe`) held handles somewhere in the tree. Used `robocopy` instead
  (tolerates per-file locks with retries) — copied cleanly, 1156 files / 360 dirs, 0 failures.
- Verified the new copy (`git status`/`log`/`remote -v`/`stash list`/`worktree list`) matched the original
  exactly, including all 5 pre-existing stashes (stashes live entirely inside `.git`, so a folder copy
  carries them over with zero special handling).
- The 7 stale `.git/worktrees/*` dirs lost their `ReparsePoint` attribute once copied outside OneDrive
  (just plain `ReadOnly` afterward) — cleared attributes and removed them. Left `sync-timestamp-parse`'s
  entry alone in that same pass since the user had set an explicit wait-boundary on that worktree earlier
  in the session; confirmed separately it was genuinely orphaned (branch already merged, worktree already
  removed) before flagging it as safe for the user to delete themselves.
- A pre-move tar backup (`pact-preonedrive-move-2026-07-01.tar.gz`) was taken as an extra safety net before
  the robocopy, on top of everything already being pushed to `origin`.
- Old OneDrive copy deliberately left in place (not deleted) — user's call on timing, and GitHub
  Desktop/VS Code still need to be manually re-pointed at the new path (GitHub Desktop tracks repos by
  absolute local path in its own config; there's no file to script that from outside the app).

See [[project_move_repo_out_of_onedrive]] for the full memory record of this decision and the manual
follow-up steps.

## Nightly backup automation

User wanted a scheduled backup now that the repo lives on a local (non-cloud-synced, non-redundant)
drive. Built `C:\Users\JohnChow\scripts\pact-nightly-backup.ps1` (tars `dev\PACT` to
`OneDrive\Documents\PACT-Backups\`, prunes anything older than 14 days — a single compressed file syncs
to OneDrive fine, unlike the many-small-`.git`-files problem that caused this whole migration) and
registered it as a daily 5 AM Windows Scheduled Task.

**Bug found while testing, before trusting it unattended:** `Register-ScheduledTask` defaults to
`DisallowStartIfOnBatteries: True`. This machine was on battery at test time (`BatteryStatus: 1`,
44% charge) — the scheduled trigger silently produced nothing, while a manual direct invocation of the
identical command worked fine, which was the tell. A nightly backup that silently skips whenever the
laptop is unplugged defeats the purpose. Fixed by setting `DisallowStartIfOnBatteries` and
`StopIfGoingOnBatteries` to `false` and `StartWhenAvailable` to `true` (catches up if the PC was
asleep/off at trigger time) directly on the task's `Settings` object — `New-ScheduledTaskSettingsSet`
doesn't expose a battery parameter in this PowerShell version, so it had to be set post-creation.
Re-tested after the fix: confirmed working on battery power.

## Open items for a future session
- User to re-point GitHub Desktop and VS Code at `C:\Users\JohnChow\dev\PACT` (steps given in-conversation).
- Old OneDrive copy of the repo still exists, untouched — delete once confident, user's call.
- One stale worktree metadata dir (`sync-timestamp-parse`) left for the user to remove themselves.
