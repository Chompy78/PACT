-- Feature: create + archive/unarchive campaigns from DM Console (soft-delete, not hard delete).
-- Apply to the live Supabase project via the SQL editor.
--
-- createCampaign() already existed in js/campaign.js (a plain INSERT, already correctly gated by
-- the existing campaigns_insert policy) but had no UI anywhere calling it -- wiring it up needs no
-- schema/RLS change. True hard delete was deliberately NOT wired up to the UI: campaigns_delete
-- exists at the RLS layer (owner-only) but a hard DELETE would permanently destroy a campaign's
-- rules/invite codes/co-DM list with no recovery path, for a DM tool with no confirmation beyond a
-- browser confirm(). Archive (soft-delete, reversible) is the safer default.

alter table public.campaigns add column if not exists archived_at timestamptz;

-- archive_campaign / unarchive_campaign -- owner-only (same tier as delete, not "any DM").
-- is_campaign_owner() is defined in rls-policies.sql.
create or replace function public.archive_campaign(p_campaign uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_campaign_owner(p_campaign) then
    raise exception 'Only the campaign owner can archive it';
  end if;
  update campaigns set archived_at = now() where id = p_campaign;
end;
$$;

create or replace function public.unarchive_campaign(p_campaign uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_campaign_owner(p_campaign) then
    raise exception 'Only the campaign owner can restore it';
  end if;
  update campaigns set archived_at = null where id = p_campaign;
end;
$$;

grant execute on function public.archive_campaign(uuid)   to authenticated;
grant execute on function public.unarchive_campaign(uuid) to authenticated;
revoke execute on function public.archive_campaign(uuid)   from public;
revoke execute on function public.unarchive_campaign(uuid) from public;

-- Column-level lockdown so archive/unarchive are GENUINELY owner-only, not just "no UI button for
-- it" -- the previous blanket `grant ... update on public.campaigns` let any co-DM write every
-- column via a direct REST call, same class of gap characters.ap was already locked down for (see
-- rls-policies.sql's "Column-level campaign-write lockdown" section). Only re-grant the two
-- columns an ordinary DM actually needs to update directly today (setIgnorePlayerAp/
-- setCampaignRules); archived_at/name/invite_code/dm_invite_code/dm_id now go ONLY through their
-- SECURITY DEFINER RPCs (archive_campaign/unarchive_campaign/regenerate_invite_code/
-- regenerate_dm_invite_code), or, for name/dm_id, through no client path at all today.
revoke update on public.campaigns from authenticated;
grant update (ignore_player_ap, rules) on public.campaigns to authenticated;
