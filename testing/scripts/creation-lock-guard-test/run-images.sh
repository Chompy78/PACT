#!/usr/bin/env bash
# Throwaway-Postgres rehearsal of sql/migrations/2026-10-15-character-images.sql (+ rollback). Needs Docker only;
# touches NO real database. Builds the fresh-install path (schema.sql + rls-policies.sql) plus a stand-in for the two
# Supabase Storage tables (images-storage-shim.sql), then:
#   BEFORE   no policies — every read is 'no' and every write refused (the owner rows FAIL: the feature isn't there)
#   AFTER    the migration — every row PASS
#   AGAIN    the migration is re-runnable — every row still PASS
#   ROLLBACK policies and helpers gone; back to the BEFORE counts
# Usage: testing/scripts/creation-lock-guard-test/run-images.sh
set -euo pipefail
cd "$(dirname "$0")"
C=pact-images-test
psqlc() { docker exec -i -e PGOPTIONS="-c client_min_messages=warning" "$C" psql -U postgres -v ON_ERROR_STOP=1 -q -P pager=off "$@"; }
docker rm -f "$C" >/dev/null 2>&1 || true
docker run -d --name "$C" -e POSTGRES_PASSWORD=pw postgres:17-alpine >/dev/null
trap 'docker rm -f "$C" >/dev/null 2>&1' EXIT
for i in $(seq 1 30); do docker exec "$C" pg_isready -U postgres -q && break; sleep 1; done
sleep 2
M=../../../sql/migrations
{ cat award-shims.sql ../../../sql/schema.sql ../../../sql/rls-policies.sql images-storage-shim.sql; } | psqlc >/dev/null
psqlc -c "insert into auth.users(id) values ('d0000000-0000-0000-0000-000000000001'),('d0000000-0000-0000-0000-000000000002'),('d0000000-0000-0000-0000-000000000003'),('a0000000-0000-0000-0000-000000000001'),('a0000000-0000-0000-0000-000000000002'),('a0000000-0000-0000-0000-000000000003'),('a0000000-0000-0000-0000-000000000005')" >/dev/null
counts() { psqlc -At -c "select count(*) filter (where verdict='PASS') || ' passed, ' || count(*) filter (where verdict='FAIL') || ' failed (of ' || count(*) || ')' from res"; }
fails() { psqlc -At -F ' | ' -c "select verdict, expect, got, name from res where verdict='FAIL' order by n" | cut -c1-200; }
errs() { psqlc -At -c "select count(*) from res where got like 'ERROR%'"; }
echo "=== BEFORE (no policies: owner/DM/member reads and owner writes SHOULD show FAIL) ==="
psqlc < images-cases.sql >/dev/null; echo "BEFORE: $(counts)"; fails | sed 's/^/  not yet: /'
[ "$(errs)" = "0" ] || { echo "HARNESS ERROR before the migration"; exit 1; }
BEFORE=$(counts)
echo "=== applying $M/2026-10-15-character-images.sql ==="
psqlc < "$M/2026-10-15-character-images.sql"
psqlc < images-cases.sql >/dev/null; echo "AFTER: $(counts)"
[ "$(psqlc -At -c "select count(*) from res where verdict='FAIL'")" = "0" ] || { fails; echo "FAILED"; exit 1; }
psqlc -At -c "select 'bucket: ' || id || ' public=' || public || ' limit=' || file_size_limit || ' types=' || array_to_string(allowed_mime_types, ',') from storage.buckets where id='character-images'"
psqlc -At -c "select 'anon may execute helpers: ' || bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')) from pg_proc p where proname in ('can_read_character_image','can_write_character_image','character_image_character')"
echo "=== re-run the migration (must be idempotent) ==="
psqlc < "$M/2026-10-15-character-images.sql"
psqlc < images-cases.sql >/dev/null; echo "AGAIN: $(counts)"
[ "$(psqlc -At -c "select count(*) from res where verdict='FAIL'")" = "0" ] || { fails; echo "FAILED on re-run"; exit 1; }
echo "=== rollback ==="
psqlc < "$M/2026-10-15-character-images-rollback.sql"
[ "$(psqlc -At -c "select count(*) from pg_policies where schemaname='storage' and policyname like 'character_images_%'")" = "0" ] || { echo "ROLLBACK LEFT POLICIES"; exit 1; }
[ "$(psqlc -At -c "select count(*) from pg_proc where proname in ('can_read_character_image','can_write_character_image','character_image_character')")" = "0" ] || { echo "ROLLBACK LEFT FUNCTIONS"; exit 1; }
psqlc < images-cases.sql >/dev/null; AFTERRB=$(counts); echo "AFTER ROLLBACK: $AFTERRB"
[ "$AFTERRB" = "$BEFORE" ] || { echo "ROLLBACK DOES NOT RETURN TO THE BEFORE STATE"; exit 1; }
echo done
