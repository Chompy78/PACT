-- ---------------------------------------------------------------------------
-- feat/dm-house-rules-editor (D-GH-2026-10-12-dm-house-rules-editor)
-- A campaign DM can change ONE character's house rules (DM Calls: Bound / Boons / Drawbacks / Non-core, and
-- custom or repriced boons and drawbacks) through the existing audited DM write path.
--
-- *** NOT APPLIED to production. *** Merging this file does not apply it. The owner applies it, then runs
-- get_advisors (security + performance) and skims get_logs, per AGENTS.md. Until it is applied, DM Console's
-- "Save house rules" control is refused by the server and tells the DM so in plain words (it feature-detects
-- the "unsupported buy category patch" refusal); nothing else changes.
--
-- WHY. Since fix/player-free-ap (#638, 2026-10-12) a player can no longer edit a server-confirmed campaign
-- character's houseRules (they are priced: compute() reads b.houseRules for custom/repriced boons and
-- drawbacks). Nobody else could either: DM Console's campaign "house rules" are free-text labels that never
-- reach a character. dm_edit_character_log() is the only path a DM has into a player's stats->LOG.
--
-- WHAT THIS CHANGES — one function, nothing else:
--   dm_edit_character_log(): accepts buy/cat:'patch' when, and only when, payload.patch has exactly one key,
--   houseRules, of the shape CharGen writes ({boons:{name:{hd,ap,fx}}, draws:{name:{ap,fx}},
--   disabled:{boons:[],draws:[]}, dmAllows:{bound,boons,drawbacks,tasha}}). The event is rebuilt from a
--   whitelist (type, cat, payload, label, level, and cost FORCED to 0) and stamped seq/ts/dmEdit/dmId like
--   every other DM edit. Every other behaviour is unchanged (see the [HOUSE] comments).
--
-- WHAT IT DELIBERATELY LEAVES ALONE
--   * pact_ap_ledger_spend(): patch costs are outside the server budget sum by design, and this one is 0 anyway.
--     A change to a HELD drawback's AP does change compute()'s spendable (the grant is derived from the
--     drawback's current value); DM Console shows the AP-left change before sending and refuses one that would
--     leave the character below 0 AP left.
--   * pact_ap_ledger_protected() / pact_patch_exempt_keys(): houseRules stays in the exempt list, so a
--     houseRules-only patch has no protected projection and pact_enforce_locked_history() lets it be appended
--     after a lock, seal or award. Dropping houseRules from the exempt list (so the PLAYER can no longer
--     rewrite it after a lock, server-side) is the separate follow-up recorded on feat/server-freeze-at-lock;
--     it would not refuse these DM events, which are appended, not rewritten.
--   * pact_enforce_creation_lock(): a campaign DM is already exempt.
--   * Every GRANT/REVOKE: `create or replace` keeps them.
--
-- BLAST RADIUS. Additive: it only ACCEPTS a call shape the current function refuses. No existing write is
-- refused by it, so no live character is affected until a DM uses the new control.
--
-- BASE OF THIS DEFINITION. Generated on 2026-10-12 from sql/rls-policies.sql, whose copy of this function the
-- 2026-10-04 dm-unlock-drawback migration header records as hash-equal to production. RE-VERIFY against
-- production immediately before applying (sql/migrations/README.md) and check these guards survive:
--   select p.prosrc like '%assert_campaign_active%' as guard_archived,
--          p.prosrc like '%has no matching award%'  as guard_boon_award,
--          p.prosrc like '%sessionSeal%'            as seal_allowed,
--          p.prosrc like '%dmUnlockDrawback%'       as unlock_kept,
--          p.prosrc like '%[HOUSE]%'                as house_added
--     from pg_proc p where p.proname = 'dm_edit_character_log';          -- all true
--   select has_function_privilege('authenticated', 'public.dm_edit_character_log(uuid,jsonb)', 'execute');  -- true
--   select has_function_privilege('anon',          'public.dm_edit_character_log(uuid,jsonb)', 'execute');  -- false
-- AFTER APPLYING: fold this definition into sql/rls-policies.sql (README step 2) and add this file to the \ir
-- lists in testing/sql/session-seal-test.sql and rls-baseline-test.sql.
--
-- TESTED: testing/sql/dm-house-rules-test.sql (fresh install -> old function refuses -> this migration ->
-- cases -> rollback restores the old body byte-for-byte).
-- ROLLBACK: sql/migrations/2026-10-12-dm-house-rules-edit-rollback.sql.
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
  -- feat/dm-house-rules-editor (D-GH-2026-10-12-dm-house-rules-editor): scratch for validating a house-rules patch.
  v_patch      jsonb;
  v_hr         jsonb;
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
      -- [HOUSE] 'patch' added by 2026-10-12-dm-house-rules-edit.sql — and ONLY a patch carrying houseRules
      -- and nothing else (validated and rebuilt below). Every other patch field stays the player's.
      if v_cat is distinct from 'boon' and v_cat is distinct from 'drawback' and v_cat is distinct from 'patch' then
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

    -- [HOUSE] A DM's house-rule change for THIS character: a patch event whose ONLY field is houseRules,
    -- APPENDED (never a rewrite of the player's own house-rules event; js/engine.js folds patches in log
    -- order, so the last houseRules wins). Its frozen ledger `cost` is ALWAYS 0, whatever the client sent: a rules
    -- change is not a purchase, so it neither refunds what a boon cost when it was bought nor charges for one
    -- already owned (D-GH30: what was paid is what was paid). That keeps the dm-edit invariant that a DM edit
    -- line never moves the player's frozen ledger. (compute() still prices FUTURE purchases, and a held drawback,
    -- at the new numbers.) A houseRules-only patch has no protected projection, so no trigger needs a change.
    -- The numeric checks below use CASE, not OR, and every jsonb_each/_object_keys gets an object: SQL does not
    -- promise left-to-right evaluation, and a cast or type error would abort with a raw error instead of a clean
    -- refusal (the same reasoning as the [UNLOCK] block's jsonb equality).
    -- The shape is checked strictly and the event is REBUILT from a whitelist: nothing else may ride along.
    if v_type = 'buy' and v_cat = 'patch' then
      v_patch := v_ev->'payload'->'patch';
      if jsonb_typeof(v_patch) is distinct from 'object'
         or (select array_agg(k order by k) from jsonb_object_keys(case when jsonb_typeof(v_patch) = 'object' then v_patch else '{}'::jsonb end) as k) is distinct from array['houseRules'] then
        raise exception 'dm_edit_character_log: a DM patch may carry houseRules and nothing else';
      end if;
      v_hr := v_patch->'houseRules';
      if jsonb_typeof(v_hr) is distinct from 'object' then
        raise exception 'dm_edit_character_log: houseRules must be an object';
      end if;
      if octet_length(v_hr::text) > 32768 then
        raise exception 'dm_edit_character_log: houseRules is too large';
      end if;
      if exists (select 1 from jsonb_object_keys(v_hr) as k where k not in ('boons', 'draws', 'disabled', 'dmAllows')) then
        raise exception 'dm_edit_character_log: houseRules has an unknown field';
      end if;
      if v_hr ? 'dmAllows' and (jsonb_typeof(v_hr->'dmAllows') is distinct from 'object'
         or exists (select 1 from jsonb_each(case when jsonb_typeof(v_hr->'dmAllows') = 'object' then v_hr->'dmAllows' else '{}'::jsonb end) as d
                     where d.key not in ('bound', 'boons', 'drawbacks', 'tasha') or jsonb_typeof(d.value) <> 'boolean')) then
        raise exception 'dm_edit_character_log: houseRules.dmAllows must map bound/boons/drawbacks/tasha to true or false';
      end if;
      if v_hr ? 'boons' and (jsonb_typeof(v_hr->'boons') is distinct from 'object'
         or exists (select 1 from jsonb_each(case when jsonb_typeof(v_hr->'boons') = 'object' then v_hr->'boons' else '{}'::jsonb end) as d
                     where btrim(d.key) = '' or char_length(d.key) > 80 or jsonb_typeof(d.value) <> 'object'
                        or (case when jsonb_typeof(d.value->'ap') = 'number' then abs((d.value->>'ap')::numeric) > 1000 else true end)
                        or (case when jsonb_typeof(d.value->'hd') = 'number' then (d.value->>'hd')::numeric not between 1 and 20 else true end)
                        or (d.value ? 'fx' and (jsonb_typeof(d.value->'fx') <> 'string' or char_length(d.value->>'fx') > 500))
                        or exists (select 1 from jsonb_object_keys(case when jsonb_typeof(d.value) = 'object' then d.value else '{}'::jsonb end) as f where f not in ('hd', 'ap', 'fx')))) then
        raise exception 'dm_edit_character_log: each houseRules boon needs a name, hd 1-20, ap within 1000 and an optional short fx';
      end if;
      if v_hr ? 'draws' and (jsonb_typeof(v_hr->'draws') is distinct from 'object'
         or exists (select 1 from jsonb_each(case when jsonb_typeof(v_hr->'draws') = 'object' then v_hr->'draws' else '{}'::jsonb end) as d
                     where btrim(d.key) = '' or char_length(d.key) > 80 or jsonb_typeof(d.value) <> 'object'
                        or (case when jsonb_typeof(d.value->'ap') = 'number' then abs((d.value->>'ap')::numeric) > 1000 else true end)
                        or (d.value ? 'fx' and (jsonb_typeof(d.value->'fx') <> 'string' or char_length(d.value->>'fx') > 500))
                        or exists (select 1 from jsonb_object_keys(case when jsonb_typeof(d.value) = 'object' then d.value else '{}'::jsonb end) as f where f not in ('ap', 'fx')))) then
        raise exception 'dm_edit_character_log: each houseRules drawback needs a name, ap within 1000 and an optional short fx';
      end if;
      if v_hr ? 'disabled' and (jsonb_typeof(v_hr->'disabled') is distinct from 'object'
         or exists (select 1 from jsonb_each(case when jsonb_typeof(v_hr->'disabled') = 'object' then v_hr->'disabled' else '{}'::jsonb end) as d
                     where d.key not in ('boons', 'draws') or jsonb_typeof(d.value) <> 'array'
                        or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(d.value) = 'array' then d.value else '[]'::jsonb end) as x
                                    where jsonb_typeof(x) <> 'string' or char_length(x #>> '{}') > 80))) then
        raise exception 'dm_edit_character_log: houseRules.disabled must hold boons/draws lists of names';
      end if;
      v_ev := jsonb_build_object('type', 'buy', 'cat', 'patch',
                                 'payload', jsonb_build_object('patch', jsonb_build_object('houseRules', v_hr)),
                                 'cost', 0,
                                 'label', left(coalesce(nullif(btrim(v_ev->>'label'), ''), 'DM house rules'), 120))
           || case when jsonb_typeof(v_ev->'level') = 'number' then jsonb_build_object('level', v_ev->'level')
                   else '{}'::jsonb end;
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
