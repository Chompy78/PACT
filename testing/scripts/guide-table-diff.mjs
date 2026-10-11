#!/usr/bin/env node
/**
 * guide-table-diff.mjs — diff the TABLE CONTENT of the Players Guide master against the served copy.
 *
 * WHY THIS EXISTS
 * ---------------
 * The served copy (`docs/PACT-Players-Guide.html`) and the `pact-guide` master legitimately differ in three
 * presentation ways only (embedded images, theme blocks, banner CSS — see docs/VERSION-SYNC.md). Their
 * *content* is meant to be identical, but nothing compared it: on 2026-10-08 the served Ranger table was found
 * to carry a "Subclass bonus spells" row the master lacked. verify-guide.mjs cannot catch this in CI because
 * the master lives on the home server, not in this repo — so this is a LOCAL helper, run by hand (or by a
 * session with both files) before and after any guide edit or transfer.
 *
 * USAGE
 *   node guide-table-diff.mjs <master.html> [<served.html>]
 *     served defaults to docs/PACT-Players-Guide.html in this repo.
 *
 * Tables are paired by content similarity (walking both files in order) and compared row by row on their visible text (markup, colours and
 * images ignored; repeated rows are counted, row ORDER is not compared). Exit 0 = the table text is identical. Exit 1 = a difference (printed).
 *
 * LIMITS: the pairing is greedy over a small window, so a table present on one side only can occasionally be paired with a
 * similar unrelated one, and a table with no data rows never pairs; treat the report as a map of where to look, not a verdict.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const masterPath = process.argv[2];
const servedPath = process.argv[3] || join(HERE, '..', '..', 'docs', 'PACT-Players-Guide.html');
if (!masterPath) { console.error('usage: node guide-table-diff.mjs <master.html> [<served.html>]'); process.exit(2); }

// Decode &amp; LAST so "&amp;lt;" stays the literal text "&lt;" instead of being decoded twice; named and numeric dashes are
// normalised so one file writing an en dash as an entity and the other as the character is not a difference.
const text = s => s.replace(/<[^>]+>/g, '').replace(/&#x27;|&#39;|&apos;/g, "'").replace(/&nbsp;|&#160;/g, ' ')
  .replace(/&ndash;|&#8211;|&#x2013;/g, '–').replace(/&mdash;|&#8212;|&#x2014;/g, '—')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

function tablesOf(path) {
  const html = readFileSync(path, 'utf-8');
  const out = [];
  let line = 1, at = 0;   // incremental line counter: slicing the whole prefix per table is quadratic on a 1.4 MB file
  for (const m of html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/g)) {
    for (let i = html.indexOf('\n', at); i !== -1 && i < m.index; i = html.indexOf('\n', at)) { line++; at = i + 1; }
    const rows = [...m[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)]
      .map(r => [...r[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)].map(c => text(c[1])).join(' | '));
    out.push({ line, rows });
  }
  return out;
}

const A = tablesOf(masterPath), B = tablesOf(servedPath);

// Pair tables by CONTENT, walking both documents in order: a table added or removed on one side would otherwise
// shift every later pairing by one and report hundreds of phantom differences.
const jaccard = (x, y) => { const sx = new Set(x), sy = new Set(y); let n = 0; for (const r of sx) if (sy.has(r)) n++; return n / (sx.size + sy.size - n || 1); };
const WINDOW = 6, MIN_SIM = 0.34;
const pairs = [], onlyMasterTables = [], onlyServedTables = [];
let j = 0;
for (let i = 0; i < A.length; i++) {
  let best = -1, bestSim = 0;
  for (let k = j; k < Math.min(B.length, j + WINDOW); k++) {
    const sim = jaccard(A[i].rows, B[k].rows);
    if (sim > bestSim) { bestSim = sim; best = k; }
  }
  if (best >= 0 && bestSim >= MIN_SIM) {
    for (let k = j; k < best; k++) onlyServedTables.push(k);
    pairs.push([i, best]); j = best + 1;
  } else onlyMasterTables.push(i);
}
for (let k = j; k < B.length; k++) onlyServedTables.push(k);

let problems = 0;
console.log(`guide-table-diff — master ${A.length} tables, served ${B.length} tables, ${pairs.length} paired by content`);
for (const [i, k] of pairs) {
  const a = A[i].rows, b = B[k].rows;
  const count = rows => rows.reduce((m, r) => m.set(r, (m.get(r) || 0) + 1), new Map());
  const ca = count(a), cb = count(b);
  const surplus = (x, cx, cy) => { const seen = new Map(); return x.filter(r => { const n = (seen.get(r) || 0) + 1; seen.set(r, n); return n > (cy.get(r) || 0); }); };
  const onlyServed = surplus(b, cb, ca);
  const onlyMaster = surplus(a, ca, cb);
  if (!onlyServed.length && !onlyMaster.length) continue;
  problems++;
  console.log(`\n## master line ${A[i].line} / served line ${B[k].line} — first row: ${(a[0] || b[0]).slice(0, 90)}`);
  for (const r of onlyMaster) console.log(`  only in MASTER: ${r.slice(0, 220)}`);
  for (const r of onlyServed) console.log(`  only in SERVED: ${r.slice(0, 220)}`);
}
for (const i of onlyMasterTables) { problems++; console.log(`\n## table only in MASTER (line ${A[i].line}) — first row: ${(A[i].rows[0] || '').slice(0, 120)}`); }
for (const k of onlyServedTables) { problems++; console.log(`\n## table only in SERVED (line ${B[k].line}) — first row: ${(B[k].rows[0] || '').slice(0, 120)}`); }
console.log('\nsummary: ' + (problems ? `${problems} difference(s)` : 'table text identical'));
process.exit(problems ? 1 : 0);
