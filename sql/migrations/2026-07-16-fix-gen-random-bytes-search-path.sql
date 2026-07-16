-- Fix: gen_invite_code() and create_player_invite() call bare gen_random_bytes(...), but pgcrypto's
-- gen_random_bytes lives in the `extensions` schema on this project, not `public` -- and neither
-- function's search_path includes `extensions`. Result: campaign creation and player-invite creation
-- are currently broken everywhere in the deployed app (confirmed: zero campaign rows exist). Fix by
-- schema-qualifying the calls rather than widening search_path (avoids broadening what each function
-- can implicitly resolve -- see the separate pg_temp search_path hardening pass for the general
-- search_path posture of these SECURITY DEFINER functions).
-- See docs/TASK_BOARD.md "Fix broken campaign/invite creation" and DECISIONS.md
-- D-GH-2026-07-16-advancement-tracks-e2e (how the bug was originally found).

create or replace function public.gen_invite_code()
returns text language plpgsql set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  code text;
  raw  bytea;
begin
  loop
    raw := extensions.gen_random_bytes(6);
    code := '';
    for i in 0..5 loop
      code := code || substr(alphabet, 1 + (get_byte(raw, i) % 36), 1);
    end loop;
    exit when not exists (
      select 1 from public.campaigns where invite_code = code or dm_invite_code = code
    );
  end loop;
  return code;
end;
$$;

create or replace function public.create_player_invite(
  p_campaign_id     uuid,
  p_starting_ap     integer default 0,
  p_starting_budget integer default 0
)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_token  text;
  v_ap     integer := coalesce(p_starting_ap, 0);
  v_budget integer := coalesce(p_starting_budget, 0);
begin
  if not is_campaign_dm(p_campaign_id) then
    raise exception 'Only a campaign DM can create a player invite';
  end if;
  if v_ap < 0 or v_budget < 0 then
    raise exception 'Starting AP and budget must be non-negative';
  end if;

  loop
    v_token := encode(extensions.gen_random_bytes(16), 'hex');
    exit when not exists (select 1 from campaign_invites where token = v_token);
  end loop;

  insert into campaign_invites (campaign_id, token, starting_ap, starting_budget, created_by)
    values (p_campaign_id, v_token, v_ap, v_budget, auth.uid());

  return v_token;
end;
$$;
