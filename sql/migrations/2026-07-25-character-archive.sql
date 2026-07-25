-- Feature: player-facing "My Characters" page -- archive (soft-delete) support for characters.
--
-- Unlike campaigns.archived_at (D-GH-2026-07-25-campaign-archive), this needs NO dedicated RPC.
-- campaigns_update's row policy allows ANY co-DM (is_campaign_dm(id)), so a plain column grant
-- would have let a co-DM bypass the intended owner-only archive semantics -- that's why campaigns
-- needed SECURITY DEFINER RPCs plus a column-level lockdown. characters_update's row policy is
-- ALREADY owner-only (`owner_id = auth.uid()` in both USING and WITH CHECK), so a plain
-- column-level grant is already correctly scoped: only the owner can ever set archived_at.

alter table public.characters add column if not exists archived_at timestamptz;

-- Additive grant -- does not touch the existing (name, kind, stats) column list.
grant update (archived_at) on public.characters to authenticated;
