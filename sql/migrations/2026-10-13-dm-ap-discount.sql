-- PACT — a DM can take AP off any priced purchase (`dmDiscount`), and only a DM can.
-- feat/dm-ap-discount (D-GH-2026-10-13-dm-ap-discount). Plan: docs/plans/2026-10-13-dm-ap-discount.md (cold-reviewed).
-- NOT APPLIED to the live database by merging this file. The owner applies it, then runs get_advisors.
-- Rollback: sql/migrations/2026-10-13-dm-ap-discount-rollback.sql.
--
-- BASE OF THESE DEFINITIONS. The three replaced functions were read back from the LIVE database on 2026-10-13
-- (pg_get_functiondef) and matched sql/rls-policies.sql line for line; each is that definition plus the change
-- below and nothing else. Both files carry the same text (the baseline drift guard in
-- testing/sql/rls-baseline-test.sql compares them).
--
-- WHAT CHANGES.
--   1. dm_edit_character_log() accepts one new event type, 'dmDiscount' {targetSeq, targetCat, amount, note}.
--      Validated against the stored log: the target is the ONLY event with that seq, its category matches, it is
--      a priced purchase (not a drawback), and its net discount after this one stays between 0 and its cost.
--      A negative amount corrects an earlier discount. Rebuilt from a whitelist, then DM-stamped like every
--      other event this function writes.
--   2. pact_ap_ledger_protected(): 'dmDiscount' joins the protected types, so it freezes behind a seal or lock
--      like awards do.
--   3. pact_ap_ledger_discount() (new): the AP a log's discounts hand back.
--   4. pact_enforce_ap_budget_consistency(): spendable now adds the discounts — OUTSIDE the ignore_player_ap
--      switch, because a discount is DM-given (js/engine.js does the same).
--   5. pact_enforce_dm_discount_authorship() + trg_pact_dm_discount_authorship (new): a character's owner can
--      write their own log, so without this a player could forge a discount. On UPDATE the log's dmDiscount
--      events may change only when the writer is a DM of the character's campaign (is_campaign_dm — WHO is
--      writing, never a flag in the event). A discount may not arrive in a campaign from outside: a campaign
--      character inserted with one, or a character holding one bound to a campaign, is refused.
--
-- NOT DEPENDENT ON 2026-10-12-server-player-award-after-lock.sql, which was not live on 2026-10-13 (the live
-- pact_enforce_player_ap_ceiling was still the 2026-09-03 version). This check stands on its own.
--
-- BLAST RADIUS, measured on the live database 2026-10-13: 37 characters (10 campaign-bound, 8 owners); 0 events
-- of type dmDiscount and 0 events carrying targetCat. So no stored row is changed, and no existing save can be
-- refused by the new trigger (it only fires when dmDiscount events differ between OLD and NEW, or a campaign
-- character holds one).
--
-- KNOWN GAPS, STATED PLAINLY.
--   * The server's sum does not check that the discounted purchase is still owned (owner decision I1). It can
--     only make the server more generous than the app, never stricter, and only by discounts a DM gave.
--   * A discount on a `patch` purchase (CharGen) is counted by the server although its spend is not
--     (pact_ap_ledger_spend has never counted patch spend). Same direction, same bound.
--   * Admin sessions (SQL editor, no JWT) are not DM sessions: a hand repair that changes a log's discounts must
--     disable trg_pact_dm_discount_authorship for that one transaction.
--
-- VERIFY AFTER APPLYING.
--   select has_function_privilege('authenticated', 'public.pact_ap_ledger_discount(jsonb)', 'execute');          -- false
--   select has_function_privilege('authenticated', 'public.pact_enforce_dm_discount_authorship()', 'execute');   -- false
--   select tgname from pg_trigger where tgname = 'trg_pact_dm_discount_authorship';                               -- 1 row
--   select p.prosrc like '%assert_campaign_active%' and p.prosrc like '%has no matching award%'
--          and p.prosrc like '%dmUnlockDrawback%' and p.prosrc like '%dmDiscount%'
--     from pg_proc p where p.proname = 'dm_edit_character_log';                                                   -- true

begin;

-- pact_ap_ledger_discount: the AP a log's DM discounts hand back, for the budget check above. A plain sum: the
-- per-purchase range (0 to the purchase's cost) is enforced when each discount is written by
-- dm_edit_character_log, and only a DM can add, change or remove one (the trigger below). It does NOT check that
-- the discounted purchase is still owned — js/engine.js decides that; owner decision I1 accepts the gap.
create or replace function public.pact_ap_ledger_discount(p_log jsonb)
 returns numeric
 language sql
 immutable
 set search_path = public, pg_temp
as $function$
  select coalesce(sum((e->>'amount')::numeric), 0)
    from jsonb_array_elements(coalesce(p_log, '[]'::jsonb)) as t(e)
   where e->>'type' = 'dmDiscount' and jsonb_typeof(e->'amount') = 'number';
$function$;


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

create or replace function public.pact_ap_ledger_protected(p_log jsonb)
 returns jsonb
 language sql
 immutable
 set search_path = public, pg_temp
as $function$
  select coalesce(jsonb_agg(
           case when (ev->>'type') = 'buy' and coalesce(ev->>'cat','') = 'patch'
                then public.pact_patch_protected_projection(ev)
                else (ev - 'seq' - 'ts' - 'rules' - 'label') end
           order by ord), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_log,'[]'::jsonb)) with ordinality as t(ev, ord)
  where (ev->>'type') in ('buyoff','names','award','sessionSeal','dmRemoveBoon','dmUnlockDrawback','dmDiscount')
     or ((ev->>'type') = 'buy' and coalesce(ev->>'cat','') <> 'patch')
     or ((ev->>'type') = 'buy' and coalesce(ev->>'cat','') = 'patch' and public.pact_patch_protected_projection(ev) is not null);
$function$;

create or replace function public.pact_enforce_ap_budget_consistency()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign public.campaigns%rowtype;
  v_enforce boolean;
  v_old_spent numeric;
  v_new_spent numeric; v_new_earned numeric;
  v_spendable numeric;
begin
  if NEW.campaign_id is null then
    return NEW;
  end if;
  if NEW.stats is not distinct from OLD.stats then
    return NEW;
  end if;

  select * into v_campaign from public.campaigns where id = NEW.campaign_id;
  if not found then
    return NEW;  -- dangling campaign_id shouldn't happen; fail open rather than block on it here
  end if;

  v_enforce := coalesce((v_campaign.rules->>'enforceApBudget')::boolean, true);
  if not v_enforce then
    return NEW;
  end if;

  select spent, player_earned into v_new_spent, v_new_earned
    from public.pact_ap_ledger_spend(NEW.stats->'LOG');
  select spent into v_old_spent
    from public.pact_ap_ledger_spend(OLD.stats->'LOG');

  -- feat/dm-ap-discount: a DM discount is DM-given AP, so it counts whether or not the campaign ignores
  -- player AP (js/engine.js keeps it outside the same bracket).
  v_spendable := NEW.ap + public.pact_ap_ledger_discount(NEW.stats->'LOG')
    + (case when v_campaign.ignore_player_ap then 0 else v_new_earned end);

  if v_new_spent > v_old_spent and v_new_spent > v_spendable then
    raise exception 'PACT: over AP budget by % (spent % of % spendable)',
      (v_new_spent - v_spendable), v_new_spent, v_spendable;
  end if;

  return NEW;
end;
$$;

-- pact_enforce_dm_discount_authorship: a DM discount is AP, and a character's owner can write their own log,
-- so without this a player could forge one. Unlike every other check here it identifies the DM by WHO is
-- writing (is_campaign_dm), never by a flag in the event, which the writer controls.
--   * UPDATE: the log's dmDiscount events (compared as a set) may change only when the writer is a DM of the
--     character's campaign and the campaign is not changing in the same write.
--   * A discount may not ARRIVE in a campaign from outside: inserting a campaign character whose log already
--     holds one, or binding a character that holds one to a campaign, is refused.
-- Admin sessions (no JWT) are not exempt, like pact_enforce_player_ap_ceiling.
create or replace function public.pact_enforce_dm_discount_authorship()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old jsonb := '[]'::jsonb;
  v_new jsonb;
begin
  select coalesce(jsonb_agg(e order by e::text), '[]'::jsonb) into v_new
    from jsonb_array_elements(case when jsonb_typeof(NEW.stats->'LOG') = 'array' then NEW.stats->'LOG' else '[]'::jsonb end) as t(e)
   where e->>'type' = 'dmDiscount';
  if TG_OP = 'INSERT' then
    if NEW.campaign_id is not null and v_new <> '[]'::jsonb then
      raise exception 'PACT: a character cannot join a campaign carrying AP discounts from elsewhere';
    end if;
    return NEW;
  end if;
  select coalesce(jsonb_agg(e order by e::text), '[]'::jsonb) into v_old
    from jsonb_array_elements(case when jsonb_typeof(OLD.stats->'LOG') = 'array' then OLD.stats->'LOG' else '[]'::jsonb end) as t(e)
   where e->>'type' = 'dmDiscount';
  if NEW.campaign_id is not null and NEW.campaign_id is distinct from OLD.campaign_id and v_new <> '[]'::jsonb then
    raise exception 'PACT: a character cannot join a campaign carrying AP discounts from elsewhere';
  end if;
  if v_new is not distinct from v_old then
    return NEW;
  end if;
  if OLD.campaign_id is not null and NEW.campaign_id is not distinct from OLD.campaign_id
     and public.is_campaign_dm(OLD.campaign_id) then
    return NEW;
  end if;
  raise exception 'PACT: only the campaign''s DM can add, change or remove an AP discount';
end;
$$;

drop trigger if exists trg_pact_dm_discount_authorship on public.characters;
create trigger trg_pact_dm_discount_authorship
  before insert or update on public.characters
  for each row execute function public.pact_enforce_dm_discount_authorship();

revoke execute on function public.pact_ap_ledger_discount(jsonb)            from public, anon, authenticated;
revoke execute on function public.pact_enforce_dm_discount_authorship()    from public, anon, authenticated;

commit;
