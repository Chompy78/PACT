#!/usr/bin/env node
/**
 * PACT — "Worn armour — none" means unarmoured AC (fix/worn-armour-none, rules v0.376).
 *
 * WHY THIS EXISTS. When no armour was picked, compute() used to fall back to the best armour the character was
 * TRAINED in (heavy 18, medium 13 + Dex up to 2, light 11 + Dex), while both tools label that choice
 * "none / unarmoured (10 + Dex)" and the history says "Worn armour — none (unarmoured)". The sheet and its own history
 * disagreed. Training lets you wear armour; only the armour you actually wear sets your AC.
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

console.log(`\n${fail ? '✗' : '✓'} ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
