# Session — 2026-07-02 · DM campaign rules, live-filter follow-up, Supabase MCP first connection

*History / non-authoritative. Authoritative state: `CHANGELOG.md`, `DECISIONS.md` (D-GH14, D-GH16).*

## Goal
Build the "DM campaign rules — configure and enforce" roadmap feature end-to-end (schema, DM Console UI,
engine validation, Live Sheet enforcement), verify it against the live Supabase project, and follow up on
a UX gap the user flagged after review.

## What we did

### Feature: DM campaign rules — configure and enforce (PR #73)
Let DMs ban species/origin-species/origin-classes/weapon-masteries/boons and toggle multi-discipline
spellcasting per campaign; Live Sheet blocks a violating character at "Save to cloud."
- `js/engine.js`: new pure `validate(build, campaignRules)` export — `compute()`/`DATA` untouched,
  `DATA.version` unchanged.
- `campaigns.rules` jsonb column (`sql/schema.sql` + `sql/migrations/2026-07-02-campaign-rules.sql`) — no
  new RLS policy needed; the existing `campaigns_update` row policy already restricts writes to DMs.
- `tools/DM-Console.html`: new Campaign Rules panel (checkbox grids sourced from `DATA.pack`/`DATA.classes`/
  `DATA.masteryFx`/`DATA.boons`, house-rule toggle chips).
- `tools/PACT-Live-Char-Sheet.html`: fetches the character's campaign rules and calls `validate()` before
  pushing to Supabase; blocks with a per-rule error listing violations on failure.
- Decision code: roadmap draft said "assign D-GH7" but that was already taken (dual-source AP/co-DMs) —
  filed as **D-GH14** instead, same situation Feature A/B hit with D-GH3.
- Parity 5/0 throughout.

### First Supabase MCP connection + live verification
User connected a Supabase MCP server mid-session (added via Claude Desktop settings, only usable once a
fresh Claude Code session picked it up — connectors don't cross between claude.ai/Desktop and the CLI).
Once live:
- Found the merged migration hadn't actually been applied to the live project yet (`campaigns.rules`
  missing) — applied it live via `apply_migration`, confirmed via `list_tables`.
- Ran `get_advisors` — no new security issues introduced by the migration.
- **Verified the RLS trust boundary directly against real accounts**, not just by reading the SQL: inside
  `begin ... rollback` transactions, simulated a non-DM player (`ad84057d-...`) attempting to write
  `rules` on a campaign they don't DM → **0 rows updated, blocked**; simulated the real DM
  (`3016205d-...`) on the same campaign → **1 row updated, succeeded**. Confirms `campaigns_update`
  already fully protects the new column with zero new policy code.
- Declined to enter the DM's password into a login field when the user offered it directly in chat —
  explained the rule and asked them to sign in themselves if UI-level testing was wanted instead.

### Feature: Live Sheet live-filter follow-up (PR #77)
User flagged a real UX gap: a player could build an entire character in CharGen around a banned choice
and only find out at the very last step (cloud save) that it's rejected. Investigated what could
realistically be fixed now vs. what needs bigger work:
- **CharGen**: has zero cloud/auth integration today (no sign-in, no campaign selection) and still embeds
  its own hand-copied rules engine — giving it live campaign-rule awareness needs Task 6 (module bridge
  migration) first. Filed as a new roadmap item, "CharGen campaign-rules awareness," rather than rushed in
  (would mean duplicating `validate()` logic outside `js/engine.js`, against AGENTS.md's hard rule).
- **Live Sheet**: checked the actual code (not just the roadmap description) for what's really pickable.
  Weapon masteries and boons are genuinely selectable; species/origin-class are fixed at creation and
  multi-discipline purchasing doesn't exist yet (pending Feature A) — so only masteries/boons could be
  live-filtered today. Added `cloudRuleBarred()` (mirrors the existing local `campBarred()` pattern) and
  wired it into both pickers; already-owned items stay visible so they remain manageable (sellable).
  Campaign rules are now fetched on sign-in/session-ready, not just at the cloud-save click.
- Decision code collision: another concurrent session had already used **D-GH15** for an unrelated
  Supabase-grants decision (`award_ap`/`award_xp` EXECUTE grants) that landed on `preview` mid-rebase —
  renumbered this session's entry to **D-GH16**.
- Added a coordination note to Feature A's roadmap entry (pushed straight to `preview`, docs-only, no PR)
  so whoever eventually builds multi-discipline purchasing wires in the campaign's
  `multiDisciplineAllowed` toggle instead of missing it.
- Parity 5/0 throughout; smoke-tested Live Sheet loads clean (no console errors) with the new code.

### Close-session pass
Ran the full close-session checklist by hand (the `/close-session` skill file lives at
`C:\Users\JohnChow\dev\PACT\.claude\commands\close-session.md` — this session's project root was still
pinned to the old, no-longer-a-git-repo OneDrive path, so the Skill tool couldn't resolve it; read the
command file directly and followed it manually instead).
- Cleaned up 3 worktrees created this session (`campaign-rules-enforcement`, `campaign-rules-live-filter`,
  a detached `roadmap-docs` one for the doc-only push).
- Repo sweep found 4 stale local branches whose remotes were already deleted after merge
  (`fix/sync-tombstone-deletes` — clean `-d`; `fix/sync-timestamp-parse`, `fix/toolbar-gap`,
  `chore/promote-preview-to-main` — not ancestors of `origin/main`/`origin/preview` by SHA, meaning they
  were squash-merged; corroborated via matching `CHANGELOG.md` entries before force-deleting with `-D`).
  `feat/campaign-rules-enforcement` (this session's own, merged PR #73) had no local ref in this checkout
  at all — likely lost when the repo moved off OneDrive mid-branch-life; nothing to clean up locally.
- Fast-forwarded the shared checkout's local `main`/`preview` to match origin.
- Opened PR #78 (`preview` → `main`, 9 commits).
- **Two merge attempts (PR #77, PR #78) were both blocked by Claude Code's own auto-mode permission
  classifier** ("Merge Without Review" — no evidence of human approval, and "do everything"/"continue"
  weren't treated as specific-enough authorization for merging to a shared/default branch). Did not
  attempt to work around either block; left both PRs open pending the user's direct decision.

## Notes
- PR #77 (`feat/campaign-rules-live-filter`) and PR #78 (`chore: promote preview to main`) are both open
  and unmerged as of session end — user needs to merge these directly (or explicitly re-authorize).
- `feat/campaign-rules-enforcement`'s local branch ref is gone from the current checkout (remote copy
  intact, already merged) — cosmetic only, not a risk.
