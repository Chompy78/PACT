-- feat/character-ownership-claim-link follow-up. Owner decision, 2026-08-11: keep the claim link
-- token PLAINTEXT (like a player invite), not hash-only (like a co-DM invite) as first shipped in
-- 2026-08-11-character-claim-link.sql. Shown-once is fine for v1; there is no persistent
-- redisplay/reissue UI planned that would need the stricter hash-only bar. See the decision record's
-- Addendum for the full reasoning. Zero character_claim rows existed at the time of this change
-- (confirmed via `select count(*) from campaign_invites where type = 'character_claim'`), so this is a
-- clean flip, not a data migration.

alter table public.campaign_invites drop constraint if exists campaign_invites_token_storage_check;
alter table public.campaign_invites
  add constraint campaign_invites_token_storage_check check (
    (type in ('player','character_claim') and token is not null and token_hash is null)
    or (type = 'dm' and token is null and token_hash is not null)
  );

create or replace function public.create_character_claim(p_character_id uuid, p_note text default null)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_char  characters%rowtype;
  v_token text;
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
    exit when not exists (select 1 from campaign_invites where token = v_token);
  end loop;

  insert into campaign_invites (campaign_id, token, type, mode, source_character_id, created_by, note)
    values (v_char.campaign_id, v_token, 'character_claim', 'single_use', p_character_id, auth.uid(), v_note);

  return v_token;
end;
$$;

create or replace function public.redeem_character_claim(p_token text)
returns table(character_id uuid, campaign_id uuid, is_new boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_invite campaign_invites%rowtype;
  v_source characters%rowtype;
  v_new_id uuid;
  v_stats  jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_invite from campaign_invites where token = p_token and type = 'character_claim' for update;

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

-- Grants are unchanged (same function signatures) -- no new revoke/grant needed.
