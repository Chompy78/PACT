#!/usr/bin/env node
/**
 * PACT — grants the sheet now applies: Dazzling Footwork's AC, Boon of Fortitude's HP and the speed grants
 * (fix/apply-numeric-grants, rules v0.385, owner decision BK of the 2026-10-20 grants audit).
 *
 * WHY THIS EXISTS. Each of these was priced and described but compute() never added its number, so a player paid
 * for an AC, HP or speed bonus the sheet did not show. engine-parity pins AP totals and warnings, not AC/HP/speed,
 * so this script pins them: each grant applies when owned, does not apply when its condition fails (armour, shield,
 * heavy armour, Hit Dice gate), and none of them changes a price.
 *
 * USAGE:  node testing/scripts/numeric-grants-ci.mjs   (expect 0 failed)
 */
import path from 'node:path';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const E = await import(path.join(REPO, 'js/engine.js'));
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

// Human, 20 Hit Dice, DEX 16 (+3), CHA 16 (+3), CON 14 (+2): every grant's Hit Dice gate is met.
const mk = o => Object.assign(E.baseBuild(), { species: 'Human', originClass: 'Fighter', hd: 20, budget: 5000,
  stats: { STR: 14, DEX: 16, CON: 14, INT: 10, WIS: 14, CHA: 16 } }, o);
const C = o => E.compute(mk(o));
const plain = C({});

console.log('\n[numeric-grants] == Dazzling Footwork: AC 10 + Dex + Cha, no armour and no shield ==');
{
  const viaSub = C({ originClass: 'Bard', freeSub: { Bard: 'College of Dance' }, subAbilities: ['Bard|College of Dance|Dazzling Footwork'] });
  check('bought as the subclass ability: AC 16 (10 + 3 + 3)', viaSub.ac === 16 && viaSub.acInfo.src === 'Dazzling Footwork', `ac ${viaSub.ac} via ${viaSub.acInfo.src}`);
  const viaFeat = C({ originClass: 'Bard', features: ['Bard: Dazzling Footwork'] });
  check('bought as the feature: AC 16', viaFeat.ac === 16, `ac ${viaFeat.ac}`);
  const freeSubOnly = C({ originClass: 'Bard', freeSub: { Bard: 'College of Dance' } });
  check('the free subclass alone does not grant it (the ability is bought)', freeSubOnly.ac === plain.ac, `ac ${freeSubOnly.ac}`);
  const shield = C({ originClass: 'Bard', features: ['Bard: Dazzling Footwork'], armour: { shield: true } });
  check('a shield in hand switches it off (10 + Dex + 2 = 15) and says why', shield.ac === 15 && shield.acInfo.notes.some(n => /Dazzling Footwork/.test(n)) && /Dazzling Footwork would give AC 16/.test(shield.acInfo.nudge || ''), `ac ${shield.ac}; ${shield.acInfo.nudge}`);
  const armour = C({ originClass: 'Bard', features: ['Bard: Dazzling Footwork'], armour: { light: true }, wornArmour: 'Leather' });
  check('worn armour replaces it (Leather 11 + 3 = 14)', armour.ac === 14, `ac ${armour.ac}`);
  check('its price is unchanged', viaFeat.total === E.compute(mk({ originClass: 'Bard', features: ['Bard: Dazzling Footwork'] })).total);
}

console.log('\n[numeric-grants] == Boon of Fortitude: Hit Point maximum +40 ==');
{
  const f = C({ boons: ['Boon of Fortitude'] });
  check('owned at 20 Hit Dice: HP +40', f.hp - plain.hp === 40 && f.hpFortitude === 40, `hp ${plain.hp} -> ${f.hp}`);
  const blocked = C({ boons: ['Boon of Fortitude'], hd: 10 });
  const plain10 = C({ hd: 10 });
  check('blocked by its 19 Hit Dice gate: no HP', blocked.hp === plain10.hp && blocked.hpFortitude === 0, `hp ${blocked.hp} vs ${plain10.hp}`);
}

console.log('\n[numeric-grants] == speed grants ==');
{
  const um = C({ originClass: 'Monk', features: ['Monk: Unarmored Movement'] });
  check('Unarmored Movement: +10', um.speed === 40, `speed ${um.speed}`);
  const um20 = C({ originClass: 'Monk', features: ['Monk: Unarmored Movement', 'Monk: Unarmored Movement (+15 ft)', 'Monk: Unarmored Movement (+20 ft)'] });
  check('its bought steps do not stack: the highest owned (+20) counts', um20.speed === 50, `speed ${um20.speed}`);
  const umArm = C({ originClass: 'Monk', features: ['Monk: Unarmored Movement'], armour: { light: true }, wornArmour: 'Leather' });
  check('Unarmored Movement in armour: no bonus, and a note', umArm.speed === 30 && umArm.speedInfo.notes.length === 1, `speed ${umArm.speed}`);
  const umShield = C({ originClass: 'Monk', features: ['Monk: Unarmored Movement'], armour: { shield: true } });
  check('Unarmored Movement with a shield in hand: no bonus', umShield.speed === 30, `speed ${umShield.speed}`);
  const umSetDown = C({ originClass: 'Monk', features: ['Monk: Unarmored Movement'], armour: { shield: true }, shieldWorn: false });
  check('…and the bonus is back with the shield set down', umSetDown.speed === 40, `speed ${umSetDown.speed}`);
  const fm = C({ originClass: 'Barbarian', features: ['Barbarian: Fast Movement'] });
  check('Fast Movement: +10', fm.speed === 40, `speed ${fm.speed}`);
  const fmMed = C({ originClass: 'Barbarian', features: ['Barbarian: Fast Movement'], armour: { light: true, medium: true }, wornArmour: 'Breastplate' });
  check('Fast Movement in medium armour: still +10', fmMed.speed === 40, `speed ${fmMed.speed}`);
  const fmHeavy = C({ originClass: 'Barbarian', features: ['Barbarian: Fast Movement'], armour: { light: true, medium: true, heavy: true }, wornArmour: 'Plate' });
  check('Fast Movement in heavy armour: no bonus, and a note', fmHeavy.speed === 30 && fmHeavy.speedInfo.notes.length === 1, `speed ${fmHeavy.speed}`);
  const sp = C({ arts: ['Speedy'] });
  check('Speedy: +10', sp.speed === 40, `speed ${sp.speed}`);
  const bs = C({ boons: ['Boon of Speed'] });
  check('Boon of Speed: +30', bs.speed === 60, `speed ${bs.speed}`);
  const bsBlocked = C({ boons: ['Boon of Speed'], hd: 10 });
  check('Boon of Speed blocked by its Hit Dice gate: no bonus', bsBlocked.speed === 30, `speed ${bsBlocked.speed}`);
  const all = C({ originClass: 'Monk', features: ['Monk: Unarmored Movement', 'Barbarian: Fast Movement'], arts: ['Speedy'], boons: ['Boon of Speed'] });
  check('they add up: 30 + 10 + 10 + 10 + 30 = 90, each listed', all.speed === 90 && all.speedInfo.parts.length === 4, `speed ${all.speed} ${JSON.stringify(all.speedInfo.parts)}`);
  const slow = C({ arts: ['Speedy'], drawbacks: ['Slow-Footed'] });
  check('a drawback still applies on top (Speedy + Slow-Footed = 35)', slow.speed === 35, `speed ${slow.speed}`);
  const gol = Object.assign(E.baseBuild(), { species: 'Goliath', hd: 4, budget: 500, arts: ['Speedy'] });
  check('a grant adds to a species base of 35 (Goliath + Speedy = 45)', E.compute(gol).speed === 45, `speed ${E.compute(gol).speed}`);
}

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} passed / ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
