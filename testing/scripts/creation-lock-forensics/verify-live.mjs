// Read-back verification of ONE live repair, from rows exported AFTER the write (read-only).
//   node verify-live.mjs <after.json> <pre.json> <candidate-out.json> "<Name>"
// Checks the live row against (a) the candidate that was written, (b) the engine (ledger = total, lock, limit), (c) the pre-write
// copy (what the character owns, the awards, `ap`).
import { readFileSync } from 'node:fs';
import { compute, foldBuild as _foldBuild, economy, creationCeiling } from '../../../js/engine.js';
// foldBuild() ALIASES the event payloads it folds (MUT.patch assigns the payload's objects into the build, and later indexed steps then mutate them
// IN PLACE), so folding a log that holds a spellcasting patch AND later cantrip/slot steps silently rewrites the patch event. Always fold a COPY.
const foldBuild = l => _foldBuild(JSON.parse(JSON.stringify(l)));
const [afterP, preP, candP, name] = process.argv.slice(2);
const after = JSON.parse(readFileSync(afterP, 'utf8')).find(c => c.name === name || c.id === (JSON.parse(readFileSync(preP, 'utf8'))).id);
const pre = JSON.parse(readFileSync(preP, 'utf8'));
const cand = JSON.parse(readFileSync(candP, 'utf8')).find(c => c.name === name);
const OPTS = { drawbackCap: 12 };
const deq = (a, b) => a === b || (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)
  && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => deq(a[k], b[k])));
const norm = v => Array.isArray(v) ? (v.every(x => x === null || typeof x !== 'object') ? [...v].map(String).sort() : v.map(norm))
  : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).filter(k => !k.startsWith('_')).sort().map(k => [k, norm(v[k])])) : v;
const L = after.stats.LOG, P = pre.stats.LOG;
const r = compute(foldBuild(L), OPTS), eco = economy(L), ce = creationCeiling(L, { drawbackAp: r.drawbackAp || 0, spent: eco.spent });
const li = L.findIndex(e => e.type === 'creationLocked');
const atLock = compute(foldBuild(L.slice(0, li)), OPTS).total;
const awards = l => JSON.stringify(l.filter(e => e.type === 'award').map(e => [e.amount, e.note || '', !!e.noLock, !!e.disc]));
const checks = {
  'the live row equals the candidate that was written': deq(after.stats, cand.stats),
  'ledger spent = engine total': eco.spent === r.total,
  'exactly one lock and one limit': L.filter(e => e.type === 'creationLocked').length === 1 && L.filter(e => e.type === 'creationLockConfig').length === 1,
  'the lock is in force and the limit is stamped': ce.locked === true && ce.base === cand.plan.limit,
  'what the character owns is unchanged (folded build vs pre-write)': JSON.stringify(norm(foldBuild(L))) === JSON.stringify(norm(foldBuild(P))) || !!cand.newName,
  'awards unchanged': awards(L) === awards(P),
  'the ap column is unchanged': after.ap === pre.ap,
  'seq runs 1..n': L.every((e, i) => e.seq === i + 1) && after.stats.SEQ === L.length + 1,
};
for (const [k, v] of Object.entries(checks)) console.log((v ? 'PASS  ' : 'FAIL  ') + k);
const post = L.slice(li + 1).filter(e => e.type === 'buy' || e.type === 'buyoff');
console.log(`\n${after.name}: lock at index ${li}, ${atLock} AP at the lock; spent ${eco.spent} (engine ${r.total}); ceiling ${ce.ceiling}; in play ${post.length} purchases = ${post.reduce((s, e) => s + (e.cost || 0), 0)} AP, ${post.reduce((s, e) => s + (e.gp || 0), 0)} gp / ${post.reduce((s, e) => s + (e.days || 0), 0)} days; ap ${after.ap}`);
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
