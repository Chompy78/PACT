// feat/epic-boon-escalating-price — each epic boon costs more than the one before (owner pick S1, v0.385).
// The Nth printed epic boon a character holds, in the order bought, costs DATA.epicBoonSteps[N-1]: 25, 30, 36, 43, 51, 60, 70, 81, 93, 106, 120, 135
// (twelve boons, 850 AP in all; the last step repeats). A blocked boon (Hit Dice below its gate) is not counted; a DM house-rules re-price of a
// printed epic boon wins over the step; a DM custom boon never counts. The +2 ability fold is untouched. Pure Node.
// Run: node testing/scripts/epic-boon-price-ci.mjs
import { DATA, compute, baseBuild, priceOf } from '../../js/engine.js';

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? ' — ' + x : '')); } };
const mk = extra => Object.assign(baseBuild(), { originClass: 'Fighter', hd: 20, budget: 5000, stats: { STR: 14, DEX: 12, CON: 14, INT: 12, WIS: 12, CHA: 12 } }, extra || {});
const total = b => compute(b).total;
const EPIC = DATA.boonList.filter(k => DATA.boons[k].epic);
const STEPS = [25, 30, 36, 43, 51, 60, 70, 81, 93, 106, 120, 135];

console.log('== the table');
ok(JSON.stringify(DATA.epicBoonSteps) === JSON.stringify(STEPS), 'DATA.epicBoonSteps is the owner-approved table', JSON.stringify(DATA.epicBoonSteps));
ok(EPIC.length === 12 && EPIC.every(k => DATA.boons[k].ap === 25 && DATA.boons[k].hd === 19), 'twelve epic boons, each printed at 25 AP and HD 19 (the 2024 level)');

console.log('== the Nth boon costs the Nth step');
let prev = total(mk()), deltas = [];
for (let n = 1; n <= 12; n++) { const t = total(mk({ boons: EPIC.slice(0, n) })); deltas.push(t - prev); prev = t; }
ok(JSON.stringify(deltas) === JSON.stringify(STEPS), 'buying the twelve in order adds 25, 30, 36 … 135', deltas.join(' '));
ok(deltas.reduce((a, c) => a + c, 0) === 850, 'all twelve cost 850 AP, not 300');
ok(total(mk({ boons: [EPIC[0]] })) - total(mk()) === 25, 'the first boon costs 25');
ok(total(mk({ boons: EPIC.slice(0, 2) })) - total(mk({ boons: [EPIC[0]] })) === 30, 'the second costs 30');
ok(total(mk({ boons: EPIC })) - total(mk({ boons: EPIC.slice(0, 11) })) === 135, 'the twelfth costs 135');

console.log('== the order bought decides the price (a later buy pays the higher rate)');
const A = EPIC[0], B = EPIC[1];
ok(total(mk({ boons: [A, B] })) === total(mk({ boons: [B, A] })), 'two boons cost the same in either order in total');
const base1 = mk({ boons: [A] });
ok(priceOf(base1, 'boon', { v: B }) === 30, 'priceOf quotes the second boon at 30 (the frozen cost of the purchase)', String(priceOf(base1, 'boon', { v: B })));
ok(priceOf(mk(), 'boon', { v: A }) === 25, 'priceOf quotes the first boon at 25');

console.log('== a non-epic boon is untouched');
const plain = DATA.boonList.find(k => !DATA.boons[k].epic && DATA.boons[k].hd <= 20 && !DATA.boons[k].minStats && !DATA.boons[k].minStatsAny && !DATA.boons[k].prereq);
const plainAP = DATA.boons[plain].ap;
ok(total(mk({ boons: [plain] })) - total(mk()) === plainAP, plain + ' (not epic) still costs its printed ' + plainAP);
ok(total(mk({ boons: [plain, A] })) - total(mk({ boons: [plain] })) === 25, 'a plain boon does not count towards the epic ladder (the first epic boon is still 25)');

console.log('== a blocked boon is not counted');
const low = mk({ hd: 18, boons: [A, B] });
ok(compute(low).warnings.some(w => w.indexOf('blocked') >= 0), 'at 18 HD an epic boon is blocked (needs 19)');
ok(total(mk({ hd: 19, boons: [A] })) - total(mk({ hd: 19 })) === 25, 'at 19 HD the first epic boon is 25');

console.log('== house rules');
const custom = 'Test Custom Epic';
const hrCustom = { boons: { [custom]: { hd: 19, ap: 40, fx: 'x', epic: true, cat: 'DM custom', custom: true } } };
ok(total(mk({ houseRules: hrCustom, boons: [custom, A] })) - total(mk({ houseRules: hrCustom, boons: [custom] })) === 25, 'a DM custom epic boon does not count towards the ladder');
const hrRe = { boons: { [A]: { hd: 19, ap: 50, fx: '' } } };
ok(total(mk({ houseRules: hrRe, boons: [A] })) - total(mk({ houseRules: hrRe })) === 50, 'a DM re-price of a printed epic boon wins over the step');
ok(total(mk({ houseRules: hrRe, boons: [A, B] })) - total(mk({ houseRules: hrRe, boons: [A] })) === 30, '…and the re-priced boon still counts, so the next one is the second step (30)');

console.log('== the +2 ability fold still reads b.boons');
const withAbil = mk({ boons: EPIC.slice(0, 3), epicBoonAbil: { [EPIC[0]]: 'STR', [EPIC[1]]: 'DEX', [EPIC[2]]: 'CON' } });
const base0 = mk({ boons: EPIC.slice(0, 3) });
ok(compute(withAbil).mods.STR !== undefined && total(withAbil) === total(base0), 'choosing the abilities changes no price');

console.log('== mutation control');
{ const saved = DATA.epicBoonSteps; delete DATA.epicBoonSteps;
  ok(total(mk({ boons: EPIC.slice(0, 3) })) - total(mk()) === 75, 'control: without the table every epic boon is a flat 25 again');
  DATA.epicBoonSteps = saved; }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
