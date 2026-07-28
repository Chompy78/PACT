# D-GH12 — Campaign RLS: `campaign_id` column locked to SECURITY DEFINER path

Status: Active

- **Context:** REV-04 found that the player UPDATE grant on `characters` included `campaign_id`. A player could set their own `campaign_id` to any campaign UUID, bypassing the `join_campaign()` invite-code flow and joining campaigns without the DM's knowledge or invite code.
- **Options:** (i) add a row-level policy that validates the target campaign exists and the player holds an invite — this requires reading `campaigns` from inside an RLS policy, hitting the same recursion problem that forced SECURITY DEFINER elsewhere (D-GH4); (ii) **remove `campaign_id` from the column-level UPDATE grant** so no direct write to that column is possible at all; DM-side paths that need to set it use SECURITY DEFINER functions that bypass RLS.
- **Decision:** (ii). `campaign_id` removed from the player column-level UPDATE grant. The INSERT policy also tightened with `AND campaign_id IS NULL` so a player cannot insert a character pre-joined to an arbitrary campaign. `join_campaign()` (SECURITY DEFINER) is the sole path for assigning `campaign_id` on a character.
- **Why:** column-level grants are the only airtight guard at the Postgres layer — a row policy can be satisfied by a carefully crafted update that meets the condition; removing the column from the grant makes the write structurally impossible regardless of row state. The SECURITY DEFINER trust boundary is already established (D-GH4); this extends it consistently to cover campaign membership.
- **Status:** IN FORCE as of 2026-06-30 (REV-04). Migration: `sql/migrations/2026-06-30-rev04-campaign-rls.sql`.
