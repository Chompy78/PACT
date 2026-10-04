#!/usr/bin/env node
/**
 * wounds-ci.mjs — the gate for DATA.wounds and the two wound rules in compute()
 * (feat/permanent-wounds, D-GH-2026-10-04-permanent-wounds).
 *
 * WHAT A WOUND IS. A lasting injury a DM imposes on a campaign character. It is an ordinary drawback in
 * DATA.drawbacks (so its price, text and category flow everywhere), plus an entry in DATA.wounds saying which TIER
 * it is (minor 2 AP, moderate 3-4 AP), which part of the body it is in (`slot`), and — for the four NEW entries —
 * whether it is `dmOnly`: wound-only drawbacks that players can never take. An imposed drawback pays the player
 * nothing, so a wound's table price is simply what it costs to buy it off.
 *
 * WHY A GATE. The wound-only entries are hidden from players by being kept OUT of DATA.drawbackList (the list every
 * player picker reads) while staying in DATA.drawbacks (so the engine still prices and warns about them). That split is
 * easy to break silently — one name added to the wrong place and either a player can pick a DM-only injury, or a DM
 * cannot impose one — so it is pinned here, along with the two compute() rules: a wound-only entry that is not
 * DM-imposed is a hard ⛔, and two wounds in the same place is a soft warning.
 *
 * Run:  node testing/scripts/wounds-ci.mjs     (expect 0 failed; exits non-zero otherwise)
 * Uses only Node built-ins — no npm, no browser, no network.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { DATA, compute, foldBuild, economy } = await import(pathToFileURL(resolve(REPO, 'js/engine.js')).href);

let pass = 0, fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};

const W = DATA.wounds;
const names = Object.keys(W);
const NEW = ['Maimed Hand', 'Bad Knee', 'Brittle Bones', 'Withered Arm'];
const GRIEVOUS = ['Missing Arm', 'Glass Frame', 'Slow to Mend', 'Mute'];

console.log('DATA.wounds — shape and prices');
t('every wound is a real drawback with text and a category',
  names.filter(n => DATA.drawbacks[n] === undefined || !DATA.drawbackFx[n] || !DATA.drawbackCat[n]), []);
t('minor wounds cost exactly 2 AP',
  names.filter(n => W[n].tier === 'minor' && DATA.drawbacks[n] !== 2), []);
t('moderate wounds cost 3 or 4 AP',
  names.filter(n => W[n].tier === 'moderate' && !(DATA.drawbacks[n] >= 3 && DATA.drawbacks[n] <= 4)), []);
t('there are only two tiers — no Grievous tier (owner decision)',
  [...new Set(names.map(n => W[n].tier))].sort(), ['minor', 'moderate']);
t('the four Grievous drawbacks are NOT wounds — they stay ordinary player drawbacks',
  GRIEVOUS.filter(n => W[n]), []);
t('...and are still on the player-pickable list', GRIEVOUS.filter(n => !DATA.drawbackList.includes(n)), []);

console.log('wound-only entries — DM can impose, player cannot pick');
t('exactly four entries are dmOnly: ' + NEW.join(', '), names.filter(n => W[n].dmOnly).sort(), [...NEW].sort());
t('each is a real drawback, in DATA.drawbacks', NEW.filter(n => DATA.drawbacks[n] === undefined), []);
t('...and NONE is on the player-pickable list (drawbackList)', NEW.filter(n => DATA.drawbackList.includes(n)), []);
t('...while EVERY other drawback still is (drawbackList = drawbacks minus wound-only)',
  Object.keys(DATA.drawbacks).filter(n => !W[n]?.dmOnly && !DATA.drawbackList.includes(n)), []);
t('drawbackList has no duplicates and no unknown names',
  [DATA.drawbackList.length === new Set(DATA.drawbackList).size, DATA.drawbackList.filter(n => DATA.drawbacks[n] === undefined)], [true, []]);
t('the four sit at the END of DATA.drawbacks, in this order (key order is load-bearing)',
  Object.keys(DATA.drawbacks).slice(-4), NEW);
t('wound-only entries carry NO stat cap (an imposed drawback has none, J1) and no class requirement',
  NEW.filter(n => (DATA.drawbackMaxStats || {})[n] || (DATA.drawbackReq || {})[n]), []);
t('prices: Maimed Hand 2, Bad Knee 2, Brittle Bones 2, Withered Arm 4', NEW.map(n => DATA.drawbacks[n]), [2, 2, 2, 4]);

console.log('body locations (slot) — only the arm and the leg can double up');
{
  const bySlot = {};
  names.forEach(n => { if (W[n].slot) (bySlot[W[n].slot] = bySlot[W[n].slot] || []).push(n); });
  const shared = Object.fromEntries(Object.entries(bySlot).filter(([, v]) => v.length > 1).map(([k, v]) => [k, v.sort()]));
  t('slots shared by more than one wound', shared, {
    arm: ['Maimed Hand', 'Trembling Hands', 'Withered Arm'],
    leg: ['Bad Knee', 'Lame', 'Peg Leg'],
  });
}

// ---- event builders ---------------------------------------------------------------------------------------
const award = { type: 'award', amount: 79, seq: 1, label: 'Award' };
const oclass = { type: 'buy', cat: 'oclass', payload: { v: 'Fighter' }, cost: 0, level: 1, seq: 2, label: 'Fighter' };
const imposed = (seq, v) => ({ type: 'buy', cat: 'drawback', payload: { v }, cost: 0, level: 1, seq,
  dmEdit: true, dmId: 'dm', dmLocked: true, dmRemovalCost: 'flat', label: `${v} (DM imposed)` });
const taken = (seq, v) => ({ type: 'buy', cat: 'drawback', payload: { v }, cost: -(DATA.drawbacks[v] || 0), level: 1, seq, label: v });
const run = (evs) => compute(foldBuild(evs));
const onlyDm = (w) => w.filter(x => /only a DM can impose it/.test(x));
const samePlace = (w) => w.filter(x => /both injure the same place/.test(x));

console.log('a wound-only drawback must be DM-imposed');
{
  const imp = run([award, oclass, imposed(3, 'Maimed Hand')]);
  t('imposed: no "only a DM can impose it" block', onlyDm(imp.warnings), []);
  t('imposed: pays no AP and is not counted as chosen', [imp.drawbackAp, imp.remaining], [0, economy([award, oclass, imposed(3, 'Maimed Hand')]).available]);
  const ply = run([award, oclass, taken(3, 'Maimed Hand')]);
  t('CONTROL — the same wound-only drawback player-taken: a hard ⛔', onlyDm(ply.warnings), ['⛔ Maimed Hand: a wound — only a DM can impose it']);
  t('...and the block is the hard kind (starts with ⛔)', onlyDm(ply.warnings).every(x => x.startsWith('⛔')), true);
  t('control: an ordinary reused drawback taken by a player (Lame) is NOT blocked', onlyDm(run([award, oclass, taken(3, 'Lame')]).warnings), []);
  t('control: a reused WOUND is not dmOnly, so a player-taken one is fine (Peg Leg)', onlyDm(run([award, oclass, taken(3, 'Peg Leg')]).warnings), []);
  for (const n of NEW) {
    t(`${n}: imposed is clean, player-taken is blocked`,
      [onlyDm(run([award, oclass, imposed(3, n)]).warnings).length, onlyDm(run([award, oclass, taken(3, n)]).warnings).length], [0, 1]);
  }
}

console.log('one wound per place — a soft warning, never a block');
{
  const w = (...ns) => run([award, oclass, ...ns.map((n, i) => imposed(3 + i, n))]).warnings;
  t('Lame + Peg Leg (both leg) warn once, naming the pair',
    samePlace(w('Lame', 'Peg Leg')), ['Lame and Peg Leg both injure the same place (leg) — a DM normally imposes only one']);
  t('CONTROL — Lame alone does not warn', samePlace(w('Lame')), []);
  t('CONTROL — wounds in DIFFERENT places do not warn (leg, arm, eye, bones)', samePlace(w('Bad Knee', 'Withered Arm', 'One-Eyed', 'Brittle Bones')), []);
  t('Maimed Hand + Withered Arm (both arm) warn', samePlace(w('Maimed Hand', 'Withered Arm')).length, 1);
  t('Trembling Hands + Maimed Hand (both arm) warn', samePlace(w('Trembling Hands', 'Maimed Hand')).length, 1);
  t('three in one place (Lame, Peg Leg, Bad Knee) give ONE warning naming all three', (() => {
    const x = samePlace(w('Lame', 'Peg Leg', 'Bad Knee')); return [x.length, /Lame and Peg Leg and Bad Knee/.test(x[0] || '')];
  })(), [1, true]);
  t('it is SOFT: not a ⛔, because the DM decides', samePlace(w('Lame', 'Peg Leg')).every(x => !x.startsWith('⛔')), true);
  t('it applies to player-taken pairs too (the rule is about the body, not who chose it)',
    samePlace(run([award, oclass, taken(3, 'Lame'), taken(4, 'Peg Leg')]).warnings).length, 1);
  t('an imposed wound plus an UNRELATED ordinary drawback in no slot does not warn', samePlace(w('Lame', 'Mana-Sick')), []);
  t('wounds with no body location (the Afflictions, Frail) never trigger it',
    samePlace(w('Frail', 'Affliction — Clumsy (DEX)', 'Affliction — Feeble (STR)')), []);
  t('Missing Arm is not a wound, so it does not trigger it alongside Withered Arm', samePlace(w('Missing Arm', 'Withered Arm')), []);
  t('neither rule moves any AP: four imposed wounds in four places leave remaining at 79',
    run([award, oclass, imposed(3, 'Bad Knee'), imposed(4, 'Withered Arm'), imposed(5, 'One-Eyed'), imposed(6, 'Brittle Bones')]).remaining, 79);
}

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} passed / ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
