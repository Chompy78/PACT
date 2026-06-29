-- PACT migration — co-DMs, AP award ledger, ignore-player-AP toggle (D-GH7)
-- Run ONCE in the Supabase SQL editor on an existing PACT database.
-- Idempotent: safe to re-run. Fresh installs get all this from schema.sql /
-- rls-policies.sql instead; this file only patches a DB created before D-GH7.

-- ===========================================================================
-- 1. campaigns: DM invite code + ignore-player-AP toggle
-- ===========================================================================
alter table public.campaigns
  add column if not exists dm_invite_code   text,
  add column if not exists ignore_player_ap boolean not null default false;

-- gen_invite_code must now avoid collisions across BOTH code columns
create or replace function public.gen_invite_code()
returns text language plpgsql as $$
declare
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  code text;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random()*36)::int, 1);
    end loop;
    exit when not exists (
      select 1 from public.campaigns where invite_code = code or dm_invite_code = code
    );
  end loop;
  return code;
end;
$$;

-- backfill DM codes for existing campaigns, then lock the column down
update public.campaigns set dm_invite_code = public.gen_invite_code()
  where dm_invite_code is null;

alter table public.campaigns
  alter column dm_invite_code set default public.gen_invite_code(),
  alter column dm_invite_code set not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'campaigns_dm_invite_code_key') then
    alter table public.campaigns add constraint campaigns_dm_invite_code_key unique (dm_invite_code);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'campaigns_dm_invite_code_chk') then
    alter table public.campaigns add constraint campaigns_dm_invite_code_chk
      check (dm_invite_code ~ '^[A-Z0-9]{6}$');
  end if;
end $$;

-- ===========================================================================
-- 2. campaign_dms: the set of DMs for a campaign (owner auto-included)
-- ===========================================================================
create table if not exists public.campaign_dms (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  dm_id       uuid not null references public.profiles(id) on delete cascade,
  added_by    uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (campaign_id, dm_id)
);
create index if not exists idx_campaign_dms_dm on public.campaign_dms(dm_id);

-- every existing campaign's owner becomes a DM
insert into public.campaign_dms (campaign_id, dm_id, added_by)
  select id, dm_id, dm_id from public.campaigns
  on conflict do nothing;

-- keep the owner in campaign_dms automatically on new campaigns
create or replace function public.add_owner_as_dm()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.campaign_dms (campaign_id, dm_id, added_by)
  values (new.id, new.dm_id, new.dm_id)
  on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists trg_campaign_owner_dm on public.campaigns;
create trigger trg_campaign_owner_dm
  after insert on public.campaigns
  for each row execute function public.add_owner_as_dm();

-- ===========================================================================
-- 3. ap_awards: the award ledger (attribution + history)
-- ===========================================================================
create table if not exists public.ap_awards (
  id           uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  dm_id        uuid references public.profiles(id) on delete set null,  -- survives DM deletion
  campaign_id  uuid references public.campaigns(id) on delete set null,
  amount       integer not null,
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_ap_awards_char on public.ap_awards(character_id);

-- ===========================================================================
-- 4. DM checks now use campaign_dms membership
-- ===========================================================================
create or replace function public.is_campaign_dm(p_campaign uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from campaign_dms where campaign_id = p_campaign and dm_id = auth.uid()
  );
$$;

create or replace function public.is_campaign_owner(p_campaign uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from campaigns where id = p_campaign and dm_id = auth.uid());
$$;

-- profiles you can see = people you share a campaign with (now via campaign_dms)
create or replace function public.shares_campaign(p_other uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    -- I DM a campaign p_other plays in
    select 1 from campaign_dms d join characters ch on ch.campaign_id = d.campaign_id
      where d.dm_id = auth.uid() and ch.owner_id = p_other
    union all
    -- p_other DMs a campaign I play in
    select 1 from campaign_dms d join characters ch on ch.campaign_id = d.campaign_id
      where d.dm_id = p_other and ch.owner_id = auth.uid()
    union all
    -- we both play in the same campaign
    select 1 from characters a join characters b on a.campaign_id = b.campaign_id
      where a.owner_id = auth.uid() and b.owner_id = p_other
    union all
    -- we co-DM the same campaign
    select 1 from campaign_dms a join campaign_dms b on a.campaign_id = b.campaign_id
      where a.dm_id = auth.uid() and b.dm_id = p_other
  );
$$;

-- ===========================================================================
-- 5. RPCs
-- ===========================================================================
-- become a co-DM via the DM invite code
create or replace function public.join_as_dm(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_campaign campaigns%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into v_campaign from campaigns where dm_invite_code = upper(p_code);
  if not found then raise exception 'No campaign with that DM invite code'; end if;
  insert into campaign_dms (campaign_id, dm_id, added_by)
    values (v_campaign.id, auth.uid(), auth.uid())
    on conflict do nothing;
  return v_campaign.id;
end;
$$;

-- owner promotes an existing member (or anyone) to co-DM
create or replace function public.promote_to_dm(p_campaign uuid, p_profile uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_campaign_owner(p_campaign) then
    raise exception 'Only the campaign owner can add co-DMs';
  end if;
  insert into campaign_dms (campaign_id, dm_id, added_by)
    values (p_campaign, p_profile, auth.uid())
    on conflict do nothing;
end;
$$;

-- owner removes a co-DM (cannot remove the owner)
create or replace function public.remove_dm(p_campaign uuid, p_profile uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_campaign_owner(p_campaign) then
    raise exception 'Only the campaign owner can remove co-DMs';
  end if;
  if p_profile = (select dm_id from campaigns where id = p_campaign) then
    raise exception 'The owner cannot be removed as DM';
  end if;
  delete from campaign_dms where campaign_id = p_campaign and dm_id = p_profile;
end;
$$;

-- regenerate either code — any DM may
create or replace function public.regenerate_invite_code(p_campaign uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not is_campaign_dm(p_campaign) then
    raise exception 'Only a campaign DM can regenerate the invite code';
  end if;
  v_code := gen_invite_code();
  update campaigns set invite_code = v_code where id = p_campaign;
  return v_code;
end;
$$;

create or replace function public.regenerate_dm_invite_code(p_campaign uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not is_campaign_dm(p_campaign) then
    raise exception 'Only a campaign DM can regenerate the DM invite code';
  end if;
  v_code := gen_invite_code();
  update campaigns set dm_invite_code = v_code where id = p_campaign;
  return v_code;
end;
$$;

-- award AP: any DM of the character's campaign; logs to the ledger
drop function if exists public.award_ap(uuid, integer);
create or replace function public.award_ap(p_character uuid, p_amount integer, p_note text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_campaign uuid; v_ap integer;
begin
  select campaign_id into v_campaign from characters where id = p_character;
  if v_campaign is null then raise exception 'Character is not in a campaign'; end if;
  if not is_campaign_dm(v_campaign) then raise exception 'Only a campaign DM can award AP'; end if;
  insert into ap_awards (character_id, dm_id, campaign_id, amount, note)
    values (p_character, auth.uid(), v_campaign, p_amount, p_note);
  update characters set ap = ap + p_amount where id = p_character returning ap into v_ap;
  return v_ap;
end;
$$;

-- ===========================================================================
-- 6. RLS for the new tables + updated campaign policies
-- ===========================================================================
alter table public.campaign_dms enable row level security;
alter table public.ap_awards    enable row level security;

drop policy if exists campaign_dms_select on public.campaign_dms;
create policy campaign_dms_select on public.campaign_dms
  for select using (is_campaign_dm(campaign_id) or is_campaign_member(campaign_id));
-- writes happen only through the SECURITY DEFINER RPCs above (no insert/delete policy)

drop policy if exists ap_awards_select on public.ap_awards;
create policy ap_awards_select on public.ap_awards
  for select using (
    is_campaign_dm(campaign_id)
    or exists (select 1 from characters c where c.id = character_id and c.owner_id = auth.uid())
  );
-- inserts happen only through award_ap() (definer)

-- co-DMs (even without a character) can read the campaign; any DM can edit settings
drop policy if exists campaigns_select on public.campaigns;
create policy campaigns_select on public.campaigns
  for select using (is_campaign_dm(id) or is_campaign_member(id));

drop policy if exists campaigns_update on public.campaigns;
create policy campaigns_update on public.campaigns
  for update using (is_campaign_dm(id)) with check (is_campaign_dm(id));

-- delete stays owner-only
drop policy if exists campaigns_delete on public.campaigns;
create policy campaigns_delete on public.campaigns
  for delete using (dm_id = auth.uid());

-- ===========================================================================
-- 7. Grants
-- ===========================================================================
grant select on public.campaign_dms to authenticated;
grant select on public.ap_awards    to authenticated;

grant execute on function public.join_as_dm(text)                 to authenticated;
grant execute on function public.promote_to_dm(uuid, uuid)        to authenticated;
grant execute on function public.remove_dm(uuid, uuid)            to authenticated;
grant execute on function public.regenerate_dm_invite_code(uuid)  to authenticated;
grant execute on function public.award_ap(uuid, integer, text)    to authenticated;
