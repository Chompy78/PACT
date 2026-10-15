/* PACT — saving throws in the Live Sheet Character panel's Stats card (feat/livesheet-saves-in-stats-card, owner report
 * 2026-10-14: the centre panel did not show saving throws properly — only "Saves: DEX, INT", no values).
 *
 * Checks: every ability box carries its save, in that ability's colour; proficient saves are marked; the values equal the
 * engine's saveMods() (compute()'s mods + proficiency + Weak-Willed's −1); the old "Saves:" line is gone; the 📋 Sheet's
 * Saving Throws box shows the same numbers; the card fits a phone screen.
 *
 *   node testing/scripts/livesheet-saves-stats-card-e2e.mjs   (expect 0 failed; PACT_E2E_PORT to change the port)
 *   SHOT_DIR=<dir> node …     also saves desktop and phone screenshots of the Stats card
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = Number(process.env.PACT_E2E_PORT) || 7994;
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

const LOG = [
  { type: 'award', amount: 400, seq: 1, label: 'Award' },
  { type: 'buy', cat: 'patch', cost: 0, level: 1, seq: 2, label: 'Identity',
    payload: { patch: { species: 'Human', originClass: 'Rogue', hd: 5, languages: 1, languageNames: ['Common'],
      stats: { STR: 8, DEX: 16, CON: 12, INT: 14, WIS: 10, CHA: 13 }, saves: ['DEX', 'INT'], drawbacks: ['Weak-Willed'] } } },
];
const toRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };

const browser = await launchChromium();
const open = async (viewport) => {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript((env) => { try { localStorage.setItem('pactLiveSheet', JSON.stringify(env)); } catch (e) {} },
    { schema: 'pact-character/1', LOG, SEQ: LOG.length + 1 });
  await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.compute && document.querySelector('#sheet .shstats'), { timeout: 25000 });
  return { ctx, page, errs };
};

const { ctx, page, errs } = await open({ width: 1400, height: 1000 });
const got = await page.evaluate(() => [...document.querySelectorAll('#sheet .shstats .abx')].map(x => {
  const s = x.querySelector('.absv'); return s && { ab: s.getAttribute('data-save'), text: s.textContent.trim(), prof: s.getAttribute('data-prof') === '1',
    color: getComputedStyle(s).color, weight: getComputedStyle(s).fontWeight }; }));
const exp = await page.evaluate(() => { const b = foldBuild(null), r = compute(b);
  return { saves: ['STR','DEX','CON','INT','WIS','CHA'].map(a => ({ ab: a, prof: (b.saves || []).includes(a), total: r.mods[a] + ((b.saves || []).includes(a) ? r.prof : 0) + (r.saveAdj || 0) })),
           col: _CSABCOL, adj: r.saveAdj }; });
const sg = (x) => (x >= 0 ? '+' : '') + x;
check('all six ability boxes carry a save', got.length === 6 && got.every(Boolean), JSON.stringify(got));
check('Weak-Willed is in force (the test exercises compute()\'s saveAdj)', exp.adj === -1, String(exp.adj));
for (const e of exp.saves) {
  const g = (got.find(x => x && x.ab === e.ab)) || {};
  check(`${e.ab} save shows ${sg(e.total)} (= compute() mods + prof + saveAdj)`, g.text === (e.prof ? '●' : '○') + 'Save ' + sg(e.total), g.text);
  check(`${e.ab} save is in the ${e.ab} colour`, g.color === toRgb(exp.col[e.ab]), `${g.color} vs ${exp.col[e.ab]}`);
  check(`${e.ab} save ${e.prof ? 'is' : 'is not'} marked proficient`, g.prof === e.prof && (e.prof ? +g.weight >= 700 : +g.weight < 700), `${g.prof} / ${g.weight}`);
}
check('the engine\'s saveMods() gives the same numbers', await page.evaluate(() => { const b = foldBuild(null), r = compute(b);
  return saveMods(b, r).map(s => s.total).join() === ['STR','DEX','CON','INT','WIS','CHA'].map(a => r.mods[a] + ((b.saves||[]).includes(a) ? r.prof : 0) + r.saveAdj).join(); }));
check('the old "Saves: DEX, INT" line is gone', await page.evaluate(() => !/Saves:/.test(document.querySelector('#sheet .shstats').innerText)));
const sheet = await page.evaluate(() => { toggleSheet(); const box = [...document.querySelectorAll('#sheetbody .shbox')].find(x => /Saving Throws/.test(x.textContent));
  const t = box ? [...box.querySelectorAll('.shrow')].map(e => e.innerText.replace(/\s+/g, ' ').trim()) : []; toggleSheet(); return t; });
check('📋 Sheet Saving Throws box matches', sheet.join('|') === exp.saves.map(e => (e.prof ? '● ' : '○ ') + e.ab + ' ' + sg(e.total)).join('|'), JSON.stringify(sheet));
check('no page errors', !errs.length, errs.join(' | '));
if (process.env.SHOT_DIR) await page.locator('#sheet .shstats').screenshot({ path: path.join(process.env.SHOT_DIR, 'saves-desktop.png') });
await ctx.close();

const ph = await open({ width: 390, height: 844 });
const fit = await ph.page.evaluate(() => { const c = document.querySelector('#sheet .shstats'); const boxes = [...c.querySelectorAll('.abx')];
  return { over: c.scrollWidth - c.clientWidth, clipped: boxes.filter(x => x.scrollWidth > x.clientWidth + 1).length, shown: boxes.filter(x => x.querySelector('.absv').getBoundingClientRect().height > 0).length }; });
check('phone width: the Stats card fits, no ability box clips its save', fit.over <= 1 && fit.clipped === 0 && fit.shown === 6, JSON.stringify(fit));
if (process.env.SHOT_DIR) await ph.page.locator('#sheet .shstats').screenshot({ path: path.join(process.env.SHOT_DIR, 'saves-phone.png') });
await ph.ctx.close();

await browser.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
