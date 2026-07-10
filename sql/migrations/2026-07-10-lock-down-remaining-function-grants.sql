-- PACT — lock down remaining Supabase function EXECUTE grants (anon)
--
-- Postgres grants EXECUTE to PUBLIC by default on every new function, which is what
-- award_ap's lockdown (see 2026-07-02-drop-legacy-award-xp-lock-award-ap.sql, D-GH15)
-- already fixed for that one function. The Supabase security advisor still flags the
-- remaining ~13 functions as anon-callable via /rest/v1/rpc/*. Full safety analysis
-- (nothing here is actually exploitable today — this is hygiene/defense-in-depth, not
-- an urgent fix) lives in DECISIONS.md D-GH15, re-verified live 2026-07-02:
--   * Trigger-only functions (returns trigger) can't be invoked directly via RPC
--     regardless of grant — Postgres rejects it outright — so no replacement grant
--     is needed for those three.
--   * Every RPC/helper below gates on auth.uid(), which is NULL for anon, so an
--     anon caller is already rejected internally; this migration just removes the
--     redundant PUBLIC grant so the safety doesn't rest solely on that internal check.

-- ---------------------------------------------------------------------------
-- Trigger-only functions: revoke execute from public, no replacement grant.
-- ---------------------------------------------------------------------------
revoke execute on function public.handle_new_user()   from public;
revoke execute on function public.add_owner_as_dm()    from public;
revoke execute on function public.set_updated_at()     from public;

-- ---------------------------------------------------------------------------
-- Client-facing RPCs already granted to authenticated in rls-policies.sql:
-- just strip the redundant PUBLIC grant, behaviour for authenticated is unchanged.
-- ---------------------------------------------------------------------------
revoke execute on function public.join_campaign(text)             from public;
revoke execute on function public.join_as_dm(text)                from public;
revoke execute on function public.promote_to_dm(uuid, uuid)       from public;
revoke execute on function public.remove_dm(uuid, uuid)           from public;
revoke execute on function public.regenerate_invite_code(uuid)    from public;
revoke execute on function public.regenerate_dm_invite_code(uuid) from public;

-- ---------------------------------------------------------------------------
-- Internal-only helpers with no explicit grant today: grant to authenticated
-- FIRST so their behaviour for authenticated doesn't change, THEN revoke from
-- public.
-- ---------------------------------------------------------------------------
grant execute on function public.gen_invite_code()          to authenticated;
grant execute on function public.is_campaign_dm(uuid)        to authenticated;
grant execute on function public.is_campaign_member(uuid)    to authenticated;
grant execute on function public.is_campaign_owner(uuid)     to authenticated;
grant execute on function public.shares_campaign(uuid)       to authenticated;

revoke execute on function public.gen_invite_code()          from public;
revoke execute on function public.is_campaign_dm(uuid)        from public;
revoke execute on function public.is_campaign_member(uuid)    from public;
revoke execute on function public.is_campaign_owner(uuid)     from public;
revoke execute on function public.shares_campaign(uuid)       from public;
