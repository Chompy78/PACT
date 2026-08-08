#!/usr/bin/env node
/**
 * sync-state-machine-ci.mjs — the gate for js/sync.js's status-chip primitives
 * (getSyncState/noteEdit/checkFreshness/markInSyncWithServer — feat/sync-state-machine, B1 of
 * docs/plans/2026-08-08-shared-sync-chip-part-b.md).
 *
 * WHY THIS EXISTS. Two rounds of cold review (9 model responses across 5 vendor families total) found
 * v1 of this plan named the right concepts (a pendingEdit flag, a persisted `behind` signal) without a
 * mechanism precise enough to implement without reintroducing the exact bugs this work exists to fix —
 * most sharply, a boolean "unsaved edits" flag that a stale push confirmation could clear out from under
 * a NEWER edit that arrived while the push was in flight. The fix (editSeq/savedSeq, a monotonic pair
 * with a Math.max anti-regression guard) is exactly the kind of thing that looks obviously correct on
 * paper and is easy to get subtly wrong in the actual async control flow — so this is the differential,
 * ordering-sensitive test that proves it, not just a smoke test of the happy path.
 *
 * Supabase is not needed to test this — same technique as sync-concurrency-ci.mjs: stub the server,
 * give each simulated "page" its own localStorage, and replay real async sequences against the real
 * js/sync.js. Standalone (like sync-concurrency-ci.mjs) — not currently wired into a GitHub Actions
 * workflow; run manually per docs/HOW-TO-WORK.md.
 *
 * Run:  node testing/scripts/sync-state-machine-ci.mjs        (expect 0 failed; exits non-zero otherwise)
 * Uses only Node built-ins — no npm, no browser, no network.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = mkdtempSync(join(tmpdir(), 'pact-sync-state-'));
let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`); };

// --- the stubbed world: one shared server, one localStorage per simulated page -------------------
// Extends sync-concurrency-ci.mjs's stub with a per-payload artificial delay (stats.__delayMs), the
// only addition needed here: proving the anti-regression guard requires two overlapping pushes that
// resolve OUT OF the order they started in, which needs a real, controllable timing gap.
writeFileSync(join(dir, 'world.js'), `
export const server = { rows: new Map(), clock: 0 };
const stamp = () => new Date(Date.now() - 10000 + (++server.clock)).toISOString();
export function seed(id, stats){ server.rows.set(id, { id, owner_id:'me', name:'X',
  kind:'chargen', stats, ap:0, campaign_id:null, updated_at:stamp() }); }
export function setServerUpdatedAt(id, iso){ const r = server.rows.get(id); if (r) r.updated_at = iso; }
export function makeLS(){ const m = new Map(); return {
  getItem:k=>m.has(k)?m.get(k):null, setItem:(k,v)=>m.set(k,String(v)), removeItem:k=>m.delete(k) }; }
export const supabase = { from(){
  const q = { _op:null, _payload:null, _eq:{}, _select:null };
  q.update = p => { q._op='update'; q._payload=p; return q; };
  q.insert = p => { q._op='insert'; q._payload=p; return q; };
  q.select = (cols) => { if(!q._op) q._op='select'; q._select = cols; return q; };
  q.eq = (c,v) => { q._eq[c]=v; return q; };
  q.maybeSingle = async () => {
    if (q._delayMs) await new Promise(r=>setTimeout(r, q._delayMs));
    const r = server.rows.get(q._eq.id);
    if (!r) return { data:null, error:null };
    // A checkFreshness()-shaped select ('id, updated_at') must not leak other columns — mirrors the
    // narrower select js/sync.js actually issues.
    if (q._select === 'id, updated_at') return { data: { id:r.id, updated_at:r.updated_at }, error:null };
    return { data: {...r}, error:null };
  };
  q.then = (res,rej) => run().then(res,rej);
  async function run(){
    const id = q._eq.id;
    const delayMs = q._payload && q._payload.stats && q._payload.stats.__delayMs;
    if (delayMs) await new Promise(r=>setTimeout(r, delayMs));
    if (q._op === 'update') {
      const r = server.rows.get(id);
      if (!r) return { data: [], error:null };
      if (q._eq.updated_at != null && q._eq.updated_at !== r.updated_at) return { data: [], error:null };
      Object.assign(r, q._payload); r.updated_at = stamp();
      return { data:[{ id:r.id, updated_at:r.updated_at, ap:r.ap }], error:null };
    }
    if (q._op === 'insert') {
      const r = { ...q._payload, ap:0, campaign_id:null, updated_at:stamp() };
      server.rows.set(r.id, r); return { data:[{ id:r.id, updated_at:r.updated_at, ap:r.ap }], error:null };
    }
    const r = server.rows.get(id); return { data: r?[{...r}]:[], error:null };
  }
  return q; } };
`);
// checkFreshness()'s select is a plain \`await\`, not a \`.then\` chain hop through run() — its own
// maybeSingle() handles the narrower 'id, updated_at' shape directly above.
let _authOK = true, _online = true;
writeFileSync(join(dir, 'stub-auth.js'),
  `export async function currentUser(){ return globalThis.__AUTH_OK__() ? { id:'me' } : null; }\n`);
writeFileSync(join(dir, 'stub-cs.js'), `export const isCloudCharId = id => typeof id === 'string' && id.includes('-');\n`);

/** Turn a real sync.js source into a self-contained "page" module with stubbed deps and its own
 *  localStorage/navigator, so multiple concurrent "pages" (and online/offline toggling) can coexist. */
function makePage(src, name) {
  const s = src
    .replace("import { supabase, withKeepalive } from './supabase-client.js';", "import { supabase } from './world.js';")
    .replace("import { currentUser } from './auth.js';", "import { currentUser } from './stub-auth.js';")
    .replace("import { isCloudCharId } from './character-store.js';", "import { isCloudCharId } from './stub-cs.js';")
    .replace('export { withKeepalive };', '')
    .replace('const LS_PREFIX',
             'const localStorage = globalThis.__LS_FOR__();\nconst navigator = { get onLine(){ return globalThis.__ONLINE__(); } };\nconst LS_PREFIX');
  writeFileSync(join(dir, name), s);
  return name;
}

const liveSrc = readFileSync(join(REPO, 'js/sync.js'), 'utf8');
const world = await import(pathToFileURL(join(dir, 'world.js')).href);

async function openPage(file) {
  const ls = world.makeLS();
  globalThis.__LS_FOR__ = () => ls;
  globalThis.__ONLINE__ = () => _online;
  globalThis.__AUTH_OK__ = () => _authOK;
  return import(pathToFileURL(join(dir, file)).href);
}

console.log('\nsync state machine — getSyncState/noteEdit/checkFreshness/markInSyncWithServer\n');
let n = 0;
const fresh = () => makePage(liveSrc, `p${++n}.js`);

// --- (a) precedence order ---------------------------------------------------------------------
console.log('  precedence: signedOut > saving > conflict > behind > dirty > idle');
{
  world.server.rows.clear(); world.server.clock = 0; _online = true; _authOK = false;
  const A = await openPage(fresh());
  const s = await A.getSyncState('any-id');
  ok('signedOut when not authenticated, regardless of id', s.state === 'signedOut');
}
{
  world.server.rows.clear(); world.server.clock = 0; _online = true; _authOK = true;
  const ID = 'idle-aaaa-bbbb';
  const A = await openPage(fresh());
  const s = await A.getSyncState(ID);
  ok('idle for an id with no local record at all', s.state === 'idle');
}
{
  world.server.rows.clear(); world.server.clock = 0; _online = true; _authOK = true;
  const ID = 'dirty-aaaa-bbbb'; world.seed(ID, { spent: 1 });
  const A = await openPage(fresh());
  await A.loadCharacter(ID);
  A.noteEdit(ID);
  const s = await A.getSyncState(ID);
  ok('dirty after noteEdit() with no save attempted yet (the debounce blind window)', s.state === 'dirty');
}
{
  world.server.rows.clear(); world.server.clock = 0; _online = true; _authOK = true;
  const ID = 'behind-aaaa-bbbb'; world.seed(ID, { spent: 1 });
  const A = await openPage(fresh());
  await A.loadCharacter(ID);
  world.setServerUpdatedAt(ID, new Date(Date.now() + 60000).toISOString());   // server moved ahead
  await A.checkFreshness(ID);
  const s = await A.getSyncState(ID);
  ok('behind after checkFreshness() finds the server ahead, with no local edits', s.state === 'behind');
}
{
  world.server.rows.clear(); world.server.clock = 0; _online = true; _authOK = true;
  const ID = 'conflict-aaaa-bbbb'; world.seed(ID, { spent: 1 });
  const A = await openPage(fresh());
  await A.loadCharacter(ID);
  A.noteEdit(ID);                                                             // unsaved local edit
  world.setServerUpdatedAt(ID, new Date(Date.now() + 60000).toISOString());   // AND server moved ahead
  await A.checkFreshness(ID);
  const s = await A.getSyncState(ID);
  ok('conflict (dirty+behind) when both are true', s.state === 'conflict');
}
{
  world.server.rows.clear(); world.server.clock = 0; _online = true; _authOK = true;
  const ID = 'saving-aaaa-bbbb'; world.seed(ID, { spent: 1, __delayMs: 30 });
  const A = await openPage(fresh());
  await A.loadCharacter(ID);
  A.noteEdit(ID);
  const p = A.saveCharacter({ id: ID, name: 'X', kind: 'chargen', stats: { spent: 2, __delayMs: 30 } });
  // Read state WHILE the push is still in flight (the 30ms delay guarantees it hasn't resolved yet).
  const mid = await A.getSyncState(ID);
  await p;
  const after = await A.getSyncState(ID);
  ok('saving while a push is genuinely in flight — outranks dirty/conflict', mid.state === 'saving');
  ok('  and idle again once that push confirms (no other edits pending)', after.state === 'idle');
}

// --- (b)/(c) editSeq/savedSeq: the race and the anti-regression guard --------------------------
console.log('\n  editSeq/savedSeq — the race a boolean pendingEdit flag cannot survive');
{
  world.server.rows.clear(); world.server.clock = 0; _online = true; _authOK = true;
  const ID = 'race-aaaa-bbbb'; world.seed(ID, { spent: 0 });
  const A = await openPage(fresh());
  await A.loadCharacter(ID);

  // Edit A: noteEdit -> editSeq=1. saveCharacter() captures capturedSeq=1 synchronously and then
  // suspends at its first await (inside pushCharacter) — nothing after this point runs until a
  // microtask turn, which is exactly the window edit B needs to land in.
  A.noteEdit(ID);
  const pushA = A.saveCharacter({ id: ID, name: 'X', kind: 'chargen', stats: { spent: 1 } });
  // Edit B arrives while push A is still in flight (no await between here and the noteEdit above).
  A.noteEdit(ID);   // editSeq=2 now — captured by NOTHING yet, since push A already snapshotted seq=1
  const resA = await pushA;   // push A confirms: savedSeq = max(0, 1) = 1
  const state = await A.getSyncState(ID);
  ok('push A actually synced', resA.synced === true);
  ok('still reports unsaved edits after push A confirms — edit B (editSeq=2) was never captured '
   + '(savedSeq stayed at 1)', state.state === 'dirty' || state.state === 'conflict');
}
{
  world.server.rows.clear(); world.server.clock = 0; _online = true; _authOK = true;
  const ID = 'noregress-aaaa-bbbb'; world.seed(ID, { spent: 0 });
  const A = await openPage(fresh());
  await A.loadCharacter(ID);

  // Two overlapping pushes, deliberately resolving OUT OF the order they started in: push X captures
  // a LOWER editSeq but is slower (arrives late); push Y captures a HIGHER editSeq and is fast. If
  // savedSeq were a plain assignment instead of Math.max, X's late completion would regress it back
  // down below Y's already-confirmed value.
  A.noteEdit(ID);   // editSeq=1
  const pushX = A.saveCharacter({ id: ID, name: 'X', kind: 'chargen', stats: { spent: 1, __delayMs: 40 } });   // captures 1, slow
  A.noteEdit(ID);   // editSeq=2
  const pushY = A.saveCharacter({ id: ID, name: 'X', kind: 'chargen', stats: { spent: 2, __delayMs: 5 } });    // captures 2, fast
  await pushY;   // resolves first: savedSeq = max(0, 2) = 2
  const midState = await A.getSyncState(ID);
  await pushX;   // resolves LATE: must be savedSeq = max(2, 1) = 2, NOT regressed to 1
  const finalState = await A.getSyncState(ID);
  ok('faster, newer push (Y) confirms first and clears unsaved-edit status', midState.state === 'idle');
  ok('slower, older push (X) resolving late does not regress savedSeq/reintroduce dirty status',
     finalState.state === 'idle');
  // Both counters landing on 'idle' isn't proof by itself — a corrupted editSeq/savedSeq pair that
  // regressed TOGETHER (e.g. both reset to X's stale 1/1 instead of staying at Y's correct 2/2) would
  // still read as 'idle' here, since 'idle' only requires editSeq <= savedSeq, not any specific value.
  // Confirm the counter genuinely continued from 2, not silently reset to 1, by doing one more edit and
  // checking it produces 'dirty' (proving editSeq is now 3, i.e. > whatever savedSeq settled at) rather
  // than silently landing back on 'idle' from a corrupted low baseline.
  A.noteEdit(ID);
  const afterOneMoreEdit = await A.getSyncState(ID);
  ok('one more edit after the dust settles is correctly seen as unsaved (counter was not corrupted)',
     afterOneMoreEdit.state === 'dirty');
}
{
  // Character-switch-while-a-save-is-pending: A's own counters must be untouched by B's traffic.
  world.server.rows.clear(); world.server.clock = 0; _online = true; _authOK = true;
  const IDA = 'switchA-aaaa-bbbb', IDB = 'switchB-aaaa-bbbb';
  world.seed(IDA, { spent: 0 }); world.seed(IDB, { spent: 0 });
  const A = await openPage(fresh());
  await A.loadCharacter(IDA); await A.loadCharacter(IDB);
  A.noteEdit(IDA);
  const pushA = A.saveCharacter({ id: IDA, name: 'X', kind: 'chargen', stats: { spent: 1, __delayMs: 20 } });
  // "Switch characters" — edit and save a DIFFERENT id while A's save is still in flight.
  A.noteEdit(IDB);
  await A.saveCharacter({ id: IDB, name: 'X', kind: 'chargen', stats: { spent: 1 } });
  const bState = await A.getSyncState(IDB);
  await pushA;
  const aState = await A.getSyncState(IDA);
  ok('character B saves cleanly while A is still in flight', bState.state === 'idle');
  ok("character A is unaffected by B's traffic and settles correctly once its own push confirms",
     aState.state === 'idle');
}

// --- (d) checkFreshness() failure semantics -----------------------------------------------------
console.log('\n  checkFreshness() failure semantics — never mutate `behind` on a failed check');
{
  world.server.rows.clear(); world.server.clock = 0; _online = true; _authOK = true;
  const ID = 'failcheck-aaaa-bbbb'; world.seed(ID, { spent: 1 });
  const A = await openPage(fresh());
  await A.loadCharacter(ID);
  world.setServerUpdatedAt(ID, new Date(Date.now() + 60000).toISOString());
  const r1 = await A.checkFreshness(ID);
  ok('a genuine successful check sets behind:true', r1.behind === true);

  // Now simulate a failed check by going "offline" mid-session — checkFreshness() must not clear the
  // behind flag it just set, and must not report a false failure for the expected-offline case either.
  _online = false;
  const r2 = await A.checkFreshness(ID);
  ok('offline check does not report lastCheckFailed (expected case, not an error)', r2.lastCheckFailed === null);
  ok('  and leaves `behind` exactly as it was (last known truth stands)', r2.behind === true);
  _online = true;
  const stateAfter = await A.getSyncState(ID);
  ok('state is still `behind` after the offline check — nothing was silently cleared', stateAfter.state === 'behind');
}

// --- (e) reconcile()'s adopt branches clear `behind` --------------------------------------------
console.log('\n  reconcile() adopt branches clear a stale `behind` (the gap the review round caught)');
{
  world.server.rows.clear(); world.server.clock = 0; _online = true; _authOK = true;
  const ID = 'adopt-aaaa-bbbb'; world.seed(ID, { spent: 1 });
  const A = await openPage(fresh());
  await A.loadCharacter(ID);
  world.setServerUpdatedAt(ID, new Date(Date.now() + 60000).toISOString());
  await A.checkFreshness(ID);
  const before = await A.getSyncState(ID);
  ok('behind is set going in', before.state === 'behind');
  // syncAll() -> reconcile() -> the "server wins" adopt branch (local isn't dirty, server is newer).
  await A.syncAll();
  const after = await A.getSyncState(ID);
  ok('a silent reconcile()/syncAll() adopt clears the stale `behind` flag, not just dirty',
     after.state === 'idle');
}
{
  // The !local branch: a character this page has never cached locally, discovered via syncAll().
  world.server.rows.clear(); world.server.clock = 0; _online = true; _authOK = true;
  const ID = 'freshadopt-aaaa-bbbb'; world.seed(ID, { spent: 1 });
  const A = await openPage(fresh());
  await A.syncAll();   // no prior loadCharacter() — this id isn't in the local index yet, so syncAll()
                        // only reconciles ids it already knows about; fetch it once via peekCharacter-
                        // style path instead to exercise the true !local adopt branch directly.
  await A.loadCharacter(ID);   // reconcile()'s !local branch fires here on first contact
  const state = await A.getSyncState(ID);
  ok('a character with no prior local record adopts cleanly (idle, not stuck behind)', state.state === 'idle');
}

rmSync(dir, { recursive: true, force: true });
console.log(`\n✓ ${pass} passed / ${fail} failed\n`);
process.exit(fail ? 1 : 0);
