/* PACT — Live Sheet: a DM-unlocked drawback can be bought off, a locked one cannot.
 *
 * feat/dm-unlock-drawback (D-GH-2026-10-04-dm-unlock-drawback). The Live Sheet decides in TWO places whether
 * an imposed, locked drawback may be bought off: buyoffDrawback() (the action) and the ledger row (the "🔒
 * locked" label vs the buy-off button). Both read activeEvents().unlocked through _unlockOf(). If either
 * ignores an unlock, a player sees "locked" beside a drawback their DM already released, or — worse — the
 * button is offered for one that is still locked. The pure-Node gate (dm-unlock-drawback-ci.mjs) pins the
 * engine's matching; this one proves the page actually uses it.
 *
 * Also pinned here, because it is the only place the page renders it: the DM's story beat is free text from
 * ANOTHER user, shown in a title="" attribute in the player's browser, so it must be escaped (hard project
 * rule: every user-controlled value that reaches innerHTML/an attribute goes through esc()).
 *
 * No Supabase, no sign-in: the character is seeded straight into localStorage, the same way a signed-out
 * player's autosave survives a reload. Honest limit: this checks the app's behaviour. The lock is honoured
 * by the app, not enforced by the server (see feat/server-enforced-drawback-lock).
 *
 *   node testing/scripts/live-sheet-unlock-e2e.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = 7992;   // distinct from cloud-e2e 7970 / seed 7971 / dm-console-ui 7973 / chargen-flows 7979 / protected-roundtrip 7991
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json',
               '.css':'text/css','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml' };
const server = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/PACT\/?/, '') || 'index.html';
  fs.readFile(path.join(REPO, rel), (e, d) => {
    if (e) { r.writeHead(404); return r.end('not found'); }
    r.writeHead(200, { 'Content-Type': MIME[path.extname(rel)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    r.end(d);
  });
});
await new Promise(r => server.listen(PORT, r));

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

const award = { type: 'award', amount: 79, seq: 1, label: 'Award — Level 1 (79 AP)' };
const oclass = { type: 'buy', cat: 'oclass', payload: { v: 'Fighter' }, cost: 0, level: 1, seq: 2, label: 'Origin class — Fighter' };
const taken = (seq) => ({ type: 'buy', cat: 'drawback', payload: { v: 'Peg Leg' }, cost: -4, level: 1, seq, label: 'Drawback — Peg Leg (+4 AP)' });
const imposed = (seq) => ({ type: 'buy', cat: 'drawback', payload: { v: 'Peg Leg' }, cost: 0, level: 1, seq, dmEdit: true, dmId: 'dm', dmLocked: true, dmRemovalCost: 'flat', label: 'Drawback — Peg Leg (DM imposed)' });
const unlock = (seq, targetSeq, note) => ({ type: 'dmUnlockDrawback', refVal: 'Peg Leg', targetSeq, note, seq, dmEdit: true, dmId: 'dm', label: 'DM unlocked — Peg Leg' });

async function open(browser, LOG) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('dialog', d => d.accept());   // confirm() -> OK, so a buy-off is never stalled by an economy prompt
  await page.addInitScript((env) => { try { localStorage.setItem('pactLiveSheet', JSON.stringify(env)); } catch (e) {} },
    { schema: 'pact-character/1', LOG, SEQ: LOG.length + 1 });
  await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' });
  // Wait on the condition, never a bare sleep — the bridge lands on engine-ready, after the deferred module.
  await page.waitForFunction(() => window.DATA && window._engineFold && typeof window.buyoffDrawback === 'function'
    && document.getElementById('ledger') && document.getElementById('ledger').innerHTML.length > 50, { timeout: 25000 });
  return { page, errs, close: () => ctx.close() };
}
const ledgerRows = (page) => page.evaluate(() =>
  [...document.querySelectorAll('#ledger tr')].map(tr => ({ html: tr.innerHTML, text: tr.textContent })));

const browser = await launchChromium();

console.log('Case 1 — imposed LOCKED, no unlock');
{
  const { page, errs, close } = await open(browser, [award, oclass, imposed(3)]);
  const row = (await ledgerRows(page)).find(r => /DM imposed/.test(r.text));
  check('the imposed row shows 🔒 locked', !!row && /🔒 locked/.test(row.text));
  check('...and offers NO buy-off button', !!row && !/buy off/.test(row.text));
  const before = await page.evaluate(() => LOG.length);
  await page.evaluate(() => buyoffDrawback('Peg Leg'));
  const after = await page.evaluate(() => LOG.length);
  check('buyoffDrawback() on a locked drawback does nothing (log unchanged)', before === after, `${before} -> ${after}`);
  check('no page errors', errs.length === 0, errs.join(' | '));
  await close();
}

console.log('Case 2 — imposed, then UNLOCKED with a story beat');
{
  const { page, errs, close } = await open(browser, [award, oclass, imposed(3), unlock(4, 3, 'Found the surgeon')]);
  const rows = await ledgerRows(page);
  const row = rows.find(r => /DM imposed/.test(r.text));
  check('the row no longer says locked', !!row && !/🔒 locked/.test(row.text));
  check("...shows 🔓 with the DM's note as a tooltip", !!row && /🔓/.test(row.text) && /Unlocked by your DM — Found the surgeon/.test(row.html));
  check('...and offers the (flat) buy-off button again', !!row && /buy off \(flat\)/.test(row.text));
  check('the unlock event has its own ledger row, tagged as a DM edit',
    rows.some(r => /DM unlocked/.test(r.text) && /DM/.test(r.html)));
  const before = await page.evaluate(() => LOG.length);
  await page.evaluate(() => buyoffDrawback('Peg Leg'));
  const last = await page.evaluate(() => LOG[LOG.length - 1]);
  check('buyoffDrawback() now proceeds: a buyoff event is appended at the flat price (4 AP)',
    last && last.type === 'buyoff' && last.refVal === 'Peg Leg' && last.cost === 4, JSON.stringify(last));
  check('...and the log grew by exactly one event', (await page.evaluate(() => LOG.length)) === before + 1);
  check('no page errors', errs.length === 0, errs.join(' | '));
  await close();
}

console.log('Case 3 — a player-taken AND an imposed Peg Leg (the case seq-keying exists for)');
{
  // taken seq 3, imposed seq 4, the unlock targets the IMPOSED one only.
  const { page, errs, close } = await open(browser, [award, oclass, taken(3), imposed(4), unlock(5, 4, 'beat')]);
  const rows = await ledgerRows(page);
  const t = rows.find(r => /\+4/.test(r.text) && /Peg Leg/.test(r.text) && !/DM imposed/.test(r.text));
  const i = rows.find(r => /DM imposed/.test(r.text));
  check('the OLDER (player-taken) drawback has the buy-off button, at the ordinary 3x price', !!t && /buy off 3×/.test(t.text));
  check('the NEWER, imposed one shows 🔓 but NO button: it waits for the older one (a click would remove that one instead)',
    !!i && /🔓/.test(i.text) && !/buy off/.test(i.text) && /waits for the older one/.test(i.text), i && i.text);
  await page.evaluate(() => buyoffDrawback('Peg Leg'));
  const last = await page.evaluate(() => LOG[LOG.length - 1]);
  check('a buy-off cancels the OLDEST purchase (the player-taken one) at the 3x price (12 AP) — FIFO untouched',
    last && last.type === 'buyoff' && last.cost === 12, JSON.stringify(last));
  // Now the imposed purchase IS the oldest open one: it gets the button, and the DM's flat rate really applies.
  const rows2 = await ledgerRows(page);
  const i2 = rows2.find(r => /DM imposed/.test(r.text));
  check('...and the imposed drawback now has its (flat) buy-off button', !!i2 && /buy off \(flat\)/.test(i2.text) && !/waits for the older/.test(i2.text), i2 && i2.text);
  await page.evaluate(() => buyoffDrawback('Peg Leg'));
  const last2 = await page.evaluate(() => LOG[LOG.length - 1]);
  check('...and buying it off charges the DM\'s flat price (4 AP) — the rate the unlocked row promised',
    last2 && last2.type === 'buyoff' && last2.cost === 4, JSON.stringify(last2));
  check('no page errors', errs.length === 0, errs.join(' | '));
  await close();
}

console.log('Case 3b — the reverse: an OLDER locked imposed drawback and a NEWER player-taken one of the same name');
{
  // imposed LOCKED seq 3 (older), player-taken seq 4 (newer), no unlock.
  const { page, errs, close } = await open(browser, [award, oclass, imposed(3), taken(4)]);
  const rows = await ledgerRows(page);
  const imp = rows.find(r => /DM imposed/.test(r.text));
  const tkn = rows.find(r => /\+4/.test(r.text) && /Peg Leg/.test(r.text) && !/DM imposed/.test(r.text));
  check('the older imposed one shows 🔒 locked', !!imp && /🔒 locked/.test(imp.text));
  check('the newer player-taken one has NO button either — it waits behind the locked one', !!tkn && !/buy off/.test(tkn.text) && /waits for the older one/.test(tkn.text), tkn && tkn.text);
  const before = await page.evaluate(() => LOG.length);
  await page.evaluate(() => buyoffDrawback('Peg Leg'));
  check('and a buy-off attempt does nothing while the older one is locked', (await page.evaluate(() => LOG.length)) === before);
  check('no page errors', errs.length === 0, errs.join(' | '));
  await close();
}

console.log('Case 4 — a hostile story beat is escaped, not executed');
{
  const evil = '"><img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
  const { page, errs, close } = await open(browser, [award, oclass, imposed(3), unlock(4, 3, evil)]);
  const injected = await page.evaluate(() => window.__xss);
  check('no script ran from the note', injected === undefined, String(injected));
  check('no <img> element was injected into the ledger', (await page.evaluate(() => !!document.querySelector('#ledger img'))) === false);
  const row = (await ledgerRows(page)).find(r => /DM imposed/.test(r.text));
  check('the note text still reaches the tooltip, escaped', !!row && /&lt;img/.test(row.html) && !/<img/.test(row.html));
  check('no page errors', errs.length === 0, errs.join(' | '));
  await close();
}

await browser.close();
server.close();
console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} passed / ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
