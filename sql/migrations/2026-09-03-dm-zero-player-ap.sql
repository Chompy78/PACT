-- PACT — a DM can zero a character's self-declared "Player AP", and once a campaign has
-- ignore_player_ap on, that figure can no longer be increased by anything but a DM.
-- feat/dm-zero-player-ap (D-GH-2026-09-03-dm-zero-player-ap).
--
-- BACKGROUND. "Player AP" (compute()'s playerAp / economy().earned's award half) is a totally
-- separate pool from the campaign's DM-awarded `characters.ap` — it lives inside the character's own
-- stats->LOG as one or more `award`-type events, and CharGen exposes it as a freely player-editable
-- "Budget" field (see js/engine.js's compute() header, "Player AP = b.budget — the character's own
-- `award` events; raw, player-owned"). A campaign can set `ignore_player_ap` to tell compute() to drop
-- that pool from the spendable ceiling everywhere it is READ — but nothing before this migration
-- stopped the underlying number from growing in the first place, and at least one live path (DM
-- Console's "Copy to CharGen" sandbox, feat/chargen-dm-view) does not even apply the read-side ignore,
-- so a DM inspecting a copy sees the raw, uncapped figure. Confirmed live 2026-09-03: three characters
-- in the Amble campaign (which already has ignore_player_ap=true) were carrying non-zero Player AP —
-- 127, 79 and 27 — despite the DM's intent that only their own awards count.
--
-- WHY A PURPOSE-BUILT RPC, not a wider dm_edit_character_log allowlist — same reasoning
-- 2026-09-01-dm-creation-ceiling.sql already gave for the same class of control: that function is
-- "deliberately not a general editor", and a single typed argument (here, none at all — the amount is
-- computed server-side, never trusted from the caller) needs no JSON validation and has no bound to
-- get wrong.
--
-- WHY THE COMPENSATING-EVENT SHAPE, not an in-place rewrite. `award`-type events are SUMMED by
-- economy()/_economyFrom() (js/engine.js) to get the player's earned total — they are not a
-- last-write-wins singleton at the engine level (CharGen's UI keeps only one at a time as its own
-- convention, "filter-out-and-append", but the engine doesn't require or enforce that). Every other
-- DM-log RPC in this project (dm_edit_character_log, dm_set_creation_ceiling, dm_reopen_creation) is
-- APPEND-ONLY — history is never moved or rewritten, only added to (pact_enforce_locked_history relies
-- on this). So zeroing means appending one more `award` whose amount is the exact negative of
-- whatever the log's award events currently sum to, computed fresh from the log itself (not from
-- anything the client claims), which brings the running sum to exactly 0 regardless of how many prior
-- award events exist or what CharGen's own singleton happens to say.
--
-- WHY THIS EVENT IS EXEMPT FROM THE NEW "CAN'T INCREASE" TRIGGER BELOW EVEN THOUGH IT SUMS INTO THE
-- SAME POOL: it is stamped dmEdit:true, exactly like every other DM-authored log event in this project,
-- and the new trigger's ceiling explicitly excludes dmEdit:true award events from the "player" sum it
-- protects — a DM's own corrections were never the thing being guarded against.
create or replace function public.dm_zero_player_ap(p_character uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign  uuid;
  v_stats     jsonb;
  v_log       jsonb;
  v_seq       integer;
  v_event     jsonb;
  v_ts        bigint := (extract(epoch from now()) * 1000)::bigint;
  v_player_ap numeric;
begin
  select campaign_id, stats into v_campaign, v_stats from characters where id = p_character for update;
  if not found then
    raise exception 'Character not found';
  end if;
  if v_campaign is null then
    raise exception 'Character is not in a campaign';
  end if;
  if not is_campaign_dm(v_campaign) then
    raise exception 'Only a campaign DM can zero player AP';
  end if;
  perform assert_campaign_active(v_campaign);
  if v_stats is null or not (v_stats ? 'LOG') then
    raise exception 'Character has no log';
  end if;

  v_log := coalesce(v_stats->'LOG', '[]'::jsonb);
  v_seq := coalesce((v_stats->>'SEQ')::integer, jsonb_array_length(v_log) + 1);

  -- Sum every existing 'award' event's amount, exactly as economy() does client-side — so the
  -- compensating entry below always lands on precisely 0, whatever the current total actually is.
  select coalesce(sum((e->>'amount')::numeric), 0) into v_player_ap
    from jsonb_array_elements(v_log) e
   where e->>'type' = 'award';

  if v_player_ap = 0 then
    raise exception 'Player AP is already 0';
  end if;

  v_event := jsonb_build_object(
    'seq', v_seq,
    'ts', v_ts,
    'type', 'award',
    'amount', -v_player_ap,
    'note', 'Zeroed by DM',
    'dmEdit', true,
    'dmId', auth.uid(),
    'label', 'Player AP zeroed by DM (was ' || v_player_ap || ' AP)'
  );

  update characters
     set stats = jsonb_set(jsonb_set(v_stats, '{LOG}', v_log || v_event),
                           '{SEQ}', to_jsonb(v_seq + 1))
   where id = p_character;

  return v_event;
end;
$$;

revoke all on function public.dm_zero_player_ap(uuid) from public, anon;
grant execute on function public.dm_zero_player_ap(uuid) to authenticated;

comment on function public.dm_zero_player_ap(uuid) is
  'DM-only: append a compensating award (dmEdit:true) that brings a campaign character''s own award-event sum (Player AP) to exactly 0. Append-only — never rewrites or removes the prior award events.';

-- ---------------------------------------------------------------------------------------------------
-- pact_enforce_player_ap_ceiling — once a campaign has ignore_player_ap on, a character's own
-- (non-DM-attributed) award-event sum can no longer be raised by anything but a DM.
--
-- Deliberately separate from pact_enforce_ap_budget_consistency (2026-08-10-campaign-ap-log-integrity),
-- which already reads ignore_player_ap but only to decide what counts toward the SPEND ceiling — it
-- never stopped the underlying player-award figure from growing, only from being spent. This trigger
-- guards the figure itself, so a display path that forgets to apply ignore_player_ap (as
-- "Copy to CharGen" does today, by documented design) can no longer be handed a bigger number than the
-- DM actually intended, because the number in the database cannot have grown behind the DM's back.
--
-- SCOPE, deliberately narrow: only 'award'-type events NOT stamped dmEdit:true are summed — a DM's own
-- corrections (dm_zero_player_ap above, or a boon grant's matched award/buy pair from
-- dm_edit_character_log) are excluded from both sides of the comparison, exactly as intended; only the
-- player's OWN pool is ever capped.
--
-- KNOWN LIMIT, same one already documented on dm_edit_character_log's dmEdit marker: a character's
-- OWNER already has direct column-level UPDATE on their own `stats` (characters_update's row policy)
-- and could in principle hand-craft a fake dmEdit:true on their own row to slip past this check — the
-- same pre-existing, accepted class of risk as hand-editing a local JSON export, not something this
-- trigger is meant to close. What it does close is the ordinary path: CharGen's own Budget field,
-- and any tool that reads/writes the log the normal way.
create or replace function public.pact_enforce_player_ap_ceiling()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign  public.campaigns%rowtype;
  v_old_award numeric;
  v_new_award numeric;
begin
  if NEW.campaign_id is null then
    return NEW;
  end if;
  if NEW.stats is not distinct from OLD.stats then
    return NEW;
  end if;

  select * into v_campaign from public.campaigns where id = NEW.campaign_id;
  if not found or not v_campaign.ignore_player_ap then
    return NEW;  -- fail open, matching pact_enforce_ap_budget_consistency's own dangling-campaign case
  end if;

  select coalesce(sum((e->>'amount')::numeric), 0) into v_old_award
    from jsonb_array_elements(coalesce(OLD.stats->'LOG', '[]'::jsonb)) e
   where e->>'type' = 'award' and not coalesce((e->>'dmEdit')::boolean, false);
  select coalesce(sum((e->>'amount')::numeric), 0) into v_new_award
    from jsonb_array_elements(coalesce(NEW.stats->'LOG', '[]'::jsonb)) e
   where e->>'type' = 'award' and not coalesce((e->>'dmEdit')::boolean, false);

  if v_new_award > v_old_award then
    raise exception
      'PACT: this campaign''s DM has switched off player-entered AP — it can no longer be increased (ask your DM to raise it instead)';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_pact_player_ap_ceiling on public.characters;
create trigger trg_pact_player_ap_ceiling
  before update on public.characters
  for each row execute function public.pact_enforce_player_ap_ceiling();

grant execute on function public.pact_enforce_player_ap_ceiling() to authenticated;
revoke execute on function public.pact_enforce_player_ap_ceiling() from public;
