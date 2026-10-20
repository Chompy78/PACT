# 2026-10-17 → 2026-10-20 — notes, images and house rules go live, three releases, a promotion race

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
- **House rules (AE1: apply and release together).** `feat/campaign-house-rules` was merged up to `preview` through
  #681 and its server migration rebuilt on the live notes definition of `dm_edit_character_log` (a 3-way merge of
  both features). Fixtures renumbered CG-087..092 after a collision with #681's. The Players Guide gained §17
  "House rules for the whole table" (served copy and `pact-guide` master). #682 merged into `preview`.
- **Production apply (BF1 → BG1).** The first `apply_migration` timed out on approval again; the retry with the
  owner at the screen applied it. A post-apply md5 check against a scratch Postgres 17 build found one function
  that differed: `pact_js_number`. Two follow-up migrations (`…_js_number_trim`, `…_js_number_ascii`) fixed it, and
  all 23 house-rules functions now match the file byte for byte. Advisors: only the intended DM-RPC item. Rolled-back
  spot-check as real users 8/8.
- **v1.684 (PR #684).** Promotion carrying house rules, rules `v0.377` → `v0.379`. Tagged.
- **#686.** The house-rules, 2026-09-03 `dm_zero_player_ap` and #644 player-AP-ceiling migrations folded into
  `sql/rls-policies.sql`, with drift checks raised from 27 to 47 functions. `dm_zero_player_ap` differs from
  production only in comments (normalized hash identical). It needed a merge of `preview` (#687–#689) before merging;
  that merge was clean.
- **Grants audit.** A subagent checked which 2024 abilities hand out something PACT sells for AP. Items 2–3 (feat
  proficiencies, Primal/Divine Order) were fixed by another session (#687, #688). The four open owner decisions
  (BH free choice-grant spells, BI paid features that add nothing, BJ Wood Elf speed, BK grants the sheet never
  applies) became one NEXT task, `fix/audit-grants-owner-decisions`, cross-referenced to the overlapping
  `fix/audit-*` tasks that the other session's wide audit added.

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
- **The Supabase MCP apply path mangles invisible Unicode.** `pact_js_number`'s trim set held NBSP, LS and PS; in
  transit they became plain spaces, and writing them as `\u00a0` escapes did not help, because the transport decoded
  the escapes too. The fix spells them by code point (`chr(160)`, `chr(8232)`, `chr(8233)`), which is plain ASCII.
  Always md5-compare `pg_get_functiondef` against a local build after an apply; "applied without error" is not "applied
  as written".
