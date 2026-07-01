# Session — 2026-07-01 · REV-04 RLS fix, live verification, memory setup

*History / non-authoritative. Authoritative state: `CHANGELOG.md`, `DECISIONS.md` (D-GH12).*

## Goal
Execute REV-04 (campaign-join RLS bypass), verify the fix live against the Supabase DB, catch up
missing docs from the previous session, and set up persistent memory for the project.

## What we did

### REV-04 — Close the campaign-join bypass in RLS
Prior to this fix a player could `PATCH characters SET campaign_id = <any-uuid>` or `POST characters`
with `campaign_id` set, bypassing `join_campaign()` entirely. Fixed two vectors:
- Removed `campaign_id` from the column-level UPDATE grant — direct writes are now structurally
  impossible at the Postgres layer regardless of row policy.
- Added `AND campaign_id IS NULL` to the `characters_insert` policy — a player cannot insert a
  character pre-joined to an arbitrary campaign.
`join_campaign()` (SECURITY DEFINER) bypasses RLS and is unaffected. See D-GH12.
Migration: `sql/migrations/2026-06-30-rev04-campaign-rls.sql` — applied to live DB same session.

### Pre-fix analysis
Before touching anything, grepped `sql/` and `js/` to confirm: (a) no JS code writes `campaign_id`
directly via `.update()` — safe to remove from grant; (b) `join_campaign()` is already SECURITY
DEFINER; (c) no leave-campaign flow exists, so nothing breaks. Also identified the INSERT-side bypass
(not in the original roadmap description) and closed it in the same PR.

### Live verification
Applied the migration and verified via Supabase REST API using the test player account
(`claude@claude.com`):
- `PATCH /characters` with `campaign_id` → **403 Rejected** ✓
- `POST /characters` with `campaign_id` set → **403 Rejected** ✓
- `join_campaign()` confirmed unaffected (SECURITY DEFINER bypasses RLS).

### Docs catch-up
`DECISIONS.md` (D-GH12) and `docs/sessions/2026-06-30-rev-series-sw-hardening-campaign-rls.md`
were never committed alongside the REV-04 PR. Both committed to `preview` directly as a docs-only
catch-up, with a live-verification note added to the session file.

### Memory setup
Initialised the project memory system (`memory/`):
- `feedback_gh_full_path.md` — gh CLI requires full WinGet path
- `feedback_pr_merge.md` — ask before merging PRs
- `project_feature_ideas.md` — product gaps (auto session naming logged here)
- `reference_test_accounts.md` — test player account `claude@claude.com`; password in user's
  password manager

### Session naming discussion
Explored ways to get a meaningful session name from the initial prompt:
- **Option 1:** lead the prompt with a declarative title so the UI auto-generates a better name.
- **Option 2:** `[Session: X]` hint line + AGENTS.md rule to echo it as the first response line.
User decided not to add the AGENTS.md rule for now; both prompt variants documented for testing.
Feature gap logged to memory: no programmatic way to rename a session from within Claude Code.

## Notes
- `fix/cu-3-tidy-root`, `docs/rev-01-logging`, `docs/session-2026-07-01` branches remain open from
  other sessions — not touched here.
- Parity gate unaffected throughout (SQL-only changes).
