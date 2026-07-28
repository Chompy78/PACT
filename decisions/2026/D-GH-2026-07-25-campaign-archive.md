# D-GH-2026-07-25-campaign-archive — DM Console gains campaign create + archive (soft-delete), with a genuine owner-only enforcement fix

Status: Active

- **Context:** DM Console could manage an existing campaign's rules/rosters/invites but had no UI to
  create or remove one. Tracing the code: `createCampaign()` already existed in `js/campaign.js` (a plain
  INSERT, already correctly gated by the `campaigns_insert` RLS policy) but was dead code — never
  imported by any tool. Delete had no JS function at all, though `sql/rls-policies.sql` already had an
  owner-only `campaigns_delete` RLS policy sitting unused.
- **Options:** (i) wire the existing hard-delete RLS policy up to a "Delete campaign" button; (ii) add a
  reversible archive (soft-delete) instead, with no user-facing hard delete. For enforcing "owner-only":
  (a) trust the new RPC's internal `is_campaign_owner()` check alone; (b) also lock down the `archived_at`
  column so a direct REST call can't bypass the RPC, mirroring `characters.ap`'s existing column-grant
  pattern.
- **Decision:** (ii) archive, not hard delete — a DM tool with no confirmation stronger than a browser
  `confirm()` shouldn't offer an irreversible action that destroys a campaign's rules/invite codes/co-DM
  list with no recovery path; FK behavior on `characters.campaign_id` is `on delete set null` so a hard
  delete wouldn't even orphan player data, but it would still permanently sever every player's binding
  with zero warning. True hard delete remains reachable directly in Supabase if ever genuinely needed —
  the RLS policy is untouched, just not exposed in any tool. For enforcement: (b) — added
  `revoke update on public.campaigns from authenticated; grant update (ignore_player_ap, rules) to
  authenticated;`, so `archived_at` (and `name`/`invite_code`/`dm_invite_code`/`dm_id`, which have no
  direct-update client path at all today) can be written only through their SECURITY DEFINER RPCs.
- **Why:** the existing `campaigns_update` RLS policy is `is_campaign_dm(id)` (**any** co-DM), because
  Postgres RLS can't scope a row policy to specific columns — so a blanket UPDATE grant would have let
  any co-DM archive/unarchive (and reassign ownership-adjacent fields) via a direct REST call, silently
  defeating the "owner-only" guarantee the new RPCs exist to provide. This is the identical shape of gap
  `characters.ap` was already locked down for (see `rls-policies.sql`'s original "Column-level ap
  lockdown"), so applying the same fix here is precedent, not a new pattern. Confirmed via
  `list_tables` that `campaigns` had 0 rows before this migration (pre-launch, matching D-GH37's
  prior finding) — safe to apply directly to the live project rather than needing a phased rollout.
  Applied live via `mcp__Supabase__apply_migration`, verified with `get_advisors` (only the expected
  boilerplate SECURITY DEFINER WARN every existing RPC in this project already carries — no new real
  finding), and persisted as `sql/migrations/2026-07-25-campaign-archive.sql` +
  matching updates to `sql/schema.sql`/`sql/rls-policies.sql` so a fresh install and the live project
  agree. Separately, while screenshot-verifying the new "+ Create"/"Unarchive" buttons in a real browser
  (per `AGENTS.md`'s UI-testing expectation), found `.btn.ghost` (used by every "Copy"/"+ Add" button in
  these same campaign panels) was white-text-on-white in light theme — the same root cause as the two
  panel/dark-theme contrast fixes earlier this session (a component styled for the navy hero header,
  actually rendered on the light main-content panels) — fixed in the same change since it directly
  affected the new Unarchive button and was trivially confirmed broken in the screenshot already taken.
  Display-only; `js/engine.js` untouched.
- **Status:** DONE. `js/campaign.js` gained `archiveCampaign`/`unarchiveCampaign` + validation on
  `createCampaign`; DM Console wired up "+ New campaign", an "Archive campaign" button (owner-only,
  confirm-gated), and an "Archived campaigns" panel with per-row Unarchive.
