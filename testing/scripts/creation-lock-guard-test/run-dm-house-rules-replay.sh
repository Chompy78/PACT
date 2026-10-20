#!/usr/bin/env bash
# PR4/PR5 of D-GH-2026-10-13-campaign-house-rules: replays what the DM Console's Character house rules editor (PR4,
# dm-campaign-house-rules-e2e.mjs) and its per-character override editor (PR5, dm-house-rules-e2e.mjs) actually SEND —
# captured with --dump-calls — against the REAL
# 2026-10-13-campaign-house-rules-server.sql migration in a throwaway Postgres (Docker only; touches NO real database).
# Every call must be accepted by the real RPC / dm_edit_character_log (so the console's from / to / amount, override
# snapshots with pins, refunds, removals and labels pass the server's own checks), and afterwards the SERVER's AP left for
# every finished character must equal the AP left the engine shows in every tool. A character still in creation may only
# differ in the server-stricter direction (its drawback purchases are not re-stamped while a draft — see the PR body).
# Usage: testing/scripts/creation-lock-guard-test/run-dm-house-rules-replay.sh
set -euo pipefail
cd "$(dirname "$0")"
C=pact-dm-house-rules-replay
psqlc() { docker exec -i -e PGOPTIONS="-c client_min_messages=warning" "$C" psql -U postgres -v ON_ERROR_STOP=1 -q -P pager=off "$@"; }
DUMPF=$(mktemp); DUMPO=$(mktemp)
node ../dm-campaign-house-rules-e2e.mjs --dump-calls "$DUMPF" | tail -2
node ../dm-house-rules-e2e.mjs --dump-calls "$DUMPO" | tail -2
docker rm -f "$C" >/dev/null 2>&1 || true
docker run -d --name "$C" -e POSTGRES_PASSWORD=pw postgres:17-alpine >/dev/null
trap 'docker rm -f "$C" >/dev/null 2>&1; rm -f "$DUMPF" "$DUMPO"' EXIT
for i in $(seq 1 30); do docker exec "$C" pg_isready -U postgres -q && break; sleep 1; done
sleep 2
M=../../../sql/migrations
{ cat award-shims.sql ../../../sql/schema.sql ../../../sql/rls-policies.sql; } | psqlc >/dev/null
psqlc -c "insert into auth.users(id) select ('a0000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid from generate_series(1,29) g union all select 'd0000000-0000-0000-0000-000000000001' union all select 'd0000000-0000-0000-0000-000000000002'" >/dev/null
# Applied 2026-10-20 and folded into rls-policies.sql, so the baseline already carries it; re-applying the migration file on top
# (it is re-runnable) keeps this replay pinned to the file itself as well as the fold.
psqlc -1 < "$M/2026-10-13-campaign-house-rules-server.sql" >/dev/null
TOTAL=0
for D in "$DUMPF" "$DUMPO"; do
  node dm-house-rules-replay.mjs "$D" | psqlc >/dev/null
  echo "server vs engine AP left, per scenario and character ($(basename "$D")):"
  psqlc -At -F ' | ' -c "select scn, locked, server, browser, left(name, 40) from rr order by scn, name"
  BAD=$(psqlc -At -c "select count(*) from rr where (locked and server <> browser) or (not locked and server > browser)")
  N=$(psqlc -At -c "select count(*) from rr"); TOTAL=$((TOTAL + N))
  [ "$BAD" = "0" ] || { echo "✗ $BAD of $N disagree"; exit 1; }
done
echo "✓ all $TOTAL character results agree (every console call accepted by the real RPC)"
