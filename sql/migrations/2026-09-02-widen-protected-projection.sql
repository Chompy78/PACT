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
-- SCOPE, AS FIRST SHIPPED AND THEN EXTENDED. This file originally left BOTH 'patch' buys and
-- 'dmRemoveBoon' outside the protected set. Both have since been closed, by DIFFERENT means, and the
-- difference is the part worth keeping:
--
--   * 'patch' buys  -> NOT added here. replacePatchSlot() rewrites a patch event IN PLACE on every
--     species/class/ability edit, so a positional rule would refuse ordinary editing. Species and ability
--     scores are compared by DERIVED VALUE inside pact_enforce_locked_history() instead — see
--     D-GH-2026-09-02-seal-freezes-species-and-ratchets-stats.
--   * 'dmRemoveBoon' -> ADDED to the IN list below (applied as `seal_protects_dm_removals`). Positional
--     protection is correct for this one: it is created in exactly one place (tools/DM-Console.html, via
--     dm_edit_character_log's append-only `v_log := v_log || v_new`), and every other reference merely
--     READS it (js/engine.js activeEvents, the Live Sheet's history renderer).
--
--     >> CORRECTED 2026-09-05 (comments only — no SQL changed, replay is byte-identical). This bullet
--     >> used to end "Nothing rewrites or relocates one, so the property that defeats patch events does
--     >> not apply here." The CONCLUSION still holds for this event type; the REASON given for it was
--     >> too strong, and stated as a general property it is false:
--     >>
--     >>   - CharGen's replaceWholeLogFromBuild() re-synthesises the ENTIRE log from the DOM, and
--     >>     CharGen cannot emit 'dmRemoveBoon' at all (0 occurrences in the file). That function
--     >>     therefore DOES destroy these events. What saves it is that every one of its call sites
--     >>     either reinstates the saved log verbatim straight afterwards (_cgApplyEnvelope, the path
--     >>     every cloud load takes) or is refused up front by _cgBlockedBySeal. Safety here is a
--     >>     property of CALLER DISCIPLINE, not of the event type.
--     >>   - "Nothing relocates a protected event" is false in general: _cgSyncSingletonEvent()
--     >>     relocates its singleton by filter-and-append, and 'award' — which IS in this projection —
--     >>     is one of the types it handles. It simply never handles 'dmRemoveBoon'.
--     >>
--     >> So the right reading is narrower: positional protection is safe for 'dmRemoveBoon' TODAY
--     >> because no client rewrites it, not because the shape of the event makes rewriting impossible.
--     >> A fifth caller of replaceWholeLogFromBuild() that forgets both conventions reintroduces the
--     >> hazard. NOT REPRODUCED against a live character — this is a reading of the code, and the
--     >> predicted failure (a save refused with "locked character history cannot shrink") has not been
--     >> observed. Tracked as `fix/chargen-regenerates-protected-events`.
--
-- The lesson: "just add it to the projection" is right or wrong depending on whether anything
-- legitimately REWRITES that event type. It has to be checked per type, never assumed from the shape.
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
  where (ev->>'type') in ('buyoff','names','award','sessionSeal','dmRemoveBoon')
     or ((ev->>'type') = 'buy' and coalesce(ev->>'cat','') <> 'patch');
$$;

-- Not an RPC. Same reasoning as 2026-09-01-revoke-trigger-function-execute.sql: a helper reachable at
-- /rest/v1/rpc is API surface nobody designed.
revoke execute on function public.pact_ap_ledger_protected(jsonb) from public, anon, authenticated;
