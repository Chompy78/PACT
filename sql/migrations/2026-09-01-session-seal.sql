-- PACT — session seal: an explicit, DM- or owner-drawn line under a character's history.
-- feat/session-seal Phase 1 (D-GH-2026-09-01-session-seal). Plan + three cold reviews:
-- docs/plans/2026-09-01-session-seal-cold-review.md
--
-- THIS IS AN AMENDMENT, NOT A NEW MECHANISM. Read this first.
--
-- The first draft of this migration added a SECOND trigger doing prefix protection, because its
-- author (and all three cold reviewers, who had no repo access) believed no server-side history
-- protection existed. It does, and has since 2026-08-10:
-- sql/migrations/2026-08-10-campaign-ap-log-integrity.sql's pact_enforce_locked_history() already
-- freezes everything at or before the last non-discretionary, non-seed `award` event, for
-- campaign-bound characters. Adding a parallel trigger would have been the exact "hand-written
-- mirror of a canonical rule" drift AGENTS.md names as this project's recurring failure — and the
-- second copy compared raw JSONB where the original deliberately compares a PROJECTION, a
-- distinction the original earned through three review-found bugs (see that file's revision note).
--
-- So this file EXTENDS the existing trigger instead. Three surgical changes:
--
--   1. `sessionSeal` joins the protected projection, so a seal cannot itself be deleted or altered.
--   2. The boundary becomes the LATER of the existing award boundary and the last seal.
--   3. The seal half applies to SOLO characters too, not just campaign-bound ones (owner decision
--      I2). The award half keeps its campaign-only scope exactly as before.
--
-- WHAT A SEAL ADDS OVER THE AWARD BOUNDARY THAT ALREADY EXISTS:
--   * It is EXPLICIT and STABLE. The award boundary moves as awards land and is invisible until it
--     does; a seal is placed deliberately, when the DM chooses, and stays put.
--   * It works for SOLO characters, which the award boundary skips entirely.
--   * It is reachable from the DM Console's "Award AP", which writes only characters.ap and no LOG
--     event at all — so today that button locks nothing whatsoever. award_ap_and_seal() below fixes
--     that without moving AP into the log (which would double-count it).
--
-- NON-RETROACTIVE BY CONSTRUCTION: measured 2026-09-01, zero of the 35 live characters carry a
-- `sessionSeal`, so change (1) alters no existing protected set, and (2) and (3) are no-ops until
-- somebody deliberately places the first seal. The award boundary's behaviour is untouched.
--
-- DEPLOYMENT ORDER: safe to apply before the Phase 2 tool work, precisely because no UI can create a
-- seal yet. Do not surface a seal control until Phase 2 ships, or a sealed character saved from
-- CharGen would hit a hard rejection with no explanatory UI.

-- ===========================================================================
-- 1. Protected projection — `sessionSeal` added.
--
-- Byte-identical to the 2026-08-10 version except for the added type in the WHERE clause. The seal
-- carries no economic fields, so the projected object is all nulls but its TYPE and POSITION, which
-- is exactly what needs protecting: remove or reorder the seal and the projection changes, and the
-- comparison below rejects the write.
-- ===========================================================================
create or replace function public.pact_ap_ledger_protected(p_log jsonb)
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'type', ev->>'type', 'cat', ev->>'cat',
           'cost', ev->>'cost', 'amount', ev->>'amount', 'refVal', ev->>'refVal',
           'disc', ev->>'disc'
         ) order by ord), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_log,'[]'::jsonb)) with ordinality as t(ev, ord)
  where (ev->>'type') in ('buyoff','names','award','sessionSeal')
     or ((ev->>'type') = 'buy' and coalesce(ev->>'cat','') <> 'patch');
$$;

-- ===========================================================================
-- 2. The boundary — later of (award, seal); seal applies to solo characters too.
-- ===========================================================================
create or replace function public.pact_enforce_locked_history()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old_log jsonb;
  v_award_idx int;
  v_seal_idx int;
  v_idx int;
  v_protected_old jsonb;
  v_protected_new jsonb;
  i int;
begin
  -- Unchanged: an untouched log is nothing to police (autosave/archive/ap-only updates land here).
  if NEW.stats is not distinct from OLD.stats then
    return NEW;
  end if;

  v_old_log := coalesce(OLD.stats->'LOG', '[]'::jsonb);

  -- SEAL BOUNDARY — every character, campaign-bound or solo (owner decision I2). A solo player has
  -- no DM to seal for them, so seal_character_history() lets the owner do it; the enforcement here
  -- deliberately does not care who placed it, only that it is there.
  select max(ord) into v_seal_idx
  from jsonb_array_elements(v_old_log) with ordinality as t(ev, ord)
  where (ev->>'type') = 'sessionSeal';

  -- AWARD BOUNDARY — campaign-bound only, exactly as before this amendment. The noLock exclusion is
  -- load-bearing: CharGen's creation-budget award is re-synced by delete-then-append on every budget
  -- change, so treating it as a boundary would drag the lock forward and freeze ordinary drafting
  -- (2026-08-10 revision note, fix #3).
  if NEW.campaign_id is not null then
    select max(ord) into v_award_idx
    from jsonb_array_elements(v_old_log) with ordinality as t(ev, ord)
    where (ev->>'type') = 'award'
      and not coalesce((ev->>'disc')::boolean, false)
      and not coalesce((ev->>'noLock')::boolean, false);
  end if;

  v_idx := greatest(coalesce(v_seal_idx, 0), coalesce(v_award_idx, 0));
  if v_idx = 0 then
    return NEW;
  end if;

  v_protected_old := public.pact_ap_ledger_protected(
    (select jsonb_agg(ev order by ord)
       from jsonb_array_elements(v_old_log) with ordinality as t(ev, ord)
       where ord <= v_idx)
  );
  v_protected_new := public.pact_ap_ledger_protected(coalesce(NEW.stats->'LOG', '[]'::jsonb));

  if jsonb_array_length(v_protected_new) < jsonb_array_length(v_protected_old) then
    raise exception 'PACT: locked character history cannot shrink (% events are sealed or locked by an AP award)', v_idx
      using hint = 'Reload the character — its history was locked after this copy was loaded.';
  end if;

  for i in 0 .. jsonb_array_length(v_protected_old) - 1 loop
    if (v_protected_old -> i) is distinct from (v_protected_new -> i) then
      raise exception 'PACT: locked character history cannot be rewritten (protected event % changed)', i
        using hint = 'Reload the character — its history was locked after this copy was loaded.';
    end if;
  end loop;

  return NEW;
end;
$$;

-- ===========================================================================
-- 3. Placing a seal. One entry point, both tiers (owner decision I2):
--    campaign character -> any DM of that campaign; solo character -> its owner.
--
-- The event carries no AP field at all, rather than a zero by convention (M365 Copilot review point:
-- a type that cannot express a value cannot later acquire one by accident). seq/ts and the sealer's
-- identity are stamped here; client-supplied values for them are discarded, the same rule
-- dm_edit_character_log() already applies.
--
-- p_idem makes a retry after a network timeout a no-op returning the existing seal.
-- ===========================================================================
create or replace function public.seal_character_history(
  p_character uuid,
  p_note      text default null,
  p_idem      text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign uuid;
  v_owner    uuid;
  v_stats    jsonb;
  v_log      jsonb;
  v_seq      integer;
  v_ev       jsonb;
  v_ts       bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  select campaign_id, owner_id, stats
    into v_campaign, v_owner, v_stats
    from characters where id = p_character for update;
  if not found then
    raise exception 'Character not found';
  end if;

  if v_campaign is not null then
    if not is_campaign_dm(v_campaign) then
      raise exception 'Only a campaign DM can seal this character''s history';
    end if;
    perform assert_campaign_active(v_campaign);
  elsif v_owner is distinct from auth.uid() then
    raise exception 'Only the owner can seal a character that is not in a campaign';
  end if;

  if v_stats is null or not (v_stats ? 'LOG') then
    raise exception 'Character has no log to seal';
  end if;
  v_log := coalesce(v_stats->'LOG', '[]'::jsonb);

  if p_idem is not null then
    select ev into v_ev
      from jsonb_array_elements(v_log) as t(ev)
     where t.ev->>'type' = 'sessionSeal' and t.ev->>'idem' = p_idem
     limit 1;
    if v_ev is not null then
      return v_ev;
    end if;
  end if;

  v_seq := coalesce((v_stats->>'SEQ')::integer, jsonb_array_length(v_log) + 1);
  v_ev := jsonb_build_object(
    'seq',        v_seq,
    'ts',         v_ts,
    'type',       'sessionSeal',
    'label',      coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Session sealed'),
    'note',       coalesce(p_note, ''),
    'sealedBy',   auth.uid(),
    'sealedRole', case when v_campaign is null then 'owner' else 'dm' end
  );
  if p_idem is not null then
    v_ev := v_ev || jsonb_build_object('idem', p_idem);
  end if;
  -- dmEdit marks ANOTHER account's edit, so it belongs on a DM seal and not on a self-seal. The
  -- protection does not depend on it either way — `sessionSeal` is a boundary by type.
  if v_campaign is not null then
    v_ev := v_ev || jsonb_build_object('dmEdit', true, 'dmId', auth.uid());
  end if;

  v_stats := jsonb_set(jsonb_set(v_stats, '{LOG}', v_log || jsonb_build_array(v_ev)),
                       '{SEQ}', to_jsonb(v_seq + 1));
  update characters set stats = v_stats where id = p_character;
  return v_ev;
end;
$$;

-- ===========================================================================
-- 4. Award AP and seal, atomically. A plpgsql body is one transaction, so either the ledger row, the
-- AP increment and the seal all commit or none do. Without this you can get AP awarded but history
-- unsealed (or the reverse), and a DM retrying the half they saw fail duplicates the half that
-- succeeded — and awarding twice is the one outcome here that materially damages a character.
--
-- The AP itself stays in characters.ap. It is NOT written into the log, because AP already reaches a
-- character by two independent paths feeding the same spendable total; one award in both would
-- double it. The seal is a separate valueless marker, which is exactly what lets it be one.
-- ===========================================================================
create or replace function public.award_ap_and_seal(
  p_character uuid,
  p_amount    integer,
  p_note      text default null,
  p_idem      text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ap   integer;
  v_seal jsonb;
begin
  -- The seal is written last, so finding this key means the whole operation already committed.
  if p_idem is not null then
    select ev into v_seal
      from characters c, jsonb_array_elements(coalesce(c.stats->'LOG', '[]'::jsonb)) as t(ev)
     where c.id = p_character
       and t.ev->>'type' = 'sessionSeal' and t.ev->>'idem' = p_idem
     limit 1;
    if v_seal is not null then
      select ap into v_ap from characters where id = p_character;
      return jsonb_build_object('ap', v_ap, 'seal', v_seal, 'repeated', true);
    end if;
  end if;

  v_ap   := public.award_ap(p_character, p_amount, p_note);
  v_seal := public.seal_character_history(p_character, p_note, p_idem);
  return jsonb_build_object('ap', v_ap, 'seal', v_seal, 'repeated', false);
end;
$$;

-- ===========================================================================
-- 5. dm_edit_character_log()'s allow-list gains `sessionSeal`, so a DM can seal alongside an edit in
-- one write. Every other line is unchanged from 2026-08-10; replaced wholesale rather than patched so
-- the allow-list reads as one list in one place.
-- ===========================================================================
create or replace function public.dm_edit_character_log(p_character uuid, p_events jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign uuid;
  v_stats    jsonb;
  v_log      jsonb;
  v_seq      integer;
  v_new      jsonb := '[]'::jsonb;
  v_ev       jsonb;
  v_type     text;
  v_cat      text;
  v_ts       bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events) = 0 then
    raise exception 'p_events must be a non-empty JSON array';
  end if;

  select campaign_id, stats into v_campaign, v_stats from characters where id = p_character for update;
  if not found then
    raise exception 'Character not found';
  end if;
  if v_campaign is null then
    raise exception 'Character is not in a campaign';
  end if;
  if not is_campaign_dm(v_campaign) then
    raise exception 'Only a campaign DM can edit this character';
  end if;
  if v_stats is null or not (v_stats ? 'LOG') then
    raise exception 'Character has no log to edit';
  end if;

  v_log := coalesce(v_stats->'LOG', '[]'::jsonb);
  v_seq := coalesce((v_stats->>'SEQ')::integer, jsonb_array_length(v_log) + 1);

  for v_ev in select * from jsonb_array_elements(p_events) loop
    v_type := v_ev->>'type';
    v_cat  := v_ev->>'cat';
    -- Scope allow-list: boons and drawbacks only (owner, 2026-08-05 — "not a general editor"), plus
    -- `award` (which award_ap() already permits a DM through its own path) and, since
    -- feat/session-seal, `sessionSeal` — valueless, so it cannot move AP however it arrives.
    if v_type = 'buy' then
      if v_cat is distinct from 'boon' and v_cat is distinct from 'drawback' then
        raise exception 'dm_edit_character_log: unsupported buy category %', v_cat;
      end if;
    elsif v_type not in ('award', 'dmRemoveBoon', 'sessionSeal') then
      raise exception 'dm_edit_character_log: unsupported event type %', v_type;
    end if;

    if v_type = 'sessionSeal' then
      v_ev := v_ev - 'amount' - 'cost';   -- a seal never carries a value, whichever door it comes through
    end if;

    v_ev := (v_ev - 'seq' - 'ts' - 'dmEdit' - 'dmId')
      || jsonb_build_object('seq', v_seq, 'ts', v_ts, 'dmEdit', true, 'dmId', auth.uid());
    v_new := v_new || jsonb_build_array(v_ev);
    v_seq := v_seq + 1;
  end loop;

  v_log := v_log || v_new;
  v_stats := jsonb_set(jsonb_set(v_stats, '{LOG}', v_log), '{SEQ}', to_jsonb(v_seq));

  update characters set stats = v_stats where id = p_character;
  return v_new;
end;
$$;

-- ===========================================================================
-- 6. Grants. Authorisation is decided inside each function, as everywhere else in this schema.
-- ===========================================================================
grant  execute on function public.seal_character_history(uuid, text, text)     to authenticated;
revoke execute on function public.seal_character_history(uuid, text, text)     from public;
grant  execute on function public.award_ap_and_seal(uuid, integer, text, text) to authenticated;
revoke execute on function public.award_ap_and_seal(uuid, integer, text, text) from public;
grant  execute on function public.dm_edit_character_log(uuid, jsonb)           to authenticated;
revoke execute on function public.dm_edit_character_log(uuid, jsonb)           from public;
grant  execute on function public.pact_ap_ledger_protected(jsonb)              to authenticated;
revoke execute on function public.pact_ap_ledger_protected(jsonb)              from public;
