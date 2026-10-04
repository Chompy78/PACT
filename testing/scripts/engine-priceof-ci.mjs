#!/usr/bin/env node
/**
 * engine-priceof-ci.mjs — proves js/engine.js's priceOf() is a faithful extraction of the Live Sheet's original one.
 *
 * WHY. refactor/engine-priceof moved the in-play purchase pricer (priceOf + _CTX_PRICERS) out of the Live Sheet tool
 * file and into the engine, so CharGen can record a post-lock purchase at the SAME price (plan:
 * docs/plans/2026-10-04-chargen-post-lock-purchases.md). A move is only safe if nothing changed. This keeps the
 * original code as a frozen reference (testing/scripts/lib/ls-priceof-reference.js) and compares it with the engine
 * over every build fixture and a wide sweep of purchases — abilities, level-ups, class unlocks, bonds, drawbacks and
 * the ordinary whole-build-delta categories.
 *
 * Run:  node testing/scripts/engine-priceof-ci.mjs     (expect 0 failed; exits non-zero otherwise)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '../../js/engine.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { DATA, MUT, compute, baseBuild, requiredHD, FEAT_ALIAS, foldBuild } = E;
const clone = o => JSON.parse(JSON.stringify(o));

// Load the frozen original with the free variables it used to get from the tool.
const refSrc = readFileSync(join(REPO, 'testing/scripts/lib/ls-priceof-reference.js'), 'utf8');
const refPriceOf = new Function('DATA', 'MUT', 'compute', 'clone', 'requiredHD', 'FEAT_ALIAS', 'foldBuild',
  refSrc + '\nreturn priceOf;')(DATA, MUT, compute, clone, requiredHD, FEAT_ALIAS, foldBuild);

let pass = 0, fail = 0, mism = [];
const check = (name, ok, d = '') => { ok ? pass++ : (fail++, mism.push(name + (d ? ' — ' + d : ''))); };

// Builds: every fixture, laid over the engine's own base build so every field exists.
const dir = join(REPO, 'testing/fixtures/builds');
const builds = [];
for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
  const raw = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const b = Object.assign(baseBuild(), clone(raw.build || raw));
  builds.push([f, b]);
  // plus a higher-level variant of each, where HD gates and the blocked-purchase machinery matter
  const hi = clone(b); hi.hd = Math.min(20, (hi.hd || 1) + 4); builds.push([f + ' (+4 HD)', hi]);
}

const probes = b => {
  const p = [];
  for (const ab of ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']) {
    const s = (b.stats && b.stats[ab]) || 10;
    p.push(['abil', { ab, to: Math.min(20, s + 2) }], ['abil', { ab, to: Math.min(20, s + 6) }]);
  }
  const hd = b.hd || 1;
  p.push(['hd', { to: Math.min(20, hd + 1) }], ['hd', { to: Math.min(20, hd + 3) }], ['hd', { to: 20 }]);
  p.push(['prof', { to: Math.min(6, (b.profBonus || 2) + 1) }]);
  p.push(['vigor', { to: (b.hardy || 0) + 1 }], ['grit', { to: (b.tough || 0) + 1 }]);
  for (const c of (DATA.classes || []).slice(0, 4)) p.push(['unlockclass', { v: c }]);
  p.push(['mbound', {}], ['dbound', {}]);
  for (const d of (DATA.drawbackList || []).slice(0, 6)) p.push(['drawback', { v: d }]);
  for (const s of (DATA.skillList || []).slice(0, 4)) p.push(['skill', { v: s[0] }]);
  for (const a of ['STR', 'DEX', 'CON']) p.push(['save', { v: a }]);
  for (const x of (DATA.boonList || []).slice(0, 4)) p.push(['boon', { v: x }]);
  for (const x of Object.keys(DATA.features || {}).slice(0, 6)) p.push(['feature', { v: x }]);
  for (const x of Object.keys(DATA.arts || {}).slice(0, 3)) p.push(['art', { v: x }]);
  p.push(['language', {}], ['armour', {}], ['wprof', {}], ['ki', {}], ['sorcery', {}]);
  return p;
};

let compared = 0;
for (const [name, b] of builds) {
  for (const [cat, payload] of probes(b)) {
    let a, r, ea = null, er = null;
    try { r = refPriceOf(cat, payload, clone(b)); } catch (e) { er = String(e.message || e); }
    try { a = E.priceOf(clone(b), cat, payload); } catch (e) { ea = String(e.message || e); }
    compared++;
    check(`${name} · ${cat} ${JSON.stringify(payload)}`, er === ea && Object.is(a, r), `engine ${ea || a} vs reference ${er || r}`);
  }
}

console.log(`\nengine priceOf vs the Live Sheet original — ${compared} comparisons over ${builds.length} builds`);
if (mism.length) console.log(mism.slice(0, 12).map(m => '  FAIL  ' + m).join('\n'));
check('the sweep actually compared something', compared > 1000, String(compared));
console.log(`\n✓ ${pass} passed / ${fail} failed\n`);
process.exit(fail ? 1 : 0);
