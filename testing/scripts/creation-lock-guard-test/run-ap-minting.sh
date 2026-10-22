#!/usr/bin/env bash
# Throwaway-Postgres rehearsal of sql/migrations/2026-10-22-ap-minting-and-edit-award-campaign.sql (+ rollback). Needs Docker only; touches NO real database.
# Builds the fresh-install path (schema.sql + rls-policies.sql, which already carries the fix), then rolls the migration BACK so the
# BEFORE run sees today's production behaviour: the minting chain and the former-DM edit show FAIL (the gap). Then applies the migration
# (AFTER: every row PASS, definitions match the fold), re-applies it (re-runnable), and rolls back again (edit_ap_award byte-identical
# to its pre-fix definition, trigger gone).
# Usage: testing/scripts/creation-lock-guard-test/run-ap-minting.sh
set -euo pipefail
cd "$(dirname "$0")"
C=pact-apmint-test
psqlc() { docker exec -i -e PGOPTIONS="-c client_min_messages=warning" "$C" psql -U postgres -v ON_ERROR_STOP=1 -q -P pager=off "$@"; }
docker rm -f "$C" >/dev/null 2>&1 || true
docker run -d --name "$C" -e POSTGRES_PASSWORD=pw postgres:17-alpine >/dev/null
trap 'docker rm -f "$C" >/dev/null 2>&1' EXIT
for i in $(seq 1 30); do docker exec "$C" pg_isready -U postgres -q && break; sleep 1; done
sleep 2
M=../../../sql/migrations
MIG=$M/2026-10-22-ap-minting-and-edit-award-campaign.sql
ROLL=$M/2026-10-22-ap-minting-and-edit-award-campaign-rollback.sql
{ cat award-shims.sql ../../../sql/schema.sql ../../../sql/rls-policies.sql; } | psqlc >/dev/null
fresh() { # a clean database state for each run of the cases
  psqlc -c "truncate characters, character_backups, campaign_dms, campaigns, ap_awards, ap_award_edits, gold_awards cascade; delete from auth.users;" >/dev/null
  psqlc -c "insert into auth.users(id) select ('a0000000-0000-0000-0000-00000000000' || g)::uuid from generate_series(1,9) g union all select 'd0000000-0000-0000-0000-000000000001'"
}
def() { psqlc -At -c "select md5(pg_get_functiondef('public.$1'::regprocedure))"; }
counts() { psqlc -At -c "select count(*) filter (where verdict='PASS') || ' passed, ' || count(*) filter (where verdict='FAIL') || ' failed (of ' || count(*) || ')' from res"; }
fails() { psqlc -At -F ' | ' -c "select verdict, expect, got, name from res where verdict='FAIL' order by n" | cut -c1-230; }
EDIT='edit_ap_award(uuid,integer,text,timestamptz,text)'
TRIG='pact_reset_campaign_grants_on_move()'
FOLDED_EDIT=$(def "$EDIT")
FOLDED_TRIG=$(def "$TRIG")
psqlc < "$ROLL"
PRE_EDIT=$(def "$EDIT")
echo "=== BEFORE (today's production behaviour; the attacks SHOULD show FAIL = they work) ==="
fresh; psqlc < ap-minting-cases.sql >/dev/null; echo "BEFORE: $(counts)"; fails | sed 's/^/  gap today: /'
[ "$(psqlc -At -c "select count(*) from res where verdict='FAIL' and got like 'ERROR%'")" = "0" ] || { echo "HARNESS ERROR before the migration"; exit 1; }
echo "=== applying $MIG ==="
psqlc -1 < "$MIG"
fresh; psqlc < ap-minting-cases.sql >/dev/null; echo "AFTER: $(counts)"
[ "$(psqlc -At -c "select count(*) from res where verdict='FAIL'")" = "0" ] || { fails; echo "FAILED"; exit 1; }
psqlc -1 < "$MIG"; echo "re-applied: migration is re-runnable"
psqlc -At -c "select 'trigger fn callable by authenticated: ' || has_function_privilege('authenticated','public.$TRIG','EXECUTE')"
psqlc -At -c "select 'edit_ap_award: authenticated=' || has_function_privilege('authenticated','public.$EDIT','EXECUTE') || ' anon=' || has_function_privilege('anon','public.$EDIT','EXECUTE') || ' public=' || has_function_privilege('public','public.$EDIT','EXECUTE')"
if [ "$(def "$EDIT")" = "$FOLDED_EDIT" ] && [ "$(def "$TRIG")" = "$FOLDED_TRIG" ]; then
  echo "the migration's definitions are byte-identical to rls-policies.sql's (the fold)"
else
  echo "FOLD DIFFERS from the migration"; exit 1
fi
echo "=== rollback: edit_ap_award must be byte-identical to the pre-fix definition, trigger gone ==="
psqlc < "$ROLL"
[ "$(def "$EDIT")" = "$PRE_EDIT" ] && echo "rollback restores edit_ap_award exactly" || { echo "ROLLBACK DIFFERS"; exit 1; }
[ "$(psqlc -At -c "select count(*) from pg_trigger where tgname='trg_pact_aa_reset_grants_on_campaign_move'")" = "0" ] && echo "trigger removed" || { echo "TRIGGER REMAINS"; exit 1; }
fresh; psqlc < ap-minting-cases.sql >/dev/null; echo "AFTER ROLLBACK (the gap is back): $(counts)"
echo done
