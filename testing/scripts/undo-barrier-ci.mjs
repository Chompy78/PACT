#!/usr/bin/env node
/**
 * undo-barrier-ci.mjs — the gate for js/engine.js's isUndoBarrier()/undoFloor()
 * (feat/undo-barrier-shared, step 1 of the session-seal work).
 *
 * WHY THIS EXISTS. The rule these two functions state — "history at or before the last barrier can no
 * longer be taken back" — had been hand-written three times, once per tool, and two of the three copies
 * were wrong in different directions: CharGen's undo() checked only `dmEdit` while claiming in its own
 * comment to mirror the Live Sheet's award barrier, and NEITHER tool treated `creationLocked` as a
 * barrier, so the "Finish creating" dialog's promise that only a DM can reopen creation was false in
 * both. Centralising the rule is only half a fix; this is the half that keeps it correct, because the
 * failure mode is silent — nothing crashes when an undo barrier is too weak, a player just quietly
 * erases something their DM did.
 *
 * The CharGen guard is tested here as well as the raw predicate. That tool's undo restores whole earlier
 * SNAPSHOTS of the log rather than popping one event, so "is the tail a barrier?" is not a sufficient
 * question for it: a frame captured before a barrier arrived (a DM edit syncing down mid-session) jumps
 * clean past the barrier. The floor comparison below is the shape that answers both tools.
 *
 * Run:  node testing/scripts/undo-barrier-ci.mjs        (expect 0 failed; exits non-zero otherwise)
 * Uses only Node built-ins — no npm, no browser, no network.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { isUndoBarrier, undoFloor, sealedFloor } = await import(pathToFileURL(resolve(REPO, 'js/engine.js')).href);

let pass = 0, fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};

console.log('undoFloor() — where the history freezes');
t('empty log has no floor', undoFloor([]), 0);
t('a non-array is tolerated, not thrown on', undoFloor(null), 0);
t('ordinary buys are all undoable', undoFloor([{ type: 'buy' }, { type: 'buy' }]), 0);
t('an AP award is a barrier', undoFloor([{ type: 'buy' }, { type: 'award', amount: 5 }]), 2);
t('a DISCRETIONARY award is deliberately not', undoFloor([{ type: 'buy' }, { type: 'award', amount: 5, disc: true }]), 0);
t('a DM edit is a barrier', undoFloor([{ type: 'buy' }, { type: 'buy', dmEdit: true }]), 2);
t('creationLocked is a barrier', undoFloor([{ type: 'buy' }, { type: 'creationLocked' }]), 2);
t('buys made AFTER a barrier stay undoable', undoFloor([{ type: 'buy' }, { type: 'award', amount: 5 }, { type: 'buy' }, { type: 'buy' }]), 2);
t('the LAST barrier sets the floor', undoFloor([{ type: 'award', amount: 1 }, { type: 'buy' }, { type: 'creationLocked' }, { type: 'buy' }]), 3);
t('a later discretionary award cannot lower an existing floor', undoFloor([{ type: 'award', amount: 5 }, { type: 'buy' }, { type: 'award', amount: 2, disc: true }]), 1);
t("a DM boon grant's [buy, award] pair freezes both", undoFloor([{ type: 'buy', cat: 'boon', dmEdit: true }, { type: 'award', amount: 3, dmEdit: true }]), 2);

// A budget award is `noLock` and CharGen RELOCATES it to the log tail on every budget edit. Treating
// it as a barrier put the barrier at the end and killed undo outright, in both tools, permanently.
// CharGen's own comment states the requirement; this is what keeps it true.
t('a noLock budget award is NOT a barrier', undoFloor([{ type: 'buy' }, { type: 'buy' }, { type: 'award', amount: 79, noLock: true }]), 0);
t('...even when it is the only event', undoFloor([{ type: 'award', amount: 79, noLock: true }]), 0);
t('a real award beside a noLock one still sets the floor',
  undoFloor([{ type: 'award', amount: 79, noLock: true }, { type: 'buy' }, { type: 'award', amount: 5 }]), 3);

// creationLocked is a two-state toggle, not a ratchet — _replay() says so and _lockStates() honours it.
t('a reopened creation is undoable again', undoFloor([{ type: 'buy' }, { type: 'creationLocked' }, { type: 'creationUnlocked' }]), 0);
t('...but an unreopened one still locks', undoFloor([{ type: 'buy' }, { type: 'creationLocked' }]), 2);
t('a re-lock after an unlock locks again',
  undoFloor([{ type: 'creationLocked' }, { type: 'creationUnlocked' }, { type: 'buy' }, { type: 'creationLocked' }]), 4);
t('an unlock does not weaken a seal', undoFloor([{ type: 'sessionSeal' }, { type: 'creationUnlocked' }]), 1);

console.log('\nisUndoBarrier() — the predicate itself');
t('a bare buy is not a barrier', isUndoBarrier({ type: 'buy' }), false);
t('null is not a barrier', isUndoBarrier(null), false);
t('rulesSnapshot metadata is not a barrier', isUndoBarrier({ type: 'rulesSnapshot' }), false);
t('dmEdit on any event type is a barrier', isUndoBarrier({ type: 'buyoff', dmEdit: true }), true);

console.log('\nsessionSeal — the boundary the DATABASE also enforces');
t('a seal is an undo barrier', undoFloor([{ type: 'buy' }, { type: 'sessionSeal' }]), 2);
t('a seal is a barrier by type, not by carrying AP', isUndoBarrier({ type: 'sessionSeal' }), true);

// sealedFloor mirrors pact_enforce_locked_history() exactly: the seal half applies to every
// character, the award half only to campaign-bound ones.
console.log('\nsealedFloor() — what the server will actually refuse');
t('a seal counts for a solo character', sealedFloor([{ type: 'buy' }, { type: 'sessionSeal' }, { type: 'buy' }]), 2);
t('an award does NOT count for a solo character', sealedFloor([{ type: 'buy' }, { type: 'award', amount: 5 }]), 0);
t('an award DOES count for a campaign character', sealedFloor([{ type: 'buy' }, { type: 'award', amount: 5 }], { campaignBound: true }), 2);
t('a noLock award is exempt, as the server exempts it', sealedFloor([{ type: 'award', amount: 79, noLock: true }], { campaignBound: true }), 0);
t('a disc award is exempt too', sealedFloor([{ type: 'award', amount: 2, disc: true }], { campaignBound: true }), 0);
t('dmEdit alone is not a server boundary', sealedFloor([{ type: 'buy', dmEdit: true }], { campaignBound: true }), 0);
t('creationLocked is not a server boundary', sealedFloor([{ type: 'creationLocked' }], { campaignBound: true }), 0);
t('the LATER of award and seal wins',
  sealedFloor([{ type: 'award', amount: 5 }, { type: 'buy' }, { type: 'sessionSeal' }, { type: 'buy' }], { campaignBound: true }), 3);
t('...and the seal wins even when the award is later in the log',
  sealedFloor([{ type: 'sessionSeal' }, { type: 'buy' }, { type: 'award', amount: 5 }], { campaignBound: true }), 3);
t('sealedFloor tolerates a non-array', sealedFloor(null), 0);

// The client must never permit LESS than the server refuses, or a save the UI called legal gets
// rejected. undoFloor is deliberately the broader rule, so this must hold for every shape.
console.log('\nsealedFloor <= undoFloor — the client never under-refuses');
[
  ['award then seal', [{ type: 'award', amount: 5 }, { type: 'buy' }, { type: 'sessionSeal' }, { type: 'buy' }]],
  ['seal then award', [{ type: 'sessionSeal' }, { type: 'buy' }, { type: 'award', amount: 5 }]],
  ['creationLocked last', [{ type: 'creationLocked' }, { type: 'sessionSeal' }]],
  ['noLock award only', [{ type: 'award', amount: 79, noLock: true }, { type: 'buy' }]],
  ['disc award only', [{ type: 'award', amount: 2, disc: true }, { type: 'buy' }]],
  ['nothing at all', [{ type: 'buy' }, { type: 'buy' }]],
].forEach(([name, log]) => {
  t(`${name}: server floor never exceeds client floor`,
    sealedFloor(log, { campaignBound: true }) <= undoFloor(log), true);
});

// CharGen restores whole snapshots, so its guard asks: does the frame I am about to restore still
// carry a floor at least as high as the live log's? Mirrors the check in that tool's undo().
console.log('\nCharGen snapshot guard — a frame may never lower the floor');
const guard = (log, frame) => !(frame.length < undoFloor(log) || undoFloor(frame) < undoFloor(log));
const sealed = [{ type: 'buy' }, { type: 'award', amount: 5 }, { type: 'buy' }];
t('a frame that keeps the barrier is allowed', guard(sealed, [{ type: 'buy' }, { type: 'award', amount: 5 }]), true);
t('a stale pre-barrier frame is refused', guard(sealed, [{ type: 'buy' }]), false);
t('a same-length frame that lost the barrier is refused', guard(sealed, [{ type: 'buy' }, { type: 'buy' }]), false);
t('an unsealed log lets every frame through', guard([{ type: 'buy' }, { type: 'buy' }], [{ type: 'buy' }]), true);

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
