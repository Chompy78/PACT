#!/usr/bin/env node
/**
 * dm-unlock-drawback-ci.mjs — the gate for js/engine.js's `activeEvents().unlocked`
 * (feat/dm-unlock-drawback, D-GH-2026-10-04-dm-unlock-drawback).
 *
 * WHAT IT GUARDS. A DM can impose a drawback LOCKED (the player may not buy it off) and later release it
 * with a `dmUnlockDrawback` event. The release is keyed to the SPECIFIC imposed purchase by its `seq`,
 * never by drawback name: a character can hold a player-taken and an imposed purchase of the same name,
 * and an unlock must release exactly the imposed one. The failure mode is silent either way — a
 * name-keyed unlock quietly releases the wrong purchase, a too-loose one releases a lock the DM never
 * lifted — so the matching rules are pinned here rather than trusted.
 *
 * ALSO PINNED: the unlock moves no AP and never alters the build (an unknown-to-the-fold event type must
 * leave totals/warnings/economy untouched), it is an undo barrier that covers the ORIGINAL imposed buy,
 * and the existing FIFO buy-off resolution is unchanged by it.
 *
 * NOT GUARDED, ON PURPOSE: the lock is honoured by the player's own app, not enforced by the server — a
 * hostile owner can forge any of these events in their own stats. That limit is documented in the
 * decision record and tracked as feat/server-enforced-drawback-lock.
 *
 * Run:  node testing/scripts/dm-unlock-drawback-ci.mjs     (expect 0 failed; exits non-zero otherwise)
 * Uses only Node built-ins — no npm, no browser, no network.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const E = await import(pathToFileURL(resolve(REPO, 'js/engine.js')).href);
const { activeEvents, economy, rebuildStateFromEvents, isUndoBarrier, undoFloor } = E;

let pass = 0, fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};
const idx = (set) => [...set].sort((a, b) => a - b);

// ---- event builders ------------------------------------------------------------------------------------
const award = { type: 'award', amount: 79, seq: 1, label: 'Award' };
const oclass = { type: 'buy', cat: 'oclass', payload: { v: 'Fighter' }, cost: 0, seq: 2, label: 'Fighter' };
const taken = (seq, v = 'Peg Leg') => ({ type: 'buy', cat: 'drawback', payload: { v }, cost: -4, seq, label: 'taken ' + v });
const imposed = (seq, v = 'Peg Leg', locked = true) =>
  ({ type: 'buy', cat: 'drawback', payload: { v }, cost: 0, seq, dmEdit: true, dmLocked: locked, dmRemovalCost: 'flat', label: 'imposed ' + v });
const unlock = (targetSeq, v = 'Peg Leg', extra = {}) =>
  ({ type: 'dmUnlockDrawback', refVal: v, targetSeq, note: 'the beat', seq: 99, dmEdit: true, ...extra });
const buyoff = (v = 'Peg Leg', cost = 12) => ({ type: 'buyoff', refVal: v, cost, seq: 98, label: 'buyoff' });

console.log('activeEvents().unlocked — matching rules');
t('no log → empty set', idx(activeEvents(null).unlocked), []);
t('no unlock event → empty set', idx(activeEvents([award, oclass, imposed(3)]).unlocked), []);
t('an unlock releases the imposed locked purchase (index 2)',
  idx(activeEvents([award, oclass, imposed(3), unlock(3)]).unlocked), [2]);
t('an unlock WITHOUT the dmEdit stamp is ignored',
  idx(activeEvents([award, oclass, imposed(3), unlock(3, 'Peg Leg', { dmEdit: false })]).unlocked), []);
t('an unlock that comes BEFORE its target is ignored',
  idx(activeEvents([award, oclass, unlock(3), imposed(3)]).unlocked), []);
t('an unlock naming the wrong drawback is ignored',
  idx(activeEvents([award, oclass, imposed(3), unlock(3, 'Lame')]).unlocked), []);
t('an unlock targeting the wrong seq is ignored',
  idx(activeEvents([award, oclass, imposed(3), unlock(7)]).unlocked), []);
t('an unlock of an imposed-but-UNLOCKED drawback is ignored (nothing to release)',
  idx(activeEvents([award, oclass, imposed(3, 'Peg Leg', false), unlock(3)]).unlocked), []);
t('an unlock never releases a player-taken purchase, even at the same seq',
  idx(activeEvents([award, oclass, taken(3), unlock(3)]).unlocked), []);

console.log('same-named purchases — the case seq-keying exists for');
{
  const log = [award, oclass, taken(3), imposed(4), unlock(4)];
  t('player-taken (idx 2) + imposed (idx 3): only the IMPOSED one is released',
    idx(activeEvents(log).unlocked), [3]);
}
t('two imposed purchases sharing seq+name are ambiguous: NOTHING is released (fail-safe)',
  idx(activeEvents([award, oclass, imposed(3), imposed(3), unlock(3)]).unlocked), []);
t('two different imposed purchases: unlocking one leaves the other locked',
  idx(activeEvents([award, oclass, imposed(3), imposed(4), unlock(3)]).unlocked), [2]);

console.log('the unlock changes nothing but that set');
{
  const base = [award, oclass, imposed(3)];
  const withUnlock = base.concat([unlock(3)]);
  t('economy() is identical with and without the unlock',
    JSON.stringify(economy(withUnlock)), JSON.stringify(economy(base)));
  const a = rebuildStateFromEvents({}, base), b = rebuildStateFromEvents({}, withUnlock);
  t('rebuildStateFromEvents total is identical', b.total, a.total);
  t('rebuildStateFromEvents warnings are identical', b.warnings, a.warnings);
  t('the build still holds the drawback (an unlock does not remove it)', b.ok === a.ok, true);
}

console.log('FIFO buy-off resolution is untouched');
{
  // player-taken first (idx 2), imposed second (idx 3), unlock, then one buy-off of that name: the engine
  // cancels the OLDEST open purchase — the player-taken one — and leaves the imposed one open AND unlocked.
  const ae = activeEvents([award, oclass, taken(3), imposed(4), unlock(4), buyoff()]);
  t('buy-off still cancels the oldest purchase (idx 2)', idx(ae.boughtOff), [2]);
  t('the imposed purchase stays open and unlocked (idx 3)', idx(ae.unlocked), [3]);
}

console.log('undo barrier');
t('the unlock event is an undo barrier', isUndoBarrier(unlock(3)), true);
{
  const log = [award, oclass, imposed(3), unlock(3)];
  t('undoFloor covers the whole log, so the ORIGINAL imposed buy cannot be undone past the unlock',
    undoFloor(log), log.length);
}

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} passed / ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
