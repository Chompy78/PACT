#!/usr/bin/env bash
# Throwaway-Postgres test for sql/migrations/2026-10-04-creation-lock-guard.sql.
# Needs Docker only. Touches NO real database. Usage: testing/scripts/creation-lock-guard-test/run.sh
set -euo pipefail
cd "$(dirname "$0")"
C=pact-lockguard-test
psqlc() { docker exec -i "$C" psql -U postgres -v ON_ERROR_STOP=1 -q -P pager=off "$@"; }
docker rm -f "$C" >/dev/null 2>&1 || true
docker run -d --name "$C" -e POSTGRES_PASSWORD=pw postgres:17-alpine >/dev/null
trap 'docker rm -f "$C" >/dev/null 2>&1' EXIT
for i in $(seq 1 30); do docker exec "$C" pg_isready -U postgres -q && break; sleep 1; done
sleep 2
psqlc < base.sql; psqlc < triggers.sql
echo "=== BEFORE the guard (rows expecting 'refused' SHOULD show FAIL here: the attack works today) ==="
psqlc < guard-cases.sql
echo "=== applying sql/migrations/2026-10-04-creation-lock-guard.sql ==="
psqlc < ../../../sql/migrations/2026-10-04-creation-lock-guard.sql
echo "=== AFTER the guard (every row must be PASS) ==="
psqlc < guard-cases.sql | tee /dev/stderr | grep -q " FAIL " && { echo "FAILED"; exit 1; }
echo "=== DM tools (dm_reopen_creation / dm_set_creation_ceiling) ==="
psqlc < dm-rpcs.sql; psqlc < dm-rpc-cases.sql
echo "=== L1 (move keeps the lock) + S1 (campaign backups kept) ==="
psqlc < move-and-backups.sql
echo "done"
