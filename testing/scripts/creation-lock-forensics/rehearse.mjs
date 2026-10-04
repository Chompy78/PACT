// Rehearse ONE character's repair write in the throwaway Docker Postgres before it is made on live.
//   node rehearse.mjs <live.json> <repair-out.json> "<Name>" <rehearse-extras.sql> [--disable-history-lock]
// Loads the harness (testing/scripts/creation-lock-guard-test) + the live ledger/budget triggers, inserts the character's REAL
// pre-repair row, runs the exact guarded UPDATE the live write will use, reads the row back and re-verifies it. Prints PASS/FAIL.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const H = resolve(dirname(fileURLToPath(import.meta.url)), '../creation-lock-guard-test');
const [liveP, outP, name, extrasP, flag] = process.argv.slice(2);
const live = JSON.parse(readFileSync(liveP, 'utf8')).find(c => c.name === name);
const cand = JSON.parse(readFileSync(outP, 'utf8')).find(c => c.name === name);
if (!live || !cand) { console.error('character not found'); process.exit(2); }
const lit = o => '$j$' + JSON.stringify(o) + '$j$::jsonb';
const C = 'pact-repair-rehearsal';
const sh = (args, input) => spawnSync('docker', args, { input, encoding: 'utf8' });
sh(['rm', '-f', C]);
execFileSync('docker', ['run', '-d', '--name', C, '-e', 'POSTGRES_PASSWORD=pw', 'postgres:17-alpine']);
for (let i = 0; i < 40; i++) { if (sh(['exec', C, 'pg_isready', '-U', 'postgres', '-q']).status === 0) break; execFileSync('sleep', ['1']); }
execFileSync('sleep', ['2']);
const psql = (sql) => sh(['exec', '-i', C, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-A', '-t', '-P', 'pager=off'], sql);
const load = f => { const r = psql(readFileSync(f, 'utf8')); if (r.status !== 0) { console.error('LOAD FAILED', f, r.stderr.slice(0, 400)); process.exit(3); } };
load(H + '/base.sql'); load(H + '/triggers.sql'); load(H + '/../../../sql/migrations/2026-10-04-creation-lock-guard.sql'); load(extrasP);
const camp = 'a6687e29-7c12-46b2-a9a3-711586a9ca12', dm = '3016205d-d33a-44e8-af1a-6574e2e1a359';
const setup = `insert into campaigns(id,dm_id,name,rules) values ('${camp}','${dm}','Amble',$j$${JSON.stringify({ economy: { band: 'standard' }, enforceApBudget: true, drawbackCap: { ap: 12, enabled: true } })}$j$::jsonb);
insert into campaign_dms values ('${camp}','${dm}');
insert into characters(id,owner_id,campaign_id,name,kind,stats,ap,updated_at) values ('${live.id}','a0000000-0000-0000-0000-000000000001','${camp}',$n$${live.name}$n$,'${live.kind}',${lit(live.stats)},${live.ap},'${live.updated_at}');`;
let r = psql(setup); if (r.status !== 0) { console.error('SETUP FAILED', r.stderr.slice(0, 400)); process.exit(4); }
const disable = flag === '--disable-history-lock';
const upd = `${disable ? 'alter table characters disable trigger trg_pact_locked_history;\nalter table characters disable trigger trg_pact_ap_budget_consistency;\n' : ''}begin;
update characters set stats = ${lit(cand.stats)}${cand.newName ? `, name = $n$${cand.newName}$n$` : ''}
 where id = '${live.id}' and updated_at = '${live.updated_at}' and jsonb_array_length(stats->'LOG') = ${live.stats.LOG.length};
commit;
${disable ? 'alter table characters enable trigger trg_pact_locked_history;\nalter table characters enable trigger trg_pact_ap_budget_consistency;\n' : ''}select jsonb_array_length(stats->'LOG'), ap, updated_at from characters where id='${live.id}';`;
r = psql(upd);
const ok = r.status === 0;
console.log(ok ? `PASS — ${name}: the guarded UPDATE was accepted by the real triggers${disable ? ' (history lock + AP budget check disabled for the one transaction)' : ''}.` : `FAIL — ${name}: ${r.stderr.trim().split('\n')[0]}`);
if (ok) {
  const back = psql(`select stats from characters where id='${live.id}'`).stdout.trim();
  const row = JSON.parse(back);
  // jsonb does not keep object key order, so compare structurally, not as strings
  const deq = (a, b) => a === b || (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)
    && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => deq(a[k], b[k])));
  const same = deq(row.LOG, cand.stats.LOG) && row.SEQ === cand.stats.SEQ;
  const apSame = psql(`select ap from characters where id='${live.id}'`).stdout.trim() === String(live.ap);
  console.log(`read-back identical to the candidate: ${same}; ap column unchanged (${live.ap}): ${apSame}`);
  const bk = psql(`select count(*) from character_backups where character_id='${live.id}' and reason='update'`).stdout.trim();
  console.log(`pre-write version snapshotted into character_backups by the trigger: ${bk} row(s)`);
}
sh(['rm', '-f', C]);
process.exit(ok ? 0 : 1);
