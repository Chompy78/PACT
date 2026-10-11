/* PACT — Live Sheet center panel (feat/livesheet-center-panel, owner request 2026-10-12).
 *   1. Every skill, owned or not, in a vertical list with its ability and total bonus (engine skillMods()).
 *   2. A tap-able ⓘ after each boon and drawback that shows its effect (drawbacks' hover text was always blank:
 *      it read .fx off DATA.drawbacks[x], which is a price).
 *   3. The "not named" notice lists WHICH spells and languages are blank.
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

await browser.close(); server.close();
console.log(`\n${fail ? '✗' : '✓'} ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
