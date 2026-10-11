#!/usr/bin/env bash
# Throwaway-Postgres rehearsal of sql/migrations/2026-10-05-server-freeze-d2-e1-stage1.sql and 2026-10-11-server-freeze-stage2.sql (+ their rollbacks). Needs Docker only; touches NO real database.
# Usage: testing/scripts/creation-lock-guard-test/run-freeze.sh        (expect: BEFORE shows the attacks working; AFTER every row PASS; rollback byte-identical)
set -euo pipefail
cd "$(dirname "$0")"
C=pact-freeze-test
psqlc() { docker exec -i "$C" psql -U postgres -v ON_ERROR_STOP=1 -q -P pager=off "$@"; }
docker rm -f "$C" >/dev/null 2>&1 || true
docker run -d --name "$C" -e POSTGRES_PASSWORD=pw postgres:17-alpine >/dev/null
trap 'docker rm -f "$C" >/dev/null 2>&1' EXIT
for i in $(seq 1 30); do docker exec "$C" pg_isready -U postgres -q && break; sleep 1; done
sleep 2
psqlc < base.sql; psqlc < triggers.sql
psqlc < ../../../sql/migrations/2026-10-04-creation-lock-guard.sql      # the lock guard is live today
psqlc < freeze-live-defs.sql                                            # the two functions exactly as live
defs() { psqlc -At -c "select md5(pg_get_functiondef('public.pact_ap_ledger_protected(jsonb)'::regprocedure)) || ' ' || md5(pg_get_functiondef('public.pact_enforce_locked_history()'::regprocedure))"; }
counts() { psqlc -At -c "select count(*) filter (where verdict='PASS') || ' passed, ' || count(*) filter (where verdict='FAIL') || ' failed (of ' || count(*) || ')' from res"; }
LIVE=$(defs)
echo "=== BEFORE the freeze (rows expecting 'refused' SHOULD show FAIL: the attacks work today) ==="
psqlc < freeze-cases.sql >/dev/null; echo "BEFORE: $(counts)"; psqlc -At -F ' | ' -c "select verdict, name from res where verdict='FAIL' order by n" | sed 's/^/  attack works today: /' | cut -c1-170
echo "=== applying sql/migrations/2026-10-05-server-freeze-d2-e1-stage1.sql ==="
psqlc < ../../../sql/migrations/2026-10-05-server-freeze-d2-e1-stage1.sql
echo "=== AFTER the freeze (every row must be PASS) ==="
psqlc < freeze-cases.sql >/dev/null; echo "AFTER: $(counts)"
[ "$(psqlc -At -c "select count(*) from res where verdict='FAIL'")" = "0" ] || { psqlc -At -F ' | ' -c "select verdict, expect, got, name from res where verdict='FAIL' order by n"; echo "FAILED"; exit 1; }
echo "=== STAGE 2: the temporary exemption is removed (sql/migrations/2026-10-11-server-freeze-stage2.sql) ==="
tmp() { psqlc -At -c "select md5(pg_get_functiondef('public.pact_patch_temp_exempt_keys()'::regprocedure))"; }
STAGE1_TMP=$(tmp)
psqlc < ../../../sql/migrations/2026-10-11-server-freeze-stage2.sql
psqlc -v tmpexp=refused < freeze-cases.sql >/dev/null; echo "STAGE 2: $(counts)"
[ "$(psqlc -At -c "select count(*) from res where verdict='FAIL'")" = "0" ] || { psqlc -At -F ' | ' -c "select verdict, expect, got, name from res where verdict='FAIL' order by n"; echo "STAGE 2 FAILED"; exit 1; }
echo "=== stage-2 rollback: the stage-1 exempt list comes back exactly ==="
psqlc < ../../../sql/migrations/2026-10-11-server-freeze-stage2-rollback.sql
[ "$(tmp)" = "$STAGE1_TMP" ] && echo "stage-2 rollback restores the stage-1 list exactly" || { echo "STAGE-2 ROLLBACK DIFFERS"; exit 1; }
psqlc < freeze-cases.sql >/dev/null; echo "AFTER STAGE-2 ROLLBACK (stage-1 expectations): $(counts)"
[ "$(psqlc -At -c "select count(*) from res where verdict='FAIL'")" = "0" ] || { echo "STAGE 1 EXPECTATIONS BROKEN AFTER STAGE-2 ROLLBACK"; exit 1; }
echo "=== rollback: definitions must be byte-identical to the live ones ==="
psqlc < ../../../sql/migrations/2026-10-05-server-freeze-d2-e1-stage1-rollback.sql
[ "$(defs)" = "$LIVE" ] && echo "rollback restores the live definitions exactly" || { echo "ROLLBACK DIFFERS"; exit 1; }
echo "=== BEFORE-state cases again after the rollback (the attacks work again) ==="
psqlc < freeze-cases.sql >/dev/null; echo "AFTER ROLLBACK: $(counts)"
echo done
