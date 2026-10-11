-- feat/unique-character-names (2026-10-11) — the database refuses two ACTIVE characters with the same name for one player.
-- Decision: decisions/2026/D-GH-2026-10-11-unique-character-names.md (owner choice G2, 2026-10-10).
--
-- THE PROBLEM. The only duplicate-name check (_lsRenameGuard, #545) runs in the browser, on Live Sheet's Rename button
-- only. Saving, importing a file, switching tools and CharGen never checked. A player ended up with two active
-- "Caspian" rows (one in his campaign, one a stale solo copy) and could not tell which to load.
--
-- WHAT THIS CHANGES.
--   1. uq_characters_owner_active_name: unique on (owner_id, lower(btrim(name))) over ACTIVE rows (archived_at null).
--      Exempt: 'New Character' and 'Character' (the tools' unnamed defaults — every fresh draft carries one) and any
--      name ending ' (DM copy)' (CharGen's throwaway DM snapshots; two players' same-named characters would otherwise
--      collide on the DM's account). Archiving a character frees its name; un-archiving into a clash is refused.
--   2. redeem_player_invite() and redeem_character_claim(): their `exception when unique_violation` handlers caught
--      every unique violation as "already in this campaign". They now check the constraint name and, for a name
--      clash, raise a plain 'PACT: you already have a character named …' instead. Built from the LIVE definitions
--      (pg_proc, 2026-10-11; byte-identical after normalisation to sql/schema.sql) — every other line is unchanged.
--
-- WHAT THIS DELIBERATELY LEAVES ALONE.
--   * join_campaign() always inserts 'New Character' (exempt); bind_character_to_campaign() never changes a name.
--   * The client message for a direct save (PostgREST 23505 on this index) lives in js/sync.js
--     isDuplicateNameRejection() / DUPLICATE_NAME_MESSAGE.
--
-- BLAST RADIUS, measured on live 2026-10-11: 0 active pairs violate the index (the last real pair, a player's two
-- "Caspian", was resolved 2026-10-11 by renaming the stale copy "Caspian (old copy)"; one other account's two
-- "Character" rows are exempt). 0 archived rows share a name with an active one. 10 active DM copies, all exempt.

create unique index if not exists uq_characters_owner_active_name
  on public.characters (owner_id, lower(btrim(name)))
  where archived_at is null
    and lower(btrim(name)) not in ('new character', 'character')
    and lower(btrim(name)) not like '% (dm copy)';

create or replace function public.redeem_player_invite(p_token text, p_name text default null)
returns table(character_id uuid, starting_ap integer, starting_budget integer, campaign_id uuid, is_new boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_invite  campaign_invites%rowtype;
  v_char_id uuid;
  v_name    text;
  v_grant   integer;
  v_con     text;
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
      -- feat/unique-character-names: the same insert can now also hit uq_characters_owner_active_name.
      get stacked diagnostics v_con = constraint_name;
      if v_con = 'uq_characters_owner_active_name' then
        raise exception 'PACT: you already have a character named "%" — choose a different name', v_name;
      end if;
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
  -- generic error for everything else (Security Invariant 8).
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

create or replace function public.redeem_character_claim(p_token text)
returns table(character_id uuid, campaign_id uuid, is_new boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_invite campaign_invites%rowtype;
  v_source characters%rowtype;
  v_new_id uuid;
  v_stats  jsonb;
  v_con    text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  -- FOR UPDATE serializes concurrent redemption attempts against this exact invite row.
  select * into v_invite from campaign_invites where token = p_token and type = 'character_claim' for update;

  if not found then
    raise exception 'Claim link is invalid or already used';
  end if;

  -- Idempotency FIRST (Security Invariant 10): a repeat call from the original redeemer returns the
  -- same copy instead of erroring or creating a second one. The one-character-per-player-per-campaign
  -- unique index means that copy is unambiguously identifiable by (owner, campaign), same lookup
  -- redeem_player_invite() already uses for its own idempotent branch.
  if v_invite.redeemed_by = auth.uid() then
    select id into v_new_id from characters
      where owner_id = auth.uid() and campaign_id = v_invite.campaign_id limit 1;
    if v_new_id is null then
      raise exception 'Claim link already redeemed but the resulting character was not found';
    end if;
    return query select v_new_id, v_invite.campaign_id, false;
    return;
  end if;

  -- Generic validity check (Security Invariant 8): nonexistent (handled above), expired, revoked, or
  -- already redeemed by someone else all produce the same error.
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

  -- The copy gets its own fresh id -- the source's stats envelope carries its OWN id inline (D-GH40's
  -- unified save format), so that has to be rewritten to the new row's id or the copy would boot
  -- pointing at the wrong character (same hazard _cgDeriveCopyId()'s DM-copy path in CharGen guards
  -- against client-side; here it's server-side and unconditional, so there is nothing to assert).
  v_new_id := gen_random_uuid();
  v_stats  := coalesce(v_source.stats, '{}'::jsonb) || jsonb_build_object('id', v_new_id);

  begin
    insert into characters (id, owner_id, campaign_id, name, kind, stats, ap)
      values (v_new_id, auth.uid(), v_invite.campaign_id, v_source.name, v_source.kind, v_stats, v_source.ap);
  exception when unique_violation then
    -- feat/unique-character-names: the copied name can now also hit uq_characters_owner_active_name.
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'uq_characters_owner_active_name' then
      raise exception 'PACT: you already have a character named "%" — rename or archive it, then use this link again', v_source.name;
    end if;
    raise exception 'You already have a character in this campaign';
  end;

  -- AP carries over (design decision: the player inherits the character as built, awards included) --
  -- recorded as its own ap_awards row for provenance, same "why does this already have AP" trail any
  -- other grant leaves, not silently folded into the insert alone.
  if v_source.ap <> 0 then
    insert into ap_awards (character_id, dm_id, campaign_id, amount, note)
      values (v_new_id, v_invite.created_by, v_invite.campaign_id, v_source.ap, 'Carried over from claimed character');
  end if;

  update campaign_invites set redeemed_by = auth.uid(), redeemed_at = now() where id = v_invite.id;

  return query select v_new_id, v_invite.campaign_id, true;
end;
$$;
