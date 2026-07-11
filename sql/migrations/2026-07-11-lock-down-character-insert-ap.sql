-- Lock down direct character-creation privileges so `ap` (and campaign_id) can
-- never be set on insert by a normal authenticated client. Mirrors the existing
-- UPDATE-path lockdown ("ap stays unwritable by players") applied to INSERT too.
-- See DECISIONS.md D-GH-2026-07-11-clone-campaign-character-standalone.

-- 1) Column-restricted INSERT grant: players may only supply the columns the
--    app actually needs on a new character. ap and campaign_id are excluded --
--    any future insert naming either column is rejected by Postgres itself,
--    before RLS is even evaluated.
revoke insert on public.characters from authenticated;
grant insert (id, owner_id, name, kind, stats) on public.characters to authenticated;

-- 2) Belt-and-suspenders: even if a future change widens that grant, this
--    independently rejects any insert that isn't ap = 0.
drop policy if exists characters_insert on public.characters;
create policy characters_insert on public.characters
  -- campaign_id must be null on direct insert; join_campaign() (SECURITY DEFINER) bypasses
  -- this policy and sets it authoritatively, so the check doesn't block that path.
  -- ap must be exactly 0 on direct insert for the same reason -- only award_ap() (SECURITY
  -- DEFINER) may ever set it to a nonzero value.
  for insert with check (owner_id = auth.uid() and campaign_id is null and ap = 0);
