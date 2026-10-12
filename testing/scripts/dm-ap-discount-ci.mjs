#!/usr/bin/env node
/**
 * dm-ap-discount-ci.mjs — the gate for js/engine.js's DM AP discount
 * (feat/dm-ap-discount, D-GH-2026-10-13-dm-ap-discount).
 *
 * WHAT IT GUARDS. A DM can take AP off one earlier purchase with a `dmDiscount` event
 * {targetSeq, targetCat, amount}. Owner decision B1: the purchase keeps its FULL price in `spent`
 * ("AP value" — equivalent level and the creation threshold read it), and the discount is AP the
 * character earned, so "AP left" reflects what the player actually paid ("AP paid"). Decision F1: the
 * creation ceiling rises by the discount, like a drawback grant. The discount is its own pool on the
 * build (b.dmDiscount) and survives the campaign's "ignore player AP" switch.
 *
 * The matching rules are pinned because every failure here is silent: a discount landing on the wrong
 * purchase, outliving a correction, or exceeding the price all just show a plausible-looking AP figure.
 *
 * NOT GUARDED HERE: forgery. A player can write any event into their own log; the database refuses a
 * non-DM rise in the discount total (sql/migrations/2026-10-13-dm-ap-discount.sql, tested by the SQL
 * harness), not the engine.
 *
 * Run:  node testing/scripts/dm-ap-discount-ci.mjs     (expect 0 failed; exits non-zero otherwise)
 * Uses only Node built-ins — no npm, no browser, no network.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const E = await import(pathToFileURL(resolve(REPO, 'js/engine.js')).href);
const { activeEvents, economy, foldBuild, compute, earnedWithDm, creationCeiling, rebuildStateFromEvents,
        isUndoBarrier } = E;

let pass = 0, fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};
const disc = (m) => [...m.entries()].sort((a, b) => a[0] - b[0]);

// ---- event builders ------------------------------------------------------------------------------------
const award = { type: 'award', amount: 79, seq: 1, label: 'Award' };
const oclass = { type: 'buy', cat: 'oclass', payload: { v: 'Fighter' }, cost: 0, seq: 2, label: 'Fighter' };
const skill = (seq, v = 'Perception', cost = 4) => ({ type: 'buy', cat: 'skill', payload: { v }, cost, seq, label: 'Skill — ' + v });
const boon = (seq, cost = 25) => ({ type: 'buy', cat: 'boon', payload: { v: 'Boon of Combat Prowess' }, cost, seq, label: 'Boon' });
const draw = (seq) => ({ type: 'buy', cat: 'drawback', payload: { v: 'Lame' }, cost: -4, seq, label: 'Lame' });
const buyoff = (seq, cost = 6) => ({ type: 'buyoff', refVal: 'Lame', cost, seq, label: 'Bought off — Lame' });
let _s = 100;
const dd = (targetSeq, amount, targetCat = 'skill', extra = {}) =>
  ({ type: 'dmDiscount', targetSeq, targetCat, amount, note: 'n', seq: _s++, dmEdit: true, ...extra });

console.log('activeEvents().discounts — matching rules');
t('no log → empty map', disc(activeEvents(null).discounts), []);
t('a discount lands on its target (index 2)', disc(activeEvents([award, oclass, skill(3), dd(3, 2)]).discounts), [[2, 2]]);
t('without the dmEdit stamp it is ignored', disc(activeEvents([award, oclass, skill(3), dd(3, 2, 'skill', { dmEdit: false })]).discounts), []);
t('before its target it is ignored', disc(activeEvents([award, oclass, dd(3, 2), skill(3)]).discounts), []);
t('a wrong category is ignored (cross-check)', disc(activeEvents([award, oclass, skill(3), dd(3, 2, 'boon')]).discounts), []);
t('an unknown seq is ignored', disc(activeEvents([award, oclass, skill(3), dd(9, 2)]).discounts), []);
t('a seq carried by two events is ambiguous → ignored', disc(activeEvents([award, oclass, skill(3), skill(3, 'Stealth'), dd(3, 2)]).discounts), []);
t('a free purchase (cost 0) cannot be discounted', disc(activeEvents([award, oclass, dd(2, 1, 'oclass')]).discounts), []);
t('a non-numeric amount is ignored', disc(activeEvents([award, oclass, skill(3), dd(3, 'x')]).discounts), []);
t('two discounts on one purchase add up', disc(activeEvents([award, oclass, skill(3), dd(3, 1), dd(3, 2)]).discounts), [[2, 3]]);
t('an over-discount is capped at the cost', disc(activeEvents([award, oclass, skill(3), dd(3, 99)]).discounts), [[2, 4]]);
t('a negative correction lowers it', disc(activeEvents([award, oclass, skill(3), dd(3, 3), dd(3, -2)]).discounts), [[2, 1]]);
t('a full reversal removes it', disc(activeEvents([award, oclass, skill(3), dd(3, 3), dd(3, -3)]).discounts), []);
t('a correction never goes below 0', disc(activeEvents([award, oclass, skill(3), dd(3, -5)]).discounts), []);
t('a buy-off (its own AP cost) can be discounted', disc(activeEvents([award, oclass, draw(3), buyoff(4), dd(4, 6, 'buyoff')]).discounts), [[3, 6]]);
t('a DM-removed boon keeps its discount (removal refunds nothing)',
  disc(activeEvents([award, oclass, boon(3), dd(3, 10, 'boon'), { type: 'dmRemoveBoon', refVal: 'Boon of Combat Prowess', seq: 5, dmEdit: true }]).discounts), [[2, 10]]);

console.log('economy() — B1: AP value vs AP paid');
{
  const plain = economy([award, oclass, skill(3)]);
  const e = economy([award, oclass, skill(3), dd(3, 3)]);
  t('spent (AP value) keeps the full price', e.spent, plain.spent);
  t('apValue === spent', e.apValue, e.spent);
  t('discounted', e.discounted, 3);
  t('apPaid = spent − discounted', e.apPaid, plain.spent - 3);
  t('earned rises by the discount', e.earned, plain.earned + 3);
  t('available (AP left) rises by the discount', e.available, plain.available + 3);
  t('per-purchase list', e.discounts, [{ index: 2, seq: 3, cat: 'skill', label: 'Skill — Perception', cost: 4, discount: 3 }]);
  t('no discounts → the new fields are zero/empty', [plain.discounted, plain.apPaid === plain.spent, plain.discounts], [0, true, []]);
}

console.log('foldBuild() / compute() — the discount is its own pool');
{
  const log = [award, oclass, skill(3), dd(3, 3)];
  const b = foldBuild(log), b0 = foldBuild([award, oclass, skill(3)]);
  t('b.budget stays awards-only', b.budget, b0.budget);
  t('b.dmDiscount carries it', b.dmDiscount, 3);
  const r = compute(b), r0 = compute(b0);
  t('spendable rises by the discount', r.spendable, r0.spendable + 3);
  t('compute() reports dmDiscountAp', r.dmDiscountAp, 3);
  t('total (AP value) is unchanged', r.total, r0.total);
  const ri = compute(b, { ignorePlayerAp: true }), ri0 = compute(b0, { ignorePlayerAp: true });
  t('ignorePlayerAp keeps the discount', ri.spendable, ri0.spendable + 3);
  t('earnedWithDm keeps it under ignorePlayerAp', earnedWithDm(economy(log), { ignorePlayerAp: true }), earnedWithDm(economy([award, oclass, skill(3)]), { ignorePlayerAp: true }) + 3);
  t('earnedWithDm includes it otherwise (equivalent level rises)', earnedWithDm(economy(log), {}), earnedWithDm(economy([award, oclass, skill(3)]), {}) + 3);
  const rs = rebuildStateFromEvents(null, log), rs0 = rebuildStateFromEvents(null, [award, oclass, skill(3)]);
  t('rebuildStateFromEvents agrees with foldBuild', [rs.build.dmDiscount, rs.budget, rs.result.spendable], [3, rs0.budget, rs0.result.spendable + 3]);
}

console.log('creationCeiling() — F1: the discount raises the ceiling');
{
  const cfg = { type: 'creationLockConfig', payload: { auto: true, threshold: 79 }, seq: 0, noLock: true };
  const c0 = creationCeiling([cfg, award, oclass, skill(3)]);
  const c = creationCeiling([cfg, award, oclass, skill(3), dd(3, 3)]);
  t('discountBonus', c.discountBonus, 3);
  t('ceiling rises by it', c.ceiling, c0.ceiling + 3);
  t('spent is unchanged (full price)', c.spent, c0.spent);
}

console.log('undo barrier');
t('a discount is an undo barrier (dmEdit)', isUndoBarrier(dd(3, 1)), true);

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} passed / ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
