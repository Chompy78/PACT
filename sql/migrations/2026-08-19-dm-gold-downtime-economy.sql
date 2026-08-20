-- Feature: the gold-and-downtime economy — PACT's other two currencies
-- (Players Guide §2 "The Three Currencies", §16 "Gold, Downtime, and Starting
-- Wealth"). Branch: claude/tool-coin-time-costs.
--
-- Every IN-PLAY purchase costs gold and downtime alongside AP, read off one
-- universal band. Creation purchases are exempt. The whole system is optional
-- and has three settings — Off / Standard / Fast (§17's pre-session checklist:
-- "☐ Gold-and-Time economy: Off, Standard, or Fast?").
--
-- WHAT THIS MIGRATION ADDS, AND THE ONE THING IT DOES NOT.
--
-- It adds the DM-AUTHORITATIVE half only. The owner's requirement is explicit:
-- "When a player uses gold or applies time, in a campaign world, the DM is the
-- one who applies the money." That is precisely the trust boundary `characters.ap`
-- already sits on, so this mirrors it rather than inventing a second shape:
--
--   characters.gold           integer, DM-authoritative, never written by players
--   characters.downtime_days  integer, DM-authoritative, never written by players
--   wealth_awards             the attribution ledger (who granted what, when, why)
--   award_wealth()            SECURITY DEFINER, the ONLY write path to either column
--
-- It does NOT add a band setting column. The Off/Standard/Fast choice is campaign
-- rules, and `campaigns.rules` (jsonb, DM-authoritative since D-GH14, written via
-- setCampaignRules()) is already exactly that — the setting lands at
-- `rules.economy.band`, needing no schema change at all. This is the same call
-- D-GH-2026-08-10-dm-custom-character-fields made for its field DEFINITIONS, for
-- the same reason.
--
-- WHY TWO COLUMNS AND NOT ONE jsonb. Both are running integer totals a definer
-- function increments under concurrency, exactly like `ap` — `set gold = gold + x`
-- is atomic where a read-modify-write of a jsonb blob is not. Downtime is stored in
-- DAYS (the engine's canonical unit; js/economy-bands.js carries the guide's own
-- display phrase per band row) so the totals are summable.
--
-- WHY NEGATIVE TOTALS ARE PERMITTED. No check constraint pins these at >= 0, on
-- purpose. §17: "the DM can waive or reduce any cost at any time, AP, gold, or
-- downtime", and a DM may hand over an ability and settle the coin later. The
-- tools render an overdraft as a soft warning; a constraint here would turn a
-- legitimate table ruling into a database error the player cannot clear. This
-- matches `characters.ap`, which is likewise unconstrained and likewise
-- deduct-capable via a negative amount.
--
-- SPEND IS NOT RECORDED HERE. What a character has SPENT is derived by the engine
-- from its own LOG (wealthLedger() in js/engine.js), never stored — the same
-- "store only raw data, derive the rest" rule that governs HP/AC/AP. These columns
-- hold only what the DM has GRANTED. Storing a balance would be storing a derived
-- value and would drift the moment a purchase was undone.

-- ---------------------------------------------------------------------------
-- 1. The two DM-authoritative totals.
-- ---------------------------------------------------------------------------
alter table public.characters
  add column if not exists gold integer not null default 0;
alter table public.characters
  add column if not exists downtime_days integer not null default 0;

comment on column public.characters.gold is
  'DM-authoritative gold granted (gp); never written by players — award_wealth() only. Spend is derived from the LOG by the engine, never stored.';
comment on column public.characters.downtime_days is
  'DM-authoritative downtime granted, in days; never written by players — award_wealth() only. Spend is derived from the LOG by the engine, never stored.';

-- ---------------------------------------------------------------------------
-- 2. wealth_awards — the attribution ledger, mirroring ap_awards.
--
-- One row per grant, carrying BOTH currencies so a single "you found the dragon's
-- hoard and spent the winter at Ironwall" ruling is one ledger line rather than two
-- unrelated ones. Either amount may be zero (a pure-gold or pure-downtime grant)
-- and either may be negative (a deduction).
-- ---------------------------------------------------------------------------
create table if not exists public.wealth_awards (
  id            uuid primary key default gen_random_uuid(),
  character_id  uuid not null references public.characters(id) on delete cascade,
  dm_id         uuid references public.profiles(id) on delete set null,   -- survives DM deletion
  campaign_id   uuid references public.campaigns(id) on delete set null,
  gold          integer not null default 0,
  downtime_days integer not null default 0,
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_wealth_awards_char on public.wealth_awards(character_id);

alter table public.wealth_awards enable row level security;
grant select on public.wealth_awards to authenticated;   -- inserts via award_wealth() only

-- Readable by the character's owner or any DM of its campaign — byte-for-byte the
-- ap_awards_select policy, because it guards the same rows for the same people.
drop policy if exists wealth_awards_select on public.wealth_awards;
create policy wealth_awards_select on public.wealth_awards
  for select using (
    is_campaign_dm(campaign_id)
    or exists (select 1 from characters c where c.id = character_id and c.owner_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 3. Column-level lockdown for the two new columns.
--
-- THIS IS THE LOAD-BEARING STEP, and the reason it is spelled out rather than
-- inherited. `revoke update on characters` + `grant update (name, kind, stats)`
-- in rls-policies.sql is what keeps `ap` player-unwritable — but that grant list
-- is a SNAPSHOT, and a column added later is only protected because it is absent
-- from it. Re-running rls-policies.sql re-establishes that; a database migrated
-- with this file alone must not be left relying on statement order across two
-- files. So the revoke/grant pair is repeated here verbatim, making this file
-- correct standalone.
--
-- This repo has been bitten twice by exactly this class of grant/RLS drift
-- (D-GH15, D-GH12) — hence also the advisor run required by AGENTS.md step 4.
-- ---------------------------------------------------------------------------
revoke update on public.characters from authenticated, anon;
grant update (name, kind, stats) on public.characters to authenticated;
grant update (archived_at) on public.characters to authenticated;
grant update (autosave_enabled) on public.characters to authenticated;
-- gold and downtime_days are deliberately absent: any UPDATE naming either column
-- is rejected by Postgres itself, before characters_update's WITH CHECK is even
-- evaluated. Same guard, same reasoning, as `ap`.

-- INSERT likewise: a new character starts with 0 of both (the column defaults),
-- and cannot name either column on the way in.
revoke insert on public.characters from authenticated;
grant insert (id, owner_id, name, kind, stats, autosave_enabled) on public.characters to authenticated;

-- ---------------------------------------------------------------------------
-- 4. award_wealth(character, gold, downtime_days, note) — the ONLY write path.
--
-- Any DM of the character's campaign; SECURITY DEFINER so it can write columns the
-- caller has no grant on. Writes a wealth_awards row (attribution) AND bumps both
-- running totals, in one statement. Pass negative amounts to deduct.
--
-- Guarded exactly as award_ap() is: the character must be in a campaign, and the
-- caller must be a DM of it. A solo (uncampaigned) character has no DM to apply
-- anything, so its gold and downtime live in its own LOG as `wealth` events instead
-- — the player-side pool the engine's wealthLedger() reads. That asymmetry IS the
-- feature: "in a campaign world, the DM is the one who applies the money."
--
-- Both amounts in one call, matching the single ledger row: two separate RPCs would
-- leave a real window where a character had the gold but not the downtime, and would
-- double a DM's ledger for every ordinary grant. Same atomicity argument
-- dm_edit_character_log() makes for its buy+award pair.
-- ---------------------------------------------------------------------------
create or replace function public.award_wealth(
  p_character uuid,
  p_gold integer default 0,
  p_downtime_days integer default 0,
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
    raise exception 'Only a campaign DM can award gold or downtime';
  end if;
  if coalesce(p_gold, 0) = 0 and coalesce(p_downtime_days, 0) = 0 then
    raise exception 'Award must change gold or downtime';
  end if;

  insert into wealth_awards (character_id, dm_id, campaign_id, gold, downtime_days, note)
    values (p_character, auth.uid(), v_campaign, coalesce(p_gold, 0), coalesce(p_downtime_days, 0), p_note);

  update characters
     set gold          = gold          + coalesce(p_gold, 0),
         downtime_days = downtime_days + coalesce(p_downtime_days, 0)
   where id = p_character
   returning * into v_row;
  return v_row;
end;
$$;

-- Same grant discipline as every other definer RPC here: authenticated only,
-- never public/anon. (See sql/rls-policies.sql's grant block; the function's own
-- is_campaign_dm() check is what actually authorizes, but revoking public is what
-- stops an anonymous caller reaching it at all.)
revoke execute on function public.award_wealth(uuid, integer, integer, text) from public;
grant  execute on function public.award_wealth(uuid, integer, integer, text) to authenticated;
