#!/usr/bin/env bash
# Throwaway-Postgres rehearsal of sql/migrations/2026-10-25-server-negative-cost.sql (+ rollback). Needs Docker only; touches NO real database.
# Builds the fresh-install path (schema.sql + rls-policies.sql), which carries the migration once it is folded in (it is folded in the same
# change that adds it, because a fresh install must match production). The script records the folded definitions (FOLDED), steps back with
# the rollback, and rehearses the transition:
#   BEFORE   the negative-cost attacks are allowed (FAIL rows), every legitimate case already passes
#   AFTER    every case PASSES, the trigger functions match FOLDED byte for byte, and pact_binding_grant_max() equals the price js/engine.js
#            charges for Martial / Magical binding (so a change to the engine's flat -2 fails here)
#   ROLLBACK the trigger and both functions are gone and the attacks work again
# Usage: testing/scripts/creation-lock-guard-test/run-negative-cost.sh
set -euo pipefail
cd "$(dirname "$0")"
C=pact-negcost-test
psqlc() { docker exec -i -e PGOPTIONS="-c client_min_messages=warning" "$C" psql -U postgres -v ON_ERROR_STOP=1 -q -P pager=off "$@"; }
docker rm -f "$C" >/dev/null 2>&1 || true
docker run -d --name "$C" -e POSTGRES_PASSWORD=pw postgres:17-alpine >/dev/null
trap 'docker rm -f "$C" >/dev/null 2>&1' EXIT
for i in $(seq 1 30); do docker exec "$C" pg_isready -U postgres -q && break; sleep 1; done
sleep 2
M=../../../sql/migrations
{ cat award-shims.sql ../../../sql/schema.sql ../../../sql/rls-policies.sql; } | psqlc >/dev/null
psqlc -c "insert into auth.users(id) select ('a0000000-0000-0000-0000-00000000000' || g)::uuid from generate_series(1,9) g union all select 'd0000000-0000-0000-0000-000000000001'"
def() { psqlc -At -c "select coalesce(md5(pg_get_functiondef('public.pact_enforce_negative_cost()'::regprocedure)),'-') || ' ' || coalesce(md5(pg_get_functiondef('public.pact_binding_grant_max()'::regprocedure)),'-')" 2>/dev/null || echo "none"; }
objects() { psqlc -At -c "select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('pact_enforce_negative_cost','pact_binding_grant_max')) + (select count(*) from pg_trigger where tgname = 'trg_pact_negative_cost_guard')"; }
counts() { psqlc -At -c "select count(*) filter (where verdict='PASS') || ' passed, ' || count(*) filter (where verdict='FAIL') || ' failed (of ' || count(*) || ')' from res"; }
fails() { psqlc -At -F ' | ' -c "select verdict, expect, got, name from res where verdict='FAIL' order by n" | cut -c1-230; }
[ "$(objects)" = "3" ] || { echo "EXPECTED the folded baseline (rls-policies.sql) to carry 2 functions + 1 trigger, found $(objects)"; exit 1; }
FOLDED=$(def)
psqlc < "$M/2026-10-25-server-negative-cost-rollback.sql"
[ "$(objects)" = "0" ] || { echo "ROLLBACK LEFT $(objects) OBJECTS"; exit 1; }
echo "=== BEFORE (no negative-cost guard; the attacks SHOULD show FAIL = allowed) ==="
psqlc < negative-cost-cases.sql >/dev/null; echo "BEFORE: $(counts)"; fails | sed 's/^/  gap today: /'
[ "$(psqlc -At -c "select count(*) from res where verdict='FAIL' and (got like 'ERROR%' or got like 'ASSERT%' or got like 'refused (other%')")" = "0" ] || { fails; echo "HARNESS ERROR before the migration"; exit 1; }
[ "$(psqlc -At -c "select count(*) from res where verdict='FAIL' and expect='allowed'")" = "0" ] || { echo "A LEGITIMATE case fails before the migration"; exit 1; }
echo "=== applying $M/2026-10-25-server-negative-cost.sql ==="
psqlc < "$M/2026-10-25-server-negative-cost.sql"
psqlc < negative-cost-cases.sql >/dev/null; echo "AFTER: $(counts)"
[ "$(psqlc -At -c "select count(*) from res where verdict='FAIL'")" = "0" ] || { fails; echo "FAILED"; exit 1; }
[ "$(def)" = "$FOLDED" ] && echo "the migration's two functions are byte-identical to rls-policies.sql's (the fold)" || { echo "FOLD DIFFERS from the migration"; exit 1; }
psqlc -At -c "select 'trigger function callable by authenticated: ' || has_function_privilege('authenticated','public.pact_enforce_negative_cost()','EXECUTE')"
[ "$(psqlc -At -c "select has_function_privilege('authenticated','public.pact_enforce_negative_cost()','EXECUTE') or has_function_privilege('anon','public.pact_binding_grant_max()','EXECUTE')")" = "f" ] || { echo "GRANTS WRONG"; exit 1; }
echo "=== pact_binding_grant_max() vs js/engine.js's flat binding price ==="
if command -v node >/dev/null; then
  ENG=$(node --input-type=module -e "import { priceOf, baseBuild } from '../../../js/engine.js'; const b = baseBuild(); console.log(priceOf(b, 'mbound', {}) + ' ' + priceOf(b, 'dbound', {}))")
  SQLMAX=$(psqlc -At -c "select -public.pact_binding_grant_max() || ' ' || -public.pact_binding_grant_max()")
  [ "$ENG" = "$SQLMAX" ] && echo "engine prices both bindings at $ENG, the server bound agrees" || { echo "BINDING PRICE DISAGREES: engine '$ENG', server '$SQLMAX'"; exit 1; }
else
  echo "node not found — skipped (CI runners have it)"
fi
echo "=== rollback ==="
psqlc < "$M/2026-10-25-server-negative-cost-rollback.sql"
[ "$(objects)" = "0" ] && echo "rollback removes the 2 functions and the trigger" || { echo "ROLLBACK LEFT $(objects) OBJECTS"; exit 1; }
psqlc < negative-cost-cases.sql >/dev/null; echo "AFTER ROLLBACK (the gap is back): $(counts)"
echo done
