-- feat/character-images — up to two pictures per cloud character (D-GH-2026-10-15-character-images).
--
-- APPLIED 2026-10-19 (verbatim minus these header comments; purely additive, so no blast radius to pre-measure).
-- Folded into sql/rls-policies.sql (its Storage section) the same day. Before it was applied the client said, in
-- plain words, that picture storage was not switched on yet — nothing else in the app depends on it.
--
-- WHAT IT ADDS
--   * a PRIVATE Storage bucket `character-images` (no public URLs; reads go through short-lived signed URLs),
--     capped at 2 MB per file and to image/webp, image/jpeg, image/png (enforced by the Storage API);
--   * two SECURITY DEFINER helpers, so the policies can look at public.characters without being subject to
--     characters' own RLS (same recursion-breaking pattern as is_campaign_dm(), see rls-policies.sql);
--   * four policies on storage.objects, all scoped to this bucket and to the `authenticated` role.
--
-- THE PATH IS THE WHOLE DATA MODEL. An object's name must be exactly `<character uuid>/1` or `<character uuid>/2`
-- (lower-case uuid, no extension; the content type travels as object metadata). Nothing about pictures is
-- stored in characters.stats / the LOG. Consequences, all deliberate:
--   * "at most two pictures" is enforced by the name check itself — a third name cannot be written;
--   * access follows the character's CURRENT owner and campaign, live, like is_campaign_dm_of_character():
--     a claim that transfers ownership (redeem_character_claim) or a move to another campaign moves picture
--     access with it, with no file renamed;
--   * the path has no owner-id prefix for exactly that reason (an owner prefix strands the files on transfer).
--
-- WHO MAY DO WHAT (owner decisions AI2 2026-10-14, AQ2 2026-10-15)
--   read   : the character's owner; any DM of its campaign (campaign_dms, so co-DMs too); the OTHER PLAYERS of
--            that campaign (is_campaign_member — a player character in it). NPCs are the same as player characters
--            (AQ2): the whole campaign sees them. Nobody else, and never `anon`.
--   write  : (insert / update / delete) the character's owner only — not the DM, not other players.
--
-- A PICTURE BELONGS TO ONE INCARNATION OF THE ROW. Character ids are chosen by the client (characters.id is in the
-- insert grant), so if a row is deleted and its pictures are left behind (an offline delete, a DM delete), anyone
-- could insert a NEW row with the SAME uuid and inherit them. Every policy therefore passes the object's
-- created_at, and the helpers require objects.created_at >= characters.created_at: an object older than the current
-- row is invisible and untouchable to everyone. Neither timestamp is client-settable (characters.created_at is
-- not in the insert grant and defaults to now(); storage.objects is written only by the Storage API). So: a
-- leftover picture of a deleted row is unreadable and undeletable through the API by anyone — including whoever
-- recreates the id — and only the service role (dashboard / a sweep) can remove it. A restore that brings the
-- row back with its ORIGINAL created_at brings its pictures back; a recreate with a new created_at does not. The
-- owner's own permanent delete removes the files first (tools/characters.html); see the decision record for the
-- archive / DM-delete / NPC-duplicate rules.
--
-- BLAST RADIUS: purely additive. No existing table, function, policy or grant is changed; no existing write can
-- start failing. Safe to re-run (create or replace / drop policy if exists / on conflict do update).
-- Rollback: 2026-10-15-character-images-rollback.sql.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('character-images', 'character-images', false, 2097152, array['image/webp','image/jpeg','image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The character a picture belongs to, or NULL when the name is not exactly `<lower-case uuid>/1|2`.
-- Fail-closed: every policy below needs a non-null answer.
create or replace function public.character_image_character(p_name text)
returns uuid language sql immutable set search_path = public, pg_temp as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[12]$'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;

-- p_created = the OBJECT's created_at (from the policy). NULL fails closed.
create or replace function public.can_read_character_image(p_name text, p_created timestamptz)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from characters c
    where c.id = character_image_character(p_name)
      and p_created >= c.created_at
      and (
            c.owner_id = auth.uid()
         or is_campaign_dm(c.campaign_id)
         or is_campaign_member(c.campaign_id)
      )
  );
$$;

create or replace function public.can_write_character_image(p_name text, p_created timestamptz)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from characters c
    where c.id = character_image_character(p_name)
      and p_created >= c.created_at
      and c.owner_id = auth.uid()
  );
$$;

revoke all on function public.character_image_character(text) from public, anon;
revoke all on function public.can_read_character_image(text, timestamptz)  from public, anon;
revoke all on function public.can_write_character_image(text, timestamptz) from public, anon;
grant execute on function public.character_image_character(text) to authenticated;
grant execute on function public.can_read_character_image(text, timestamptz)  to authenticated;
grant execute on function public.can_write_character_image(text, timestamptz) to authenticated;

-- Upload with upsert (the client's "Replace") needs SELECT + INSERT + UPDATE; the owner holds all three.
drop policy if exists character_images_select on storage.objects;
create policy character_images_select on storage.objects
  for select to authenticated
  using (bucket_id = 'character-images' and public.can_read_character_image(name, created_at));

drop policy if exists character_images_insert on storage.objects;
create policy character_images_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'character-images' and public.can_write_character_image(name, created_at));

-- WITH CHECK as well as USING: a rename/move may not land on another character or on a third slot.
drop policy if exists character_images_update on storage.objects;
create policy character_images_update on storage.objects
  for update to authenticated
  using (bucket_id = 'character-images' and public.can_write_character_image(name, created_at))
  with check (bucket_id = 'character-images' and public.can_write_character_image(name, created_at));

drop policy if exists character_images_delete on storage.objects;
create policy character_images_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'character-images' and public.can_write_character_image(name, created_at));
