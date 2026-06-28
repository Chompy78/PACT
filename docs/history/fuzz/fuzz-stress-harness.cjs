#!/usr/bin/env node
/* PACT overnight "weird & wonderful" looping checks — seeded property-based + metamorphic +
 * differential fuzzing over compute()/render/economy. READ-ONLY: never edits the engine.
 * Runs on a wall-clock budget, checkpointing a report each round so it survives interruption.
 *
 * Env: FUZZ_BUDGET_MS (default 10800000 = 3h), FUZZ_SEED (default 0x9E3779B9),
 *      FUZZ_CHUNK (iters per suite per round, default 6000).
 * Run: node archive/fuzz/fuzz-stress-harness.cjs
 */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = '/mnt/workspace/output';
const WORK = path.join(ROOT, 'working');
try { fs.mkdirSync(OUT, { recursive: true }); } catch (e) {}
const { loadEngine } = require(path.join(ROOT, 'scripts', 'headless.cjs'));

// ---- load all 4 engine files (2 tools + 2 consoles) for differential testing ----
function readFile(p) { return fs.readFileSync(p, 'utf8'); }
const toolFiles = fs.readdirSync(ROOT).filter(f => /^PACT-(CharGen-Webtool|Live-Char-Sheet)-v.*\.html$/.test(f)).map(f => ({ name: f, p: path.join(ROOT, f) }));
const consDir = path.join(ROOT, 'dm-consoles');
const consFiles = fs.existsSync(consDir) ? fs.readdirSync(consDir).filter(f => /^DM Console - .*\.html$/.test(f)).map(f => ({ name: f, p: path.join(consDir, f) })) : [];
// load consoles + CharGen first, Live Sheet LAST so its globals (spellPanel) are active
const lsEntry = toolFiles.find(t => /Live-Char-Sheet/.test(t.name));
const order = [...consFiles, ...toolFiles.filter(t => t !== lsEntry), lsEntry];
const engines = order.map(e => ({ name: e.name, E: loadEngine(readFile(e.p)) }));
const LS = engines[engines.length - 1].E;                 // Live Sheet engine (loaded last)
const compute = LS.compute, DATA = LS.DATA, renderCharSheet = LS.renderCharSheet, eligibleSpells = LS.eligibleSpells || globalThis.eligibleSpells;
const spellPanel = globalThis.spellPanel;                 // captured after LS load
const swapAvailFrom = LS.swapAvailFrom, swapSplit = LS.swapSplit;
const Ln = (r, k) => { const l = r.lines.find(x => x[0] === k); return l ? l[1] : undefined; };

// ---- seeded PRNG (mulberry32) ----
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const SEED = parseInt(process.env.FUZZ_SEED || '0x9E3779B9');
const BUDGET_MS = parseInt(process.env.FUZZ_BUDGET_MS || '10800000');
const CHUNK = parseInt(process.env.FUZZ_CHUNK || '6000');

// ---- catalogue handles ----
const CLASSES = (() => { const s = new Set(); Object.keys(DATA.features).forEach(k => { const c = DATA.features[k].cls; if (c) s.add(c); }); return [...s]; })();
const BOONS = Object.keys(DATA.boons), DRAWS = Object.keys(DATA.drawbacks), ARTS = (DATA.artList || Object.keys(DATA.arts || {}));
const FEATS = Object.keys(DATA.features).filter(k => !DATA.features[k].hidden);
const TRADS = ['Arcane', 'Divine', 'Primal'];
const ABILS = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const SPECIES = Object.keys(DATA.speed || {});

// ---- random helpers ----
const ri = (rng, n) => Math.floor(rng() * n);
const pick = (rng, arr) => arr[ri(rng, arr.length)];
const subset = (rng, arr, maxN) => { const n = ri(rng, Math.min(maxN, arr.length) + 1); const c = arr.slice(); const o = []; for (let i = 0; i < n && c.length; i++) o.push(c.splice(ri(rng, c.length), 1)[0]); return o; };
function randStats(rng) { const s = {}; ABILS.forEach(a => s[a] = 6 + ri(rng, 15)); return s; }
function randArr9(rng, max) { const a = []; for (let i = 0; i < 9; i++) a.push(ri(rng, max + 1)); return a; }
function randBuild(rng) {
  const hd = ri(rng, 21);
  const oc = rng() < 0.85 ? pick(rng, CLASSES) : '';
  const b = {
    hd, originClass: oc, originClass2: rng() < 0.15 ? pick(rng, CLASSES) : '',
    unlockedClasses: subset(rng, CLASSES, 3),
    stats: randStats(rng), profBonus: 2 + ri(rng, 5),
    species: SPECIES.length ? pick(rng, SPECIES) : '', species2: '', name: 'Fuzz', lineage: '',
    ki: ri(rng, 30), sorcery: ri(rng, 10), hardy: ri(rng, 8), tough: ri(rng, 8),
    gold: ri(rng, 200), languages: ri(rng, 4), dabblerCantrips: ri(rng, 4),
    innate: randArr9(rng, 2),
    arts: subset(rng, ARTS, 8), boons: subset(rng, BOONS, 6), drawbacks: subset(rng, DRAWS, 5),
    features: subset(rng, FEATS, 12),
    racialTraits: [], skills: [], expertise: [], saves: [], subAbilities: [], subSpellBundles: [],
    dabblerCantripNames: [], innateNames: [],
    houseRules: { dmAllows: { bound: true, boons: true, drawbacks: true, tasha: true } },
  };
  const nT = ri(rng, 3);
  b.traditions = [];
  for (let t = 0; t < nT; t++) {
    const nD = 1 + ri(rng, 2);
    const ds = [];
    for (let d = 0; d < nD; d++) ds.push({ name: pick(rng, CLASSES), cantrips: ri(rng, 6), known: randArr9(rng, 3), slots: randArr9(rng, 3), arcanum: [ri(rng, 2), ri(rng, 2), ri(rng, 2), ri(rng, 2)], bound: rng() < 0.3 });
    b.traditions.push({ name: pick(rng, TRADS), rank: ri(rng, 10), disciplines: ds });
  }
  if (rng() < 0.3) { const eb = {}; (b.boons || []).forEach(x => { if (DATA.boons[x] && DATA.boons[x].epic) eb[x] = pick(rng, ABILS); }); b.epicBoonAbil = eb; }
  return b;
}
// a controlled single-discipline caster for the surcharge law
function caster(rng, originRel) {
  // originRel: 'origin' | 'unlocked' | 'ununlocked'
  const disc = 'Sorcerer';
  const b = { hd: 5 + ri(rng, 13), stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 12 + ri(rng, 6) },
    traditions: [{ name: 'Arcane', rank: 1 + ri(rng, 6), disciplines: [{ name: disc, cantrips: ri(rng, 4), known: randArr9(rng, 2), slots: randArr9(rng, 2) }] }] };
  if (originRel === 'origin') { b.originClass = disc; b.unlockedClasses = []; }
  else if (originRel === 'unlocked') { b.originClass = 'Fighter'; b.unlockedClasses = [disc]; }
  else { b.originClass = 'Fighter'; b.unlockedClasses = []; }
  return b;
}
const isNum = x => typeof x === 'number' && isFinite(x);
function scanFinite(r) {
  if (!isNum(r.total)) return 'total not finite: ' + r.total;
  if (!isNum(r.hp)) return 'hp not finite: ' + r.hp;
  if (r.hp < 1) return 'hp < 1: ' + r.hp;
  for (const k in (r.mods || {})) if (!isNum(r.mods[k])) return 'mod ' + k + ' not finite';
  for (const l of (r.lines || [])) { if (typeof l[1] !== 'number' || !isFinite(l[1])) return 'line "' + l[0] + '" value not finite: ' + l[1]; }
  return null;
}
// does Σlines === total on a vanilla build? (establish whether the invariant holds before enforcing)
let LEDGER_OK = false;
try { const r0 = compute({ hd: 5, stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 } }); LEDGER_OK = Math.abs(r0.lines.reduce((s, l) => s + (l[1] || 0), 0) - r0.total) < 1e-6; } catch (e) {}

// ---- suites: each returns null (pass) or a string reason (fail); build supplied by runner ----
const SUITES = [
  { name: 'no-throw/finite', gen: randBuild, run: (b) => { let r; try { r = compute(b); } catch (e) { return 'THREW: ' + (e && e.message); } return scanFinite(r); } },
  { name: 'ledger-sum', gen: randBuild, run: (b) => { if (!LEDGER_OK) return null; let r; try { r = compute(b); } catch (e) { return 'THREW: ' + (e && e.message); } const s = r.lines.reduce((a, l) => a + (l[1] || 0), 0); return Math.abs(s - r.total) < 1e-6 ? null : 'Σlines ' + s + ' != total ' + r.total; } },
  { name: 'purity', gen: randBuild, run: (b) => { let a, c; try { a = compute(b); c = compute(b); } catch (e) { return 'THREW: ' + (e && e.message); } if (a.total !== c.total || a.hp !== c.hp || a.lines.length !== c.lines.length) return 'non-deterministic: total ' + a.total + '/' + c.total + ' hp ' + a.hp + '/' + c.hp; return null; } },
  { name: 'surcharge-law', gen: (rng) => rng, run: (rng) => {
      // controlled single-purchase caster (one L1 slot sticker 4, one L3 known sticker 2 — both above the
      // floor-of-1, so each shifts by exactly 1). Randomise hd/rank/CHA. Foundation is always one purchase.
      const hd = 5 + ri(rng, 13), rank = 3 + ri(rng, 6), cha = 12 + ri(rng, 6);
      const mk = rel => { const b = { hd, stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: cha },
        traditions: [{ name: 'Arcane', rank, disciplines: [{ name: 'Sorcerer', cantrips: 0, known: [0, 0, 1, 0, 0, 0, 0, 0, 0], slots: [1, 0, 0, 0, 0, 0, 0, 0, 0] }] }] };
        if (rel === 'origin') { b.originClass = 'Sorcerer'; b.unlockedClasses = []; }
        else if (rel === 'unlocked') { b.originClass = 'Fighter'; b.unlockedClasses = ['Sorcerer']; }
        else { b.originClass = 'Fighter'; b.unlockedClasses = []; }
        return compute(b); };
      let ro, ru, rn; try { ro = mk('origin'); ru = mk('unlocked'); rn = mk('ununlocked'); } catch (e) { return 'THREW: ' + (e && e.message); }
      for (const lab of ['Trad 1 Arcane — Foundation', 'Trad 1 Arcane / Sorcerer slots', 'Trad 1 Arcane / Sorcerer spells known']) {
        const o = Ln(ro, lab), u = Ln(ru, lab), n = Ln(rn, lab);
        if (!(isNum(o) && isNum(u) && isNum(n))) return lab + ' missing in a relation: ' + [o, u, n];
        if (!(u - o === 1 && n - u === 1)) return lab + ' delta law broken: origin ' + o + ' unlocked ' + u + ' ununlocked ' + n;
      }
      return null; } },
  { name: 'flat-across-HD', gen: (rng) => rng, run: (rng) => {
      const r1 = mulberry32((rng() * 1e9) >>> 0); const base = caster(r1, 'origin'); base.originClass = 'Sorcerer'; base.unlockedClasses = [];
      const a = JSON.parse(JSON.stringify(base)); a.hd = 5; const c = JSON.parse(JSON.stringify(base)); c.hd = 18;
      let ra, rc; try { ra = compute(a); rc = compute(c); } catch (e) { return 'THREW: ' + (e && e.message); }
      const fa = Ln(ra, 'Trad 1 Arcane — Foundation'), fc = Ln(rc, 'Trad 1 Arcane — Foundation');
      if (!(isNum(fa) && isNum(fc))) return 'foundation missing';
      return fa === fc ? null : 'origin discount deepened with HD: HD5 found ' + fa + ' vs HD18 ' + fc; } },
  { name: 'price-split', gen: (rng) => rng, run: (rng) => {
      // buying an ability increase costs the same with/without a flat-bonus feature present
      const stat = pick(rng, ABILS); const lvl = 12 + 2 * ri(rng, 4);
      const mk = (withBoon) => { const b = { hd: 18, stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 } }; b.stats[stat] = lvl; if (withBoon) b.features = ['Barbarian: Primal Champion']; return compute(b); };
      let a, c; try { a = mk(false); c = mk(true); } catch (e) { return 'THREW: ' + (e && e.message); }
      const ab = Ln(a, 'Ability scores'), cb = Ln(c, 'Ability scores');
      if (!(isNum(ab) && isNum(cb))) return null; // label may differ; skip silently
      return ab === cb ? null : 'ability cost changed by a flat bonus: without ' + ab + ' with ' + cb; } },
  { name: 'monotonic-stat', gen: (rng) => rng, run: (rng) => {
      const stat = pick(rng, ABILS); const base = 8 + 2 * ri(rng, 5);
      const mk = v => { const b = { hd: 10, stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 } }; b.stats[stat] = v; return compute(b); };
      let lo, hi; try { lo = Ln(mk(base), 'Ability scores'); hi = Ln(mk(Math.min(20, base + 2)), 'Ability scores'); } catch (e) { return 'THREW: ' + (e && e.message); }
      if (!(isNum(lo) && isNum(hi))) return null;
      return hi >= lo ? null : 'raising ' + stat + ' lowered cost: ' + lo + ' -> ' + hi; } },
  { name: 'frail-arbitrage', gen: (rng) => rng, run: (rng) => {
      const b = { hd: 3 + ri(rng, 15), stats: { STR: 10, DEX: 10, CON: 10 + 2 * ri(rng, 4), INT: 10, WIS: 10, CHA: 10 }, hardy: ri(rng, 5), tough: ri(rng, 5), drawbacks: [rng() < 0.5 ? 'Frail' : 'Glass Frame'] };
      const b0 = Object.assign({}, b, { drawbacks: [] });
      let r, r0; try { r = compute(b); r0 = compute(b0); } catch (e) { return 'THREW: ' + (e && e.message); }
      const base = r0.hp - (b.hardy * b.hd + b.tough * 4); // base HP without Vigor/Grit
      if (r.hp > Math.max(1, base - b.hd) + 0.001) return 'arbitrage NOT closed: hp ' + r.hp + ' > base-hd ' + (base - b.hd) + ' (Vigor/Grit offset the drawback)';
      if ((b.hardy || b.tough) && !(r.warnings || []).some(w => /offset/i.test(w))) return 'no suppression warning fired (hardy ' + b.hardy + ' tough ' + b.tough + ')';
      return null; } },
  { name: 'differential-x4', gen: randBuild, run: (b) => {
      let base; try { base = engines[0].E.compute(b); } catch (e) { return 'engine[0] THREW: ' + (e && e.message); }
      for (let i = 1; i < engines.length; i++) { let r; try { r = engines[i].E.compute(b); } catch (e) { return engines[i].name + ' THREW where ' + engines[0].name + ' did not: ' + (e && e.message); }
        if (r.total !== base.total || r.hp !== base.hp || r.lines.length !== base.lines.length) return 'engine drift: ' + engines[i].name + ' total ' + r.total + ' hp ' + r.hp + ' vs ' + engines[0].name + ' total ' + base.total + ' hp ' + base.hp; }
      return null; } },
  { name: 'eligibleSpells', gen: randBuild, run: (b) => { if (typeof eligibleSpells !== 'function') return null;
      for (let ti = 0; ti < (b.traditions || []).length; ti++) for (let di = 0; di < (b.traditions[ti].disciplines || []).length; di++) {
        let e; try { e = eligibleSpells(b, ti, di); } catch (er) { return 'THREW ti' + ti + ' di' + di + ': ' + (er && er.message); }
        if (e && e.maxLv != null) { const rank = b.traditions[ti].rank || 0; if (e.maxLv > rank) return 'maxLv ' + e.maxLv + ' > rank ' + rank; } }
      return null; } },
  { name: 'render-no-leak', gen: randBuild, run: (b) => { let r; try { r = compute(b); } catch (e) { return 'compute THREW: ' + (e && e.message); }
      let html = ''; try { if (typeof spellPanel === 'function') html += spellPanel(b, r); if (typeof renderCharSheet === 'function') html += renderCharSheet(b, r, {}); } catch (e) { return 'render THREW: ' + (e && e.message); }
      if (/undefined|NaN|\[object Object\]/.test(html)) { const m = html.match(/.{0,20}(undefined|NaN|\[object Object\]).{0,20}/); return 'render leaked: …' + (m ? m[0] : '') + '…'; }
      return null; } },
  { name: 'swap-economy', gen: (rng) => rng, run: (rng) => { if (typeof swapAvailFrom !== 'function') return null;
      const hd = 1 + ri(rng, 20); let s; try { s = swapAvailFrom(hd, []); } catch (e) { return 'THREW: ' + (e && e.message); }
      if (s && (s.avail < 0 || s.avail > 2)) return 'swap avail out of range: ' + s.avail; return null; } },
  { name: 'fold-no-throw', gen: (rng) => rng, run: (rng) => {
      const n = 1 + ri(rng, 12); const log = [{ type: 'award', amount: ri(rng, 200), seq: 1 }];
      const cats = [['hd', { to: 1 + ri(rng, 20) }], ['save', { v: pick(rng, ABILS) }], ['skill', { v: 'Athletics' }], ['vigor', { to: ri(rng, 6) }], ['grit', { to: ri(rng, 6) }]];
      for (let i = 0; i < n; i++) { const c = pick(rng, cats); log.push({ type: 'buy', cat: c[0], payload: c[1], cost: ri(rng, 20), seq: i + 2 }); }
      try { LS.setLOG(log, log.length + 1); const r = LS.compute(LS.foldBuild(null)); const f = scanFinite(r); LS.setLOG([], 1); return f; } catch (e) { LS.setLOG([], 1); return 'THREW: ' + (e && e.message); } } },
  { name: 'economy-soundness', gen: (rng) => rng, run: (rng) => {
      const log = []; let seq = 1; const k = 1 + ri(rng, 10);
      for (let i = 0; i < k; i++) { if (rng() < 0.5) log.push({ type: 'award', amount: ri(rng, 100), seq: seq++ }); else log.push({ type: 'buy', cat: 'skill', payload: { v: 'S' + i }, cost: ri(rng, 30), seq: seq++ }); }
      try { LS.setLOG(log, seq); const e = LS.economy(null); LS.setLOG([], 1); if (!(isFinite(e.earned) && isFinite(e.spent) && isFinite(e.available))) return 'non-finite economy: ' + JSON.stringify(e); if (e.available !== e.earned - e.spent) return 'available != earned-spent: ' + JSON.stringify(e); return null; } catch (er) { LS.setLOG([], 1); return 'THREW: ' + (er && er.message); } } },
];

// ---- runner: time-budgeted rounds, checkpoint after each ----
const stats = SUITES.map(s => ({ name: s.name, iters: 0, fails: 0, examples: [] }));
const t0 = Date.now();
let round = 0;
function writeReport(done) {
  const elapsed = Date.now() - t0; const totalIters = stats.reduce((a, s) => a + s.iters, 0); const totalFails = stats.reduce((a, s) => a + s.fails, 0);
  const md = ['# PACT overnight fuzz report' + (done ? ' (COMPLETE)' : ' (in progress)'),
    '', '- started: epoch ' + t0 + ' · elapsed ' + (elapsed / 1000 / 60).toFixed(1) + ' min / budget ' + (BUDGET_MS / 1000 / 60).toFixed(0) + ' min',
    '- seed: 0x' + (SEED >>> 0).toString(16) + ' · rounds: ' + round + ' · engines diffed: ' + engines.length + ' (' + engines.map(e => e.name).join(', ') + ')',
    '- **total iterations: ' + totalIters.toLocaleString() + '** · **total counterexamples: ' + totalFails + '**',
    '- ledger-sum invariant active: ' + LEDGER_OK,
    '', '| suite | iterations | counterexamples |', '|---|--:|--:|',
    ...stats.map(s => '| ' + s.name + ' | ' + s.iters.toLocaleString() + ' | ' + s.fails + ' |'), ''];
  for (const s of stats) if (s.examples.length) { md.push('### ✗ ' + s.name + ' — ' + s.fails + ' counterexample(s)'); s.examples.forEach((ex, i) => md.push('' + (i + 1) + '. `' + ex.reason + '`\n   - build: `' + ex.build + '`')); md.push(''); }
  if (totalFails === 0) md.push('\n**No counterexamples found.** All invariants held across ' + totalIters.toLocaleString() + ' iterations.');
  try { fs.writeFileSync(path.join(OUT, 'overnight-report.md'), md.join('\n')); fs.writeFileSync(path.join(OUT, 'overnight-report.json'), JSON.stringify({ seed: SEED, elapsedMs: elapsed, rounds: round, stats, ledgerOK: LEDGER_OK, done: !!done }, null, 2)); } catch (e) {}
}
const rng = mulberry32(SEED);
console.log('overnight fuzz: budget ' + (BUDGET_MS / 3600000).toFixed(1) + 'h, seed 0x' + (SEED >>> 0).toString(16) + ', ' + engines.length + ' engines, ' + SUITES.length + ' suites');
while (Date.now() - t0 < BUDGET_MS) {
  round++;
  for (let si = 0; si < SUITES.length; si++) {
    const suite = SUITES[si], st = stats[si];
    const chunk = suite.name === 'differential-x4' ? Math.floor(CHUNK / 3) : CHUNK; // x4 is heavier
    for (let i = 0; i < chunk; i++) {
      let arg; try { arg = suite.gen(rng); } catch (e) { arg = undefined; }
      let reason; try { reason = suite.run(arg); } catch (e) { reason = 'HARNESS-THREW: ' + (e && e.message); }
      st.iters++;
      if (reason) { st.fails++; if (st.examples.length < 8) { let bstr = ''; try { bstr = JSON.stringify(arg && arg.traditions !== undefined ? arg : (typeof arg === 'function' ? '(seeded)' : arg)).slice(0, 1200); } catch (e) { bstr = '(unserializable)'; } st.examples.push({ reason, build: bstr }); } }
    }
  }
  writeReport(false);
  const el = (Date.now() - t0) / 60000;
  console.log('round ' + round + ' done @ ' + el.toFixed(1) + 'min · iters ' + stats.reduce((a, s) => a + s.iters, 0).toLocaleString() + ' · fails ' + stats.reduce((a, s) => a + s.fails, 0));
}
writeReport(true);
console.log('DONE: ' + stats.reduce((a, s) => a + s.iters, 0).toLocaleString() + ' iterations, ' + stats.reduce((a, s) => a + s.fails, 0) + ' counterexamples. Report -> output/overnight-report.md');
