#!/usr/bin/env node
/**
 * PACT — a free feature's itemize row carries what it costs THIS character (fix/free-feature-effective-cost).
 *
 * WHY THIS EXISTS. Druid: Primal Order (Warden) and Cleric: Divine Order (Protector) are `free: true`: no price of their own,
 * their proficiencies are charged by the weapon / armour lines. Their itemize row therefore read 0, and a ledger showed a bare
 * "0" beside a purchase that really adds AP. compute() now adds a THIRD element to that row (total minus the total without the
 * feature) for the ledgers to print as "12*". row[1] stays 0, `total` and `lines` do not move.
 *
 * USAGE:  node testing/scripts/free-feature-effective-cost-ci.mjs   (expect 0 failed)
 */
import { compute, foldBuild, priceOf } from '../../js/engine.js';

let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); } };

const P = (seq, patch) => ({ seq, ts: 1, type: 'buy', cat: 'patch', cost: 0, level: 3, noLock: true, payload: { patch } });
const base = [
  { seq: 3, ts: 1, type: 'buy', cat: 'create', cost: 0, level: 1, noLock: true, payload: {} },
  P(5, { originClass: 'Ranger' }), P(6, { originClass2: 'Druid' }),
  P(11, { weaponProf: { simple: true, martial: 0, allMartial: false, improvised: false } }),
  P(12, { armour: { heavy: false, light: true, medium: false, shield: false }, wornArmour: '' }),
];
const feat = v => ({ seq: 58, ts: 2, type: 'buy', cat: 'feature', cost: 0, level: 6, payload: { v } });
const rows = l => compute(foldBuild(l)).itemize['Class features'] || [];
const row = (l, n) => rows(l).find(r => r[0].includes(n));

const W = 'Druid: Primal Order (Warden)', M = 'Druid: Primal Order (Magician)';
const warden = [...base, feat(W)], magician = [...base, feat(M)];

const wr = row(warden, 'Warden');
check('the Warden row keeps 0 in its price slot', wr && wr[1] === 0, JSON.stringify(wr));
check('the Warden row carries what it adds to this character', wr && wr[2] === priceOf(foldBuild(base), 'feature', { v: W }),
  JSON.stringify(wr) + ' vs priceOf ' + priceOf(foldBuild(base), 'feature', { v: W }));
check('that figure is the real extra proficiency cost (12 for Simple + Light only)', wr && wr[2] === 12, JSON.stringify(wr));
check('a priced feature (Magician) gets no third element', (row(magician, 'Magician') || []).length === 2, JSON.stringify(row(magician, 'Magician')));

const rich = [...base, P(13, { weaponProf: { simple: true, martial: 0, allMartial: true, improvised: false } }),
  P(14, { armour: { heavy: false, light: true, medium: true, shield: false }, wornArmour: '' }), feat(W)];
check('a character who already owns the proficiencies sees 0, not a charge', (row(rich, 'Warden') || [])[2] === 0, JSON.stringify(row(rich, 'Warden')));

// Display only: totals and ledger lines match a build with the same events computed with the third element stripped.
const c = compute(foldBuild(warden));
const stripped = JSON.parse(JSON.stringify(c.itemize)); stripped['Class features'].forEach(r => { r.length = 2; });
const sum = (a) => a.reduce((t, r) => t + (r[1] || 0), 0);
check('row prices still sum as before (the Warden row adds 0)', sum(c.itemize['Class features']) === sum(stripped['Class features']));
check('total is unchanged by the extra element', c.total === compute(foldBuild([...base, feat(W)])).total);
const lines = Object.fromEntries(c.lines.map(l => [l[0], l[1]]));
check('the AP still lands on the weapon and armour lines', lines['Weapon proficiency'] === 9 && lines['Armour proficiency'] === 6, JSON.stringify(lines));
check('no free feature owned means no extra work or elements', Object.values(compute(foldBuild(base)).itemize).flat().every(r => r.length === 2));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
