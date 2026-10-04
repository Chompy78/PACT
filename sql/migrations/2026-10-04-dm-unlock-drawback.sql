-- ---------------------------------------------------------------------------
-- feat/dm-unlock-drawback (D-GH-2026-10-04-dm-unlock-drawback)
-- A DM can release a drawback they imposed LOCKED, once the story beat has happened.
--
-- WHAT THIS CHANGES — two functions, nothing else:
--   1. dm_edit_character_log(): accepts one new event type, 'dmUnlockDrawback', validated against the
--      STORED log (see the [UNLOCK] block). Every other behaviour is unchanged.
--   2. pact_ap_ledger_protected(): 'dmUnlockDrawback' joins the protected types, the same way
--      'dmRemoveBoon' did in 2026-09-02 (applied there as `seal_protects_dm_removals`).
--
-- WHAT IT DELIBERATELY LEAVES ALONE
--   * pact_ap_ledger_spend(): an unlock carries no cost or amount (the function rebuilds the event from a
--     whitelist, so none can ride along), so it moves no AP and needs no change there.
--   * Every trigger, and every GRANT/REVOKE. `create or replace` keeps a function's existing privileges, so
--     none are restated here. Verify with the grant queries below.
--   * Whether the unlocked drawback has since been bought off — that is js/engine.js's by-name FIFO match
--     and is not duplicated in SQL (see the [UNLOCK] comment).
--
-- KNOWN LIMIT, STATED PLAINLY. The lock and this unlock are honoured by the player's own app; the server
-- does not enforce them. A character's owner can already write their own `stats`, so a hostile owner can
-- forge any event in their own log, including an unlock. This migration makes the DM's unlock a validated,
-- DM-stamped, audited record; it does not make the lock tamper-proof. Real enforcement is its own task
-- (feat/server-enforced-drawback-lock) and needs an unforgeable DM-authorship signal this schema lacks.
--
-- BASE OF THESE DEFINITIONS — READ THIS BEFORE EDITING. Both bodies below were generated from
-- sql/rls-policies.sql (the maintained baseline), which was checked against the LIVE database on
-- 2026-10-04 BEFORE this change was written, by hashing the live functions with the same normalisation
-- testing/sql/rls-baseline-test.sql's drift guard uses (comments stripped, whitespace collapsed, plus
-- proconfig / prosecdef / provolatile) and hashing the pre-change baseline the same way:
--     dm_edit_character_log     f6476a61e4d504cfb50b14119420641c   live == baseline
--     pact_ap_ledger_protected  60b099bb2e1b1b8e263ee3bc48bbd6c9   live == baseline
-- (Reproduce: run that md5 expression over pg_proc on production, and over the two functions in this
-- migration's -rollback.sql loaded into a scratch Postgres; the pair must agree before you apply this.)
-- They were NOT rebuilt from any dated
-- migration: on 2026-09-02 that mistake silently deleted assert_campaign_active() and the boon/award amount
-- check from this very function for about eleven hours (see sql/migrations/README.md). RE-VERIFY against
-- production immediately before applying — it is the only source that cannot be stale — and check that all
-- of these guards survive the rebuild:  assert_campaign_active, 'has no matching award', 'sessionSeal'.
--
-- AFTER APPLYING, all of these must hold:
--   select p.prosrc like '%assert_campaign_active%' as guard_archived,
--          p.prosrc like '%has no matching award%'  as guard_boon_award,
--          p.prosrc like '%sessionSeal%'            as seal_allowed,
--          p.prosrc like '%dmUnlockDrawback%'       as unlock_added
--     from pg_proc p where p.proname = 'dm_edit_character_log';              -- true, true, true, true
--   select prosrc like '%dmUnlockDrawback%' as protected_has_unlock
--     from pg_proc where proname = 'pact_ap_ledger_protected';                -- true
--   select has_function_privilege('authenticated', 'public.dm_edit_character_log(uuid,jsonb)', 'execute');  -- true
--   select has_function_privilege('anon',          'public.dm_edit_character_log(uuid,jsonb)', 'execute');  -- false
--   select has_function_privilege('authenticated', 'public.pact_ap_ledger_protected(jsonb)',   'execute');  -- false
-- then run get_advisors (security + performance) and skim get_logs, per AGENTS.md's migration checklist.
--
-- ROLLBACK: sql/migrations/2026-10-04-dm-unlock-drawback-rollback.sql restores the two pre-change bodies.
-- Unlock events already written stay in those logs (harmless: the rolled-back function refuses NEW ones and
-- the protected projection simply stops comparing them).
-- ---------------------------------------------------------------------------

create or replace function public.dm_edit_character_log(p_character uuid, p_events jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign   uuid;
  v_stats      jsonb;
  v_log        jsonb;
  v_seq        integer;
  v_new        jsonb := '[]'::jsonb;
  v_ev         jsonb;
  v_type       text;
  v_cat        text;
  v_ts         bigint := (extract(epoch from now()) * 1000)::bigint;
  -- fix/dm-edit-boon-amount-check (D-GH-2026-08-10-dm-edit-boon-amount-check): cross-validate that
  -- every boon grant's buy/award pair actually moves the same amount, so the "net 0 to spendable AP"
  -- promise this function makes is enforced server-side, not just by DM Console's client always
  -- sending the pair together. FIFO-by-VALUE, not by-name: an award event carries only an amount, no
  -- reference to which buy it pays for (unlike buyoff/dmRemoveBoon, which carry refVal).
  v_boon_costs numeric[] := '{}';
  v_award_amts numeric[] := '{}';
  v_award_used boolean[];
  v_matched    boolean;
  v_i          integer;
  v_j          integer;
  -- feat/dm-unlock-drawback (D-GH-2026-10-04-dm-unlock-drawback): scratch for validating 'dmUnlockDrawback'.
  v_name       text;
  v_target     integer;
  v_note       text;
  v_matches    integer;
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
  perform assert_campaign_active(v_campaign);
  if v_stats is null or not (v_stats ? 'LOG') then
    raise exception 'Character has no log to edit';
  end if;

  v_log := coalesce(v_stats->'LOG', '[]'::jsonb);
  v_seq := coalesce((v_stats->>'SEQ')::integer, jsonb_array_length(v_log) + 1);

  for v_ev in select * from jsonb_array_elements(p_events) loop
    v_type := v_ev->>'type';
    v_cat  := v_ev->>'cat';
    if v_type = 'buy' then
      if v_cat is distinct from 'boon' and v_cat is distinct from 'drawback' then
        raise exception 'dm_edit_character_log: unsupported buy category %', v_cat;
      end if;
      if v_cat = 'boon' then
        v_boon_costs := v_boon_costs || coalesce((v_ev->>'cost')::numeric, 0);
      end if;
    -- [SEAL] 'sessionSeal' added by 2026-09-01-session-seal.sql so a DM can draw the line
    -- through the same audited, dm-stamped path as every other DM-authored event.
    -- [UNLOCK] 'dmUnlockDrawback' added by 2026-10-04-dm-unlock-drawback.sql: a DM releases a drawback they
    -- imposed LOCKED once the story beat has happened. Validated below, per event.
    elsif v_type not in ('award', 'dmRemoveBoon', 'sessionSeal', 'dmUnlockDrawback') then
      raise exception 'dm_edit_character_log: unsupported event type %', v_type;
    end if;
    if v_type = 'award' then
      v_award_amts := v_award_amts || coalesce((v_ev->>'amount')::numeric, 0);
    end if;

    -- [SEAL] A seal is a marker, not a transaction. Stripping amount/cost keeps it out of
    -- pact_ap_ledger_spend's sums and out of the boon/award matching arrays above.
    if v_type = 'sessionSeal' then
      v_ev := v_ev - 'amount' - 'cost';
    end if;

    -- [UNLOCK] An unlock is a marker, not a transaction, and it must name ONE specific purchase. Keyed by the
    -- imposed purchase's server-stamped seq plus its drawback name — never by name alone, because a character
    -- can hold a player-taken and an imposed purchase of the same name and js/engine.js's buy-off match is
    -- by name (FIFO). The target must already be in the STORED log: an imposition and its unlock cannot be
    -- sent in the same call. Validated against the stored log, not the client, so a DM cannot unlock a
    -- player-taken drawback, an unlocked one, one that does not exist, or the same one twice.
    -- Deliberately NOT checked here: whether the target has since been bought off. That is js/engine.js's
    -- by-name FIFO match; re-implementing it in SQL would duplicate a rules decision in a second place. An
    -- unlock of a bought-off purchase is a harmless no-op the engine ignores, and DM Console only ever offers
    -- purchases the engine reports as open.
    if v_type = 'dmUnlockDrawback' then
      v_name := btrim(coalesce(v_ev->>'refVal', ''));
      v_note := btrim(coalesce(v_ev->>'note', ''));
      if v_name = '' then
        raise exception 'dm_edit_character_log: dmUnlockDrawback needs refVal (the drawback name)';
      end if;
      if coalesce(v_ev->>'targetSeq', '') !~ '^[0-9]{1,9}$' then
        raise exception 'dm_edit_character_log: dmUnlockDrawback needs targetSeq (the integer seq of the imposed purchase)';
      end if;
      v_target := (v_ev->>'targetSeq')::integer;
      if v_note = '' or char_length(v_note) > 200 then
        raise exception 'dm_edit_character_log: dmUnlockDrawback needs a story-beat note of 1 to 200 characters';
      end if;
      -- jsonb equality, not ::boolean casts: a hand-edited log can hold any value in these fields, and a
      -- cast error here would abort the DM's call instead of cleanly refusing it.
      select count(*) into v_matches
        from jsonb_array_elements(v_log) as t(e)
       where e->>'type' = 'buy' and e->>'cat' = 'drawback'
         and e#>>'{payload,v}' = v_name
         and e->>'seq' = v_target::text
         and e->'dmEdit' = 'true'::jsonb
         and e->'dmLocked' = 'true'::jsonb;
      if v_matches <> 1 then
        raise exception 'dm_edit_character_log: no single DM-imposed, locked drawback "%" at seq % to unlock (found %)', v_name, v_target, v_matches;
      end if;
      if exists (select 1 from jsonb_array_elements(v_log || v_new) as t(e)
                  where e->>'type' = 'dmUnlockDrawback' and e->>'refVal' = v_name
                    and e->>'targetSeq' = v_target::text) then
        raise exception 'dm_edit_character_log: drawback "%" at seq % is already unlocked', v_name, v_target;
      end if;
      -- Rebuild from a whitelist instead of stripping fields: nothing else the client sent (cost, amount, disc,
      -- payload, ...) may ride along, so the event cannot move AP or masquerade as another type.
      v_ev := jsonb_build_object('type', 'dmUnlockDrawback', 'refVal', v_name, 'targetSeq', v_target,
                                 'note', v_note,
                                 'label', left(coalesce(nullif(btrim(v_ev->>'label'), ''), 'DM unlocked — ' || v_name), 120));
    end if;

    v_ev := (v_ev - 'seq' - 'ts' - 'dmEdit' - 'dmId')
      || jsonb_build_object('seq', v_seq, 'ts', v_ts, 'dmEdit', true, 'dmId', auth.uid());
    v_new := v_new || jsonb_build_array(v_ev);
    v_seq := v_seq + 1;
  end loop;

  -- Every boon-grant buy must be matched, FIFO-by-value, to a same-call award of the identical amount —
  -- checked AFTER the loop above (once both arrays are fully collected) but BEFORE the write below, so a
  -- rejected batch never partially applies. A standalone award with no matching boon-buy is left alone
  -- on purpose — award_ap() already lets any campaign DM grant arbitrary AP through its own, unrestricted
  -- path, so a bare award here is a second route to a capability the DM already unconditionally has, not
  -- a new privilege; only a genuinely MISMATCHED pair (a boon-buy this batch never actually paid for) is
  -- the correctness gap this closes.
  v_award_used := array_fill(false, array[coalesce(array_length(v_award_amts, 1), 0)]);
  for v_i in 1 .. coalesce(array_length(v_boon_costs, 1), 0) loop
    v_matched := false;
    for v_j in 1 .. coalesce(array_length(v_award_amts, 1), 0) loop
      if not v_award_used[v_j] and v_award_amts[v_j] = v_boon_costs[v_i] then
        v_award_used[v_j] := true;
        v_matched := true;
        exit;
      end if;
    end loop;
    if not v_matched then
      raise exception 'dm_edit_character_log: boon grant at cost % has no matching award of the identical amount in the same call', v_boon_costs[v_i];
    end if;
  end loop;

  v_log := v_log || v_new;
  v_stats := jsonb_set(jsonb_set(v_stats, '{LOG}', v_log), '{SEQ}', to_jsonb(v_seq));

  update characters set stats = v_stats where id = p_character;
  return v_new;
end;
$$;

create or replace function public.pact_ap_ledger_protected(p_log jsonb)
returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg((ev - 'seq' - 'ts' - 'rules' - 'label') order by ord), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_log,'[]'::jsonb)) with ordinality as t(ev, ord)
  where (ev->>'type') in ('buyoff','names','award','sessionSeal','dmRemoveBoon','dmUnlockDrawback')
     or ((ev->>'type') = 'buy' and coalesce(ev->>'cat','') <> 'patch');
$$;
