-- Server-side enforcement that an archived campaign is write-locked.
--
-- Today "an archived campaign is read-only" is enforced ONLY in client JavaScript --
-- scattered `if(window._dmPeekActive && ...) return;` guards in tools/DM-Console.html. No
-- database function or RLS policy actually rejects a write against an archived campaign, so
-- a direct RPC/REST call (or a future click-handler refactor that misses one of the several
-- guard sites the client pattern requires remembering) bypasses the "archived = frozen"
-- invariant entirely. This project's own standing rule is "RLS is the only real security
-- boundary" -- client-side gating is UX only.
--
-- Who can reach this gap: every write path here is already gated on "caller is a DM (or
-- owner) of this specific campaign" -- nobody outside the campaign's own DM/co-DM roster can
-- call any of them regardless of archive state. So this is not a cross-user privilege
-- escalation (unlike D-GH-2026-08-09-harden-invitation-system) -- it's a missing invariant: a
-- DM's own tooling promises "archived = frozen," and nothing but a client-side `if` currently
-- makes that true.
--
-- Scope: seven enumerated write paths -- award_ap, award_gold, declare_downtime,
-- dm_edit_character_log, dm_unbind_character (all five SECURITY DEFINER RPCs), the
-- campaigns_update RLS policy (the direct-column path for ignore_player_ap/rules), and the
-- characters_delete RLS policy (a DM can otherwise hard-delete a bound character with no
-- archive check at all -- found during this migration's own broader write-surface audit, not
-- named in the original task-board entry). Deliberately OUT of scope: character_dm_notes
-- (its `for all` policy covers select+insert+update+delete with one predicate -- adding an
-- archive check as-is would also block reading notes on an archived campaign, a real
-- regression, not an incomplete fix -- needs a read/write policy split first, separate
-- change) and the invitation subsystem (recently and separately hardened by
-- D-GH-2026-08-09-harden-invitation-system; bundling risks scope creep on the same boundary).
--
-- Full design record, 5-reviewer cold review, and both resolved product decisions (block
-- dm_unbind_character AND characters_delete while archived) are in
-- docs/plans/2026-08-22-archived-campaign-rpc-enforcement-cold-review.md. See
-- D-GH-2026-08-22-archived-campaign-rpc-enforcement for the decision record.
--
-- Concurrency note: this is a normal statement-time check under Postgres MVCC, not a
-- commit-time serialization -- a write that begins its check microseconds before a
-- concurrent archive_campaign() commits can still land after archiving. Accepted, not fixed:
-- both parties in that race are already DMs of the same campaign (no privilege gap), and the
-- window is a single-statement race, not an open-ended one.
--
-- Safe to re-run: every function is `create or replace`, every policy is dropped before
-- being recreated.

-- ---------------------------------------------------------------------------
-- 1. is_campaign_active(campaign) -- one boolean primitive, not a re-derived inline check at
-- every call site. Fail-closed by construction: requires an existing, active row -- a
-- missing/wrong id returns false, not "silently passes."
-- ---------------------------------------------------------------------------
create or replace function public.is_campaign_active(p_campaign uuid)
returns boolean language sql security definer stable set search_path = public, pg_temp as $$
  select exists (select 1 from campaigns where id = p_campaign and archived_at is null);
$$;

revoke execute on function public.is_campaign_active(uuid) from public;
grant  execute on function public.is_campaign_active(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Two call-site helpers, both derived from the one primitive above.
--
-- assert_campaign_active() -- for the five SECURITY DEFINER RPCs: called immediately AFTER
-- each function's existing is_campaign_dm() authority check, so an unauthorized caller still
-- gets "only a campaign DM can..." rather than leaking archive state to someone with no
-- access at all.
--
-- is_campaign_dm_and_active() -- for the two RLS policies (campaigns_update,
-- characters_delete), where the archive check has to compose into a single USING/WITH CHECK
-- predicate rather than run as a sequential statement.
-- ---------------------------------------------------------------------------
create or replace function public.assert_campaign_active(p_campaign uuid)
returns void language plpgsql security definer stable set search_path = public, pg_temp as $$
begin
  if not is_campaign_active(p_campaign) then
    raise exception 'This campaign is archived and read-only';
  end if;
end;
$$;

revoke execute on function public.assert_campaign_active(uuid) from public;
grant  execute on function public.assert_campaign_active(uuid) to authenticated;

create or replace function public.is_campaign_dm_and_active(p_campaign uuid)
returns boolean language sql security definer stable set search_path = public, pg_temp as $$
  select is_campaign_dm(p_campaign) and is_campaign_active(p_campaign);
$$;

revoke execute on function public.is_campaign_dm_and_active(uuid) from public;
grant  execute on function public.is_campaign_dm_and_active(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. award_ap -- add the archive check right after the existing DM-authority check.
-- ---------------------------------------------------------------------------
create or replace function public.award_ap(p_character uuid, p_amount integer, p_note text default null)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign uuid;
  v_ap       integer;
begin
  select campaign_id into v_campaign from characters where id = p_character;
  if v_campaign is null then
    raise exception 'Character is not in a campaign';
  end if;
  if not is_campaign_dm(v_campaign) then
    raise exception 'Only a campaign DM can award AP';
  end if;
  perform assert_campaign_active(v_campaign);

  insert into ap_awards (character_id, dm_id, campaign_id, amount, note)
    values (p_character, auth.uid(), v_campaign, p_amount, p_note);

  update characters set ap = ap + p_amount
    where id = p_character
    returning ap into v_ap;
  return v_ap;
end;
$$;

revoke execute on function public.award_ap(uuid, integer, text) from public;
grant  execute on function public.award_ap(uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. award_gold -- same pattern.
-- ---------------------------------------------------------------------------
create or replace function public.award_gold(
  p_character uuid,
  p_gold integer,
  p_note text default null
)
returns characters language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign uuid;
  v_row      characters%rowtype;
begin
  select campaign_id into v_campaign from characters where id = p_character;
  if v_campaign is null then
    raise exception 'Character is not in a campaign';
  end if;
  if not is_campaign_dm(v_campaign) then
    raise exception 'Only a campaign DM can award gold';
  end if;
  perform assert_campaign_active(v_campaign);
  if coalesce(p_gold, 0) = 0 then
    raise exception 'Award must change gold';
  end if;

  insert into gold_awards (character_id, dm_id, campaign_id, gold, note)
    values (p_character, auth.uid(), v_campaign, p_gold, p_note);

  update characters set gold = gold + p_gold
    where id = p_character
    returning * into v_row;
  return v_row;
end;
$$;

revoke execute on function public.award_gold(uuid, integer, text) from public;
grant  execute on function public.award_gold(uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. declare_downtime -- same pattern.
-- ---------------------------------------------------------------------------
create or replace function public.declare_downtime(
  p_campaign uuid,
  p_days integer,
  p_character uuid default null,
  p_note text default null
)
returns campaign_downtime_declarations language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_char_campaign uuid;
  v_row campaign_downtime_declarations%rowtype;
begin
  if not is_campaign_dm(p_campaign) then
    raise exception 'Only a campaign DM can declare downtime';
  end if;
  perform assert_campaign_active(p_campaign);
  if p_days is null then
    raise exception 'Days is required';
  end if;
  if p_character is not null then
    select campaign_id into v_char_campaign from characters where id = p_character;
    if v_char_campaign is distinct from p_campaign then
      raise exception 'That character is not in this campaign';
    end if;
  end if;

  insert into campaign_downtime_declarations (campaign_id, character_id, days, note, declared_by)
    values (p_campaign, p_character, p_days, p_note, auth.uid())
    returning * into v_row;
  return v_row;
end;
$$;

revoke execute on function public.declare_downtime(uuid, integer, uuid, text) from public;
grant  execute on function public.declare_downtime(uuid, integer, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. dm_unbind_character -- add the archive check. Decided 2026-08-23: blocked while
-- archived. If a DM genuinely needs to recover a character from an archived campaign,
-- unarchive_campaign() -> dm_unbind_character() -> archive_campaign() already does that in
-- three calls with zero new code, so this costs no real capability.
-- ---------------------------------------------------------------------------
create or replace function public.dm_unbind_character(p_character uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign uuid;
begin
  select campaign_id into v_campaign from characters where id = p_character;
  if v_campaign is null then
    raise exception 'Character is not in a campaign';
  end if;
  if not is_campaign_dm(v_campaign) then
    raise exception 'Only a campaign DM can remove a character from the campaign';
  end if;
  perform assert_campaign_active(v_campaign);

  update characters set campaign_id = null where id = p_character;
end;
$$;

revoke execute on function public.dm_unbind_character(uuid) from public;
grant  execute on function public.dm_unbind_character(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. dm_edit_character_log -- add the archive check right after the existing DM-authority
-- check. Body otherwise byte-identical to the current sql/rls-policies.sql definition
-- (last touched by sql/migrations/2026-08-10-dm-edit-boon-amount-check.sql).
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
  -- promise this migration's own header comment makes is enforced server-side, not just by DM Console's
  -- client always sending the pair together. FIFO-by-VALUE, not by-name: an award event carries only an
  -- amount, no reference to which buy it pays for (unlike buyoff/dmRemoveBoon, which carry refVal) — see
  -- js/engine.js's activeEvents() boughtOff/boonRemoved comment for why value-keyed FIFO (not a single
  -- shared flag) is required the moment a batch could ever hold more than one boon grant.
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

revoke execute on function public.dm_edit_character_log(uuid, jsonb) from public;
grant  execute on function public.dm_edit_character_log(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. campaigns_update RLS policy -- gates the direct ignore_player_ap/rules column writes.
-- Deliberately does NOT touch is_campaign_dm() itself -- that function also backs several
-- READ policies (campaigns_select, campaign_dms_select, ap_awards_select, ...) and a DM/co-DM
-- must still be able to SEE an archived campaign; only write policies need the extra clause.
-- ---------------------------------------------------------------------------
drop policy if exists campaigns_update on public.campaigns;
create policy campaigns_update on public.campaigns
  for update using (is_campaign_dm_and_active(id)) with check (is_campaign_dm_and_active(id));

-- ---------------------------------------------------------------------------
-- 9. characters_delete RLS policy -- the owner's own delete path is untouched (matches the
-- "a player's own client saving/removing their own character must keep working" principle
-- already established for characters_update); only the DM-authority branch gains the archive
-- check. Decided 2026-08-23: blocked while archived, same reasoning as dm_unbind_character.
-- ---------------------------------------------------------------------------
drop policy if exists characters_delete on public.characters;
create policy characters_delete on public.characters
  for delete using (owner_id = auth.uid() or is_campaign_dm_and_active(campaign_id));
