#!/usr/bin/env node
/**
 * backup-replay-audit.mjs — would the server-freeze migration have REFUSED a real, historical save?
 *
 * WHY. The main risk of sql/migrations/2026-10-05-server-freeze-d2-e1-stage1.sql (plan: docs/plans/2026-10-04-server-freeze-d2-e1.md) is a false refusal:
 * an honest save blocked because a client legitimately rewrote something the new rule protects. `character_backups` holds the OLD row of every update to a
 * character (the snapshot trigger fires BEFORE UPDATE, and campaign characters keep every backup), so consecutive backups — and the last backup against the live
 * row — are the real old→new pairs players actually saved. This replays every pair through the OLD trigger functions and then the NEW ones, on a throwaway Docker
 * Postgres, and lists the pairs only the NEW rule refuses. Each must be explainable as an illegitimate rewrite; a legitimate one means the rule is wrong.
 *
 * Isolates the locked-history trigger (the only thing the migration changes): the replay runs as an admin session (no JWT claims, so the creation-lock guard is
 * skipped, as it is for any direct session) and with only that one trigger installed. Solo characters keep only their last ~50 backups, so a pair there can span
 * several saves — still a valid old→new pair, just coarser.
 *
 * Input: a JSON export {backups:[{character_id,campaign_id,owner_id,name,ap,captured_at,id,stats}], live:[{id,campaign_id,owner_id,name,ap,stats}], campaign_dms:[…]}
 * made with a read-only query against the live database. The export holds real player data: keep it OUT of the repository.
 *
 * Run: node testing/scripts/creation-lock-guard-test/backup-replay-audit.mjs <export.json> [report.json]     (needs Docker)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const [exportPath, reportPath] = process.argv.slice(2);
if (!exportPath) { console.error('usage: backup-replay-audit.mjs <export.json> [report.json]'); process.exit(2); }
const exp = JSON.parse(readFileSync(exportPath, 'utf8'));

// ---- the old→new pairs ----
const byChar = new Map();
for (const b of exp.backups) { if (!byChar.has(b.character_id)) byChar.set(b.character_id, []); byChar.get(b.character_id).push(b); }
const live = new Map(exp.live.map(c => [c.id, c]));
const pairs = [];
for (const [cid, arr] of byChar) {
  arr.sort((a, b) => (a.captured_at < b.captured_at ? -1 : a.captured_at > b.captured_at ? 1 : 0));
  for (let i = 0; i < arr.length; i++) {
    const oldB = arr[i], next = arr[i + 1] || live.get(cid);
    if (!next) continue;                                   // the character was deleted: no new state to compare
    if (JSON.stringify(oldB.stats) === JSON.stringify(next.stats)) continue;   // a save that changed no stats (rename, ap, …)
    pairs.push({ cid, name: next.name, oldCampaign: oldB.campaign_id, newCampaign: next.campaign_id, owner: oldB.owner_id, at: oldB.captured_at, old: oldB.stats, nu: next.stats, last: !arr[i + 1] });
  }
}
console.log(`${exp.backups.length} backups of ${byChar.size} characters -> ${pairs.length} old→new pairs that changed stats`);

// ---- Docker ----
const C = 'pact-replay-audit';
const sh = (cmd, input) => { const r = spawnSync('bash', ['-c', cmd], { input, encoding: 'utf8', maxBuffer: 1 << 28 }); if (r.status !== 0) throw new Error(cmd + '\n' + r.stderr); return r.stdout; };
const psql = (sql, flags = '-q') => sh(`docker exec -i ${C} psql -U postgres -v ON_ERROR_STOP=1 ${flags} -P pager=off`, sql);
const sqlFile = f => readFileSync(join(HERE, f), 'utf8');
const migrations = n => readFileSync(join(REPO, 'sql/migrations', n), 'utf8');
sh(`docker rm -f ${C} >/dev/null 2>&1 || true; docker run -d --name ${C} -e POSTGRES_PASSWORD=pw postgres:17-alpine >/dev/null`);
try {
  for (let i = 0; i < 40; i++) { try { sh(`docker exec ${C} pg_isready -U postgres -q`); break; } catch (e) { sh('sleep 1'); } }
  sh('sleep 2');
  psql(sqlFile('base.sql'));
  psql(sqlFile('freeze-live-defs.sql'));          // the two functions exactly as live
  psql(`drop trigger if exists trg_pact_campaign_move_clears_creation on public.characters; drop trigger if exists trg_characters_snapshot on public.characters; drop trigger if exists trg_characters_updated_at on public.characters;
        create trigger trg_pact_locked_history before update on public.characters for each row execute function public.pact_enforce_locked_history();`);
  const dq = s => '$j$' + s + '$j$';
  let load = 'create table trans(n int primary key, cid uuid, owner uuid, old_campaign uuid, new_campaign uuid, old_stats jsonb, new_stats jsonb);\ncreate table audit_res(label text, n int, verdict text, msg text);\n';
  const camps = new Set(pairs.flatMap(p => [p.oldCampaign, p.newCampaign]).filter(Boolean));
  for (const c of camps) load += `insert into public.campaigns(id, dm_id, name) values ('${c}', gen_random_uuid(), 'c') on conflict do nothing;\n`;
  pairs.forEach((p, i) => { load += `insert into trans values (${i}, '${p.cid}', '${p.owner}', ${p.oldCampaign ? `'${p.oldCampaign}'` : 'null'}, ${p.newCampaign ? `'${p.newCampaign}'` : 'null'}, ${dq(JSON.stringify(p.old))}::jsonb, ${dq(JSON.stringify(p.nu))}::jsonb);\n`; });
  load += `create function run_audit(p_label text) returns void language plpgsql as $f$
declare r record; v text; m text;
begin
  for r in select * from trans order by n loop
    delete from public.characters;
    insert into public.characters(id, owner_id, campaign_id, name, stats) values (r.cid, r.owner, r.old_campaign, 'x', r.old_stats);
    begin
      update public.characters set campaign_id = r.new_campaign, stats = r.new_stats where id = r.cid;
      v := 'allowed'; m := null;
    exception when others then
      m := sqlerrm; v := case when sqlerrm like '%locked character history%' then 'refused' else 'ERROR' end;
    end;
    insert into audit_res values (p_label, r.n, v, m);
  end loop;
end $f$;\n`;
  psql(load);
  psql("select set_config('request.jwt.claims', '', false); select run_audit('old');");
  psql(migrations('2026-10-05-server-freeze-d2-e1-stage1.sql'));
  psql("select run_audit('new');");
  const rows = JSON.parse(psql(`select coalesce(json_agg(json_build_object('n', n, 'label', label, 'verdict', verdict, 'msg', msg)), '[]') from audit_res`, '-At'));
  const get = (label, n) => rows.find(r => r.label === label && r.n === n);
  const out = { pairs: pairs.length, oldRefused: 0, newRefused: 0, newOnly: [], errors: [] };
  pairs.forEach((p, i) => {
    const o = get('old', i), nw = get('new', i);
    if (o.verdict === 'ERROR' || nw.verdict === 'ERROR') out.errors.push({ i, name: p.name, old: o.msg, nu: nw.msg });
    if (o.verdict === 'refused') out.oldRefused++;
    if (nw.verdict === 'refused') out.newRefused++;
    if (nw.verdict === 'refused' && o.verdict !== 'refused') {
      // locate the first differing event so each flagged pair can be classified by hand
      const A = p.old.LOG || [], B = p.nu.LOG || [];
      const strip = e => { const x = { ...e }; for (const k of ['seq', 'ts', 'rules', 'label']) delete x[k]; return JSON.stringify(x); };
      let at = -1; for (let k = 0; k < Math.max(A.length, B.length); k++) { if ((A[k] ? strip(A[k]) : '') !== (B[k] ? strip(B[k]) : '')) { at = k; break; } }
      const keys = (e, f) => e && e.payload && e.payload.patch ? Object.keys(e.payload.patch).join(',') : '';
      out.newOnly.push({ i, name: p.name, at: p.at, campaign: !!(p.newCampaign), lastPair: p.last, msg: nw.msg, firstDiffIndex: at, oldEvent: A[at] ? `${A[at].type}/${A[at].cat || ''} ${keys(A[at])} cost=${A[at].cost}` : '(none)', newEvent: B[at] ? `${B[at].type}/${B[at].cat || ''} ${keys(B[at])} cost=${B[at].cost}` : '(none)', oldLen: A.length, newLen: B.length });
    }
  });
  console.log(`\nOLD rule refuses ${out.oldRefused} of ${pairs.length}; NEW rule refuses ${out.newRefused} of ${pairs.length}; refused ONLY by the new rule: ${out.newOnly.length}; trigger errors: ${out.errors.length}`);
  for (const f of out.newOnly) console.log(`  NEW-ONLY #${f.i} ${f.name} @${String(f.at).slice(0, 19)} diff@${f.firstDiffIndex} (${f.oldLen}->${f.newLen} events)\n     old: ${f.oldEvent}\n     new: ${f.newEvent}\n     ${String(f.msg).slice(0, 110)}`);
  for (const e of out.errors) console.log('  ERROR', JSON.stringify(e).slice(0, 200));
  if (reportPath) writeFileSync(reportPath, JSON.stringify(out, null, 1));
  process.exitCode = out.errors.length ? 1 : 0;
} finally { try { sh(`docker rm -f ${C} >/dev/null 2>&1`); } catch (e) {} }
