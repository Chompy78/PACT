-- PACT — a player can no longer lower a campaign character's server-side spend with a negative cost.
-- fix/server-negative-cost-after-lock (D-GH-2026-10-25-server-negative-cost-after-lock).
-- NOT YET APPLIED to the live database (this header is updated when it is).
--
-- THE GAP. Costs are stamped by the client and pact_ap_ledger_split() sums them as written: every `buy` whose cat is not
-- 'patch' or 'drawback', and every `names` or `buyoff`, adds its `cost` to SPENT. So a modified client could append
--   {type:'buy', cat:'skill', cost:-1000, ...}      or      {type:'names', cost:-1000}
-- to a campaign character and then buy 1000 AP of boons: the budget trigger (pact_enforce_ap_budget_consistency) only refuses a
-- write whose spend both rises and exceeds the budget, and the negative event had already lowered the spend. This works in EVERY
-- campaign mode, locked or not. (Found in the review of #644; pinned as harness cases R2-2 and R2-4 in house-rules-cases.sql.)
-- The drawback route was closed by #654 (a drawback grants at most its effective value) and the negative BUYOFF route by R2-5
-- (a buy-off must name its target and pay rate × value).
--
-- THE CHANGE. A new BEFORE UPDATE trigger, trg_pact_negative_cost_guard, on characters. For a campaign-bound character written by
-- anyone who is not a DM of its campaign and not an admin session (the same exemptions as pact_enforce_player_grants), a NEW event
-- — one not already in the stored row, compared without ts/rules/label — is refused when it is
--   * a `buy` of any cat except 'drawback', 'patch', 'mbound' or 'dbound', or a `names` event, with a cost below 0; or
--   * a `buy` of cat 'mbound' or 'dbound' with a cost below -pact_binding_grant_max() (2), or one that repeats a negative-cost binding the log
--     already holds (same cat and payload ti/di): a binding is one flag, so a repeat would mint -2 AP an event.
-- Why those four are different:
--   drawback   grants AP by design; capped by #654 (AB1) at the drawback's effective value, once per name (F1).
--   patch      its cost is not counted in SPENT at all (cat 'patch' is skipped by pact_ap_ledger_split); CharGen stamps a negative
--              cost on a patch slot when a pick got cheaper, and 7 + 12 live events do.
--   mbound/dbound  Martially / Magically Bound are AP-granting bindings: the engine prices both at a flat -2
--              (js/engine.js _CTX_PRICERS.mbound/dbound). The server accepts any grant from 0 to -2 and refuses a bigger one.
--              pact_binding_grant_max() is the one place the 2 lives; run-negative-cost.sh compares it with the engine's price.
--
-- NO RE-PRICING. This never works out what anything SHOULD cost (js/engine.js is the only pricing source). It is a sign check plus
-- one flat bound for the two bindings.
--
-- WHAT IS UNTOUCHED, and why:
--   * Solo characters (campaign_id null): no server budget applies to them.
--   * A DM of the campaign, and an admin session (no JWT claims): DM Console writes (dm_edit_character_log refunds with a negative
--     cost: dmRefundBoon is a different event type, and the DM is exempt anyway), the RPCs, migrations.
--   * Events already stored: they are matched out, so a character that already carries one is never made unsaveable.
--
-- MEASURED LIVE before writing this (2026-10-25, read-only): across all characters, the only events with a negative cost were
-- cat 'drawback' buys (12 on 5 campaign characters, 28 on 11 solo; all -1 to -5) and cat 'patch' buys (7 on 7 campaign, 12 on 10
-- solo; -2 to -22). Zero negative-cost buys of any other cat, zero buyoffs, zero names events — the rule refuses nothing that exists.
-- A sweep of js/engine.js priceOf() over 183,730 single purchases on the 190 build fixtures found no negative price outside
-- drawback / mbound / dbound either, so no legitimate tool save is refused.
--
-- RESIDUAL (recorded, not fixed here): an event stored BEFORE the character joined a campaign (a solo character with a forged
-- negative cost that is then bound) is grandfathered, as is a row INSERTed with one (fix/server-owner-delete-reinsert-lock-bypass).
--
-- Rollback: 2026-10-25-server-negative-cost-rollback.sql. Roll THIS back before the house-rules rollback: the trigger calls pact_num(), which that
-- rollback drops (UPDATEs on characters would then error).

create or replace function public.pact_binding_grant_max()
returns numeric language sql immutable set search_path = public, pg_temp
as $function$ select 2::numeric $function$;
comment on function public.pact_binding_grant_max() is
  'The most AP a Martially/Magically Bound buy may grant (its cost may be as low as minus this). Must equal -priceOf(mbound/dbound) in js/engine.js (flat -2); testing/scripts/creation-lock-guard-test/run-negative-cost.sh checks it. D-GH-2026-10-25-server-negative-cost-after-lock.';

create or replace function public.pact_enforce_negative_cost()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old jsonb; v_new jsonb; v_ev jsonb; v_cat text; v_cost numeric; v_floor numeric;
  v_used int[] := '{}'; v_found boolean; j int; v_cand jsonb; v_dup boolean;
begin
  if NEW.stats is not distinct from OLD.stats then return NEW; end if;
  if NEW.campaign_id is null then return NEW; end if;
  if coalesce(current_setting('request.jwt.claims', true), '') = '' then return NEW; end if;  -- admin session
  if (OLD.campaign_id is not null and public.is_campaign_dm(OLD.campaign_id)) or public.is_campaign_dm(NEW.campaign_id) then
    return NEW;
  end if;
  v_old := case when jsonb_typeof(OLD.stats->'LOG') = 'array' then OLD.stats->'LOG' else '[]'::jsonb end;
  v_new := case when jsonb_typeof(NEW.stats->'LOG') = 'array' then NEW.stats->'LOG' else '[]'::jsonb end;
  for v_ev in select e from jsonb_array_elements(v_new) e loop
    if jsonb_typeof(v_ev) <> 'object' then continue; end if;
    if v_ev->>'type' = 'buy' then
      v_cat := coalesce(v_ev->>'cat', '');
      if v_cat in ('drawback', 'patch') then continue; end if;
      v_floor := case when v_cat in ('mbound', 'dbound') then -public.pact_binding_grant_max() else 0 end;
    elsif v_ev->>'type' = 'names' then
      v_cat := '';
      v_floor := 0;
    else
      continue;
    end if;
    v_cost := public.pact_num(v_ev->'cost');
    -- A binding is ONE flag (Martially Bound) or one per discipline (Magically Bound, payload ti/di): a second negative-cost copy of
    -- the same binding in the log is not a purchase, it is minting -2 AP an event (review finding, 2026-10-25).
    v_dup := v_cat in ('mbound', 'dbound') and v_cost < 0 and (
      select count(*) from jsonb_array_elements(v_new) o
       where jsonb_typeof(o) = 'object' and o->>'type' = 'buy' and o->>'cat' = v_cat
         and coalesce(o->'payload'->>'ti', '') = coalesce(v_ev->'payload'->>'ti', '')
         and coalesce(o->'payload'->>'di', '') = coalesce(v_ev->'payload'->>'di', '')
         and public.pact_num(o->'cost') < 0) > 1;
    if v_cost >= v_floor and not v_dup then continue; end if;
    -- already stored? (multiset match, ignoring what tools re-stamp)
    v_found := false;
    for j in 0 .. jsonb_array_length(v_old) - 1 loop
      if j = any(v_used) then continue; end if;
      v_cand := v_old -> j;
      if jsonb_typeof(v_cand) = 'object' and (v_cand - 'ts' - 'rules' - 'label') = (v_ev - 'ts' - 'rules' - 'label') then
        v_used := v_used || j; v_found := true; exit;
      end if;
    end loop;
    if v_found then continue; end if;
    raise exception 'PACT: a % can''t be recorded with a cost of % AP — only drawbacks and bindings give AP back (reload the character; if this keeps happening tell your DM)',
      case when v_ev->>'type' = 'names' then 'names event' else 'purchase' end, v_cost;
  end loop;
  return NEW;
end;
$$;

drop trigger if exists trg_pact_negative_cost_guard on public.characters;
create trigger trg_pact_negative_cost_guard
  before update on public.characters
  for each row execute function public.pact_enforce_negative_cost();

-- A trigger function never needs EXECUTE (2026-09-01-revoke-trigger-function-execute.sql); revoking does not stop it firing.
revoke all on function public.pact_enforce_negative_cost() from public, anon, authenticated;
revoke all on function public.pact_binding_grant_max()     from public, anon;
grant execute on function public.pact_binding_grant_max()  to authenticated;

comment on function public.pact_enforce_negative_cost() is
  'Refuses a NEW negative-cost buy (any cat but drawback/patch/mbound/dbound) or names event, and a binding below -pact_binding_grant_max(), on a campaign character written by a non-DM. D-GH-2026-10-25-server-negative-cost-after-lock.';
