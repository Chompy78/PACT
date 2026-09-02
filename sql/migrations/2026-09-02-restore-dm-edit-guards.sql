-- ---------------------------------------------------------------------------
-- Restore two guards that 2026-09-01-session-seal.sql silently DELETED from
-- dm_edit_character_log(), while keeping that migration's sessionSeal support.
--
-- WHAT WENT WRONG. The session-seal migration needed to add 'sessionSeal' to this
-- function's allow-list. Rather than editing the LIVE definition, it was rebuilt from
-- sql/migrations/2026-08-10-dm-edit-character-log.sql and carried a header claiming
-- "every other line is unchanged from 2026-08-10". That claim was true and that is
-- precisely the defect: 2026-08-10 had stopped being the live definition three weeks
-- earlier. Two later changes were reverted by the rewrite --
--
--   1. `perform assert_campaign_active(v_campaign);`
--      Added by 2026-08-22-archived-campaign-write-lockdown.sql section 7
--      (D-GH-2026-08-22-archived-campaign-rpc-enforcement). Without it a DM can edit
--      characters in an ARCHIVED, read-only campaign.
--
--   2. The boon/award FIFO amount-matching block, and its six declarations.
--      Added by 2026-08-10-dm-edit-boon-amount-check.sql
--      (D-GH-2026-08-10-dm-edit-boon-amount-check), itself found by /code-review ultra
--      on PR #403. Without it a boon grant need not be paid for at all: a call carrying
--      {"type":"buy","cat":"boon","cost":12} and no matching award writes straight
--      through, breaking the "net 0 to spendable AP" invariant this function promises.
--
-- Both were confirmed ABSENT from the live database before writing this file:
--   select prosrc like '%assert_campaign_active%', prosrc like '%has no matching award%'
--     from pg_proc where proname='dm_edit_character_log';  -- => false, false
--
-- THE BASE FOR THIS FILE is sql/rls-policies.sql's definition (the maintained baseline),
-- NOT any dated migration. The only deltas from it are the two session-seal lines, both
-- marked [SEAL] below. Verify after applying that all three are present.
--
-- Note for whoever rolls the seal back: 2026-09-01-session-seal-rollback.sql step 4 tells
-- you to re-apply 2026-08-10-dm-edit-character-log.sql. Do NOT. That is the same stale file
-- and following it re-opens both holes. Restore from sql/rls-policies.sql instead.
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

-- ---------------------------------------------------------------------------
-- Same class of bug, same file: award_ap_and_seal()'s idempotency probe was not race-safe.
-- Its authorisation SELECT took no row lock, so two concurrent calls sharing one p_idem could
-- both pass the "already sealed with this key?" probe and both call award_ap() -- double AP,
-- which the function's own header calls "the one outcome here that materially damages a
-- character". seal_character_history() already does this correctly (`for update` before its
-- own idem read); this makes award_ap_and_seal() match.
--
-- BASED ON THE LIVE BODY (read back from pg_proc), not on the migration file -- that is the
-- mistake this whole migration exists to repair. The ONLY change is `for update` on the first
-- select. Signature is the live 4-argument form; do not add arguments here.
-- ---------------------------------------------------------------------------
create or replace function public.award_ap_and_seal(
  p_character uuid, p_amount integer, p_note text, p_idem text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ap integer; v_seal jsonb; v_campaign uuid; v_owner uuid;
begin
  -- AUTHORISE FIRST, before the replay shortcut can return anything.
  -- `for update` added 2026-09-02: serialises concurrent calls sharing one p_idem so the replay
  -- probe below cannot be passed twice and award_ap() run twice.
  select campaign_id, owner_id into v_campaign, v_owner from characters where id = p_character for update;
  if not found then raise exception 'Character not found'; end if;
  if v_campaign is not null then
    if not is_campaign_dm(v_campaign) then
      raise exception 'Only a campaign DM can award AP and seal this character';
    end if;
  elsif v_owner is distinct from auth.uid() then
    raise exception 'Only the owner can seal a character that is not in a campaign';
  end if;

  if p_idem is not null then
    select ev into v_seal
      from characters c, jsonb_array_elements(coalesce(c.stats->'LOG', '[]'::jsonb)) as t(ev)
     where c.id = p_character and t.ev->>'type' = 'sessionSeal' and t.ev->>'idem' = p_idem limit 1;
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
