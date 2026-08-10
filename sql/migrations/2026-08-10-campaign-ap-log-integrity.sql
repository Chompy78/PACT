-- PACT -- server-side AP-ledger integrity for campaign-bound characters (N1 + O3 of the
-- 2026-08-09/10 AP-integrity external-review batch; z-cold/ on the zcold branch; full record
-- decisions/2026/D-GH-2026-08-10-campaign-ap-log-integrity.md).
-- Run ONCE in the Supabase SQL editor on an existing PACT database.
-- Idempotent: safe to re-run. Fresh installs get this from schema.sql / rls-policies.sql instead;
-- this file only patches a DB created before this change.
--
-- WHY THIS EXISTS
-- characters.stats (the whole LOG, including every purchase's frozen cost) is client-writable by
-- the character's owner. feat/campaign-ap-budget-enforce (2026-08-09) added a CLIENT-SIDE gate that
-- blocks cloud save when compute().remaining < 0 -- real, but bypassable by a raw PostgREST PATCH
-- that skips the UI entirely. These two triggers are the server-side backstop, and both are pure
-- LEDGER ARITHMETIC over numbers already declared on the LOG -- neither one knows what anything
-- SHOULD cost, so neither duplicates js/engine.js's pricing tables (the hard rule AGENTS.md sets).
--
-- NOT THE SAME CHECK AS THE CLIENT GATE. compute().remaining (what
-- _lsOverApBudget()/_cgOverApBudget() check) REPRICES the whole build fresh under CURRENT rules --
-- a number only engine.js's pricing tables can produce, and those are documented to diverge from the
-- frozen ledger sum (see the feat/ap-model-reconcile task-board entry; Fenwick Copperkettle: frozen
-- spend 47 vs repriced 40). A SQL trigger can only ever check the frozen-sum side of that divergence.
-- pact_enforce_ap_budget_consistency below checks "did this character historically spend AP it never
-- had" -- a different, complementary invariant to the client gate's "would this reprice over budget
-- today," not a re-implementation of it.
--
-- REVISION NOTE (post /code-review ultra on PR #401): the first version of this file had three real
-- bugs, two caught by review and one found while fixing those. All three are fixed here; see
-- decisions/2026/D-GH-2026-08-10-campaign-ap-log-integrity.md's "Review findings" section for the
-- full trace of each. Summary:
--   1. The protected-event snapshot dropped `disc`, so flipping an award's disc flag (no cost/type
--      change) passed both triggers silently and then permanently disabled trigger 2 on the NEXT
--      write (the boundary-finding query would no longer see that award as non-discretionary).
--      Fixed: `disc` is now part of the snapshot, so changing it trips the "protected event changed"
--      rejection like any other field.
--   2. cat:'patch' events were excluded from trigger 2's protected set (correct -- see below) but
--      their cost STILL counted in trigger 1's spend sum, so a rewritten/appended patch event with a
--      large negative cost could mask a genuine spend increase elsewhere in the same or a later write.
--      Fixed: cat:'patch' costs are now excluded from BOTH triggers' notion of "spend" -- patch-driven
--      cost changes are covered only by the client-side gate (which reprices the whole build via
--      compute(), seeing patch effects directly), not by this SQL-only backstop. Documented as a
--      scope boundary, not silently dropped.
--   3. CharGen's creation-budget award (_cgSyncSingletonEvent, tools/PACT-CharGen-Webtool.html:2539)
--      sets noLock:true and NEVER disc -- and is re-synced via a DELETE-then-APPEND-AT-END pattern
--      every time the budget value changes, not a stable in-place mutation. Without an exclusion, this
--      event would be treated as the trigger-2 boundary and would churn to the end of the log on every
--      resync, dragging the "locked" boundary forward and freezing ordinary in-progress drafting for
--      any campaign-bound CharGen character (found while re-verifying fix #1, not by the review).
--      Fixed: the boundary-finding query now also excludes noLock:true awards. Live Sheet's own
--      award-entry function (award(amount,note,disc), tools/PACT-Live-Char-Sheet.html:601) and its
--      "Level 1 starting AP" seed event never set noLock, so this does not weaken protection for
--      genuine play-time awards -- undo() already treats that seed event as its own boundary anyway
--      (same disc-based check), so trigger 2 remains behaviourally consistent with the shipped client
--      for Live Sheet. Caveat: if CharGen ever gains a path that appends a real (non-noLock) award
--      event mid-draft, that would need re-review before this boundary assumption still holds there.
--
-- TWO TRIGGERS, campaign-bound characters only (campaign_id is not null):
--
-- 1. pact_enforce_ap_budget_consistency -- sums frozen buy(non-patch)/buyoff/names costs and
--    award/drawback earnings straight from the LOG (never re-derives a price), and rejects a write
--    only if that sum BOTH increases AND exceeds spendable AP. The non-regression guard grandfathers
--    an already-over-budget character (pre-existing before this trigger, or before a DM turned
--    enforceApBudget on) -- unrelated edits (appearance, undo, DM notes) still save; only making
--    total spend worse is blocked. Gated on campaigns.rules->>'enforceApBudget' (default true,
--    matching the client feature's own default -- see feat/campaign-ap-budget-enforce).
--    Known approximation: `earned` counts every drawback-buy's refund regardless of whether it was
--    later bought off (exact tracking needs the same FIFO-queue matching js/engine.js's
--    activeEvents() does for boughtOff -- more machinery than this backstop needs). This makes
--    `earned` occasionally slightly GENEROUS, never stingy: it can under-enforce, never wrongly
--    block a legitimate save.
--
-- 2. pact_enforce_locked_history -- once a character's LOG contains a non-discretionary, non-seed
--    `award` event (type:'award', no truthy `disc`, no truthy `noLock`), everything at-or-before that
--    event's index becomes append-only: it may never be rewritten, reordered, or removed (including
--    the award event's OWN fields, like `disc`, once set). This is Live Sheet's own undo()
--    (`LOG[LOG.length-1].type==='award' && !disc` -> refuse to pop) made server-authoritative, so it
--    needs no new "locked" column. `cat:'patch'` events (CharGen's replacePatchSlot(), Live Sheet's
--    _shCommitAppearanceField -- identity/appearance/stats/economy slot edits) are excluded from the
--    protected set entirely: they are legitimately rewritten or reordered in place by design (verified
--    directly in both tools' source before writing this).
--
-- Both are SECURITY DEFINER so they can read `campaigns` regardless of the invoking player's own RLS
-- visibility into that table (same reasoning as award_ap()/dm_unbind_character() above them in
-- rls-policies.sql), and both short-circuit immediately when stats is untouched (autosave_enabled/
-- archived_at-only updates, or award_ap()'s own ap-only update) or the character isn't campaign-bound.

-- ===========================================================================
-- 1. Helpers -- pure jsonb arithmetic, no table access, no SECURITY DEFINER needed.
-- ===========================================================================

-- Sums a LOG's frozen spend/earn straight off the event fields already present. cat:'patch' buy
-- events are deliberately excluded from `spent` (see revision note above) -- see the file header for
-- the boughtOff approximation this deliberately accepts.
create or replace function public.pact_ap_ledger_spend(p_log jsonb)
returns table(spent numeric, player_earned numeric)
language plpgsql set search_path = public, pg_temp as $$
declare
  ev jsonb;
  v_spent numeric := 0;
  v_earned numeric := 0;
begin
  for ev in select * from jsonb_array_elements(coalesce(p_log, '[]'::jsonb)) loop
    if (ev->>'type') = 'award' then
      v_earned := v_earned + coalesce((ev->>'amount')::numeric, 0);
    elsif (ev->>'type') = 'buy' and coalesce(ev->>'cat','') = 'drawback' then
      -- drawback cost is stored negative (a refund); js/engine.js's economy() negates it into earned.
      v_earned := v_earned + (coalesce((ev->>'cost')::numeric, 0) * -1);
    elsif (ev->>'type') in ('buyoff','names') or ((ev->>'type') = 'buy' and coalesce(ev->>'cat','') <> 'patch') then
      v_spent := v_spent + coalesce((ev->>'cost')::numeric, 0);
    end if;
  end loop;
  spent := v_spent; player_earned := v_earned;
  return next;
end;
$$;

-- The ordered "protected" (economic, non-cosmetic) subsequence of a LOG -- everything counted in
-- pact_ap_ledger_spend's spend/earn EXCEPT cat='patch' events. Keeps the fields that carry AP stakes
-- OR gate the boundary itself (type/cat/cost/amount/refVal/disc) -- payload/label/ts/etc are dropped
-- on purpose so a cosmetic-only field inside a protected event can never trip this check. `disc` is
-- included so flipping an award's own lock-relevant flag is itself a protected-field change once that
-- award is inside the protected prefix (see revision note fix #1).
create or replace function public.pact_ap_ledger_protected(p_log jsonb)
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'type', ev->>'type', 'cat', ev->>'cat',
           'cost', ev->>'cost', 'amount', ev->>'amount', 'refVal', ev->>'refVal',
           'disc', ev->>'disc'
         ) order by ord), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_log,'[]'::jsonb)) with ordinality as t(ev, ord)
  where (ev->>'type') in ('buyoff','names','award')
     or ((ev->>'type') = 'buy' and coalesce(ev->>'cat','') <> 'patch');
$$;

grant execute on function public.pact_ap_ledger_spend(jsonb)     to authenticated;
grant execute on function public.pact_ap_ledger_protected(jsonb) to authenticated;
revoke execute on function public.pact_ap_ledger_spend(jsonb)     from public;
revoke execute on function public.pact_ap_ledger_protected(jsonb) from public;

-- ===========================================================================
-- 2. Trigger 1 -- N1, frozen-cost-sum consistency with a non-regression guard.
-- ===========================================================================
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

  v_spendable := NEW.ap + (case when v_campaign.ignore_player_ap then 0 else v_new_earned end);

  if v_new_spent > v_old_spent and v_new_spent > v_spendable then
    raise exception 'PACT: over AP budget by % (spent % of % spendable)',
      (v_new_spent - v_spendable), v_new_spent, v_spendable;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_pact_ap_budget_consistency on public.characters;
create trigger trg_pact_ap_budget_consistency
  before update on public.characters
  for each row execute function public.pact_enforce_ap_budget_consistency();

-- ===========================================================================
-- 3. Trigger 2 -- O3, locked-history append-only protection.
-- ===========================================================================
create or replace function public.pact_enforce_locked_history()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old_log jsonb;
  v_award_idx int;
  v_protected_old jsonb;
  v_protected_new jsonb;
  i int;
begin
  if NEW.campaign_id is null then
    return NEW;
  end if;
  if NEW.stats is not distinct from OLD.stats then
    return NEW;
  end if;

  v_old_log := coalesce(OLD.stats->'LOG', '[]'::jsonb);

  -- The same boundary undo() already enforces client-side: the LAST non-discretionary, non-seed
  -- award event. noLock:true excludes CharGen's creation-budget seed (which churns to the end of the
  -- log on every resync -- see revision note fix #3); disc:true excludes a player's own
  -- explicitly-discretionary Live Sheet award entry, same as undo()'s own check.
  select max(ord) into v_award_idx
  from jsonb_array_elements(v_old_log) with ordinality as t(ev, ord)
  where (ev->>'type') = 'award'
    and not coalesce((ev->>'disc')::boolean, false)
    and not coalesce((ev->>'noLock')::boolean, false);

  if v_award_idx is null then
    return NEW;
  end if;

  v_protected_old := public.pact_ap_ledger_protected(
    (select jsonb_agg(ev order by ord)
       from jsonb_array_elements(v_old_log) with ordinality as t(ev, ord)
       where ord <= v_award_idx)
  );
  v_protected_new := public.pact_ap_ledger_protected(coalesce(NEW.stats->'LOG', '[]'::jsonb));

  if jsonb_array_length(v_protected_new) < jsonb_array_length(v_protected_old) then
    raise exception 'PACT: locked character history cannot shrink (an AP award already locked it)';
  end if;

  for i in 0 .. jsonb_array_length(v_protected_old) - 1 loop
    if (v_protected_old -> i) is distinct from (v_protected_new -> i) then
      raise exception 'PACT: locked character history cannot be rewritten (protected event % changed)', i;
    end if;
  end loop;

  return NEW;
end;
$$;

drop trigger if exists trg_pact_locked_history on public.characters;
create trigger trg_pact_locked_history
  before update on public.characters
  for each row execute function public.pact_enforce_locked_history();

grant execute on function public.pact_enforce_ap_budget_consistency() to authenticated;
grant execute on function public.pact_enforce_locked_history()        to authenticated;
revoke execute on function public.pact_enforce_ap_budget_consistency() from public;
revoke execute on function public.pact_enforce_locked_history()        from public;
