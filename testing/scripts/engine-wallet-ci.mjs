#!/usr/bin/env node
/**
 * engine-wallet-ci.mjs — proves js/engine.js's walletState()/walletCheck() are a faithful extraction of the Live Sheet's original wallet logic.
 *
 * WHY. refactor/engine-wallet-check moved the gold-and-downtime wallet (what is left of each currency), the soft shortfall warning and the §16 coin-for-time
 * trade offer out of the Live Sheet and into the engine, so CharGen's after-lock purchases can show the same warning from ONE implementation (plan:
 * docs/plans/2026-10-04-chargen-wallet-warning-q2.md). A move is only safe if nothing changed. The original is kept as a frozen reference
 * (testing/scripts/lib/ls-wallet-reference.js) and compared with the engine over a large seeded sweep: random logs (creation and in-play purchases with frozen
 * gold/downtime, lock states, gold grants, declared downtime windows, buyoffs), every economy setting (off, bands, a customised campaign), active and unconfirmed
 * campaigns, DM gold, party windows and quotes — including the cases the feature is for (short of one currency while rich in the other, both short, neither).
 *
 * Run:  node testing/scripts/engine-wallet-ci.mjs     (expect 0 failed; exits non-zero otherwise)
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '../../js/engine.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const refSrc = readFileSync(join(REPO, 'testing/scripts/lib/ls-wallet-reference.js'), 'utf8');
const ref = new Function('E', refSrc + '\nreturn {_lsWallet,_lsOfferTrade,_lsWalletShort};')(E);

let pass = 0, fail = 0; const mism = [];
const check = (name, ok, d = '') => { ok ? pass++ : (fail++, mism.push(name + (d ? ' — ' + d : ''))); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// seeded PRNG so a failure reproduces
let seed = 20261005; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const AP = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 18, 25, 40];

const logs = [];
for (let n = 0; n < 700; n++) {
  const log = []; let ts = 1000;
  const nBuys = Math.floor(rnd() * 14), lockAt = Math.floor(rnd() * (nBuys + 1)), locked = rnd() < 0.85;
  for (let i = 0; i < nBuys; i++) {
    if (locked && i === lockAt) log.push({ type: 'creationLocked', ts: ts += 10 });
    const ap = pick(AP), cat = rnd() < 0.12 ? 'drawback' : pick(['skill', 'boon', 'hd', 'feature', 'art', 'tool']);
    const ev = { type: 'buy', cat, cost: cat === 'drawback' ? -ap : ap, payload: { v: 'x' + i }, ts: ts += 10 };
    if (rnd() < 0.7) { ev.gp = pick([0, 25, 50, 100, 350, 750]); ev.days = pick([0, 7, 14, 21, 35, 63, 90]); }   // frozen charges (some purchases carry none)
    log.push(ev);
    if (rnd() < 0.12) log.push({ type: 'wealth', payload: { gp: pick([0, 100, 500, 2000]), days: rnd() < 0.5 ? pick([30, 60, 365]) : undefined }, ts: ts += 10 });
    if (rnd() < 0.05 && cat === 'drawback') log.push({ type: 'buyoff', refVal: 'x' + i, cost: 3 * ap, gp: 50, days: 7, ts: ts += 10 });
  }
  if (locked && lockAt >= nBuys) log.push({ type: 'creationLocked', ts: ts += 10 });
  if (rnd() < 0.2) log.splice(Math.floor(rnd() * (log.length + 1)), 0, { type: 'econSetting', payload: { band: pick(['standard', 'fast', 'off']) }, ts: 5 });
  logs.push(log);
}
const SETTINGS = ['off', 'standard', 'fast', { economy: { band: 'standard', rowCosts: { 1: { gp: 10, days: 2 } } } }, { economy: { band: 'fast' } }];
const WINDOWS = [null, { days: 60, startTs: 1000 }, { days: 0, startTs: 0 }, { days: 365, startTs: 5000 }, { days: 14, startTs: 1100 }];

let compared = 0, trades = 0, shorts = 0, bothShort = 0, none = 0;
for (let n = 0; n < 24000; n++) {
  const log = pick(logs), rules = pick(SETTINGS);
  const o = { rules, campaignActive: rnd() < 0.6, campaignWindow: pick(WINDOWS), dmGold: pick([0, 0, 50, 500, 5000]) };
  const quote = rnd() < 0.06 ? null : (rnd() < 0.9 ? E.purchaseCost(pick(AP), rules) : { gp: pick([0, 25, 5000]), days: pick([0, 7, 200]), time: 'x' });
  const eng = E.walletCheck(log, { ...o, quote });
  const w = ref._lsWallet(log, o);
  check(`wallet #${n}`, eq(eng.wallet, w) && eq(E.walletState(log, o), w), `engine ${JSON.stringify(eng.wallet).slice(0, 160)} vs reference ${JSON.stringify(w).slice(0, 160)}`);
  if (quote) {
    const refTrade = ref._lsOfferTrade(log, o, quote);
    const engTrade = eng.trade ? { gp: eng.trade.gp, days: eng.trade.days, time: eng.trade.time, mode: eng.trade.mode } : null;
    check(`trade #${n}`, eq(engTrade, refTrade), `engine ${JSON.stringify(engTrade)} vs reference ${JSON.stringify(refTrade)}`);
    const bits = []; if (eng.shortGold) bits.push('short ' + eng.shortGp.toLocaleString() + ' gp'); if (eng.shortTime) bits.push('short ' + E.formatDowntime(eng.shortDays));
    check(`shortfall text #${n}`, bits.join(' · ') === ref._lsWalletShort(log, o, quote), `engine "${bits.join(' · ')}" vs reference "${ref._lsWalletShort(log, o, quote)}"`);
    if (engTrade) trades++; if (eng.shortGold || eng.shortTime) shorts++; if (eng.shortGold && eng.shortTime) bothShort++; if (!eng.shortGold && !eng.shortTime) none++;
  } else check(`no quote #${n}`, eng.trade === null && !eng.shortGold && !eng.shortTime && eng.shortGp === 0 && eng.shortDays === 0);
  compared++;
}
console.log(`\nengine walletCheck vs the Live Sheet original — ${compared} scenarios (wallet, trade and shortfall text each compared)`);
console.log(`  coverage: ${trades} trade offers, ${shorts} shortfalls (${bothShort} short of both), ${none} fully covered`);
if (mism.length) console.log(mism.slice(0, 12).map(m => '  FAIL  ' + m).join('\n'));
check('the sweep exercised every outcome (trade offers, shortfalls, both-short and fully-covered all occur)', trades > 200 && shorts > 2000 && bothShort > 200 && none > 500, JSON.stringify({ trades, shorts, bothShort, none }));

// the behaviours the feature rests on
const A = { rules: 'standard', campaignActive: true, campaignWindow: { days: 60, startTs: 0 }, dmGold: 0 };
const locked = [{ type: 'creationLocked', ts: 1 }];
const q6 = E.purchaseCost(6, 'standard');   // 100 gp / 21 days
check('a locked character with no gold is short of the whole gold price and covered for time', (() => { const c = E.walletCheck(locked, { ...A, quote: q6 }); return c.shortGold && !c.shortTime && c.shortGp === 100; })());
check('DM-held gold that covers the price removes the shortfall (the false-shortfall case)', (() => { const c = E.walletCheck(locked, { ...A, dmGold: 100, quote: q6 }); return !c.shortGold && !c.shortTime; })());
check('an UNCONFIRMED campaign never composes the server inputs (no false zero, no phantom gold)', (() => { const c = E.walletCheck(locked, { ...A, campaignActive: false, dmGold: 1000, campaignWindow: { days: 365, startTs: 0 }, quote: q6 }); return c.wallet.gpLeft === 0 && c.wallet.windowDays === 0; })());
check('a trade is offered when short of downtime but rich in gold, and it closes', (() => { const c = E.walletCheck(locked, { ...A, dmGold: 5000, campaignWindow: { days: 10, startTs: 0 }, quote: q6 }); return c.shortTime && !c.shortGold && c.trade && c.trade.mode === 'goldForTime' && c.trade.days === Math.floor(21 / 2) ; })());
check('no trade when both currencies are short', E.walletCheck(locked, { ...A, campaignWindow: { days: 1, startTs: 0 }, quote: q6 }).trade === null);
check('no trade when the traded price would not close either', (() => { const c = E.walletCheck(locked, { ...A, campaignWindow: { days: 60, startTs: 0 }, quote: q6 }); return c.shortGold && c.trade === null; })());

console.log(`\n✓ ${pass} passed / ${fail} failed\n`);
process.exit(fail ? 1 : 0);
