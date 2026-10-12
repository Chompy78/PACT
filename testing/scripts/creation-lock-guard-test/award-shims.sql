-- Supabase stand-ins for run-award.sh: the auth schema, the three roles, auth.users (schema.sql's signup
-- trigger reads raw_user_meta_data), pgcrypto in `extensions`, and auth.uid() read from request.jwt.claims
-- exactly as Supabase does (pact_enforce_creation_lock() treats empty claims as an admin session).
create schema if not exists auth;
do $$ declare r text; begin
  foreach r in array array['anon','authenticated','service_role'] loop
    if not exists (select 1 from pg_roles where rolname = r) then execute format('create role %I nologin', r); end if;
  end loop; end $$;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif((nullif(current_setting('request.jwt.claims', true), '')::jsonb)->>'sub','')::uuid $$;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
