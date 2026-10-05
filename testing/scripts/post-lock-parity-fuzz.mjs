#!/usr/bin/env node
/**
 * post-lock-parity-fuzz.mjs — do CharGen and the Live Sheet treat the SAME purchase, made AFTER the creation lock, the same way?
 *
 * WHY. After "Finish creating" a character improves by buying things. The Live Sheet is the reference (it only ever appends in-play purchases, priced by the engine, checked
 * by the engine's purchaseLegality, gold/downtime stamped); CharGen was taught to do the same slot by slot (phases 1, 2a, 2b, S1, Q2). Each phase has a head-to-head test for a handful
 * of purchases. This is the exhaustive version: thousands of seeded random starting characters x random single purchases, performed through the REAL UI of both tools, compared.
 *
 * HOW. For each trial: take a build fixture (testing/fixtures/builds), add AP headroom, load it into CharGen, optionally switch the coin-and-calendar economy on with a declared wallet,
 * finish creation, and hand the very same locked character (the envelope) to the Live Sheet. Then for K random purchase INTENTS (a category + a payload, generated from the folded build:
 * a Hit Die, an ability point, a language, an armour tier, a weapon proficiency, a skill/boon/tool/art/feature, a free subclass, a spell rank/cantrip/slot/known/new discipline...):
 *   - Live Sheet: find the matching buy TILE in its real buy panel and click it if it is enabled (a blocked tile only flashes a reason; a missing tile means "not offered");
 *   - CharGen: perform the equivalent through its real control (a select, a checkbox, a feature row, the spell form);
 *   - compare: accepted or refused by each, the events each appended (category, payload, price, frozen gold and downtime), and the total and spent afterwards.
 * A trial stops comparing after its first mismatch (later steps would only repeat it). Every mismatch is logged with the seed so it replays.
 *
 * KNOWN, DELIBERATE DIFFERENCES (classified, not counted as defects): CharGen refuses new drawbacks and "Magically Bound" after the lock (owner P1); CharGen has no control for a few
 * Live-Sheet-only purchases (reported as "no CharGen control", to be understood, not assumed).
 *
 * Usage: node testing/scripts/post-lock-parity-fuzz.mjs [--trials N] [--ops K] [--seed S] [--port P] [--out report.json] [--only cat1,cat2]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './lib/launch-chromium.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };
const ROOT = arg('root', ''), FRESH = process.argv.includes('--fresh-page');   // --root: serve another checkout (e.g. a worktree of main) while still reading fixtures from here; --fresh-page: reload both tools for every trial
const REPLAY = arg('replay', ''), RINDEX = +arg('index', 0);
const TRIALS = +arg('trials', 40), OPS = +arg('ops', 4), SEED = +arg('seed', 1), PORT = +arg('port', 7983), OUT = arg('out', ''), ONLY = arg('only', '') ? arg('only', '').split(',') : null;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/PACT\/?/, '') || 'index.html';
  fs.readFile(path.join(ROOT || REPO, rel), (e, d) => { if (e) { r.writeHead(404); return r.end('not found'); }
    r.writeHead(200, { 'Content-Type': MIME[path.extname(rel)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); r.end(d); });
});
await new Promise(r => server.listen(PORT, r));
const base = `http://localhost:${PORT}/PACT`;

// ---- seeded PRNG ----
let st = (SEED * 2654435761) >>> 0;
const rnd = () => { st = (Math.imul(st, 1664525) + 1013904223) >>> 0; return st / 4294967296; };
const ri = n => Math.floor(rnd() * n);
const pick = a => a[ri(a.length)];

// ---- fixtures ----
const fdir = path.join(REPO, 'testing/fixtures/builds');
const FIX = fs.readdirSync(fdir).filter(f => f.endsWith('.json')).map(f => { const raw = JSON.parse(fs.readFileSync(path.join(fdir, f), 'utf8')); return { f, b: raw.build || raw }; });

const browser = await launchChromium();
const ctx = await browser.newContext();
const cg = await ctx.newPage(), ls = await ctx.newPage();
let cgDialogs = [], lsDialogs = [];
cg.on('dialog', d => { cgDialogs.push(d.type() + ': ' + d.message().slice(0, 100)); d.accept(); });
ls.on('dialog', d => { lsDialogs.push(d.type() + ': ' + d.message().slice(0, 100)); d.accept(); });
const errs = []; cg.on('pageerror', e => errs.push('cg: ' + String(e.stack || e).split('\n').slice(0, 6).map(x => x.trim().slice(0, 110)).join(' | '))); ls.on('pageerror', e => errs.push('ls: ' + String(e.stack || e).split('\n').slice(0, 6).map(x => x.trim().slice(0, 110)).join(' | ')));
await cg.goto(`${base}/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' }); await cg.waitForTimeout(2500);
await ls.goto(`${base}/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' }); await ls.waitForTimeout(2500);
// the Live Sheet renders only a few tile groups until others are opened: make every group count as open
await ls.evaluate(() => { Object.setPrototypeOf(grpOpen, new Proxy({}, { get: () => 1 })); });

// ---- helpers that run INSIDE the pages ----
const CG_SNAP = () => { const L = LOG; const li = L.findIndex(e => e.type === 'creationLocked'); const b = foldBuild(LOG);
  return { n: L.length, post: L.slice(li + 1).filter(e => e.type === 'buy').map(e => ({ cat: e.cat, payload: e.payload, cost: e.cost, gp: e.gp, days: e.days })), total: compute(b, _cgDmOpts()).total, spent: economy(LOG).spent }; };
const LS_SNAP = () => { const L = LOG; const li = L.findIndex(e => e.type === 'creationLocked'); const b = foldBuild(null);
  return { n: L.length, post: L.slice(li + 1).filter(e => e.type === 'buy').map(e => ({ cat: e.cat, payload: e.payload, cost: e.cost, gp: e.gp, days: e.days })), total: compute(b, _dmOpts()).total, spent: economy(null).spent }; };

const report = { trials: 0, ops: 0, mismatches: [], byCat: {}, expected: {}, noControl: {}, errors: [] };
const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };

async function intentsFor(seedNum) {   // candidate single-step purchases, from the folded build (run in the Live Sheet page: same engine); seeded so a failure replays
  return ls.evaluate((seedNum) => {
    let sd = seedNum >>> 0; const prng = () => { sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0; return sd / 4294967296; };
    const b = foldBuild(null), I = [];
    const add = (cat, payload) => I.push({ cat, payload });
    add('hd', { to: (b.hd || 1) + 1 }); if ((b.profBonus || 2) < 6) add('prof', { to: (b.profBonus || 2) + 1 });
    ABILS.forEach(a => { const s = (b.stats && b.stats[a]) || 10; if (s < 20) add('abil', { ab: a, to: Math.min(20, s + 2) }); });
    add('language', { to: (b.languages || 1) + 1 }); add('vigor', { to: (b.hardy || 0) + 1 }); add('grit', { to: (b.tough || 0) + 1 });
    add('ki', { to: (b.ki || 0) + 1 }); add('sorcery', { to: (b.sorcery || 0) + 1 }); add('attune', { to: (b.attune || 0) + 1 });
    ['light', 'medium', 'heavy', 'shield'].forEach(v => { if (!(b.armour && b.armour[v])) add('armour', { v }); });
    const wp = b.weaponProf || {};
    if (!wp.simple) add('wprof', { wp: { ...wp, simple: true } }); if (!wp.allMartial) add('wprof', { wp: { ...wp, simple: true, allMartial: true } }); if (!wp.improvised) add('wprof', { wp: { ...wp, improvised: true } });
    const shuffle = a => a.map(x => [prng(), x]).sort((p, q) => p[0] - q[0]).map(x => x[1]);
    const take = (cat, list, n) => shuffle(list).slice(0, n).forEach(v => add(cat, { v }));
    take('skill', (DATA.skillList || []).map(x => Array.isArray(x) ? x[0] : x).filter(x => !(b.skills || []).includes(x)), 2);
    take('save', ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].filter(x => !(b.saves || []).includes(x)), 1);
    take('tool', (DATA.toolList || []).filter(x => !(b.tools || []).includes(x)), 1); take('instrument', (DATA.instrumentList || []).filter(x => !(b.instruments || []).includes(x)), 1);
    take('mastery', (DATA.masteries || []).filter(x => !(b.masteries || []).includes(x)), 1);
    take('boon', (DATA.boonList || []).filter(x => !(b.boons || []).includes(x)), 3); take('art', Object.keys(DATA.arts || {}).filter(x => !(b.arts || []).includes(x)), 2);
    take('feature', Object.keys(DATA.features || {}).filter(x => !(b.features || []).includes(x)), 2);
    take('expertise', (b.skills || []).filter(x => !(b.expertise || []).includes(x)), 1);
    take('drawback', (DATA.drawbackList || []).filter(x => !(b.drawbacks || []).includes(x)), 1);
    take('racial', (DATA.racialList || []).filter(x => DATA.racial[x] && !DATA.racial[x].pack && [b.species, b.species2].includes(DATA.racial[x].race) && !(b.racialTraits || []).includes(x)), 1);
    take('toolexpertise', [].concat(b.tools || [], b.instruments || []).filter(x => !(b.toolExpertise || []).includes(x)), 1);
    take('subabil', Object.keys(DATA.subAbilMap || {}).filter(k => !(b.subAbilities || []).includes(k)), 2);
    take('wornArmour', Object.keys(DATA.armours || {}).filter(x => x !== b.wornArmour), 1);
    take('unlockclass', (DATA.classes || []).filter(x => x !== b.originClass && !(b.unlockedClasses || []).includes(x)), 1);
    (Object.keys(DATA.subList || {})).filter(c => !(b.freeSub || {})[c]).slice(0, 12).forEach(c => { const sub = (DATA.subList[c] || [])[0]; if (sub) add('freesub', { cls: c, sub }); });
    const T = b.traditions || [];
    if (!T.length) { ['Arcane', 'Divine', 'Primal'].forEach(t => (DATA.disc[t] || []).slice(0, 2).forEach(d => add('found', { ti: 0, trad: t, disc: d }))); }
    T.forEach((t, ti) => { if (!t || !t.name) return;
      if (t.rank < 9) add('rank', { ti, to: t.rank + 1 });
      (t.disciplines || []).forEach((d, di) => { if (!d || !d.name) return; add('cantrip', { ti, di, to: (d.cantrips || 0) + 1 });
        for (let L = 1; L <= 9; L++) { add('slot', { ti, di, L, to: ((d.slots || [])[L - 1] || 0) + 1 }); add('known', { ti, di, L, to: ((d.known || [])[L - 1] || 0) + 1 }); } });
      (DATA.disc[t.name] || []).filter(nm => !(t.disciplines || []).some(d => d && d.name === nm)).slice(0, 1).forEach(nm => add('found', { ti, trad: t.name, disc: nm }));
    });
    return I;
  }, seedNum);
}

async function lsDo(intent) {   // click the matching enabled tile in the real buy panel
  const before = await ls.evaluate(LS_SNAP); lsDialogs = [];
  if (intent.cat === 'wornArmour') {   // the Live Sheet picks what you wear from a <select>, which calls setWornArmour()
    const ok = await ls.evaluate(v => { const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === v)); if (!sel) return 'absent'; const o = [...sel.options].find(o => o.value === v); if (o.disabled) return 'blocked'; setWornArmour(v); return 'clicked'; }, intent.payload.v);
    await ls.waitForTimeout(100); const after = await ls.evaluate(LS_SNAP);
    return { found: { state: ok }, before, after, accepted: after.post.length > before.post.length, dialogs: lsDialogs.slice() };
  }
  // cross-class features are only listed once their class is picked in the "Cross-class features" selector (buyCls)
  if (intent.cat === 'feature') await ls.evaluate(v => { try { const c = DATA.features[v] && DATA.features[v].cls; if (c && typeof buyCls !== 'undefined') { buyCls = c; refreshBuy(); } } catch (e) {} }, intent.payload.v);
  const found = await ls.evaluate(({ cat, payload }) => {
    const tiles = [...document.querySelectorAll('button.ib')].map(b => ({ b, on: b.getAttribute('onclick') || '', dis: b.classList.contains('dis'), title: b.getAttribute('title') || '' }));
    const re = /^buy\("([^"]+)",(.*),"((?:[^"\\]|\\.)*)"\)$/s;
    const want = JSON.stringify(payload);
    for (const t of tiles) { const m = t.on.match(re); if (m && m[1] === cat) { let p; try { p = JSON.parse(m[2]); } catch (e) { continue; } if (JSON.stringify(p) === want) { if (t.dis) return { state: 'blocked', reason: t.title.slice(0, 80) }; t.b.click(); return { state: 'clicked' }; } } }
    // a BLOCKED tile's click handler is flash(reason), which carries no payload: find it by the item's name instead and report the reason it gives
    const nm = String((payload && payload.v) || '').split(': ').pop();
    if (nm) for (const t of tiles) { if (t.on.startsWith('flash(') && (t.b.textContent || '').includes(nm)) return { state: 'blocked', reason: t.on.slice(7, 90) }; }
    return { state: 'absent' };
  }, intent);
  await ls.waitForTimeout(120);
  const after = await ls.evaluate(LS_SNAP);
  return { found, before, after, accepted: after.post.length > before.post.length, dialogs: lsDialogs.slice() };
}

async function cgDo(intent) {   // the equivalent through CharGen's real controls
  const before = await cg.evaluate(CG_SNAP); cgDialogs = [];
  const how = await cg.evaluate(({ cat, payload }) => {
    const fire = el => el.dispatchEvent(new Event('change', { bubbles: true }));
    const sel = (id, v) => { const el = document.getElementById(id); if (!el) return false; el.value = String(v); fire(el); return true; };
    const chk = (id, on) => { const el = document.getElementById(id); if (!el) return false; el.checked = on; fire(el); return true; };
    const box = (cls, v, on) => { const el = [...document.querySelectorAll('.' + cls)].find(e => e.value === v); if (!el) return false; el.checked = on; fire(el); return true; };
    switch (cat) {
      case 'hd': return sel('hd', payload.to) ? 'ok' : 'no control';
      case 'prof': return sel('profBonus', payload.to) ? 'ok' : 'no control';
      case 'abil': return sel('st_' + payload.ab, payload.to) ? 'ok' : 'no control';
      case 'language': return sel('languages', payload.to) ? 'ok' : 'no control';
      case 'vigor': return sel('hardy', payload.to) ? 'ok' : 'no control';
      case 'grit': return sel('tough', payload.to) ? 'ok' : 'no control';
      case 'ki': return sel('ki', payload.to) ? 'ok' : 'no control';
      case 'sorcery': return sel('sorcery', payload.to) ? 'ok' : 'no control';
      case 'attune': return sel('attune', payload.to) ? 'ok' : 'no control';
      case 'armour': return chk({ light: 'a_light', medium: 'a_med', heavy: 'a_heavy', shield: 'a_shield' }[payload.v], true) ? 'ok' : 'no control';
      case 'wprof': { const w = payload.wp, cur = foldBuild(LOG).weaponProf || {}; let ok = true;
        // a user ticks ONE box: "All martial" (the form ticks Simple with it in the same change) or "Simple" or "Improvised"
        if (w.allMartial && !cur.allMartial) ok = chk('wp_all', true) && ok; else if (w.simple && !cur.simple) ok = chk('wp_simple', true) && ok; if (w.improvised && !cur.improvised) ok = chk('wp_improv', true) && ok; return ok ? 'ok' : 'no control'; }
      case 'freesub': { const el = [...document.querySelectorAll('.freesub')].find(e => e.dataset.cls === payload.cls); if (!el) return 'no control'; el.value = payload.sub; fire(el); return 'ok'; }
      case 'skill': return box('skillck', payload.v, true) ? 'ok' : 'no control';
      case 'save': return box('saveck', payload.v, true) ? 'ok' : 'no control';
      case 'tool': return box('toolck', payload.v, true) ? 'ok' : 'no control';
      case 'instrument': return box('instck', payload.v, true) ? 'ok' : 'no control';
      case 'mastery': return box('mastck', payload.v, true) ? 'ok' : 'no control';
      case 'boon': return box('boonck', payload.v, true) ? 'ok' : 'no control';
      case 'art': return box('artck', payload.v, true) ? 'ok' : 'no control';
      case 'expertise': return box('expck', payload.v, true) ? 'ok' : 'no control';
      case 'drawback': return box('drawck', payload.v, true) ? 'ok' : 'no control';
      case 'racial': return box('racck', payload.v, true) ? 'ok' : 'no control';
      case 'toolexpertise': return box('toolexpck', payload.v, true) ? 'ok' : 'no control';
      case 'wornArmour': return sel('wornArmour', payload.v) ? 'ok' : 'no control';
      case 'subabil': { try { addRow('subabil', payload.v); const rows = [...document.querySelectorAll('.subabilrow')]; const row = rows[rows.length - 1]; if (row) fire(row); return 'ok'; } catch (e) { return 'no control: ' + String(e.message).slice(0, 60); } }
      case 'unlockclass': { const el = [...document.querySelectorAll('.classunlock')].find(e => e.dataset.cls === payload.v); if (!el) return 'no control'; el.checked = true; fire(el); return 'ok'; }
      case 'feature': { try { addRow('feat2', payload.v); const rows = [...document.querySelectorAll('.feat2row')]; const row = rows[rows.length - 1]; if (!row) return 'ok-gone'; fire(row); return 'ok'; } catch (e) { return 'no control: ' + String(e.message).slice(0, 60); } }
      case 'found': case 'rank': case 'cantrip': case 'slot': case 'known': { const b = foldBuild(LOG); const c = JSON.parse(JSON.stringify(b)); MUT[cat](c, payload); replacePatchSlot(PATCH_SLOTS.TRADITIONS, { traditions: c.traditions }); return 'ok'; }
      default: return 'no control';
    }
  }, intent);
  await cg.waitForTimeout(150);
  const after = await cg.evaluate(CG_SNAP);
  return { how, before, after, accepted: after.post.length > before.post.length, dialogs: cgDialogs.slice() };
}

const cgOKpre = C => C.after.post.length > C.before.post.length, lsOKpre = L => L.after.post.length > L.before.post.length;
const sig = evs => JSON.stringify(evs.map(e => [e.cat, e.payload, e.cost, e.gp ?? null, e.days ?? null]).sort());
const EXPECTED = new Set(['drawback']);   // CharGen refuses new drawbacks after the lock (owner P1); the Live Sheet offers them

const FOLD_KEYS = b => JSON.stringify(Object.fromEntries(Object.keys(b).sort().map(k => [k, b[k]])));
async function setup(fx, b, econ, wallet) {
  if (FRESH) {
    await cg.goto(`${base}/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' }); await cg.waitForTimeout(1500);
    await ls.goto(`${base}/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' }); await ls.waitForTimeout(1500);
    await ls.evaluate(() => { Object.setPrototypeOf(grpOpen, new Proxy({}, { get: () => 1 })); });
  }
  await cg.evaluate(async ({ b, econ, wallet }) => {
    try { localStorage.clear(); } catch (e) {}
    applyBuild(b);
    if (econ) { LOG.push({ type: 'econSetting', payload: { band: 'standard' }, cost: 0, noLock: true, seq: SEQ++, ts: 5, label: 'Coin & calendar — Standard' });
      LOG.push({ type: 'wealth', payload: { gp: wallet.gp, days: wallet.days }, cost: 0, noLock: true, seq: SEQ++, ts: 6, label: 'Wallet' }); }
    cgFinishCreating(true);
  }, { b, econ, wallet });
  await cg.waitForTimeout(250);
  const env = await cg.evaluate(() => JSON.stringify(_cgEnvelope(false)));
  await ls.evaluate(e => { localStorage.setItem('pactLiveSheet', e); load(); render(); if (typeof refreshBuy === 'function') refreshBuy(); }, env);
  await ls.waitForTimeout(250);
  const s0 = await Promise.all([cg.evaluate(CG_SNAP), ls.evaluate(LS_SNAP)]);
  // the two tools must also see the SAME folded build, not just the same totals
  const [fc, fl] = await Promise.all([cg.evaluate(() => { const b = foldBuild(LOG); return JSON.stringify(b, (k, v) => (k === 'houseRules' ? undefined : v)); }), ls.evaluate(() => { const b = foldBuild(null); return JSON.stringify(b, (k, v) => (k === 'houseRules' ? undefined : v)); })]);
  let diffKeys = [];
  if (fc !== fl) { const A = JSON.parse(fc), B = JSON.parse(fl); diffKeys = [...new Set([...Object.keys(A), ...Object.keys(B)])].filter(k => JSON.stringify(A[k]) !== JSON.stringify(B[k])); }
  return { s0, diffKeys };
}
async function runOp(it, k, ctxInfo, history) {
  const L = await lsDo(it), C = await cgDo(it);
  report.ops++; bump(report.byCat, it.cat);
  const lsOK = L.accepted, cgOK = C.accepted;
  history.push({ cat: it.cat, payload: it.payload, ls: lsOK, cg: cgOK });
  const chain = it.cat === 'armour' && cgOKpre(C) && !lsOKpre(L) && C.after.post.slice(C.before.post.length).every(e => e.cat === 'armour');
  if (chain) { bump(report.expected, 'armour (auto-ticked lower tiers)'); return { stop: true }; }
  let cls = null;
  if (C.how && String(C.how).startsWith('no control')) { if (lsOK) cls = 'LS accepts, CharGen has no control (' + String(C.how).slice(0, 50) + ')'; else { bump(report.noControl, it.cat); } }
  else if (lsOK && !cgOK) cls = 'LS accepts, CharGen REFUSES';
  else if (!lsOK && cgOK) cls = 'CharGen accepts, LS refuses/not offered (' + L.found.state + (L.found.reason ? ': ' + L.found.reason : '') + ')';
  else if (lsOK && cgOK) { if (sig(L.after.post.slice(L.before.post.length)) !== sig(C.after.post.slice(C.before.post.length))) cls = 'both accept, DIFFERENT events'; else if (L.after.total !== C.after.total || L.after.spent !== C.after.spent) cls = 'both accept, same events, DIFFERENT totals'; }
  if (cls) {
    const kind = (EXPECTED.has(it.cat) && cls.startsWith('LS accepts, CharGen REFUSES')) ? 'expected' : 'mismatch';
    const rec = { cls, kind, ...ctxInfo, op: k, intent: it, history: history.slice(), ls: { state: L.found.state, reason: L.found.reason, accepted: lsOK, ev: L.after.post.slice(L.before.post.length), d: L.dialogs.slice(0, 2) }, cg: { how: C.how, accepted: cgOK, ev: C.after.post.slice(C.before.post.length), d: C.dialogs.slice(0, 2) }, seed: SEED };
    if (kind === 'expected') bump(report.expected, it.cat); else report.mismatches.push(rec);
    return { stop: true, rec };
  }
  return { stop: lsOK !== cgOK };
}

if (REPLAY) {
  const rec = JSON.parse(fs.readFileSync(REPLAY, 'utf8')).report.mismatches[RINDEX];
  const fx = FIX.find(x => x.f === rec.fixture); const b = JSON.parse(JSON.stringify(rec.build || fx.b)); b.budget = rec.budget;
  const { s0, diffKeys } = await setup(fx, b, rec.econ, rec.wallet || { gp: 0, days: 0 });
  console.log(`replay ${rec.cls}  fixture ${rec.fixture}  budget ${rec.budget}  econ ${rec.econ}  start totals cg ${s0[0].total}/${s0[0].spent} ls ${s0[1].total}/${s0[1].spent}  folded-build differences: ${JSON.stringify(diffKeys)}`);
  for (const h of rec.history) {
    const L = await lsDo({ cat: h.cat, payload: h.payload }), C = await cgDo({ cat: h.cat, payload: h.payload });
    console.log(` op ${h.cat} ${JSON.stringify(h.payload).slice(0, 90)}\n    LS: ${L.found.state}${L.found.reason ? ' (' + L.found.reason + ')' : ''} accepted=${L.accepted} ${JSON.stringify(L.after.post.slice(L.before.post.length)).slice(0, 160)} dialogs=${JSON.stringify(L.dialogs).slice(0, 160)}\n    CG: how=${C.how} accepted=${C.accepted} ${JSON.stringify(C.after.post.slice(C.before.post.length)).slice(0, 160)} dialogs=${JSON.stringify(C.dialogs).slice(0, 200)}`);
  }
  console.log('page errors:', JSON.stringify(errs.slice(0, 5), null, 1));
  await browser.close(); server.close(); process.exit(0);
}

for (let trial = 0; trial < TRIALS; trial++) {
  const fx = pick(FIX); const b = JSON.parse(JSON.stringify(fx.b)); b.budget = (b.budget || 79) + 30 + ri(90);
  if (rnd() < 0.5) { b.hd = 1 + ri(14); b.profBonus = Math.max(b.profBonus || 2, 2 + Math.floor((b.hd - 1) / 4)); for (const a of ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']) if (b.stats) b.stats[a] = 8 + ri(9); }   // vary level and ability scores so the HD gates and ability caps bite
  const econ = rnd() < 0.6, wallet = { gp: pick([0, 25, 100, 500, 3000]), days: pick([0, 14, 60, 365]) };
  const info = { trial, fixture: fx.f, budget: b.budget, econ, wallet: econ ? wallet : null, build: JSON.parse(JSON.stringify(b)) };   // the exact starting build, so a replay reproduces the randomised level and scores
  const history = [];
  try {
    const { s0, diffKeys } = await setup(fx, b, econ, wallet);
    report.trials++;
    if (s0[0].total !== s0[1].total || s0[0].spent !== s0[1].spent) { report.mismatches.push({ cls: 'START STATE DIFFERS (totals)', ...info, intent: { cat: 'start' }, cg: [s0[0].total, s0[0].spent], ls: [s0[1].total, s0[1].spent], history }); continue; }
    if (diffKeys.length) { report.mismatches.push({ cls: 'START STATE DIFFERS (folded build: ' + diffKeys.join(',') + ')', ...info, intent: { cat: 'start' }, history }); continue; }
    for (let k = 0; k < OPS; k++) {
      let intents = await intentsFor(Math.floor(rnd() * 4294967296)); if (ONLY) intents = intents.filter(i => ONLY.includes(i.cat));
      if (!intents.length) break;
      const cats = [...new Set(intents.map(i => i.cat))]; const cat = pick(cats); const r = await runOp(pick(intents.filter(i => i.cat === cat)), k, info, history);
      if (r.stop) break;
    }
  } catch (e) { report.errors.push({ trial, fixture: fx.f, err: String(e.message).slice(0, 200), history }); }
  if ((trial + 1) % 25 === 0) console.log(`  ... ${trial + 1}/${TRIALS} trials, ${report.ops} ops, ${report.mismatches.length} mismatches`);
}
await browser.close(); server.close();

// ---- report ----
const byClass = {}; for (const m of report.mismatches) { const k = m.cls + ' — ' + m.intent?.cat; (byClass[k] = byClass[k] || []).push(m); }
console.log(`\npost-lock parity fuzz — seed ${SEED}: ${report.trials} characters, ${report.ops} purchases compared through the real UI of both tools`);
console.log('purchases by category:', JSON.stringify(report.byCat));
console.log('deliberate differences (CharGen refuses, Live Sheet allows):', JSON.stringify(report.expected));
console.log('purchases CharGen has no control for (and the Live Sheet also did not do):', JSON.stringify(report.noControl));
console.log(`MISMATCHES: ${report.mismatches.length}   harness errors: ${report.errors.length}   page errors: ${errs.length}`);
for (const [k, arr] of Object.entries(byClass).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${arr.length}x ${k}`);
  const m = arr[0]; console.log(`      e.g. trial ${m.trial} (${m.fixture}${m.econ ? ', economy on' : ''}) ${JSON.stringify(m.intent)}\n      LS: ${JSON.stringify(m.ls).slice(0, 220)}\n      CG: ${JSON.stringify(m.cg).slice(0, 220)}`);
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ report, errs: errs.slice(0, 20) }, null, 1));
process.exitCode = report.mismatches.length || report.errors.length ? 1 : 0;
