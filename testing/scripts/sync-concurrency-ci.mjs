#!/usr/bin/env node
/**
 * sync-concurrency-ci.mjs — the gate for js/sync.js's optimistic-concurrency guard.
 *
 * WHY THIS EXISTS. `feat/sync-stale-save` shipped a guard so two devices editing one character can't
 * silently destroy each other's history (the whole event log lives in `stats`, so the later writer
 * replaces the earlier writer's ENTIRE past). Its PR said no automated gate could reach it, because the
 * dependency-free suite can't sign in to Supabase — so verification was a manual two-tab ritual.
 *
 * That ritual missed a real hole. On 2026-08-07 a character went 43 AP spent -> 47 -> back to 43 across
 * two separate browser profiles, with the guard active the whole time: `initSync()` runs `syncAll()` on
 * every page load and reconnect, `reconcile()` adopted the newer row and refreshed `base_updated_at` in
 * storage, and the still-open page then saved its stale in-memory build against that fresh base. The
 * guard matched. The newer version was overwritten.
 *
 * Supabase is not actually needed to test this. What matters is the ORDER of local reads and writes
 * around a conditional update, so this stubs the server and gives each simulated browser profile its own
 * localStorage, then replays the exact sequence above against the real js/sync.js.
 *
 * The first scenario is DIFFERENTIAL: it runs against a deliberately reverted copy of sync.js as well as
 * the live one, and fails if the bug does NOT reproduce on the reverted copy. A regression test that
 * passes on the broken version proves nothing, so this refuses to pass vacuously.
 *
 * Run:  node testing/scripts/sync-concurrency-ci.mjs        (expect 0 failed; exits non-zero otherwise)
 * Uses only Node built-ins — no npm, no browser, no network. See docs/HOW-TO-WORK.md.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = mkdtempSync(join(tmpdir(), 'pact-sync-'));
let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`); };

// --- the stubbed world: one shared server, one localStorage per simulated profile ----------------
writeFileSync(join(dir, 'world.js'), `
export const server = { rows: new Map(), clock: 0 };
export function seed(id, stats){ server.clock++; server.rows.set(id, { id, owner_id:'me', name:'X',
  kind:'chargen', stats, ap:0, campaign_id:null, updated_at:'T'+server.clock }); }
export function serverSpent(id){ const r = server.rows.get(id); return r ? r.stats.spent : null; }
export function makeLS(){ const m = new Map(); return {
  getItem:k=>m.has(k)?m.get(k):null, setItem:(k,v)=>m.set(k,String(v)), removeItem:k=>m.delete(k) }; }
export const supabase = { from(){
  const q = { _op:null, _payload:null, _eq:{} };
  q.update = p => { q._op='update'; q._payload=p; return q; };
  q.insert = p => { q._op='insert'; q._payload=p; return q; };
  q.select = () => { if(!q._op) q._op='select'; return q; };
  q.eq = (c,v) => { q._eq[c]=v; return q; };
  q.maybeSingle = async () => { const r = server.rows.get(q._eq.id); return { data: r?{...r}:null, error:null }; };
  q.then = (res,rej) => run().then(res,rej);
  async function run(){
    const id = q._eq.id;
    if (q._op === 'update') {
      const r = server.rows.get(id);
      if (!r) return { data: [], error:null };
      // THE GUARD: when a base was supplied it must still match the row's current updated_at.
      if (q._eq.updated_at != null && q._eq.updated_at !== r.updated_at) return { data: [], error:null };
      Object.assign(r, q._payload); server.clock++; r.updated_at = 'T'+server.clock;
      return { data:[{ id:r.id, updated_at:r.updated_at, ap:r.ap }], error:null };
    }
    if (q._op === 'insert') {
      server.clock++; const r = { ...q._payload, ap:0, campaign_id:null, updated_at:'T'+server.clock };
      server.rows.set(r.id, r); return { data:[{ id:r.id, updated_at:r.updated_at, ap:r.ap }], error:null };
    }
    const r = server.rows.get(id); return { data: r?[{...r}]:[], error:null };
  }
  return q; } };
`);
writeFileSync(join(dir, 'stub-auth.js'), `export async function currentUser(){ return { id:'me' }; }\n`);
writeFileSync(join(dir, 'stub-cs.js'),   `export const isCloudCharId = id => typeof id === 'string' && id.includes('-');\n`);

/** Turn a real sync.js source into a self-contained "page" module with stubbed deps and its own
 *  localStorage. Each distinct filename is a separate module instance = a separate open page. */
function makePage(src, name) {
  let s = src
    .replace("import { supabase } from './supabase-client.js';", "import { supabase, makeLS } from './world.js';")
    .replace("import { currentUser } from './auth.js';", "import { currentUser } from './stub-auth.js';")
    .replace("import { isCloudCharId } from './character-store.js';", "import { isCloudCharId } from './stub-cs.js';")
    // Module-scoped bindings shadow the globals inside this module only — one storage per page, and
    // navigator.onLine is undefined under Node, which would otherwise make every call bail out early.
    .replace('const LS_PREFIX',
             'const localStorage = globalThis.__LS_FOR__();\nconst navigator = { onLine: true };\nconst LS_PREFIX');
  writeFileSync(join(dir, name), s);
  return name;
}

const liveSrc = readFileSync(join(REPO, 'js/sync.js'), 'utf8');
// The reverted copy: put the base back to "whatever storage says now", which is the pre-fix behaviour.
const revertedSrc = liveSrc
  .replace(/let base;\n\s*if \(_pageBase\.has\(prevKey\)\) \{[\s\S]*?\n  \}\n/, 'const base = prev?.base_updated_at;\n');
if (revertedSrc === liveSrc) {
  console.log('  FAIL  could not build the reverted copy — the shape of saveCharacter() changed.');
  console.log('        Update the revert pattern in this script, or the differential check is vacuous.');
  rmSync(dir, { recursive:true, force:true });
  process.exit(1);
}

const world = await import(pathToFileURL(join(dir, 'world.js')).href);
async function openPage(file) {
  const ls = world.makeLS();
  globalThis.__LS_FOR__ = () => ls;
  return import(pathToFileURL(join(dir, file)).href);
}

/** The production sequence: two profiles, a legitimate save, a background sync, then a stale save. */
async function clobberScenario(fileA, fileB) {
  world.server.rows.clear(); world.server.clock = 0;
  const ID = 'aaaa-bbbb-cccc-dddd';
  world.seed(ID, { spent: 43 });
  const A = await openPage(fileA), B = await openPage(fileB);
  await A.loadCharacter(ID);                                                   // both open at 43
  await B.loadCharacter(ID);
  await B.saveCharacter({ id:ID, name:'X', kind:'chargen', stats:{ spent:47 } });   // B is up to date
  await A.syncAll();            // initSync() does this on every load/reconnect; adopts B's row into A
  const ra = await A.saveCharacter({ id:ID, name:'X', kind:'chargen', stats:{ spent:43 } });  // stale
  return { finalSpent: world.serverSpent(ID), conflict: !!ra.conflict, synced: ra.synced };
}

console.log('\nsync concurrency — stale-save guard\n');

console.log('  differential: the bug must still reproduce when the fix is reverted');
makePage(revertedSrc, 'rev-A.js'); makePage(revertedSrc, 'rev-B.js');
const before = await clobberScenario('rev-A.js', 'rev-B.js');
ok('reverted copy clobbers 47 back to 43 (bug reproduces)', before.finalSpent === 43 && !before.conflict);

console.log('\n  live js/sync.js');
makePage(liveSrc, 'live-A.js'); makePage(liveSrc, 'live-B.js');
const after = await clobberScenario('live-A.js', 'live-B.js');
ok('stale save from a page behind another profile is refused', after.conflict === true && after.synced === false);
ok('  and the newer version survives (spent stays 47)', after.finalSpent === 47);

// Regressions: a guard that refuses legitimate saves is worse than no guard at all.
console.log('\n  regressions — legitimate saves must keep working');
{ world.server.rows.clear(); world.server.clock=0; const ID='r1-aaaa-bbbb-cccc'; world.seed(ID,{spent:1});
  const A = await openPage(makePage(liveSrc,'r1.js')); await A.loadCharacter(ID);
  const a = await A.saveCharacter({id:ID,name:'X',kind:'chargen',stats:{spent:2}});
  const b = await A.saveCharacter({id:ID,name:'X',kind:'chargen',stats:{spent:3}});
  const c = await A.saveCharacter({id:ID,name:'X',kind:'chargen',stats:{spent:4}});
  ok('three consecutive saves in one page all succeed', a.synced && b.synced && c.synced);
  ok('  and the last one landed', world.serverSpent(ID) === 4); }
{ world.server.rows.clear(); world.server.clock=0; const ID='r2-aaaa-bbbb-cccc';
  const A = await openPage(makePage(liveSrc,'r2.js'));
  const r = await A.saveCharacter({id:ID,name:'New',kind:'chargen',stats:{spent:0}});
  ok('a brand-new character inserts rather than reading as a conflict', r.synced === true && !r.conflict); }
{ world.server.rows.clear(); world.server.clock=0; const ID='r3-aaaa-bbbb-cccc'; world.seed(ID,{spent:5});
  const A = await openPage(makePage(liveSrc,'r3.js'));
  const r = await A.saveCharacter({id:ID,name:'X',kind:'chargen',stats:{spent:6}});
  ok('a page that never loaded (CharGen autosave boot) still saves', r.synced === true); }
{ world.server.rows.clear(); world.server.clock=0; const ID='r4-aaaa-bbbb-cccc'; world.seed(ID,{spent:10});
  const A = await openPage(makePage(liveSrc,'r4a.js')), B = await openPage(makePage(liveSrc,'r4b.js'));
  await A.loadCharacter(ID); await B.loadCharacter(ID);
  await B.saveCharacter({id:ID,name:'X',kind:'chargen',stats:{spent:20}});
  const refused = await A.saveCharacter({id:ID,name:'X',kind:'chargen',stats:{spent:11}});
  ok('stale page is refused', refused.conflict === true && world.serverSpent(ID) === 20);
  await A.loadCharacter(ID);          // the user reloads, as the conflict dialog instructs
  const rr = await A.saveCharacter({id:ID,name:'X',kind:'chargen',stats:{spent:21}});
  ok('  and is not bricked — it saves again after re-loading', rr.synced === true && world.serverSpent(ID) === 21); }
{ world.server.rows.clear(); world.server.clock=0; const ID='r5-aaaa-bbbb-cccc'; world.seed(ID,{spent:7});
  const A = await openPage(makePage(liveSrc,'r5.js')); await A.loadCharacter(ID);
  await A.syncAll();
  const r = await A.saveCharacter({id:ID,name:'X',kind:'chargen',stats:{spent:8}});
  ok('an up-to-date page still saves after a background syncAll', r.synced === true && world.serverSpent(ID) === 8); }

rmSync(dir, { recursive: true, force: true });
console.log(`\n✓ ${pass} passed / ${fail} failed\n`);
process.exit(fail ? 1 : 0);
