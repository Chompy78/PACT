-- PACT — invite notes, revocation, and a DM-facing invite list.
-- D-GH-2026-08-03-dm-invite-manager.
--
-- WHY. A DM generates an invite link, copies it, and the link is then the only record that it ever
-- existed. Nothing in the UI lists outstanding invites, so unredeemed ones accumulate invisibly (the
-- Amble campaign had ten) with no way to tell which was meant for whom, what AP it carries, or whether
-- it is still live. Since the invite's grant became a character's entire starting AP
-- (D-GH-2026-08-03-invite-single-ap-grant), "which invite carries what" is now a question with real
-- consequences, not bookkeeping.
--
-- Three additions:
--   * `note`       — free text the DM writes when generating the invite ("Rusty, replacement rogue").
--   * `revoked_at` — soft revocation, so a stale invite can be taken out of circulation without
--                    destroying the record of what was issued and to whom it was meant to go. Deleting
--                    the row would lose exactly the history this feature exists to surface.
--   * list_campaign_invites() — one DM-only read that joins in the redeemer's display name and the
--                    character the invite produced, which RLS-scoped client selects can't do in one go.
--
-- NOTE VISIBILITY (deliberate, flagged rather than silently accepted): campaign_invites_select lets a
-- redeemer read their OWN redeemed row, so a player can read the note attached to the invite they
-- redeemed. Notes are therefore admin-ish labels, not private DM commentary. Locking that down means
-- column-level grants on a live table, and this project has twice been bitten by grant/RLS drift
-- (D-GH15, D-GH12) — worth doing deliberately as its own change, not folded in here.

alter table public.campaign_invites add column if not exists note       text;
alter table public.campaign_invites add column if not exists revoked_at timestamptz;

comment on column public.campaign_invites.note is
  'DM-written label for this invite. Readable by the redeeming player via campaign_invites_select once '
  'redeemed — treat as a label, not private commentary.';
comment on column public.campaign_invites.revoked_at is
  'Soft revocation. A revoked invite cannot be redeemed; the row is kept so the DM keeps the record of '
  'what was issued.';

-- p_note is appended LAST and defaulted, so every existing 3-argument call site keeps working
-- unchanged during the window between a DB migration and a Pages deploy.
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

  insert into campaign_invites (campaign_id, token, starting_ap, starting_budget, created_by, note)
    values (p_campaign_id, v_token, v_ap, 0, auth.uid(), v_note);

  return v_token;
end;
$$;

-- Revoke / un-revoke an unredeemed invite. DM-only. Redeemed invites are immutable: the character
-- already exists and its AP was already granted, so "revoking" it would describe a state that isn't true.
create or replace function public.set_invite_revoked(p_invite uuid, p_revoked boolean default true)
returns timestamptz language plpgsql security definer set search_path = public, pg_temp as $$
declare v_campaign uuid; v_redeemed uuid; v_at timestamptz;
begin
  select campaign_id, redeemed_by into v_campaign, v_redeemed
    from campaign_invites where id = p_invite;
  if v_campaign is null then raise exception 'Invite not found'; end if;
  if not is_campaign_dm(v_campaign) then
    raise exception 'Only a campaign DM can revoke an invite';
  end if;
  if v_redeemed is not null then
    raise exception 'That invite has already been redeemed and cannot be revoked';
  end if;
  update campaign_invites
    set revoked_at = case when p_revoked then now() else null end
    where id = p_invite
    returning revoked_at into v_at;
  return v_at;
end;
$$;

-- DM-only listing. SECURITY DEFINER so it can join profiles/characters, which the caller's own RLS
-- would not let them read wholesale, while still gating on is_campaign_dm internally.
create or replace function public.list_campaign_invites(p_campaign uuid)
returns table(
  id           uuid,
  token        text,
  note         text,
  starting_ap  integer,
  created_at   timestamptz,
  revoked_at   timestamptz,
  redeemed_at  timestamptz,
  redeemed_by_name text,
  character_id uuid,
  character_name text
)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_campaign_dm(p_campaign) then
    raise exception 'Only a campaign DM can list invites';
  end if;
  return query
    select i.id, i.token, i.note,
           coalesce(i.starting_ap, 0) + coalesce(i.starting_budget, 0),   -- same fold the RPCs apply
           i.created_at, i.revoked_at, i.redeemed_at,
           p.display_name, c.id, c.name
      from campaign_invites i
      left join profiles p on p.id = i.redeemed_by
      left join characters c on c.owner_id = i.redeemed_by and c.campaign_id = i.campaign_id
     where i.campaign_id = p_campaign
     order by i.created_at desc;
end;
$$;

-- A revoked invite must not redeem. Only this branch changes; the rest is unchanged from
-- 2026-08-03-invite-grant-award-row.sql.
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

  -- Checked before the claiming UPDATE so a revoked invite can't be consumed by the race.
  if exists (select 1 from campaign_invites
              where token = p_token and revoked_at is not null and redeemed_by is null) then
    raise exception 'This invite has been withdrawn by the DM';
  end if;

  update campaign_invites
    set redeemed_by = auth.uid(), redeemed_at = now()
    where token = p_token and redeemed_by is null and revoked_at is null
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

  select * into v_invite from campaign_invites where token = p_token and redeemed_by = auth.uid();
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
