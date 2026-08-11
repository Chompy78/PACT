-- fix/dm-edit-boon-amount-check (D-GH-2026-08-10-dm-edit-boon-amount-check).
-- Found by /code-review ultra on PR #403 — see decisions/2026/D-GH-2026-08-10-dm-edit-events.md's
-- "Addendum (2026-08-10, pre-merge review)".
--
-- dm_edit_character_log (sql/migrations/2026-08-10-dm-edit-character-log.sql) checked event
-- type/cat only — it never verified a paired 'buy'/cat:'boon' event's cost equals its accompanying
-- 'award' event's amount. That migration's own header comment ("moves both sums by the identical
-- amount (net 0...)") and DM Console's grant-boon tooltip both promise the operation is net-0 to
-- spendable AP, but that promise was enforced only by DM Console's client always sending the pair
-- together — nothing server-side stopped a caller from sending a mismatched pair.
--
-- Decision (Step 1 of the task, re-verified before writing this, not assumed): a BARE award through
-- this RPC is NOT a new privilege escalation. award_ap() already lets any campaign DM grant arbitrary
-- AP through a separate, existing, unrestricted path (no cap, no matching-cost requirement) — a bare
-- award here is just a second route to a capability the DM already unconditionally has. So this fix
-- does NOT reject a standalone award with no matching boon-buy; it only closes the correctness gap —
-- a boon-buy whose accompanying award doesn't actually match its cost (or is missing entirely) — which
-- is worth fixing for defense-in-depth even though it isn't a security hole, since a client bug (not
-- necessarily a malicious caller) could otherwise silently violate the documented net-0 invariant the
-- AP-integrity triggers (feat/campaign-ap-log-integrity) partly rely on.
--
-- FIFO-by-VALUE, not by-name: an 'award' event carries only an amount, no reference to which buy it
-- pays for (unlike 'buyoff'/'dmRemoveBoon', which carry refVal) — mirrors js/engine.js's activeEvents()
-- boughtOff/boonRemoved reasoning for why value-keyed FIFO (not a single shared flag) is required the
-- moment a batch could ever hold more than one boon grant. Today's only real caller (DM Console) always
-- sends exactly one [buy, award] pair per call, but the RPC itself places no such limit on p_events.

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
    elsif v_type not in ('award', 'dmRemoveBoon') then
      raise exception 'dm_edit_character_log: unsupported event type %', v_type;
    end if;
    if v_type = 'award' then
      v_award_amts := v_award_amts || coalesce((v_ev->>'amount')::numeric, 0);
    end if;

    v_ev := (v_ev - 'seq' - 'ts' - 'dmEdit' - 'dmId')
      || jsonb_build_object('seq', v_seq, 'ts', v_ts, 'dmEdit', true, 'dmId', auth.uid());
    v_new := v_new || jsonb_build_array(v_ev);
    v_seq := v_seq + 1;
  end loop;

  -- Every boon-grant buy must be matched, FIFO-by-value, to a same-call award of the identical amount —
  -- checked AFTER the loop above (once both arrays are fully collected) but BEFORE the write below, so a
  -- rejected batch never partially applies.
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

revoke execute on function public.dm_edit_character_log(uuid, jsonb) from public;
grant execute on function public.dm_edit_character_log(uuid, jsonb) to authenticated;
