/* PACT — Live Sheet center panel (feat/livesheet-center-panel, owner request 2026-10-12).
 *   1. Every skill, owned or not, in a vertical list with its ability and total bonus (engine skillMods()).
 *   2. A tap-able ⓘ after each boon and drawback that shows its effect (drawbacks' hover text was always blank:
 *      it read .fx off DATA.drawbacks[x], which is a price).
 *   3. The "not named" notice lists WHICH spells and languages are blank.
 *   5. On desktop the Buy and History panels fold to a strip (remembered per browser).
 *   4. A campaign DM can switch off the "N drawbacks chosen" advice (DM Console → rules.drawbackCountAdvice).
 *
 *   node testing/scripts/livesheet-center-panel-e2e.mjs   (expect 0 failed)
 *   SHOT_DIR=<dir> node …            also saves desktop and phone screenshots of the panel there
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = 7989;
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
    payload: { patch: { species: 'Human', originClass: 'Rogue', hd: 20, languages: 2, languageNames: ['Common'],
      stats: { STR: 10, DEX: 16, CON: 12, INT: 10, WIS: 14, CHA: 8 },
      skills: ['Stealth', 'Perception'], expertise: ['Stealth'], boons: ['Boon of Combat Prowess'], drawbacks: ['Asthmatic'] } } },
];

const browser = await launchChromium();
const run = async (viewport) => {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript((env) => { try { localStorage.setItem('pactLiveSheet', JSON.stringify(env)); } catch (e) {} },
    { schema: 'pact-character/1', LOG, SEQ: LOG.length + 1 });
  await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.skillMods && document.querySelector('#sheet .shskills'), { timeout: 25000 });
  return { ctx, page, errs };
};

const { ctx, page, errs } = await run({ width: 1400, height: 1000 });
const rows = await page.evaluate(() => [...document.querySelectorAll('#sheet .skrow')].map(e => e.innerText.replace(/\s+/g, ' ').trim()));
const nSkills = await page.evaluate(() => DATA.skillList.length);
check('every skill is listed, owned or not', rows.length === nSkills, `${rows.length} of ${nSkills}`);
const prof = await page.evaluate(() => compute(foldBuild(null)).prof);
check('an expertise skill shows ◉, its ability and DEX + 2×prof', rows.includes('◉ Stealth DEX +' + (3 + 2 * prof)), rows.find(t => /Stealth/.test(t)));
check('a proficient skill shows ●', rows.some(t => /^● Perception WIS \+\d+$/.test(t)), rows.find(t => /Perception/.test(t)));
check('an unowned skill shows ○ and its plain modifier', rows.some(t => t === '○ Athletics STR +0'), rows.find(t => /Athletics/.test(t)));
const m = await page.evaluate(() => { const b = foldBuild(null), r = compute(b); const s = skillMods(b, r).find(x => x.skill === 'Initiative'); return [s.total, r.init]; });
check('Initiative row equals the sheet\'s Init', m[0] === m[1], JSON.stringify(m));
check('skills list sits left of the rest of the sheet', await page.evaluate(() => {
  const a = document.querySelector('.shskills').getBoundingClientRect(), b = document.querySelector('.shmain').getBoundingClientRect();
  return a.right <= b.left + 1 && a.top <= b.top + 1; }));

const icons = await page.evaluate(() => [...document.querySelectorAll('#sheet .fxi')].map(e => e.getAttribute('data-fx')));
check('the boon has an ⓘ with its effect', icons.some(t => /miss into a hit/.test(t)), JSON.stringify(icons).slice(0, 160));
check('the drawback has an ⓘ with its effect', icons.some(t => /Dash/.test(t)));
await page.click('#sheet .fxi');
const pop = await page.evaluate(() => { const p = document.getElementById('fxpop'); return p ? p.textContent : null; });
check('tapping ⓘ opens the effect', !!pop && pop.length > 10, pop);
await page.mouse.click(5, 5);
check('tapping elsewhere closes it', await page.evaluate(() => !document.getElementById('fxpop')));

const tray = await page.evaluate(() => document.body.innerText);
check('the notice names the blank language', /Not named yet:[^\n]*Language 2/.test(tray), (tray.match(/Not named yet:[^\n]*/) || [''])[0]);
check('…and not the named one', !/Not named yet:[^\n]*Language 1\b/.test(tray));

// 5. Desktop: the Buy and History panels fold to a strip, the Character panel widens, and the choice survives a reload.
const w0 = await page.evaluate(() => document.querySelector('.layout>.card:nth-child(2)').getBoundingClientRect().width);
await page.click('.layout>.card:nth-child(1)>h3');
await page.click('.layout>.card:nth-child(3)>h3');
const fold = await page.evaluate(() => ({ buy: document.querySelector('.layout>.card:nth-child(1)').getBoundingClientRect().width,
  led: document.querySelector('.layout>.card:nth-child(3)').getBoundingClientRect().width,
  mid: document.querySelector('.layout>.card:nth-child(2)').getBoundingClientRect().width,
  buyHidden: getComputedStyle(document.getElementById('buysearch')).display === 'none' }));
check('folding Buy and History shrinks them to a strip', fold.buy < 60 && fold.led < 60 && fold.buyHidden, JSON.stringify(fold));
check('…and the Character panel widens', fold.mid > w0 + 400, `${Math.round(w0)} -> ${Math.round(fold.mid)}`);
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => document.querySelector('#sheet .shskills'), { timeout: 25000 });
check('the fold is remembered after a reload', await page.evaluate(() => document.querySelector('.layout>.card:nth-child(1)').classList.contains('clp') && document.querySelector('.layout>.card:nth-child(3)').classList.contains('clp')));
await page.click('.layout>.card:nth-child(1)>h3');
check('clicking the strip opens it again', await page.evaluate(() => document.querySelector('.layout>.card:nth-child(1)').getBoundingClientRect().width > 250));

const SHOT = process.env.SHOT_DIR;
if (SHOT) { fs.mkdirSync(SHOT, { recursive: true }); await page.locator('#sheet').screenshot({ path: path.join(SHOT, 'livesheet-center-panel-desktop.png') }); }
const fatal = errs.filter(e => !/Failed to load|net::|supabase|fetch/i.test(e));
check('no fatal page errors (desktop)', fatal.length === 0, fatal.slice(0, 2).join(' | '));
await ctx.close();

const ph = await run({ width: 390, height: 844 });
check('on a phone the skills list stacks above the sheet', await ph.page.evaluate(() => {
  const a = document.querySelector('.shskills').getBoundingClientRect(), b = document.querySelector('.shmain').getBoundingClientRect();
  return a.bottom <= b.top + 1; }));
check('no sideways scroll on a phone', await ph.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
if (SHOT) await ph.page.locator('#sheet').screenshot({ path: path.join(SHOT, 'livesheet-center-panel-phone.png') });
await ph.ctx.close();

// 4. The DM can switch off the "N drawbacks chosen" advice for a campaign (DM Console → rules.drawbackCountAdvice=false).
const E = await import('../../js/engine.js');
const C = await import('../../js/campaign.js').catch(() => null);
const many = Object.assign(E.baseBuild(), { drawbacks: Object.keys(E.DATA.drawbacks).filter(d => !/Frail|Glass/.test(d)).slice(0, 5) });
const has = o => E.compute(many, o).warnings.some(w => /drawbacks chosen/.test(w));
check('engine: 5 drawbacks raise the count advice by default', has({}));
check('engine: drawbackCountAdvice:false switches it off', !has({ drawbackCountAdvice: false }));
check('engine: purchaseLegality honours it too',
  !E.purchaseLegality(Object.assign(E.baseBuild(), { drawbacks: many.drawbacks.slice(0, 3) }), 'drawback', { v: many.drawbacks[3] }, { drawbackCountAdvice: false }).warnings.some(w => /drawbacks chosen/.test(w))
  && E.purchaseLegality(Object.assign(E.baseBuild(), { drawbacks: many.drawbacks.slice(0, 3) }), 'drawback', { v: many.drawbacks[3] }).warnings.some(w => /drawbacks chosen/.test(w)));
if (C) {
  check('campaign rule: absent means on', C.drawbackCountAdviceFromRules({}) === undefined && C.drawbackCountAdviceFromRules(null) === undefined);
  check('campaign rule: false switches it off', C.drawbackCountAdviceFromRules({ drawbackCountAdvice: false }) === false);
}
{
  const ctx3 = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const p3 = await ctx3.newPage();
  const L2 = [LOG[0], { ...LOG[1], payload: { patch: { ...LOG[1].payload.patch, drawbacks: many.drawbacks } } }];
  await p3.addInitScript((env) => { try { localStorage.setItem('pactLiveSheet', JSON.stringify(env)); } catch (e) {} },
    { schema: 'pact-character/1', LOG: L2, SEQ: 3 });
  await p3.goto(`http://localhost:${PORT}/PACT/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' });
  await p3.waitForFunction(() => window.skillMods && document.querySelector('#sheet .shskills') && window._campaignBridge, { timeout: 25000 });
  const tray = async (rules) => p3.evaluate((rules) => { window._rulesStatus = rules ? 'active' : 'none'; window._cloudCampaignRules = rules; render(); return document.getElementById('tray').innerText; }, rules);
  check('Live Sheet: the advice shows with no campaign', /drawbacks chosen/.test(await tray(null)));
  check('Live Sheet: the advice shows in a campaign that leaves it on', /drawbacks chosen/.test(await tray({})));
  check('Live Sheet: the advice is gone when the DM switches it off', !/drawbacks chosen/.test(await tray({ drawbackCountAdvice: false })));
  await ctx3.close();
}

await browser.close(); server.close();
console.log(`\n${fail ? '✗' : '✓'} ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
