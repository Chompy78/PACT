-- Rollback for 2026-10-15-character-images.sql (D-GH-2026-10-15-character-images).
--
-- Dropping the four policies is what actually switches the feature off: storage.objects keeps RLS enabled, so with
-- no policy for this bucket nobody but the service role can read, write or delete a picture. The client then sees
-- every slot as empty and an upload as refused.
--
-- The BUCKET and any files in it are deliberately NOT removed here. Supabase refuses a direct SQL delete from
-- storage.objects / storage.buckets (storage.protect_delete); files have to go through the Storage API. To remove
-- them as well: Dashboard → Storage → character-images → select all → Delete, then delete the empty bucket.
drop policy if exists character_images_select on storage.objects;
drop policy if exists character_images_insert on storage.objects;
drop policy if exists character_images_update on storage.objects;
drop policy if exists character_images_delete on storage.objects;

drop function if exists public.can_read_character_image(text, timestamptz);
drop function if exists public.can_write_character_image(text, timestamptz);
drop function if exists public.character_image_character(text);
