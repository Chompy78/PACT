-- Supabase Storage stand-ins for run-images.sh: just the two tables the character-images policies touch, with RLS on
-- (as in Supabase, where storage.objects has RLS enabled and the Storage API runs each request as `authenticated`
-- with the caller's JWT claims). Size and MIME limits live in the Storage API, not the database, so they are NOT
-- exercised here — only who may read/write which object name.
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text not null unique, owner uuid, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists storage.objects (
  -- no FK to buckets (Supabase has one): the BEFORE run seeds objects before the migration creates the bucket
  id uuid primary key default gen_random_uuid(), bucket_id text, name text not null,
  owner uuid, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (bucket_id, name));
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;
grant select on storage.buckets to anon, authenticated;
-- a bucket of someone else's, to prove the policies stay inside their own bucket
insert into storage.buckets(id, name) values ('other-bucket', 'other-bucket') on conflict do nothing;
