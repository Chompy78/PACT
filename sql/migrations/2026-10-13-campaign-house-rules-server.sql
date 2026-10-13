-- PACT — campaign-wide house rules, the server half (PR3 of feat/campaign-house-rules).
-- feat/campaign-house-rules-server · decision D-GH-2026-10-13-campaign-house-rules · plan docs/plans/2026-10-13-campaign-house-rules.md
-- (§6.1–6.5, ADDENDUM M1/M3/M4/X1, owner decision Z1, post-review notes).
--
-- *** NOT APPLIED to the live database by merging this file. *** The owner applies it, then runs get_advisors (security +
-- performance) and skims get_logs, per AGENTS.md. Until it is applied, sql/rls-policies.sql correctly describes production
-- and is deliberately NOT changed (sql/migrations/README.md; precedents #580 -> #598, #600 -> #608): the fold into the
-- baseline, and adding this file to the \ir lists of testing/sql/session-seal-test.sql and rls-baseline-test.sql, is a
-- later PR made after the apply.
--
-- Rehearsed on a throwaway Postgres: testing/scripts/creation-lock-guard-test/run-house-rules.sh (BEFORE: the new
-- cases fail on today's definitions; AFTER: every case passes; rollback: every changed definition byte-identical).
-- Rollback: 2026-10-13-campaign-house-rules-server-rollback.sql.
--
-- APPLY ATOMICALLY. Neither file carries BEGIN/COMMIT: the Supabase apply_migration path already runs a migration in one
-- transaction, and an explicit COMMIT inside it would end that transaction early. A MANUAL apply must be single-transaction:
-- `psql -1 -v ON_ERROR_STOP=1 -f <file>` (run-house-rules.sh applies both files exactly that way).
--
-- BASE OF THE REDEFINED FUNCTIONS. Each `create or replace` below of an EXISTING function was generated on 2026-10-13
-- from sql/rls-policies.sql (stage 1 + stage 2 of the server freeze are folded there and recorded as applied; the
-- 2026-10-04 dm-unlock-drawback header records dm_edit_character_log as hash-equal to production). RE-VERIFY against
-- production immediately before applying — sql/migrations/README.md explains why (2026-09-02):
--   select p.proname, md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname in ('pact_ap_ledger_spend', 'pact_enforce_ap_budget_consistency',
--      'pact_ap_ledger_protected', 'pact_enforce_locked_history', 'dm_edit_character_log') order by 1;
-- and compare with the same query on a scratch database built from schema.sql + rls-policies.sql (run-house-rules.sh prints
-- these hashes as "BASE"). If any differs, rebuild the redefinition from the LIVE text instead of applying this file.
-- Two related migrations are written and NOT applied either; neither redefines a function this file redefines:
--   2026-10-12-server-player-award-after-lock.sql (pact_enforce_player_ap_ceiling) and PR #642's
--   2026-10-12-dm-house-rules-edit.sql (dm_edit_character_log buy/patch — SUPERSEDED by the dmHouseRules event here;
--   PR5 reworks #642 onto this file and must not apply its own migration).
--
-- =====================================================================================================================
-- WHAT THIS ADDS / CHANGES
-- =====================================================================================================================
-- 1. campaigns.rules.charHouseRules guard (plan §6.1). A BEFORE INSERT OR UPDATE trigger on campaigns keeps the key as it
--    was unless the transaction-local GUC pact.hr_rpc = 'on', which only dm_apply_house_rules_change() sets (around its
--    own one UPDATE, then clears it). DM Console's whole-blob "Save rules" therefore can neither erase nor forge the key;
--    it is silently carried over (the rest of the blob saves as before). Admin sessions (no JWT) may write it directly.
--    A client cannot set the GUC: PostgREST exposes only functions in `public`, and set_config is in pg_catalog.
-- 2. dm_apply_house_rules_change(p_campaign, p_char_house_rules, p_actions) — the ONE validated writer (§6.2, M3, M4).
--    Writes rules.charHouseRules (validated) and appends, per action, one server-stamped DM event to a character's LOG:
--      {kind:'override'|'pin', character, overrides}            -> {type:'dmHouseRules', overrides, campaignId}
--      {kind:'reprice', character, name, targetSeq, amount, from, to} -> {type:'dmRepriceDrawback', ...}
--      {kind:'refundBoon', character, name, targetSeq}          -> {type:'dmRefundBoon', cost: -target.cost}
--      {kind:'removeDrawback', character, name, targetSeq}      -> {type:'dmRemoveDrawback', grantBack: -target.cost + ΣΔ}
--    All in one transaction; any refusal rolls back everything. The three AP-moving kinds are refused unless the target is
--    exactly what js/engine.js activeEvents() would match (decision record, "What PR3's RPC must refuse") — and, since the
--    PR #654 review, the ledger ALSO counts such an event only when it matches (item 4), so the two checks back each other:
--      unknown targetSeq · wrong type or name · two purchases sharing seq+name (ambiguous) · already bought off / removed /
--      refunded / DM-removed · a non-finite or non-integer amount · DM-imposed drawback / DM-granted boon · a character
--      not currently creation-locked · not in this campaign · an archived character. A target always PRECEDES the event
--    (it is appended). A DM's own NPC is accepted, like every other DM write path (dm_edit_character_log, award_ap).
--    M3: a reprice's `from` must equal the target's ledger grant (−cost + ΣΔ of earlier matched reprices) and `to` its new
--    effective value (DM pin > DM override > campaign charHouseRules); when none of those names it, the effective value is
--    the PRINTED one, which this database cannot know (it has no copy of js/engine-data.js and must not get one), so `to`
--    is then accepted within 0..1000 — the printed-value fallback the orchestrator asked for. amount = to − from always.
-- 3. dm_edit_character_log() also accepts {type:'dmHouseRules', overrides} (same validator; campaignId stamped). Allowed
--    on a creation draft (it is not a buy, so repriceDraft never touches it). The three AP-moving types stay refused there:
--    they are RPC-only (orchestrator decision).
-- 4. Ledger (§6.4 + M1 + M4 + X1 + Z1). New pact_ap_ledger_split(log) -> (spent, award_earned, drawback_earned):
--      spent           buy (non-patch, non-drawback) + buyoff + names costs (unchanged) + dmRefundBoon.cost (matched)
--      award_earned    award amounts (unchanged)
--      drawback_earned −cost of every drawback buy (unchanged) + dmRepriceDrawback.amount − dmRemoveDrawback.grantBack
--                      (matched) − M4: the grant (−cost + ΣΔ) of each purchase a buyoff provably cancelled — a buyoff
--                      whose `targetSeq` equals the seq of the purchase js/engine.js's FIFO match cancels. A buyoff
--                      without one keeps the old approximation (its grant stays): more lenient, never a mint, since the
--                      buy-off itself cost 3x the value. The Live Sheet starts stamping targetSeq in PR2.
--    "matched" = DM-stamped (dmEdit = true) AND resolved to its target exactly as js/engine.js activeEvents().dmMatched
--    resolves it (pact_hr_resolve: by targetSeq + name, unique, still held, finite amount) — PR #654 review. Every amount is
--    read as Number(x) || 0 (pact_num), as the engine reads it, so a malformed cost string counts 0 instead of raising
--    (a raise blocked every save of that character, by anyone).
--    pact_ap_ledger_spend(log) keeps its signature (clients may call it) and returns award_earned + drawback_earned.
--    pact_enforce_ap_budget_consistency() now uses
--      spendable = ap + (ignore_player_ap ? 0 : award_earned) + capped(drawback_earned)
--    X1: a drawback's grant no longer vanishes in an ignore-player-AP campaign (the engine never dropped it, v0.356).
--    Z1 (owner, 2026-10-13): capped(x) = least(cap, x) where cap = pact_hr_drawback_cap(campaign.rules) — exactly
--    js/campaign.js drawbackCapFromRules(): the DM's rules.drawbackCap.ap when the drawbackCap object is present and not
--    enabled:false (Number() of it, at least 0), and NO cap when the DM switched it off or never set it.
-- 5. History protection. pact_ap_ledger_protected() gains dmHouseRules / dmRefundBoon / dmRemoveDrawback /
--    dmRepriceDrawback, and keeps the `seq` of buy and buyoff events (PR #654 review: renumbering a frozen purchase would
--    un-match the DM event aimed at it; no client renumbers one — dm-family-roundtrip-e2e.mjs checks both tools, and
--    roundtrip-audit.mjs now checks it on a live export); pact_enforce_locked_history() also freezes, for a campaign character, everything up to its LAST
--    DM-stamped AP-moving event (§6.5) — the client's undo barrier, now server-side.
-- 6. M1 forgery guard: pact_enforce_dm_family() (trigger trg_pact_dm_family_guard). On a campaign character, a writer who
--    is neither a DM of its (old or new) campaign nor an admin session may not add, change, remove or reorder any event in
--    its "DM family": every event with a truthy dmEdit, and every event of a DM-only type — dmHouseRules, dmRefundBoon,
--    dmRemoveDrawback, dmRepriceDrawback, dmRemoveBoon, dmUnlockDrawback, sessionSeal — whatever its flags. The ledger
--    counts the AP-moving types only when DM-stamped and matched, and nothing but a DM can now put one there.
--    One relaxation: in a creation DRAFT a DM-stamped boon buy's cost may be raised (never lowered, nothing else changed) —
--    the engine on `main` before rules v0.377 re-prices DM buys in a draft. In practice a DM boon GRANT is followed by its
--    matched award, a locked-history boundary that already freezes the buy today, so this only covers a DM buy with no
--    award after it.
--
-- WHAT IT DELIBERATELY LEAVES ALONE
--   * pact_patch_exempt_keys(): houseRules stays exempt. Under owner decision U1 a campaign character's own houseRules
--     patch is ignored by compute() while bound (feat/server-freeze-houserules-gold covers the solo case).
--   * pact_enforce_player_ap_ceiling() (2026-09-03 live / 2026-10-12 written): untouched. Its DM exemption is by WHO.
--   * The DM-granted boon path (dm_edit_character_log buy + matched award), award_ap(), award_ap_and_seal(),
--     dm_zero_player_ap(), seal_character_history(): unchanged, and each still works with the guard on (all are DMs).
--   * Every GRANT on a redefined function: `create or replace` keeps them.
--
-- KNOWN RESIDUAL RISK (plan §6.7, corrected by the PR #654 review). The forgery guard covers CAMPAIGN characters, and a
-- player cannot leave a campaign (dm_unbind_character is the only way out). The two real paths into campaign X with DM-stamped
-- AP events no DM of X wrote: (1) forge them on a SOLO character (no guard) before its first join; (2) create a campaign Y
-- (anyone can), dm_bind_npc their own character into it, write the events as Y's DM, dm_unbind_character it, and join X.
-- Joining X needs X's invite code; the join does not change `stats`, so nothing compares the events. Follow-up on the board:
-- count AP-moving DM events only when their stamped campaignId equals the character's current campaign_id (the engine must
-- do the same so browser and server keep agreeing — that is why it is not done here), or move the counted amounts into a
-- server-side table the RPC writes.
--
-- =====================================================================================================================
-- BLAST RADIUS — measured NOTHING live (this session cannot reach the database). Run these READ-ONLY queries before
-- applying; the expected answers assume the 2026-10-13 measurement (37 characters, 10 campaign-bound in one ignore-mode
-- campaign) still holds.
-- =====================================================================================================================
-- Q1 nothing the new code reads exists yet (expect 0 and 0):
--   select count(*) from campaigns where rules ? 'charHouseRules';
--   select count(*) from characters c, jsonb_array_elements(coalesce(c.stats->'LOG','[]')) e
--    where e->>'type' in ('dmHouseRules','dmRefundBoon','dmRemoveDrawback','dmRepriceDrawback') or (e->>'type' = 'buyoff' and e ? 'targetSeq');
-- Q2 the M1 guard freezes these existing events for their players (each must be one a DM wrote; a non-DM-stamped sessionSeal
--    is a solo self-seal, fine):
--   select c.id, c.campaign_id is not null as bound, e->>'type' as type, e->'dmEdit' as dm_edit, count(*)
--     from characters c, jsonb_array_elements(coalesce(c.stats->'LOG','[]')) e
--    where (e ? 'dmEdit' and e->'dmEdit' not in ('false'::jsonb, 'null'::jsonb, '0'::jsonb, '""'::jsonb))
--       or e->>'type' in ('dmRemoveBoon','dmUnlockDrawback','sessionSeal')
--    group by 1, 2, 3, 4 order by 1;
--    Then re-run testing/scripts/creation-lock-guard-test/roundtrip-audit.mjs on a fresh read-only export: it now also
--    reports whether loading + saving each character in CharGen and the Live Sheet leaves this family untouched.
-- Q3 who the new budget formula moves (X1 adds drawback grants in ignore-mode campaigns; Z1 caps them where the DM set a cap;
--    M4 changes nothing until a buyoff carries targetSeq). The trigger refuses only a save that INCREASES spend beyond
--    spendable, so no stored character is refused for merely existing; this lists who would be "over budget" for their
--    next purchase. A dry run: the migration is applied inside a transaction that is rolled back (Postgres DDL is
--    transactional), so nothing persists:
--      begin;
--      \i sql/migrations/2026-10-13-campaign-house-rules-server.sql
--      select c.id, c.name, cp.ignore_player_ap, pact_hr_drawback_cap(cp.rules) as cap, c.ap,
--             c.ap + (case when cp.ignore_player_ap then 0 else o.old_earned end) - o.old_spent as old_left,
--             c.ap + (case when cp.ignore_player_ap then 0 else s.award_earned end)
--               + (case when pact_hr_drawback_cap(cp.rules) is null then s.drawback_earned
--                       else least(pact_hr_drawback_cap(cp.rules), s.drawback_earned) end) - s.spent as new_left
--        from characters c join campaigns cp on cp.id = c.campaign_id
--        cross join lateral pact_ap_ledger_split(c.stats->'LOG') s
--        cross join lateral (select   -- the pre-migration pact_ap_ledger_spend sums, inline
--            coalesce(sum(case when e->>'type' = 'award' then coalesce((e->>'amount')::numeric, 0)
--                              when e->>'type' = 'buy' and coalesce(e->>'cat','') = 'drawback' then -coalesce((e->>'cost')::numeric, 0)
--                              else 0 end), 0) as old_earned,
--            coalesce(sum(case when e->>'type' in ('buyoff','names')
--                                or (e->>'type' = 'buy' and coalesce(e->>'cat','') not in ('patch','drawback'))
--                              then coalesce((e->>'cost')::numeric, 0) else 0 end), 0) as old_spent
--          from jsonb_array_elements(coalesce(c.stats->'LOG','[]'::jsonb)) e) o
--       order by new_left - old_left, c.name;
--      rollback;
--    Expect new_left >= old_left except where a DM cap now applies; a new_left < 0 is a character who can still save but
--    cannot buy until their DM awards AP.
-- Q4 the drawback-cap settings the server will now enforce:
--   select id, name, ignore_player_ap, rules->'drawbackCap' as drawback_cap, rules->'enforceApBudget' as enforce from campaigns order by name;
-- =====================================================================================================================


-- ---------------------------------------------------------------------------------------------------------------------
-- Helpers: JavaScript value semantics, so the server reads a jsonb value exactly the way js/campaign.js / js/engine.js do.
-- ---------------------------------------------------------------------------------------------------------------------

-- pact_js_truthy(v): Boolean(v) for a JSON value; a missing key (SQL NULL) is undefined -> false.
create or replace function public.pact_js_truthy(p jsonb)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select case
    when p is null then false
    when jsonb_typeof(p) = 'null' then false
    when jsonb_typeof(p) = 'boolean' then p = 'true'::jsonb
    when jsonb_typeof(p) = 'number' then (p #>> '{}')::numeric <> 0
    when jsonb_typeof(p) = 'string' then (p #>> '{}') <> ''
    else true end;
$$;

-- pact_js_number(v): Number(v) for a JSON value, NULL standing for NaN and for +/-Infinity (callers want "finite or not").
-- undefined (SQL NULL) -> NaN · null -> 0 · true/false -> 1/0 · number -> itself · string -> JS StringToNumber (trimmed;
-- '' -> 0; decimal with optional sign/exponent; 0x / 0b / 0o literals) · [] -> 0 · [x] -> Number of x's string form ·
-- longer arrays / objects -> NaN. One deliberate approximation: [true] is 1 here, NaN in JS (no tool writes it).
create or replace function public.pact_js_number(p jsonb)
returns numeric language plpgsql immutable set search_path = public, pg_temp as $$
declare
  t text; s text; n numeric := 0; base int; dig int; c text; i int;
begin
  if p is null then return null; end if;
  t := jsonb_typeof(p);
  if t = 'null' then return 0;
  elsif t = 'boolean' then return case when p = 'true'::jsonb then 1 else 0 end;
  elsif t = 'number' then
    n := (p #>> '{}')::numeric;
    return case when abs(n) > 1.7976931348623157e308 then null else n end;
  elsif t = 'array' then
    if jsonb_array_length(p) = 0 then return 0; end if;
    if jsonb_array_length(p) > 1 then return null; end if;
    return public.pact_js_number(p -> 0);
  elsif t <> 'string' then
    return null;
  end if;
  s := btrim(p #>> '{}', E' \t\n\r\f\u000b ﻿  ');
  if s = '' then return 0; end if;
  if s ~ '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$' then
    begin
      n := s::numeric;
    exception when others then
      return null;
    end;
    return case when abs(n) > 1.7976931348623157e308 then null else n end;
  end if;
  if s ~ '^0[xX][0-9a-fA-F]+$' then base := 16;
  elsif s ~ '^0[bB][01]+$' then base := 2;
  elsif s ~ '^0[oO][0-7]+$' then base := 8;
  else return null;
  end if;
  for i in 3 .. length(s) loop
    c := lower(substr(s, i, 1));
    dig := position(c in '0123456789abcdef') - 1;
    n := n * base + dig;
    if n > 1.7976931348623157e308 then return null; end if;
  end loop;
  return n;
end;
$$;

-- pact_hr_drawback_cap(rules) — owner decision Z1: the drawback AP cap the server applies, mirroring
-- js/campaign.js drawbackCapFromRules() and compute()'s Math.max(0, cap). NULL = no cap (the DM switched it off, or never
-- set one). testing/scripts/creation-lock-guard-test/drawback-cap-shapes.json holds 45 shapes generated from the real JS
-- function; run-house-rules.sh asserts this one agrees on every one, and house-rules-ledger-ci.mjs asserts the JS side.
create or replace function public.pact_hr_drawback_cap(p_rules jsonb)
returns numeric language plpgsql immutable set search_path = public, pg_temp as $$
declare
  c jsonb; n numeric;
begin
  if p_rules is null or jsonb_typeof(p_rules) <> 'object' then return null; end if;
  c := p_rules -> 'drawbackCap';
  if not public.pact_js_truthy(c) or jsonb_typeof(c) <> 'object' then return null; end if;   -- a non-object has no .ap
  if c -> 'enabled' = 'false'::jsonb then return null; end if;
  n := public.pact_js_number(c -> 'ap');
  if n is null then return null; end if;
  return greatest(0, n);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- House-rules shape validator (#642's checks, moved here and shared; plan §6.2). Raises on anything it does not accept.
--   p_layer 'campaign' — campaigns.rules.charHouseRules: {schema?:1, dmAllows?, boons?, draws?}
--   p_layer 'override' — a dmHouseRules event's overrides: {dmAllows?, boons?, draws?, disabled?, pins?:{draws?}}
-- dmAllows: bound/boons/drawbacks/tasha -> boolean · boons: name -> {hd 1-20, ap 0-1000 (whole numbers), fx? <=500} ·
-- draws: name -> {ap 0-1000, fx?} · disabled: {boons?:[name], draws?:[name]} · pins.draws: name -> {ap 0-1000, reason? <=200,
-- at? <=64}. Names: 1-80 characters, not blank, never __proto__ / constructor / prototype (js/engine.js drops those, so a
-- server that accepted one would price something the browser does not see). The whole object <= 32 KB.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.pact_hr_entry_ok(p_name text, p_val jsonb, p_kind text)
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare
  k text; v jsonb;
begin
  if p_name is null or btrim(p_name) = '' or char_length(p_name) > 80
     or p_name in ('__proto__', 'constructor', 'prototype') then return false; end if;
  if p_val is null or jsonb_typeof(p_val) <> 'object' then return false; end if;
  for k, v in select key, value from jsonb_each(p_val) loop
    if p_kind = 'boon' and k not in ('hd', 'ap', 'fx') then return false; end if;
    if p_kind = 'draw' and k not in ('ap', 'fx') then return false; end if;
    if p_kind = 'pin'  and k not in ('ap', 'reason', 'at') then return false; end if;
    if k = 'fx' and (jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 500) then return false; end if;
    if k = 'reason' and (jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 200) then return false; end if;
    if k = 'at' and (jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 64) then return false; end if;
  end loop;
  if jsonb_typeof(p_val -> 'ap') is distinct from 'number' then return false; end if;
  if (p_val ->> 'ap')::numeric not between 0 and 1000 or (p_val ->> 'ap')::numeric <> trunc((p_val ->> 'ap')::numeric) then return false; end if;
  if p_kind = 'boon' then
    if jsonb_typeof(p_val -> 'hd') is distinct from 'number' then return false; end if;
    if (p_val ->> 'hd')::numeric not between 1 and 20 or (p_val ->> 'hd')::numeric <> trunc((p_val ->> 'hd')::numeric) then return false; end if;
  end if;
  return true;
end;
$$;

create or replace function public.pact_hr_validate(p_hr jsonb, p_layer text)
returns void language plpgsql immutable set search_path = public, pg_temp as $$
declare
  k text; v jsonb; x jsonb; d record;
begin
  if p_hr is null or jsonb_typeof(p_hr) <> 'object' then
    raise exception 'PACT house rules: must be an object';
  end if;
  if octet_length(p_hr::text) > 32768 then
    raise exception 'PACT house rules: too large (32 KB at most)';
  end if;
  for k, v in select key, value from jsonb_each(p_hr) loop
    if p_layer = 'campaign' and k not in ('schema', 'dmAllows', 'boons', 'draws') then
      raise exception 'PACT house rules: unknown field "%" (campaign rules take schema, dmAllows, boons, draws; disabled items are the campaign ban lists)', k;
    end if;
    if p_layer = 'override' and k not in ('dmAllows', 'boons', 'draws', 'disabled', 'pins') then
      raise exception 'PACT house rules: unknown override field "%"', k;
    end if;
    if k = 'schema' and v is distinct from '1'::jsonb then
      raise exception 'PACT house rules: schema must be 1';
    elsif k = 'dmAllows' then
      if jsonb_typeof(v) <> 'object' then raise exception 'PACT house rules: dmAllows must be an object'; end if;
      for d in select key, value from jsonb_each(v) loop
        if d.key not in ('bound', 'boons', 'drawbacks', 'tasha') or jsonb_typeof(d.value) <> 'boolean' then
          raise exception 'PACT house rules: dmAllows must map bound/boons/drawbacks/tasha to true or false';
        end if;
      end loop;
    elsif k in ('boons', 'draws') then
      if jsonb_typeof(v) <> 'object' then raise exception 'PACT house rules: % must be an object', k; end if;
      for d in select key, value from jsonb_each(v) loop
        if not public.pact_hr_entry_ok(d.key, d.value, case when k = 'boons' then 'boon' else 'draw' end) then
          if k = 'boons' then
            raise exception 'PACT house rules: boon "%" needs a name, whole-number hd 1-20, whole-number ap 0-1000 and an optional short fx', left(d.key, 80);
          end if;
          raise exception 'PACT house rules: drawback "%" needs a name, whole-number ap 0-1000 and an optional short fx', left(d.key, 80);
        end if;
      end loop;
    elsif k = 'disabled' then
      if jsonb_typeof(v) <> 'object' then raise exception 'PACT house rules: disabled must be an object'; end if;
      for d in select key, value from jsonb_each(v) loop
        if d.key not in ('boons', 'draws') or jsonb_typeof(d.value) <> 'array' then
          raise exception 'PACT house rules: disabled must hold boons/draws lists of names';
        end if;
        for x in select value from jsonb_array_elements(d.value) loop
          if jsonb_typeof(x) <> 'string' or char_length(x #>> '{}') > 80 then
            raise exception 'PACT house rules: disabled must hold boons/draws lists of names';
          end if;
        end loop;
      end loop;
    elsif k = 'pins' then
      if jsonb_typeof(v) <> 'object' or exists (select 1 from jsonb_object_keys(v) as pk where pk <> 'draws') then
        raise exception 'PACT house rules: pins may hold draws only';
      end if;
      if v ? 'draws' then
        if jsonb_typeof(v -> 'draws') <> 'object' then raise exception 'PACT house rules: pins.draws must be an object'; end if;
        for d in select key, value from jsonb_each(v -> 'draws') loop
          if not public.pact_hr_entry_ok(d.key, d.value, 'pin') then
            raise exception 'PACT house rules: pinned drawback "%" needs whole-number ap 0-1000 and optional short reason/at', left(d.key, 80);
          end if;
        end loop;
      end if;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- pact_hr_resolve(log) — the part of js/engine.js activeEvents() the server needs, walked the same way in one forward pass:
-- which purchase each buyoff / dmRemoveBoon cancels (FIFO by name, oldest open first), and which purchase each DM-stamped
-- dmRefundBoon / dmRemoveDrawback / dmRepriceDrawback matched (by targetSeq + name, unique among the purchases BEFORE it;
-- a shared seq+name matches nothing; a non-finite amount matches nothing; a target no longer open matches nothing).
-- Like the engine it skips falsy log entries (filter(Boolean)) and purchases with no payload.v.
-- Returns {purchases:[{n, ord, cat, name, seq, cost, dmEdit, status, delta}], dmap, bmap, buyoffs}
--   n       1-based purchase number            ord     1-based position in the raw log
--   status  open | boughtOff | removed (dmRemoveDrawback) | refunded (dmRefundBoon) | dmRemoved (dmRemoveBoon)
--   delta   ΣΔ of the dmRepriceDrawback events matched to it
--   dmap / bmap  'seq|name' -> n, or -1 when two drawback (resp. boon) purchases share it (as of the END of the log)
--   buyoffs      'ord of a buyoff' -> n of the purchase it cancelled
--   matched      'ord of a DM-stamped refund / removal / reprice' -> n of the purchase it matched (js/engine.js dmMatched)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.pact_hr_resolve(p_log jsonb)
returns jsonb language plpgsql immutable set search_path = public, pg_temp as $$
declare
  ev jsonb; o bigint; t text; cat text; v text; k text; j int; q jsonb; amt jsonb;
  n int := 0;
  a_ord bigint[] := '{}'; a_cat text[] := '{}'; a_name text[] := '{}'; a_seq text[] := '{}';
  a_cost jsonb[] := '{}'; a_dm jsonb[] := '{}'; a_status text[] := '{}'; a_delta numeric[] := '{}';
  dq jsonb := '{}'; bq jsonb := '{}'; dmap jsonb := '{}'; bmap jsonb := '{}'; bo jsonb := '{}'; mt jsonb := '{}';
  out jsonb := '[]'; i int;
begin
  for ev, o in select e, x.ord from jsonb_array_elements(case when jsonb_typeof(p_log) = 'array' then p_log else '[]'::jsonb end) with ordinality as x(e, ord) loop
    if not public.pact_js_truthy(ev) or jsonb_typeof(ev) <> 'object' then continue; end if;
    t := ev ->> 'type';
    if t = 'buy' and (ev ->> 'cat') in ('drawback', 'boon') then
      cat := ev ->> 'cat';
      v := ev -> 'payload' ->> 'v';
      if v is null then continue; end if;
      n := n + 1;
      a_ord := a_ord || o; a_cat := a_cat || cat; a_name := a_name || v; a_seq := a_seq || (ev ->> 'seq');
      a_cost := a_cost || coalesce(ev -> 'cost', 'null'::jsonb); a_dm := a_dm || coalesce(ev -> 'dmEdit', 'null'::jsonb);
      a_status := a_status || 'open'::text; a_delta := a_delta || 0::numeric;
      if cat = 'drawback' then
        dq := jsonb_set(dq, array[v], coalesce(dq -> v, '[]'::jsonb) || to_jsonb(n));
      else
        bq := jsonb_set(bq, array[v], coalesce(bq -> v, '[]'::jsonb) || to_jsonb(n));
      end if;
      if (ev ->> 'seq') is not null then
        k := (ev ->> 'seq') || '|' || v;
        if cat = 'drawback' then
          dmap := dmap || jsonb_build_object(k, case when dmap ? k then -1 else n end);
        else
          bmap := bmap || jsonb_build_object(k, case when bmap ? k then -1 else n end);
        end if;
      end if;
    elsif t in ('dmRemoveDrawback', 'dmRepriceDrawback', 'dmRefundBoon') then
      if ev -> 'dmEdit' is distinct from 'true'::jsonb or (ev ->> 'refVal') is null or (ev ->> 'targetSeq') is null then continue; end if;
      amt := case t when 'dmRemoveDrawback' then ev -> 'grantBack' when 'dmRepriceDrawback' then ev -> 'amount' else ev -> 'cost' end;
      if amt is not null and jsonb_typeof(amt) <> 'null' and public.pact_js_number(amt) is null then continue; end if;
      if t <> 'dmRemoveDrawback' and public.pact_js_number(amt) is null then continue; end if;
      k := (ev ->> 'targetSeq') || '|' || (ev ->> 'refVal');
      j := case when t = 'dmRefundBoon' then (bmap ->> k)::int else (dmap ->> k)::int end;
      if j is null or j < 0 or a_status[j] <> 'open' then continue; end if;
      mt := mt || jsonb_build_object(o::text, j);
      if t = 'dmRepriceDrawback' then
        a_delta[j] := a_delta[j] + public.pact_js_number(amt);
      elsif t = 'dmRemoveDrawback' then
        a_status[j] := 'removed';
        dq := jsonb_set(dq, array[ev ->> 'refVal'], coalesce((select jsonb_agg(y.x) from jsonb_array_elements(dq -> (ev ->> 'refVal')) as y(x) where y.x <> to_jsonb(j)), '[]'::jsonb));
      else
        a_status[j] := 'refunded';
        bq := jsonb_set(bq, array[ev ->> 'refVal'], coalesce((select jsonb_agg(y.x) from jsonb_array_elements(bq -> (ev ->> 'refVal')) as y(x) where y.x <> to_jsonb(j)), '[]'::jsonb));
      end if;
    elsif t = 'buyoff' then
      v := ev ->> 'refVal';
      if v is null then continue; end if;
      q := dq -> v;
      if q is not null and jsonb_array_length(q) > 0 then
        j := (q ->> 0)::int;
        dq := jsonb_set(dq, array[v], q - 0);
        a_status[j] := 'boughtOff';
        bo := bo || jsonb_build_object(o::text, j);
      end if;
    elsif t = 'dmRemoveBoon' then
      v := ev ->> 'refVal';
      if v is null then continue; end if;
      q := bq -> v;
      if q is not null and jsonb_array_length(q) > 0 then
        j := (q ->> 0)::int;
        bq := jsonb_set(bq, array[v], q - 0);
        a_status[j] := 'dmRemoved';
      end if;
    end if;
  end loop;
  for i in 1 .. n loop
    out := out || jsonb_build_array(jsonb_build_object('n', i, 'ord', a_ord[i], 'cat', a_cat[i], 'name', a_name[i], 'seq', a_seq[i],
      'cost', a_cost[i], 'dmEdit', a_dm[i], 'status', a_status[i], 'delta', a_delta[i]));
  end loop;
  return jsonb_build_object('purchases', out, 'dmap', dmap, 'bmap', bmap, 'buyoffs', bo, 'matched', mt);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- The ledger (plan §6.4, M1, M4). See the header for the sums.
-- pact_num(v): Number(v) || 0, as js/engine.js reads every frozen amount — a malformed string counts 0 instead of raising
-- (a raise here would block every save of that character, by anyone, until an admin repaired the row).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.pact_num(p jsonb)
returns numeric language sql immutable set search_path = public, pg_temp as $$
  select coalesce(public.pact_js_number(p), 0);
$$;

create or replace function public.pact_ap_ledger_split(p_log jsonb)
returns table(spent numeric, award_earned numeric, drawback_earned numeric)
language plpgsql stable set search_path = public, pg_temp as $$
declare
  ev jsonb;
  o bigint;
  v_spent numeric := 0;
  v_award numeric := 0;
  v_draw numeric := 0;
  v_need boolean := false;
  r jsonb; b record; p jsonb;
begin
  for ev in select * from jsonb_array_elements(case when jsonb_typeof(p_log) = 'array' then p_log else '[]'::jsonb end) loop
    if (ev->>'type') = 'award' then
      v_award := v_award + public.pact_num(ev->'amount');
    elsif (ev->>'type') = 'buy' and coalesce(ev->>'cat','') = 'drawback' then
      -- drawback cost is stored negative (a refund); js/engine.js's economy() negates it into earned.
      v_draw := v_draw - public.pact_num(ev->'cost');
    elsif (ev->>'type') in ('buyoff','names') or ((ev->>'type') = 'buy' and coalesce(ev->>'cat','') <> 'patch') then
      v_spent := v_spent + public.pact_num(ev->'cost');
      if (ev->>'type') = 'buyoff' and (ev->>'targetSeq') is not null then v_need := true; end if;
    elsif (ev->>'type') in ('dmRefundBoon', 'dmRemoveDrawback', 'dmRepriceDrawback') and ev->'dmEdit' = 'true'::jsonb then
      v_need := true;
    end if;
  end loop;

  if v_need then
    r := public.pact_hr_resolve(p_log);
    -- M1 + the PR #654 review: a DM house-rules AP event counts ONLY when it is DM-stamped AND resolves to its target exactly
    -- as js/engine.js activeEvents() resolves it (dmMatched) — never unconditionally. Otherwise a player who managed to
    -- un-match one (e.g. by renumbering its target) would keep a refund the browser no longer shows.
    for b in select key::bigint as ord from jsonb_each(r -> 'matched') loop
      ev := p_log -> (b.ord::int - 1);
      if (ev->>'type') = 'dmRefundBoon' then
        v_spent := v_spent + public.pact_num(ev->'cost');
      elsif (ev->>'type') = 'dmRemoveDrawback' then
        v_draw := v_draw - public.pact_num(ev->'grantBack');
      else
        v_draw := v_draw + public.pact_num(ev->'amount');
      end if;
    end loop;
    -- M4: a buyoff that names (targetSeq) the purchase js/engine.js's FIFO match cancels takes that purchase's grant back
    -- out: −cost + ΣΔ of the matched DM reprices of it (all of which precede the buyoff — a reprice after it matches nothing).
    for b in select key::bigint as ord, value::int as n from jsonb_each_text(r -> 'buyoffs') loop
      ev := p_log -> (b.ord::int - 1);
      p := r -> 'purchases' -> (b.n - 1);
      if (ev->>'targetSeq') is null or (p->>'seq') is null or (p->>'seq') <> (ev->>'targetSeq') then continue; end if;
      v_draw := v_draw - (-public.pact_num(p->'cost') + (p->>'delta')::numeric);
    end loop;
  end if;

  spent := v_spent; award_earned := v_award; drawback_earned := v_draw;
  return next;
end;
$$;

-- Same signature as before (clients may call it): player_earned = award_earned + drawback_earned.
create or replace function public.pact_ap_ledger_spend(p_log jsonb)
returns table(spent numeric, player_earned numeric)
language plpgsql set search_path = public, pg_temp as $$
begin
  select s.spent, s.award_earned + s.drawback_earned into spent, player_earned
    from public.pact_ap_ledger_split(p_log) s;
  return next;
end;
$$;

create or replace function public.pact_enforce_ap_budget_consistency()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign public.campaigns%rowtype;
  v_enforce boolean;
  v_old_spent numeric;
  v_new_spent numeric; v_new_award numeric; v_new_draw numeric;
  v_cap numeric;
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

  select spent, award_earned, drawback_earned into v_new_spent, v_new_award, v_new_draw
    from public.pact_ap_ledger_split(NEW.stats->'LOG');
  select spent into v_old_spent
    from public.pact_ap_ledger_split(OLD.stats->'LOG');

  -- X1: a drawback's grant counts whether or not the campaign ignores player AP (only AWARDS are the player's to ignore).
  -- Z1: capped at the DM's drawback cap when they set one (js/campaign.js drawbackCapFromRules), uncapped otherwise.
  v_cap := public.pact_hr_drawback_cap(v_campaign.rules);
  v_spendable := NEW.ap + (case when v_campaign.ignore_player_ap then 0 else v_new_award end)
               + (case when v_cap is null then v_new_draw else least(v_cap, v_new_draw) end);

  if v_new_spent > v_old_spent and v_new_spent > v_spendable then
    raise exception 'PACT: over AP budget by % (spent % of % spendable)',
      (v_new_spent - v_spendable), v_new_spent, v_spendable;
  end if;

  return NEW;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- History protection (§6.5).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.pact_ap_ledger_protected(p_log jsonb)
 returns jsonb
 language sql
 immutable
 set search_path = public, pg_temp
as $function$
  -- [HR] A purchase's and a buyoff's `seq` is protected too (PR #654 review): the DM's house-rules events and M4's
  -- buy-off netting name their target BY seq, so renumbering a frozen purchase would un-match a DM refund in the browser.
  -- No client rewrites the seq of an existing buy/buyoff (verified in both tools, 2026-10-13; dm-family-roundtrip-e2e).
  select coalesce(jsonb_agg(
           case when (ev->>'type') = 'buy' and coalesce(ev->>'cat','') = 'patch'
                then public.pact_patch_protected_projection(ev)
                when (ev->>'type') in ('buy', 'buyoff')
                then (ev - 'ts' - 'rules' - 'label')
                else (ev - 'seq' - 'ts' - 'rules' - 'label') end
           order by ord), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_log,'[]'::jsonb)) with ordinality as t(ev, ord)
  where (ev->>'type') in ('buyoff','names','award','sessionSeal','dmRemoveBoon','dmUnlockDrawback',
                          'dmHouseRules','dmRefundBoon','dmRemoveDrawback','dmRepriceDrawback')
     or ((ev->>'type') = 'buy' and coalesce(ev->>'cat','') <> 'patch')
     or ((ev->>'type') = 'buy' and coalesce(ev->>'cat','') = 'patch' and public.pact_patch_protected_projection(ev) is not null);
$function$;

create or replace function public.pact_enforce_locked_history()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
declare
  v_old_log jsonb; v_award_idx int; v_seal_idx int; v_lock_idx int; v_last_lock int; v_last_unlock int; v_idx int;
  v_dm_idx int;
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

    -- [HR] campaign house rules (D-GH-2026-10-13-campaign-house-rules, plan §6.5): a DM's AP-moving house-rules event (a
    -- refund, a drawback removal or a reprice) freezes everything before it, like an award — the client's undo barrier,
    -- server-side. It stays a boundary if creation is reopened: re-costing a purchase under it would pay the refund twice.
    select max(ord) into v_dm_idx
    from jsonb_array_elements(v_old_log) with ordinality as t(ev, ord)
    where (ev->>'type') in ('dmRefundBoon', 'dmRemoveDrawback', 'dmRepriceDrawback')
      and ev->'dmEdit' = 'true'::jsonb;
  end if;

  v_idx := greatest(coalesce(v_seal_idx, 0), coalesce(v_award_idx, 0), coalesce(v_lock_idx, 0), coalesce(v_dm_idx, 0));
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

-- ---------------------------------------------------------------------------------------------------------------------
-- M1: the DM-family forgery guard (plan §6.5, addendum M1).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.pact_dm_family(p_log jsonb)
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(ev order by ord), '[]'::jsonb)
    from jsonb_array_elements(case when jsonb_typeof(p_log) = 'array' then p_log else '[]'::jsonb end) with ordinality as t(ev, ord)
   where jsonb_typeof(ev) = 'object'
     and (public.pact_js_truthy(ev->'dmEdit')
          or (ev->>'type') in ('dmHouseRules', 'dmRefundBoon', 'dmRemoveDrawback', 'dmRepriceDrawback',
                               'dmRemoveBoon', 'dmUnlockDrawback', 'sessionSeal'));
$$;

create or replace function public.pact_enforce_dm_family()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old jsonb; v_new jsonb; v_draft boolean; v_ok boolean; i int; v_o jsonb; v_n jsonb;
begin
  if NEW.stats is not distinct from OLD.stats then return NEW; end if;
  if OLD.campaign_id is null and NEW.campaign_id is null then return NEW; end if;            -- solo (residual risk: header)
  if coalesce(current_setting('request.jwt.claims', true), '') = '' then return NEW; end if;  -- admin session
  if (OLD.campaign_id is not null and public.is_campaign_dm(OLD.campaign_id))
     or (NEW.campaign_id is not null and public.is_campaign_dm(NEW.campaign_id)) then
    return NEW;
  end if;
  v_old := public.pact_dm_family(OLD.stats->'LOG');
  v_new := public.pact_dm_family(NEW.stats->'LOG');
  if v_old is not distinct from v_new then return NEW; end if;
  -- One relaxation (PR #654 review): while the character is still a creation DRAFT (no creationLocked after its last
  -- creationUnlocked), the engine on `main` before rules v0.377 re-prices a DM-granted boon's cost to today's price on every
  -- CharGen save. Accept that re-pricing only when it does NOT lower the cost — a higher cost is more spend, never AP for
  -- the player — and nothing else about the event changes.
  v_draft := coalesce((select max(ord) from jsonb_array_elements(coalesce(OLD.stats->'LOG', '[]'::jsonb)) with ordinality as t(e, ord)
                        where e->>'type' = 'creationLocked'), 0)
          <= coalesce((select max(ord) from jsonb_array_elements(coalesce(OLD.stats->'LOG', '[]'::jsonb)) with ordinality as t(e, ord)
                        where e->>'type' = 'creationUnlocked'), 0);
  if v_draft and jsonb_array_length(v_old) = jsonb_array_length(v_new) then
    v_ok := true;
    for i in 0 .. jsonb_array_length(v_old) - 1 loop
      v_o := v_old -> i; v_n := v_new -> i;
      if v_o is not distinct from v_n then continue; end if;
      if not (v_o->>'type' = 'buy' and v_o->>'cat' = 'boon' and (v_o - 'cost') = (v_n - 'cost')
              and jsonb_typeof(v_n->'cost') = 'number' and public.pact_num(v_n->'cost') >= public.pact_num(v_o->'cost')) then
        v_ok := false;
        exit;
      end if;
    end loop;
    if v_ok then return NEW; end if;
  end if;
  raise exception 'PACT: only your DM can add, change or remove a DM entry in this character''s history'
    using hint = 'Reload the character — your DM has changed it since this copy was loaded.';
end;
$$;

drop trigger if exists trg_pact_dm_family_guard on public.characters;
create trigger trg_pact_dm_family_guard
  before update on public.characters
  for each row execute function public.pact_enforce_dm_family();

-- ---------------------------------------------------------------------------------------------------------------------
-- §6.1: campaigns.rules.charHouseRules has one writer.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.pact_guard_char_house_rules()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old jsonb;
begin
  if coalesce(current_setting('pact.hr_rpc', true), '') = 'on' then return NEW; end if;
  if coalesce(current_setting('request.jwt.claims', true), '') = '' then return NEW; end if;  -- admin session
  if TG_OP = 'UPDATE' then v_old := OLD.rules -> 'charHouseRules'; else v_old := null; end if;
  if (NEW.rules -> 'charHouseRules') is not distinct from v_old then return NEW; end if;
  -- Carried over, not refused: DM Console saves the whole rules blob it loaded, so a stale copy must not erase a newer
  -- RPC write, and a hand-made one must not forge it. Everything else in the blob saves as sent.
  if v_old is null then
    NEW.rules := coalesce(NEW.rules, '{}'::jsonb) - 'charHouseRules';
  else
    NEW.rules := jsonb_set(case when jsonb_typeof(NEW.rules) = 'object' then NEW.rules else '{}'::jsonb end,
                           '{charHouseRules}', v_old);
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_pact_guard_char_house_rules on public.campaigns;
create trigger trg_pact_guard_char_house_rules
  before insert or update on public.campaigns
  for each row execute function public.pact_guard_char_house_rules();

-- ---------------------------------------------------------------------------------------------------------------------
-- dm_edit_character_log — the live definition (sql/rls-policies.sql) with [HR] dmHouseRules accepted.
-- ---------------------------------------------------------------------------------------------------------------------
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
    -- [HR] 'dmHouseRules' added by 2026-10-13-campaign-house-rules-server.sql: a DM's per-character house-rule override
    -- snapshot for THIS campaign. Validated and rebuilt below. The three AP-moving house-rules events are NOT accepted
    -- here: dm_apply_house_rules_change() is their only writer (it validates the target and stamps the amounts).
    elsif v_type not in ('award', 'dmRemoveBoon', 'sessionSeal', 'dmUnlockDrawback', 'dmHouseRules') then
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

    -- [HR] A per-character override snapshot (js/engine.js: the LAST DM-stamped dmHouseRules for a campaignId IS that
    -- campaign's override layer). Shape-checked by the shared validator and REBUILT from a whitelist; campaignId is the
    -- character's campaign, stamped here — never the client's — so an override applies only in the campaign whose DM
    -- wrote it. Not a buy: no cost, never repriced, and allowed on a creation draft.
    if v_type = 'dmHouseRules' then
      perform public.pact_hr_validate(v_ev->'overrides', 'override');
      v_ev := jsonb_build_object('type', 'dmHouseRules', 'overrides', v_ev->'overrides', 'campaignId', v_campaign::text,
                                 'label', left(coalesce(nullif(btrim(v_ev->>'label'), ''), 'DM house rules for this character'), 120));
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

-- ---------------------------------------------------------------------------------------------------------------------
-- dm_apply_house_rules_change(campaign, charHouseRules, actions) — §6.2, M3, M4. See the header.
--   p_char_house_rules  SQL NULL = leave the campaign's charHouseRules as it is · JSON null = remove it (all calls on,
--                       no overrides) · an object = validated and stored whole.
--   p_actions           a JSON array (may be empty), at most 500, processed IN ORDER, each against the log as the
--                       earlier actions left it (two reprices of one purchase in one call chain their from/to).
-- Returns {charHouseRules, events:[{character, event}]}.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.dm_apply_house_rules_change(p_campaign uuid, p_char_house_rules jsonb default null,
                                                              p_actions jsonb default '[]'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_rules    jsonb;
  v_chr      jsonb;
  v_act      jsonb;
  v_idx      bigint;
  v_kind     text;
  v_char     uuid;
  v_ccamp    uuid;
  v_stats    jsonb;
  v_log      jsonb;
  v_seq      integer;
  v_ts       bigint := (extract(epoch from now()) * 1000)::bigint;
  v_ev       jsonb;
  v_out      jsonb := '[]'::jsonb;
  v_name     text;
  v_tseq     integer;
  v_r        jsonb;
  v_n        int;
  v_p        jsonb;
  v_cost     numeric;
  v_grant    numeric;
  v_ov       jsonb;
  v_eff      numeric;
  v_from     numeric;
  v_to       numeric;
  v_amt      numeric;
  v_last_lock int;
  v_last_unlk int;
  v_label    text;
  v_arch     boolean;
begin
  if auth.uid() is null then
    raise exception 'PACT: not signed in';
  end if;
  if not is_campaign_dm(p_campaign) then
    raise exception 'Only a campaign DM can change its house rules';
  end if;
  perform assert_campaign_active(p_campaign);
  select rules into v_rules from campaigns where id = p_campaign for update;
  if not found then
    raise exception 'Campaign not found';
  end if;

  p_actions := coalesce(p_actions, '[]'::jsonb);
  if jsonb_typeof(p_actions) <> 'array' then
    raise exception 'PACT house rules: p_actions must be a JSON array';
  end if;
  if jsonb_array_length(p_actions) > 500 then
    raise exception 'PACT house rules: at most 500 actions per call';
  end if;

  -- 1. The campaign layer.
  if p_char_house_rules is null then
    v_chr := v_rules -> 'charHouseRules';
  else
    if jsonb_typeof(p_char_house_rules) = 'null' then
      v_chr := null;
    else
      perform public.pact_hr_validate(p_char_house_rules, 'campaign');
      v_chr := p_char_house_rules;
    end if;
    perform set_config('pact.hr_rpc', 'on', true);
    update campaigns
       set rules = case when v_chr is null then coalesce(rules, '{}'::jsonb) - 'charHouseRules'
                        else jsonb_set(coalesce(rules, '{}'::jsonb), '{charHouseRules}', v_chr) end
     where id = p_campaign;
    perform set_config('pact.hr_rpc', '', true);
  end if;

  -- 2. The per-character events.
  for v_act, v_idx in select a, o from jsonb_array_elements(p_actions) with ordinality as x(a, o) loop
    if jsonb_typeof(v_act) <> 'object' then
      raise exception 'PACT house rules: action % must be an object', v_idx;
    end if;
    v_kind := v_act ->> 'kind';
    if v_kind is null or v_kind not in ('override', 'pin', 'reprice', 'refundBoon', 'removeDrawback') then
      raise exception 'PACT house rules: action % has an unknown kind "%"', v_idx, coalesce(v_kind, '');
    end if;
    if coalesce(v_act ->> 'character', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'PACT house rules: action % needs a character id', v_idx;
    end if;
    v_char := (v_act ->> 'character')::uuid;
    select campaign_id, stats, archived_at is not null into v_ccamp, v_stats, v_arch from characters where id = v_char for update;
    if not found or v_ccamp is distinct from p_campaign then
      raise exception 'PACT house rules: action % — that character is not in this campaign', v_idx;
    end if;
    -- An archived (soft-deleted) character is read-only here, as dm_bind_npc treats it. A DM's own NPC (is_npc) is accepted,
    -- like every other DM write path (dm_edit_character_log, award_ap): house rules apply to it as to any campaign character.
    if v_arch then
      raise exception 'PACT house rules: action % — that character is archived; un-archive it first', v_idx;
    end if;
    if v_stats is null or jsonb_typeof(v_stats -> 'LOG') is distinct from 'array' then
      raise exception 'PACT house rules: action % — the character has no log', v_idx;
    end if;
    v_log := v_stats -> 'LOG';
    v_seq := coalesce((v_stats ->> 'SEQ')::integer, jsonb_array_length(v_log) + 1);
    v_label := nullif(btrim(coalesce(v_act ->> 'label', '')), '');

    if v_kind in ('override', 'pin') then
      perform public.pact_hr_validate(v_act -> 'overrides', 'override');
      v_ev := jsonb_build_object('type', 'dmHouseRules', 'overrides', v_act -> 'overrides',
                                 'label', left(coalesce(v_label, 'DM house rules for this character'), 120));
    else
      -- AP-moving: only on a character that has FINISHED creation (its last creationLocked after its last
      -- creationUnlocked — #642's D2 test). A draft re-prices its purchases on every save (repriceDraft).
      select max(ord) into v_last_lock from jsonb_array_elements(v_log) with ordinality as t(e, ord) where e->>'type' = 'creationLocked';
      select max(ord) into v_last_unlk from jsonb_array_elements(v_log) with ordinality as t(e, ord) where e->>'type' = 'creationUnlocked';
      if v_last_lock is null or coalesce(v_last_unlk, 0) > v_last_lock then
        raise exception 'PACT house rules: action % — the character has not finished creation (its draft picks up the change by itself)', v_idx;
      end if;
      v_name := v_act ->> 'name';
      if v_name is null or btrim(v_name) = '' then
        raise exception 'PACT house rules: action % needs the purchase name', v_idx;
      end if;
      if jsonb_typeof(v_act -> 'targetSeq') = 'number' and (v_act ->> 'targetSeq') ~ '^[0-9]{1,9}$' then
        v_tseq := (v_act ->> 'targetSeq')::integer;
      else
        raise exception 'PACT house rules: action % needs targetSeq, the whole-number seq of the purchase', v_idx;
      end if;
      v_r := public.pact_hr_resolve(v_log);
      v_n := ((case when v_kind = 'refundBoon' then v_r -> 'bmap' else v_r -> 'dmap' end) ->> (v_tseq::text || '|' || v_name))::int;
      if v_n is null then
        raise exception 'PACT house rules: action % — no % "%" at seq %', v_idx,
          case when v_kind = 'refundBoon' then 'boon' else 'drawback' end, v_name, v_tseq;
      end if;
      if v_n < 0 then
        raise exception 'PACT house rules: action % — two purchases share seq % and name "%"; pin it instead', v_idx, v_tseq, v_name;
      end if;
      v_p := v_r -> 'purchases' -> (v_n - 1);
      if v_p ->> 'status' <> 'open' then
        raise exception 'PACT house rules: action % — "%" at seq % is no longer held (%)', v_idx, v_name, v_tseq, v_p ->> 'status';
      end if;
      if jsonb_typeof(v_p -> 'cost') not in ('number', 'null') then
        raise exception 'PACT house rules: action % — the purchase''s cost is not a number', v_idx;
      end if;
      v_cost := public.pact_num(v_p -> 'cost');
      if v_kind = 'refundBoon' then
        if public.pact_js_truthy(v_p -> 'dmEdit') then
          raise exception 'PACT house rules: action % — "%" was granted by a DM; remove it without a refund', v_idx, v_name;
        end if;
        if v_cost < 0 then
          raise exception 'PACT house rules: action % — "%" has a negative cost', v_idx, v_name;
        end if;
        v_ev := jsonb_build_object('type', 'dmRefundBoon', 'refVal', v_name, 'targetSeq', v_tseq, 'cost', -v_cost,
                                   'label', left(coalesce(v_label, 'DM refund — ' || v_name || ' (' || v_cost || ' AP)'), 120));
      else
        if public.pact_js_truthy(v_p -> 'dmEdit') and v_cost >= 0 then
          raise exception 'PACT house rules: action % — "%" was imposed by a DM; it grants nothing to change', v_idx, v_name;
        end if;
        v_grant := -v_cost + (v_p ->> 'delta')::numeric;
        if v_kind = 'removeDrawback' then
          v_ev := jsonb_build_object('type', 'dmRemoveDrawback', 'refVal', v_name, 'targetSeq', v_tseq, 'grantBack', v_grant,
                                     'label', left(coalesce(v_label, 'DM removed drawback — ' || v_name || ' (−' || v_grant || ' AP)'), 120));
        else
          if jsonb_typeof(v_act -> 'amount') is distinct from 'number' or jsonb_typeof(v_act -> 'from') is distinct from 'number'
             or jsonb_typeof(v_act -> 'to') is distinct from 'number' then
            raise exception 'PACT house rules: action % — a reprice needs numeric amount, from and to', v_idx;
          end if;
          v_amt := (v_act ->> 'amount')::numeric; v_from := (v_act ->> 'from')::numeric; v_to := (v_act ->> 'to')::numeric;
          if v_amt <> trunc(v_amt) or v_from <> trunc(v_from) or v_to <> trunc(v_to)
             or v_amt = 0 or abs(v_amt) > 1000 or v_to not between 0 and 1000 then
            raise exception 'PACT house rules: action % — amount must be a whole non-zero number up to ±1000 and to a whole number 0-1000', v_idx;
          end if;
          -- M3 from: the ledger's current grant for this purchase.
          if v_from <> v_grant then
            raise exception 'PACT house rules: action % — from (%) is not the purchase''s current grant (%)', v_idx, v_from, v_grant;
          end if;
          -- M3 to: its effective value now — DM pin > DM override (the last DM-stamped snapshot for THIS campaign) >
          -- campaign charHouseRules > printed. The printed value lives only in js/engine-data.js; when nothing here names
          -- the drawback, `to` is accepted within 0..1000 (the printed-value fallback).
          select e -> 'overrides' into v_ov
            from jsonb_array_elements(v_log) with ordinality as t(e, ord)
           where e->>'type' = 'dmHouseRules' and e->'dmEdit' = 'true'::jsonb and e->>'campaignId' = p_campaign::text
             and jsonb_typeof(e->'overrides') = 'object'
           order by ord desc limit 1;
          v_eff := null;
          if jsonb_typeof(v_ov -> 'pins' -> 'draws' -> v_name) = 'object'
             and public.pact_js_number(v_ov -> 'pins' -> 'draws' -> v_name -> 'ap') is not null then
            v_eff := public.pact_js_number(v_ov -> 'pins' -> 'draws' -> v_name -> 'ap');
          elsif jsonb_typeof(v_ov -> 'draws' -> v_name) = 'object' then
            v_eff := coalesce(public.pact_js_number(v_ov -> 'draws' -> v_name -> 'ap'), 0);
          elsif jsonb_typeof(v_chr -> 'draws' -> v_name) = 'object' then
            v_eff := coalesce(public.pact_js_number(v_chr -> 'draws' -> v_name -> 'ap'), 0);
          end if;
          if v_eff is not null and v_to <> v_eff then
            raise exception 'PACT house rules: action % — to (%) is not "%"''s effective value for this character (%)', v_idx, v_to, v_name, v_eff;
          end if;
          if v_amt <> v_to - v_from then
            raise exception 'PACT house rules: action % — amount must be to − from (%)', v_idx, v_to - v_from;
          end if;
          v_ev := jsonb_build_object('type', 'dmRepriceDrawback', 'refVal', v_name, 'targetSeq', v_tseq,
                                     'amount', v_amt, 'from', v_from, 'to', v_to,
                                     'label', left(coalesce(v_label, 'DM repriced drawback — ' || v_name || ' ' || v_from || ' → ' || v_to || ' AP'), 120));
        end if;
      end if;
    end if;

    v_ev := v_ev || jsonb_build_object('campaignId', p_campaign::text, 'seq', v_seq, 'ts', v_ts, 'dmEdit', true, 'dmId', auth.uid());
    v_stats := jsonb_set(jsonb_set(v_stats, '{LOG}', v_log || jsonb_build_array(v_ev)), '{SEQ}', to_jsonb(v_seq + 1));
    update characters set stats = v_stats where id = v_char;
    v_out := v_out || jsonb_build_array(jsonb_build_object('character', v_char, 'event', v_ev));
  end loop;

  return jsonb_build_object('charHouseRules', v_chr, 'events', v_out);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Grants. Trigger functions are never callable (2026-09-01-revoke-trigger-function-execute.sql). The pure helpers stay
-- callable by signed-in users because pact_ap_ledger_spend — deliberately callable — runs them as the caller.
-- ---------------------------------------------------------------------------------------------------------------------
revoke execute on function public.pact_enforce_dm_family()        from public, anon, authenticated;
revoke execute on function public.pact_guard_char_house_rules()   from public, anon, authenticated;
revoke all on function public.pact_js_truthy(jsonb)               from public, anon;
revoke all on function public.pact_js_number(jsonb)               from public, anon;
revoke all on function public.pact_num(jsonb)                     from public, anon;
revoke all on function public.pact_hr_drawback_cap(jsonb)         from public, anon;
revoke all on function public.pact_hr_entry_ok(text, jsonb, text) from public, anon;
revoke all on function public.pact_hr_validate(jsonb, text)       from public, anon;
revoke all on function public.pact_hr_resolve(jsonb)              from public, anon;
revoke all on function public.pact_ap_ledger_split(jsonb)         from public, anon;
revoke all on function public.pact_dm_family(jsonb)               from public, anon;
grant execute on function public.pact_js_truthy(jsonb)               to authenticated;
grant execute on function public.pact_js_number(jsonb)               to authenticated;
grant execute on function public.pact_num(jsonb)                     to authenticated;
grant execute on function public.pact_hr_drawback_cap(jsonb)         to authenticated;
grant execute on function public.pact_hr_entry_ok(text, jsonb, text) to authenticated;
grant execute on function public.pact_hr_validate(jsonb, text)       to authenticated;
grant execute on function public.pact_hr_resolve(jsonb)              to authenticated;
grant execute on function public.pact_ap_ledger_split(jsonb)         to authenticated;
grant execute on function public.pact_dm_family(jsonb)               to authenticated;
revoke all on function public.dm_apply_house_rules_change(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.dm_apply_house_rules_change(uuid, jsonb, jsonb) to authenticated;

comment on function public.dm_apply_house_rules_change(uuid, jsonb, jsonb) is
  'The one writer of campaigns.rules.charHouseRules and of the DM house-rules events (dmHouseRules, dmRefundBoon, dmRemoveDrawback, dmRepriceDrawback). D-GH-2026-10-13-campaign-house-rules.';
comment on function public.pact_hr_drawback_cap(jsonb) is
  'Owner decision Z1: the drawback AP cap the budget check applies — js/campaign.js drawbackCapFromRules() exactly; NULL = no cap.';
comment on function public.pact_enforce_dm_family() is
  'M1: a non-DM, non-admin writer may not add, change, remove or reorder a campaign character''s DM-family events (truthy dmEdit, or a DM-only type). D-GH-2026-10-13-campaign-house-rules.';
comment on function public.pact_guard_char_house_rules() is
  'Keeps campaigns.rules.charHouseRules as it was unless dm_apply_house_rules_change() (GUC pact.hr_rpc) or an admin session writes it.';
