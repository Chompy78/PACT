# D-GH-2026-10-11-campaign-npcs — a DM can bind several of their own characters to their campaign as NPCs

Status: Active. **Applied to the live database 2026-10-11** (35 characters / 6 bound re-counted immediately before, the
six redefined functions' live hashes unchanged since they were read; afterwards the eight live function bodies are
byte-identical to the repo's migration path, the security advisor shows exactly one new entry — `dm_bind_npc`, the
intended RPC, same shape as every other DM RPC — and the performance advisor nothing new). First use the same day:
"Bram Cotter Ch8-12" bound to Amble as an NPC with 82 DM AP (one `ap_awards` row, credited to the DM).

## Context

The Amble DM keeps the campaign's NPCs (Bram, Wren) as PACT characters, two versions per story arc, and wanted them inside
the campaign with DM-awarded AP. Binding them as ordinary characters fails three ways, found on the live database:

- `idx_characters_owner_campaign_unique (owner_id, campaign_id)` allows ONE character per owner per campaign — and it is
  also the race guard for player joins (the bind RPCs' "already a member?" check is check-then-write).
- `bind_character_to_campaign()` auto-grants the campaign's starting AP (Amble: 36), recorded as a DM award.
- A bound character is a party member everywhere in DM Console: Award AP's tick-list and Select all, the table view,
  the matrix/ledger overlays, counts.

## Options

- **B1 — keep NPCs unbound, versions by name.** No code; nothing ties them to the campaign.
- **B2 — a real NPC flag.** Schema, RPC, RLS-adjacent helpers and DM Console changes.
- **B3 — bind them as ordinary characters.** Works for exactly one NPC per DM; bulk actions include it.

Owner chose B3 first, then — once the one-per-account limit surfaced — **D2: hold off and build B2 first** (2026-10-11),
with **C1: Bram ends at 82 DM AP total**.

## Decision

1. `characters.is_npc boolean not null default false` + `check (not is_npc or campaign_id is not null)`. In **no** client
   column grant: only `dm_bind_npc()` sets it.
2. `dm_bind_npc(character, campaign)` (SECURITY DEFINER): own character, unbound, not archived, caller is a DM of the
   campaign, campaign active. No starting-AP grant. Unbinding reuses `dm_unbind_character()`; trigger
   `trg_pact_npc_clear_on_unbind` clears the flag whenever `campaign_id` goes null (also covers the FK's
   `on delete set null`).
3. The unique index gains `and not is_npc`. Players keep exactly today's rule and race guard.
4. `not is_npc` where "the player's character in this campaign" is meant: `is_campaign_member()`, `is_dm_of_player()`,
   the idempotent `limit 1` lookups in `redeem_player_invite()`/`redeem_character_claim()`, the join in
   `list_campaign_invites()`, and `js/sync.js _existingIdInCampaign()`. `remove_dm()` also unbinds that DM's NPCs.
5. DM Console splits roster rows at load: `cloudRoster` = players (so every party-wide feature excludes NPCs with no
   per-feature filter), `cloudNpcs` rendered in an "NPCs" section with the same per-card DM tools (minus basic mode and
   Player AP), plus "+ Add an NPC". `listMyCampaigns()` no longer counts an NPC as "you play here"; My Characters tags NPCs.

## Why

- **One flag on `characters`, not an `npcs` table:** NPCs must open in CharGen/Live Sheet and take AP awards exactly like
  characters; a second table would duplicate every RPC and policy.
- **RPC-only flag:** a client-settable flag would let any player escape the one-per-campaign rule.
- **Split at load, not filter per feature:** every future party-wide feature reads `cloudRoster` and is correct by default.
- **The basic-mode count still includes NPCs** (cold review, Gemini, 2026-10-11, verified): any user can create a campaign
  and so become its DM, so excluding NPCs would let a basic-mode user bind unlimited characters as NPCs.

## Consequences / watch for

- Any NEW query meaning "the player's character in this campaign" must filter `not is_npc` (the nemotron review's point).
- `feat/campaign-character-limit` (open task, NEXT board) rewrites `idx_characters_owner_campaign_unique`. Whatever replaces
  it must keep NPC rows exempt, or a DM's second NPC bind starts failing again.
- Party-wide downtime (`declare_downtime`) also covers NPCs — harmless (downtime locks nothing; players never see NPCs).
- Plan + cold reviews: `docs/plans/2026-10-11-campaign-npcs.md`, `docs/plans/cold-reviews/2026-10-11-*-campaign-npcs.md`.
  Tests: `testing/sql/campaign-npcs-test.sql` (CI: sql-guards), `testing/scripts/dm-console-ui-e2e.mjs` (NPC block).

## Addendum 2026-10-14 — NPCs in the Award AP tick-list (`feat/award-ap-npcs`)

**Owner request:** "I cannot add DM AP to NPCs. Include their names under 'Award AP' in DM Console and change the select all to
select all PCs." The per-card award form still works, but the shared Award AP tile was the obvious place and left NPCs out.

**Decision (owner):** the Award AP tick-list now lists the campaign's NPCs after the players, marked "NPC". The "Select all"
button becomes **"Select all PCs"**: it ticks every player character and leaves NPC ticks as they were. Every other party-wide
feature (table view, matrix/ledger overlays, counts) still excludes NPCs. The award itself is the same `award_ap` RPC per
character, which already accepts an NPC (a DM's own character bound to the campaign), so no server change.

**Status:** accepted by the owner, 2026-10-14.
