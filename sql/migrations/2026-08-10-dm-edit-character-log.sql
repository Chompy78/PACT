-- PACT — a DM adds/removes boons and drawbacks, recorded in the character's own LOG as a DM edit.
-- feat/dm-edit-events (D-GH-2026-08-10-dm-edit-events). Scope named by the owner: boons and drawbacks
-- only, not a general editor — see the type/cat allowlist below.
--
-- WHY A NEW RPC. characters_update's row policy (sql/rls-policies.sql) is owner-only in both USING and
-- WITH CHECK — a DM has no write path onto a player's `stats` column at all today, unlike `ap`
-- (award_ap()) or `campaign_id` (dm_unbind_character()). This is the same SECURITY DEFINER-bypass
-- pattern those two already use, extended to `stats`.
--
-- WHY THE SERVER STAMPS seq/ts/dmEdit/dmId, DISCARDING whatever the client sent for them: this is what
-- makes `dmEdit:true` a trustworthy marker for a DIFFERENT account's edit — the calling DM cannot forge
-- who made it, when, or where in the log it lands. (A character's OWNER already has direct column-level
-- UPDATE on their own `stats` via the ordinary player save path and could self-forge the same marker on
-- their own character regardless of this function — a pre-existing, unrelated capability, the same class
-- as hand-editing a local JSON export, and not something this RPC changes either way.)
--
-- WHY A JSON ARRAY, not one event per call: a DM-granted boon needs a MATCHED PAIR of events (a `buy`
-- at the boon's real cost, plus an `award` of the identical amount) appended in the SAME write to stay
-- net-neutral to spendable AP at every point in the log's history — not just at the end. Two separate
-- calls would leave a real, briefly-persisted moment where the character has spent more with nothing
-- earned to offset it.
--
-- COMPATIBILITY with the AP-integrity triggers (D-GH-2026-08-10-campaign-ap-log-integrity, already
-- live): pact_enforce_ap_budget_consistency sums spend/earn straight off event fields. A DM-granted
-- boon's buy+award pair moves both sums by the identical amount (net 0, never trips the "over budget"
-- check); a DM-imposed drawback is recorded at cost:0 (no sum movement at all); dmRemoveBoon is not
-- 'award'/'buy'/'buyoff'/'names' so it falls through that trigger's sum entirely, matching
-- js/engine.js's own _spendCost() treatment of it exactly (see js/engine.js's activeEvents()). Verified
-- by reading pact_ap_ledger_spend directly before writing this, not assumed.

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
    -- Scope allowlist: boons and drawbacks only (owner, 2026-08-05 — "not a general editor"). A
    -- 'buy' must be cat:'boon' or cat:'drawback'; 'award' only ever accompanies a boon buy in the
    -- same call (enforced client-side by always sending the pair together, not re-checked here since
    -- an award alone is exactly what award_ap() already permits a DM to do through its own path).
    if v_type = 'buy' then
      if v_cat is distinct from 'boon' and v_cat is distinct from 'drawback' then
        raise exception 'dm_edit_character_log: unsupported buy category %', v_cat;
      end if;
    elsif v_type not in ('award', 'dmRemoveBoon') then
      raise exception 'dm_edit_character_log: unsupported event type %', v_type;
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

grant execute on function public.dm_edit_character_log(uuid, jsonb) to authenticated;
revoke execute on function public.dm_edit_character_log(uuid, jsonb) from public;
