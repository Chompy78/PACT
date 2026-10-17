#!/usr/bin/env node
/**
 * names-slots-ci.mjs — pins js/engine.js's allNameableSlots() / unnamedChoices() (refactor/names-slot-helper).
 *
 * The ✎ Name spells & languages dialogs and the names-before-spending gate (docs/plans/2026-10-15-names-before-spending.md)
 * both read this one list of "the language and spell slots a character owns". This pins its shape: the slot order the
 * dialogs show, the `data-k` keys saveNames() reads, the blank test, the kinds filter and the empty-pool skip (decision I1).
 * The dialogs' rows are checked against the helper in a real browser by names-dialog-e2e.mjs.
 *
 * Run:  node testing/scripts/names-slots-ci.mjs     (expect 0 failed; exits non-zero otherwise)
 */
import * as E from '../../js/engine.js';

let pass = 0, fail = 0; const bad = [];
const check = (name, ok, d = '') => { ok ? pass++ : (fail++, bad.push(name + (d ? ' — ' + d : ''))); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const b = E.baseBuild();
check('a fresh build owns exactly one language slot (the dialogs\' b.languages||1)', eq(E.allNameableSlots(b).map(s => s.key), ['lang::0']));
check('a fresh build\'s language slot is blank', E.unnamedChoices(b).length === 1);

const full = E.baseBuild();
Object.assign(full, {
  languages: 3, languageNames: ['Common', '   '],
  dabblerCantrips: 2, dabblerCantripNames: ['Light'],
  innate: [2, 1, 0, 0, 0, 0, 0, 0, 0], innateNames: [['Bless', ''], ['Misty Step']],
  traditions: [{ name: 'Arcane', rank: 9, disciplines: [
    { name: 'Warlock', cantrips: 2, cantripNames: ['Eldritch Blast'], known: [1, 0, 1, 0, 0, 0, 0, 0, 0], knownNames: [['Hex'], [], []],
      arcanum: [1, 0, 0, 1], arcanumNames: [['Mass Suggestion']] },
    { name: '(none)', cantrips: 5 },
    { name: 'Wizard', cantrips: 1, known: [1] },
  ] }],
});
const slots = E.allNameableSlots(full);
check('order: languages, dabbler, innate, then each discipline cantrips, known, arcanum', eq(slots.map(s => s.key), [
  'lang::0', 'lang::1', 'lang::2', 'dab::0', 'dab::1', 'inn::1::0', 'inn::1::1', 'inn::2::0',
  'tr::0::0::c::0', 'tr::0::0::c::1', 'tr::0::0::k::1::0', 'tr::0::0::k::3::0', 'tr::0::0::a::0::0', 'tr::0::0::a::3::0',
  'tr::0::2::c::0', 'tr::0::2::k::1::0']), slots.map(s => s.key).join(' '));
check('a "(none)" discipline contributes no slots', !slots.some(s => s.key.startsWith('tr::0::1::')));
check('kinds are labelled', eq([...new Set(slots.map(s => s.kind))], ['language', 'dabbler', 'innate', 'cantrip', 'known', 'arcanum']));
check('names are carried through, blank as \'\'', slots.find(s => s.key === 'lang::0').name === 'Common' && slots.find(s => s.key === 'lang::2').name === '');
check('labels match the dialog rows', slots.find(s => s.key === 'inn::2::0').label === 'L2 spell 1' && slots.find(s => s.key === 'tr::0::0::a::3::0').label === 'L9 arcanum 1');
check('levels: cantrips 0, known/innate their level, arcanum 6..9', slots.find(s => s.key === 'dab::0').level === 0
  && slots.find(s => s.key === 'tr::0::0::k::3::0').level === 3 && slots.find(s => s.key === 'tr::0::0::a::0::0').level === 6 && slots.find(s => s.key === 'tr::0::0::a::3::0').level === 9);

const blank = E.unnamedChoices(full).map(s => s.key);
check('blank = missing, empty or whitespace-only names', eq(blank, ['lang::1', 'lang::2', 'dab::1', 'inn::1::1', 'tr::0::0::c::1',
  'tr::0::0::k::3::0', 'tr::0::0::a::3::0', 'tr::0::2::c::0', 'tr::0::2::k::1::0']), blank.join(' '));
check('kinds filter: languages only', eq(E.unnamedChoices(full, { kinds: ['language'] }).map(s => s.key), ['lang::1', 'lang::2']));
check('kinds filter: no arcanum', !E.unnamedChoices(full, { kinds: E.NAMEABLE_KINDS.filter(k => k !== 'arcanum') }).some(s => s.kind === 'arcanum'));
check('a slot with an empty pool is skipped (I1)', eq(E.unnamedChoices(full, { poolSize: s => (s.kind === 'known' ? 0 : 5) }).filter(s => s.kind === 'known'), []));
check('a pool callback returning a positive number keeps the slot', E.unnamedChoices(full, { poolSize: () => 3 }).length === blank.length);
check('a pool callback that returns nothing does not hide a blank', E.unnamedChoices(full, { poolSize: () => undefined }).length === blank.length);

const named = E.baseBuild(); named.languageNames = ['Common'];
check('a fully named build has nothing unnamed', E.unnamedChoices(named).length === 0);

console.log(`${pass} passed, ${fail} failed`);
if (fail) { bad.forEach(m => console.log('  FAIL  ' + m)); process.exit(1); }
