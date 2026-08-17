#!/usr/bin/env node
/**
 * PACT — class-unlock economics simulator.
 *
 * WHY THIS EXISTS. The §11 question — "is cross-class access priced so a dabble works as a dabble
 * and anything more pushes you to unlock?" — has been argued twice from intuition and got the wrong
 * answer both times. This answers it from the live dataset instead.
 *
 * It changes nothing. It reads DATA and prints tables.
 *
 * IT USES THE REAL ENGINE, NOT A MODEL. Every figure below is compute() pricing a real build made of
 * real subclass abilities. Candidate unlock models are simulated by swapping DATA.unlockCum — the
 * cumulative table compute() already reads — so there is no second implementation to drift from the
 * first. That matters here specifically: an earlier draft of this script averaged tiers and produced
 * an archetype table where "6 purchases from one class" cost exactly what "2 purchases" cost, because
 * it was measuring access cost alone and access saturates the moment you unlock.
 *
 * USAGE:  node testing/scripts/sim-unlock-economics.mjs [--md]
 */
import { DATA, compute, baseBuild } from '../../js/engine.js';

const MD = process.argv.includes('--md');
const W = [];
function table(headers, rows) {
  if (MD) {
    console.log('| ' + headers.join(' | ') + ' |');
    console.log('|' + headers.map(() => '---').join('|') + '|');
    for (const r of rows) console.log('| ' + r.join(' | ') + ' |');
  } else {
    const w = headers.map((h, i) => Math.max(String(h).length, ...rows.map(r => String(r[i]).length)) + 2);
    const line = r => '  ' + r.map((c, i) => String(c).padEnd(w[i])).join('');
    console.log(line(headers));
    console.log('  ' + w.map(n => '-'.repeat(n - 2) + '  ').join(''));
    for (const r of rows) console.log(line(r));
  }
}
const H = s => console.log(MD ? `\n### ${s}\n` : `\n=== ${s}\n`);

// ── candidate unlock models, as cumulative tables the engine can read directly ──────────────────
// 12 classes exist, so every table is built to 12 rungs. The live one stops at 5, which is the
// cliff bug: engine.js does `(DATA.unlockCum[n] || 0)`, so rung 5+ reads as FREE and a 5th unlock
// refunds the 70 AP paid for the first four. Simulating with full tables also isolates the pricing
// question from that bug rather than tangling the two.
const cum = f => { const a = [0]; for (let n = 1; n <= 12; n++) a.push(a[n - 1] + f(n)); return a; };
const MODELS = {
  'current 7N':   cum(n => 7 * n),
  'flat 7':       cum(() => 7),
  'flat 10':      cum(() => 10),
  'flat 12':      cum(() => 12),
  '5N':           cum(n => 5 * n),
  '10 then +4':   cum(n => 10 + 4 * (n - 1)),
};
const LIVE = DATA.unlockCum;

// ── real picks: the first K abilities of a real subclass of a real class ────────────────────────
// Each subclass carries only ~4 abilities, so anything past 4 has to draw on a SECOND subclass of
// the same class — which legitimately costs 15 AP for the extra subclass unlock, and is included.
// An earlier draft sliced one subclass and silently returned 4 for k=6, which made "six purchases
// from one class" price identically to "four" and put a duplicate row in the headline table.
function picks(cls, k) {
  const out = [];
  for (const sub of Object.keys(DATA.subclasses[cls] || {})) {
    for (const a of DATA.subclasses[cls][sub].abilities || []) {
      if (out.length >= k) break;
      out.push(`${cls}|${sub}|${a.name}`);
    }
    if (out.length >= k) break;
  }
  if (out.length < k) throw new Error(`picks(${cls}, ${k}): only ${out.length} abilities exist — no silent truncation`);
  return out;
}
const FOREIGN = ['Cleric', 'Druid', 'Paladin', 'Warlock', 'Bard', 'Monk'];

/** Cheapest total for a build that takes `counts[i]` abilities from FOREIGN[i]. Players optimise,
 *  so every subset of classes-to-unlock is tried and the cheapest wins. */
function best(counts) {
  const classes = FOREIGN.slice(0, counts.length).filter((_, i) => counts[i] > 0);
  const abils = counts.flatMap((k, i) => picks(FOREIGN[i], k));
  let bestTotal = Infinity, bestSet = [];
  for (let mask = 0; mask < (1 << classes.length); mask++) {
    const unlock = classes.filter((_, i) => mask & (1 << i));
    const b = baseBuild();
    b.originClass = 'Fighter'; b.budget = 2000;
    b.unlockedClasses = unlock; b.subAbilities = abils;
    const t = compute(b).total;
    if (t < bestTotal) { bestTotal = t; bestSet = unlock; }
  }
  return { total: bestTotal, unlock: bestSet };
}

const ARCH = [
  ['one dab',        [1],                'one ability from one foreign class'],
  ['two dabs',       [1, 1],             'one from each of two'],
  ['light dip',      [2],                'two from one class'],
  ['real dip',       [4],                'four from one class'],
  ['two-class main', [6],                'six from one class'],
  ['scattered',      [1, 1, 1, 1],       'one from each of four'],
  ['generalist',     [3, 3, 3],          'three from each of three'],
  ['magpie',         [1, 1, 1, 1, 1, 1], 'one from each of six'],
];

console.log(`PACT unlock economics — engine ${DATA.version}, ${DATA.classes.length} classes`);
console.log(`Pricing is compute()'s, on real subclass abilities. Totals exclude the 0 AP baseline`);
console.log(`every build shares, so the numbers ARE the cost of class breadth.`);

H('Total build cost by archetype, under each unlock model');
{
  const rows = [];
  for (const [name, counts, desc] of ARCH) {
    const cells = Object.values(MODELS).map(t => { DATA.unlockCum = t; return best(counts).total; });
    DATA.unlockCum = LIVE;
    rows.push([name, desc, ...cells]);
  }
  table(['archetype', 'shape', ...Object.keys(MODELS)], rows);
}
console.log(`\n  Lower is not better — this is what breadth costs. The design question is whether the`);
console.log(`  curve rises enough that a magpie pays visibly more than a dip, without a single dab`);
console.log(`  costing so much that nobody dabbles.`);

H('Does the model push you to unlock? (what the optimiser actually chooses)');
{
  const rows = [];
  for (const [name, counts] of ARCH) {
    const cells = Object.values(MODELS).map(t => {
      DATA.unlockCum = t; const r = best(counts);
      return r.unlock.length ? `unlock ${r.unlock.length}` : 'dabble';
    });
    DATA.unlockCum = LIVE;
    rows.push([name, ...cells]);
  }
  table(['archetype', ...Object.keys(MODELS)], rows);
}
console.log(`\n  Intent: "dabble" for one-or-two purchases, "unlock" once someone genuinely invests.`);
console.log(`  A model that says "dabble" for a generalist is under-pricing the surcharge; one that`);
console.log(`  says "unlock" for a single dab has made the dabble route pointless.`);

H('Break-even: purchases from one foreign class before unlocking it wins');
{
  const rows = [];
  for (const [name, t] of Object.entries(MODELS)) {
    DATA.unlockCum = t;
    const cells = [];
    for (const n of [1, 2, 3, 4]) {
      // Nth unlock: hold n-1 classes already unlocked, then find the smallest k where unlocking pays.
      let k = 0;
      for (k = 1; k <= 12; k++) {
        const counts = Array(n - 1).fill(6); counts.push(k);   // n-1 classes already deep-invested
        if (best(counts).unlock.length >= n) break;
      }
      cells.push(k > 12 ? 'never' : `${k} buys`);
    }
    rows.push([name, ...cells]);
  }
  DATA.unlockCum = LIVE;
  table(['model', '1st class', '2nd', '3rd', '4th'], rows);
}
console.log(`\n  Measured, not derived: for each rung the simulator adds purchases until the optimiser`);
console.log(`  flips to unlocking. Sticker = cross - tier, so each purchase saves its own tier; the`);
console.log(`  cross-class buy pool (192 subclass abilities + 21 bundles) has mean tier 4.38.`);

H('The live ladder, as actually implemented');
console.log(`  DATA.unlockCum = [${LIVE.join(', ')}]  — ${LIVE.length} entries for ${DATA.classes.length} classes.`);
console.log(`  engine.js:291  (DATA.unlockCum[_uEnd] || 0) - DATA.unlockCum[_uStart]\n`);
{
  const rows = [];
  for (let n = 0; n <= 6; n++) {
    const b = baseBuild(); b.originClass = 'Fighter'; b.budget = 900;
    b.unlockedClasses = ['Cleric','Druid','Paladin','Warlock','Bard','Monk'].slice(0, n);
    const l = (compute(b).lines.find(x => x[0] === 'Class unlocks') || [, '(line absent)'])[1];
    rows.push([n, LIVE[n] === undefined ? 'undefined -> 0' : LIVE[n], l]);
  }
  table(['classes unlocked', 'unlockCum[n]', 'charged'], rows);
}
console.log(`\n  Past the end of the table \`|| 0\` reads as FREE rather than as an error, so a 5th unlock`);
console.log(`  REFUNDS the 70 AP paid for the first four. Whatever model is chosen must also extend the`);
console.log(`  table to 12 rungs (or be flat) and replace \`|| 0\` with a clamp.`);
