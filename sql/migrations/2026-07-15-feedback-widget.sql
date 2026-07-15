-- PACT -- In-app user feedback widget (feat/feedback-widget)
-- Run ONCE in the Supabase SQL editor on an existing PACT database.
-- Idempotent: safe to re-run. Fresh installs get all this from schema.sql /
-- rls-policies.sql instead; this file only patches a DB created before this change.
--
-- Adds a `feedback` table the in-app feedback widget inserts into from all four
-- player-facing pages (CharGen, Live Sheet, DM Console, Player's Guide).
-- Insert-only for BOTH authenticated and anonymous users; NO read/update/delete
-- grant to any client role -- the Supabase dashboard (service role) is the only
-- reader (no in-app admin view in v1).
--
-- This is the FIRST table in this schema to grant the `anon` role a write. That
-- is deliberate (see docs/plans/2026-07-15-feedback-widget.md and DECISIONS.md
-- D-GH-2026-07-15-feedback-widget): PACT is "fully usable offline, sign-in
-- optional", so requiring an account to give feedback would exclude most users.
-- It is safe because the insert policy calls ONLY auth.uid() (a Supabase
-- built-in), not any of the is_campaign_*/shares_campaign helpers whose anon
-- EXECUTE is revoked in rls-policies.sql. Guardrails: insert-only, no read,
-- length caps, a page enum, and a client-side cooldown; real server-side rate
-- limiting is explicitly out of scope for v1.

-- ===========================================================================
-- 1. feedback table
-- ===========================================================================
create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.profiles(id) on delete set null,   -- null = anonymous
  page       text not null check (page in ('chargen','livesheet','dmconsole','guide')),
  message    text not null check (char_length(message) between 1 and 2000),
  contact    text check (char_length(contact) <= 200),   -- optional; user-supplied
  created_at timestamptz not null default now()
);
create index if not exists idx_feedback_created on public.feedback(created_at);

-- ===========================================================================
-- 2. RLS + column-restricted insert grant (authenticated AND anon)
-- ===========================================================================
alter table public.feedback enable row level security;

grant insert (user_id, page, message, contact) on public.feedback to authenticated, anon;

drop policy if exists feedback_insert on public.feedback;
create policy feedback_insert on public.feedback
  for insert to authenticated, anon
  -- A caller may tag a row with their OWN user_id or leave it null (anonymous);
  -- for anon, auth.uid() is null, so only user_id = null passes. No one can
  -- attribute feedback to another user. Length guard mirrors the column CHECK.
  with check (
    char_length(message) between 1 and 2000
    and (user_id is null or user_id = auth.uid())
  );
