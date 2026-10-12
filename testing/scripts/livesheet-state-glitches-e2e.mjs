/* PACT — Live Sheet state glitches (fix/livesheet-state-glitches, audit 2026-10-12).
 *   1. Buy-off: no buy-off button in the time-travel view; buyoffDrawback() refuses while scrubbed and when there is no open
 *      purchase to remove (it used to charge 3x and append an orphan buyoff).
 *   2. Finish creating goes through emit(): refused in the DM read-only view, clears Redo.
 *   3. DM read-only view: Sheet inputs are read-only and typing writes nothing to this browser's scratch store.
 *   4. Reset clears the old campaign name from the header.
 *   5. The Needs-review tray does not show present-day issues under a past (scrubbed) sheet.
 *   6. A cost-0 appearance-only event at the LOG TAIL (written by an older Live Sheet) is stepped over by Undo — the last real
 *      action is undone, hair/playerSheet survive — and Redo puts the action back in its original place. A barrier still holds.
 *   7. CharGen Sheet: typing a sentence into an appearance field keeps focus and is ONE undo step, not one per key.
 *
 *   node testing/scripts/livesheet-state-glitches-e2e.mjs        (expect 0 failed)
 *   PACT_REPO=<other checkout> node …                             runs the same cases against another checkout (old code)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = process.env.PACT_REPO || path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = 7993;
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
const base = `http://localhost:${PORT}/PACT`;
const LS_URL = `${base}/tools/PACT-Live-Char-Sheet.html`, CG_URL = `${base}/tools/PACT-CharGen-Webtool.html`;

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };
const section = t => console.log(`\n[state-glitches] == ${t} ==`);
const safe = async (fn, dflt = null) => { try { return await fn(); } catch (e) { return dflt; } };

const IDENT = { type: 'buy', cat: 'patch', cost: 0, label: 'Identity',
  payload: { patch: { species: 'Human', originClass: 'Rogue', hd: 3, stats: { STR: 10, DEX: 14, CON: 12, INT: 10, WIS: 12, CHA: 10 } } } };
const seqd = evs => evs.map((e, i) => ({ seq: i + 1, ...e }));
const BASE = [
  { type: 'award', amount: 200, label: 'Award', noLock: true },
  IDENT,
  { type: 'name', name: 'Tamsin' },
];
const DRAWBACK = { type: 'buy', cat: 'drawback', cost: -2, payload: { v: 'Asthmatic' }, label: 'Drawback — Asthmatic' };
const BUYOFF = { type: 'buyoff', refVal: 'Asthmatic', cost: 6, label: 'Bought off — Asthmatic' };
const SKILL = { type: 'buy', cat: 'skill', cost: 1, payload: { v: 'Stealth' }, label: 'Skill: Stealth' };
const TAIL_APP = { type: 'buy', cat: 'patch', cost: 0, label: 'Appearance & description (0 AP)',
  payload: { patch: { appearance: { hair: 'red braid', playerSheet: { gp: 37 } } } } };

const browser = await launchChromium();
async function lsPage(LOG, id = 'id-glitch') {
  const ctx = await browser.newContext();
  await ctx.addInitScript(({ env }) => {
    try { if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); localStorage.setItem('pactLiveSheet', JSON.stringify(env)); } } catch (e) {}
  }, { env: { schema: 'pact-character/1', name: 'Tamsin', id, LOG, SEQ: LOG.length + 1 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  page.on('dialog', d => d.accept());
  await page.goto(LS_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.compute && document.querySelector('#sheet .shname'), { timeout: 25000 });
  await page.waitForTimeout(400);
  return { ctx, page, errs };
}
const logOf = p => p.evaluate(() => LOG.map(e => (e.type === 'buy' ? e.cat : e.type) + ':' + e.seq));

// -------------------------------------------------------------------------------------------------
section('1. buy-off from the time-travel view');
{
  const LOG = seqd([...BASE, DRAWBACK, BUYOFF]);
  const { ctx, page, errs } = await lsPage(LOG);
  await page.evaluate(() => { viewAt = 4; render(); });   // after the drawback, before its buy-off
  const btns = await page.$$eval('#ledger button', bs => bs.map(b => b.textContent));
  check('no buy-off button is drawn in the past ledger', !btns.some(t => /buy off/i.test(t)), JSON.stringify(btns));
  const n0 = (await logOf(page)).length;
  await safe(() => page.evaluate(() => buyoffDrawback('Asthmatic')));
  check('buyoffDrawback() while scrubbed emits nothing', (await logOf(page)).length === n0);
  await page.evaluate(() => { viewAt = null; render(); });
  await safe(() => page.evaluate(() => buyoffDrawback('Asthmatic')));
  check('…and in the present, with no open Asthmatic left, no orphan buyoff is emitted', (await logOf(page)).length === n0, JSON.stringify(await logOf(page)));
  check('no page errors', !errs.length, errs.join(' | '));
  await ctx.close();
}

section('2. Finish creating goes through emit()');
{
  const { ctx, page, errs } = await lsPage(seqd([...BASE]));
  await page.evaluate(() => { VIEW_ONLY = true; });
  const n0 = (await logOf(page)).length;
  await safe(() => page.evaluate(() => finishCreating()));
  check('refused in the DM read-only view', (await logOf(page)).length === n0, JSON.stringify(await logOf(page)));
  await page.evaluate(() => { VIEW_ONLY = false; });
  await page.evaluate(() => { emit({ type: 'buy', cat: 'skill', cost: 1, payload: { v: 'Stealth' }, label: 'Skill: Stealth' }); undo(); });
  check('(setup) one event waiting to be redone', await page.evaluate(() => REDO.length) === 1);
  await safe(() => page.evaluate(() => finishCreating()));
  const after = await logOf(page);
  check('Finish creating appended creationLocked', after[after.length - 1].startsWith('creationLocked'), JSON.stringify(after));
  check('…and cleared Redo (no pre-lock purchase can be redone after the lock)', await page.evaluate(() => REDO.length) === 0);
  check('no page errors', !errs.length, errs.join(' | '));
  await ctx.close();
}

section('3. DM read-only view: Sheet is read-only, nothing saved locally');
{
  const { ctx, page, errs } = await lsPage(seqd([...BASE]));
  await page.evaluate(() => { VIEW_ONLY = true; toggleSheet(); });
  await page.waitForTimeout(200);
  const st = await page.evaluate(() => {
    const els = [...document.querySelectorAll('#sheetbody [data-mf]')];
    return { n: els.length, editable: els.filter(e => !(e.readOnly || e.disabled)).map(e => e.getAttribute('data-mf')) };
  });
  check('every Sheet input is read-only', st.n > 0 && st.editable.length === 0, st.n + ' inputs; editable: ' + st.editable.slice(0, 6).join(','));
  const before = await page.evaluate(() => localStorage.getItem('pactCharSheetManual:livesheet'));
  await page.evaluate(() => {
    const el = document.querySelector('#sheetbody [data-mf="spelllist"]') || document.querySelector('#sheetbody [data-mf^="slot_"]');
    if (el) { el.value = 'DM typed this'; el.dispatchEvent(new Event('input')); }
  });
  check('a scratch field typed in writes nothing to this browser', await page.evaluate(() => localStorage.getItem('pactCharSheetManual:livesheet')) === before);
  check('no page errors', !errs.length, errs.join(' | '));
  await ctx.close();
}

section('4. Reset clears the old campaign name');
{
  const { ctx, page, errs } = await lsPage(seqd([...BASE]));
  await page.evaluate(() => { window._lsCampaignName = 'Old Campaign'; render(); });
  check('(setup) the header shows the campaign', /Old Campaign/.test(await page.textContent('#sheet .shname')));
  await page.evaluate(() => resetAll());
  await page.waitForTimeout(300);
  check('after Reset the header no longer names it', !/Old Campaign/.test(await page.textContent('#sheet .shname')), await page.textContent('#sheet .shname'));
  check('no page errors', !errs.length, errs.join(' | '));
  await ctx.close();
}

section('5. Needs-review tray while scrubbed');
{
  // The present has a rule-ban-free but "not named yet" language issue; the past (after event 1) is the same character — what
  // matters is that the tray stops claiming present-day validation while a past sheet is on screen.
  const { ctx, page, errs } = await lsPage(seqd([...BASE, SKILL]));
  await page.evaluate(() => { viewAt = 2; render(); });
  const tray = await page.textContent('#tray');
  check('the tray says it is showing the past instead of present-day issues', /past/i.test(tray) && !/No issues|Needs review|Not named/.test(tray), tray.slice(0, 120));
  await page.evaluate(() => { viewAt = null; render(); });
  check('…and validates again in the present', !/Viewing the past/.test(await page.textContent('#tray')));
  check('no page errors', !errs.length, errs.join(' | '));
  await ctx.close();
}

section('6. Undo steps over a tail appearance event');
{
  const LOG = seqd([...BASE, SKILL, TAIL_APP]);
  const { ctx, page, errs } = await lsPage(LOG);
  const orig = await logOf(page);
  await page.evaluate(() => undo());
  const app = await page.evaluate(() => foldBuild(null).appearance || {});
  check('Undo removed the last real action (the skill)', !(await page.evaluate(() => (foldBuild(null).skills || []).includes('Stealth'))) && !(await logOf(page)).some(s => s.startsWith('skill')), JSON.stringify(await logOf(page)));
  check('…and kept the appearance (hair + playerSheet coins)', app.hair === 'red braid' && app.playerSheet && app.playerSheet.gp === 37, JSON.stringify(app));
  await page.evaluate(() => redo());
  check('Redo restores the original order exactly', JSON.stringify(await logOf(page)) === JSON.stringify(orig), JSON.stringify(await logOf(page)));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.compute && document.querySelector('#sheet .shname'), { timeout: 25000 });
  await page.evaluate(() => { undo(); emit({ type: 'buy', cat: 'skill', cost: 1, payload: { v: 'Insight' }, label: 'Skill: Insight' }); });
  const app2 = await page.evaluate(() => foldBuild(null).appearance || {});
  check('a new action after Undo keeps the appearance (no permanent loss)', app2.hair === 'red braid' && app2.playerSheet && app2.playerSheet.gp === 37, JSON.stringify(app2));
  check('no page errors', !errs.length, errs.join(' | '));
  await ctx.close();
}
{
  // A barrier (non-disc award) right before the tail appearance event: nothing above the floor is undoable.
  const LOG = seqd([...BASE, SKILL, { type: 'award', amount: 10, label: 'DM award' }, TAIL_APP]);
  const { ctx, page, errs } = await lsPage(LOG, 'id-glitch-bar');
  const orig = await logOf(page);
  await page.evaluate(() => undo());
  check('Undo below a barrier is still refused (the tail appearance event does not slip through)', JSON.stringify(await logOf(page)) === JSON.stringify(orig), JSON.stringify(await logOf(page)));
  const app = await page.evaluate(() => foldBuild(null).appearance || {});
  check('…and the appearance is intact', app.hair === 'red braid', JSON.stringify(app));
  check('no page errors', !errs.length, errs.join(' | '));
  await ctx.close();
}

section('7. CharGen Sheet: a typed sentence keeps focus and is one undo step');
{
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e))); page.on('dialog', d => d.accept());
  await page.goto(CG_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.compute && window.foldBuild, { timeout: 25000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => toggleSheet()); await page.waitForTimeout(300);
  const TXT = 'Long auburn braid';
  await page.click('#sheetbody [data-mf="ap_hair"]');
  await page.keyboard.type(TXT, { delay: 20 });
  await page.waitForTimeout(200);
  check('focus stays in the field while typing', await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-mf')) === 'ap_hair');
  check('the field holds the whole sentence', await page.inputValue('#sheetbody [data-mf="ap_hair"]') === TXT);
  await page.click('#sheetbody [data-mf="ap_eyes"]'); await page.waitForTimeout(300);
  check('on blur the sentence is in the LOG', await page.evaluate(() => (foldBuild(LOG).appearance || {}).hair) === TXT);
  check('focus moved to the field clicked next', await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-mf')) === 'ap_eyes');
  await page.evaluate(() => undo()); await page.waitForTimeout(200);
  check('ONE Undo removes the whole sentence (not one letter)', !((await page.evaluate(() => (foldBuild(LOG).appearance || {}).hair)) || ''), String(await page.evaluate(() => (foldBuild(LOG).appearance || {}).hair)));
  check('no page errors', !errs.length, errs.join(' | '));
  await ctx.close();
}

await browser.close(); server.close();
console.log(`\n[state-glitches] ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
