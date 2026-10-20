/* PACT — the cantrip picker for Druid Magician and Cleric Thaumaturge, in both tools.
 *
 * feat/primal-order-magician-warden (docs/plans/2026-10-20-primal-order-magician-warden.md). Those two features each grant ONE cantrip.
 * The ✎ Name spells & languages dialog in CharGen and in the Live Sheet shows a row for it (data-k "fsc::<feature label>::0"); saving
 * keeps the name in b.fsCantripNames under the feature's label, the same map the Live Sheet's fighting-style cantrips use, and the
 * engine lists it in grantedSpells(). CharGen's dialog has no fighting-style rows, so it must MERGE into the saved map, not replace it.
 *
 *   node testing/scripts/feature-cantrip-picker-e2e.mjs
 *
 * No Supabase, no sign-in: the Live Sheet character is seeded into localStorage; CharGen is loaded through its own envelope loader.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = Number(process.env.PACT_E2E_PORT) || 7961;
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

const M = 'Druid: Primal Order (Magician)', T = 'Cleric: Divine Order (Thaumaturge)';
const buy = (n, cat, v, cost) => ({ type: 'buy', cat, payload: { v }, cost, level: 1, seq: n, label: (cat === 'feature' ? 'Class feature — ' : '') + v });
const DRUID = [
  { type: 'award', amount: 300, seq: 1, label: 'Award — budget (300 AP)' },
  buy(2, 'oclass', 'Druid', 0),
  buy(3, 'feature', M, 6),
];
// A names event that already holds a fighting-style cantrip name: CharGen must keep it when it adds the feature's cantrip.
const WITH_STYLE = DRUID.concat([{ type: 'names', fsc: { 'Blessed Warrior': ['Guidance', 'Light'] }, seq: 4, cost: 0, label: 'Named spells' }]);
const CLERIC = [
  { type: 'award', amount: 300, seq: 1, label: 'Award — budget (300 AP)' },
  buy(2, 'oclass', 'Cleric', 0),
  buy(3, 'feature', T, 6),
];
const NOFEAT = [
  { type: 'award', amount: 300, seq: 1, label: 'Award — budget (300 AP)' },
  buy(2, 'oclass', 'Druid', 0),
];

const browser = await launchChromium();
const env = (LOG) => ({ schema: 'pact-character/1', rules: 'v0', name: 'Picker Test', LOG, SEQ: LOG.length + 1 });

async function liveCase(label, LOG, feature, cantrip) {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e))); page.on('dialog', d => d.accept());
  await page.addInitScript((e) => { try { localStorage.setItem('pactLiveSheet', JSON.stringify(e)); } catch (x) {} }, env(LOG));
  await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window._engineFold && typeof window.openNames === 'function'
    && document.getElementById('buy') && document.getElementById('buy').innerHTML.length > 200, { timeout: 25000 });
  const key = `fsc::${feature}::0`;
  const rows = await page.evaluate(() => { window.openNames(); return [...document.querySelectorAll('#namesBox .nmf')].map(e => e.dataset.k); });
  check(`live ${label}: dialog has the "${key}" row`, rows.includes(key), rows.join(' | '));
  if (rows.includes(key)) {
    const r = await page.evaluate(async ({ key, cantrip }) => {
      const el = [...document.querySelectorAll('#namesBox .nmf')].find(e => e.dataset.k === key);
      el.value = cantrip; window.saveNames();
      const b = window.foldBuild(null);
      return { map: b.fsCantripNames || {}, spells: (window.grantedSpells ? window.grantedSpells(b) : []).filter(s => s.kind === 'feature').map(s => s.name) };
    }, { key, cantrip });
    check(`live ${label}: the name is saved under the feature's label`, JSON.stringify((r.map[feature] || []).filter(Boolean)) === JSON.stringify([cantrip]), JSON.stringify(r.map));
    if (r.spells.length || typeof r.spells.length === 'number') check(`live ${label}: no page error`, errs.length === 0, errs.join(' | '));
  }
  await ctx.close();
}

async function chargenCase(label, LOG, feature, cantrip, expectKept) {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e))); page.on('dialog', d => d.accept());
  await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && typeof window._cgApplyEnvelope === 'function' && typeof window.openNames === 'function', { timeout: 25000 });
  const key = `fsc::${feature}::0`;
  const rows = await page.evaluate((e) => { window._cgApplyEnvelope(e, {}); window.openNames(); return [...document.querySelectorAll('#namesBox .nmf')].map(x => x.dataset.k); }, env(LOG));
  check(`chargen ${label}: dialog has the "${key}" row`, rows.includes(key), rows.join(' | '));
  if (rows.includes(key)) {
    const r = await page.evaluate(async ({ key, cantrip }) => {
      const el = [...document.querySelectorAll('#namesBox .nmf')].find(e => e.dataset.k === key);
      el.value = cantrip; window.saveNames();
      const b = window.readBuild();
      return { map: b.fsCantripNames || {} };
    }, { key, cantrip });
    check(`chargen ${label}: the name is saved under the feature's label`, JSON.stringify((r.map[feature] || []).filter(Boolean)) === JSON.stringify([cantrip]), JSON.stringify(r.map));
    if (expectKept) check(`chargen ${label}: the saved fighting-style cantrips are kept (merged, not replaced)`, JSON.stringify(r.map['Blessed Warrior']) === JSON.stringify(['Guidance', 'Light']), JSON.stringify(r.map));
    check(`chargen ${label}: no page error`, errs.length === 0, errs.join(' | '));
  }
  await ctx.close();
}

async function noRowCase(tool, LOG) {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  page.on('dialog', d => d.accept());
  if (tool === 'live') {
    await page.addInitScript((e) => { try { localStorage.setItem('pactLiveSheet', JSON.stringify(e)); } catch (x) {} }, env(LOG));
    await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.DATA && window._engineFold && typeof window.openNames === 'function'
      && document.getElementById('buy') && document.getElementById('buy').innerHTML.length > 200, { timeout: 25000 });
  } else {
    await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.DATA && typeof window._cgApplyEnvelope === 'function' && typeof window.openNames === 'function', { timeout: 25000 });
    await page.evaluate((e) => window._cgApplyEnvelope(e, {}), env(LOG));
  }
  const rows = await page.evaluate(() => { try { window.openNames(); } catch (x) {} return [...document.querySelectorAll('#namesBox .nmf')].map(e => e.dataset.k); });
  check(`${tool}: a Druid without Magician gets no feature-cantrip row`, !rows.some(k => k.startsWith('fsc::Druid: Primal Order')), rows.join(' | '));
  await ctx.close();
}

await liveCase('Druid Magician', DRUID, M, 'Druidcraft');
await liveCase('Cleric Thaumaturge', CLERIC, T, 'Guidance');
await chargenCase('Druid Magician', DRUID, M, 'Druidcraft', false);
await chargenCase('Cleric Thaumaturge', CLERIC, T, 'Guidance', false);
await chargenCase('Druid Magician + a saved fighting-style cantrip', WITH_STYLE, M, 'Druidcraft', true);
await noRowCase('live', NOFEAT);
await noRowCase('chargen', NOFEAT);

await browser.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
