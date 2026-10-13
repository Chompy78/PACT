-- PACT — a player can no longer add AP to a finished campaign character by appending an `award`.
-- fix/server-player-award-after-lock (D-GH-2026-10-12-server-player-award-after-lock).
-- APPLIED to the live database on 2026-10-13 (migration `server_player_award_after_lock`, owner decision N1), after both
-- pre-checks below passed: the live function matched the 2026-09-03 definition, and 0 campaign award amounts were not numbers.
--
-- THE GAP. pact_enforce_locked_history() only freezes history that already exists; anything may be APPENDED
-- after the lock/seal boundary. pact_enforce_ap_budget_consistency() then counts every `award` in the LOG as
-- spendable player AP unless the campaign has ignore_player_ap on. So on a locked campaign character in a
-- campaign WITHOUT ignore_player_ap, a modified client could append {type:'award', amount:500} and spend it.
-- The tools stopped offering this in #638 (D-GH-2026-10-12-player-free-ap); this closes the award route in the database.
--
-- THE CHANGE. It amends the existing pact_enforce_player_ap_ceiling() (2026-09-03-dm-zero-player-ap.sql,
-- the trigger that already refuses a rising player award total once a campaign ignores player AP) instead of
-- adding a second trigger that computes the same sum. The rule is now:
--
--   On a campaign-bound character, an UPDATE by anyone other than a DM of that campaign may not raise the
--   total of the LOG's `award` amounts when EITHER
--     (a) the campaign has ignore_player_ap on (unchanged scope from 2026-09-03), OR
--     (b) the stored (OLD) LOG is currently creation-locked — its last `creationLocked` comes after its last
--         `creationUnlocked`, the same test pact_enforce_locked_history() uses for D2 — or carries a
--         `sessionSeal`.
--
-- WHAT IS ACCEPTED, and why each still works:
--   * CharGen's noLock "Budget" singleton is moved to the LOG tail by filter-and-append
--     (_cgSyncSingletonEvent). A move, or a re-save, keeps the total the same, so it is accepted wherever it
--     sits — including the live shape of a 77 AP Budget award after the lock.
--   * A LOWER total is accepted (only a rise is refused). The tools refuse a lower budget too, after #638.
--   * A DM is exempt (is_campaign_dm on the row's campaign): dm_edit_character_log's boon grant
--     (buy + matched `award`, DM Console "DM boon grant"), dm_zero_player_ap, award_ap_and_seal. award_ap()
--     writes the `ap` column, not the LOG, so it never reaches the sum at all.
--   * Solo characters (campaign_id null): untouched, as before.
--   * Before the lock, and while a DM has reopened creation (dm_reopen_creation appends creationUnlocked),
--     a campaign character's own budget stays editable in a campaign that does not ignore player AP, as
--     before. The lock state is read from OLD, so a save that sets the budget and finishes creation in one
--     write is accepted — exactly what the player could have done in two saves.
--
-- WHAT CHANGES FOR THE ignore_player_ap SCOPE. The 2026-09-03 version left dmEdit:true awards out of both
-- sums so a DM's boon/zero events did not count — and documented that a player could forge dmEdit:true on
-- their own row to get past it. The DM is now exempt by WHO is writing (is_campaign_dm), not by a flag the
-- writer sets, so for everyone else ALL awards count. No legitimate player save changes a DM-stamped award:
-- every dmEdit award has no noLock/disc and so is itself a pact_enforce_locked_history() boundary, frozen
-- in place; it contributes the same amount to OLD and NEW.
--
-- AWARD AMOUNTS MUST BE JSON NUMBERS (review hardening). On a campaign character any `award` whose amount is not a
-- JSON number is refused — for every writer, locked or not. A string amount casts to numeric, and "NaN" turns every
-- sum NaN, which disables both this rule and pact_enforce_ap_budget_consistency(); planted before the lock, it would
-- disarm both after it. Every client writes a number (CharGen Budget/seed/import, Live Sheet award/redeem/seed/clone,
-- DM Console boon grant, dm_zero_player_ap), verified in the source 2026-10-12. A MISSING amount is still allowed (it
-- counts 0). The live measurement did not record the JSON type of the 12 amounts: re-check before applying
-- (select count(*) ... where e->>'type'='award' and jsonb_typeof(e->'amount') <> 'number' on campaign characters must be 0),
-- or that character's every save is refused.
--
-- SCOPE: this closes the AWARD route only. A locked character can still gain AP through a client-stamped negative cost
-- (a drawback refund, or a non-drawback buy with cost < 0) — those predate this change and are a separate board task.
--
-- ADMIN SESSIONS ARE NOT EXEMPT. With no JWT (SQL editor, service role) auth.uid() is null, is_campaign_dm() is false,
-- and the rule applies. pact_enforce_creation_lock() exempts admin sessions; this one, like the 2026-09-03 version,
-- does not. An owner repairing a row by hand in a way that raises its award total must disable trg_pact_player_ap_ceiling
-- for that one transaction, as was done for other guarded repairs.
--
-- GRANT CODES (H2, provisional). A Live Sheet "Redeem" appends an `award` with a grantId. The code is
-- tamper-evident, not secret (js/ap-grant-code.js): the database cannot tell a DM-issued code from one the
-- player made. So a redeemed code is refused like any other player award on a locked/sealed campaign
-- character. The Live Sheet now says so before redeeming; a campaign DM gives AP with "Award AP" (award_ap).
--
-- LIVE MEASUREMENT (owner-approved read, 2026-10-12, before this file was written): 12 `award` events on 10
-- campaign-bound characters, all in ONE campaign, which has ignore_player_ap = TRUE. All are CharGen's noLock
-- "Budget" singleton except two "Zeroed by DM" negatives before the lock. Four characters carry the Budget
-- award AFTER the lock index (amounts 0, 0, 0, 77). No grantId and no disc awards anywhere. No campaign with
-- ignore_player_ap = false has a bound character with an award. So 0 characters gain AP through this gap
-- today, and no stored character changes total by being re-saved, so none is refused by this rule.
--
-- Rehearsed on a throwaway Postgres: testing/scripts/creation-lock-guard-test/run-award.sh.
-- Rollback: 2026-10-12-server-player-award-after-lock-rollback.sql (the 2026-09-03 definition, verbatim).
-- BEFORE APPLYING: confirm live pact_enforce_player_ap_ceiling() still matches 2026-09-03-dm-zero-player-ap.sql
-- (select pg_get_functiondef('public.pact_enforce_player_ap_ceiling()'::regprocedure)) so the rollback is exact.

create or replace function public.pact_enforce_player_ap_ceiling()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign    public.campaigns%rowtype;
  v_old_log     jsonb;
  v_last_lock   int;
  v_last_unlock int;
  v_sealed      boolean;
  v_locked      boolean;
  v_old_award   numeric;
  v_new_award   numeric;
begin
  if NEW.campaign_id is null then
    return NEW;
  end if;
  if NEW.stats is not distinct from OLD.stats then
    return NEW;
  end if;

  select * into v_campaign from public.campaigns where id = NEW.campaign_id;
  if not found then
    return NEW;  -- fail open, matching pact_enforce_ap_budget_consistency's own dangling-campaign case
  end if;

  -- Every award amount must be a JSON number. A string such as "NaN", "Infinity" or "500" casts to numeric, and a NaN
  -- makes every sum NaN, so the budget check and this ceiling both stop comparing anything. Checked for every writer and
  -- whether or not the character is locked: a value planted before the lock would otherwise disarm both checks after it.
  if exists (select 1 from jsonb_array_elements(coalesce(NEW.stats->'LOG', '[]'::jsonb)) e
              where e->>'type' = 'award' and jsonb_typeof(e->'amount') <> 'number') then
    raise exception 'PACT: an AP award amount must be a number';
  end if;

  -- A DM of this campaign is the one person allowed to give AP through the log (boon grants, zeroing).
  if public.is_campaign_dm(NEW.campaign_id) then
    return NEW;
  end if;

  v_old_log := coalesce(OLD.stats->'LOG', '[]'::jsonb);
  select max(ord) filter (where ev->>'type' = 'creationLocked'),
         max(ord) filter (where ev->>'type' = 'creationUnlocked'),
         coalesce(bool_or(ev->>'type' = 'sessionSeal'), false)
    into v_last_lock, v_last_unlock, v_sealed
    from jsonb_array_elements(v_old_log) with ordinality as t(ev, ord);
  v_locked := v_sealed or (v_last_lock is not null and coalesce(v_last_unlock, 0) < v_last_lock);

  if not v_campaign.ignore_player_ap and not v_locked then
    return NEW;
  end if;

  select coalesce(sum(coalesce((e->>'amount')::numeric, 0)), 0) into v_old_award
    from jsonb_array_elements(v_old_log) e
   where e->>'type' = 'award';
  select coalesce(sum(coalesce((e->>'amount')::numeric, 0)), 0) into v_new_award
    from jsonb_array_elements(coalesce(NEW.stats->'LOG', '[]'::jsonb)) e
   where e->>'type' = 'award';

  if v_new_award > v_old_award then
    if v_campaign.ignore_player_ap then
      raise exception
        'PACT: this campaign''s DM has switched off player-entered AP — it can no longer be increased (ask your DM to raise it instead)';
    end if;
    raise exception
      'PACT: this character''s creation is finished — its AP comes from your DM now (ask them to award it in the DM Console)';
  end if;

  return NEW;
end;
$$;

-- The trigger already exists in production (2026-09-03); re-created here so this file also stands on its own.
drop trigger if exists trg_pact_player_ap_ceiling on public.characters;
create trigger trg_pact_player_ap_ceiling
  before update on public.characters
  for each row execute function public.pact_enforce_player_ap_ceiling();

-- A trigger function never needs EXECUTE (2026-09-01-revoke-trigger-function-execute.sql); the 2026-09-03
-- migration granted it to authenticated. Revoking does not stop the trigger firing.
revoke execute on function public.pact_enforce_player_ap_ceiling() from public, anon, authenticated;

comment on function public.pact_enforce_player_ap_ceiling() is
  'Refuses a rise in a campaign character''s LOG award total by anyone but a DM of its campaign, when the campaign ignores player AP or the character is creation-locked or sealed. D-GH-2026-10-12-server-player-award-after-lock.';
