-- PACT — moving a character between campaigns clears its creation lock and ceiling.
-- feat/campaign-move-clears-creation. Owner decision, 2026-09-01: "when a character leaves or joins a
-- campaign, the locks go" — both the finished-creation lock AND the DM's ceiling figure.
--
-- WHY: a creation ceiling is one DM's ruling about one character at one table. Carrying it to a
-- different table would let a number nobody there chose silently govern that character, and carrying a
-- finished-creation lock would mean a character arrives at a new campaign already past creation, priced
-- as in-play, with no way for the new DM to see why. A character leaving a campaign has no DM at all,
-- so nothing should be enforced for it — which is exactly the fail-open rule creationCeiling() already
-- applies to every local character.
--
-- This is the question three independent cold reviewers raised against
-- docs/plans/2026-08-30-creation-ceiling.md and which the plan carried as unresolved.
--
-- WHY A TRIGGER AND NOT A CHANGE TO THE JOIN/LEAVE RPCs. Characters reach and leave a campaign by
-- several paths — bind_character_to_campaign(), dm_unbind_character(), redeem_player_invite(),
-- redeem_character_claim(), and any direct owner update RLS allows. Patching each means finding them
-- all today and remembering them forever; a future path added without this in mind would silently keep
-- the old behaviour. That is precisely the hand-written-mirror drift this project keeps paying for
-- (see the round-6 note in docs/sessions/2026-08-27-feature-hd-gate.md). One trigger on the column
-- itself cannot be bypassed by adding a new caller.
--
-- APPEND-ONLY, and it needs no engine change: js/engine.js already reads a creationLockConfig whose
-- `threshold` is null as "no ceiling set" (creationCeiling().enforced goes false), and resolves
-- creationUnlocked against creationLocked last-write-wins. Verified against the engine before writing
-- this. Nothing is rewritten or removed, so history stays intact and the events remain auditable — a
-- reader can see exactly when and why the ceiling went.
--
-- Trigger ordering: BEFORE triggers fire alphabetically, so this runs after
-- trg_pact_ap_budget_consistency and before trg_pact_locked_history. Both are satisfied by an append —
-- the budget check only raises when spend INCREASES (these events carry no cost), and the history
-- check protects the log PREFIX up to the last award, which an append never touches.

create or replace function public.pact_campaign_move_clears_creation()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_log jsonb;
  v_seq integer;
  v_ts  bigint := (extract(epoch from now()) * 1000)::bigint;
  v_note text;
begin
  -- Only when the character actually moves. Covers join (null -> id), leave (id -> null) and transfer
  -- (id -> other id) in one test.
  if NEW.campaign_id is not distinct from OLD.campaign_id then
    return NEW;
  end if;
  if NEW.stats is null or not (NEW.stats ? 'LOG') then
    return NEW;
  end if;

  v_log := coalesce(NEW.stats->'LOG', '[]'::jsonb);
  v_seq := coalesce((NEW.stats->>'SEQ')::integer, jsonb_array_length(v_log) + 1);

  v_note := case
    when OLD.campaign_id is null then 'joined a campaign'
    when NEW.campaign_id is null then 'left the campaign'
    else 'moved to a different campaign'
  end;

  -- Clear the ceiling: a threshold of null reads as "no ceiling set".
  v_log := v_log || jsonb_build_object(
    'seq', v_seq, 'ts', v_ts,
    'type', 'creationLockConfig',
    'payload', jsonb_build_object('threshold', null),
    'systemEdit', true,
    'label', 'Creation limit cleared — ' || v_note
  );
  v_seq := v_seq + 1;

  -- Clear the lock: back into creation, with the new table free to decide.
  v_log := v_log || jsonb_build_object(
    'seq', v_seq, 'ts', v_ts,
    'type', 'creationUnlocked',
    'systemEdit', true,
    'label', 'Creation reopened — ' || v_note
  );
  v_seq := v_seq + 1;

  NEW.stats := jsonb_set(jsonb_set(NEW.stats, '{LOG}', v_log), '{SEQ}', to_jsonb(v_seq));
  return NEW;
end;
$$;

drop trigger if exists trg_pact_campaign_move_clears_creation on public.characters;
create trigger trg_pact_campaign_move_clears_creation
  before update on public.characters
  for each row execute function public.pact_campaign_move_clears_creation();

comment on function public.pact_campaign_move_clears_creation() is
  'Appends creationLockConfig{threshold:null} + creationUnlocked whenever characters.campaign_id changes, so a creation ceiling and finished-creation lock never follow a character to a table that did not set them. Append-only; needs no engine change.';

-- ---------------------------------------------------------------------------------------------------
-- Added immediately after the Supabase advisor flagged it: a trigger function must never be callable
-- as an RPC. Postgres grants EXECUTE on a new function to PUBLIC by default, which PostgREST exposes
-- at /rest/v1/rpc/<name> to anon and authenticated alike — and the advisor reported
-- `anon_security_definer_function_executable`, a finding class this project did not previously have
-- (every other SECURITY DEFINER function here is a deliberate RPC, and none was anon-callable).
--
-- Calling it directly would fail anyway for want of OLD/NEW trigger context, but "it would error" is
-- not a security argument for leaving a SECURITY DEFINER function exposed.
--
-- Verified after revoking: anon and authenticated both false (matching snapshot_character, the other
-- properly-restricted trigger function here), and the trigger still fires — triggers execute as the
-- table owner, so an RPC-level revoke does not affect them.
revoke all on function public.pact_campaign_move_clears_creation() from public, anon, authenticated;
