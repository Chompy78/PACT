/* PACT — the shared appearance writer and the one-time notes copy-in (fix/livesheet-name-description-notes).
 * Pure functions in js/ui-helpers.js, loaded here in a vm (no browser):
 *   pactWithAppearance(log, merged, opts)  — the ONE writer both tools use for b.appearance
 *   pactNotesCopyInPlan(appearance, mine, other, otherName) — which device-local notes to copy into the LOG once
 * Plus a JS port of the server's protected projection (sql/migrations/2026-10-05-server-freeze-d2-e1-stage1.sql,
 * permanent exempt list only = stage 2) to show a rewrite/insert leaves the protected list identical. The real-Postgres
 * proof of the same thing is in testing/scripts/creation-lock-guard-test/freeze-cases.sql ("notes:" cases).
 *
 *   node testing/scripts/appearance-notes-ci.mjs   (expect 0 failed)
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const store = {};
const ctx = { localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } }, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(REPO, 'js/ui-helpers.js'), 'utf8'), ctx);
const { pactWithAppearance, pactNotesCopyInPlan, pactAppearanceIndex, pactSheetScratch } = ctx;

let pass = 0, fail = 0;
const J = x => JSON.stringify(x);
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

// --- JS port of pact_ap_ledger_protected() at stage 2 (exempt: appearance, houseRules, gold) ---
const EXEMPT = ['appearance', 'houseRules', 'gold'];
const strip = (e, ks) => { const o = { ...e }; ks.forEach(k => delete o[k]); return o; };
function projection(ev) {
  const p = ev.payload && ev.payload.patch;
  const obj = (p && typeof p === 'object' && !Array.isArray(p)) ? p : {};
  const keep = {}; let n = 0;
  Object.keys(obj).forEach(k => { if (!EXEMPT.includes(k)) { keep[k] = obj[k]; n++; } });
  return n ? { type: ev.type, cat: ev.cat, cost: ev.cost, gp: ev.gp, days: ev.days, patch: keep } : null;
}
function ledgerProtected(log) {
  return (log || []).flatMap(ev => {
    const t = ev.type;
    if (['buyoff', 'names', 'award', 'sessionSeal', 'dmRemoveBoon', 'dmUnlockDrawback'].includes(t)) return [strip(ev, ['seq', 'ts', 'rules', 'label'])];
    if (t === 'buy' && (ev.cat || '') !== 'patch') return [strip(ev, ['seq', 'ts', 'rules', 'label'])];
    if (t === 'buy' && ev.cat === 'patch') { const pr = projection(ev); return pr ? [pr] : []; }
    return [];
  });
}
const lockFamily = log => (log || []).filter(e => ['creationLocked', 'creationUnlocked', 'creationLockConfig'].includes(e.type)).map(e => strip(e, ['seq', 'ts', 'rules', 'label']));

console.log('pactWithAppearance — the shared writer');
const bundle = { seq: 3, ts: 1, type: 'buy', cat: 'patch', cost: 7, label: 'Imported build', rules: 'v0.1',
  payload: { patch: { hd: 3, profBonus: 2, appearance: { eyes: 'blue', playerSheet: { coins: { gp: 5 } } } } } };
const LOCKED = [
  { seq: 1, type: 'creationLockConfig', payload: { threshold: 80 } },
  { seq: 2, type: 'buy', cat: 'skill', cost: 1, payload: { v: 'Stealth' } },
  bundle,
  { seq: 4, type: 'creationLocked' },
  { seq: 5, type: 'award', amount: 6, dmEdit: true },
  { seq: 6, type: 'sessionSeal', dmEdit: true },
];
const before = J(LOCKED);
const merged = { eyes: 'blue', playerSheet: { coins: { gp: 5 } }, backstory: 'Born in a storm.', alignment: 'NG' };
const out = pactWithAppearance(LOCKED, merged, { ts: 99, rules: 'v9' });
check('never mutates its input', J(LOCKED) === before);
check('rewrites in place: same length, same index', out.length === LOCKED.length && pactAppearanceIndex(out) === 2);
check('keeps seq, cost, label, rules and every other patch key of a bundle event',
  out[2].seq === 3 && out[2].cost === 7 && out[2].label === 'Imported build' && out[2].rules === 'v0.1' && out[2].payload.patch.hd === 3 && out[2].payload.patch.profBonus === 2,
  J(out[2]));
check('writes the merged appearance (deep-cloned, not aliased)', J(out[2].payload.patch.appearance) === J(merged) && out[2].payload.patch.appearance !== merged);
check('a bundle rewrite leaves the server-protected list byte-identical', J(ledgerProtected(out)) === J(ledgerProtected(LOCKED)));
check('…and the creation-lock family identical', J(lockFamily(out)) === J(lockFamily(LOCKED)));

const two = [
  { seq: 1, type: 'buy', cat: 'patch', cost: 0, _slot: 'appearance', payload: { patch: { appearance: { eyes: 'old' } } } },
  { seq: 2, type: 'buy', cat: 'skill', cost: 1, payload: { v: 'Arcana' } },
  { seq: 3, type: 'buy', cat: 'patch', cost: 0, payload: { patch: { appearance: { eyes: 'new' } } } },
];
const o2 = pactWithAppearance(two, { eyes: 'x' }, { ts: 5 });
check('targets the LAST of two appearance events (the one foldBuild reads)', o2[2].payload.patch.appearance.eyes === 'x' && o2[0].payload.patch.appearance.eyes === 'old');
check('does not add a _slot to an untagged event it rewrites, nor remove one', !('_slot' in o2[2]) && o2[0]._slot === 'appearance');

const none = [{ seq: 1, type: 'creationLockConfig', payload: { threshold: 80 } }, { seq: 2, type: 'buy', cat: 'skill', cost: 1, payload: { v: 'Stealth' } }, { seq: 3, type: 'creationLocked' }, { seq: 4, type: 'sessionSeal', dmEdit: true }];
const o3 = pactWithAppearance(none, { backstory: 'b' }, { seq: 9, ts: 7, rules: 'v9' });
check('inserts at index 0 when there is none', o3.length === 5 && pactAppearanceIndex(o3) === 0 && J(o3.slice(1)) === J(none));
check('…tagged _slot:appearance, cost 0, seq/ts/rules from opts',
  o3[0]._slot === 'appearance' && o3[0].cost === 0 && o3[0].seq === 9 && o3[0].ts === 7 && o3[0].rules === 'v9' && o3[0].type === 'buy' && o3[0].cat === 'patch');
check('an index-0 insert leaves the server-protected list and lock family identical',
  J(ledgerProtected(o3)) === J(ledgerProtected(none)) && J(lockFamily(o3)) === J(lockFamily(none)));
check('an empty log gets one appearance event', J(pactWithAppearance([], { a: '1' }, { seq: 1 }).map(e => e.payload.patch.appearance)) === J([{ a: '1' }]));

console.log('\npactNotesCopyInPlan — one-time copy-in');
check('nothing local → null', pactNotesCopyInPlan({}, null, null) === null);
check('one bucket → its values, mapped to the LOG keys (bg→background, notes→backstory)',
  J(pactNotesCopyInPlan({}, { playerName: 'Sam', bg: 'Sage', notes: 'Long story' }, null)) === J({ playerName: 'Sam', background: 'Sage', backstory: 'Long story' }));
check('a key already in the LOG is never touched — even an empty string (the player cleared it)',
  pactNotesCopyInPlan({ backstory: '', playerName: 'Kept' }, { notes: 'old', playerName: 'Sam' }, null) === null);
check('both buckets equal → one value', J(pactNotesCopyInPlan({}, { alignment: 'NG' }, { alignment: ' NG ' })) === J({ alignment: 'NG' }));
check('both different (short field) → both kept, current tool first, " / "', pactNotesCopyInPlan({}, { alignment: 'NG' }, { alignment: 'LG' }).alignment === 'NG / LG');
const long = pactNotesCopyInPlan({}, { notes: 'A' }, { notes: 'B' }, 'Character Creator').backstory;
check('both different (textarea) → both kept with a labelled separator', long === 'A\n\n— also saved in the Character Creator on this device —\nB', J(long));
check('whitespace-only local values are ignored', pactNotesCopyInPlan({}, { notes: '   ', allies: '\n' }, { playerName: '  ' }) === null);
check('only the five note fields are copied (spell trackers etc. stay local)', J(pactNotesCopyInPlan({}, { spelllist: 'Shield', slot_L1: '2/2', allies: 'Guild' }, null)) === J({ allies: 'Guild' }));
const sep = 'X / Y\n\n— also saved in the Live Sheet on this device —\nZ';
check('a value that already contains " / " or the separator is copied verbatim, never re-split',
  J(pactNotesCopyInPlan({}, { alignment: 'NG / LG', notes: sep }, null)) === J({ alignment: 'NG / LG', backstory: sep }));
check('…and a second run after it landed copies nothing (idempotent)', pactNotesCopyInPlan({ alignment: 'NG / LG', backstory: sep }, { alignment: 'NG / LG', notes: sep }, null) === null);

console.log('\npactSheetScratch — reads either tool’s pre-fix local store');
store['pactCharSheetManual:chargen'] = JSON.stringify({ 'id-1': { notes: 'cg' } });
store['pactCharSheetManual:livesheet'] = '{not json';
check('reads a record by id', J(pactSheetScratch('chargen', 'id-1')) === J({ notes: 'cg' }));
check('missing id / bad JSON → null, never throws', pactSheetScratch('chargen', 'nope') === null && pactSheetScratch('livesheet', 'id-1') === null);

console.log(`\n${fail ? '✗' : '✓'} ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
