#!/usr/bin/env bash
# Throwaway-Postgres rehearsal of sql/migrations/2026-10-15-boon-drawback-notes.sql (+ rollback). Needs Docker only; touches
# NO real database. Builds the fresh-install path (schema.sql + rls-policies.sql — which carries this migration since its
# 2026-10-19 fold, so the script first steps back with the rollback) plus the two migrations applied live but not
# yet folded into the baseline (2026-09-03-dm-zero-player-ap, 2026-10-12-server-player-award-after-lock), so every characters
# trigger live today runs. BEFORE: the attacks on an approved description are allowed and the DM's approve/unlock are unknown
# (FAIL rows). AFTER: every row PASS. Rollback: dm_edit_character_log byte-identical to BASE, the added objects gone.
# Usage: testing/scripts/creation-lock-guard-test/run-notes.sh
set -euo pipefail
cd "$(dirname "$0")"
C=pact-notes-test
psqlc() { docker exec -i -e PGOPTIONS="-c client_min_messages=warning" "$C" psql -U postgres -v ON_ERROR_STOP=1 -q -P pager=off "$@"; }
docker rm -f "$C" >/dev/null 2>&1 || true
docker run -d --name "$C" -e POSTGRES_PASSWORD=pw postgres:17-alpine >/dev/null
trap 'docker rm -f "$C" >/dev/null 2>&1' EXIT
for i in $(seq 1 30); do docker exec "$C" pg_isready -U postgres -q && break; sleep 1; done
sleep 2
M=../../../sql/migrations
{ cat award-shims.sql ../../../sql/schema.sql ../../../sql/rls-policies.sql "$M/2026-09-03-dm-zero-player-ap.sql" "$M/2026-10-12-server-player-award-after-lock.sql"; } | psqlc >/dev/null
psqlc -c "insert into auth.users(id) select ('a0000000-0000-0000-0000-00000000000' || g)::uuid from generate_series(1,9) g union all select 'd0000000-0000-0000-0000-000000000001'"
def() { psqlc -At -c "select md5(pg_get_functiondef('public.dm_edit_character_log(uuid,jsonb)'::regprocedure))"; }
# The migration was APPLIED 2026-10-19 and folded into rls-policies.sql, so the baseline built above already HAS it. Record
# that definition (FOLDED), then step back to the pre-migration state with the rollback, so BEFORE / AFTER / rollback below
# still rehearse the same transition they did before the fold; AFTER must then match FOLDED (baseline and migration agree).
FOLDED=$(def)
psqlc -1 < "$M/2026-10-15-boon-drawback-notes-rollback.sql"
counts() { psqlc -At -c "select count(*) filter (where verdict='PASS') || ' passed, ' || count(*) filter (where verdict='FAIL') || ' failed (of ' || count(*) || ')' from res"; }
fails() { psqlc -At -F ' | ' -c "select verdict, expect, got, name from res where verdict='FAIL' order by n" | cut -c1-240; }
BASE=$(def)
echo "BASE dm_edit_character_log md5: $BASE   (compare with production before applying)"
echo "=== BEFORE (today's definitions; the attacks and the DM's approve/unlock SHOULD show FAIL) ==="
psqlc < notes-cases.sql >/dev/null; echo "BEFORE: $(counts)"; fails | sed 's/^/  gap today: /'
[ "$(psqlc -At -c "select count(*) from res where verdict='FAIL' and got like 'ERROR%'")" = "0" ] || { echo "HARNESS ERROR before the migration"; exit 1; }
echo "=== applying $M/2026-10-15-boon-drawback-notes.sql (single transaction) ==="
psqlc -1 < "$M/2026-10-15-boon-drawback-notes.sql"
psqlc < notes-cases.sql >/dev/null; echo "AFTER: $(counts)"
[ "$(psqlc -At -c "select count(*) from res where verdict='FAIL'")" = "0" ] || { fails; echo "FAILED"; exit 1; }
psqlc -At -c "select 'callable by authenticated: pact_item_note_state=' || has_function_privilege('authenticated','public.pact_item_note_state(jsonb,text,text,text)','EXECUTE') || ' pact_enforce_item_note_lock=' || has_function_privilege('authenticated','public.pact_enforce_item_note_lock()','EXECUTE') || ' pact_js_trim=' || has_function_privilege('authenticated','public.pact_js_trim(text)','EXECUTE')"
[ "$(def)" = "$FOLDED" ] && echo "the migration's dm_edit_character_log is byte-identical to rls-policies.sql's (the fold)" || { echo "FOLD DIFFERS from the migration"; exit 1; }
psqlc -At -c "select 'dm_edit_character_log keeps every live feature: ' || (prosrc like '%assert_campaign_active%' and prosrc like '%has no matching award%' and prosrc like '%dmUnlockDrawback%' and prosrc like '%dmDiscount%' and prosrc like '%dmApproveNote%') from pg_proc where proname='dm_edit_character_log'"
echo "=== rollback: dm_edit_character_log must be byte-identical to BASE ==="
psqlc -1 < "$M/2026-10-15-boon-drawback-notes-rollback.sql"
[ "$(def)" = "$BASE" ] && echo "rollback restores the BASE definition exactly" || { echo "ROLLBACK DIFFERS"; exit 1; }
[ "$(psqlc -At -c "select count(*) from pg_proc where proname in ('pact_item_note_state','pact_enforce_item_note_lock','pact_js_trim')")" = "0" ] \
  && [ "$(psqlc -At -c "select count(*) from pg_trigger where tgname='trg_pact_item_note_lock'")" = "0" ] \
  && echo "rollback drops the added functions and trigger" || { echo "ROLLBACK LEFT OBJECTS"; exit 1; }
psqlc < notes-cases.sql >/dev/null; echo "AFTER ROLLBACK (the gap is back): $(counts)"
echo done
