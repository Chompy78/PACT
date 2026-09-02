-- ---------------------------------------------------------------------------
-- Owner ruling 2026-09-02 (D-GH-2026-09-02-seal-freezes-species-and-ratchets-stats):
-- once a character's history is locked,
--    * SPECIES is frozen, and so is a SECOND ORIGIN SPECIES that was already set;
--    * ABILITY SCORES may only go UP.
--
-- Applied to production in two steps, both rebuilt from the LIVE pg_proc body (never from a dated
-- migration file — see 2026-09-02-restore-dm-edit-guards.sql for what that mistake cost):
--    seal_freezes_species_and_ratchets_stats
--    seal_freezes_species2_as_well
-- This file is the combined final state. Everything above the species block is byte-identical to the
-- trigger as it ran before.
--
-- WHY BY DERIVED VALUE, NOT BY EVENT POSITION. Species and ability scores live in `buy`/cat:'patch'
-- events, which are deliberately OUTSIDE pact_ap_ledger_protected(): CharGen's replacePatchSlot()
-- rewrites a patch event in place on every identity or stat edit, and that is legitimate, so protecting
-- them positionally would refuse ordinary editing. Comparing the DERIVED value of OLD.stats against
-- NEW.stats is immune to how the event moved.
--
-- WHY KEYED ON THE PAYLOAD KEY, NOT ON `_slot`. Measured against live data before writing this:
-- 164 of 218 patch events carry NO `_slot` at all — they are _buildEventBurst's boot burst — and those
-- hold most of the real species and stats values. A `_slot='identity'` rule would have silently missed
-- almost every character. The rule takes the LAST patch event carrying the key, in log order.
--
-- FAILS OPEN ON A NULL OLD VALUE. Two live campaign characters (Archer, Skylar) have no patch event
-- recording a species at all. There is nothing to freeze for them, and manufacturing a constraint out of
-- a NULL would lock them out of edits they may legitimately make.
--
-- species2 IS ASYMMETRIC, DELIBERATELY. "(none)" is the live sentinel for "no second species" (4 live
-- rows carry it, 4 carry a real species). ADDING a second origin species after a lock stays allowed —
-- it is a new purchase, paid for at the time, and the seal's promise is that new purchases stay
-- available. CHANGING or REMOVING one that was already locked in is refused: that rewrites something the
-- lock covered, and a removal would refund AP. Freezing species WITHOUT freezing species2 would have made
-- the whole rule bypassable, because js/engine.js prices a racial trait as own-species when
-- `r.race === b.species || r.race === b.species2` — so adding a second origin species after the lock
-- turns another entire species' traits into cheap own-species buys.
--
-- STATS ARE A RATCHET, NOT A FREEZE. Raising a score with new AP is allowed. Lowering one to claw AP
-- back is not, and neither is moving points between stats at equal cost — that swap keeps the ledger sum
-- identical, so pact_enforce_ap_budget_consistency cannot see it. This check is the only thing that can.
--
-- VERIFIED against the live trigger, in transactions rolled back afterwards:
--    species change              -> refused
--    STR lowered 14 -> 12        -> refused
--    STR 14->10 and DEX 10->14   -> refused (the equal-cost swap)
--    STR raised 14 -> 16         -> ALLOWED
--    WIS raised, others untouched-> ALLOWED
--    a new purchase after the seal-> ALLOWED
--    species2 Elf -> Tiefling    -> refused
--    species2 Elf -> "(none)"    -> refused
--    species2 "(none)" -> Elf    -> ALLOWED
-- No probe rows left behind (verified: 0).
--
-- CLIENT HALF: tools/PACT-CharGen-Webtool.html's _cgSealPatchRefusal(), called from replacePatchSlot(),
-- mirrors this against foldBuild(LOG) so the player gets a sentence rather than a raw database error.
-- The server is still the enforcement point; the client is the explanation.
-- ---------------------------------------------------------------------------
-- (function body below mirrors production; see the two named migrations above)
create or replace function public.pact_enforce_locked_history()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old_log jsonb; v_award_idx int; v_seal_idx int; v_idx int;
  v_protected_old jsonb; v_protected_new jsonb; i int;
  v_old_species text; v_new_species text;
  v_old_species2 text; v_new_species2 text;
  v_old_stats jsonb; v_new_stats jsonb; v_key text;
begin
  if NEW.stats is not distinct from OLD.stats then return NEW; end if;
  v_old_log := coalesce(OLD.stats->'LOG', '[]'::jsonb);

  select max(ord) into v_seal_idx
  from jsonb_array_elements(v_old_log) with ordinality as t(ev, ord)
  where (ev->>'type') = 'sessionSeal';

  if NEW.campaign_id is not null then
    select max(ord) into v_award_idx
    from jsonb_array_elements(v_old_log) with ordinality as t(ev, ord)
    where (ev->>'type') = 'award'
      and not coalesce((ev->>'disc')::boolean, false)
      and not coalesce((ev->>'noLock')::boolean, false);
  end if;

  v_idx := greatest(coalesce(v_seal_idx, 0), coalesce(v_award_idx, 0));
  if v_idx = 0 then return NEW; end if;

  v_protected_old := public.pact_ap_ledger_protected(
    (select jsonb_agg(ev order by ord)
       from jsonb_array_elements(v_old_log) with ordinality as t(ev, ord)
       where ord <= v_idx));
  v_protected_new := public.pact_ap_ledger_protected(coalesce(NEW.stats->'LOG', '[]'::jsonb));

  if jsonb_array_length(v_protected_new) < jsonb_array_length(v_protected_old) then
    raise exception 'PACT: locked character history cannot shrink (% events are sealed or locked by an AP award)', v_idx
      using hint = 'Reload the character — its history was locked after this copy was loaded.';
  end if;

  for i in 0 .. jsonb_array_length(v_protected_old) - 1 loop
    if (v_protected_old -> i) is distinct from (v_protected_new -> i) then
      raise exception 'PACT: locked character history cannot be rewritten (protected event % changed)', i
        using hint = 'Reload the character — its history was locked after this copy was loaded.';
    end if;
  end loop;

  select ev->'payload'->'patch'->>'species' into v_old_species
    from jsonb_array_elements(v_old_log) with ordinality as t(ev, ord)
   where ev->>'type'='buy' and ev->>'cat'='patch' and ev->'payload'->'patch' ? 'species'
   order by ord desc limit 1;
  select ev->'payload'->'patch'->>'species' into v_new_species
    from jsonb_array_elements(coalesce(NEW.stats->'LOG','[]'::jsonb)) with ordinality as t(ev, ord)
   where ev->>'type'='buy' and ev->>'cat'='patch' and ev->'payload'->'patch' ? 'species'
   order by ord desc limit 1;
  if v_old_species is not null and v_new_species is distinct from v_old_species then
    raise exception 'PACT: locked character history — species is frozen (was %, tried to set %)',
                    v_old_species, coalesce(v_new_species, '(none)')
      using hint = 'Your DM locked this character. Ask them to change its species for you.';
  end if;

  select ev->'payload'->'patch'->>'species2' into v_old_species2
    from jsonb_array_elements(v_old_log) with ordinality as t(ev, ord)
   where ev->>'type'='buy' and ev->>'cat'='patch' and ev->'payload'->'patch' ? 'species2'
   order by ord desc limit 1;
  select ev->'payload'->'patch'->>'species2' into v_new_species2
    from jsonb_array_elements(coalesce(NEW.stats->'LOG','[]'::jsonb)) with ordinality as t(ev, ord)
   where ev->>'type'='buy' and ev->>'cat'='patch' and ev->'payload'->'patch' ? 'species2'
   order by ord desc limit 1;
  if v_old_species2 is not null and v_old_species2 <> '(none)'
     and v_new_species2 is distinct from v_old_species2 then
    raise exception 'PACT: locked character history — second origin species is frozen (was %, tried to set %)',
                    v_old_species2, coalesce(v_new_species2, '(none)')
      using hint = 'Your DM locked this character. Ask them to change it for you.';
  end if;

  select ev->'payload'->'patch'->'stats' into v_old_stats
    from jsonb_array_elements(v_old_log) with ordinality as t(ev, ord)
   where ev->>'type'='buy' and ev->>'cat'='patch' and ev->'payload'->'patch' ? 'stats'
   order by ord desc limit 1;
  select ev->'payload'->'patch'->'stats' into v_new_stats
    from jsonb_array_elements(coalesce(NEW.stats->'LOG','[]'::jsonb)) with ordinality as t(ev, ord)
   where ev->>'type'='buy' and ev->>'cat'='patch' and ev->'payload'->'patch' ? 'stats'
   order by ord desc limit 1;

  if v_old_stats is not null and jsonb_typeof(v_old_stats) = 'object' then
    for v_key in select jsonb_object_keys(v_old_stats) loop
      if jsonb_typeof(v_old_stats->v_key) = 'number' then
        if v_new_stats is null or (v_new_stats->v_key) is null
           or jsonb_typeof(v_new_stats->v_key) <> 'number'
           or (v_new_stats->>v_key)::numeric < (v_old_stats->>v_key)::numeric then
          raise exception 'PACT: locked character history — % cannot go below % (tried %)',
                          v_key, v_old_stats->>v_key, coalesce(v_new_stats->>v_key, '(removed)')
            using hint = 'Your DM locked this character. Ability scores can still be raised, but not lowered or moved.';
        end if;
      end if;
    end loop;
  end if;

  return NEW;
end;
$$;
