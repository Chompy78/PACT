# 2026-10-17 → 2026-10-20 — notes and images go live, two releases, a promotion race

A long session that began on 2026-10-14 with the Live Sheet stack (#668 pack spells, #671 saves in the Stats card,
#672 the shared Sheet layout) and the two server features (#673 boon/drawback notes, #669 character images). This note
covers the closing stretch: getting those features live on production and released.

## What happened

- **v1.676 (PR #676).** `preview` → `main` with the whole stack. Tagged `v1.676`.
- **AW1.** The owner confirmed a solo character's boon/drawback descriptions stay required and are never locked
  (recorded in `D-GH-2026-10-15-boon-drawback-notes`).
- **AY1 / AZ1: production applies.** `boon_drawback_notes` and `character_images` applied to Supabase on 2026-10-19.
  The first two `apply_migration` calls failed with "Invalid or expired requestState" — the approval prompt timed out
  while the owner was away. A read-only md5 check of `dm_edit_character_log` proved nothing had applied; the retry
  (AZ1, owner at the screen) went through. Advisors: only the two intended WARNs for the image read/write helpers.
  A rolled-back live spot-check as real users (owner, DM, fellow player, outsider) gave 12/12 as expected, and left
  0 storage objects and 0 note events.
- **#677.** Both migrations folded into `sql/rls-policies.sql` (the Storage block is guarded so plain Postgres test
  harnesses still load it), drift checks extended, records and board updated.
- **v1.678 (PR #678).** Promotion carrying #677.

## Worth remembering

- **Promotion race.** #675 (names before spending — another session's player-visible feature) merged into `preview`
  after the `v1.678` build bump was pushed but before #678 was merged, so it shipped inside v1.678. The release line
  first said "no app code change" and the release went untagged. Caught at the next status check; the CHANGELOG line
  was corrected and `v1.678` tagged (BA1). **Before merging a promotion, re-list `origin/main..origin/preview` and
  compare it with what the release line says.**
- **A wait loop that could never end.** A background `until … ! pgrep -f "run.sh"; do sleep 3; done` ran for ~4½ days:
  `pgrep -f` matched the loop's own `bash -c` command line, which contains the text `run.sh`. Found and killed at
  close. Wait on a PID or a sentinel file instead of a name search that the waiting shell itself matches.
- **The 2026-10-15 adversarial review of #668/#671/#672** reported late (it was held open by that loop). Every finding
  — custom proficiencies missing from the Sheet, hidden typed slot values, focus loss on redraw, `grantedSpells`
  listing spells the build no longer grants, an unescaped `.shsub` line — had already been fixed in `b1ea865` and
  `70b4c2c` before the PRs merged.
