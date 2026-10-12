#!/usr/bin/env bash
# Throwaway-Postgres rehearsal of sql/migrations/2026-10-12-server-player-award-after-lock.sql (+ rollback). Needs Docker only; touches NO real database.
# Builds the fresh-install path (schema.sql + rls-policies.sql), then 2026-09-03-dm-zero-player-ap.sql so the ceiling trigger is the
# definition LIVE today. BEFORE: the player-award attacks are allowed (FAIL rows). AFTER: every row PASS. Rollback: byte-identical to 2026-09-03.
# Usage: testing/scripts/creation-lock-guard-test/run-award.sh
set -euo pipefail
cd "$(dirname "$0")"
C=pact-award-test
psqlc() { docker exec -i -e PGOPTIONS="-c client_min_messages=warning" "$C" psql -U postgres -v ON_ERROR_STOP=1 -q -P pager=off "$@"; }
docker rm -f "$C" >/dev/null 2>&1 || true
docker run -d --name "$C" -e POSTGRES_PASSWORD=pw postgres:17-alpine >/dev/null
trap 'docker rm -f "$C" >/dev/null 2>&1' EXIT
for i in $(seq 1 30); do docker exec "$C" pg_isready -U postgres -q && break; sleep 1; done
sleep 2
M=../../../sql/migrations
{ cat award-shims.sql ../../../sql/schema.sql ../../../sql/rls-policies.sql "$M/2026-09-03-dm-zero-player-ap.sql"; } | psqlc >/dev/null
psqlc -c "insert into auth.users(id) select ('a0000000-0000-0000-0000-00000000000' || g)::uuid from generate_series(1,9) g union all select 'd0000000-0000-0000-0000-000000000001'"
def() { psqlc -At -c "select md5(pg_get_functiondef('public.pact_enforce_player_ap_ceiling()'::regprocedure))"; }
counts() { psqlc -At -c "select count(*) filter (where verdict='PASS') || ' passed, ' || count(*) filter (where verdict='FAIL') || ' failed (of ' || count(*) || ')' from res"; }
fails() { psqlc -At -F ' | ' -c "select verdict, expect, got, name from res where verdict='FAIL' order by n" | cut -c1-220; }
LIVE=$(def)
echo "=== BEFORE (the 2026-09-03 rule live today; the player-award attacks SHOULD show FAIL = allowed) ==="
psqlc < award-cases.sql >/dev/null; echo "BEFORE: $(counts)"; fails | sed 's/^/  gap today: /'
[ "$(psqlc -At -c "select count(*) from res where verdict='FAIL' and got like 'ERROR%'")" = "0" ] || { echo "HARNESS ERROR before the migration"; exit 1; }
echo "=== applying $M/2026-10-12-server-player-award-after-lock.sql ==="
psqlc < "$M/2026-10-12-server-player-award-after-lock.sql"
psqlc < award-cases.sql >/dev/null; echo "AFTER: $(counts)"
[ "$(psqlc -At -c "select count(*) from res where verdict='FAIL'")" = "0" ] || { fails; echo "FAILED"; exit 1; }
psqlc -At -c "select 'trigger function callable by authenticated: ' || has_function_privilege('authenticated','public.pact_enforce_player_ap_ceiling()','EXECUTE')"
echo "=== rollback: the definition must be byte-identical to 2026-09-03 ==="
psqlc < "$M/2026-10-12-server-player-award-after-lock-rollback.sql"
[ "$(def)" = "$LIVE" ] && echo "rollback restores the 2026-09-03 definition exactly" || { echo "ROLLBACK DIFFERS"; exit 1; }
psqlc < award-cases.sql >/dev/null; echo "AFTER ROLLBACK (the gap is back): $(counts)"
echo done
