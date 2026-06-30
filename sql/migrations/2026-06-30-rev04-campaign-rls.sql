-- REV-04: Close campaign-join bypass in RLS
-- Apply to the live Supabase project via the SQL editor.
--
-- Two changes:
--   1. Remove campaign_id from the player UPDATE grant so a player cannot
--      move their character into an arbitrary campaign via a direct REST write.
--      join_campaign() / leave_campaign() (SECURITY DEFINER) remain the only
--      paths that write campaign_id.
--   2. Add campaign_id IS NULL to the INSERT WITH CHECK so a player cannot
--      insert a character pre-joined to a campaign they never joined via invite
--      code. join_campaign() (SECURITY DEFINER) bypasses RLS and is unaffected.

-- 1. Tighten INSERT policy
drop policy if exists characters_insert on public.characters;
create policy characters_insert on public.characters
  for insert with check (owner_id = auth.uid() and campaign_id is null);

-- 2. Strip campaign_id from the column-level UPDATE grant
revoke update on public.characters from authenticated, anon;
grant update (name, kind, stats) on public.characters to authenticated;
