-- PACT — a DM sets a character's creation ceiling, and reopens creation.
-- feat/dm-creation-ceiling-controls.
--
-- WHY TWO PURPOSE-BUILT RPCs AND NOT A WIDER dm_edit_character_log ALLOWLIST.
-- The obvious route was to add 'creationLockConfig' to that function's allowlist. Both cold reviewers
-- of docs/plans/2026-08-30-creation-ceiling.md independently argued against it, and they were right:
--   * that function's own header states it is "deliberately not a general editor", scoped by owner
--     instruction. Once the answer to "can we add one more type?" is yes, it is precedent — that is
--     how allowlists become general editors;
--   * validating a JSON key-set in plpgsql is easy to get subtly wrong. A permissive "payload contains
--     threshold" test silently accepts {threshold, auto}, which would let a DM disarm the mechanism
--     while appearing to set a number;
--   * nothing there bounds a VALUE. A threshold of 0 would strand a player with no purchase possible
--     and — until dm_reopen_creation below existed — no way out.
-- Two functions each taking one typed argument have none of those problems: there is no JSON to
-- validate, the range check is a plain integer comparison, and dm_edit_character_log is untouched, so
-- its "not a general editor" property stays literally true rather than true-by-promise.
--
-- BOTH ARE APPEND-ONLY. A creationLockConfig must never be moved or rewritten: replay resolves it
-- last-write-wins in log order, so relocating one applies it retroactively and can un-trip a lock that
-- already fired (the D4 rule in the tools). These functions only ever append at the end.
--
-- The existing BEFORE UPDATE triggers are satisfied by construction:
--   * pact_enforce_locked_history protects the log PREFIX up to the last real award; an append never
--     touches it.
--   * pact_enforce_ap_budget_consistency only raises when spend INCREASES past what is spendable;
--     neither event carries a cost, so spend is unchanged.
--   * trg_characters_snapshot still writes a row to character_backups first, so both are reversible.

-- ---------------------------------------------------------------------------------------------------
-- dm_set_creation_ceiling — stamp (or re-stamp) the DM's creation-AP figure for one character.
--
-- The stored number is the DM's figure ALONE. The character's drawback grant is added live at display
-- time by the engine's creationCeiling(), never baked in here, because a drawback taken mid-build must
-- hand back the room it paid for (owner decision G2). Baking it in would freeze that too.
create or replace function public.dm_set_creation_ceiling(p_character uuid, p_threshold integer)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign uuid;
  v_stats    jsonb;
  v_log      jsonb;
  v_seq      integer;
  v_event    jsonb;
  v_ts       bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  -- Range check. The upper bound is deliberately generous (a high-level starting character legitimately
  -- has a large creation budget) — it exists to catch a fat-fingered 7400, not to express a rules cap.
  if p_threshold is null or p_threshold < 1 or p_threshold > 2000 then
    raise exception 'Creation ceiling must be between 1 and 2000 AP (got %)', p_threshold;
  end if;

  select campaign_id, stats into v_campaign, v_stats from characters where id = p_character for update;
  if not found then
    raise exception 'Character not found';
  end if;
  if v_campaign is null then
    raise exception 'Character is not in a campaign';
  end if;
  if not is_campaign_dm(v_campaign) then
    raise exception 'Only a campaign DM can set a creation ceiling';
  end if;
  if v_stats is null or not (v_stats ? 'LOG') then
    raise exception 'Character has no log';
  end if;

  v_log := coalesce(v_stats->'LOG', '[]'::jsonb);
  v_seq := coalesce((v_stats->>'SEQ')::integer, jsonb_array_length(v_log) + 1);

  -- payload carries ONLY 'threshold'. Never 'auto': arming/disarming the retired automatic lock is not
  -- something this control is for, and accepting it here would hand a DM a switch with no UI and no
  -- meaning since feat/creation-ceiling retired that mechanism.
  v_event := jsonb_build_object(
    'seq', v_seq,
    'ts', v_ts,
    'type', 'creationLockConfig',
    'payload', jsonb_build_object('threshold', p_threshold),
    'dmEdit', true,
    'dmId', auth.uid(),
    'label', 'Creation limit set by DM — ' || p_threshold || ' AP (+ drawbacks)'
  );

  update characters
     set stats = jsonb_set(jsonb_set(v_stats, '{LOG}', v_log || v_event),
                           '{SEQ}', to_jsonb(v_seq + 1))
   where id = p_character;

  return v_event;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- dm_reopen_creation — clear a lock, putting the character back into creation.
--
-- Appends creationUnlocked, which the engine resolves last-write-wins against creationLocked in log
-- order. Future-only by design: purchases already made keep the prices they were frozen at. This is the
-- undo for a lock that should not have fired — four live characters were locked by the automatic
-- tripwire that feat/creation-ceiling retired, against a default figure none of them owned.
create or replace function public.dm_reopen_creation(p_character uuid, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign uuid;
  v_stats    jsonb;
  v_log      jsonb;
  v_seq      integer;
  v_event    jsonb;
  v_ts       bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  select campaign_id, stats into v_campaign, v_stats from characters where id = p_character for update;
  if not found then
    raise exception 'Character not found';
  end if;
  if v_campaign is null then
    raise exception 'Character is not in a campaign';
  end if;
  if not is_campaign_dm(v_campaign) then
    raise exception 'Only a campaign DM can reopen creation';
  end if;
  if v_stats is null or not (v_stats ? 'LOG') then
    raise exception 'Character has no log';
  end if;

  v_log := coalesce(v_stats->'LOG', '[]'::jsonb);
  v_seq := coalesce((v_stats->>'SEQ')::integer, jsonb_array_length(v_log) + 1);

  v_event := jsonb_build_object(
    'seq', v_seq,
    'ts', v_ts,
    'type', 'creationUnlocked',
    'dmEdit', true,
    'dmId', auth.uid(),
    'label', coalesce(nullif(btrim(p_note), ''), 'Creation reopened by DM')
  );

  update characters
     set stats = jsonb_set(jsonb_set(v_stats, '{LOG}', v_log || v_event),
                           '{SEQ}', to_jsonb(v_seq + 1))
   where id = p_character;

  return v_event;
end;
$$;

revoke all on function public.dm_set_creation_ceiling(uuid, integer) from public, anon;
revoke all on function public.dm_reopen_creation(uuid, text)        from public, anon;
grant execute on function public.dm_set_creation_ceiling(uuid, integer) to authenticated;
grant execute on function public.dm_reopen_creation(uuid, text)        to authenticated;

comment on function public.dm_set_creation_ceiling(uuid, integer) is
  'DM-only: append creationLockConfig{threshold} to a campaign character''s log. Append-only; payload carries threshold and nothing else. The drawback half of the ceiling is added live by the engine, never stored here.';
comment on function public.dm_reopen_creation(uuid, text) is
  'DM-only: append creationUnlocked to a campaign character''s log, putting it back into creation. Future-only — purchases already made keep their frozen prices.';
