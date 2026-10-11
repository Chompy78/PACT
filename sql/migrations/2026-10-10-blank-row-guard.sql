-- fix/blank-row-guard (2026-10-10) — refuse blank SOLO character rows, and a purge for the ones already there.
-- Decision: decisions/2026/D-GH-2026-10-10-blank-row-guard.md. Owner choice I3: refuse at the server AND sweep.
--
-- THE PROBLEM. public.characters was collecting rows that are nothing but column defaults — name 'New Character',
-- kind 'livesheet', stats '{}' — 31 of them across 5 owners (2026-08-08 → 2026-10-08), one owner holding 16. No
-- tool's saveCharacter() call sends empty stats; the rows come from a stats-less LOCAL placeholder record being
-- pushed as an INSERT (root cause and client fix: docs/TASK_BOARD_NOW.md fix/blank-character-rows). A player could
-- not find his real character among five identical blanks.
--
-- WHAT THIS CHANGES.
--   1. pact_refuse_blank_solo_character() + trg_pact_refuse_blank_solo_character: an INSERT of a SOLO row
--      (campaign_id null) whose stats carry no "LOG" key is refused.
--   2. pact_purge_blank_characters(p_min_age): deletes solo rows whose stats are exactly '{}', older than
--      p_min_age by both created_at and updated_at, with nothing in any table that references them.
--      Callable only by the table owner (postgres / pg_cron) — not by anon or authenticated.
--   Scheduling the purge is a separate, Supabase-only file: 2026-10-10-blank-row-purge-schedule.sql (pg_cron
--   does not exist on the plain Postgres the SQL test harnesses use).
--
-- WHAT THIS DELIBERATELY LEAVES ALONE.
--   * CAMPAIGN rows with empty stats. join_campaign() and redeem_player_invite() INSERT a campaign-bound seed row
--     with the default '{}' on purpose and the tool fills it in afterwards — refusing those would break joining a
--     campaign. Hence "solo only" in both halves. (Live 2026-10-10: 0 campaign-bound active rows have '{}'.)
--   * UPDATEs. A row's stats being emptied by an update is a different failure and not what was observed.
--   * Rows that carry other keys but no LOG (live: 2 test rows with only {"note":"hello"}). The purge matches
--     exactly '{}' so it can never delete anything that holds data; the insert guard does refuse that shape.
--   * An empty LOG array is allowed: a fresh, untouched draft is a real envelope with "LOG": [].
--
-- BLAST RADIUS, measured on live 2026-10-10 (64 rows): no legitimate write path inserts a solo row without LOG —
-- every client save sends the pact-character/1 envelope, and the three server functions that insert characters
-- either bind a campaign (join_campaign, redeem_player_invite) or copy a source row's stats
-- (redeem_character_claim). Purge candidates: 31 rows, all solo, none referenced by ap_awards, gold_awards,
-- character_dm_notes, campaign_invites, campaign_downtime_declarations or ap_award_edits. Every purged row is
-- still recoverable: the existing trg_characters_snapshot copies it to character_backups (reason 'delete').

create or replace function public.pact_refuse_blank_solo_character()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if NEW.campaign_id is null and not (coalesce(NEW.stats, '{}'::jsonb) ? 'LOG') then
    raise exception 'PACT: refused a blank character — a solo character must be saved with its event log'
      using errcode = 'check_violation';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_pact_refuse_blank_solo_character on public.characters;
create trigger trg_pact_refuse_blank_solo_character
  before insert on public.characters
  for each row execute function public.pact_refuse_blank_solo_character();

revoke all on function public.pact_refuse_blank_solo_character() from public, anon, authenticated;

create or replace function public.pact_purge_blank_characters(p_min_age interval default interval '1 day')
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_n integer;
begin
  with gone as (
    delete from public.characters c
     where c.campaign_id is null
       and c.stats = '{}'::jsonb
       and c.created_at < now() - p_min_age
       and c.updated_at < now() - p_min_age
       and not exists (select 1 from public.ap_awards a                       where a.character_id = c.id)
       and not exists (select 1 from public.gold_awards g                     where g.character_id = c.id)
       and not exists (select 1 from public.character_dm_notes n              where n.character_id = c.id)
       and not exists (select 1 from public.campaign_invites i                where i.source_character_id = c.id)
       and not exists (select 1 from public.campaign_downtime_declarations d  where d.character_id = c.id)
       and not exists (select 1 from public.ap_award_edits e                  where e.character_id = c.id)
    returning 1
  )
  select count(*) into v_n from gone;
  return v_n;
end;
$$;

revoke all on function public.pact_purge_blank_characters(interval) from public, anon, authenticated;
