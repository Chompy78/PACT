-- Feature: revise downtime's shape, hours after 2026-08-19-dm-gold-downtime-economy.sql was
-- first applied. Follows a design discussion with the owner that established gold and
-- downtime are NOT the same shape of currency, and the original migration modelled downtime
-- as a per-character, accumulating column -- exactly like gold. That is wrong:
--
--   GOLD banks. Per character, accumulates forever. Unchanged by this migration.
--
--   DOWNTIME does not. It is a single window the DM declares for the WHOLE PARTY at once,
--   and a new declaration REPLACES the old one rather than adding to it: "the time should
--   not keep adding up... spend it now or wait till another opportunity" (owner). A
--   per-character accumulating column cannot represent that at all.
--
-- Safe to apply as a straight ALTER, not a data-migrating one: every character was still at
-- gold=0, downtime_days=0 when the prior migration landed (verified before applying it), and
-- no campaign had switched the economy on yet, so there is no real downtime balance anywhere
-- to preserve or reconcile.
--
-- See decisions/2026/D-GH-2026-08-19-tool-coin-time-costs.md for the full design discussion
-- this responds to, and js/engine.js's resolveDowntimeWindow()/wealthWithDm() for how the
-- engine composes the new shape.

-- ---------------------------------------------------------------------------
-- 1. characters.downtime_days never belonged -- drop it. characters.gold is untouched.
-- ---------------------------------------------------------------------------
alter table public.characters drop column if exists downtime_days;

-- ---------------------------------------------------------------------------
-- 2. wealth_awards -> gold_awards. Downtime moves out entirely (see the new table below),
-- leaving this ledger gold-only -- which is what its name should have said from the start.
-- A rename-in-place keeps the row data and the character_id FK/index; only the shape changes.
-- ---------------------------------------------------------------------------
alter table public.wealth_awards rename to gold_awards;
alter table public.gold_awards drop column if exists downtime_days;
alter index if exists idx_wealth_awards_char rename to idx_gold_awards_char;

-- ---------------------------------------------------------------------------
-- 3. campaign_downtime_declarations -- the only place downtime lives now. Ledger-style like
-- ap_awards/gold_awards, but read as "the LATEST row", not summed: declaring a new window
-- needs no reset logic, a fresh insert IS the reset, and the full history stays visible for
-- the story record.
--
-- character_id is NULLABLE and that nullability is the whole design: null = the party base
-- (applies to everyone, replaces the last base when a new one lands); set = a BONUS for that
-- one character, layered on top of whichever base is currently live, and wiped along with it
-- the moment a new base is declared (a bonus is "extra time in THIS window", not its own
-- persistent pool).
-- ---------------------------------------------------------------------------
create table if not exists public.campaign_downtime_declarations (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references public.campaigns(id) on delete cascade,
  character_id uuid references public.characters(id) on delete cascade,   -- null = party base
  days         integer not null,
  note         text,
  declared_by  uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_downtime_decl_campaign on public.campaign_downtime_declarations(campaign_id, created_at desc);
create index if not exists idx_downtime_decl_char on public.campaign_downtime_declarations(character_id);

alter table public.campaign_downtime_declarations enable row level security;
grant select on public.campaign_downtime_declarations to authenticated;   -- inserts via declare_downtime() only

-- Party-wide, so NOT owner-scoped like ap_awards/gold_awards -- any campaign member (player
-- or DM) can read it, because a downtime window applies to everyone at once.
drop policy if exists campaign_downtime_declarations_select on public.campaign_downtime_declarations;
create policy campaign_downtime_declarations_select on public.campaign_downtime_declarations
  for select using (
    is_campaign_dm(campaign_id) or is_campaign_member(campaign_id)
  );

-- gold_awards RLS/grant carry over unchanged from wealth_awards (rename doesn't touch RLS or
-- grants), but the policy is renamed here for clarity and to match the table's new name.
alter policy wealth_awards_select on public.gold_awards rename to gold_awards_select;

-- ---------------------------------------------------------------------------
-- 4. award_wealth(character, gold, downtime_days, note) -> award_gold(character, gold, note).
-- Drop the old function outright (its signature is changing, not just its body) and recreate
-- gold-only. This is safe: nothing has called it with a non-zero downtime_days argument, since
-- no tool UI has ever offered that field.
-- ---------------------------------------------------------------------------
drop function if exists public.award_wealth(uuid, integer, integer, text);

create or replace function public.award_gold(
  p_character uuid,
  p_gold integer,
  p_note text default null
)
returns characters language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign uuid;
  v_row      characters%rowtype;
begin
  select campaign_id into v_campaign from characters where id = p_character;
  if v_campaign is null then
    raise exception 'Character is not in a campaign';
  end if;
  if not is_campaign_dm(v_campaign) then
    raise exception 'Only a campaign DM can award gold';
  end if;
  if coalesce(p_gold, 0) = 0 then
    raise exception 'Award must change gold';
  end if;

  insert into gold_awards (character_id, dm_id, campaign_id, gold, note)
    values (p_character, auth.uid(), v_campaign, p_gold, p_note);

  update characters set gold = gold + p_gold
    where id = p_character
    returning * into v_row;
  return v_row;
end;
$$;

revoke execute on function public.award_gold(uuid, integer, text) from public;
grant  execute on function public.award_gold(uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. declare_downtime(campaign, days, character, note) -- the only write path to downtime.
-- p_character defaults null (party base); a specific character is a bonus, validated against
-- the same campaign so a DM cannot stamp one onto an unrelated character.
-- ---------------------------------------------------------------------------
create or replace function public.declare_downtime(
  p_campaign uuid,
  p_days integer,
  p_character uuid default null,
  p_note text default null
)
returns campaign_downtime_declarations language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_char_campaign uuid;
  v_row campaign_downtime_declarations%rowtype;
begin
  if not is_campaign_dm(p_campaign) then
    raise exception 'Only a campaign DM can declare downtime';
  end if;
  if p_days is null then
    raise exception 'Days is required';
  end if;
  if p_character is not null then
    select campaign_id into v_char_campaign from characters where id = p_character;
    if v_char_campaign is distinct from p_campaign then
      raise exception 'That character is not in this campaign';
    end if;
  end if;

  insert into campaign_downtime_declarations (campaign_id, character_id, days, note, declared_by)
    values (p_campaign, p_character, p_days, p_note, auth.uid())
    returning * into v_row;
  return v_row;
end;
$$;

revoke execute on function public.declare_downtime(uuid, integer, uuid, text) from public;
grant  execute on function public.declare_downtime(uuid, integer, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. get_downtime_window(campaign, character) -- the current window in one query: latest
-- base row's days, plus any bonus rows for `character` on or after that base row. Returns
-- no rows if no base has ever been declared. NOT security definer -- it only needs whatever
-- the caller's own RLS (campaign_downtime_declarations_select) already lets them see.
-- ---------------------------------------------------------------------------
create or replace function public.get_downtime_window(p_campaign uuid, p_character uuid default null)
returns table(days integer, declared_at timestamptz)
language sql stable set search_path = public, pg_temp as $$
  with base as (
    select d.days as base_days, d.created_at as base_at
    from campaign_downtime_declarations d
    where d.campaign_id = p_campaign and d.character_id is null
    order by d.created_at desc
    limit 1
  ),
  bonus as (
    select coalesce(sum(d.days), 0) as bonus_days
    from campaign_downtime_declarations d, base
    where p_character is not null
      and d.campaign_id = p_campaign and d.character_id = p_character
      and d.created_at >= base.base_at
  )
  select (base.base_days + coalesce(bonus.bonus_days, 0))::integer, base.base_at
  from base left join bonus on true;
$$;

revoke execute on function public.get_downtime_window(uuid, uuid) from public;
grant  execute on function public.get_downtime_window(uuid, uuid) to authenticated;
