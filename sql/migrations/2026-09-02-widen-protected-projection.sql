-- ---------------------------------------------------------------------------
-- Widen pact_ap_ledger_protected()'s projection from six enumerated fields to the whole event.
-- Applied to production 2026-09-02 as `widen_protected_projection_to_whole_event`.
--
-- WHY. The 2026-09-01 session-seal migration added `'v', ev#>>'{payload,v}'` so a sealed 6 AP boon
-- could not be swapped for a different 6 AP boon. That closed the hole only for events whose payload
-- is shaped {v:...}. js/engine.js's MUT table shows that is a minority of categories:
--
--     hd / prof / abil / language / vigor / grit   ->  payload.to, payload.ab
--     wprof                                        ->  payload.wp
--     rank / cantrip / slot / known                ->  payload.ti, payload.di, payload.L
--     names                                        ->  NO payload at all; identity is TOP-LEVEL
--                                                      (eb / fs / mm / feat / lang / tr)
--
-- For every one of those `ev#>>'{payload,v}'` is NULL, so the projection was blind to a substitution.
-- Worked example, verified against the live function before this change: a sealed
--   {"type":"buy","cat":"abil","cost":4,"payload":{"ab":"STR","to":14}}
-- PATCHed to ab:"DEX" produced a byte-identical projection, so pact_enforce_locked_history accepted it;
-- pact_ap_ledger_spend's sum was unchanged, so the budget trigger accepted it too. A sealed ability
-- increase could be moved retroactively.
--
-- A sessionSeal was worse: every projected key but 'type' was null by construction, so its own `idem`
-- was freely strippable through the ordinary stats UPDATE grant. Removing it defeats
-- award_ap_and_seal()'s replay guard, and the next retry of that key awards the AP a SECOND time.
--
-- WHY NOT ENUMERATE MORE KEYS. That just moves the boundary and needs revisiting every time a mutator
-- gains a field — the same hand-written-mirror drift this project keeps paying for. Projecting the whole
-- event inverts the default: everything on a protected event is frozen unless explicitly exempted.
--
-- EXEMPTIONS, and why each is safe:
--   seq, ts   bookkeeping, rewritten by ordinary appends
--   rules     stamped per event, not identity
--   label     display text, may legitimately be regenerated
--
-- SCOPE DELIBERATELY UNCHANGED. 'patch' buys and 'dmRemoveBoon' remain OUTSIDE the protected set. Both
-- are real gaps — a sealed species/class/ability score is still editable, and deleting a dmRemoveBoon
-- restores a boon the DM took away — but closing them changes what the TOOLS may do:
-- replacePatchSlot() rewrites a patch event IN PLACE on every species/class/ability edit and has no
-- client-side seal guard, so tightening the server alone would refuse ordinary editing with no
-- explanation. They need a client change designed alongside; see the task board.
--
-- BLAST RADIUS: zero. Measured before applying — 0 of 35 live characters have a non-empty protected
-- prefix (no seals exist, and all 6 campaign characters' awards are noLock), so this cannot refuse any
-- write that succeeds today. Verified after applying: the abil swap and the idem strip are both now
-- caught, an unrelated `ts` change is still allowed, and patch edits still pass.
-- ---------------------------------------------------------------------------
create or replace function public.pact_ap_ledger_protected(p_log jsonb)
returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg((ev - 'seq' - 'ts' - 'rules' - 'label') order by ord), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_log,'[]'::jsonb)) with ordinality as t(ev, ord)
  where (ev->>'type') in ('buyoff','names','award','sessionSeal')
     or ((ev->>'type') = 'buy' and coalesce(ev->>'cat','') <> 'patch');
$$;

-- Not an RPC. Same reasoning as 2026-09-01-revoke-trigger-function-execute.sql: a helper reachable at
-- /rest/v1/rpc is API surface nobody designed.
revoke execute on function public.pact_ap_ledger_protected(jsonb) from public, anon, authenticated;
