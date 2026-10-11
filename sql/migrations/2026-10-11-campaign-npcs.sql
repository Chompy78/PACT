-- feat/campaign-npcs (2026-10-11) — a DM can bind several of their OWN characters to their campaign as NPCs.
-- Decision: decisions/2026/D-GH-2026-10-11-campaign-npcs.md · Plan: docs/plans/2026-10-11-campaign-npcs.md (cold-reviewed).
--
-- THE PROBLEM. The Amble DM wants the campaign's NPCs (Bram, Wren; two versions per story arc) inside the campaign, with
-- DM-awarded AP. Binding them as ordinary characters fails three ways: idx_characters_owner_campaign_unique allows ONE
-- character per owner per campaign; bind_character_to_campaign() auto-grants the campaign's starting AP; and a bound
-- character is a party member in every DM Console bulk action.
--
-- WHAT THIS CHANGES.
--   1. characters.is_npc boolean not null default false, with check (not is_npc or campaign_id is not null).
--      NOT added to any client insert/update column grant: only dm_bind_npc() below can set it, so a player can never
--      self-flag to escape the one-per-campaign rule.
--   2. Trigger trg_pact_npc_clear_on_unbind: when campaign_id becomes null, is_npc is forced false. Covers
--      dm_unbind_character() AND the FK's `on delete set null` when a campaign is deleted, without editing either.
--   3. idx_characters_owner_campaign_unique is re-created with `and not is_npc`. Players keep exactly today's rule and
--      its race guard (the bind RPCs' "already a member?" check is check-then-write; only this index closes the race).
--   4. New RPC dm_bind_npc(character, campaign): caller owns the character, it is unbound and active, caller is a DM of
--      the campaign, campaign is active. Sets campaign_id + is_npc in one update. NO starting-AP grant — the DM sets AP
--      with award_ap(). Unbinding reuses dm_unbind_character().
--   5. `not is_npc` added where "the player's character in this campaign" is meant: is_campaign_member(),
--      is_dm_of_player(), the idempotent `limit 1` lookups in redeem_player_invite() and redeem_character_claim(), and the
--      redeemed-character join in list_campaign_invites(). All five built from the LIVE definitions (pg_proc,
--      2026-10-11; identical after normalisation to sql/schema.sql / sql/rls-policies.sql) — every other line unchanged.
--   6. remove_dm() also unbinds the removed DM's NPCs in that campaign: an NPC always belongs to a current DM.
--
-- WHAT THIS DELIBERATELY LEAVES ALONE.
--   * pact_enforce_basic_mode() still counts NPCs. Any user can create a campaign and so become its DM; excluding NPCs
--     would let a basic-mode user bind unlimited characters as NPCs (cold review, Gemini, 2026-10-11 — verified).
--   * shares_campaign(): its "we both play" branch can now match an NPC owner, but that owner is a DM of the campaign and
--     already matches the "I DM a campaign p_other plays in" branch, so profile visibility is unchanged.
--   * declare_downtime(): the party-wide window also covers NPCs. Harmless (downtime locks nothing; players never see NPCs).
--   * Read policies: characters_select is owner-or-campaign-DM, so players never read NPC rows. Unchanged.
--
-- BLAST RADIUS, measured on live 2026-10-11: 35 characters, 6 campaign-bound (all Amble), 0 owned by a DM of their own
-- campaign. The new column defaults false, so no existing row changes meaning; the re-created index covers exactly the
-- same 6 rows as before.

alter table public.characters add column if not exists is_npc boolean not null default false;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'characters_npc_needs_campaign') then
    alter table public.characters add constraint characters_npc_needs_campaign check (not is_npc or campaign_id is not null);
  end if;
end $$;

create or replace function public.pact_npc_clear_on_unbind()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.is_npc := false;
  return new;
end;
$$;
revoke all on function public.pact_npc_clear_on_unbind() from public, anon, authenticated;

drop trigger if exists trg_pact_npc_clear_on_unbind on public.characters;
create trigger trg_pact_npc_clear_on_unbind
  before update on public.characters
  for each row when (new.campaign_id is null and new.is_npc)
  execute function public.pact_npc_clear_on_unbind();

drop index if exists public.idx_characters_owner_campaign_unique;
create unique index idx_characters_owner_campaign_unique
  on public.characters(owner_id, campaign_id) where campaign_id is not null and not is_npc;

create or replace function public.dm_bind_npc(p_character uuid, p_campaign uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_char characters%rowtype;
begin
  if auth.uid() is null then
    raise exception 'PACT: not signed in';
  end if;
  select * into v_char from characters where id = p_character and owner_id = auth.uid() for update;
  if not found then
    raise exception 'PACT: character not found (an NPC must be one of your own characters)';
  end if;
  if not is_campaign_dm(p_campaign) then
    raise exception 'PACT: only a DM of this campaign can add an NPC to it';
  end if;
  perform assert_campaign_active(p_campaign);
  if v_char.archived_at is not null then
    raise exception 'PACT: un-archive this character before adding it as an NPC';
  end if;
  if v_char.campaign_id = p_campaign and v_char.is_npc then
    return p_campaign;
  end if;
  if v_char.campaign_id is not null then
    raise exception 'PACT: this character is already in a campaign — remove it from that campaign first';
  end if;
  update characters set campaign_id = p_campaign, is_npc = true where id = p_character;
  return p_campaign;
end;
$$;
revoke all on function public.dm_bind_npc(uuid, uuid) from public, anon;
grant execute on function public.dm_bind_npc(uuid, uuid) to authenticated;

create or replace function public.is_campaign_member(p_campaign uuid)
returns boolean language sql security definer stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from characters where campaign_id = p_campaign and owner_id = auth.uid() and not is_npc
  );
$$;

create or replace function public.is_dm_of_player(p_player uuid)
returns boolean language sql security definer stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from campaign_dms d join characters ch on ch.campaign_id = d.campaign_id
      where d.dm_id = auth.uid() and ch.owner_id = p_player and not ch.is_npc
  );
$$;

create or replace function public.remove_dm(p_campaign uuid, p_profile uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_campaign_owner(p_campaign) then
    raise exception 'Only the campaign owner can remove co-DMs';
  end if;
  if p_profile = (select dm_id from campaigns where id = p_campaign) then
    raise exception 'The owner cannot be removed as DM';
  end if;
  delete from campaign_dms where campaign_id = p_campaign and dm_id = p_profile;
  -- feat/campaign-npcs: an NPC always belongs to a current DM of its campaign.
  update characters set campaign_id = null where campaign_id = p_campaign and owner_id = p_profile and is_npc;
end;
$$;

create or replace function public.list_campaign_invites(p_campaign uuid)
returns table(id uuid, type text, mode text, token text, note text, starting_ap integer, max_redemptions integer,
              redeemed_count integer, expires_at timestamptz, created_at timestamptz, revoked_at timestamptz,
              redeemed_at timestamptz, redeemed_by_name text, character_id uuid, character_name text)
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
                            and not c.is_npc
     where i.campaign_id = p_campaign
     order by i.created_at desc;
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
    where owner_id = auth.uid() and campaign_id = v_invite.campaign_id and not is_npc
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
      where owner_id = auth.uid() and campaign_id = v_invite.campaign_id and not is_npc limit 1;
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
