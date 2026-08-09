-- PACT — harden the invitation system.
-- D-GH-2026-08-09-harden-invitation-system. Plan: docs/plans/2026-08-08-harden-invitation-system.md
-- (6-reviewer cold review, z-cold-reviews/harden-invitation-system-review-*.md).
--
-- WHY. campaigns.dm_invite_code was readable by any campaign member via campaigns_select (row-level
-- RLS, no column exclusion) and redeemable by ANY authenticated account system-wide via join_as_dm(),
-- which never checked campaign membership. A 6-character alphanumeric code (~2.1 billion combinations,
-- no rate limiting anywhere in this schema) was the only thing standing between an ordinary player and
-- co-DM privileges. This migration:
--   1. Extends campaign_invites (previously player-only) into a unified type/mode model covering both
--      player and DM invites, and adds expiry enforcement that was previously a documented no-op.
--   2. Adds create_dm_invite()/redeem_dm_invite(), modeled on the existing create_player_invite()/
--      redeem_player_invite() shape, single-use by default with reusable as an explicit DM opt-in
--      (owner decision, plan "Decisions" section #2) — redeemable by any authenticated account (owner
--      decision #1), atomic and idempotent under concurrency (Security Invariants 5/6/10 in the plan).
--      DM-invite tokens are stored ONLY as a SHA-256 hash (pgcrypto's `extensions.digest`, already
--      installed) — DM invites are a brand-new capability with no legacy retrieval expectation, so they
--      get the stronger bar: the plaintext is returned once at creation and never stored (Invariant 1).
--   3. DROPS campaigns.dm_invite_code, join_as_dm(), and regenerate_dm_invite_code() outright — not
--      just narrowed/revoked. Dropping the column makes "is it selectable" moot rather than merely
--      false, and dropping the functions means a future grant regression can't accidentally make them
--      callable again, because they no longer exist to grant on. gen_invite_code()'s collision-check
--      is updated to stop referencing the now-gone column.
--   4. Existing campaigns get NO auto-created replacement DM invite — see the note at the bottom of
--      this file for why (a real flaw found while writing this migration, not an oversight).
--   5. Player invites (create_player_invite/redeem_player_invite) gain the same type filter and
--      expires_at enforcement, and the distinct "withdrawn by the DM" revocation message is folded into
--      the same generic invalid/expired/revoked response the new DM path uses (Security Invariant 8).
--      **Deliberately UNCHANGED: player invites keep plaintext `token` storage and lookup, exactly as
--      today.** The plan's original draft called for hashing both invite types uniformly, but
--      `list_campaign_invites()` / DM Console's invite list (tools/DM-Console.html ~line 2771) reads
--      back and persistently displays the plaintext token for every invite in the list — not just at
--      creation — so a DM can re-copy a link they lost. That is real, currently-used functionality;
--      hashing would silently break it, and "keep the three tools working... unless the task says
--      otherwise" (AGENTS.md) means this fix does not get to break it as a side effect of hardening a
--      DIFFERENT, unrelated invite path. DM invites have no such legacy behavior to preserve (nothing
--      today lets a DM re-view a `dm_invite_code` "again" beyond the one static value the whole
--      campaign always had), so they get hash-only storage with no regression to weigh against it.
--
-- Rate limiting (plan step 7 in the original draft) is explicitly NOT part of this migration — split
-- into docs/TASK_BOARD_NEXT.md's feat/invite-rate-limiting per the plan's Decision 4 (all 6 cold
-- reviewers agreed it shouldn't gate this fix).

-- ---------------------------------------------------------------------------
-- 1. Extend campaign_invites: type/mode/redeemed_count/max_redemptions, plus a DM-only hashed-token
--    column. `token` (plaintext) stays exactly as it was for player rows; `token_hash` is populated
--    only for dm rows and is never selectable by any client role (see the grant at the bottom).
-- ---------------------------------------------------------------------------
alter table public.campaign_invites add column if not exists type text not null default 'player';
alter table public.campaign_invites add column if not exists mode text not null default 'single_use';
alter table public.campaign_invites add column if not exists redeemed_count integer not null default 0;
alter table public.campaign_invites add column if not exists max_redemptions integer;
alter table public.campaign_invites add column if not exists token_hash text;
alter table public.campaign_invites alter column token drop not null;   -- dm rows never populate it

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'campaign_invites_type_check') then
    alter table public.campaign_invites
      add constraint campaign_invites_type_check check (type in ('player','dm'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'campaign_invites_mode_check') then
    alter table public.campaign_invites
      add constraint campaign_invites_mode_check check (mode in ('single_use','reusable'));
  end if;
  -- The database enforces the mode/max_redemptions pairing, not the RPC layer: a reusable invite
  -- MUST carry a positive limit; a single-use invite must not carry one at all (avoids a row that
  -- claims both "single use" and "capped at N uses" simultaneously — an invalid, meaningless state).
  if not exists (select 1 from pg_constraint where conname = 'campaign_invites_redemption_limit_check') then
    alter table public.campaign_invites
      add constraint campaign_invites_redemption_limit_check check (
        (mode = 'single_use' and max_redemptions is null)
        or (mode = 'reusable' and max_redemptions is not null and max_redemptions >= 1)
      );
  end if;
  -- Each type owns exactly one storage column: player rows carry plaintext `token` and never
  -- `token_hash`; dm rows carry `token_hash` and never plaintext `token`. Enforced at the database
  -- level so the two storage disciplines can never cross-contaminate.
  if not exists (select 1 from pg_constraint where conname = 'campaign_invites_token_storage_check') then
    alter table public.campaign_invites
      add constraint campaign_invites_token_storage_check check (
        (type = 'player' and token is not null and token_hash is null)
        or (type = 'dm' and token is null and token_hash is not null)
      );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'campaign_invites_token_hash_key') then
    alter table public.campaign_invites add constraint campaign_invites_token_hash_key unique (token_hash);
  end if;
end $$;

comment on column public.campaign_invites.type is
  'player or dm. Immutable once created -- a player-type token can never grant DM privileges (Security Invariant 3).';
comment on column public.campaign_invites.mode is
  'single_use or reusable. DM invites are single-use by default; reusable requires an explicit '
  'max_redemptions (owner decision, plan Decisions #2).';
comment on column public.campaign_invites.token is
  'Plaintext bearer token, PLAYER invites only. Deliberately kept plaintext+re-readable, unlike DM '
  'invites -- see this migration file''s header for why.';
comment on column public.campaign_invites.token_hash is
  'SHA-256 hex digest of the bearer token, DM invites only. The plaintext is returned once, at '
  'creation, and never stored (Security Invariant 1) -- there is no API to retrieve it again after that.';

-- ---------------------------------------------------------------------------
-- 2. Per-redemption tracking for REUSABLE (DM-only) invites -- a single redeemed_by/redeemed_at pair
--    can't record more than one redeemer, which is fine for single-use, not for reusable. Single-use
--    invites keep using the existing redeemed_by/redeemed_at columns unchanged.
-- ---------------------------------------------------------------------------
create table if not exists public.campaign_invite_redemptions (
  invite_id   uuid not null references public.campaign_invites(id) on delete cascade,
  redeemed_by uuid not null references public.profiles(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key (invite_id, redeemed_by)
);
-- The primary key covers (invite_id, redeemed_by) but not a reverse lookup on redeemed_by alone.
create index if not exists idx_campaign_invite_redemptions_redeemed_by
  on public.campaign_invite_redemptions(redeemed_by);

alter table public.campaign_invite_redemptions enable row level security;
drop policy if exists campaign_invite_redemptions_select on public.campaign_invite_redemptions;
create policy campaign_invite_redemptions_select on public.campaign_invite_redemptions
  for select using (
    redeemed_by = auth.uid()
    or exists (select 1 from campaign_invites i where i.id = invite_id and is_campaign_dm(i.campaign_id))
  );
-- No insert/update/delete policy -- written only by redeem_dm_invite() (SECURITY DEFINER) below.
grant select on public.campaign_invite_redemptions to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Drop the leaking column and the two functions that made it exploitable. Not narrowed, not
--    merely revoked -- removed outright, so there is nothing left to have a grant policy about and
--    nothing a future grant regression could re-expose.
-- ---------------------------------------------------------------------------
drop function if exists public.join_as_dm(text);
drop function if exists public.regenerate_dm_invite_code(uuid);
alter table public.campaigns drop column if exists dm_invite_code;

-- gen_invite_code()'s collision check referenced dm_invite_code; it now only needs to stay unique
-- against invite_code, since DM invites no longer come from this generator (they get their own
-- 128-bit tokens from create_dm_invite() below).
create or replace function public.gen_invite_code()
returns text language plpgsql set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  code text;
  raw  bytea;
begin
  loop
    raw := extensions.gen_random_bytes(6);
    code := '';
    for i in 0..5 loop
      code := code || substr(alphabet, 1 + (get_byte(raw, i) % 36), 1);
    end loop;
    exit when not exists (select 1 from public.campaigns where invite_code = code);
  end loop;
  return code;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. create_dm_invite() / redeem_dm_invite() -- modeled on create_player_invite()/redeem_player_invite()'s
--    shape (same DM-only creation check, same "generate a CSPRNG token, loop on collision" pattern),
--    not a fresh design. Redeemable by any authenticated account (owner decision #1) -- security rests
--    on token strength/expiry/revocation, not membership-scoping, which is a deliberate, recorded
--    choice (Security Invariant 12), not an oversight.
-- ---------------------------------------------------------------------------
create or replace function public.create_dm_invite(
  p_campaign_id     uuid,
  p_mode            text default 'single_use',
  p_max_redemptions integer default null,
  p_note            text default null,
  p_expires_at      timestamptz default null
)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_token text;
  v_hash  text;
  v_note  text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not is_campaign_dm(p_campaign_id) then
    raise exception 'Only a campaign DM can create a DM invite';
  end if;
  if p_mode not in ('single_use', 'reusable') then
    raise exception 'Invalid invite mode';
  end if;
  if p_mode = 'reusable' and (p_max_redemptions is null or p_max_redemptions < 1) then
    raise exception 'Reusable invites require a positive redemption limit';
  end if;
  if v_note is not null and length(v_note) > 200 then v_note := left(v_note, 200); end if;

  loop
    v_token := encode(extensions.gen_random_bytes(16), 'hex');
    v_hash  := encode(extensions.digest(v_token, 'sha256'), 'hex');
    exit when not exists (select 1 from campaign_invites where token_hash = v_hash);
  end loop;

  insert into campaign_invites
      (campaign_id, token_hash, type, mode, max_redemptions, created_by, note, expires_at)
    values (
      p_campaign_id, v_hash, 'dm', p_mode,
      case when p_mode = 'reusable' then p_max_redemptions else null end,
      auth.uid(), v_note, p_expires_at
    );

  return v_token;   -- plaintext returned ONCE; no API retrieves it again (Security Invariant 1/5).
end;
$$;

create or replace function public.redeem_dm_invite(p_token text)
returns table(campaign_id uuid, already_member boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_hash   text;
  v_invite campaign_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  -- FOR UPDATE serializes concurrent redemption attempts against this exact invite row -- the atomic
  -- primitive for the more-than-one-branch logic below (idempotency, single-use vs. reusable, limit
  -- enforcement), the same way a bare UPDATE...WHERE...RETURNING is the primitive for the simpler
  -- single-branch player-invite claim.
  select * into v_invite from campaign_invites where token_hash = v_hash and type = 'dm' for update;

  if not found then
    raise exception 'Invite is invalid or already redeemed';
  end if;

  -- Idempotency FIRST (Security Invariant 10): a repeat call from the original redeemer, or from
  -- anyone who is already a co-DM of this campaign by any path, is a no-op -- same result, no state
  -- change, no error -- evaluated before validity so it still succeeds even if the invite has since
  -- expired/been revoked/hit its limit in the interim.
  if (v_invite.mode = 'single_use' and v_invite.redeemed_by = auth.uid())
     or (v_invite.mode = 'reusable' and exists (
           select 1 from campaign_invite_redemptions r
           where r.invite_id = v_invite.id and r.redeemed_by = auth.uid()))
     or is_campaign_dm(v_invite.campaign_id)
  then
    return query select v_invite.campaign_id, true;
    return;
  end if;

  -- Generic validity check (Security Invariant 8): nonexistent (handled above), expired, revoked,
  -- already-consumed-by-someone-else, or exhausted all produce the SAME error -- the caller cannot
  -- distinguish which condition applied.
  if v_invite.revoked_at is not null
     or (v_invite.expires_at is not null and v_invite.expires_at <= now())
     or (v_invite.mode = 'single_use' and v_invite.redeemed_by is not null)
     or (v_invite.mode = 'reusable' and v_invite.redeemed_count >= v_invite.max_redemptions)
  then
    raise exception 'Invite is invalid or already redeemed';
  end if;

  if v_invite.mode = 'single_use' then
    update campaign_invites set redeemed_by = auth.uid(), redeemed_at = now() where id = v_invite.id;
  else
    update campaign_invites set redeemed_count = redeemed_count + 1 where id = v_invite.id;
    insert into campaign_invite_redemptions (invite_id, redeemed_by) values (v_invite.id, auth.uid())
      on conflict do nothing;
  end if;

  insert into campaign_dms (campaign_id, dm_id, added_by)
    values (v_invite.campaign_id, auth.uid(), v_invite.created_by)
    on conflict do nothing;

  return query select v_invite.campaign_id, false;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Player invites: type filter + expires_at enforcement + generic-error consolidation. Token
--    storage/lookup is UNCHANGED (still plaintext `token`, still direct equality) -- see this file's
--    header for why.
-- ---------------------------------------------------------------------------
create or replace function public.create_player_invite(
  p_campaign_id     uuid,
  p_starting_ap     integer default 0,
  p_starting_budget integer default 0,   -- DEPRECATED: folded into p_starting_ap; kept for old clients
  p_note            text    default null
)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_token text;
  v_ap    integer := coalesce(p_starting_ap, 0);
  v_extra integer := coalesce(p_starting_budget, 0);
  v_note  text    := nullif(trim(coalesce(p_note, '')), '');
begin
  if not is_campaign_dm(p_campaign_id) then
    raise exception 'Only a campaign DM can create a player invite';
  end if;
  if v_ap < 0 or v_extra < 0 then
    raise exception 'Starting AP must be non-negative';
  end if;
  v_ap := v_ap + v_extra;
  if v_note is not null and length(v_note) > 200 then v_note := left(v_note, 200); end if;

  loop
    v_token := encode(extensions.gen_random_bytes(16), 'hex');
    exit when not exists (select 1 from campaign_invites where token = v_token);
  end loop;

  insert into campaign_invites (campaign_id, token, type, mode, starting_ap, starting_budget, created_by, note)
    values (p_campaign_id, v_token, 'player', 'single_use', v_ap, 0, auth.uid(), v_note);

  return v_token;
end;
$$;

create or replace function public.redeem_player_invite(p_token text, p_name text default null)
returns table(character_id uuid, starting_ap integer, starting_budget integer, campaign_id uuid, is_new boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_invite  campaign_invites%rowtype;
  v_char_id uuid;
  v_name    text;
  v_grant   integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update campaign_invites
    set redeemed_by = auth.uid(), redeemed_at = now()
    where token = p_token and type = 'player' and redeemed_by is null and revoked_at is null
      and (expires_at is null or expires_at > now())
    returning * into v_invite;

  if found then
    if is_campaign_member(v_invite.campaign_id) then
      raise exception 'You have already joined this campaign';
    end if;

    v_grant := coalesce(v_invite.starting_ap, 0) + coalesce(v_invite.starting_budget, 0);

    v_name := nullif(trim(coalesce(p_name, '')), '');
    if v_name is null then v_name := 'New Character'; end if;
    if length(v_name) > 100 then v_name := left(v_name, 100); end if;

    begin
      insert into characters (owner_id, campaign_id, name, kind, ap)
        values (auth.uid(), v_invite.campaign_id, v_name, 'chargen', v_grant)
        returning id into v_char_id;
    exception when unique_violation then
      raise exception 'You have already joined this campaign';
    end;

    if v_grant <> 0 then
      insert into ap_awards (character_id, dm_id, campaign_id, amount, note)
        values (v_char_id, v_invite.created_by, v_invite.campaign_id, v_grant,
                coalesce(nullif(trim(v_invite.note), ''), 'Starting AP (campaign invite)'));
    end if;

    return query select v_char_id, v_grant, 0, v_invite.campaign_id, true;
    return;
  end if;

  -- Not claimed by the UPDATE above. Idempotent re-return for the original redeemer; the identical
  -- generic error for everything else (never existed, wrong type, expired, revoked, already redeemed
  -- by someone else) -- Security Invariant 8. (Folds the previously-distinct "withdrawn by the DM"
  -- message into this same generic path.)
  select * into v_invite from campaign_invites where token = p_token and type = 'player' and redeemed_by = auth.uid();
  if not found then
    raise exception 'Invite is invalid or already redeemed';
  end if;

  select id into v_char_id from characters
    where owner_id = auth.uid() and campaign_id = v_invite.campaign_id
    limit 1;
  if v_char_id is null then
    raise exception 'Invite already redeemed but character not found';
  end if;

  v_grant := coalesce(v_invite.starting_ap, 0) + coalesce(v_invite.starting_budget, 0);
  return query select v_char_id, v_grant, 0, v_invite.campaign_id, false;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Extend list_campaign_invites() to surface the new columns and work for both invite types.
--    Player rows return their real (plaintext) token, exactly as before. DM rows return null for
--    token -- the plaintext was never stored (Security Invariant 1) -- and a DM invite's
--    character_id/character_name simply come back null too (a DM invite never creates a character),
--    which is graceful, not an error.
--
--    The RETURNS TABLE shape is changing (new columns), which Postgres will not allow via a bare
--    CREATE OR REPLACE -- an explicit DROP is required first.
-- ---------------------------------------------------------------------------
drop function if exists public.list_campaign_invites(uuid);

create or replace function public.list_campaign_invites(p_campaign uuid)
returns table(
  id                uuid,
  type              text,
  mode              text,
  token             text,
  note              text,
  starting_ap       integer,
  max_redemptions   integer,
  redeemed_count    integer,
  expires_at        timestamptz,
  created_at        timestamptz,
  revoked_at        timestamptz,
  redeemed_at       timestamptz,
  redeemed_by_name  text,
  character_id      uuid,
  character_name    text
)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_campaign_dm(p_campaign) then
    raise exception 'Only a campaign DM can list invites';
  end if;
  return query
    select i.id, i.type, i.mode, i.token,
           i.note,
           coalesce(i.starting_ap, 0) + coalesce(i.starting_budget, 0),   -- same fold the RPCs apply
           i.max_redemptions, i.redeemed_count, i.expires_at,
           i.created_at, i.revoked_at, i.redeemed_at,
           p.display_name, c.id, c.name
      from campaign_invites i
      left join profiles p on p.id = i.redeemed_by
      left join characters c on c.owner_id = i.redeemed_by and c.campaign_id = i.campaign_id
     where i.campaign_id = p_campaign
     order by i.created_at desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants. Old join_as_dm/regenerate_dm_invite_code grants are gone with the functions (nothing to
--    revoke -- they no longer exist). New functions follow the same authenticated-only,
--    revoked-from-public pattern every other invite RPC in this file already uses.
-- ---------------------------------------------------------------------------
grant execute on function public.create_dm_invite(uuid, text, integer, text, timestamptz) to authenticated;
grant execute on function public.redeem_dm_invite(text)                                   to authenticated;
revoke execute on function public.create_dm_invite(uuid, text, integer, text, timestamptz) from public;
revoke execute on function public.redeem_dm_invite(text)                                   from public;

-- campaign_invites' select grant gains the new columns (all safe to expose -- type/mode/counters are
-- not secrets, and `token` was already grantable). token_hash is explicitly EXCLUDED -- it is never
-- selectable by any client role, ever.
grant select (id, campaign_id, type, mode, token, starting_ap, starting_budget,
              max_redemptions, redeemed_count, expires_at,
              created_by, created_at, revoked_at,
              redeemed_by, redeemed_at)
  on public.campaign_invites to authenticated;   -- every column except note and token_hash

-- ---------------------------------------------------------------------------
-- 8. Existing campaigns: deliberately NOT auto-migrated to a replacement DM invite.
--
-- The plan draft (docs/plans/2026-08-08-harden-invitation-system.md step 6) originally called for
-- generating one fresh token per existing campaign here. Implementing it surfaced a real flaw: a token
-- generated and immediately hashed-and-discarded inside a migration script is never seen by anyone,
-- including the DM it's meant for -- under DM invites' hash-only storage (Security Invariant 1: no API
-- ever retrieves a plaintext token after creation), a migration-created invite would be permanently
-- unredeemable clutter, not a usable replacement. There is no email/notification channel in this
-- project to hand the DM the plaintext out-of-band either (AGENTS.md: no custom backend beyond
-- Supabase).
--
-- So: the old dm_invite_code is simply retired (step 3 above), with no auto-created successor. Live
-- data confirms zero co-DMs have ever been added via join_as_dm in production, so no DM is mid-invite
-- with the old code today. Any DM who wants to invite a co-DM generates a fresh one on demand through
-- the new "Generate DM invite" UI (create_dm_invite()) once it ships -- this is a one-click action, not
-- a burden, and it means every DM invite that ever exists going forward was created under the hardened
-- model from the start, with no transitional/grandfathered exception to reason about.

-- ---------------------------------------------------------------------------
-- 9. Self-caught follow-up fixes, applied as two separate statements immediately after the migration
--    above (kept here as a single honest record of what actually ran, rather than folded silently
--    back into section 6 as if it had always been correct).
--
-- Fix 1 -- grant drift. Section 6's `drop function if exists public.list_campaign_invites(uuid);`
-- (needed because Postgres won't CREATE OR REPLACE a function whose RETURNS TABLE shape changed) wiped
-- out the function's prior `revoke execute ... from public`, leaving it callable by the ANON role --
-- caught immediately by the Supabase advisor (get_advisors), not by inspection alone. This is exactly
-- the class of grant/RLS drift this project has been bitten by twice before (D-GH15, D-GH12); it is
-- exactly why that advisor is a standing, non-optional step for any RLS/grant-touching change, not a
-- courtesy check.
grant execute on function public.list_campaign_invites(uuid) to authenticated;
revoke execute on function public.list_campaign_invites(uuid) from public;

-- Fix 2 -- minor performance advisory (INFO level, not security). campaign_invite_redemptions'
-- primary key covers (invite_id, redeemed_by) but not a reverse lookup on redeemed_by alone; the
-- advisor flagged the resulting unindexed foreign key. Cheap and safe to add -- folded directly into
-- section 2's table definition above (not restated here) once found, so this file doesn't carry the
-- same `create index if not exists ...` statement twice (a redundancy a later code review caught,
-- 2026-08-09 -- harmless at runtime given IF NOT EXISTS, but confusing to a future reader who'd
-- otherwise wonder whether section 2's copy was ever actually applied).

-- ---------------------------------------------------------------------------
-- 10. Further self-caught fixes, from a 9-angle adversarial code review (2026-08-09) run before this
--     PR was merged. Applied as their own statements immediately after the migration above, kept here
--     as an honest record rather than silently folded back into the sections above as if always correct.
-- ---------------------------------------------------------------------------

-- Fix 3 -- schema gap. Nothing tied mode='reusable' to type='dm', even though the design (and every
-- comment in this file) assumes reusable invites are DM-only. No live code path creates the
-- type='player'/mode='reusable' combination today, but the schema itself permitted it.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'campaign_invites_reusable_dm_only_check') then
    alter table public.campaign_invites
      add constraint campaign_invites_reusable_dm_only_check check (mode = 'single_use' or type = 'dm');
  end if;
end $$;

-- Fix 4 -- list_campaign_invites()'s character JOIN wasn't scoped to type='player', so a co-DM invite
-- whose redeemer also happened to own an unrelated character in that campaign could spuriously show
-- that character as if the DM invite had produced it (it never does).
-- Fix 5 -- redeem_dm_invite() set campaign_dms.added_by to the invite's creator instead of auth.uid()
-- (the actual caller performing this write), diverging from promote_to_dm()'s and the owner-auto-add
-- trigger's established convention for that column.
create or replace function public.redeem_dm_invite(p_token text)
returns table(campaign_id uuid, already_member boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_hash   text;
  v_invite campaign_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select * into v_invite from campaign_invites where token_hash = v_hash and type = 'dm' for update;

  if not found then
    raise exception 'Invite is invalid or already redeemed';
  end if;

  if (v_invite.mode = 'single_use' and v_invite.redeemed_by = auth.uid())
     or (v_invite.mode = 'reusable' and exists (
           select 1 from campaign_invite_redemptions r
           where r.invite_id = v_invite.id and r.redeemed_by = auth.uid()))
     or is_campaign_dm(v_invite.campaign_id)
  then
    return query select v_invite.campaign_id, true;
    return;
  end if;

  if v_invite.revoked_at is not null
     or (v_invite.expires_at is not null and v_invite.expires_at <= now())
     or (v_invite.mode = 'single_use' and v_invite.redeemed_by is not null)
     or (v_invite.mode = 'reusable' and v_invite.redeemed_count >= v_invite.max_redemptions)
  then
    raise exception 'Invite is invalid or already redeemed';
  end if;

  if v_invite.mode = 'single_use' then
    update campaign_invites set redeemed_by = auth.uid(), redeemed_at = now() where id = v_invite.id;
  else
    update campaign_invites set redeemed_count = redeemed_count + 1 where id = v_invite.id;
    insert into campaign_invite_redemptions (invite_id, redeemed_by) values (v_invite.id, auth.uid())
      on conflict do nothing;
  end if;

  insert into campaign_dms (campaign_id, dm_id, added_by)
    values (v_invite.campaign_id, auth.uid(), auth.uid())
    on conflict do nothing;

  return query select v_invite.campaign_id, false;
end;
$$;

drop function if exists public.list_campaign_invites(uuid);

create or replace function public.list_campaign_invites(p_campaign uuid)
returns table(
  id                uuid,
  type              text,
  mode              text,
  token             text,
  note              text,
  starting_ap       integer,
  max_redemptions   integer,
  redeemed_count    integer,
  expires_at        timestamptz,
  created_at        timestamptz,
  revoked_at        timestamptz,
  redeemed_at       timestamptz,
  redeemed_by_name  text,
  character_id      uuid,
  character_name    text
)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_campaign_dm(p_campaign) then
    raise exception 'Only a campaign DM can list invites';
  end if;
  return query
    select i.id, i.type, i.mode, i.token,
           i.note,
           coalesce(i.starting_ap, 0) + coalesce(i.starting_budget, 0),
           i.max_redemptions, i.redeemed_count, i.expires_at,
           i.created_at, i.revoked_at, i.redeemed_at,
           p.display_name, c.id, c.name
      from campaign_invites i
      left join profiles p on p.id = i.redeemed_by
      left join characters c on i.type = 'player' and c.owner_id = i.redeemed_by and c.campaign_id = i.campaign_id
     where i.campaign_id = p_campaign
     order by i.created_at desc;
end;
$$;

-- list_campaign_invites()'s signature/RETURNS TABLE shape is unchanged from section 6, so this
-- CREATE OR REPLACE doesn't need another DROP FUNCTION first -- but its grants were already restated
-- in section 9's Fix 1 above and CREATE OR REPLACE doesn't touch existing grants, so nothing to redo.
