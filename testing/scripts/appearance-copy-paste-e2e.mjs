/* PACT — copy every appearance field from one character and paste it onto another (feat/appearance-copy-paste, owner
 * decision AF1, 2026-10-14).
 *   1. Live Sheet → Live Sheet: every text field travels; a field the copy lacks is cleared; the name and the Live Sheet's
 *      own playerSheet (coins, weapons) are kept; the copy never carries playerSheet.
 *   2. Cancelling the preview changes nothing; a malformed clipboard changes nothing.
 *   3. A hostile value is pasted as text, never run.
 *   4. CharGen: paste fills the Setup panel and the LOG, keeps the name, and one Undo reverts it; CharGen → Live Sheet works.
 * The real clipboard is stubbed (headless browsers can't grant it): _csCopy captures, navigator.clipboard.readText returns it.
 *
 *   node testing/scripts/appearance-copy-paste-e2e.mjs            (expect 0 failed)
 *   PACT_REPO=<other checkout> node …                              runs the same cases against another checkout (old code)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = process.env.PACT_REPO || path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = Number(process.env.PACT_E2E_PORT) || 7967;
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json',
               '.css':'text/css','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml' };
const server = http.createServer((q, r) => {
  let rel;
  try { rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/PACT\/?/, '') || 'index.html'; } catch (e) { r.writeHead(400); return r.end(); }
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
const section = t => console.log(`\n[appearance-copy-paste] == ${t} ==`);

const IDENT = { type: 'buy', cat: 'patch', cost: 0, label: 'Identity',
  payload: { patch: { species: 'Human', originClass: 'Rogue', hd: 3, stats: { STR: 10, DEX: 14, CON: 12, INT: 10, WIS: 12, CHA: 10 } } } };
const apEv = app => ({ type: 'buy', cat: 'patch', cost: 0, _slot: 'appearance', label: 'Appearance', payload: { patch: { appearance: app } } });
const mkLog = (name, app) => [
  { seq: 1, ...apEv(app) },
  { seq: 2, type: 'award', amount: 200, label: 'Award' },
  { seq: 3, ...IDENT },
  { seq: 4, type: 'name', name },
];

const browser = await launchChromium();
const STUB = () => {
  window.__clip = null;
  window._csCopy = t => { window.__clip = t; return true; };
  try { navigator.clipboard.readText = () => Promise.resolve(window.__clip); } catch (e) {}
};
async function lsPage(name, app, { confirm = true } = {}) {
  const ctx = await browser.newContext();
  const LOG = mkLog(name, app);
  await ctx.addInitScript(env => { try { if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); localStorage.setItem('pactLiveSheet', JSON.stringify(env)); } } catch (e) {} },
    { schema: 'pact-character/1', name, id: 'id-' + name, LOG, SEQ: LOG.length + 1 });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.type() + ':' + d.message()); (d.type() === 'confirm' && !page.__confirm) ? d.dismiss() : d.accept(); });
  page.__confirm = confirm;
  await page.goto(LS_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.compute && document.querySelector('#sheet .shname'), { timeout: 25000 });
  await page.evaluate(STUB);
  return { ctx, page, errs, dialogs };
}
const lsAp = p => p.evaluate(() => foldBuild(null).appearance || {});
const lsName = p => p.evaluate(() => { const n = LOG.filter(e => e.type === 'name').pop(); return n && n.name; });

const A_APP = { hair: 'Red', eyes: 'Green', backstory: 'A long tale\nof two lines', playerName: 'Jo', overall: 'Tall and red-haired.',
                playerSheet: { coins: { gp: 5 } } };
const B_APP = { hair: 'Black', eyes: 'Blue', voice: 'Gravel', playerSheet: { coins: { gp: 9 } } };

// -------------------------------------------------------------------------------------------------
section('1. Live Sheet → Live Sheet');
let CLIP;
{
  const A = await lsPage('Tamsin', A_APP);
  const hasBtns = await A.page.evaluate(() => document.body.innerHTML.includes('Copy appearance') && document.body.innerHTML.includes('Paste appearance'));
  check('the Appearance block shows Copy and Paste buttons', hasBtns);
  await A.page.evaluate(() => typeof lsCopyAppearance === 'function' && lsCopyAppearance());
  CLIP = await A.page.evaluate(() => window.__clip);
  let parsed = null; try { parsed = JSON.parse(CLIP); } catch (e) {}
  check('copy puts a tagged appearance on the clipboard', !!parsed && parsed.schema === 'pact-appearance/1' && parsed.appearance && parsed.appearance.hair === 'Red');
  check('…every text field, and never the playerSheet', !!parsed && parsed.appearance.backstory === A_APP.backstory && !('playerSheet' in parsed.appearance));
  check('no page errors (A)', A.errs.length === 0, A.errs.slice(0, 2).join(' | '));
  await A.ctx.close();

  const B = await lsPage('Bram', B_APP);
  await B.page.evaluate(c => { window.__clip = c; }, CLIP);
  await B.page.evaluate(() => typeof lsPasteAppearance === 'function' && lsPasteAppearance());
  await B.page.waitForTimeout(400);
  const ap = await lsAp(B.page);
  check('paste: B now has A\'s text fields', ap.hair === 'Red' && ap.eyes === 'Green' && ap.backstory === A_APP.backstory && ap.playerName === 'Jo' && ap.overall === A_APP.overall, JSON.stringify(ap));
  check('paste: a field the copy lacks is cleared (voice)', ap.voice === '');
  check('paste: B keeps its own coins (playerSheet untouched)', ap.playerSheet && ap.playerSheet.coins && ap.playerSheet.coins.gp === 9);
  check('paste: B keeps its name', await lsName(B.page) === 'Bram');
  check('paste asked first, listing the changes', B.dialogs.some(d => d.startsWith('confirm:') && /field\(s\) change/.test(d) && /hair: Black → Red/.test(d)), B.dialogs.join(' || '));
  check('the pasted appearance survives a reload', await (async () => { await B.page.reload({ waitUntil: 'load' });
    await B.page.waitForFunction(() => window.compute && document.querySelector('#sheet .shname'), { timeout: 25000 });
    return (await lsAp(B.page)).hair === 'Red'; })());
  check('no page errors (B)', B.errs.length === 0, B.errs.slice(0, 2).join(' | '));
  await B.ctx.close();
}

// -------------------------------------------------------------------------------------------------
section('2. cancel and malformed');
{
  const B = await lsPage('Bram', B_APP, { confirm: false });
  await B.page.evaluate(c => { window.__clip = c; }, CLIP);
  await B.page.evaluate(() => typeof lsPasteAppearance === 'function' && lsPasteAppearance());
  await B.page.waitForTimeout(300);
  check('cancelling the preview changes nothing', (await lsAp(B.page)).hair === 'Black');
  await B.page.evaluate(() => { window.__clip = 'not an appearance'; });
  B.page.__confirm = true;
  await B.page.evaluate(() => typeof lsPasteAppearance === 'function' && lsPasteAppearance());
  await B.page.waitForTimeout(300);
  check('a malformed clipboard changes nothing', (await lsAp(B.page)).hair === 'Black');
  await B.page.evaluate(() => { window.__clip = JSON.stringify({ schema: 'pact-appearance/1', appearance: { hair: 'Grey', playerSheet: 'x', '__proto__': 'y', 'bad key': 'z', n: 5 } }); });
  await B.page.evaluate(() => typeof lsPasteAppearance === 'function' && lsPasteAppearance());
  await B.page.waitForTimeout(300);
  const ap = await lsAp(B.page);
  check('odd keys and non-text values in a copy are dropped', ap.hair === 'Grey' && ap.playerSheet && ap.playerSheet.coins.gp === 9 && !('bad key' in ap) && !('n' in ap), JSON.stringify(ap));
  check('no page errors', B.errs.length === 0, B.errs.slice(0, 2).join(' | '));
  await B.ctx.close();
}

// -------------------------------------------------------------------------------------------------
section('3. a hostile value is pasted as text');
{
  const B = await lsPage('Bram', B_APP);
  const XSS = '<img src=x onerror="window.__xss=1">"\'); window.__xss=2;//';
  await B.page.evaluate(x => { window.__clip = JSON.stringify({ schema: 'pact-appearance/1', appearance: { hair: x, overall: x } }); }, XSS);
  await B.page.evaluate(() => { LS_DESC_OPEN = true; typeof lsPasteAppearance === 'function' && lsPasteAppearance(); });
  await B.page.waitForTimeout(500);
  check('the value is stored as typed', (await lsAp(B.page)).hair === XSS);
  check('…shown as text in the field', await B.page.evaluate(x => { const el = document.querySelector('[data-lsd="hair"]'); return !!el && el.value === x; }, XSS));
  check('…and never run', await B.page.evaluate(() => window.__xss === undefined));
  check('no page errors', B.errs.length === 0, B.errs.slice(0, 2).join(' | '));
  await B.ctx.close();
}

// -------------------------------------------------------------------------------------------------
section('4. CharGen');
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  page.on('dialog', d => d.accept());
  await page.goto(CG_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.compute && typeof readBuild === 'function', { timeout: 25000 }); await page.waitForTimeout(1500);
  await page.evaluate(STUB);
  check('CharGen shows Copy and Paste buttons', await page.evaluate(() => document.body.innerHTML.includes('Copy appearance') && document.body.innerHTML.includes('Paste appearance')));
  await page.evaluate(() => { _shCommitAppearanceField('hair', 'Grey'); _shCommitAppearanceField('voice', 'Soft'); });
  await page.waitForTimeout(200);
  const nameBefore = await page.evaluate(() => readBuild().name || '');
  await page.evaluate(c => { window.__clip = c; }, CLIP);
  await page.evaluate(() => typeof cgPasteAppearance === 'function' && cgPasteAppearance());
  await page.waitForTimeout(500);
  const ap = await page.evaluate(() => readBuild().appearance || {});
  check('paste: the LOG has the copied fields', ap.hair === 'Red' && ap.backstory === A_APP.backstory && ap.voice === '', JSON.stringify(ap));
  check('paste: the Setup panel shows them', await page.evaluate(() => { const el = document.getElementById('ap_hair'); return !!el && el.value === 'Red'; }));
  check('paste: the name is kept', await page.evaluate(() => readBuild().name || '') === nameBefore);
  await page.evaluate(() => undo()); await page.waitForTimeout(400);
  const back = await page.evaluate(() => readBuild().appearance || {});
  check('one Undo reverts the paste', back.hair === 'Grey' && back.voice === 'Soft', JSON.stringify(back));
  await page.evaluate(() => typeof cgCopyAppearance === 'function' && cgCopyAppearance());
  const cgClip = await page.evaluate(() => window.__clip);
  check('no page errors (CharGen)', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();

  const B = await lsPage('Bram', B_APP);
  await B.page.evaluate(c => { window.__clip = c; }, cgClip);
  await B.page.evaluate(() => typeof lsPasteAppearance === 'function' && lsPasteAppearance());
  await B.page.waitForTimeout(400);
  const lap = await lsAp(B.page);
  check('CharGen → Live Sheet: the copy pastes across tools', lap.hair === 'Grey' && lap.voice === 'Soft' && lap.playerSheet.coins.gp === 9, JSON.stringify(lap));
  await B.ctx.close();
}

await browser.close(); server.close();
console.log(`\n[appearance-copy-paste] ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
