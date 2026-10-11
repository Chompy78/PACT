#!/usr/bin/env node
/**
 * PACT — replaying a character's history never rewrites that history (fix/patch-fold-aliasing).
 *
 * WHY THIS EXISTS. MUT.patch applied a creation patch with a shallow Object.assign, so the build's `armour`, `stats`,
 * `skills`, `traditions`… WERE the patch event's own objects. A later buy mutates the build in place (armour[v]=true,
 * stats[ab]=to, skills.push, d.slots[L-1]=to…), so every fold quietly wrote that purchase back into the stored creation
 * patch. On a locked or sealed character the next save then failed: the server saw a protected event change
 * ("protected event 9 changed" — Wren Ashdown Ch8-12 buying Light armour, 2026-10-11). On an unlocked one the creation
 * record was silently rewritten (Archer's Spellcasting patch, found by the live scan the same day).
 *
 * USAGE:  node testing/scripts/patch-fold-aliasing-ci.mjs   (expect 0 failed)
 */
import path from 'node:path';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const E = await import(path.join(REPO, 'js/engine.js'));
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

// A CharGen-shaped creation: one patch event per field group, as CharGen's slots write them.
const creation = [
  { type: 'buy', cat: 'create', payload: {}, cost: 0 },
  { type: 'buy', cat: 'patch', cost: 0, payload: { patch: { stats: { STR: 8, DEX: 14, CON: 14, INT: 14, WIS: 12, CHA: 12 } } } },
  { type: 'buy', cat: 'patch', cost: 0, payload: { patch: { armour: { light: false, medium: false, heavy: false, shield: false }, wornArmour: '' } } },
  { type: 'buy', cat: 'patch', cost: 0, payload: { patch: { skills: ['Insight'], saves: [], tools: [] } } },
  { type: 'buy', cat: 'patch', cost: 0, payload: { patch: { freeSub: {}, traditions: [{ name: 'Arcane', rank: 1, disciplines: [{ name: 'Wizard', bound: false,
    cantrips: 1, slots: [0, 0, 0, 0, 0, 0, 0, 0, 0], known: [0, 0, 0, 0, 0, 0, 0, 0, 0], pactSlots: 0, arcanum: [0, 0, 0, 0] }] }] } } },
];
// Later purchases that each mutate one of those objects in place.
const later = [
  { type: 'buy', cat: 'armour', payload: { v: 'light' }, cost: 2 },
  { type: 'buy', cat: 'abil', payload: { ab: 'STR', to: 9 }, cost: 1 },
  { type: 'buy', cat: 'skill', payload: { v: 'Stealth' }, cost: 2 },
  { type: 'buy', cat: 'save', payload: { v: 'INT' }, cost: 2 },
  { type: 'buy', cat: 'cantrip', payload: { ti: 0, di: 0, to: 2 }, cost: 5 },
  { type: 'buy', cat: 'slot', payload: { ti: 0, di: 0, L: 1, to: 1 }, cost: 3 },
  { type: 'buy', cat: 'known', payload: { ti: 0, di: 0, L: 1, to: 1 }, cost: 1 },
  { type: 'buy', cat: 'freesub', payload: { cls: 'Wizard', sub: 'Evoker' }, cost: 0 },
];
const LOG = structuredClone(creation.concat(later));
const before = JSON.stringify(LOG);

console.log('\n[patch-fold-aliasing] == replay leaves the log untouched ==');
const b1 = E.foldBuild(LOG);
const b2 = E.foldBuild(LOG);
E.rebuildStateFromEvents && E.rebuildStateFromEvents(LOG);
check('folding twice (and rebuilding state) changes no event', JSON.stringify(LOG) === before);
const changed = LOG.map((e, i) => JSON.stringify(e) !== JSON.stringify(JSON.parse(before)[i]) ? i : null).filter(i => i !== null);
check('no creation patch absorbed a later purchase', changed.length === 0, changed.length ? 'changed: #' + changed.join(', #') : '');

console.log('\n[patch-fold-aliasing] == the purchases still apply ==');
check('Light armour bought', b2.armour.light === true && b1.armour.light === true);
check('STR raised to 9', b2.stats.STR === 9);
check('Stealth learned, Insight kept', b2.skills.includes('Stealth') && b2.skills.includes('Insight'));
check('INT save', b2.saves.includes('INT'));
const d = b2.traditions[0].disciplines[0];
check('cantrips 2, one level-1 slot, one known spell', d.cantrips === 2 && d.slots[0] === 1 && d.known[0] === 1);
check('free subclass recorded', b2.freeSub.Wizard === 'Evoker');

console.log('\n[patch-fold-aliasing] == the price is the same whichever copy is folded ==');
const fresh = E.compute(E.foldBuild(structuredClone(JSON.parse(before)))).total;
const reused = E.compute(E.foldBuild(LOG)).total;
check('compute() total identical on a re-folded log', fresh === reused, `${fresh} vs ${reused}`);

console.log(`\n${fail ? '✗' : '✓'} ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
