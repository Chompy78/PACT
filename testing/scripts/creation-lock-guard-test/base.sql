-- Harness base: stand-ins for Supabase pieces + the live definitions the guard sits beside.
create role anon nologin; create role authenticated nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif((nullif(current_setting('request.jwt.claims', true), '')::jsonb)->>'sub','')::uuid $$;
create table public.campaigns (id uuid primary key default gen_random_uuid(), dm_id uuid not null, name text not null default 'c');
create table public.campaign_dms (campaign_id uuid not null references public.campaigns(id) on delete cascade, dm_id uuid not null, primary key (campaign_id, dm_id));
create table public.characters (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, campaign_id uuid references public.campaigns(id),
  name text not null default 'New Character', kind text not null default 'livesheet', stats jsonb not null default '{}'::jsonb,
  ap integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  archived_at timestamptz, autosave_enabled boolean not null default true, gold integer not null default 0);
create table public.character_backups (
  id uuid primary key default gen_random_uuid(), character_id uuid not null, owner_id uuid not null, campaign_id uuid,
  name text not null, kind text not null, stats jsonb not null, ap integer not null, archived_at timestamptz,
  reason text not null, character_updated_at timestamptz, captured_at timestamptz not null default clock_timestamp());
create function public.is_campaign_dm(p_campaign uuid) returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $$
  select exists (select 1 from campaign_dms where campaign_id = p_campaign and dm_id = auth.uid()); $$;
create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
create or replace function public.pact_ap_ledger_protected(p_log jsonb)
returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg((ev - 'seq' - 'ts' - 'rules' - 'label') order by ord), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_log,'[]'::jsonb)) with ordinality as t(ev, ord)
  where (ev->>'type') in ('buyoff','names','award','sessionSeal','dmRemoveBoon')
     or ((ev->>'type') = 'buy' and coalesce(ev->>'cat','') <> 'patch');
$$;

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

create or replace function public.snapshot_character()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_reason text;
begin
  if TG_OP = 'DELETE' then
    v_reason := 'delete';
  elsif OLD.stats       is distinct from NEW.stats
     or OLD.name        is distinct from NEW.name
     or OLD.kind        is distinct from NEW.kind
     or OLD.ap          is distinct from NEW.ap
     or OLD.campaign_id is distinct from NEW.campaign_id
     or OLD.archived_at is distinct from NEW.archived_at then
    v_reason := 'update';
  else
    return NEW;   -- bare updated_at touch: not worth a retention slot
  end if;

  insert into public.character_backups
    (character_id, owner_id, campaign_id, name, kind, stats, ap, archived_at, reason,
     character_updated_at)
  values
    (OLD.id, OLD.owner_id, OLD.campaign_id, OLD.name, OLD.kind, OLD.stats, OLD.ap, OLD.archived_at,
     v_reason, OLD.updated_at);

  if v_reason = 'update' then
    delete from public.character_backups b
     where b.character_id = OLD.id
       and b.reason = 'update'
       and b.id not in (
         select id from public.character_backups
          where character_id = OLD.id and reason = 'update'
          order by captured_at desc, id desc
          limit 50
       );
  end if;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;


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

