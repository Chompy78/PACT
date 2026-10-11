# Plan — campaign NPCs (`feat/campaign-npcs`)

Date: 2026-10-11 · Status: implemented and applied to live 2026-10-11 (cold-reviewed; see Review outcome) · Decision ID: `D-GH-2026-10-11-campaign-npcs`

## Goal
Let a campaign's DM bind several of their **own** characters to that campaign as **NPCs** (e.g. "Bram Cotter Ch8-12", "Wren …",
two versions per story arc), with DM-awarded AP, without those NPCs behaving as player party members and without weakening any
guarantee players rely on today.

## Context (everything a reviewer needs — no repo access assumed)
- PACT is a static, vanilla-JS tabletop-RPG app (no framework, no build step, no custom backend). The only backend is Supabase
  (Postgres + auth), reached from the browser and protected by row-level security (RLS). Privileged writes go through
  `SECURITY DEFINER` RPC functions that check the caller themselves.
- Table `characters(id, owner_id, campaign_id null, kind, stats jsonb, ap int, archived_at, …)`. `campaign_id` set = "bound to a
  campaign". Players cannot write `campaign_id` or `ap` directly (column grants exclude them); binding goes through
  `bind_character_to_campaign(character, invite_code)` and AP through `award_ap(character, amount, note)` (DM-only, writes a ledger row).
- **Read rule today:** a character row is readable only by its owner or a DM of its campaign. Players never see each other's rows.
- **One-per-campaign rule:** unique index `idx_characters_owner_campaign_unique on characters(owner_id, campaign_id) where campaign_id
  is not null`. It is also the **race guard** for joins: the bind RPC's "already a member?" check is check-then-write, so two
  simultaneous joins are stopped only by this index.
- Helper `is_campaign_member(campaign)` = "caller owns any character bound to it". Used by: campaign/DM-list/downtime read policies,
  and as the "already joined" refusal in `join_campaign`, `redeem_player_invite`, `bind_character_to_campaign`, `redeem_character_claim`.
- `bind_character_to_campaign` also auto-grants the campaign's starting AP on first bind (the live "Amble" campaign: 36).
- `is_dm_of_player(player)` (DM ↔ any owner of a character in a campaign they DM) gates a DM putting a player into "basic mode"
  (max one active character, enforced by trigger `pact_enforce_basic_mode`, which counts all the owner's active characters).
- Several RPCs (`redeem_player_invite`, `redeem_character_claim`, `list_campaign_invites`) and one client helper (`sync.js`
  `_existingIdInCampaign`) look up "the" character for (owner, campaign) with `limit 1` / a join — they assume at most one row.
- DM Console (one HTML tool) loads the campaign roster with one direct table select (`dm.js getRoster`) into an array `cloudRoster`.
  Every party-wide feature reads that array: the campaign-wide "Award AP" tick list with **Select all**, the party skill matrix, AP
  ledger overlay, table view, and the "campaign with N characters" count. "Declare downtime" is a server RPC that replaces the window
  for every character in the campaign.

## Verified vs. assumed
**Verified (live DB, 2026-10-11):** 35 characters, 8 owners, 5 campaigns; 6 bound characters, all in Amble, **none owned by a DM of its
campaign** → a new column defaulting to false changes no existing row's meaning. No NPC column exists. The target NPC row exists,
unbound, owned by Amble's DM. Code inventory of every object above done by grep of the current baseline SQL and tools.
**Assumed:** a DM never needs an NPC to be a *player* character at the same time (one flag, not a role table); NPCs need no
player-facing visibility (players never see NPC sheets); party-wide downtime applying to NPCs too is harmless (no player sees it).

## Proposed approach
1. **Schema** (one migration `sql/migrations/2026-10-11-campaign-npcs.sql`, folded into `sql/schema.sql` / `sql/rls-policies.sql`,
   which are the maintained baseline):
   - `characters.is_npc boolean not null default false`, with `check (not is_npc or campaign_id is not null)`.
   - **Not** added to any client insert/update column grant — only settable by the RPC below, so a player can never self-flag to
     escape the one-per-campaign rule.
   - BEFORE UPDATE trigger: if `campaign_id` becomes null, force `is_npc := false`. Covers `dm_unbind_character` *and* the FK's
     `on delete set null` when a campaign is deleted, without editing either.
   - Re-create the unique index as `… where campaign_id is not null and not is_npc`. Players keep exactly today's race guard; NPCs
     are unlimited.
2. **New RPC `dm_bind_npc(p_character, p_campaign)`** (SECURITY DEFINER, granted to `authenticated` only): caller must own the
   character, the character must be unbound and not archived, caller must be `is_campaign_dm(p_campaign)`, campaign must be active
   (`assert_campaign_active`). Sets `campaign_id` + `is_npc = true` in one update. **No starting-AP grant**; the DM sets AP with the
   existing `award_ap`. Unbinding reuses existing `dm_unbind_character` (trigger clears the flag).
3. **Exclude NPCs where "member/the character" is meant:** add `and not is_npc` to `is_campaign_member`, `is_dm_of_player`, the
   `limit 1` lookups in `redeem_player_invite` and `redeem_character_claim`, the join in
   `list_campaign_invites`, and `sync.js _existingIdInCampaign`. `remove_dm` additionally unbinds the removed DM's NPCs in that campaign
   (an NPC must always belong to a current DM). Everything else (award_ap, gold, seal, notes, DM edits, read policies) works on NPC rows
   unchanged — verified function by function. **The basic-mode count deliberately still includes NPCs** (cold review, below): any
   user can create a campaign and so become its DM, so excluding NPCs would let a basic-mode user bind unlimited characters as NPCs.
4. **DM Console:** `getRoster` returns `is_npc`. Rows are split **at load time**: `cloudRoster` keeps players only, so every
   party-wide path (Select-all award, matrix, ledger, table view, count) excludes NPCs with no per-feature filters to forget; a new
   `cloudNpcs` array renders in a separate "NPCs" section using the same card renderer (per-card award AP / view / notes / remove work),
   with player-only controls (basic mode, zero Player AP) hidden. An "Add NPC" control lists the DM's own unbound, non-archived
   characters and calls `dm_bind_npc`. Declare-downtime confirm text says "every player character (NPCs too)". All names via `esc()`.
5. **Other tools:** `listMyCampaigns` stops counting an NPC as "you play in this campaign"; My Characters / CharGen / Live Sheet show an
   "NPC" label on such rows. No engine change, no `DATA.version` bump.
6. **Rollout:** tests green → apply migration to live → merge → bind Bram (82 DM AP total) as first use.

## Files involved
`sql/migrations/2026-10-11-campaign-npcs.sql` (+ `-rollback.sql`), `sql/schema.sql`, `sql/rls-policies.sql`,
`testing/sql/rls-baseline-test.sql` (register migration + new functions) and a new NPC SQL test, `js/dm.js`, `js/campaign.js`,
`js/sync.js`, `tools/DM-Console.html`, `tools/characters.html`, CharGen/Live Sheet (label only), docs (CHANGELOG, DECISIONS, task board).

## Out of scope
Per-player character limits (separate task that rewrites the same index — this plan keeps the index shape compatible: it only adds
`and not is_npc`); NPC version grouping beyond a naming convention; showing NPCs to players; NPC stat blocks / combat use.

## Alternatives considered
- **Bind NPCs as ordinary characters** — rejected: one per DM per campaign, auto starting AP, included in every bulk action.
- **Drop the unique index** — rejected: reopens the player double-join race.
- **Separate `npcs` table** — rejected: NPCs must open in CharGen/Live Sheet and take AP awards exactly like characters; a second table
  would duplicate every RPC and policy.
- **Filter NPCs per feature in DM Console** instead of splitting at load — rejected: each future party-wide feature would need to
  remember the filter.

## Risks
- Missing one `limit 1`/membership site → wrong row picked or wrong refusal. Mitigation: grep inventory + SQL tests per site.
- Flag set by a non-DM → privilege escape from the one-per-campaign rule. Mitigation: no column grant; RPC-only; test it.
- Client code selecting `is_npc` before the column exists in live → roster load fails. Mitigation: apply migration before merge.
- Live data: additive column, default false, 0 existing rows affected (measured).

## Verification
SQL test (Postgres 16, CI `sql-guards`): DM binds two NPCs to one campaign ✔; player still refused a second join (index) ✔;
non-DM / player calling `dm_bind_npc` refused ✔; player cannot set `is_npc` via update/insert ✔; another player cannot read an NPC row ✔;
no starting-AP ledger row on NPC bind ✔; unbind clears the flag ✔; `is_campaign_member` false for a DM owning only NPCs ✔;
basic-mode count still includes NPCs (no bypass) ✔. `rls-baseline-test.sql` passes with the migration registered. `engine-parity` 0 failed.
DM Console UI check: NPC section renders, Select-all list excludes NPCs. Supabase advisor: no new findings after applying.

## Done when
A DM can bind 2+ NPCs to one campaign; a player is still refused a second join; NPCs are excluded from bulk AP/downtime confirm and
party totals; a player cannot read an NPC row; all SQL tests pass; advisor clean; Bram bound to Amble at 82 DM AP.

## Reviewer instructions
1. First line of your response: your model name/version and settings.
2. Judge logic, clarity, scope and risk — not code you cannot see.
3. Answer: Does this achieve the goal? Which assumptions are shaky? Is there a better alternative? What is missing (especially any
   place an NPC row could still be treated as a player's character, or a way a non-DM could create one)? Is the verification
   objectively checkable? Should this split into several plans?
4. Output as a Markdown file named `campaign-npcs-review-<model>.md`.

## Review outcome
Two API reviewers, 2026-10-11 (files in `docs/plans/cold-reviews/2026-10-11-*-campaign-npcs.md`):
- **Gemini `gemini-3.1-flash-lite`** (self-identified wrongly as GPT-4o). **Accepted:** excluding NPCs from the basic-mode count is a
  bypass — verified `campaigns_insert` lets any user create a campaign as its DM. Plan changed: basic-mode count keeps NPCs.
  **Rejected (verified non-issues):** player bind "hijacking" an NPC (an NPC is always bound, so the player bind already refuses it,
  and unbinding clears the flag); downtime "locking" an NPC (downtime locks nothing); `remove_dm` multi-NPC (a set-based update).
- **OpenRouter `nemotron-3-super-120b`** (no self-ID). No new findings; generic future-proofing notes. **Deferred → doc-note:** any
  future query that means "the player's character" must filter `not is_npc` — recorded in the decision record.
