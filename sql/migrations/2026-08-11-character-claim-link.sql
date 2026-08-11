-- feat/character-ownership-claim-link (D-GH-2026-08-11-character-claim-link-copy-not-transfer).
--
-- A DM who owns a campaign-bound character (built/imported under their own account, then bound via
-- the EXISTING bind_character_to_campaign() -- no new capability needed for that step) can generate a
-- single-use claim link. A player redeems it to get their OWN new character, COPIED from the DM's --
-- the source character's owner_id is never written by this flow. This needs no RLS/ownership-model
-- change at all: redeem_character_claim() only ever INSERTs a row the redeeming player already has
-- the right to own (owner_id = auth.uid()), exactly what CharGen's normal Save already does under the
-- existing characters_insert policy.
--
-- Storage: hash-only (token_hash), the same bar as a co-DM invite (Security Invariant 1's strict
-- default) rather than the player-invite plaintext exception -- a claim link hands off something of
-- real value (a fully-built character), not a blank one, and there is no re-display/reissue UI in v1
-- that would justify the plaintext exception the way list_campaign_invites() does for player invites.
--
-- See sql/schema.sql (campaign_invites table + the two new functions, same section) and
-- sql/rls-policies.sql (execute grants) for the living-document copies this migration keeps in sync.

-- ---------------------------------------------------------------------------
-- 1. campaign_invites: new type, new column, updated constraints.
-- ---------------------------------------------------------------------------
alter table public.campaign_invites
  add column if not exists source_character_id uuid references public.characters(id) on delete cascade;

alter table public.campaign_invites drop constraint if exists campaign_invites_type_check;
alter table public.campaign_invites
  add constraint campaign_invites_type_check check (type = any (array['player','dm','character_claim']));

alter table public.campaign_invites drop constraint if exists campaign_invites_token_storage_check;
alter table public.campaign_invites
  add constraint campaign_invites_token_storage_check check (
    (type = 'player' and token is not null and token_hash is null)
    or (type in ('dm','character_claim') and token is null and token_hash is not null)
  );

alter table public.campaign_invites drop constraint if exists campaign_invites_source_character_check;
alter table public.campaign_invites
  add constraint campaign_invites_source_character_check check (
    (type = 'character_claim' and source_character_id is not null)
    or (type <> 'character_claim' and source_character_id is null)
  );

create index if not exists idx_campaign_invites_source_character
  on public.campaign_invites(source_character_id);

-- ---------------------------------------------------------------------------
-- 2. create_character_claim(character_id, note) -- DM-of-the-character's-campaign + owner gated.
--    Token handling mirrors create_dm_invite() (hash-only, CSPRNG, collision-retry, returned once).
-- ---------------------------------------------------------------------------
create or replace function public.create_character_claim(p_character_id uuid, p_note text default null)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_char  characters%rowtype;
  v_token text;
  v_hash  text;
  v_note  text := nullif(trim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_char from characters where id = p_character_id and owner_id = auth.uid();
  if not found then
    raise exception 'Character not found';
  end if;
  if v_char.campaign_id is null then
    raise exception 'Bind this character to a campaign before generating a claim link';
  end if;
  if not is_campaign_dm(v_char.campaign_id) then
    raise exception 'Only a DM of this character''s campaign can generate a claim link';
  end if;
  if v_note is not null and length(v_note) > 200 then v_note := left(v_note, 200); end if;

  loop
    v_token := encode(extensions.gen_random_bytes(16), 'hex');
    v_hash  := encode(extensions.digest(v_token, 'sha256'), 'hex');
    exit when not exists (select 1 from campaign_invites where token_hash = v_hash);
  end loop;

  insert into campaign_invites (campaign_id, token_hash, type, mode, source_character_id, created_by, note)
    values (v_char.campaign_id, v_hash, 'character_claim', 'single_use', p_character_id, auth.uid(), v_note);

  return v_token;   -- plaintext returned ONCE; no API retrieves it again (Security Invariant 1/5).
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. redeem_character_claim(token) -- copies the source character into a new row owned by the
--    caller. Idempotent on repeat calls from the same redeemer (Security Invariant 10), generic
--    error on anything else invalid (Security Invariant 8), same shapes as redeem_dm_invite() /
--    redeem_player_invite().
-- ---------------------------------------------------------------------------
create or replace function public.redeem_character_claim(p_token text)
returns table(character_id uuid, campaign_id uuid, is_new boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_hash   text;
  v_invite campaign_invites%rowtype;
  v_source characters%rowtype;
  v_new_id uuid;
  v_stats  jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select * into v_invite from campaign_invites where token_hash = v_hash and type = 'character_claim' for update;

  if not found then
    raise exception 'Claim link is invalid or already used';
  end if;

  if v_invite.redeemed_by = auth.uid() then
    select id into v_new_id from characters
      where owner_id = auth.uid() and campaign_id = v_invite.campaign_id limit 1;
    if v_new_id is null then
      raise exception 'Claim link already redeemed but the resulting character was not found';
    end if;
    return query select v_new_id, v_invite.campaign_id, false;
    return;
  end if;

  if v_invite.revoked_at is not null
     or (v_invite.expires_at is not null and v_invite.expires_at <= now())
     or v_invite.redeemed_by is not null
  then
    raise exception 'Claim link is invalid or already used';
  end if;

  if is_campaign_member(v_invite.campaign_id) then
    raise exception 'You already have a character in this campaign';
  end if;

  select * into v_source from characters where id = v_invite.source_character_id;
  if not found then
    raise exception 'The source character no longer exists';
  end if;

  v_new_id := gen_random_uuid();
  v_stats  := coalesce(v_source.stats, '{}'::jsonb) || jsonb_build_object('id', v_new_id);

  begin
    insert into characters (id, owner_id, campaign_id, name, kind, stats, ap)
      values (v_new_id, auth.uid(), v_invite.campaign_id, v_source.name, v_source.kind, v_stats, v_source.ap);
  exception when unique_violation then
    raise exception 'You already have a character in this campaign';
  end;

  if v_source.ap <> 0 then
    insert into ap_awards (character_id, dm_id, campaign_id, amount, note)
      values (v_new_id, v_invite.created_by, v_invite.campaign_id, v_source.ap, 'Carried over from claimed character');
  end if;

  update campaign_invites set redeemed_by = auth.uid(), redeemed_at = now() where id = v_invite.id;

  return query select v_new_id, v_invite.campaign_id, true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Grants.
-- ---------------------------------------------------------------------------
-- Postgres grants EXECUTE to PUBLIC by default on every new function -- revoke it explicitly (same
-- pattern every other RPC in rls-policies.sql follows) so these are authenticated-only, not also
-- callable by anon.
revoke execute on function public.create_character_claim(uuid, text) from public;
revoke execute on function public.redeem_character_claim(text)       from public;
grant execute on function public.create_character_claim(uuid, text) to authenticated;
grant execute on function public.redeem_character_claim(text)       to authenticated;
