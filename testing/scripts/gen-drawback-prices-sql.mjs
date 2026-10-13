#!/usr/bin/env node
/**
 * gen-drawback-prices-sql.mjs — the server's copy of the PRINTED drawback values (owner decision AB1, 2026-10-13,
 * D-GH-2026-10-13-campaign-house-rules).
 *
 * The database cannot read js/engine-data.js, but its AP ledger must know what each printed drawback is worth so that a
 * player-written drawback buy grants at most its effective value (a forged {buy, drawback, cost:-1000} or a made-up name
 * grants nothing). This script GENERATES `public.pact_drawback_printed(name)` — an immutable SQL function over a jsonb
 * literal of every DATA.drawbacks entry — into a marked block of a SQL file. Never hand-edit the block.
 *
 *   node testing/scripts/gen-drawback-prices-sql.mjs              rewrite the block in the LATEST sql file that carries it
 *   node testing/scripts/gen-drawback-prices-sql.mjs --check      exit 1 if that block differs from js/engine-data.js (CI)
 *   node testing/scripts/gen-drawback-prices-sql.mjs --stdout     print the block (to start a NEW migration after a price change)
 *
 * "Latest" = the lexicographically last file under sql/migrations/ (rollbacks excluded) carrying the marker, else
 * sql/rls-policies.sql. Once a migration carrying the block is APPLIED it is history: a later drawback price change ships
 * as a new migration (start it from --stdout) — see docs/VERSION-SYNC.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { DATA } = await import(pathToFileURL(path.join(REPO, 'js/engine.js')).href);
const BEGIN = '-- BEGIN GENERATED pact_drawback_printed — testing/scripts/gen-drawback-prices-sql.mjs; do not edit by hand';
const END = '-- END GENERATED pact_drawback_printed';

function block() {
  const d = DATA.drawbacks;
  const obj = {};
  for (const k of Object.keys(d).sort()) {
    const v = Number(d[k]);
    if (!Number.isFinite(v)) throw new Error(`DATA.drawbacks["${k}"] is not a finite number`);
    obj[k] = v;
  }
  const lit = JSON.stringify(obj, null, 0).replace(/'/g, "''").replace(/,"/g, ',\n    "');
  return [BEGIN,
    `-- ${Object.keys(obj).length} printed drawbacks, js/engine-data.js rules ${DATA.version}. NULL = not a printed drawback.`,
    'create or replace function public.pact_drawback_printed(p_name text)',
    'returns numeric language sql immutable set search_path = public, pg_temp as $$',
    "  select (('" + lit + "'::jsonb) ->> p_name)::numeric;",
    '$$;',
    END].join('\n');
}

function latestFile() {
  const dir = path.join(REPO, 'sql/migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql') && !/rollback/.test(f)).sort()
    .filter(f => fs.readFileSync(path.join(dir, f), 'utf8').includes(BEGIN));
  if (files.length) return path.join(dir, files[files.length - 1]);
  const base = path.join(REPO, 'sql/rls-policies.sql');
  if (fs.readFileSync(base, 'utf8').includes(BEGIN)) return base;
  throw new Error('no SQL file carries the generated pact_drawback_printed block');
}

const args = process.argv.slice(2);
const want = block();
if (args.includes('--stdout')) { console.log(want); process.exit(0); }
const file = latestFile();
const src = fs.readFileSync(file, 'utf8');
const a = src.indexOf(BEGIN), b = src.indexOf(END);
if (a < 0 || b < a) { console.error(`${file}: malformed generated block`); process.exit(1); }
const have = src.slice(a, b + END.length);
const rel = path.relative(REPO, file);
if (args.includes('--check')) {
  if (have === want) { console.log(`✓ ${rel}: pact_drawback_printed matches js/engine-data.js (rules ${DATA.version}, ${Object.keys(DATA.drawbacks).length} drawbacks)`); process.exit(0); }
  console.error(`✗ ${rel}: pact_drawback_printed is out of date with js/engine-data.js — re-run the generator:\n    node testing/scripts/gen-drawback-prices-sql.mjs\n  (if that migration is already APPLIED, start a NEW migration from --stdout instead; docs/VERSION-SYNC.md)`);
  process.exit(1);
}
fs.writeFileSync(file, src.slice(0, a) + want + src.slice(b + END.length));
console.log(`${have === want ? 'unchanged' : 'rewrote'} ${rel}`);
