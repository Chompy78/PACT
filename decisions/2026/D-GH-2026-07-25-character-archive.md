# D-GH-2026-07-25-character-archive — characters.archived_at needs no RPC, unlike campaigns.archived_at

Status: Active

- **Context:** built a player-facing "My Characters" page (`tools/characters.html`) with archive (reversible
  soft-delete) and permanent-delete actions. The campaign-archive feature earlier this session
  (D-GH-2026-07-25-campaign-archive) needed dedicated `archive_campaign()`/`unarchive_campaign()`
  SECURITY DEFINER RPCs plus a column-level UPDATE lockdown, because `campaigns_update`'s row policy
  allows *any* co-DM (`is_campaign_dm(id)`) — a plain column grant would have let a co-DM archive a
  campaign unilaterally, bypassing the intended owner-only semantics.
- **Options:** (i) copy the campaign pattern verbatim — add `archive_character()`/`unarchive_character()`
  RPCs; (ii) check whether `characters_update`'s row policy already excludes the co-owner case that made
  campaigns need an RPC, and use a plain column grant if so.
- **Decision:** (ii). Read `sql/rls-policies.sql`'s `characters_update` policy directly rather than
  assuming parity with campaigns: `for update using (owner_id = auth.uid()) with check (owner_id =
  auth.uid())` — owner-only in both clauses already, no co-DM/co-owner case exists for a character the
  way it does for a campaign. Added `archived_at timestamptz` to `characters` and
  `grant update (archived_at) on public.characters to authenticated` — no new RPC.
- **Why:** an RPC is the *fix* for a too-permissive row policy, not something to add reflexively whenever
  a table gets a new soft-delete column — adding one here would have been unnecessary surface area for a
  problem that doesn't exist on this table. Verified via `get_advisors(type: security)` after applying the
  migration live: no new finding, confirming the plain grant didn't open anything the RPC would have
  needed to close.
- **Status:** DONE. Migration applied live (`piuprrrnaotrtxucrtsb`) and persisted to
  `sql/schema.sql`/`sql/rls-policies.sql`/`sql/migrations/2026-07-25-character-archive.sql`. `js/sync.js`
  gained `listMyCharacters()` (owner-scoped — deliberately not reusing `listCharacters()`, which also
  surfaces a DM's-eye view of a player's character via `is_campaign_dm`), `archiveCharacter()`,
  `unarchiveCharacter()`. See CHANGELOG.md for the full "My Characters" page feature this shipped inside.
