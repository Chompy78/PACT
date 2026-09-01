/**
 * PACT — headless gate for per-band-row cost customisation (feat/cost-customization).
 * ----------------------------------------------------------------------------------
 * WHAT THIS GUARDS. A DM may re-price any row of their campaign's economy band, separately for
 * gold and for downtime, by a multiplier or a flat override. That price reaches players through
 * purchaseCost() — the single pricing function — so the numbers asserted here are the numbers a
 * character is actually charged and then has frozen into their log.
 *
 * TWO PARTS, DELIBERATELY.
 *   1. ENGINE (pure Node, zero browser). The pricing arithmetic, rounding, band isolation and the
 *      no-retroactive-re-pricing guarantee. Deterministic — no timing, no page boot.
 *   2. TOOLS (Chromium over CDP). That the DM Console's editor round-trips its stored shape, and
 *      that CharGen and the Live Sheet actually quote a campaign's customised prices rather than
 *      the book ones. This half exists because threading the rules object to the pricing call
 *      sites is the part that silently regresses — the engine can be perfect and a tool still pass
 *      it a bare band token, which loses every customisation with no error anywhere.
 *
 * WHY NOT PLAYWRIGHT. Same reason as tool-pricing-ci.mjs: AGENTS.md forbids npm in this repo, so
 * the Playwright-based e2e scripts cannot run in a plain CLI session. This drives Chromium over the
 * Chrome DevTools Protocol using Node built-ins only. The harness below is deliberately the same
 * shape as tool-pricing-ci.mjs's so the two read alike.
 *
 * USAGE   node testing/scripts/cost-customization-ci.mjs
 *         CHROME_BIN=/path/to/chrome node testing/scripts/cost-customization-ci.mjs
 *         SKIP_BROWSER=1 node testing/scripts/cost-customization-ci.mjs    # engine half only
 * Exit codes match tool-pricing-ci.mjs: 1 a real failure, 2 no browser, 3 browser never opened CDP.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { purchaseCost, effectiveBandRows, bandRowKey, wealthLedger, priceLabel, formatDowntime, DATA }
  from '../../js/engine.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 8733, CDP_PORT = 9335;   // distinct from tool-pricing-ci.mjs so the two can run at once

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

/* A campaign rules object carrying per-row customisation, in the shape the DM Console saves. */
const R = (rowCosts, band = 'standard') => ({ economy: { band, rowCosts } });
const cost = (ap, rules) => { const c = purchaseCost(ap, rules); return c ? [c.gp, c.days] : null; };

// =================================================================================================
// PART 1 — the engine
// =================================================================================================
console.log('\n[cost-customization] engine — list prices are unchanged by the feature');
// The whole feature must be inert until a DM opts in. A bare token carries no rules and so can
// carry no customisation: that is the property that makes every existing call site safe.
check('12 AP on Standard is still 350 gp / 42 d', cost(12, 'standard'), [350, 42]);
check('3 AP on Standard is still 25 gp / 7 d', cost(3, 'standard'), [25, 7]);
check('top row (51+ AP) is still 10,000 gp / 730 d', cost(99, 'standard'), [10000, 730]);
check('Fast 12 AP is still 150 gp / 3 d', cost(12, 'fast'), [150, 3]);
check('economy off still prices nothing', purchaseCost(12, 'off'), null);
check('rules object with no rowCosts == the bare token', cost(12, R(null)), cost(12, 'standard'));
check('untouched rows are returned BY REFERENCE (=== the band table)',
  effectiveBandRows(R({ standard: { '15': { gp: { mode: 'mult', value: 2 } } } }))[0] === effectiveBandRows('standard')[0], true);

console.log('\n[cost-customization] engine — the multiplier method');
check('gold x2 on the 11-15 row', cost(12, R({ standard: { '15': { gp: { mode: 'mult', value: 2 } } } })), [700, 42]);
check('gold x0.5 on the 11-15 row', cost(12, R({ standard: { '15': { gp: { mode: 'mult', value: 0.5 } } } })), [175, 42]);
check('time x0.5 halves the downtime', cost(12, R({ standard: { '15': { days: { mode: 'mult', value: 0.5 } } } })), [350, 21]);
check('time x2 doubles the downtime', cost(12, R({ standard: { '15': { days: { mode: 'mult', value: 2 } } } })), [350, 84]);
check('x1 is a no-op', cost(12, R({ standard: { '15': { gp: { mode: 'mult', value: 1 }, days: { mode: 'mult', value: 1 } } } })), [350, 42]);
check('x0 makes a row free', cost(12, R({ standard: { '15': { gp: { mode: 'mult', value: 0 }, days: { mode: 'mult', value: 0 } } } })), [0, 0]);
// Rounding is one rule per currency, applied to both modes: gold rounds to nearest, downtime rounds
// UP. A part-day of training still costs the day, and ceil can never make a multiplier cheaper than
// the DM asked for. 25 x 0.5 = 12.5 -> 13 gp; 7 x 0.5 = 3.5 -> 4 days.
check('gold rounds to nearest (25 x 0.5 = 12.5 -> 13)', cost(3, R({ standard: { '5': { gp: { mode: 'mult', value: 0.5 } } } })), [13, 7]);
check('downtime rounds UP (7 x 0.5 = 3.5 -> 4)', cost(3, R({ standard: { '5': { days: { mode: 'mult', value: 0.5 } } } })), [25, 4]);
check('a negative multiplier clamps to free, never pays the character',
  cost(12, R({ standard: { '15': { gp: { mode: 'mult', value: -5 }, days: { mode: 'mult', value: -5 } } } })), [0, 0]);

console.log('\n[cost-customization] engine — the flat-override method');
check('flat 500 gp', cost(12, R({ standard: { '15': { gp: { mode: 'flat', value: 500 } } } })), [500, 42]);
check('flat 0 gp is a real price, not "unset"', cost(12, R({ standard: { '15': { gp: { mode: 'flat', value: 0 } } } })), [0, 42]);
check('flat 10 days', cost(12, R({ standard: { '15': { days: { mode: 'flat', value: 10 } } } })), [350, 10]);
check('both currencies overridden at once',
  cost(12, R({ standard: { '15': { gp: { mode: 'flat', value: 500 }, days: { mode: 'flat', value: 10 } } } })), [500, 10]);
check('the two methods may be mixed ACROSS currencies (flat gold, x2 time)',
  cost(12, R({ standard: { '15': { gp: { mode: 'flat', value: 500 }, days: { mode: 'mult', value: 2 } } } })), [500, 84]);

console.log('\n[cost-customization] engine — only the targeted row moves');
const oneRow = R({ standard: { '15': { gp: { mode: 'mult', value: 2 }, days: { mode: 'mult', value: 2 } } } });
check('the customised row (12 AP) doubles', cost(12, oneRow), [700, 84]);
check('the row below (3 AP) is untouched', cost(3, oneRow), [25, 7]);
check('the row above (18 AP) is untouched', cost(18, oneRow), [750, 90]);
check('the top row is untouched', cost(99, oneRow), [10000, 730]);
check('the free Tier 1 row stays free', cost(1, oneRow), [0, 0]);
check('the open-ended top row is keyed "top"',
  cost(99, R({ standard: { top: { gp: { mode: 'mult', value: 2 } } } })), [20000, 730]);
check('bandRowKey names a finite row by its maxAp', bandRowKey({ maxAp: 15 }), '15');
check('bandRowKey names the open-ended row "top"', bandRowKey({ maxAp: null }), 'top');

console.log('\n[cost-customization] engine — bands are customised independently');
// Standard and Fast have different thresholds AND different row counts (9 vs 8); economy-bands.js is
// explicit that one is not derivable from the other. A DM's Standard tuning must not silently
// re-target Fast's rows, which is the whole reason rowCosts is keyed by band token first.
const bothBands = { standard: { '15': { gp: { mode: 'mult', value: 2 } } }, fast: { '15': { gp: { mode: 'flat', value: 999 } } } };
check('Standard reads its own entry', cost(12, R(bothBands, 'standard')), [700, 42]);
check('Fast reads its own entry', cost(12, R(bothBands, 'fast')), [999, 3]);
check("a Fast-only entry does not leak into Standard", cost(12, R({ fast: { '15': { gp: { mode: 'mult', value: 9 } } } }, 'standard')), [350, 42]);
check("a Standard-only entry does not leak into Fast", cost(12, R({ standard: { '15': { gp: { mode: 'mult', value: 9 } } } }, 'fast')), [150, 3]);
check('customising a band does not switch the band in force', purchaseCost(12, R(bothBands, 'fast')).band, 'fast');

console.log('\n[cost-customization] engine — malformed input fails closed to list price');
// A typo in stored JSON must show the book price, never 0 gp — the same fail-closed posture
// economySetting() takes on an unknown band token.
check('unknown mode', cost(12, R({ standard: { '15': { gp: { mode: 'wat', value: 5 } } } })), [350, 42]);
check('non-numeric value', cost(12, R({ standard: { '15': { gp: { mode: 'mult', value: 'lots' } } } })), [350, 42]);
check('null rule', cost(12, R({ standard: { '15': { gp: null } } })), [350, 42]);
check('rowCosts not an object', cost(12, R('nonsense')), [350, 42]);
check('a key matching no row is simply ignored', cost(12, R({ standard: { '999': { gp: { mode: 'mult', value: 9 } } } })), [350, 42]);
check('an unknown band key is ignored', cost(12, R({ nosuchband: { '15': { gp: { mode: 'mult', value: 9 } } } })), [350, 42]);
check('customisation cannot switch the economy on while it is off',
  purchaseCost(12, { economy: { band: 'off', rowCosts: { off: { '15': { gp: { mode: 'flat', value: 5 } } } } } }), null);

console.log('\n[cost-customization] engine — the downtime PHRASE follows the number');
// economy-bands.js stores the canonical integer (`days`) and the guide's own wording (`time`) as two
// separate fields. A customised row that kept its original phrase would print "6 weeks" beside a
// 21-day cost — the label would simply lie. This is the gotcha this feature most easily reintroduces.
const halfTime = purchaseCost(12, R({ standard: { '15': { days: { mode: 'mult', value: 0.5 } } } }));
check('42 d -> 21 d relabels "6 weeks" as "3 weeks"', [halfTime.days, halfTime.time], [21, '3 weeks']);
check('the phrase agrees with formatDowntime()', halfTime.time, formatDowntime(halfTime.days));
const zeroTime = purchaseCost(12, R({ standard: { '15': { days: { mode: 'flat', value: 0 } } } }));
check('a zeroed row reads "None", like a genuinely free band row', zeroTime.time, 'None');
check('a row whose days did NOT change keeps its original wording',
  purchaseCost(12, R({ standard: { '15': { gp: { mode: 'mult', value: 2 } } } })).time, '6 weeks');
check('priceLabel() prints the customised figures', priceLabel(12, R({ standard: { '15': { gp: { mode: 'flat', value: 500 }, days: { mode: 'flat', value: 21 } } } })), '12 AP · 500 gp · 3 weeks');

console.log('\n[cost-customization] engine — a customised row reports its list price too');
const cust = purchaseCost(12, R({ standard: { '15': { gp: { mode: 'mult', value: 2 } } } }));
check('customised flag is set', cust.customised, true);
check('listGp / listDays carry the book figures', [cust.listGp, cust.listDays], [350, 42]);
const plain = purchaseCost(12, 'standard');
check('an uncustomised row is not flagged', plain.customised, false);
check('...and reports itself as its own list price', [plain.listGp, plain.listDays], [350, 42]);

console.log('\n[cost-customization] engine — history is NOT re-priced');
// The guarantee that makes this safe to change mid-campaign. _paidFor() prefers the gp/days frozen
// onto each purchase event; customisation only ever moves the LIST price, i.e. future purchases.
const log = [
  { seq: 1, type: 'creationLocked' },
  { seq: 2, type: 'buy', cat: 'feature', cost: 12, label: 'Bought at list', gp: 350, days: 42 },
  { seq: 3, type: 'buy', cat: 'feature', cost: 12, label: 'Bought at list too', gp: 350, days: 42 },
];
const doubled = R({ standard: { '15': { gp: { mode: 'mult', value: 2 }, days: { mode: 'mult', value: 2 } } } });
const ledPlain = wealthLedger(log, { band: 'standard' });
const ledCust = wealthLedger(log, { band: doubled });
check('two frozen purchases total 700 gp / 84 d at list', [ledPlain.gpSpent, ledPlain.daysSpent], [700, 84]);
check('...and STILL 700 gp / 84 d after the DM doubles the row', [ledCust.gpSpent, ledCust.daysSpent], [700, 84]);
check('the ledger reports the band it priced under', ledCust.band, 'standard');
// An unfrozen event (no gp/days on it) is the one that legitimately follows the new list price.
const unfrozen = [{ seq: 1, type: 'creationLocked' }, { seq: 2, type: 'buy', cat: 'feature', cost: 12, label: 'no frozen figures' }];
check('an event carrying no frozen figures pays list', [wealthLedger(unfrozen, { band: 'standard' }).gpSpent, wealthLedger(unfrozen, { band: 'standard' }).daysSpent], [350, 42]);
check('...and follows the customised list once the DM doubles it',
  [wealthLedger(unfrozen, { band: doubled }).gpSpent, wealthLedger(unfrozen, { band: doubled }).daysSpent], [700, 84]);
check('a frozen purchase is flagged discounted against the CUSTOMISED list',
  wealthLedger(log, { band: doubled }).entries[0].discounted, true);
check('wealthLedger accepts rowCosts via opts.rules as well as opts.band',
  wealthLedger(unfrozen, { rules: doubled }).gpSpent, 700);
check('creation purchases stay free of coin and time even when customised',
  wealthLedger([{ seq: 1, type: 'buy', cat: 'feature', cost: 12 }], { band: doubled }).gpSpent, 0);

// =================================================================================================
// PART 2 — the tools (Chromium over CDP)
// =================================================================================================
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
               '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
function serve() {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/PACT\//, '');
      const f = path.join(REPO, rel);
      if (!f.startsWith(REPO) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      res.end(fs.readFileSync(f));
    });
    s.listen(PORT, () => resolve(s));
  });
}
async function connect(url) {
  const t = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise(r => (ws.onopen = r));
  const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise(r => pending.set(i, r)); };
  await send('Page.enable'); await send('Runtime.enable');
  return {
    close: async () => { ws.close(); await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${t.id}`); },
    async evaluate(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      const ex = r.result?.exceptionDetails;
      if (ex) throw new Error('page threw: ' + (ex.exception?.description || ex.text || 'unknown') + `\n    while evaluating: ${expr.slice(0, 160)}`);
      return r.result?.result?.value;
    }
  };
}
// The tools boot on `engine-ready` from a deferred module, so classic-script globals exist before the
// bridge does. Poll a BRIDGED symbol, never a classic one. Same 30s budget as tool-pricing-ci.mjs.
const READY = (probe) => `(async()=>{for(let i=0;i<300;i++){if(${probe})return true;await new Promise(r=>setTimeout(r,100));}return false;})()`;

function findChrome() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (fs.existsSync(root)) {
    for (const d of fs.readdirSync(root).filter(x => x.startsWith('chromium')).sort().reverse()) {
      for (const rel of ['chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome']) {
        const p = path.join(root, d, rel);
        if (fs.existsSync(p)) return p;
      }
    }
    if (fs.existsSync(path.join(root, 'chromium'))) return path.join(root, 'chromium');
  }
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
                   '/usr/bin/google-chrome-stable',
                   '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function report() {
  console.log(`\n${fail ? '✗' : '✓'} ${pass} passed / ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

if (process.env.SKIP_BROWSER) {
  console.log('\n[cost-customization] SKIP_BROWSER set — tool half not run.');
  report();
}

const chrome = findChrome();
if (!chrome) {
  console.error('\nNo Chromium found. Set CHROME_BIN, or PLAYWRIGHT_BROWSERS_PATH to a cache holding one.');
  console.error('(The engine half above still ran — re-run with SKIP_BROWSER=1 to make that explicit.)');
  process.exit(2);
}
const server = await serve();
const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${fs.mkdtempSync('/tmp/pact-costcust-')}`, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeErr = '', chromeExit = null;
proc.stderr.on('data', d => { chromeErr += d.toString().slice(0, 4000); });
proc.on('exit', c => { chromeExit = c; });
proc.on('error', e => { chromeErr += `spawn error: ${e.message}\n`; });

let cdpUp = false;
for (let i = 0; i < 300; i++) {
  try { await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`); cdpUp = true; break; }
  catch { await new Promise(r => setTimeout(r, 100)); }
}
if (!cdpUp) {
  console.error(`\n✗ Chromium never opened its DevTools port ${CDP_PORT} within 30s.`);
  console.error(`  binary: ${chrome}\n  exited: ${chromeExit === null ? 'no' : chromeExit}\n  stderr: ${chromeErr.trim() || '(nothing)'}`);
  console.error('  This is an ENVIRONMENT failure, not a pricing regression.');
  try { proc.kill(); } catch {}
  server.close();
  process.exit(3);
}

try {
  // ---------------------------- DM Console: the editor ----------------------------
  const dm = await connect(`http://127.0.0.1:${PORT}/PACT/tools/DM-Console.html`);
  if (!(await dm.evaluate(READY(`window._engineEcon&&window._dmEconRows&&window.DATA&&DATA.economyBands`))))
    throw new Error('DM Console never became ready (engine-ready did not fire?)');

  console.log('\n[cost-customization] DM Console — the row editor');
  check('the engine bridge carries effectiveBandRows/bandRowKey',
    await dm.evaluate(`typeof _engineEcon.effectiveBandRows==='function'&&typeof _engineEcon.bandRowKey==='function'`), true);

  // Round-trip: load stored rules into the editor, read back what it would save. This is the
  // property that matters — a DM's settings must survive save -> reload -> save unchanged.
  const stored = { standard: { '15': { gp: { mode: 'mult', value: 2 }, days: { mode: 'flat', value: 10 } }, top: { gp: { mode: 'flat', value: 25000 } } },
                   fast: { '10': { days: { mode: 'mult', value: 0.5 } } } };
  check('stored rowCosts round-trip through the editor unchanged',
    await dm.evaluate(`(()=>{_dmEconRows.load({economy:{band:'standard',rowCosts:${JSON.stringify(stored)}}});return JSON.stringify(_dmEconRows.collect());})()`),
    JSON.stringify(stored));
  check('a campaign with no customisation collects null (writes no rowCosts key)',
    await dm.evaluate(`(()=>{_dmEconRows.load({economy:{band:'standard'}});return _dmEconRows.collect();})()`), null);
  check('a row left on List stores nothing',
    await dm.evaluate(`(()=>{_dmEconRows.load({});_dmEconRows.set('standard','15','gp',{mode:'mult',value:2});_dmEconRows.set('standard','15','gp',null);return _dmEconRows.collect();})()`), null);
  check('malformed stored entries are dropped on load, not carried through',
    await dm.evaluate(`(()=>{_dmEconRows.load({economy:{band:'standard',rowCosts:{standard:{'15':{gp:{mode:'wat',value:1}},'5':{gp:{mode:'flat',value:9}}}}}});return JSON.stringify(_dmEconRows.collect());})()`),
    JSON.stringify({ standard: { '5': { gp: { mode: 'flat', value: 9 } } } }));

  console.log('\n[cost-customization] DM Console — the editor renders and previews');
  // The band <select> is populated by _renderEconomyBandOptions() on campaign SELECT, which needs a
  // signed-in DM. Seed its options directly so the editor can be driven without one — and assert the
  // seeding worked, because setting .value on an optionless <select> silently leaves it '', which
  // would make every "hidden" assertion below pass for entirely the wrong reason.
  check('the band select can be seeded with all three settings',
    await dm.evaluate(`(()=>{const el=document.getElementById('ruleEconomyBand');
      el.innerHTML=['off','standard','fast'].map(k=>'<option value="'+k+'">'+DATA.economyBands[k].label+'</option>').join('');
      el.value='standard';return el.value;})()`), 'standard');
  check('the editor is hidden while the economy is off',
    await dm.evaluate(`(()=>{document.getElementById('ruleEconomyBand').value='off';_dmEconRows.render();
      return [document.getElementById('ruleEconomyRows').hidden, document.getElementById('ruleEconomyRowGrid').children.length];})()`), [true, 0]);
  check('...and shown on Standard, one block per band row',
    await dm.evaluate(`(()=>{document.getElementById('ruleEconomyBand').value='standard';_dmEconRows.load({});_dmEconRows.render();
      return [document.getElementById('ruleEconomyRows').hidden, document.getElementById('ruleEconomyRowGrid').children.length];})()`),
    [false, DATA.economyBands.standard.rows.length]);
  check('Fast renders its own (shorter) row list',
    await dm.evaluate(`(()=>{document.getElementById('ruleEconomyBand').value='fast';_dmEconRows.render();return document.getElementById('ruleEconomyRowGrid').children.length;})()`),
    DATA.economyBands.fast.rows.length);
  // The three modes are one radio group per row per currency, so the browser itself enforces that a
  // multiplier and a flat override cannot both be set (the owner's C3 choice).
  check('each currency offers exactly three mutually-exclusive modes, in one named group',
    await dm.evaluate(`(()=>{document.getElementById('ruleEconomyBand').value='standard';_dmEconRows.render();
      const rs=[...document.querySelectorAll('[data-econ-mode][data-row="15"][data-cur="gp"]')];
      return [rs.length, new Set(rs.map(r=>r.name)).size, rs.map(r=>r.value).join(',')];})()`),
    [3, 1, 'list,mult,flat']);
  // A fractional multiplier (x0.5) is the owner's own example, and step="1" would mark it invalid and
  // put it out of the spinner's reach — the value box must follow the MODE, not the currency.
  check('a multiplier box accepts fractions; a flat box steps in whole units',
    await dm.evaluate(`(()=>{document.getElementById('ruleEconomyBand').value='standard';
      _dmEconRows.load({economy:{band:'standard',rowCosts:{standard:{'15':{gp:{mode:'mult',value:0.5},days:{mode:'flat',value:10}}}}}});_dmEconRows.render();
      const g=document.querySelector('[data-econ-val][data-row="15"][data-cur="gp"]');
      const d=document.querySelector('[data-econ-val][data-row="15"][data-cur="days"]');
      return [g.getAttribute('step'), g.value, g.checkValidity(), d.getAttribute('step')];})()`),
    ['any', '0.5', true, '1']);
  check('the preview shows the customised figures beside the list price',
    await dm.evaluate(`(()=>{document.getElementById('ruleEconomyBand').value='standard';
      _dmEconRows.load({economy:{band:'standard',rowCosts:{standard:{'15':{gp:{mode:'mult',value:2}}}}}});_dmEconRows.render();
      const el=document.querySelector('[data-econ-preview="15"]');return el?el.textContent.replace(/\\s+/g,' ').trim():'(missing)';})()`),
    '700 gp · 6 weeks (list 350 gp · 6 weeks)');
  check('an uncustomised row previews the plain list price',
    await dm.evaluate(`(()=>{const el=document.querySelector('[data-econ-preview="5"]');return el?el.textContent.replace(/\\s+/g,' ').trim():'(missing)';})()`),
    '25 gp · 1 week');
  // Escaping: the grid interpolates band tokens and row keys into attributes. They are engine-derived
  // today, but AGENTS.md makes esc() a hard invariant for anything reaching an attribute, and the
  // preview text carries a row's `ap`/`time` strings straight from the dataset.
  check('the rendered grid opens no unescaped attribute or tag',
    await dm.evaluate(`(()=>{const h=document.getElementById('ruleEconomyRowGrid').innerHTML;return /<script|onerror=|onload=/i.test(h);})()`), false);
  await dm.close();

  // ---------------------------- CharGen: prices follow the campaign ----------------------------
  // The half that silently regresses: the engine can be perfect while a tool hands purchaseCost() a
  // bare band token, losing every customisation with no error raised anywhere.
  const cg = await connect(`http://127.0.0.1:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`);
  if (!(await cg.evaluate(READY(`window._engineEcon&&window.DATA&&typeof _cgEconRules==='function'`))))
    throw new Error('CharGen never became ready (engine-ready did not fire?)');

  console.log('\n[cost-customization] CharGen quotes the campaign\'s customised prices');
  const bindCG = (rowCosts) => `(()=>{window._cgCampaignBound=true;
      window._cloudCampaign={rules:{economy:{band:'standard',rowCosts:${JSON.stringify(rowCosts)}}}};
      const c=_engineEcon.purchaseCost(12,_cgEconRules());return [c.gp,c.days];})()`;
  // An unbound character resolves to a bare token, never a rules object — that is precisely what
  // makes campaign customisation unreachable for a solo player, so assert the SHAPE, not a price.
  // (A fresh character's own band is 'off', so asserting a price here would prove nothing.)
  check('an uncampaigned character resolves to a bare band token, carrying no customisation',
    await cg.evaluate(`(()=>{window._cgCampaignBound=false;window._cloudCampaign=null;return typeof _cgEconRules();})()`), 'string');
  check('...and a bound one resolves to a rules object carrying rowCosts',
    await cg.evaluate(`(()=>{window._cgCampaignBound=true;
      window._cloudCampaign={rules:{economy:{band:'standard',rowCosts:{standard:{'15':{gp:{mode:'mult',value:2}}}}}}};
      const r=_cgEconRules();return [typeof r, !!(r&&r.economy&&r.economy.rowCosts)];})()`), ['object', true]);
  check('a bound character sees the campaign\'s doubled gold',
    await cg.evaluate(bindCG({ standard: { '15': { gp: { mode: 'mult', value: 2 } } } })), [700, 42]);
  check('...and a flat override', await cg.evaluate(bindCG({ standard: { '15': { gp: { mode: 'flat', value: 500 }, days: { mode: 'flat', value: 10 } } } })), [500, 10]);
  check('unbinding drops the customisation even with campaign rules still in memory',
    await cg.evaluate(`(()=>{window._cgCampaignBound=false;return typeof _cgEconRules();})()`), 'string');
  await cg.close();

  // ---------------------------- Live Sheet: prices and ledger ----------------------------
  const ls = await connect(`http://127.0.0.1:${PORT}/PACT/tools/PACT-Live-Char-Sheet.html`);
  if (!(await ls.evaluate(READY(`window._engineEcon&&window.DATA&&typeof _lsEconRules==='function'`))))
    throw new Error('Live Sheet never became ready (engine-ready did not fire?)');

  console.log('\n[cost-customization] Live Sheet quotes and tallies the campaign\'s prices');
  const bindLS = (rowCosts) => `(()=>{window._rulesStatus='active';
      window._cloudCampaignRules={economy:{band:'standard',rowCosts:${JSON.stringify(rowCosts)}}};
      const c=_engineEcon.purchaseCost(12,_lsEconRules(null));return [c.gp,c.days];})()`;
  check('the campaign\'s doubled row reaches the Live Sheet',
    await ls.evaluate(bindLS({ standard: { '15': { gp: { mode: 'mult', value: 2 }, days: { mode: 'mult', value: 2 } } } })), [700, 84]);
  // Unresolved campaign rules must NOT reach for the campaign's customisation — the tool falls back
  // to the character's own band (a bare token, hence book prices), which is the honest local answer
  // rather than a guess at the table's. Assert the shape: a fresh character's own band is 'off', so
  // a price assertion here would prove nothing.
  check('unresolved campaign rules drop to a bare token, carrying no customisation',
    await ls.evaluate(`(()=>{window._rulesStatus='unavailable';return typeof _lsEconRules(null);})()`), 'string');
  check('...and an active campaign resolves to a rules object carrying rowCosts',
    await ls.evaluate(`(()=>{window._rulesStatus='active';
      window._cloudCampaignRules={economy:{band:'standard',rowCosts:{standard:{'15':{gp:{mode:'mult',value:2}}}}}};
      const r=_lsEconRules(null);return [typeof r, !!(r&&r.economy&&r.economy.rowCosts)];})()`), ['object', true]);
  check('the wealth ledger charges the customised price for an unfrozen purchase',
    await ls.evaluate(`(()=>{window._rulesStatus='active';
      window._cloudCampaignRules={economy:{band:'standard',rowCosts:{standard:{'15':{gp:{mode:'mult',value:2}}}}}};
      const led=_engineEcon.wealthLedger([{seq:1,type:'creationLocked'},{seq:2,type:'buy',cat:'feature',cost:12}],{band:_lsEconRules(null)});
      return led.gpSpent;})()`), 700);
  check('...and still honours a frozen purchase\'s own price',
    await ls.evaluate(`(()=>{const led=_engineEcon.wealthLedger([{seq:1,type:'creationLocked'},{seq:2,type:'buy',cat:'feature',cost:12,gp:350,days:42}],{band:_lsEconRules(null)});
      return [led.gpSpent,led.daysSpent];})()`), [350, 42]);
  await ls.close();
} catch (e) {
  fail++;
  console.log(`  FAIL harness — ${e.message}`);
} finally {
  try { proc.kill(); } catch {}
  server.close();
}

report();
