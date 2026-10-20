/* PACT — the free-instrument picker for the Musician feat, in both tools.
 *
 * feat/feat-free-proficiency (docs/plans/2026-10-20-primal-order-magician-warden.md, owner rule 2026-10-20). Musician hands out three instruments
 * of the player's choice, free. The ✎ Name spells & languages dialog in CharGen and in the Live Sheet shows one row per instrument
 * (data-k "fp::Musician::<i>"); saving keeps the names in b.freeProfNames (a `names` event, key `fp`), and the engine's freeProfs() lists
 * them. Chef's one tool is fixed (Cook's utensils), so it gets no row. CharGen's dialog must MERGE into the saved map, not replace it.
 *
 *   node testing/scripts/free-prof-picker-e2e.mjs
 *
 * No Supabase, no sign-in: the Live Sheet character is seeded into localStorage; CharGen is loaded through its own envelope loader.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = Number(process.env.PACT_E2E_PORT) || 7962;
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

const buy = (n, cat, v, cost) => ({ type: 'buy', cat, payload: { v }, cost, level: 1, seq: n, label: v });
const MUS = [
  { type: 'award', amount: 300, seq: 1, label: 'Award — budget (300 AP)' },
  buy(2, 'oclass', 'Bard', 0),
  buy(3, 'art', 'Musician', 12),
];
// A names event that already holds a free pick for ANOTHER feat and a fighting-style cantrip: CharGen must keep both.
const MERGE = MUS.concat([{ type: 'names', fp: { 'Some Other Feat': ['Kept'] }, fsc: { 'Blessed Warrior': ['Guidance', 'Light'] }, seq: 4, cost: 0, label: 'Named' }]);
const CHEF = [
  { type: 'award', amount: 300, seq: 1, label: 'Award — budget (300 AP)' },
  buy(2, 'oclass', 'Bard', 0),
  { type: 'buy', cat: 'patch', payload: { patch: { hd: 5 } }, cost: 0, level: 1, seq: 3, label: 'Patch' },
  buy(4, 'art', 'Chef', 7),
];
const NOFEAT = MUS.slice(0, 2);
const PICKS = ['Lute', 'Flute', 'Drum'];

const browser = await launchChromium();
const env = (LOG) => ({ schema: 'pact-character/1', rules: 'v0', name: 'Picker Test', LOG, SEQ: LOG.length + 1 });
const keys = [0, 1, 2].map(i => `fp::Musician::${i}`);

async function liveCase(label, LOG) {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e))); page.on('dialog', d => d.accept());
  await page.addInitScript((e) => { try { localStorage.setItem('pactLiveSheet', JSON.stringify(e)); } catch (x) {} }, env(LOG));
  await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window._engineFold && typeof window.openNames === 'function' && window.freeProfs
    && document.getElementById('buy') && document.getElementById('buy').innerHTML.length > 200, { timeout: 25000 });
  const rows = await page.evaluate(() => { window.openNames(); return [...document.querySelectorAll('#namesBox .nmf')].map(e => e.dataset.k); });
  check(`live ${label}: three Musician rows`, keys.every(k => rows.includes(k)), rows.join(' | '));
  const r = await page.evaluate(async ({ keys, PICKS }) => {
    keys.forEach((k, i) => { const el = [...document.querySelectorAll('#namesBox .nmf')].find(e => e.dataset.k === k); if (el) el.value = PICKS[i]; });
    window.saveNames();
    const b = window.foldBuild(null);
    return { map: b.freeProfNames || {}, names: window.freeProfs(b).names };
  }, { keys, PICKS });
  check(`live ${label}: the names are saved under the feat's label`, JSON.stringify(r.map.Musician) === JSON.stringify(PICKS), JSON.stringify(r.map));
  check(`live ${label}: freeProfs() lists them`, PICKS.every(p => r.names.includes(p)), JSON.stringify(r.names));
  check(`live ${label}: no page error`, errs.length === 0, errs.join(' | '));
  await ctx.close();
}

async function chargenCase(label, LOG, expectKept) {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e))); page.on('dialog', d => d.accept());
  await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && typeof window._cgApplyEnvelope === 'function' && typeof window.openNames === 'function' && window.freeProfs, { timeout: 25000 });
  const rows = await page.evaluate((e) => { window._cgApplyEnvelope(e, {}); window.openNames(); return [...document.querySelectorAll('#namesBox .nmf')].map(x => x.dataset.k); }, env(LOG));
  check(`chargen ${label}: three Musician rows`, keys.every(k => rows.includes(k)), rows.join(' | '));
  const r = await page.evaluate(async ({ keys, PICKS }) => {
    keys.forEach((k, i) => { const el = [...document.querySelectorAll('#namesBox .nmf')].find(e => e.dataset.k === k); if (el) el.value = PICKS[i]; });
    window.saveNames();
    const b = window.readBuild();
    return { fp: b.freeProfNames || {}, fsc: b.fsCantripNames || {}, names: window.freeProfs(b).names };
  }, { keys, PICKS });
  check(`chargen ${label}: the names are saved under the feat's label`, JSON.stringify(r.fp.Musician) === JSON.stringify(PICKS), JSON.stringify(r.fp));
  check(`chargen ${label}: freeProfs() lists them`, PICKS.every(p => r.names.includes(p)), JSON.stringify(r.names));
  if (expectKept) {
    check(`chargen ${label}: another feat's saved pick is kept (merged, not replaced)`, JSON.stringify(r.fp['Some Other Feat']) === JSON.stringify(['Kept']), JSON.stringify(r.fp));
    check(`chargen ${label}: the saved fighting-style cantrips are untouched`, JSON.stringify(r.fsc['Blessed Warrior']) === JSON.stringify(['Guidance', 'Light']), JSON.stringify(r.fsc));
  }
  check(`chargen ${label}: no page error`, errs.length === 0, errs.join(' | '));
  await ctx.close();
}

async function noRowCase(tool, LOG, what) {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  page.on('dialog', d => d.accept());
  if (tool === 'live') {
    await page.addInitScript((e) => { try { localStorage.setItem('pactLiveSheet', JSON.stringify(e)); } catch (x) {} }, env(LOG));
    await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.DATA && window._engineFold && typeof window.openNames === 'function' && window.freeProfs
      && document.getElementById('buy') && document.getElementById('buy').innerHTML.length > 200, { timeout: 25000 });
  } else {
    await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.DATA && typeof window._cgApplyEnvelope === 'function' && typeof window.openNames === 'function' && window.freeProfs, { timeout: 25000 });
    await page.evaluate((e) => window._cgApplyEnvelope(e, {}), env(LOG));
  }
  const rows = await page.evaluate(() => { try { window.openNames(); } catch (x) {} return [...document.querySelectorAll('#namesBox .nmf')].map(e => e.dataset.k); });
  check(`${tool}: ${what} gets no free-pick row`, !rows.some(k => k.startsWith('fp::')), rows.join(' | '));
  await ctx.close();
}

await liveCase('Musician', MUS);
await chargenCase('Musician', MUS, false);
await chargenCase('Musician + saved names of other kinds', MERGE, true);
await noRowCase('live', CHEF, 'Chef (its tool is fixed)');
await noRowCase('chargen', CHEF, 'Chef (its tool is fixed)');
await noRowCase('live', NOFEAT, 'a Bard without the feat');
await noRowCase('chargen', NOFEAT, 'a Bard without the feat');

await browser.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
