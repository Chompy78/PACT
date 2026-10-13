#!/usr/bin/env bash
# Throwaway-Postgres rehearsal of sql/migrations/2026-10-13-campaign-house-rules-server.sql (+ rollback). Needs Docker only; touches NO real database.
# Builds the fresh-install path (schema.sql + rls-policies.sql) plus 2026-09-03-dm-zero-player-ap.sql (live today), then:
#   BEFORE   every case lands exactly as its `before` column predicts — the attacks and new features FAIL, the legitimate paths PASS
#   AFTER    every case PASSES, and pact_hr_drawback_cap() agrees with js/campaign.js drawbackCapFromRules() on every shape in
#            drawback-cap-shapes.json (generated from the real JS function; house-rules-ledger-ci.mjs checks the JS side)
#   ROLLBACK every redefined function is byte-identical to the BASE one, every added function/trigger is gone, and the cases land
#            exactly as BEFORE again.
# Usage: testing/scripts/creation-lock-guard-test/run-house-rules.sh
set -euo pipefail
cd "$(dirname "$0")"
C=pact-house-rules-test
psqlc() { docker exec -i -e PGOPTIONS="-c client_min_messages=warning" "$C" psql -U postgres -v ON_ERROR_STOP=1 -q -P pager=off "$@"; }
docker rm -f "$C" >/dev/null 2>&1 || true
docker run -d --name "$C" -e POSTGRES_PASSWORD=pw postgres:17-alpine >/dev/null
trap 'docker rm -f "$C" >/dev/null 2>&1' EXIT
for i in $(seq 1 30); do docker exec "$C" pg_isready -U postgres -q && break; sleep 1; done
sleep 2
M=../../../sql/migrations
{ cat award-shims.sql ../../../sql/schema.sql ../../../sql/rls-policies.sql "$M/2026-09-03-dm-zero-player-ap.sql"; } | psqlc >/dev/null
psqlc -c "insert into auth.users(id) select ('a0000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid from generate_series(1,29) g union all select 'd0000000-0000-0000-0000-000000000001' union all select 'd0000000-0000-0000-0000-000000000002'"
docker cp drawback-cap-shapes.json "$C":/tmp/caps.json >/dev/null

CHANGED="'public.pact_ap_ledger_spend(jsonb)','public.pact_enforce_ap_budget_consistency()','public.pact_ap_ledger_protected(jsonb)','public.pact_enforce_locked_history()','public.dm_edit_character_log(uuid,jsonb)'"
defs() { psqlc -At -c "select string_agg(f || '=' || md5(pg_get_functiondef(f::regprocedure)), ' ' order by f) from unnest(array[$CHANGED]) f"; }
added() { psqlc -At -c "select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('dm_apply_house_rules_change','pact_enforce_dm_family','pact_guard_char_house_rules','pact_dm_family','pact_ap_ledger_split','pact_hr_resolve','pact_hr_validate','pact_hr_entry_ok','pact_hr_drawback_cap','pact_js_number','pact_js_truthy','pact_num','pact_drawback_printed','pact_hr_drawback_effective','pact_js_key','pact_next_seq','pact_enforce_player_grants'))
  + (select count(*) from pg_trigger where tgname in ('trg_pact_dm_family_guard','trg_pact_guard_char_house_rules','trg_pact_player_grants_guard'))"; }
counts() { psqlc -At -c "select count(*) filter (where verdict='PASS') || ' passed, ' || count(*) filter (where verdict='FAIL') || ' failed (of ' || count(*) || ')' from res"; }
mispredicted() { psqlc -At -F ' | ' -c "select before, verdict, got, name from res where (verdict = 'PASS') <> (before = 'pass') order by n" | cut -c1-240; }
BASE=$(defs)
echo "BASE: $BASE"

echo "=== BEFORE (today's definitions): each case must land as its 'before' column predicts ==="
psqlc < house-rules-cases.sql >/dev/null
echo "BEFORE: $(counts) — $(psqlc -At -c "select count(*) from res where before='fail'") cases are gaps/new behaviour and must FAIL here"
BAD=$(mispredicted); [ -z "$BAD" ] || { echo "$BAD" | sed 's/^/  mispredicted: /'; echo "BEFORE MISPREDICTED"; exit 1; }
psqlc -At -F ' | ' -c "select name from res where before='fail' order by n" | sed 's/^/  fails today (as expected): /' | cut -c1-170

echo "=== applying $M/2026-10-13-campaign-house-rules-server.sql ==="
psqlc -1 < "$M/2026-10-13-campaign-house-rules-server.sql"
psqlc < house-rules-cases.sql >/dev/null; echo "AFTER: $(counts)"
[ "$(psqlc -At -c "select count(*) from res where verdict='FAIL'")" = "0" ] || { psqlc -At -F ' | ' -c "select verdict, expect, got, name from res where verdict='FAIL' order by n" | cut -c1-260; echo "FAILED"; exit 1; }
[ "$(added)" = "20" ] || { echo "EXPECTED 17 functions + 3 triggers after the migration, found $(added)"; exit 1; }
echo "=== Z1: pact_hr_drawback_cap() vs js/campaign.js drawbackCapFromRules() on every shape ==="
CAPBAD=$(psqlc -At -c "select count(*) from jsonb_array_elements(pg_read_file('/tmp/caps.json')::jsonb) s
  where public.pact_hr_drawback_cap(s->'rules') is distinct from (s->>'cap')::numeric")
CAPN=$(psqlc -At -c "select jsonb_array_length(pg_read_file('/tmp/caps.json')::jsonb)")
[ "$CAPBAD" = "0" ] && echo "all $CAPN shapes agree" || { psqlc -At -c "select s->'rules', s->'cap', public.pact_hr_drawback_cap(s->'rules') from jsonb_array_elements(pg_read_file('/tmp/caps.json')::jsonb) s where public.pact_hr_drawback_cap(s->'rules') is distinct from (s->>'cap')::numeric"; echo "CAP SHAPES DISAGREE"; exit 1; }
echo "=== the ledger: the REAL SQL vs house-rules-ledger-ci.mjs's port, on the fuzz's random campaign histories ==="
if command -v node >/dev/null; then
  TMPJ=$(mktemp); node ../house-rules-ledger-ci.mjs --iterations 300 --dump-logs "$TMPJ" >/dev/null
  chmod 644 "$TMPJ"; docker cp "$TMPJ" "$C":/tmp/logs.json >/dev/null; rm -f "$TMPJ"
  LBAD=$(psqlc -At -c "select count(*) from jsonb_array_elements(pg_read_file('/tmp/logs.json')::jsonb) d, lateral public.pact_ap_ledger_split(d->'log', d->'chr', (d->>'campaign')::uuid) s
    where s.spent is distinct from (d->>'spent')::numeric or s.award_earned is distinct from (d->>'award')::numeric or s.drawback_earned is distinct from (d->>'draw')::numeric")
  LN=$(psqlc -At -c "select jsonb_array_length(pg_read_file('/tmp/logs.json')::jsonb)")
  [ "$LBAD" = "0" ] && echo "all $LN logs: spent / award_earned / drawback_earned agree" || { psqlc -At -c "select (d->>'spent') || '/' || (d->>'award') || '/' || (d->>'draw') || ' vs ' || s.spent || '/' || s.award_earned || '/' || s.drawback_earned from jsonb_array_elements(pg_read_file('/tmp/logs.json')::jsonb) d, lateral public.pact_ap_ledger_split(d->'log', d->'chr', (d->>'campaign')::uuid) s where s.spent is distinct from (d->>'spent')::numeric or s.award_earned is distinct from (d->>'award')::numeric or s.drawback_earned is distinct from (d->>'draw')::numeric limit 5"; echo "SQL LEDGER DISAGREES WITH THE PORT ($LBAD of $LN)"; exit 1; }
else
  echo "node not found — skipped (CI runners have it)"
fi
echo "=== grants ==="
psqlc -At -c "select 'trigger functions callable by authenticated: ' || (has_function_privilege('authenticated','public.pact_enforce_dm_family()','EXECUTE') or has_function_privilege('authenticated','public.pact_guard_char_house_rules()','EXECUTE'))
  || ' · RPC callable by authenticated: ' || has_function_privilege('authenticated','public.dm_apply_house_rules_change(uuid,jsonb,jsonb,jsonb)','EXECUTE')
  || ' · RPC callable by anon: ' || has_function_privilege('anon','public.dm_apply_house_rules_change(uuid,jsonb,jsonb,jsonb)','EXECUTE')"
[ "$(psqlc -At -c "select has_function_privilege('anon','public.dm_apply_house_rules_change(uuid,jsonb,jsonb,jsonb)','EXECUTE') or has_function_privilege('authenticated','public.pact_enforce_dm_family()','EXECUTE') or has_function_privilege('authenticated','public.pact_enforce_player_grants()','EXECUTE')")" = "f" ] || { echo "GRANTS WRONG"; exit 1; }

echo "=== rollback: every redefined function byte-identical to BASE, every addition gone ==="
psqlc -1 < "$M/2026-10-13-campaign-house-rules-server-rollback.sql"
[ "$(defs)" = "$BASE" ] && echo "rollback restores the five definitions exactly" || { echo "ROLLBACK DIFFERS: $(defs)"; exit 1; }
[ "$(added)" = "0" ] && echo "rollback removes the 17 functions and 3 triggers" || { echo "ROLLBACK LEFT $(added) OBJECTS"; exit 1; }
psqlc < house-rules-cases.sql >/dev/null; echo "AFTER ROLLBACK: $(counts)"
BAD=$(mispredicted); [ -z "$BAD" ] || { echo "$BAD" | sed 's/^/  mispredicted: /'; echo "AFTER-ROLLBACK STATE DIFFERS FROM BEFORE"; exit 1; }
echo "the cases land exactly as BEFORE again"
echo done
