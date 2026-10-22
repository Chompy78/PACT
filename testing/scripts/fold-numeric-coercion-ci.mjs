#!/usr/bin/env node
/**
 * PACT — a hostile LOG cannot park HTML in a numeric build field (fix/xss-unescaped-build-fields).
 *
 * WHY THIS EXISTS. MUT.patch is Object.assign(b, clone(p.patch)), so a saved LOG can set hd / languages / ki /
 * sorcery / hardy / tough / attune and traditions[].rank / disciplines[].slots[] to an HTML string. compute()
 * coerces only its own copy; the tools render the FOLDED build, and several concatenated those fields into
 * innerHTML (DM Console roster, Live Sheet sheet, a shared link / cloud load for a viewer). foldBuild() now
 * coerces them once at its output. This gate pins that, and that compute() is unchanged by it.
 *
 * USAGE:  node testing/scripts/fold-numeric-coercion-ci.mjs   (expect 0 failed)
 */
import path from 'node:path';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const E = await import(path.join(REPO, 'js/engine.js'));
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

const X = '<img src=x onerror=alert(1)>';
const mk = patch => [{ type: 'buy', cat: 'create', payload: {}, cost: 0 }, { type: 'buy', cat: 'patch', cost: 0, payload: { patch } }];
const hostile = mk({
  hd: X, languages: X, ki: X, sorcery: X, hardy: X, tough: X, attune: X, profBonus: X, gold: X, extraClasses: X, dabblerCantrips: X,
  traditions: [{ name: 'Arcane', rank: X, disciplines: [{ name: 'Wizard', bound: false, cantrips: X, slots: [X, 1, X], known: X, pactSlots: X, arcanum: [X] }] }],
});

console.log('\n[fold-numeric-coercion] == hostile patch fields come out as numbers ==');
const b = E.foldBuild(hostile);
for (const k of ['hd', 'languages', 'ki', 'sorcery', 'hardy', 'tough', 'attune', 'profBonus', 'gold', 'extraClasses', 'dabblerCantrips', 'budget'])
  check(`b.${k} is a number`, typeof b[k] === 'number' && Number.isFinite(b[k]), String(b[k]));
check('hd is clamped like compute() (1..20)', b.hd === 1);
const t = b.traditions[0], d = t.disciplines[0];
check('traditions[0].rank is a number', typeof t.rank === 'number');
check('discipline cantrips / pactSlots are numbers', typeof d.cantrips === 'number' && typeof d.pactSlots === 'number');
check('slots / known / arcanum are all-number arrays', [d.slots, d.known, d.arcanum].every(a => Array.isArray(a) && a.every(n => typeof n === 'number')));
check('slots keep honest entries and pad to 9', d.slots.length === 9 && d.slots[1] === 1);
check('no "<" survives anywhere in the folded numerics',
  !JSON.stringify([b.hd, b.languages, b.ki, b.sorcery, b.hardy, b.tough, b.attune, t.rank, d.cantrips, d.slots, d.known, d.pactSlots, d.arcanum]).includes('<'));
check('the stored events are untouched', hostile[1].payload.patch.hd === X);

console.log('\n[fold-numeric-coercion] == compute() is indifferent to the coercion ==');
const honest = mk({ hd: 5, languages: 3, ki: 2, hardy: 1, tough: 2, attune: 1, profBonus: 3,
  stats: { STR: 8, DEX: 14, CON: 14, INT: 14, WIS: 12, CHA: 12 },
  traditions: [{ name: 'Arcane', rank: 2, disciplines: [{ name: 'Wizard', bound: false, cantrips: 3, slots: [2, 1, 0, 0, 0, 0, 0, 0, 0], known: [2, 1, 0, 0, 0, 0, 0, 0, 0], pactSlots: 0, arcanum: [0, 0, 0, 0] }] }] });
const hb = E.foldBuild(honest);
check('honest fold: numerics keep their values', hb.hd === 5 && hb.languages === 3 && hb.traditions[0].rank === 2 && hb.traditions[0].disciplines[0].slots[0] === 2);
// compute() of the hostile build equals compute() of an equivalent already-numeric build (strings -> 0 / clamp)
const clean = E.foldBuild(mk({ hd: 1, languages: 0, ki: 0, sorcery: 0, hardy: 0, tough: 0, attune: 0, profBonus: 0, gold: 0, extraClasses: 0, dabblerCantrips: 0,
  traditions: [{ name: 'Arcane', rank: 0, disciplines: [{ name: 'Wizard', bound: false, cantrips: 0, slots: [0, 1, 0, 0, 0, 0, 0, 0, 0], known: [0, 0, 0, 0, 0, 0, 0, 0, 0], pactSlots: 0, arcanum: [0, 0, 0, 0] }] }] }));
check('compute(hostile) === compute(equivalent numeric build)', JSON.stringify(E.compute(b)) === JSON.stringify(E.compute(clean)));
check('compute() output carries no hostile markup', !JSON.stringify(E.compute(b)).includes('<img'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
