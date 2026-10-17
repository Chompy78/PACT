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

// ---- the gate (feat/names-before-spending) ----
const ev = (n, o) => Object.assign({ seq: n, ts: n }, o);
const award = ev(1, { type: 'award', amount: 300, label: 'Award' });
const draftLog = [award, ev(2, { type: 'buy', cat: 'oclass', payload: { v: 'Warlock' }, cost: 0, level: 1, label: 'Origin class' })];
const lockedLog = [...draftLog, ev(3, { type: 'creationLocked', rules: 'v0', label: 'Finish creating' })];
check('fixture: the draft log is a draft, the locked one is locked', E.isCreationDraft(draftLog) && !E.isCreationDraft(lockedLog));

const blankBuild = E.foldBuild(lockedLog);   // one blank language slot
const g1 = E.namesGate(lockedLog, blankBuild, {});
check('locked + a blank slot + no rules: blocked, on by default (D1/E2/J1)', g1.blocked === true && g1.missing.length === 1 && g1.first.key === 'lang::0');
check('the refusal names the slot and points at the dialog', /Language 1 is still blank/.test(g1.reason) && /Name spells & languages/.test(g1.reason), g1.reason);
check('a campaign that set nothing about it: still on', E.namesGate(lockedLog, blankBuild, { rules: { languages: { list: [] } } }).blocked);
check('rules.requireNames === false switches it off', !E.namesGate(lockedLog, blankBuild, { rules: { requireNames: false } }).blocked);
check('rules.requireNames === true / missing is on', E.requireNamesOn({ requireNames: true }) && E.requireNamesOn({}) && E.requireNamesOn(undefined) && E.requireNamesOn(null));
check('only an explicit false turns it off (0, "", null do not)', [0, '', null, 'false'].every(v => E.requireNamesOn({ requireNames: v })));
check('before the lock: never blocked (players name at the end)', !E.namesGate(draftLog, E.foldBuild(draftLog), {}).blocked);
const namedBuild = E.foldBuild(lockedLog); namedBuild.languageNames = ['Common'];
check('locked + everything named: not blocked', !E.namesGate(lockedLog, namedBuild, {}).blocked);
check('the kinds list is honoured (CharGen skipping Arcanum, N1)', !E.namesGate(lockedLog, blankBuild, { kinds: ['arcanum'] }).blocked);
check('an empty pool lets a blank slot through (I1)', !E.namesGate(lockedLog, blankBuild, { poolSize: () => 0 }).blocked);
const o2 = E.namesOutstanding(full, {});
check('namesOutstanding ignores the lock and the switch, and counts the rest', o2.blocked && /\(and 8 more\)/.test(o2.reason), o2.reason);
check('a discipline slot is described by its discipline', /Warlock cantrip 2 is still blank/.test(E.namesOutstanding(Object.assign(E.baseBuild(), { languageNames: ['Common'],
  traditions: [{ name: 'Arcane', rank: 1, disciplines: [{ name: 'Warlock', cantrips: 2, cantripNames: ['Eldritch Blast'] }] }] }), {}).reason));

console.log(`${pass} passed, ${fail} failed`);
if (fail) { bad.forEach(m => console.log('  FAIL  ' + m)); process.exit(1); }
