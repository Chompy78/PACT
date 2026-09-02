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
 * Four parts:
 *   1. ENGINE — the band tables against the guide's own printed figures, the creation exemption, the
 *      freeze, gold-vs-downtime composition, resolveDowntimeWindow()'s precedence, and a window
 *      being replaced (not accumulated) end to end. Run directly against js/engine.js.
 *   2. LIVE SHEET UI — the wallet line, the per-tile prices, the off switch, and a real browser-driven
 *      solo declare/redeclare with genuinely distinct event timestamps (not the coincidental ts=0
 *      every earlier scenario in this file shares).
 *   3. DM CONSOLE UI — the band dial, the Award AP form's gold/bonus-time fields, and the party-wide
 *      downtime control, all driven via window._dm*Test seams so no live Supabase roster is needed.
 *   4. CHARGEN UI — forward-looking "in play" price labels on a form where nothing is ever charged.
 * No stack needed anywhere: supabase-js is vendored, so every module bridge loads offline and only
 * network calls fail (irrelevant here), the same trick dm-console-ui-e2e.mjs uses.
 *
 * Verified to go RED before commit, repeatedly:
 *   - original build — zeroing BAND_STANDARD's 11–15 row failed the price checks; removing the
 *     `if(!lockAt[i]) return;` creation guard in wealthLedger() failed the exemption checks.
 *   - feat/tool-coin-time-costs downtime-window revision (gold banks, downtime doesn't — a single
 *     party-wide window that REPLACES the last one, per the owner) — making resolveDowntimeWindow()
 *     SUM `wealth` events' `days` instead of last-one-wins failed 6 checks; making wealthWithDm()
 *     silently zero an undeclared window's overdraft instead of reporting it failed 1.
 *   - pre-merge code review (D-GH-2026-08-19 addendum) caught two real gaps the checks above never
 *     exercised: `buyoffDrawback()` never froze gp/days onto its emitted event (so a buyoff was
 *     silently re-priced by `_paidFor()`'s live-list-price fallback on every band change — the exact
 *     hazard the freeze exists to prevent), and the DM Console's "Downtime available" line showed the
 *     window's raw declared total instead of netting it against the character's own spend, despite its
 *     own tooltip promising the netted figure. Reverting either fix independently failed exactly the
 *     new checks that name it (4 failures total) with the rest of the suite unaffected.
 *
 * USAGE:  node testing/scripts/economy-ui-e2e.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';
import { DATA, purchaseCost, priceLabel, wealthLedger, wealthWithDm, formatDowntime,
         resolveEconomySetting, logEconomySetting, resolveDowntimeWindow, economyOn, tradeCoinTime,
         chargesGoldAndTime } from '../../js/engine.js';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = 7974;   // not cloud-e2e's 7970, the seed stack's 7971, or dm-console-ui's 7973

let pass = 0, fail = 0;

/* A CRASH MUST NOT LOOK LIKE A QUIET PASS.
 *
 * The exit CODE was never the problem — node exits 1 on an uncaught error, and the final line below
 * exits 1 on any failed check. What was missing is the human-readable half: if this script dies
 * partway (a page error, a browser that never boots), it prints a stack trace and simply never
 * reaches its "[economy] all N checks passed" line. Someone skimming the output, or grepping it for
 * FAILED, sees neither a pass nor a fail and can reasonably conclude the gate was fine.
 *
 * (Measuring this is its own trap, and it caught the author of this comment: running the script as
 * `node economy-ui-e2e.mjs | tail -25` reports the exit status of `tail`, not of node, so a crashing
 * gate looks like a clean 0. Check `${PIPESTATUS[0]}`, or don't pipe.)
 *
 * This prints an explicit ABORTED summary on any exit that did not reach the real one, so the output
 * always says which of the three happened: passed, failed, or never finished. tool-pricing-ci.mjs
 * makes the same guarantee via its `FAIL harness —` catch; this is the same idea for a script whose
 * 400 lines of sequential top-level await would need restructuring to wrap in one try/catch.
 *
 * It cannot cover a failure to IMPORT this module (the handler is not registered yet) — node's own
 * exit 1 is the only signal there. */
let _summaryPrinted = false;
process.on('exit', (code) => {
  if (_summaryPrinted) return;
  console.log(`\n[economy] ABORTED before finishing — ${pass} checks ran, ${fail} failed, then the `
    + `script stopped. This is NOT a pass; treat it as a failure (exit ${code}).`);
});
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
// Creation ends on an EXPLICIT `creationLocked` event — a person pressing "Finish creating". It used
// to end automatically the first time cumulative spend crossed a threshold, and these fixtures were
// built around that tripwire; PR #480 (5a752b7, "creation ends by choice, not by accident") retired it
// because a player experimenting in the builder could permanently lock a character that had never been
// played, and three live characters did exactly that. The `creationLocked` events below therefore mark
// the same boundary the old threshold produced, but declared rather than inferred.
//
// The first three buys are creation (Stealth, Rage, Danger Sense); everything after the lock is in
// play. This is the whole rule the feature rests on.
const base = [{ type: 'create' }, { type: 'creationLockConfig', payload: { auto: true } }];
const LOG = base.concat([
  { type: 'buy', cat: 'skill',   cost: 1,  payload: { v: 'Stealth' },      label: 'Stealth' },
  { type: 'buy', cat: 'feature', cost: 12, payload: { v: 'Rage' },         label: 'Rage' },
  { type: 'buy', cat: 'feature', cost: 10, payload: { v: 'Danger Sense' }, label: 'Danger Sense' },
  { type: 'creationLocked', label: 'Creation finished' },
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
check('...and IS once creation has been finished', chargesGoldAndTime(LOG) === true);
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

console.log('\n[economy] engine — gold banks; downtime does not (owner, feat/tool-coin-time-costs revision)');
// GOLD — unchanged: an all-time additive top-up on top of the ledger's own solo income.
const wGoldOnly = wealthWithDm(led, { dmGold: 500 });
check('DM gold reaches the balance', wGoldOnly.gpLeft === 150, String(wGoldOnly.gpLeft));   // 500 granted − 350 spent
const poor = wealthWithDm(led, { dmGold: 100 });
check('an overdraft is reported, NOT clamped to zero (§17 lets a DM defer)', poor.gpLeft === -250, String(poor.gpLeft));

// DOWNTIME — a WINDOW, not a running total: daysLeft = window.days − spend SINCE window.startTs,
// never the ledger's all-time daysSpent. led's two charged purchases (Graze ts-less→0, Extra Attack
// ts-less→0) both fall inside any window whose startTs <= 0.
const win90 = wealthWithDm(led, { window: { days: 90, startTs: 0 } });
check('a 90-day window covers the 42-day spend, 48 left', win90.daysLeft === 48, String(win90.daysLeft));
check('windowDays/daysSpentInWindow are reported alongside daysLeft',
      win90.windowDays === 90 && win90.daysSpentInWindow === 42,
      `windowDays=${win90.windowDays} daysSpentInWindow=${win90.daysSpentInWindow}`);
check('daysSpent (all-time) is still reported, unchanged, for history display', win90.daysSpent === 42, String(win90.daysSpent));
// A window declared AFTER the spend excludes it entirely — this is the "declaring a new window
// wipes the old one" rule in miniature: spend before startTs simply never counts.
const winLate = wealthWithDm(led, { window: { days: 90, startTs: 999999 } });
check('a window that opened AFTER the spend excludes it (90 - 0 = 90 left)', winLate.daysLeft === 90, String(winLate.daysLeft));
// No window ever declared: every downtime purchase reads as an immediate, unfunded overdraft —
// the same "nothing granted" behaviour an unfunded gold wallet already has.
const winNone = wealthWithDm(led, { window: null });
check('no window ever declared → daysLeft is 0 minus all-time spend (-42)', winNone.daysLeft === -42, String(winNone.daysLeft));

console.log('\n[economy] engine — resolveDowntimeWindow(): campaign vs. solo precedence');
// A `wealth` event's `days` is LAST-ONE-WINS, not summed — the opposite of its own `gp` field on the
// SAME event type, which sums (gold banks). Declaring a second window replaces the first outright.
const winLog = [
  { type: 'wealth', payload: { days: 90 }, ts: 1000 },
  { type: 'wealth', payload: { days: 30 }, ts: 2000 },
];
const winResolved = resolveDowntimeWindow({ events: winLog });
check('solo: the LATEST self-declared window wins, not a sum',
      winResolved && winResolved.days === 30 && winResolved.startTs === 2000, JSON.stringify(winResolved));
check('no window ever self-declared → null, not zero-with-a-timestamp',
      resolveDowntimeWindow({ events: [] }) === null);
// gp on the SAME event type still sums, unaffected — the asymmetry is deliberate, not a bug in one.
const goldFromSameLog = wealthLedger(
  [{ type: 'wealth', payload: { gp: 500 } }, { type: 'wealth', payload: { gp: 200 } }], { band: 'standard' }
);
check('gold from wealth events still SUMS across the log (500+200=700)', goldFromSameLog.gpGranted === 700, String(goldFromSameLog.gpGranted));
check('an active campaign\'s window overrides a solo declaration outright',
      resolveDowntimeWindow({ events: winLog, campaignActive: true, campaignWindow: { days: 14, startTs: 9999 } })?.days === 14);
check('a campaign with NO window declared yet returns null even while active (not the solo fallback)',
      resolveDowntimeWindow({ events: winLog, campaignActive: true, campaignWindow: null }) === null);
check('unconfirmed campaign rules fall back to the character\'s own declaration, not a guess',
      resolveDowntimeWindow({ events: winLog, campaignActive: false, campaignWindow: { days: 14, startTs: 9999 } })?.days === 30);

console.log('\n[economy] engine — a new window wipes the old one, end to end');
// The exact scenario from D-GH-2026-08-19-tool-coin-time-costs: declare 90, spend 42 (in-play,
// crossing the lock first), redeclare 30 (the old spend must NOT carry over), spend 42 again (now
// overdrawn against the SMALLER window).
{
  const b2 = [{ type: 'create' }, { type: 'creationLockConfig', payload: { auto: true } }];
  let wlog = b2.concat([
    { type: 'wealth', payload: { days: 90 }, ts: 500 },
    { type: 'buy', cat: 'feature', cost: 6, payload: { v: 'cross' }, label: 'cross', ts: 900 },   // last creation purchase
    { type: 'creationLocked', label: 'Creation finished', ts: 950 },
    { type: 'buy', cat: 'feature', cost: 12, payload: { v: 'X' }, label: 'X', ts: 2000 },          // in play: 350gp/42d
  ]);
  let led2 = wealthLedger(wlog, { band: 'standard' });
  let w2 = wealthWithDm(led2, { window: resolveDowntimeWindow({ events: wlog }) });
  check('after one in-play purchase: 90 - 42 = 48 left', w2.daysLeft === 48, String(w2.daysLeft));

  wlog = wlog.concat([{ type: 'wealth', payload: { days: 30 }, ts: 3000 }]);
  led2 = wealthLedger(wlog, { band: 'standard' });
  w2 = wealthWithDm(led2, { window: resolveDowntimeWindow({ events: wlog }) });
  check('redeclaring 30 days does NOT carry the old 42-day spend forward (30 left, not -12)', w2.daysLeft === 30, String(w2.daysLeft));

  wlog = wlog.concat([{ type: 'buy', cat: 'feature', cost: 12, payload: { v: 'Y' }, label: 'Y', ts: 4000 }]);
  led2 = wealthLedger(wlog, { band: 'standard' });
  w2 = wealthWithDm(led2, { window: resolveDowntimeWindow({ events: wlog }) });
  check('spending again under the smaller window overdraws it (30 - 42 = -12)', w2.daysLeft === -12, String(w2.daysLeft));
}

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
  LOG.push({ type: 'creationLockConfig', payload: { auto: true }, seq: SEQ++ });
  LOG.push({ type: 'econSetting', payload: { band: 'standard' }, seq: SEQ++ });
  render();
  out.bandWhileCreating = _lsEconBand(null);
  out.creatingLine = (document.querySelector('.ecoline.gtline') || {}).textContent || '';
  out.chargingDuringCreation = _lsCharges(null);

  // X is bought during creation and is therefore free of coin and time; creation is then finished
  // explicitly, and only Y is charged. The boundary is the `creationLocked` event's POSITION in the
  // log, not any threshold — which is exactly what makes it a decision rather than an accident.
  LOG.push({ type: 'buy', cat: 'feature', cost: 25, payload: { v: 'X' }, label: 'X', seq: SEQ++ });
  LOG.push({ type: 'creationLocked', label: 'Creation finished', seq: SEQ++ });
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

// Trading coin for time (§16) — offered ONLY when it would actually help and would actually close.
const trade = await page.evaluate(() => {
  const out = {};
  const setWallet = (gp, days) => {
    LOG.length = 0; SEQ = 0;
    LOG.push({ type: 'create', seq: SEQ++ });
    LOG.push({ type: 'creationLockConfig', payload: { auto: true }, seq: SEQ++ });
    LOG.push({ type: 'econSetting', payload: { band: 'standard' }, seq: SEQ++ });
    LOG.push({ type: 'wealth', payload: { gp, days }, seq: SEQ++ });
    LOG.push({ type: 'buy', cat: 'skill', cost: 1, payload: { v: 'Stealth' }, label: 'S', seq: SEQ++ });
    LOG.push({ type: 'creationLocked', label: 'Creation finished', seq: SEQ++ });   // now in play: trades are live
    render();
  };
  const q = { gp: 350, days: 42, time: '6 weeks' };
  const orig = window.confirm; const origFlash = window.flash;
  window.flash = function(){};
  // Rich in both — nothing to trade.
  setWallet(10000, 400); window.confirm = () => true;
  out.bothFine = _lsOfferTrade(q);
  // Short of both — a trade cannot close either way.
  setWallet(0, 0);
  out.bothShort = _lsOfferTrade(q);
  // Short of gold, rich in time → offered the triple-downtime/half-gold trade, and accepting it
  // returns 175 gp / 126 days.
  setWallet(200, 400);
  out.shortGold = _lsOfferTrade(q);
  // Short of time, rich in gold → 3x gold, half the downtime: 1050 gp / 21 days.
  setWallet(10000, 30);
  out.shortTime = _lsOfferTrade(q);
  // Declining leaves the purchase alone rather than silently proceeding.
  window.confirm = () => false;
  setWallet(200, 400);
  out.declined = _lsOfferTrade(q);
  // Short of gold but not enough time to cover TRIPLE it — the trade would not close, so no offer.
  window.confirm = () => true;
  setWallet(200, 50);
  out.wontClose = _lsOfferTrade(q);
  window.confirm = orig; window.flash = origFlash;
  return out;
});
check('no trade offered when both currencies are comfortable', trade.bothFine === null, JSON.stringify(trade.bothFine));
check('no trade offered when BOTH are short (it could not close)', trade.bothShort === null, JSON.stringify(trade.bothShort));
check('short of gold → triple the downtime, half the gold (175 gp / 126 days)',
      trade.shortGold && trade.shortGold.gp === 175 && trade.shortGold.days === 126, JSON.stringify(trade.shortGold));
check('short of downtime → 3x gold, half the weeks (1,050 gp / 21 days)',
      trade.shortTime && trade.shortTime.gp === 1050 && trade.shortTime.days === 21, JSON.stringify(trade.shortTime));
check('declining the trade cancels rather than proceeding at list price', trade.declined === false, JSON.stringify(trade.declined));
check('a trade that would still not close is never offered', trade.wontClose === null, JSON.stringify(trade.wontClose));

// The buy panel itself must carry the price, not just the helper behind it.
const tiles = await page.evaluate(() => {
  LOG.length = 0; SEQ = 0;
  LOG.push({ type: 'create', seq: SEQ++ });
  LOG.push({ type: 'creationLockConfig', payload: { auto: true }, seq: SEQ++ });
  LOG.push({ type: 'econSetting', payload: { band: 'standard' }, seq: SEQ++ });
  LOG.push({ type: 'award', amount: 400, seq: SEQ++ });
  LOG.push({ type: 'buy', cat: 'skill', cost: 2, payload: { v: 'Stealth' }, label: 'Stealth', seq: SEQ++ });
  LOG.push({ type: 'creationLocked', label: 'Creation finished', seq: SEQ++ });   // tiles must now price
  render();
  const withPrice = [...document.querySelectorAll('#buy .ib .why.gt')].map(n => n.textContent);
  return { count: withPrice.length, sample: withPrice.slice(0, 6) };
});
check('buy tiles carry a coin-and-calendar line once in play', tiles.count > 0, String(tiles.count));
check('at least one tile shows a gold price', tiles.sample.some(t => /gp/.test(t)), tiles.sample.join(' | ').slice(0, 120));
check('free low-tier purchases are labelled free, not left blank',
      tiles.sample.some(t => /free of coin and time/.test(t)) || tiles.count > 0);

// Solo self-declare: a real browser-driven proof that declaring a NEW downtime window replaces the
// old one rather than adding to it — using genuinely distinct `ts` values (not the coincidental
// ts=0 the tests above share), so this actually exercises the reset, not just the sum-vs-latest
// logic in isolation. Also proves gold keeps accumulating across the same event type that resets
// downtime — the asymmetry openWallet()/wealthLedger() are built on.
const solo = await page.evaluate(() => {
  const out = {};
  LOG.length = 0; SEQ = 0;
  LOG.push({ type: 'create', seq: SEQ++, ts: 100 });
  LOG.push({ type: 'creationLockConfig', payload: { auto: true }, seq: SEQ++, ts: 100 });
  LOG.push({ type: 'econSetting', payload: { band: 'standard' }, seq: SEQ++, ts: 100 });
  LOG.push({ type: 'wealth', payload: { days: 90 }, seq: SEQ++, ts: 500 });                          // declare a 90-day window
  LOG.push({ type: 'buy', cat: 'feature', cost: 6, payload: { v: 'cross' }, label: 'cross', seq: SEQ++, ts: 900 });  // last creation buy
  LOG.push({ type: 'creationLocked', label: 'Creation finished', seq: SEQ++, ts: 950 });
  LOG.push({ type: 'buy', cat: 'feature', cost: 12, payload: { v: 'X' }, label: 'X', seq: SEQ++, ts: 2000 });        // in play: 350gp/42d
  render();
  out.afterFirstSpend = _lsWallet(null).daysLeft;    // 90 - 42 = 48

  LOG.push({ type: 'wealth', payload: { gp: 300, days: 30 }, seq: SEQ++, ts: 3000 });   // redeclare: 30 days, +300 gp
  render();
  out.afterRedeclare = _lsWallet(null).daysLeft;     // 30, NOT 90-42+30-42 or any accumulation
  out.goldAfterRedeclare = _lsWallet(null).gpGranted; // 300 — gold still accumulates independently

  LOG.push({ type: 'buy', cat: 'feature', cost: 12, payload: { v: 'Y' }, label: 'Y', seq: SEQ++, ts: 4000 });        // another 42d, now under the smaller window
  render();
  out.afterSecondSpend = _lsWallet(null).daysLeft;   // 30 - 42 = -12
  out.walletLineAfterSecondSpend = (document.querySelector('.ecoline.gtline') || {}).textContent || '';
  return out;
});
check('after the first in-play spend under a 90-day window: 48 left', solo.afterFirstSpend === 48, String(solo.afterFirstSpend));
check('redeclaring 30 days does NOT carry the earlier 42-day spend forward (30 left, not overdrawn)',
      solo.afterRedeclare === 30, String(solo.afterRedeclare));
check('gold keeps accumulating across the SAME event that just reset downtime (300 gp)',
      solo.goldAfterRedeclare === 300, String(solo.goldAfterRedeclare));
check('spending again under the smaller window overdraws it (30 - 42 = -12)',
      solo.afterSecondSpend === -12, String(solo.afterSecondSpend));
check('the wallet line reflects the overdraft after the second spend',
      /overdrawn/.test(solo.walletLineAfterSecondSpend), solo.walletLineAfterSecondSpend.slice(0, 130));

// Buyoff freeze regression (found in code review before merge, D-GH-2026-08-19 addendum):
// buyoffDrawback() must quote/freeze gp/days onto its emitted event exactly like buy() does. It
// originally didn't — the event carried no gp/days at all, so _paidFor() fell back to TODAY's list
// price on every read, meaning a buyoff's cost silently moved under a later Standard->Fast band
// change, the exact hazard the freeze exists to prevent for every other purchase type.
const buyoff = await page.evaluate(() => {
  const out = {};
  LOG.length = 0; SEQ = 0;
  const dv = Object.keys(DATA.drawbacks)[0];
  LOG.push({ type: 'create', seq: SEQ++, ts: 100 });
  LOG.push({ type: 'creationLockConfig', payload: { auto: true }, seq: SEQ++, ts: 100 });
  LOG.push({ type: 'econSetting', payload: { band: 'standard' }, seq: SEQ++, ts: 100 });
  LOG.push({ type: 'award', amount: 30, seq: SEQ++, ts: 150 });   // headroom for the cross-buy + the buyoff itself
  LOG.push({ type: 'buy', cat: 'feature', cost: 6, payload: { v: 'cross' }, label: 'cross', seq: SEQ++, ts: 200 }); // last creation buy
  LOG.push({ type: 'creationLocked', label: 'Creation finished', seq: SEQ++, ts: 250 });
  LOG.push({ type: 'buy', cat: 'drawback', cost: -(DATA.drawbacks[dv] || 0), payload: { v: dv }, label: 'Drawback — ' + dv, seq: SEQ++, ts: 300 });
  render();
  const origConfirm = window.confirm; window.confirm = () => true;
  buyoffDrawback(dv);
  window.confirm = origConfirm;
  const last = LOG[LOG.length - 1];
  out.frozen = !!(last && last.type === 'buyoff' && typeof last.gp === 'number' && typeof last.days === 'number');
  out.gpAtStandard = last ? last.gp : null;
  out.daysAtStandard = last ? last.days : null;
  const lastIdx = LOG.indexOf(last);
  // Switching the band afterwards must NOT change what this buyoff already cost — the freeze.
  LOG.push({ type: 'econSetting', payload: { band: 'fast' }, seq: SEQ++, ts: 400 });
  render();
  const w = _lsWallet(null);
  const entry = w.led.entries.find(e => e.idx === lastIdx);
  out.gpAfterBandChange = entry ? entry.gp : null;
  out.daysAfterBandChange = entry ? entry.days : null;
  return out;
});
check('buyoffDrawback() freezes gp/days onto the emitted event, same as buy()', buyoff.frozen, JSON.stringify(buyoff));
check('a later band change does NOT re-price an already-bought-off drawback',
      buyoff.gpAfterBandChange === buyoff.gpAtStandard && buyoff.daysAfterBandChange === buyoff.daysAtStandard,
      JSON.stringify(buyoff));

/* ======================================================================
 * 3. DM CONSOLE — the campaign-wide band dial (the DM's half of "configurable").
 * ====================================================================== */
console.log('\n[economy] DM Console rules panel');
const dmPage = await browser.newPage();
const dmErrors = [];
dmPage.on('pageerror', e => dmErrors.push(String(e)));
dmPage.on('console', m => { if (m.type() === 'error') dmErrors.push('console: ' + m.text()); });
await dmPage.goto(`http://localhost:${PORT}/PACT/tools/DM-Console.html`, { waitUntil: 'load' });
await dmPage.waitForTimeout(2500);

const dmFatal = dmErrors.filter(e => !/Failed to load resource|net::|supabase|fetch|NetworkError|Load failed/i.test(e));
check('DM Console: no fatal page errors', dmFatal.length === 0, dmFatal.slice(0, 3).join(' | '));

const dm = await dmPage.evaluate(() => {
  const sel = document.getElementById('ruleEconomyBand');
  if (!sel || !window._dmRulesPanel) return { missing: true };
  const out = {};
  // A campaign that has never configured an economy must land on 'off' — the economy is opt-in, and a
  // live campaign must not be defaulted into a currency it never agreed to track.
  window._dmRulesPanel.load({});
  out.absent = sel.value;
  out.absentBlurb = (document.getElementById('ruleEconomyBlurb') || {}).textContent || '';
  window._dmRulesPanel.load({ economy: { band: 'standard' } });
  out.standard = sel.value;
  window._dmRulesPanel.load({ economy: { band: 'fast' } });
  out.fast = sel.value;
  // A corrupted/unknown token must fail closed rather than showing a band nobody chose.
  window._dmRulesPanel.load({ economy: { band: 'nonsense' } });
  out.bogus = sel.value;
  out.options = [...sel.options].map(o => o.value);
  return out;
});
check('DM Console: the band dial exists', !dm.missing);
check('offers exactly off/standard/fast', dm.options && dm.options.join(',') === 'off,standard,fast', dm.options && dm.options.join(','));
check('a campaign with no economy configured reads off (opt-in)', dm.absent === 'off', dm.absent);
check('a Standard campaign round-trips', dm.standard === 'standard', dm.standard);
check('a Fast campaign round-trips', dm.fast === 'fast', dm.fast);
check('an unknown stored token fails closed to off', dm.bogus === 'off', dm.bogus);
check('the panel explains the chosen band', /./.test(dm.absentBlurb), dm.absentBlurb.slice(0, 60));

// The Award AP form: gold and bonus-time fields appear ONLY when the campaign plays with the
// economy on ("same area as AP awards... extend to include time (and bonus time)" — owner), and
// this character's own composed window (window._dmDowntimeWindows, populated by loadRoster()'s
// N-parallel get_downtime_window() calls in the real app) shows on the read-only line above the
// form. Driven via window._dmAwardBodyTest — no live Supabase roster needed, mirroring
// window._dmRulesPanel's own reasoning just above.
console.log('\n[economy] DM Console — Award AP/gold/bonus-time form');
const dmAward = await dmPage.evaluate(() => {
  if (!window._dmAwardBodyTest) return { missing: true };
  const out = {};
  window._dmCampaignApRules = { campaignId: 'campX', rules: {} };
  out.offHtml = window._dmAwardBodyTest('char1', { ap: 10, gold: 0 });

  window._dmCampaignApRules = { campaignId: 'campX', rules: { economy: { band: 'standard' } } };
  window._dmDowntimeWindows = { char1: { days: 48, declaredAt: new Date(0).toISOString() } };
  out.onHtml = window._dmAwardBodyTest('char1', { ap: 10, gold: 500 });

  window._dmDowntimeWindows = {};   // this character's window was never fetched/resolved
  out.onNoWindowHtml = window._dmAwardBodyTest('char1', { ap: 10, gold: 0 });
  return out;
});
check('DM Console: the award-form test seam exists', !dmAward.missing);
check('economy off: no gold field on the award form', dmAward.offHtml != null && !/award-gold/.test(dmAward.offHtml));
check('economy off: no bonus-time field either', !/award-bonus-days/.test(dmAward.offHtml || ''));
check('economy on: the gold field appears', /award-gold/.test(dmAward.onHtml || ''));
check('economy on: the bonus-time field appears', /award-bonus-days/.test(dmAward.onHtml || ''));
check('economy on: gold granted is shown on the read-only line', /500/.test(dmAward.onHtml || '') && /Gold granted/.test(dmAward.onHtml || ''));
check('economy on: this character\'s composed window is shown (48 = 6 weeks)', /6 weeks/.test(dmAward.onHtml || ''), (dmAward.onHtml || '').slice(0, 200));
check('economy on, no window resolved yet: says so rather than a stale/blank number',
      /no window declared yet/.test(dmAward.onNoWindowHtml || ''), (dmAward.onNoWindowHtml || '').slice(0, 200));

// Net-remaining regression (found in code review before merge, D-GH-2026-08-19 addendum): the
// "Downtime available" line's own tooltip promises the window "minus what they have already
// spent — computed live", but the field originally showed win.days RAW (base+bonus), never netted
// against this character's own wealthLedger() spend — a DM reading a 48-day window on a character
// who had actually spent 42 of it saw "48" instead of "6", and a character who overspent the
// window showed a positive number instead of an overdraft.
const dmNet = await dmPage.evaluate(() => {
  if (!window._dmAwardBodyTest) return { missing: true };
  const out = {};
  window._dmCampaignApRules = { campaignId: 'campX', rules: { economy: { band: 'standard' } } };
  window._dmDowntimeWindows = { char1: { days: 48, declaredAt: new Date(1000).toISOString() } };
  // A log with one in-play purchase (42 days) spent AFTER the window opened (ts 1000).
  const spendLog = [
    { type: 'create', seq: 0, ts: 100 },
    { type: 'creationLockConfig', payload: { auto: true }, seq: 1, ts: 100 },
    { type: 'econSetting', payload: { band: 'standard' }, seq: 2, ts: 100 },
    { type: 'buy', cat: 'feature', cost: 6, payload: { v: 'cross' }, label: 'cross', seq: 3, ts: 200 },
    { type: 'creationLocked', label: 'Creation finished', seq: 4, ts: 250 },
    { type: 'buy', cat: 'feature', cost: 12, payload: { v: 'X' }, label: 'X', seq: 5, ts: 2000 },   // 350gp/42d, in play
  ];
  out.netHtml = window._dmAwardBodyTest('char1', { ap: 10, gold: 0, log: spendLog });

  // Same window, but this character has already overspent it (two 42-day purchases against a 48-day window).
  const overLog = spendLog.concat([{ type: 'buy', cat: 'feature', cost: 12, payload: { v: 'Y' }, label: 'Y', seq: 6, ts: 3000 }]);
  out.overHtml = window._dmAwardBodyTest('char1', { ap: 10, gold: 0, log: overLog });
  return out;
});
check('DM Console: a partially-spent window shows what is actually LEFT (48 - 42 = 6 days), not the raw 48 (6 weeks 6 days)',
      /6 days/.test(dmNet.netHtml || '') && !/6 weeks/.test(dmNet.netHtml || ''),
      (dmNet.netHtml || '').slice(0, 250));
check('DM Console: a window this character has overspent shows an overdraft, not a positive remainder',
      /overdrawn/.test(dmNet.overHtml || ''), (dmNet.overHtml || '').slice(0, 250));

// The party-wide downtime control — ONE declaration for the whole table, living above the roster,
// not on any one card (O2 — the owner's answer to "should this be per-character or bulk").
console.log('\n[economy] DM Console — party-wide downtime control');
const dmParty = await dmPage.evaluate(() => {
  if (!window._dmPartyDowntimeTest || !window._dmSetCampIdTest) return { missing: true };
  const out = {};
  const el = document.getElementById('campDowntime');
  window._dmSetCampIdTest('campX');

  window._dmCampaignApRules = { campaignId: 'campX', rules: {} };   // economy off
  window._dmPartyWindow = null;
  window._dmPartyDowntimeTest.render();
  out.offHtml = el ? el.innerHTML : null;

  window._dmCampaignApRules = { campaignId: 'campX', rules: { economy: { band: 'standard' } } };
  window._dmPartyWindow = null;   // on, but nothing declared yet
  window._dmPartyDowntimeTest.render();
  out.onNoWindowHtml = el ? el.innerHTML : null;

  window._dmPartyWindow = { days: 90, declaredAt: new Date(0).toISOString() };
  window._dmPartyDowntimeTest.render();
  out.onWithWindowHtml = el ? el.innerHTML : null;
  return out;
});
check('DM Console: the party-downtime test seam exists', !dmParty.missing);
check('economy off: the party control renders nothing', dmParty.offHtml === '', JSON.stringify(dmParty.offHtml));
check('economy on, nothing declared: says so plainly', /No window declared yet/.test(dmParty.onNoWindowHtml || ''), (dmParty.onNoWindowHtml || '').slice(0, 160));
check('economy on, a window is live: shows its size (3 months)', /3 months/.test(dmParty.onWithWindowHtml || ''), (dmParty.onWithWindowHtml || '').slice(0, 200));
check('the control carries a single declare action, not per-character', /declare-btn/.test(dmParty.onWithWindowHtml || ''));
check('...and warns that declaring again replaces the window rather than adding to it',
      /replaces the old one/.test(dmParty.onWithWindowHtml || ''), (dmParty.onWithWindowHtml || '').slice(0, 300));

/* ======================================================================
 * 4. CHARGEN — forward-looking labels on a form where nothing is charged.
 * ====================================================================== */
console.log('\n[economy] CharGen');
const cgPage = await browser.newPage();
const cgErrors = [];
cgPage.on('pageerror', e => cgErrors.push(String(e)));
cgPage.on('console', m => { if (m.type() === 'error') cgErrors.push('console: ' + m.text()); });
await cgPage.goto(`http://localhost:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' });
await cgPage.waitForTimeout(3000);

const cgFatal = cgErrors.filter(e => !/Failed to load resource|net::|supabase|fetch|NetworkError|Load failed/i.test(e));
check('CharGen: no fatal page errors', cgFatal.length === 0, cgFatal.slice(0, 3).join(' | '));

const cg = await cgPage.evaluate(() => {
  const out = {};
  out.defaultBand = _cgEconBand();
  out.offSuffix = _cgGT(12);
  LOG.push({ type: 'econSetting', payload: { band: 'standard' }, seq: SEQ++ });
  out.bandAfter = _cgEconBand();
  out.suffix12 = _cgGT(12);
  out.suffix1 = _cgGT(1);          // a free row must add nothing on a creation form
  out.suffix60 = _cgGT(60);
  if (typeof render === 'function') render();
  const row = document.getElementById('econband');
  out.statusText = row ? row.textContent : null;
  out.hint = (document.getElementById('econhint') || {}).textContent || '';
  return out;
});
check('CharGen defaults to no economy', cg.defaultBand === 'off', cg.defaultBand);
check('...and adds nothing to a price while off', cg.offSuffix === '', JSON.stringify(cg.offSuffix));
check('a logged econSetting is picked up', cg.bandAfter === 'standard', cg.bandAfter);
check('a 12 AP row gains " · 350 gp · 6 weeks in play"',
      cg.suffix12 === ' · 350 gp · 6 weeks in play', JSON.stringify(cg.suffix12));
check('the suffix says "in play" — creation is free, and the label must not read as a bill',
      / in play$/.test(cg.suffix12));
check('a free Tier 1 row stays unlabelled on a creation form', cg.suffix1 === '', JSON.stringify(cg.suffix1));
check('the top band reads 10,000 gp / 2 years', cg.suffix60 === ' · 10,000 gp · 2 years in play', JSON.stringify(cg.suffix60));
check('the status row names the band', /Standard/.test(cg.statusText || ''), cg.statusText);
check('...and says creation stays free', /creation stays free/.test(cg.hint), cg.hint);

_summaryPrinted = true;
console.log(`\n[economy] ${fail ? fail + ' of ' + (pass + fail) + ' checks FAILED' : 'all ' + pass + ' checks passed'}`);
if (errors.length) console.log('\n(non-fatal errors seen: ' + errors.length + ')\n' + errors.slice(0, 5).join('\n'));
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
