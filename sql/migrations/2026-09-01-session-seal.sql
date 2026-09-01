-- PACT — session seal: a deliberately-drawn line under a character's history.
-- feat/session-seal Phase 1 (D-GH-2026-09-01-session-seal). Plan + three cold reviews:
-- docs/plans/2026-09-01-session-seal-cold-review.md
--
-- THE INVARIANT, in one sentence:
--   Once a `sessionSeal` event is in a character's LOG, no write may alter the events at or before
--   it. Anything may still be appended after it.
--
-- WHY THAT ONE SENTENCE IS THE WHOLE DESIGN. The owner's three rulings each looked like they needed
-- their own exception, and none of them does:
--   * A DM may still correct a mistake after a seal (owner J1) — corrections APPEND.
--   * Name/appearance/backstory stay editable after a seal (owner K3) — under a seal those edits
--     append instead of replacing, and the engine replays both as last-wins assignment, so a later
--     event supersedes an earlier one with the sealed prefix untouched.
--   * A solo player may seal their own character as well as a DM sealing a campaign one (owner I2) —
--     the invariant says nothing about WHO sealed, so the same rule covers both.
-- No per-event-type exception list, no author test. That is what makes a single trigger sufficient.
--
-- WHY A TRIGGER AND NOT A CHECK INSIDE ONE FUNCTION. Three cold reviewers independently made the
-- same point: `js/sync.js` already carries optimistic concurrency (a compare-and-swap on
-- `updated_at`), but the predicate lives in the CLIENT'S query, so any write path that omits it is
-- unprotected — and there are more such paths than anyone had enumerated (CharGen's mid-log splice
-- and two filter-and-append paths, the Live Sheet's Import, every whole-build rebuild). That guard
-- has already failed once in production: 2026-08-07, a character went 43 AP spent -> 47 -> back to
-- 43 across two browser profiles WITH the guard active (docs/HOW-TO-WORK.md). A BEFORE UPDATE
-- trigger covers every path that exists, including the ones nobody has written yet.
--
-- WHY IT ENFORCES `sessionSeal` ONLY, AND NOT EVERY UNDO BARRIER. This is the load-bearing safety
-- decision for a live database holding 25 real characters. `js/engine.js`'s undoFloor() also treats
-- `dmEdit`, non-discretionary `award` and `creationLocked` as barriers. Enforcing those here would
-- break every existing character on its next save: editing a name or an appearance field currently
-- filters the old event out of the log from wherever it sits, and on any character carrying an
-- `award` event — which is all of them — that legitimately rewrites history sitting behind a
-- barrier. Harmless today, because those barriers are only ever consulted by undo. Enforced here, an
-- ordinary rename would become a hard save failure.
--
-- Restricting enforcement to `sessionSeal` makes this migration non-retroactive BY CONSTRUCTION: no
-- character has a seal until somebody deliberately adds one, so nothing that works today can begin
-- to fail. That is a stronger guarantee than "the migration does not write any seals", which is also
-- true but would not by itself stop existing saves breaking.
--
-- DEPLOYMENT ORDER MATTERS. Apply this migration BEFORE the Phase 2 tool changes ship, but do not
-- surface any seal control to users until Phase 2 is live. Between the two, a sealed character
-- opened in CharGen and saved would be REJECTED by the trigger rather than silently corrupted —
-- correct, but a hard error with no explanatory UI. Phase 1 alone is safe to deploy precisely
-- because nothing can create a seal through the UI yet.

-- ---------------------------------------------------------------------------
-- 1. The floor: how many leading events are immutable.
-- Index of the last sessionSeal + 1, or 0 when there is none. Mirrors sealedFloor() in
-- js/engine.js exactly; the two must stay in step.
-- ---------------------------------------------------------------------------
create or replace function public.pact_sealed_floor(p_log jsonb)
returns integer language sql immutable set search_path = public, pg_temp as $$
  -- WITH ORDINALITY counts from 1, so the ordinality of the last seal IS its 0-based index plus
  -- one — i.e. the floor itself, with no arithmetic. Guarded against a non-array `p_log`, which a
  -- malformed or hand-edited stats blob can genuinely produce.
  select coalesce(
    (select max(ord)::integer
       from jsonb_array_elements(
              case when jsonb_typeof(p_log) = 'array' then p_log else '[]'::jsonb end
            ) with ordinality as t(ev, ord)
      where t.ev->>'type' = 'sessionSeal'),
    0);
$$;

-- ---------------------------------------------------------------------------
-- 2. The guard itself.
--
-- Reads the floor from the OLD (authoritative) row, never the NEW one — otherwise a client could
-- lower its own floor by submitting a log with the seal removed, which is precisely the attack.
--
-- A shorter NEW log is rejected outright; so is any change to an element at or before the floor.
-- Comparison is on the JSONB values, so key ORDER does not matter (jsonb normalises it) but any
-- semantic change does. `stats` may legitimately change in other ways (name, SEQ, rules) — only the
-- sealed slice of LOG is frozen.
-- ---------------------------------------------------------------------------
create or replace function public.pact_enforce_sealed_prefix()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_old_log jsonb := coalesce(old.stats->'LOG', '[]'::jsonb);
  v_new_log jsonb := coalesce(new.stats->'LOG', '[]'::jsonb);
  v_floor   integer;
  i         integer;
begin
  -- Fast path: nothing sealed, nothing to check. This is every character today, so the ordinary
  -- save path pays one function call and no array walk.
  v_floor := public.pact_sealed_floor(v_old_log);
  if v_floor = 0 then
    return new;
  end if;

  if jsonb_typeof(v_new_log) is distinct from 'array' then
    raise exception 'pact: sealed history cannot be replaced with a non-array log'
      using errcode = 'check_violation';
  end if;

  if jsonb_array_length(v_new_log) < v_floor then
    raise exception 'pact: % event(s) of this character''s history are sealed and cannot be removed', v_floor
      using errcode = 'check_violation',
            hint = 'Reload the character — its history was sealed after this copy was loaded.';
  end if;

  for i in 0 .. v_floor - 1 loop
    if (v_new_log->i) is distinct from (v_old_log->i) then
      raise exception 'pact: event % is sealed and cannot be altered', i
        using errcode = 'check_violation',
              hint = 'Reload the character — its history was sealed after this copy was loaded.';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_characters_sealed_prefix on public.characters;
create trigger trg_characters_sealed_prefix
  before update on public.characters
  for each row execute function public.pact_enforce_sealed_prefix();

-- ---------------------------------------------------------------------------
-- 3. Writing a seal.
--
-- One entry point for both tiers (owner decision I2):
--   * campaign character -> any DM of that campaign, exactly like award_ap();
--   * solo character (campaign_id is null) -> its owner.
-- A player may NOT seal someone else's character in either case.
--
-- The event carries no AP field at all, rather than an amount of zero by convention — an M365
-- Copilot review point, and a good one: a type that cannot express a value cannot later acquire one
-- by accident. seq/ts and the sealer's identity are stamped here and any client-supplied values for
-- them are discarded, the same rule dm_edit_character_log() already applies.
--
-- IDEMPOTENCY. p_idem is an optional caller-generated key. A retry after a network timeout carrying
-- the same key is a no-op returning the existing seal, so a DM double-tap or an offline retry cannot
-- stack two seals. Without this, a retried award_ap_and_seal() could award AP twice — the one
-- failure mode here that would materially damage a character.
-- ---------------------------------------------------------------------------
create or replace function public.seal_character_history(
  p_character uuid,
  p_note      text default null,
  p_idem      text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign uuid;
  v_owner    uuid;
  v_stats    jsonb;
  v_log      jsonb;
  v_seq      integer;
  v_ev       jsonb;
  v_ts       bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  select campaign_id, owner_id, stats
    into v_campaign, v_owner, v_stats
    from characters where id = p_character for update;
  if not found then
    raise exception 'Character not found';
  end if;

  if v_campaign is not null then
    if not is_campaign_dm(v_campaign) then
      raise exception 'Only a campaign DM can seal this character''s history';
    end if;
    perform assert_campaign_active(v_campaign);
  elsif v_owner is distinct from auth.uid() then
    raise exception 'Only the owner can seal a character that is not in a campaign';
  end if;

  if v_stats is null or not (v_stats ? 'LOG') then
    raise exception 'Character has no log to seal';
  end if;
  v_log := coalesce(v_stats->'LOG', '[]'::jsonb);

  -- Idempotent retry: the same key already sealed this character, so return that seal unchanged.
  if p_idem is not null then
    select ev into v_ev
      from jsonb_array_elements(v_log) as t(ev)
     where t.ev->>'type' = 'sessionSeal' and t.ev->>'idem' = p_idem
     limit 1;
    if v_ev is not null then
      return v_ev;
    end if;
  end if;

  v_seq := coalesce((v_stats->>'SEQ')::integer, jsonb_array_length(v_log) + 1);
  v_ev := jsonb_build_object(
    'seq',      v_seq,
    'ts',       v_ts,
    'type',     'sessionSeal',
    'label',    coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Session sealed'),
    'note',     coalesce(p_note, ''),
    'sealedBy', auth.uid(),
    'sealedRole', case when v_campaign is null then 'owner' else 'dm' end
  );
  if p_idem is not null then
    v_ev := v_ev || jsonb_build_object('idem', p_idem);
  end if;
  -- dmEdit marks another account's edit, so it belongs on a DM seal and NOT on a self-seal. The
  -- barrier does not depend on it either way — `sessionSeal` is a barrier by type.
  if v_campaign is not null then
    v_ev := v_ev || jsonb_build_object('dmEdit', true, 'dmId', auth.uid());
  end if;

  v_stats := jsonb_set(jsonb_set(v_stats, '{LOG}', v_log || jsonb_build_array(v_ev)),
                       '{SEQ}', to_jsonb(v_seq + 1));
  update characters set stats = v_stats where id = p_character;
  return v_ev;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Award AP and seal, atomically.
--
-- A plpgsql function body is a single transaction, so either the ledger row, the AP increment and
-- the seal all commit, or none do. Raised by two reviewers: without this you can get AP awarded but
-- history not sealed, or the reverse, and a DM retrying the visibly-failed half duplicates the other.
--
-- The AP itself is NOT written into the LOG. It stays in characters.ap exactly as award_ap() has
-- always put it, because AP already reaches a character by two independent paths that both feed the
-- same spendable total — writing one award to both would double it. The seal is a separate marker
-- carrying no value, which is the whole reason it can be one.
-- ---------------------------------------------------------------------------
create or replace function public.award_ap_and_seal(
  p_character uuid,
  p_amount    integer,
  p_note      text default null,
  p_idem      text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ap   integer;
  v_seal jsonb;
begin
  -- Idempotent retry: if this key already sealed, the whole operation already committed (the seal is
  -- written last), so return the existing result rather than awarding a second time.
  if p_idem is not null then
    select ev into v_seal
      from characters c, jsonb_array_elements(coalesce(c.stats->'LOG', '[]'::jsonb)) as t(ev)
     where c.id = p_character
       and t.ev->>'type' = 'sessionSeal' and t.ev->>'idem' = p_idem
     limit 1;
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

-- ---------------------------------------------------------------------------
-- 5. Let a DM append a seal through the existing edit path too (owner J1's sibling case).
-- dm_edit_character_log()'s allowlist is replaced wholesale below with `sessionSeal` added; every
-- other line is unchanged from sql/migrations/2026-08-10-dm-edit-character-log.sql. Kept in step
-- deliberately rather than patched, so the allowlist reads as one list in one place.
-- ---------------------------------------------------------------------------
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
    -- 'sessionSeal' added by feat/session-seal: a seal appended alongside a DM edit in one write.
    -- It carries no value, so it cannot move AP however it arrives.
    if v_type = 'buy' then
      if v_cat is distinct from 'boon' and v_cat is distinct from 'drawback' then
        raise exception 'dm_edit_character_log: unsupported buy category %', v_cat;
      end if;
    elsif v_type not in ('award', 'dmRemoveBoon', 'sessionSeal') then
      raise exception 'dm_edit_character_log: unsupported event type %', v_type;
    end if;

    -- A seal must never carry a value, whichever door it comes through.
    if v_type = 'sessionSeal' then
      v_ev := v_ev - 'amount' - 'cost';
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

-- ---------------------------------------------------------------------------
-- 6. Grants. Authorisation is decided inside each function, as everywhere else in this schema.
-- ---------------------------------------------------------------------------
revoke execute on function public.pact_enforce_sealed_prefix()                     from public;
grant  execute on function public.seal_character_history(uuid, text, text)         to authenticated;
revoke execute on function public.seal_character_history(uuid, text, text)         from public;
grant  execute on function public.award_ap_and_seal(uuid, integer, text, text)     to authenticated;
revoke execute on function public.award_ap_and_seal(uuid, integer, text, text)     from public;
grant  execute on function public.dm_edit_character_log(uuid, jsonb)               to authenticated;
revoke execute on function public.dm_edit_character_log(uuid, jsonb)               from public;
