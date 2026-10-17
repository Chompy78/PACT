-- PACT — ROLLBACK of 2026-10-15-boon-drawback-notes.sql (D-GH-2026-10-15-boon-drawback-notes).
-- Restores dm_edit_character_log() VERBATIM from sql/rls-policies.sql (the definition live on 2026-10-15, = the applied
-- 2026-10-13-dm-ap-discount.sql) and drops what the migration added. testing/scripts/creation-lock-guard-test/run-notes.sh
-- checks the restored definition is byte-identical (md5 of pg_get_functiondef) to the one the migration replaced.
-- If feat/campaign-house-rules was applied AFTER this migration, this file is stale: restore that migration's
-- dm_edit_character_log instead (see the migration's RECONCILE note).
--
-- DATA IS NOT TOUCHED. itemNote / dmApproveNote / dmUnlockNote events stay in the logs; the tools keep reading them (an
-- approved note still shows approved and locked in the tools), but the server no longer refuses a player's change to an
-- approved note, and DM Console's Approve/Unlock show "the server has not been updated" again.
-- Apply single-transaction (`psql -1`), like the migration.

drop trigger if exists trg_pact_item_note_lock on public.characters;
drop function if exists public.pact_enforce_item_note_lock();

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
  -- feat/dm-ap-discount (D-GH-2026-10-13-dm-ap-discount): scratch for validating 'dmDiscount'.
  v_tcat       text;
  v_amount     numeric;
  v_cost       numeric;
  v_prior      numeric;
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
    -- [DISCOUNT] 'dmDiscount' added by 2026-10-13-dm-ap-discount.sql: a DM takes AP off one earlier priced
    -- purchase. Validated below, per event.
    elsif v_type not in ('award', 'dmRemoveBoon', 'sessionSeal', 'dmUnlockDrawback', 'dmDiscount') then
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

    -- [DISCOUNT] A discount names ONE earlier purchase by its seq plus its category (`targetCat`: the buy's
    -- `cat`, or 'buyoff' / 'names' for those types) — the same identity js/engine.js's activeEvents() resolves.
    -- The target is looked up in the stored log plus this call's earlier events, so a grant and its discount
    -- can be sent together. It must be the only event with that seq, a priced purchase (not a drawback), and
    -- the purchase's net discount after this one must stay between 0 and its frozen cost: a negative amount is
    -- how a DM corrects a mistake, and nothing is ever deleted. Amounts are whole AP and must be JSON numbers.
    -- Not checked: whether the purchase is still owned — js/engine.js decides that (owner decision I1).
    if v_type = 'dmDiscount' then
      v_tcat := btrim(coalesce(v_ev->>'targetCat', ''));
      v_note := btrim(coalesce(v_ev->>'note', ''));
      if coalesce(v_ev->>'targetSeq', '') !~ '^[0-9]{1,9}$' then
        raise exception 'dm_edit_character_log: dmDiscount needs targetSeq (the integer seq of the purchase)';
      end if;
      v_target := (v_ev->>'targetSeq')::integer;
      if v_tcat = '' then
        raise exception 'dm_edit_character_log: dmDiscount needs targetCat (the purchase''s category)';
      end if;
      if jsonb_typeof(v_ev->'amount') is distinct from 'number' then
        raise exception 'dm_edit_character_log: dmDiscount needs a whole, non-zero amount of AP';
      end if;
      v_amount := (v_ev->>'amount')::numeric;
      if v_amount = 0 or v_amount <> trunc(v_amount) then
        raise exception 'dm_edit_character_log: dmDiscount needs a whole, non-zero amount of AP';
      end if;
      if v_note = '' or char_length(v_note) > 200 then
        raise exception 'dm_edit_character_log: dmDiscount needs a note of 1 to 200 characters';
      end if;
      select count(*),
             max(case when e->>'type' = 'buy' then coalesce(e->>'cat', '') else e->>'type' end),
             max(case when jsonb_typeof(e->'cost') = 'number' then (e->>'cost')::numeric else 0 end)
        into v_matches, v_cat, v_cost
        from jsonb_array_elements(v_log || v_new) as t(e)
       where e->>'seq' = v_target::text and coalesce(e->>'type', '') <> 'dmDiscount';
      if v_matches <> 1 or v_cat is distinct from v_tcat or v_cat = 'drawback'
         or not exists (select 1 from jsonb_array_elements(v_log || v_new) as t(e)
                         where e->>'seq' = v_target::text and e->>'type' in ('buy', 'buyoff', 'names'))
         or coalesce(v_cost, 0) <= 0 then
        raise exception 'dm_edit_character_log: no single priced % purchase at seq % to discount (found %)', v_tcat, v_target, v_matches;
      end if;
      select coalesce(sum((e->>'amount')::numeric), 0) into v_prior
        from jsonb_array_elements(v_log || v_new) as t(e)
       where e->>'type' = 'dmDiscount' and e->>'targetSeq' = v_target::text and jsonb_typeof(e->'amount') = 'number';
      if v_prior + v_amount < 0 or v_prior + v_amount > v_cost then
        raise exception 'dm_edit_character_log: a discount of % would take seq % to % AP off a % AP purchase (allowed 0 to %)',
          v_amount, v_target, v_prior + v_amount, v_cost, v_cost;
      end if;
      -- Rebuild from a whitelist, like the unlock: no cost, payload or other field the client sent rides along.
      v_ev := jsonb_build_object('type', 'dmDiscount', 'targetSeq', v_target, 'targetCat', v_tcat,
                                 'amount', v_amount::integer, 'note', v_note,
                                 'label', left(coalesce(nullif(btrim(v_ev->>'label'), ''), 'DM discount — ' || v_amount::integer || ' AP'), 120));
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

drop function if exists public.pact_item_note_state(jsonb, text, text, text);
drop function if exists public.pact_js_trim(text);
