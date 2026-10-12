-- PACT — rollback of 2026-10-12-server-player-award-after-lock.sql (D-GH-2026-10-12-server-player-award-after-lock).
-- Restores pact_enforce_player_ap_ceiling() exactly as 2026-09-03-dm-zero-player-ap.sql defined it (the body
-- below is copied verbatim; run-award.sh checks pg_get_functiondef is byte-identical after this file runs).
-- Deliberately KEPT: the EXECUTE revoke (a trigger function never needs it) and the trigger itself.
-- After a rollback the gap is open again: a player-appended award on a locked campaign character counts as
-- spendable AP unless the campaign ignores player AP.

create or replace function public.pact_enforce_player_ap_ceiling()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign  public.campaigns%rowtype;
  v_old_award numeric;
  v_new_award numeric;
begin
  if NEW.campaign_id is null then
    return NEW;
  end if;
  if NEW.stats is not distinct from OLD.stats then
    return NEW;
  end if;

  select * into v_campaign from public.campaigns where id = NEW.campaign_id;
  if not found or not v_campaign.ignore_player_ap then
    return NEW;  -- fail open, matching pact_enforce_ap_budget_consistency's own dangling-campaign case
  end if;

  select coalesce(sum((e->>'amount')::numeric), 0) into v_old_award
    from jsonb_array_elements(coalesce(OLD.stats->'LOG', '[]'::jsonb)) e
   where e->>'type' = 'award' and not coalesce((e->>'dmEdit')::boolean, false);
  select coalesce(sum((e->>'amount')::numeric), 0) into v_new_award
    from jsonb_array_elements(coalesce(NEW.stats->'LOG', '[]'::jsonb)) e
   where e->>'type' = 'award' and not coalesce((e->>'dmEdit')::boolean, false);

  if v_new_award > v_old_award then
    raise exception
      'PACT: this campaign''s DM has switched off player-entered AP — it can no longer be increased (ask your DM to raise it instead)';
  end if;

  return NEW;
end;
$$;

comment on function public.pact_enforce_player_ap_ceiling() is null;
