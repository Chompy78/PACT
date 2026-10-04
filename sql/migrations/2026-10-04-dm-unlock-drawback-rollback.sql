-- ---------------------------------------------------------------------------
-- ROLLBACK for 2026-10-04-dm-unlock-drawback.sql (feat/dm-unlock-drawback).
--
-- Restores dm_edit_character_log() and pact_ap_ledger_protected() to their definitions immediately BEFORE
-- that migration, i.e. the live production bodies as of 2026-10-04 (identical to the then-current
-- sql/rls-policies.sql baseline). Generated from that baseline text, not typed.
--
-- WHAT YOU GIVE UP: a DM can no longer unlock a drawback (the function refuses 'dmUnlockDrawback' as an
-- unsupported event type), and unlock events stop being compared by the locked-history trigger.
-- WHAT STAYS: any unlock events already written remain in those characters' logs. They are harmless — the
-- engine reads them to decide whether a locked drawback may be bought off, they move no AP.
--
-- If you use this, ALSO revert the matching change in sql/rls-policies.sql, or testing/sql/
-- rls-baseline-test.sql's drift guard will (correctly) fail.
--
-- After applying, re-check that the guards are all still present (same query as the forward migration, with
-- unlock_added now FALSE): assert_campaign_active, 'has no matching award', 'sessionSeal'.
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
    elsif v_type not in ('award', 'dmRemoveBoon', 'sessionSeal') then
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
  where (ev->>'type') in ('buyoff','names','award','sessionSeal','dmRemoveBoon')
     or ((ev->>'type') = 'buy' and coalesce(ev->>'cat','') <> 'patch');
$$;
