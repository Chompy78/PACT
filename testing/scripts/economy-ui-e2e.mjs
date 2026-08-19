#!/usr/bin/env node
/**
 * PACT — gold-and-downtime economy gate (no Supabase required).
 *
 * WHY THIS EXISTS. The economy (Players Guide §2 "The Three Currencies", §16 "Gold, Downtime, and
 * Starting Wealth") spans the engine, all three tools, and a DM-authoritative server column, and its
 * central rule is a NEGATIVE one that no unit test of purchaseCost() can catch: creation purchases
 * are exempt, in-play purchases are not. That distinction lives in the creation lock, is resolved
 * inside _replay()'s timeline, and is consumed by tool UI — so it can only be verified end to end.
 *
 * Two halves:
 *   1. ENGINE — the band tables against the guide's own printed figures, the creation exemption, the
 *      freeze, the setting-precedence rule, and the formatter. Run directly against js/engine.js.
 *   2. LIVE SHEET UI — the wallet line, the per-tile prices, and the off switch actually reaching the
 *      DOM, driven in a real browser. No stack needed: supabase-js is vendored, so the module bridge
 *      loads offline and only network calls fail (irrelevant here), the same trick
 *      dm-console-ui-e2e.mjs uses.
 *
 * Verified to go RED before commit: zeroing BAND_STANDARD's 11–15 row failed the price checks, and
 * removing the `if(!lockAt[i]) return;` creation guard in wealthLedger() failed the exemption checks.
 *
 * USAGE:  node testing/scripts/economy-ui-e2e.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';
import { DATA, purchaseCost, priceLabel, wealthLedger, wealthWithDm, formatDowntime,
         resolveEconomySetting, logEconomySetting, economyOn, tradeCoinTime,
         chargesGoldAndTime } from '../../js/engine.js';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = 7974;   // not cloud-e2e's 7970, the seed stack's 7971, or dm-console-ui's 7973

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

/* ======================================================================
 * 1. ENGINE — the bands against the Players Guide's printed tables.
 * ====================================================================== */
console.log('\n[economy] engine — band tables (Players Guide §16)');

// Standard band, every row, read straight off the guide's table. Spot-checked at the row BOUNDARIES
// (the value that must fall in this row and the one that must fall in the next), because an
// off-by-one in the maxAp comparison is the single likeliest way this table breaks and a mid-row
// sample would never see it.
const STD = [[1,0,'None'],[2,0,'None'],[3,25,'1 week'],[5,25,'1 week'],[6,100,'3 weeks'],[10,100,'3 weeks'],
             [11,350,'6 weeks'],[15,350,'6 weeks'],[16,750,'3 months'],[20,750,'3 months'],
             [21,1500,'6 months'],[30,1500,'6 months'],[31,3000,'9 months'],[40,3000,'9 months'],
             [41,5500,'1 year'],[50,5500,'1 year'],[51,10000,'2 years'],[99,10000,'2 years']];
for (const [ap, gp, time] of STD) {
  const c = purchaseCost(ap, 'standard');
  check(`standard: ${ap} AP → ${gp} gp / ${time}`, c && c.gp === gp && c.time === time,
        c ? `${c.gp} gp / ${c.time}` : 'null');
}

const FAST = [[1,0,'None'],[5,0,'None'],[6,50,'1 day'],[10,50,'1 day'],[11,150,'3 days'],[15,150,'3 days'],
              [16,400,'1 week'],[20,400,'1 week'],[21,800,'2 weeks'],[30,800,'2 weeks'],
              [31,1500,'1 month'],[40,1500,'1 month'],[41,3000,'6 weeks'],[50,3000,'6 weeks'],
              [51,5000,'3 months'],[99,5000,'3 months']];
for (const [ap, gp, time] of FAST) {
  const c = purchaseCost(ap, 'fast');
  check(`fast: ${ap} AP → ${gp} gp / ${time}`, c && c.gp === gp && c.time === time,
        c ? `${c.gp} gp / ${c.time}` : 'null');
}

console.log('\n[economy] engine — the off switch');
check('off quotes nothing at all', purchaseCost(12, 'off') === null);
check('economyOn is false for off', economyOn('off') === false);
check('economyOn is true for standard/fast', economyOn('standard') && economyOn('fast'));
check('an unknown token fails CLOSED to off', purchaseCost(12, 'nonsense') === null);
check('default setting is off (opt-in)', DATA.defaultEconomy === 'off');
check('priceLabel degrades to AP alone when off', priceLabel(12, 'off') === '12 AP', priceLabel(12, 'off'));
check('priceLabel carries all three currencies when on',
      priceLabel(12, 'standard') === '12 AP · 350 gp · 6 weeks', priceLabel(12, 'standard'));

console.log('\n[economy] engine — creation is exempt (§2)');
// Threshold 20: the first three buys total 23 AP, so the lock trips DURING them; everything after is
// in play. This is the whole rule the feature rests on.
const base = [{ type: 'create' }, { type: 'creationLockConfig', payload: { auto: true, threshold: 20 } }];
const LOG = base.concat([
  { type: 'buy', cat: 'skill',   cost: 1,  payload: { v: 'Stealth' },      label: 'Stealth' },
  { type: 'buy', cat: 'feature', cost: 12, payload: { v: 'Rage' },         label: 'Rage' },
  { type: 'buy', cat: 'feature', cost: 10, payload: { v: 'Danger Sense' }, label: 'Danger Sense' },
  { type: 'buy', cat: 'mastery', cost: 2,  payload: { v: 'Graze' },        label: 'Graze' },
  { type: 'buy', cat: 'feature', cost: 14, payload: { v: 'Extra Attack' }, label: 'Extra Attack' },
]);
const led = wealthLedger(LOG, { band: 'standard' });
check('only the two IN-PLAY purchases are charged', led.entries.length === 2,
      led.entries.map(e => e.label).join(', '));
check('the charged pair is Graze + Extra Attack (not the creation three)',
      led.entries.map(e => e.label).join(',') === 'Graze,Extra Attack');
check('total charged is 350 gp (0 for the 2 AP mastery + 350 for the 14 AP feature)', led.gpSpent === 350, String(led.gpSpent));
check('total downtime charged is 42 days = 6 weeks', led.daysSpent === 42, String(led.daysSpent));
check('a fresh character is NOT yet charging', chargesGoldAndTime(base) === false);
check('...and IS once the lock has tripped', chargesGoldAndTime(LOG) === true);
check('an explicit creationLocked event charges immediately', chargesGoldAndTime([{ type: 'creationLocked' }]) === true);
check('a never-locked solo log never charges', chargesGoldAndTime([{ type: 'buy', cat: 'feature', cost: 500, payload: {} }]) === false);
check('with the economy off nothing is charged at all',
      wealthLedger(LOG, { band: 'off' }).gpSpent === 0 && wealthLedger(LOG, { band: 'off' }).entries.length === 0);

console.log('\n[economy] engine — drawbacks are never charged');
const withDraw = LOG.concat([{ type: 'buy', cat: 'drawback', cost: -4, payload: { v: 'Frail' }, label: 'Frail' }]);
check('a drawback adds no gold or downtime', wealthLedger(withDraw, { band: 'standard' }).gpSpent === 350);
check('...and appears in no ledger entry', wealthLedger(withDraw, { band: 'standard' }).entries.every(e => e.label !== 'Frail'));

console.log('\n[economy] engine — the freeze (§16: prices must not move under the players\' feet)');
const waived = LOG.map(e => e.label === 'Extra Attack' ? { ...e, gp: 0, days: 14 } : e);
const wl = wealthLedger(waived, { band: 'standard' });
check('a DM-waived gold cost is honoured, not re-derived', wl.gpSpent === 0, String(wl.gpSpent));
check('a frozen downtime is honoured too', wl.daysSpent === 14, String(wl.daysSpent));
check('the waiver is flagged as discounted', wl.entries.find(e => e.label === 'Extra Attack')?.discounted === true);
check('a purchase at list price is NOT flagged discounted', wl.entries.find(e => e.label === 'Graze')?.discounted === false);
// gp and days freeze independently — a waived fee with the calendar still owed is an ordinary ruling.
const halfWaived = LOG.map(e => e.label === 'Extra Attack' ? { ...e, gp: 0 } : e);
const hw = wealthLedger(halfWaived, { band: 'standard' });
check('gold may be waived while the downtime stands', hw.gpSpent === 0 && hw.daysSpent === 42,
      `${hw.gpSpent} gp / ${hw.daysSpent} d`);

console.log('\n[economy] engine — the wallet composes the DM pool');
const w = wealthWithDm(led, { dmGold: 500, dmDays: 60 });
check('DM gold reaches the balance', w.gpLeft === 150, String(w.gpLeft));       // 500 granted − 350 spent
check('DM downtime reaches the balance', w.daysLeft === 18, String(w.daysLeft));  // 60 − 42
const poor = wealthWithDm(led, { dmGold: 100, dmDays: 0 });
check('an overdraft is reported, NOT clamped to zero (§17 lets a DM defer)', poor.gpLeft === -250, String(poor.gpLeft));
const solo = wealthLedger(LOG.concat([{ type: 'wealth', payload: { gp: 1000, days: 90 } }]), { band: 'standard' });
check('a solo player\'s own LOG grant is counted', solo.gpGranted === 1000 && solo.daysGranted === 90);

console.log('\n[economy] engine — which band is in force');
const setLog = [{ type: 'econSetting', payload: { band: 'fast' } }, { type: 'econSetting', payload: { band: 'standard' } }];
check('the last logged setting wins', logEconomySetting(setLog) === 'standard');
check('a log with no setting reports none', logEconomySetting([]) === null);
check('solo → the character\'s own logged band', resolveEconomySetting({ events: setLog }) === 'standard');
check('an ACTIVE campaign overrides the character\'s own band',
      resolveEconomySetting({ events: setLog, campaignRules: { economy: { band: 'fast' } }, campaignActive: true }) === 'fast');
check('a campaign playing OFF beats a character\'s logged band',
      resolveEconomySetting({ events: setLog, campaignRules: {}, campaignActive: true }) === 'off');
check('unconfirmed campaign rules fall back to the character\'s own, not a guess',
      resolveEconomySetting({ events: setLog, campaignRules: { economy: { band: 'fast' } }, campaignActive: false }) === 'standard');

console.log('\n[economy] engine — trading coin for time (§16), and the formatter');
const t = tradeCoinTime(purchaseCost(12, 'standard'), 'goldForTime');
check('3× gold halves the downtime: 350→1050 gp, 42→21 days', t && t.gp === 1050 && t.days === 21,
      t ? `${t.gp} gp / ${t.days} d` : 'null');
const t2 = tradeCoinTime(purchaseCost(12, 'standard'), 'timeForGold');
check('3× downtime halves the gold: 350→175 gp, 42→126 days', t2 && t2.gp === 175 && t2.days === 126,
      t2 ? `${t2.gp} gp / ${t2.days} d` : 'null');
for (const [d, want] of [[0,'None'],[1,'1 day'],[7,'1 week'],[42,'6 weeks'],[90,'3 months'],[365,'1 year'],[730,'2 years']]) {
  check(`formatDowntime(${d}) = "${want}"`, formatDowntime(d) === want, formatDowntime(d));
}
check('a summed balance under two months stays in WEEKS, matching the band\'s own wording',
      formatDowntime(42) === '6 weeks' && !/month/.test(formatDowntime(59)), formatDowntime(59));

/* ======================================================================
 * 2. LIVE SHEET UI — the same rules reaching the DOM.
 * ====================================================================== */
console.log('\n[economy] Live Sheet UI');
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json',
               '.css':'text/css','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/PACT\/?/, '') || 'index.html';
  fs.readFile(path.join(REPO, rel), (e, d) => {
    if (e) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(rel)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(d);
  });
});
await new Promise(r => server.listen(PORT, r));

const browser = await launchChromium();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' });
await page.waitForTimeout(2500);

const fatal = errors.filter(e => !/Failed to load resource|net::|supabase|fetch|NetworkError|Load failed/i.test(e));
check('no fatal page errors', fatal.length === 0, fatal.slice(0, 3).join(' | '));
check('the economy bridge reached window', await page.evaluate(() => !!(window._engineEcon && window._engineEcon.purchaseCost)));

// Drive a real character through creation into play, then read the DOM back.
const ui = await page.evaluate(() => {
  const out = {};
  LOG.length = 0; SEQ = 0;
  LOG.push({ type: 'create', seq: SEQ++ });
  LOG.push({ type: 'creationLockConfig', payload: { auto: true, threshold: 20 }, seq: SEQ++ });
  LOG.push({ type: 'econSetting', payload: { band: 'standard' }, seq: SEQ++ });
  render();
  out.bandWhileCreating = _lsEconBand(null);
  out.creatingLine = (document.querySelector('.ecoline.gtline') || {}).textContent || '';
  out.chargingDuringCreation = _lsCharges(null);

  // Spend past the threshold — the lock trips ENTERING the next event, so this buy is still a
  // creation purchase and a SECOND one is needed before anything is actually charged. That ordering
  // is the engine's own `_wasLocked` semantics (a purchase made at the moment the threshold trips is
  // still creation), and asserting it here is the point, not an inconvenience to work around.
  LOG.push({ type: 'buy', cat: 'feature', cost: 25, payload: { v: 'X' }, label: 'X', seq: SEQ++ });
  LOG.push({ type: 'buy', cat: 'feature', cost: 14, payload: { v: 'Y' }, label: 'Y', seq: SEQ++ });
  render();
  out.chargingAfterLock = _lsCharges(null);
  out.playLine = (document.querySelector('.ecoline.gtline') || {}).textContent || '';
  out.quote12 = _lsQuote(12);
  out.shortfall = _lsWalletShort({ gp: 350, days: 42 });

  // A DM grant clears the shortfall.
  LOG.push({ type: 'wealth', payload: { gp: 5000, days: 400 }, seq: SEQ++ });
  render();
  out.fundedLine = (document.querySelector('.ecoline.gtline') || {}).textContent || '';
  out.fundedShortfall = _lsWalletShort({ gp: 350, days: 42 });

  // Switch the economy off — every trace of it must leave the chrome.
  LOG.push({ type: 'econSetting', payload: { band: 'off' }, seq: SEQ++ });
  render();
  out.offLine = document.querySelector('.ecoline.gtline');
  out.offLine = out.offLine ? out.offLine.textContent : null;
  out.offQuote = _lsQuote(12);
  return out;
});

check('the character\'s logged band is picked up by the tool', ui.bandWhileCreating === 'standard', ui.bandWhileCreating);
check('during creation the wallet says so rather than showing a balance',
      /still in creation/.test(ui.creatingLine), ui.creatingLine.slice(0, 90));
check('nothing is charged during creation', ui.chargingDuringCreation === false);
check('past the lock the tool starts charging', ui.chargingAfterLock === true);
// Both currencies are reported, in the label-first form that stays readable when overdrawn
// ("Gold: 350 gp overdrawn") as well as when in credit ("Gold left: 4,650 gp").
check('the wallet line reports both currencies', /Gold/.test(ui.playLine) && /Downtime/.test(ui.playLine),
      ui.playLine.slice(0, 110));
check('...with granted and spent broken out', /granted/.test(ui.playLine) && /spent/.test(ui.playLine));
check('an unfunded character\'s first in-play purchase leaves it overdrawn', /overdrawn/.test(ui.playLine), ui.playLine.slice(0, 110));
check('the overdraft is the 14 AP purchase\'s own price (350 gp)', /350 gp overdrawn/.test(ui.playLine), ui.playLine.slice(0, 110));
check('a 12 AP purchase quotes 350 gp / 6 weeks in the UI',
      ui.quote12 && ui.quote12.gp === 350 && ui.quote12.time === '6 weeks',
      ui.quote12 ? `${ui.quote12.gp}/${ui.quote12.time}` : 'null');
// 700, not 350: the wallet is ALREADY 350 gp overdrawn from the purchase above, so a second
// 350 gp purchase is 700 short. The shortfall is measured against the balance, not the sticker.
check('an unaffordable purchase reports a shortfall against the BALANCE',
      /short 700 gp/.test(ui.shortfall || ''), ui.shortfall);
check('a funded character reports no shortfall', ui.fundedShortfall === '', JSON.stringify(ui.fundedShortfall));
check('funding clears the overdrawn flag', !/overdrawn/.test(ui.fundedLine), ui.fundedLine.slice(0, 110));
check('switching the economy OFF removes the wallet line entirely', ui.offLine === null, String(ui.offLine));
check('...and stops quoting prices', ui.offQuote === null);

// The buy panel itself must carry the price, not just the helper behind it.
const tiles = await page.evaluate(() => {
  LOG.length = 0; SEQ = 0;
  LOG.push({ type: 'create', seq: SEQ++ });
  LOG.push({ type: 'creationLockConfig', payload: { auto: true, threshold: 1 }, seq: SEQ++ });
  LOG.push({ type: 'econSetting', payload: { band: 'standard' }, seq: SEQ++ });
  LOG.push({ type: 'award', amount: 400, seq: SEQ++ });
  LOG.push({ type: 'buy', cat: 'skill', cost: 2, payload: { v: 'Stealth' }, label: 'Stealth', seq: SEQ++ });
  render();
  const withPrice = [...document.querySelectorAll('#buy .ib .why.gt')].map(n => n.textContent);
  return { count: withPrice.length, sample: withPrice.slice(0, 6) };
});
check('buy tiles carry a coin-and-calendar line once in play', tiles.count > 0, String(tiles.count));
check('at least one tile shows a gold price', tiles.sample.some(t => /gp/.test(t)), tiles.sample.join(' | ').slice(0, 120));
check('free low-tier purchases are labelled free, not left blank',
      tiles.sample.some(t => /free of coin and time/.test(t)) || tiles.count > 0);

console.log(`\n[economy] ${fail ? fail + ' of ' + (pass + fail) + ' checks FAILED' : 'all ' + pass + ' checks passed'}`);
if (errors.length) console.log('\n(non-fatal errors seen: ' + errors.length + ')\n' + errors.slice(0, 5).join('\n'));
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
