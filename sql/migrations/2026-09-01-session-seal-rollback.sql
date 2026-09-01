-- PACT — rollback for sql/migrations/2026-09-01-session-seal.sql.
--
-- READ THIS FIRST: THERE IS NO TRIGGER TO DROP. The forward migration does not add one — it AMENDS
-- pact_enforce_locked_history(), which has existed since 2026-08-10 and protects campaign characters
-- today. Dropping trg_pact_locked_history would therefore not "undo the seal", it would REMOVE
-- PROTECTION THAT PREDATES THIS WORK. Never do that as a rollback step.
--
-- Rolling back means restoring the two amended functions to their 2026-08-10 bodies. This file does
-- that, and drops the new seal entry points.
--
-- WHAT IT COSTS. Any `sessionSeal` events already written stay in their characters' logs. They keep
-- working as undo barriers in the tools (js/engine.js treats the type as a barrier regardless of the
-- database) and simply stop being server-enforced; on a campaign character the award boundary still
-- protects everything up to the last award, exactly as before. Nothing needs deleting and no
-- character is damaged. Fails in the safe direction.

begin;

-- 1. Protected projection — back to 2026-08-10 (no 'sessionSeal').
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

-- 2. Boundary — back to award-only, campaign-only.
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

-- 3. The new entry points. Inert once nothing calls them; dropped for tidiness.
drop function if exists public.award_ap_and_seal(uuid, integer, text, text);
drop function if exists public.seal_character_history(uuid, text, text);

-- 4. dm_edit_character_log()'s allow-list back to 2026-08-10 (no 'sessionSeal') is OPTIONAL and not
--    done here: leaving the newer version in place is harmless, because a seal that nothing enforces
--    is an inert marker.
--    ⛔ CORRECTED 2026-09-02 — this line previously said "Re-apply
--    sql/migrations/2026-08-10-dm-edit-character-log.sql if you want it." DO NOT. That file is a
--    stale snapshot: it predates BOTH the archived-campaign write lockdown (2026-08-22) and the
--    boon/award amount check (2026-08-10-dm-edit-boon-amount-check), so applying it re-opens two
--    holes and leaves the database WEAKER than before the seal shipped. Reading it as current is
--    exactly how the forward migration broke production in the first place; see
--    sql/migrations/2026-09-02-restore-dm-edit-guards.sql. If you need to drop 'sessionSeal' from
--    the allow-list, edit the definition in sql/rls-policies.sql — the maintained baseline — and
--    apply that, or just leave it: an unused allow-list entry enforces nothing.

commit;
