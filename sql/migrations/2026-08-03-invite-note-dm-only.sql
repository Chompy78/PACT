-- PACT — an invite's DM note is readable by DMs only.
-- D-GH-2026-08-03-invite-note-dm-only.
--
-- WHY. campaign_invites_select is `is_campaign_dm(campaign_id) or redeemed_by = auth.uid()`, so a player
-- can read their OWN redeemed invite row. RLS is ROW-level: granting the row grants every column on it,
-- so the `note` added by D-GH-2026-08-03-dm-invite-manager was readable by the very player it described.
-- A DM labelling an invite "replacement after he got himself killed" was writing it to that player.
--
-- Column-level SELECT is the precise tool: `authenticated` keeps every column except `note`. The DM's own
-- read is unaffected because it goes through list_campaign_invites(), which is SECURITY DEFINER and
-- therefore runs as the owner.
--
-- A COLUMN-LEVEL REVOKE CANNOT SUBTRACT FROM A TABLE-LEVEL GRANT. Postgres treats table-level SELECT as
-- covering every column, so `revoke select (note) ... from authenticated` against the existing blanket
-- grant is a SILENT no-op — it reports success and changes nothing. (Confirmed the hard way: the first
-- attempt at this migration did exactly that, and information_schema still listed `note` as selectable.)
-- The table-level grant must be dropped first, then the wanted columns granted explicitly.
--
-- SAFE BECAUSE NOTHING SELECTS THIS TABLE FROM THE CLIENT. Verified before applying: the only reference
-- to campaign_invites anywhere in js/ or tools/ is the list_campaign_invites() RPC call. (The older note
-- in sql/rls-policies.sql about CharGen's crash-recovery path re-reading starting_budget describes code
-- that no longer exists — corrected there in this change.)
--
-- CAVEAT FOR FUTURE CALLERS: with a column withheld, `select *` on this table FAILS for `authenticated`
-- with "permission denied for column note" rather than silently omitting it. Any future client read must
-- name its columns, or go through the RPC. That is a deliberate, loud failure — it surfaces at the first
-- call rather than quietly leaking the column again.

revoke select on public.campaign_invites from authenticated;

grant select (id, campaign_id, token, starting_ap, starting_budget,
              created_by, created_at, expires_at, revoked_at,
              redeemed_by, redeemed_at)
  on public.campaign_invites to authenticated;   -- every column EXCEPT note
