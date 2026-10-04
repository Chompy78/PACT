-- PACT — server freeze, stage 1 (D2 + E1). docs/plans/2026-10-04-server-freeze-d2-e1.md (cold-reviewed 2026-10-04: Gemini + Groq + a no-context judge).
-- NOT APPLIED to the live database as of this file's creation — applying it is the owner's decision. Rehearsed on a throwaway Docker Postgres
-- (testing/scripts/creation-lock-guard-test/run-freeze.sh). Rollback: sql/migrations/2026-10-05-server-freeze-d2-e1-stage1-rollback.sql (functions only, no data change).
--
-- WHAT. (E1) a `buy` event with cat='patch' is now PROTECTED — frozen once the character is locked, sealed or awarded — except for its no-AP fields.
-- Before, pact_ap_ledger_protected() excluded every patch event, so after an award or seal a player could lower Hit Dice, strip a proficiency, set a
-- stamped patch cost to 0 or delete the event (proved on a Docker copy of the live rules; it is how a -11 AP refund and a reversed ability raise got through).
-- (D2) for a CAMPAIGN character that is currently locked (last creationLocked after the last creationUnlocked), the lock is a freeze boundary like a seal:
-- every protected event at or before it is frozen. A DM reopening creation (an append-only DM function) lifts the lock boundary; the seal/award boundary stays.
--
-- HOW. Fail-closed on field names: every field of a patch event is protected EXCEPT the permanent no-AP list (appearance, houseRules, gold) and, for stage 1
-- only, a TEMPORARY list of fields the client still rewrites in place after a lock until phase 2b ships (spellcasting, innate, martial binding, dabbler cantrips,
-- species, origin classes, size, lineage). Stage 2 (a later migration) deletes the temporary list. Only the protected fields, the cost and gp/days of the event are
-- compared, so editing an exempt field in a mixed event never trips the freeze, and a deleted/nulled field or a changed cost always does.
--
-- THREAT MODEL. Protects against ACCIDENTS (stale copies, client bugs), not a determined cheater: the client stamps its own AP costs and the server cannot re-price,
-- so appending free purchases after the lock is not prevented by this or any trigger. Error text keeps the phrase "locked character history" so js/sync.js shows its
-- existing reload message.
--
-- UNCHANGED: the species freeze, the ability-score ratchet, the creation-lock guard, the AP-budget check, grants, and every stored row.

-- The key lists live in two tiny functions so they are visible in the database itself (COMMENT ON FUNCTION) and a later migration changes one line.
create or replace function public.pact_patch_exempt_keys()
 returns text[] language sql immutable set search_path to 'public', 'pg_temp'
as $function$ select array['appearance','houseRules','gold']::text[] $function$;
comment on function public.pact_patch_exempt_keys() is
  'PERMANENT: patch fields that carry no AP and stay editable after a lock/seal (appearance text, house-rule toggles, the legacy wallet field). Everything else in a buy/patch event is protected (fail-closed).';

create or replace function public.pact_patch_temp_exempt_keys()
 returns text[] language sql immutable set search_path to 'public', 'pg_temp'
as $function$ select array['traditions','innate','dabblerCantrips','martiallyBound','originClass','originClass2','species','species2','size','lineage']::text[] $function$;
comment on function public.pact_patch_temp_exempt_keys() is
  'TEMPORARY (stage 1, 2026-10-05): priced/identity patch fields the character-creation tool still rewrites in place after a lock until phase 2b ships (spellcasting, innate spells, martial binding, dabbler cantrips, species, origin classes, size, lineage). Removed by the stage-2 migration. Keep separate from the permanent list so an entry cannot quietly become permanent.';

-- The protected projection of ONE buy/patch event: its type, cat, stamped cost, gp/days and the NON-exempt fields of payload.patch.
-- Returns NULL when the patch has no protected field (an appearance-only event stays unprotected). A non-object patch yields NULL too:
-- turning a protected event into one shrinks the protected list, which the trigger refuses.
create or replace function public.pact_patch_protected_projection(p_ev jsonb)
 returns jsonb language sql immutable set search_path to 'public', 'pg_temp'
as $function$
  select case when s.n = 0 then null
              else jsonb_build_object('type', p_ev->'type', 'cat', p_ev->'cat', 'cost', p_ev->'cost',
                                      'gp', p_ev->'gp', 'days', p_ev->'days', 'patch', s.patch) end
  from (select count(*) as n, coalesce(jsonb_object_agg(kv.key, kv.value), '{}'::jsonb) as patch
          from jsonb_each(case when jsonb_typeof(p_ev->'payload'->'patch') = 'object' then p_ev->'payload'->'patch' else '{}'::jsonb end) as kv
         where kv.key <> all (public.pact_patch_exempt_keys() || public.pact_patch_temp_exempt_keys())) s;
$function$;
comment on function public.pact_patch_protected_projection(jsonb) is
  'E1: the part of a buy/patch event that is frozen once a character is locked, sealed or awarded. See sql/migrations/2026-10-05-server-freeze-d2-e1-stage1.sql.';

-- pact_ap_ledger_protected: patch events with a protected field join the protected list (E1).
create or replace function public.pact_ap_ledger_protected(p_log jsonb)
 returns jsonb
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(jsonb_agg(
           case when (ev->>'type') = 'buy' and coalesce(ev->>'cat','') = 'patch'
                then public.pact_patch_protected_projection(ev)
                else (ev - 'seq' - 'ts' - 'rules' - 'label') end
           order by ord), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_log,'[]'::jsonb)) with ordinality as t(ev, ord)
  where (ev->>'type') in ('buyoff','names','award','sessionSeal','dmRemoveBoon','dmUnlockDrawback')
     or ((ev->>'type') = 'buy' and coalesce(ev->>'cat','') <> 'patch')
     or ((ev->>'type') = 'buy' and coalesce(ev->>'cat','') = 'patch' and public.pact_patch_protected_projection(ev) is not null);
$function$;

-- pact_enforce_locked_history: add the lock boundary (D2). Everything else in the function is byte-for-byte the live definition.
create or replace function public.pact_enforce_locked_history()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_old_log jsonb; v_award_idx int; v_seal_idx int; v_lock_idx int; v_last_lock int; v_last_unlock int; v_idx int;
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

    -- D2 (owner, 2026-10-04): for a campaign character that is CURRENTLY locked, nothing before the lock may change. "Currently locked" =
    -- the last creationLocked is after the last creationUnlocked, so a DM reopening creation (dm_reopen_creation appends a creationUnlocked)
    -- lifts this boundary; the seal/award boundary above is untouched by a reopen. Solo characters are not covered (no DM; the owner decides).
    select max(ord) into v_last_lock
    from jsonb_array_elements(v_old_log) with ordinality as t(ev, ord)
    where (ev->>'type') = 'creationLocked';
    select max(ord) into v_last_unlock
    from jsonb_array_elements(v_old_log) with ordinality as t(ev, ord)
    where (ev->>'type') = 'creationUnlocked';
    if v_last_lock is not null and coalesce(v_last_unlock, 0) < v_last_lock then
      v_lock_idx := v_last_lock;
    end if;
  end if;

  v_idx := greatest(coalesce(v_seal_idx, 0), coalesce(v_award_idx, 0), coalesce(v_lock_idx, 0));
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
$function$;
