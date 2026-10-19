#!/usr/bin/env node
/**
 * PACT — "Worn armour — none" means unarmoured AC (fix/worn-armour-none, rules v0.376).
 *
 * WHY THIS EXISTS. When no armour was picked, compute() used to fall back to the best armour the character was
 * TRAINED in (heavy 18, medium 13 + Dex up to 2, light 11 + Dex), while both tools label that choice
 * "none / unarmoured (10 + Dex)" and the history says "Worn armour — none (unarmoured)". The sheet and its own history
 * disagreed. Training lets you wear armour; only the armour you actually wear sets your AC.
 *
 * Extended by feat/livesheet-armour-ac (rules v0.377): shield in hand (shieldWorn), Mage Armor, and the class
 * unarmoured formulas (Barbarian / Monk Unarmored Defense, Draconic Resilience) — best formula wins.
 *
 * USAGE:  node testing/scripts/worn-armour-ac-ci.mjs   (expect 0 failed)
 */
import path from 'node:path';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const E = await import(path.join(REPO, 'js/engine.js'));
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

// DEX 14 (+2), STR 16: every armour category is usable.
const base = [
  { type: 'buy', cat: 'create', payload: {}, cost: 0 },
  { type: 'buy', cat: 'patch', cost: 0, payload: { patch: { stats: { STR: 16, DEX: 14, CON: 12, INT: 10, WIS: 10, CHA: 10 } } } },
];
const armour = (light, medium, heavy, shield, worn) => ({ type: 'buy', cat: 'patch', cost: 0,
  payload: { patch: { armour: { light, medium, heavy, shield }, wornArmour: worn } } });
const ac = log => E.compute(E.foldBuild(structuredClone(log))).ac;

check('untrained, nothing worn: 10 + Dex', ac([...base, armour(false, false, false, false, '')]) === 12);
check('light-trained, nothing worn: still 10 + Dex', ac([...base, armour(true, false, false, false, '')]) === 12);
check('heavy-trained, nothing worn: still 10 + Dex', ac([...base, armour(true, true, true, false, '')]) === 12);
check('no wornArmour field at all (old saves): 10 + Dex', ac([...base, { type: 'buy', cat: 'patch', cost: 0,
  payload: { patch: { armour: { light: false, medium: true, heavy: false, shield: false } } } }]) === 12);
check('wearing Leather (light 11): 11 + Dex', ac([...base, armour(true, false, false, false, 'Leather')]) === 13);
check('shield still adds 2 when nothing is worn', ac([...base, armour(true, false, false, true, '')]) === 14);
// The Live Sheet's free "Worn armour" pick flips it both ways.
const lightBuy = [...base, armour(false, false, false, false, ''), { type: 'buy', cat: 'armour', payload: { v: 'light' }, cost: 2 }];
check('buying light training alone does not change AC', ac(lightBuy) === 12);
const wear = [...lightBuy, { type: 'buy', cat: 'wornArmour', payload: { v: 'Studded Leather' }, cost: 0 }];
check('then wearing Studded Leather: 12 + Dex', ac(wear) === 14);
check('then taking it off again: back to 10 + Dex', ac([...wear, { type: 'buy', cat: 'wornArmour', payload: { v: '' }, cost: 0 }]) === 12);

// ---- feat/livesheet-armour-ac (rules v0.377): shield in hand, Mage Armor, and class unarmoured formulas ----
// All three are free choices recorded as cost-0 LOG events, so they sync and the DM sees them.
const shieldBuy = [...base, armour(true, false, false, false, ''), { type: 'buy', cat: 'armour', payload: { v: 'shield' }, cost: 2 }];
check('shield training with no shieldWorn event (every pre-v0.377 save): carried, +2', ac(shieldBuy) === 14);
const down = [...shieldBuy, { type: 'buy', cat: 'shieldWorn', payload: { v: false }, cost: 0 }];
check('shieldWorn false: shield set down, 10 + Dex', ac(down) === 12);
check('shieldWorn true again: +2 back', ac([...down, { type: 'buy', cat: 'shieldWorn', payload: { v: true }, cost: 0 }]) === 14);
check('shieldWorn true WITHOUT shield training gives nothing', ac([...base, armour(false, false, false, false, ''), { type: 'buy', cat: 'shieldWorn', payload: { v: true }, cost: 0 }]) === 12);
check('the shieldWorn and wornArmour events are free (priceOf 0)', E.priceOf(E.foldBuild(structuredClone(shieldBuy)), 'shieldWorn', { v: false }) === 0
  && E.priceOf(E.foldBuild(structuredClone(shieldBuy)), 'wornArmour', { v: E.MAGE_ARMOR }) === 0);
const mage = [...shieldBuy, { type: 'buy', cat: 'wornArmour', payload: { v: E.MAGE_ARMOR }, cost: 0 }];
check('Mage Armor picked: 13 + Dex, shield still allowed', ac(mage) === 17);
check('Mage Armor is unarmoured: no proficiency or STR warning', !E.compute(E.foldBuild(structuredClone(mage))).warnings.some(w => /Mage Armor/.test(w)));
// Barbarian Unarmored Defense: CON 12 -> +1. Anders Pipeleaf's live shape (DEX 16, CON 12, light-trained, the feature bought, then
// "Worn armour — none"): 13 under v0.376, 14 now.
const anders = [
  { type: 'buy', cat: 'create', payload: {}, cost: 0 },
  { type: 'buy', cat: 'patch', cost: 0, payload: { patch: { stats: { STR: 8, DEX: 16, CON: 12, INT: 8, WIS: 10, CHA: 12 }, hd: 6 } } },
  { type: 'buy', cat: 'patch', cost: 2, payload: { patch: { armour: { light: true, medium: false, heavy: false, shield: false }, wornArmour: '' } } },
  { type: 'buy', cat: 'wornArmour', payload: { v: 'Studded Leather' }, cost: 0 },
  { type: 'buy', cat: 'feature', payload: { v: 'Barbarian: Unarmored Defense' }, cost: 6 },
];
check('Barbarian UD while wearing Studded Leather: armour wins (12 + 3)', ac(anders) === 15);
const andersBare = [...anders, { type: 'buy', cat: 'wornArmour', payload: { v: '' }, cost: 0 }];
check('Anders-shaped: Barbarian UD, nothing worn = 10 + Dex 3 + Con 1', ac(andersBare) === 14);
check('acInfo names the formula used', E.compute(E.foldBuild(structuredClone(andersBare))).acInfo.src === 'Unarmored Defense (Barbarian)');
const monk = [...base, armour(false, false, false, true, ''), { type: 'buy', cat: 'patch', cost: 0, payload: { patch: { stats: { STR: 10, DEX: 16, CON: 10, INT: 10, WIS: 16, CHA: 10 } } } },
  { type: 'buy', cat: 'feature', payload: { v: 'Monk: Unarmored Defense' }, cost: 5 }];
check('Monk UD with a shield in hand: not applied (10 + 3 + 2)', ac(monk) === 15);
check('...and acInfo says why', E.compute(E.foldBuild(structuredClone(monk))).acInfo.notes.some(n => /shield/.test(n)));
check('Monk UD with the shield set down: 10 + Dex 3 + Wis 3', ac([...monk, { type: 'buy', cat: 'shieldWorn', payload: { v: false }, cost: 0 }]) === 16);
check('buying Monk UD while holding a shield raises no new warning (purchaseLegality stays clean)',
  E.purchaseLegality(E.foldBuild(structuredClone(monk.slice(0, -1))), 'feature', { v: 'Monk: Unarmored Defense' }).hard.length === 0);

// ---- owner decision AP1: Defense Fighting Style, Draconic Resilience HP, the Monk shield nudge ----
const info = log => E.compute(E.foldBuild(structuredClone(log)));
check('Monk with a shield, UD better by more than the shield: a visible nudge', /Set the shield down: Monk Unarmored Defense would give AC 16 \(now 15\)/.test(info(monk).acInfo.nudge || ''), info(monk).acInfo.nudge);
check('no nudge once the shield is down', !info([...monk, { type: 'buy', cat: 'shieldWorn', payload: { v: false }, cost: 0 }]).acInfo.nudge);
const lowWis = [...monk, { type: 'buy', cat: 'patch', cost: 0, payload: { patch: { stats: { STR: 10, DEX: 16, CON: 10, INT: 10, WIS: 12, CHA: 10 } } } }];
check('no nudge when the shield is worth as much (Wis +1 < shield +2)', !info(lowWis).acInfo.nudge && ac(lowWis) === 15);
const defense = [...base, armour(true, false, false, false, ''), { type: 'buy', cat: 'art', payload: { v: 'Defense' }, cost: 12 }];
check('Defense, nothing worn: no bonus', ac(defense) === 12);
check('Defense, wearing Leather: 11 + Dex 2 + 1', ac([...defense, { type: 'buy', cat: 'wornArmour', payload: { v: 'Leather' }, cost: 0 }]) === 14);
check('Defense under Mage Armor: no bonus (not armour)', ac([...defense, { type: 'buy', cat: 'wornArmour', payload: { v: E.MAGE_ARMOR }, cost: 0 }]) === 15);
const fs = [...base, armour(true, false, false, false, 'Leather'), { type: 'buy', cat: 'feature', payload: { v: 'Fighter: Fighting Style' }, cost: 12 },
  { type: 'names', fs: ['Defense'], cost: 0 }];
check('Defense named for a Fighting Style slot, in Leather: +1', ac(fs) === 14 && info(fs).acInfo.defense === 1);
check('a second Defense (art + named style) does not stack', ac([...fs, { type: 'buy', cat: 'art', payload: { v: 'Defense' }, cost: 12 }]) === 14);
const sorc = hd => [{ type: 'buy', cat: 'create', payload: {}, cost: 0 },
  { type: 'buy', cat: 'patch', cost: 0, payload: { patch: { originClass: 'Sorcerer', hd, freeSub: { Sorcerer: 'Draconic Sorcery' }, stats: { STR: 10, DEX: 14, CON: 10, INT: 10, WIS: 10, CHA: 16 } } } }];
const withDR = hd => [...sorc(hd), { type: 'buy', cat: 'subabil', payload: { v: 'Sorcerer|Draconic Sorcery|Draconic Resilience' }, cost: 9 }];
check('Draconic Resilience at 3 Hit Dice: +3 HP', info(withDR(3)).hp - info(sorc(3)).hp === 3 && info(withDR(3)).hpDraconic === 3);
check('...and +1 per Hit Die after (7 HD: +7)', info(withDR(7)).hp - info(sorc(7)).hp === 7);
check('blocked at 2 Hit Dice: no HP, no AC', info(withDR(2)).hp === info(sorc(2)).hp && ac(withDR(2)) === 12);

console.log(`\n${fail ? '✗' : '✓'} ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
