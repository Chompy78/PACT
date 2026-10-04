/* PACT — wounds in the three tools: players can't pick the DM-only ones, a DM can impose all of them.
 *
 * feat/permanent-wounds (D-GH-2026-10-04-permanent-wounds). The four NEW wound entries (Maimed Hand, Bad Knee, Brittle
 * Bones, Withered Arm) exist only for a DM to impose. They are hidden from players by living in DATA.drawbacks but NOT in
 * DATA.drawbackList, and by one explicit filter in CharGen's grid. This proves, in a real browser, that:
 *
 *   1. CharGen's drawback grid does not offer them — but still shows one the character ALREADY holds (a DM imposed it),
 *      checked, so it can't vanish from view;
 *   2. the Live Sheet's drawback panel does not offer them;
 *   (The DM Console half — every wound offered, grouped wounds-first, Locked + flat by default, and what Impose sends — moved to
 *   dm-impose-picker-e2e.mjs when the impose dropdown became a pop-up picker.)
 *
 * No Supabase, no sign-in: characters are seeded into localStorage / applied as envelopes, and bridge calls are stubbed and
 * recorded. Every "not offered" check has a control that the panel really rendered (otherwise an empty result could just
 * mean the panel never drew).
 *
 *   node testing/scripts/wounds-ui-e2e.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = 7995;   // distinct from cloud-e2e 7970 / seed 7971 / dm-console-ui 7973 / chargen-flows 7979 / protected-roundtrip 7991 / live-sheet-unlock 7992 / dm-console-unlock 7994
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

const NEW = ['Maimed Hand', 'Bad Knee', 'Brittle Bones', 'Withered Arm'];
const browser = await launchChromium();

// ---- 1. CharGen ------------------------------------------------------------------------------------------------------
console.log('CharGen — the drawback grid');
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && typeof window.buildDrawGrid === 'function' && typeof window._cgApplyEnvelope === 'function', { timeout: 25000 });
  await page.evaluate(() => window.buildDrawGrid());
  const grid = await page.evaluate(() => (document.getElementById('drawgrid') || {}).textContent || '');
  check('CONTROL: the grid really rendered (an ordinary drawback and a Grievous one are listed)', /Lame/.test(grid) && /Missing Arm/.test(grid), `${grid.length} chars`);
  check('none of the four wound-only entries is offered', NEW.filter(n => grid.includes(n)).length === 0, NEW.filter(n => grid.includes(n)).join(', '));
  check('reused wounds stay takable (Peg Leg, Old Wound, Trembling Hands are listed)', ['Peg Leg', 'Old Wound', 'Trembling Hands'].every(n => grid.includes(n)));

  // A DM imposes Bad Knee; the character is opened in CharGen: it must stay visible and checked.
  const held = await page.evaluate(() => {
    const V = window.DATA.version;
    const ev = (o, i) => Object.assign({ seq: i + 1, ts: 1000 + i, rules: V }, o);
    const LOG = [
      ev({ type: 'buy', cat: 'oclass', payload: { v: 'Fighter' }, cost: 0, level: 1, label: 'Fighter' }, 0),
      ev({ type: 'award', amount: 79, cost: 0, label: 'budget', noLock: true }, 1),
      ev({ type: 'buy', cat: 'drawback', payload: { v: 'Bad Knee' }, cost: 0, level: 1, dmEdit: true, dmId: 'dm', dmLocked: true, dmRemovalCost: 'flat', label: 'Wound — Bad Knee (DM imposed)' }, 2),
    ];
    window._cgApplyEnvelope({ schema: 'pact-character/1', rules: V, name: 'Wounded', LOG, SEQ: LOG.length + 1, id: '11111111-2222-3333-4444-555555555555' }, { clearHistory: true });
    window.buildDrawGrid();
    const box = document.querySelector('#drawgrid input.drawck[value="Bad Knee"]');
    return { listed: !!box, checked: !!(box && box.checked), buildHolds: (typeof readBuild === 'function' ? readBuild().drawbacks : []).includes('Bad Knee') };
  });
  check('a character HOLDING an imposed wound still lists it in the grid', held.listed);
  check('...checked', held.checked);
  check('...and its build really holds it', held.buildHolds);
  const after = await page.evaluate(() => (document.getElementById('drawgrid') || {}).textContent || '');
  check('...but the OTHER wound-only entries remain hidden', ['Maimed Hand', 'Brittle Bones', 'Withered Arm'].every(n => !after.includes(n)));
  check('no page errors', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

// ---- 2. Live Sheet ---------------------------------------------------------------------------------------------------
console.log('Live Sheet — the drawback panel');
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  const LOG = [
    { type: 'award', amount: 79, seq: 1, label: 'Award' },
    { type: 'buy', cat: 'oclass', payload: { v: 'Fighter' }, cost: 0, level: 1, seq: 2, label: 'Fighter' },
  ];
  await page.addInitScript((env) => { try { localStorage.setItem('pactLiveSheet', JSON.stringify(env)); } catch (e) {} },
    { schema: 'pact-character/1', LOG, SEQ: LOG.length + 1 });
  await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window._engineFold && typeof window.takeDrawback === 'function'
    && document.body && document.body.textContent.length > 2000, { timeout: 25000 });
  // The buy panel draws each section LAZILY, only while it is open, so open the drawbacks section (and its category) the way a
  // player would — a first version of this check read the page without doing so, saw no drawbacks at all, and "passed" the
  // not-offered check vacuously; the control below is what caught it.
  await page.evaluate(() => { grpOpen['Drawbacks (gain AP)'] = 1; Object.keys(catOpen).forEach(k => { catOpen[k] = 1; }); refreshBuy(); });
  await page.waitForFunction(() => document.body.textContent.includes('Peg Leg'), { timeout: 10000 });
  const text = await page.evaluate(() => document.body.textContent);
  check('CONTROL: the drawback panel really rendered (ordinary drawbacks are offered)', ['Lame', 'Peg Leg', 'Missing Arm'].every(n => text.includes(n)));
  check('none of the four wound-only entries is offered', NEW.filter(n => text.includes(n)).length === 0, NEW.filter(n => text.includes(n)).join(', '));
  check('no page errors', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} passed / ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
