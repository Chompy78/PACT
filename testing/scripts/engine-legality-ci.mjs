#!/usr/bin/env node
/**
 * engine-legality-ci.mjs — proves js/engine.js's purchaseLegality() is a faithful extraction of the Live Sheet's original rules.
 *
 * WHY. refactor/engine-purchase-legality moved the Live Sheet's "may this be bought" rules (legalCheck, SOFT_WARN, EXPECTED_FOLLOWUP,
 * DUP_FIELD and buy()'s hard/soft/follow-up split) into the engine so CharGen's after-lock purchases obey the SAME rule. Before the move
 * CharGen only blocked warnings starting with the stop-sign marker, so it let through purchases the Live Sheet refuses (Vigor past CON mod).
 * A move is only safe if nothing changed: this keeps the original as a frozen reference (testing/scripts/lib/ls-legality-reference.js) and
 * compares it with the engine over every build fixture and a wide sweep of purchases — including ones that raise warnings (caps, prerequisites,
 * stat limits) and duplicate purchases of single-instance proficiencies. It also pins the behaviours the move exists for.
 *
 * Run:  node testing/scripts/engine-legality-ci.mjs     (expect 0 failed; exits non-zero otherwise)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '../../js/engine.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { DATA, MUT, compute, baseBuild } = E;
const clone = o => JSON.parse(JSON.stringify(o));

const refSrc = readFileSync(join(REPO, 'testing/scripts/lib/ls-legality-reference.js'), 'utf8');
const refClassify = new Function('MUT', 'compute', 'clone', refSrc + '\nreturn classify;')(MUT, compute, clone);

let pass = 0, fail = 0, mism = [];
const check = (name, ok, d = '') => { ok ? pass++ : (fail++, mism.push(name + (d ? ' — ' + d : ''))); };

const dir = join(REPO, 'testing/fixtures/builds');
const builds = [];
for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
  const raw = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const b = Object.assign(baseBuild(), clone(raw.build || raw));
  builds.push([f, b]);
  const hi = clone(b); hi.hd = Math.min(20, (hi.hd || 1) + 4); builds.push([f + ' (+4 HD)', hi]);
  const lo = clone(b); lo.stats = Object.assign({}, lo.stats, { STR: 8, CON: 8, DEX: 8 }); builds.push([f + ' (low STR/CON/DEX)', lo]);   // caps and armour limits bite
}

const probes = b => {
  const p = [];
  for (const ab of ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']) { const s = (b.stats && b.stats[ab]) || 10; p.push(['abil', { ab, to: Math.min(20, s + 2) }], ['abil', { ab, to: Math.min(20, s + 8) }]); }
  const hd = b.hd || 1;
  p.push(['hd', { to: Math.min(20, hd + 1) }], ['hd', { to: 20 }], ['prof', { to: Math.min(6, (b.profBonus || 2) + 1) }]);
  for (const n of [1, 2, 3, 4, 5]) p.push(['vigor', { to: (b.hardy || 0) + n }], ['grit', { to: (b.tough || 0) + n }]);   // the cap rule, at several depths
  for (const n of [1, 2, 4]) p.push(['ki', { to: (b.ki || 0) + n }], ['sorcery', { to: (b.sorcery || 0) + n }], ['attune', { to: (b.attune || 0) + n }], ['language', { to: (b.languages || 1) + n }]);
  for (const v of ['light', 'medium', 'heavy', 'shield']) p.push(['armour', { v }]);
  p.push(['wprof', { wp: { simple: true } }], ['wprof', { wp: { simple: true, allMartial: true } }], ['wprof', { wp: { simple: true, martial: 2 } }], ['wprof', { wp: { improvised: true } }]);
  for (const c of (DATA.classes || []).slice(0, 5)) p.push(['unlockclass', { v: c }]);
  p.push(['mbound', { v: 'Fighter' }], ['dbound', {}]);
  for (const d of (DATA.drawbackList || [])) p.push(['drawback', { v: d }]);   // every drawback: max-stat and spellcasting prerequisites
  for (const s of (DATA.skillList || [])) p.push(['skill', { v: s[0] }]);
  for (const x of ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']) p.push(['save', { v: x }]);
  for (const x of (DATA.boonList || [])) p.push(['boon', { v: x }]);
  for (const x of Object.keys(DATA.features || {}).slice(0, 40)) p.push(['feature', { v: x }]);
  for (const x of Object.keys(DATA.arts || {}).slice(0, 25)) p.push(['art', { v: x }]);
  for (const x of (DATA.masteries || []).slice(0, 8)) p.push(['mastery', { v: x }]);
  for (const x of (DATA.toolList || []).slice(0, 6)) p.push(['tool', { v: x }]);
  for (const x of (DATA.instrumentList || []).slice(0, 4)) p.push(['instrument', { v: x }]);
  for (const x of Object.keys(DATA.racial || {}).slice(0, 25)) p.push(['racial', { v: x }]);
  for (const x of (b.skills || []).slice(0, 3)) p.push(['skill', { v: x }], ['expertise', { v: x }]);          // duplicate purchases
  for (const x of (b.saves || []).slice(0, 2)) p.push(['save', { v: x }]);
  for (const x of (b.tools || []).slice(0, 2)) p.push(['tool', { v: x }], ['toolexpertise', { v: x }]);
  for (const x of (b.masteries || []).slice(0, 2)) p.push(['mastery', { v: x }]);
  for (const x of (b.racialTraits || []).slice(0, 2)) p.push(['racial', { v: x }]);
  p.push(['skill', {}], ['nonsense', { v: 'x' }]);   // degenerate inputs must agree too
  return p;
};

let compared = 0, withHard = 0, withSoft = 0, withDup = 0, withFollow = 0;
for (const [name, b] of builds) {
  for (const [cat, payload] of probes(b)) {
    let a, r, ea = null, er = null;
    try { r = refClassify(clone(b), cat, payload); } catch (e) { er = String(e.message || e); }
    try { a = E.purchaseLegality(clone(b), cat, payload); } catch (e) { ea = String(e.message || e); }
    compared++;
    if (!er && !ea) { if (r.hard.length) withHard++; if (r.soft.length) withSoft++; if (r.dup) withDup++; if (r.followup.length) withFollow++; }
    check(`${name} · ${cat} ${JSON.stringify(payload)}`, er === ea && JSON.stringify(a) === JSON.stringify(r), `engine ${ea || JSON.stringify(a)} vs reference ${er || JSON.stringify(r)}`);
  }
}
console.log(`\nengine purchaseLegality vs the Live Sheet original — ${compared} comparisons over ${builds.length} builds`);
console.log(`  coverage: ${withHard} hard-blocked, ${withSoft} soft-warned, ${withFollow} follow-up, ${withDup} duplicate`);
if (mism.length) console.log(mism.slice(0, 12).map(m => '  FAIL  ' + m).join('\n'));
check('the sweep actually compared something', compared > 3000, String(compared));
check('...and exercised every outcome (hard, soft, follow-up and duplicate all occur)', withHard > 20 && withSoft > 0 && withFollow > 0 && withDup > 0, JSON.stringify({ withHard, withSoft, withFollow, withDup }));

// the behaviours the move exists for
const nb = baseBuild();
const v1 = E.purchaseLegality(nb, 'vigor', { to: 1 });
check('Vigor past CON mod is a HARD block (CharGen used to let it through)', v1.hard.length === 1 && /Vigor 1 exceeds cap/.test(v1.hard[0]), JSON.stringify(v1));
const own = clone(nb); own.skills = ['Stealth'];
check('re-buying an owned single-instance skill is a duplicate', E.purchaseLegality(own, 'skill', { v: 'Stealth' }).dup === true);
check('a first purchase of it is not', E.purchaseLegality(nb, 'skill', { v: 'Stealth' }).dup === false);
check('a purchase that raises nothing is clean', (() => { const r = E.purchaseLegality(nb, 'language', { to: 2 }); return r.warnings.length === 0 && !r.hard.length && !r.dup; })());

console.log(`\n✓ ${pass} passed / ${fail} failed\n`);
process.exit(fail ? 1 : 0);
