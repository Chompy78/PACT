/* PACT — Live Sheet: a 2nd origin class is treated as an origin class in the buy menu.
 *
 * fix/livesheet-second-origin-class (owner report, 2026-10-12, Wren Ashdown: Rogue / Wizard). The engine
 * already prices originClass2 as an origin class, but the Live Sheet's buy menu read only originClass:
 *   1. no "Wizard features" row, and Cross-class features skips origin classes, so Wizard features were
 *      unbuyable anywhere;
 *   2. "Unlock Wizard" was offered at 0 AP;
 *   3. no Wizard subclasses under "Subclasses & abilities".
 * Plus the engine guard: purchaseLegality() reports unlocking an origin class as a duplicate, so buy() refuses it.
 *
 *   node testing/scripts/livesheet-second-origin-class-e2e.mjs   (expect 0 failed)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = Number(process.env.PACT_E2E_PORT) || 7988;
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
  { type: 'award', amount: 200, seq: 1, label: 'Award' },
  { type: 'buy', cat: 'patch', cost: 0, level: 1, seq: 2, label: 'Identity',
    payload: { patch: { species: 'Human', originClass: 'Rogue', originClass2: 'Wizard', hd: 5 } } },
];

const browser = await launchChromium();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e)));
const alerts = []; page.on('dialog', d => { alerts.push(d.message()); d.accept(); });
await page.addInitScript((env) => { try { localStorage.setItem('pactLiveSheet', JSON.stringify(env)); } catch (e) {} },
  { schema: 'pact-character/1', LOG, SEQ: LOG.length + 1 });
await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' });
await page.waitForFunction(() => window.DATA && window._engineFold && typeof window.buy === 'function'
  && document.body.innerHTML.indexOf('Unlock classes') >= 0, { timeout: 25000 });

const b = await page.evaluate(() => { const x = foldBuild(null); return [x.originClass, x.originClass2]; });
check('fixture is a Rogue / Wizard', b[0] === 'Rogue' && b[1] === 'Wizard', JSON.stringify(b));

const menu = await page.evaluate(() => {
  // Expand the rows under test the way a click on their heading does.
  ['Rogue features', 'Wizard features', 'Unlock classes', 'Subclasses & abilities'].forEach(t => { grpOpen[t] = 1; });
  refreshBuy();
  // A tile's purchase rides in data-cat / data-p (never inside the onclick JS — feat/campaign-house-rules-tools); rebuild the
  // old 'buy("cat",{payload})' shape from them so the patterns below read the same.
  const btns = [...document.querySelectorAll('button.ib')].map(e => e.dataset.cat ? ('buy("' + e.dataset.cat + '",' + e.dataset.p + ')') : (e.getAttribute('onclick') || ''));
  return {
    wizFeat: btns.filter(o => /"feature"/.test(o) && /Wizard: /.test(o)).length,
    rogueFeat: btns.filter(o => /"feature"/.test(o) && /Rogue: /.test(o)).length,
    unlockWiz: btns.filter(o => /unlockclass/.test(o) && /Wizard/.test(o)).length,
    unlockRogue: btns.filter(o => /unlockclass/.test(o) && /Rogue/.test(o)).length,
    unlockOther: btns.filter(o => /unlockclass/.test(o) && /Fighter/.test(o)).length,
    wizSub: btns.filter(o => /freesub/.test(o) && /Wizard/.test(o)).length,
    hasWizRow: document.body.innerHTML.indexOf('Wizard features') >= 0,
  };
});
check('a "Wizard features" row is shown', menu.hasWizRow);
check('Wizard features are buyable', menu.wizFeat > 0, String(menu.wizFeat));
check('Rogue features still buyable', menu.rogueFeat > 0, String(menu.rogueFeat));
check('"Unlock Wizard" is not offered', menu.unlockWiz === 0, String(menu.unlockWiz));
check('"Unlock Rogue" is not offered', menu.unlockRogue === 0, String(menu.unlockRogue));
check('other classes can still be unlocked', menu.unlockOther === 1, String(menu.unlockOther));
check('a free Wizard subclass can be picked', menu.wizSub > 0, String(menu.wizSub));

// Engine guard: even if something calls buy() directly, unlocking an origin class is refused.
const lg = await page.evaluate(() => {
  const x = foldBuild(null);
  return [window._enginePurchaseLegality(x, 'unlockclass', { v: 'Wizard' }).dup,
          window._enginePurchaseLegality(x, 'unlockclass', { v: 'Rogue' }).dup,
          window._enginePurchaseLegality(x, 'unlockclass', { v: 'Fighter' }).dup];
});
check('engine: unlocking the 2nd origin class is a duplicate', lg[0] === true);
check('engine: unlocking the 1st origin class is a duplicate', lg[1] === true);
check('engine: unlocking another class is allowed', lg[2] === false);
const n0 = await page.evaluate(() => LOG.length);
await page.evaluate(() => buy('unlockclass', { v: 'Wizard' }, 'Unlock Wizard'));
const n1 = await page.evaluate(() => LOG.length);
check('buy("unlockclass", Wizard) records nothing', n1 === n0, `${n0} -> ${n1}`);
check('…and says why', alerts.some(a => /Already owned/.test(a)), alerts.join(' | '));

const fatal = errs.filter(e => !/Failed to load|net::|supabase|fetch/i.test(e));
check('no fatal page errors', fatal.length === 0, fatal.slice(0, 2).join(' | '));
await browser.close(); server.close();
console.log(`\n${fail ? '✗' : '✓'} ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
