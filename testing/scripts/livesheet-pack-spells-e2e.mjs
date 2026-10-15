/* PACT — spells from a heritage lineage, a species trait or a grant show in every spell list (fix/livesheet-pack-spells,
 * owner report 2026-10-14: a Tiefling's lineage Fire Bolt and its Thaumaturgy trait never appeared in the Live Sheet).
 *
 * Checks, for a character with and without a tradition:
 *   - the Live Sheet's Character panel and its 📋 Sheet list the lineage cantrip, the lineage 1st-level spell and the trait
 *     cantrip, each saying where it came from (rows from the engine's grantedSpells(), never re-derived in the tool);
 *   - bought tradition spells are unchanged;
 *   - CharGen's Sheet tab (its own renderCharSheet copy) lists them too;
 *   - a player-typed grant name is escaped.
 *
 *   node testing/scripts/livesheet-pack-spells-e2e.mjs   (expect 0 failed; PACT_E2E_PORT to change the port)
 *   SHOT_DIR=<dir> node …     also saves desktop and phone screenshots of the spell section
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = Number(process.env.PACT_E2E_PORT) || 7993;
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

const XSS = '<img src=x onerror="window.__pwn=1">';
const base = { species: 'Tiefling', lineage: 'Infernal', originClass: 'Rogue', hd: 3, languages: 1, languageNames: ['Common'],
  stats: { STR: 10, DEX: 16, CON: 12, INT: 14, WIS: 10, CHA: 12 },
  racialSpells: ['Fire Bolt', 'Hellish Rebuke'], racialTraits: ['Tiefling: Thaumaturgy cantrip'] };
const caster = { traditions: [{ name: 'Arcane', rank: 1, disciplines: [{ name: 'Wizard', cantrips: 1, slots: [2,0,0,0,0,0,0,0,0],
  known: [1,0,0,0,0,0,0,0,0], cantripNames: ['Mage Hand'], knownNames: [['Magic Missile']] }] }],
  grantNames: { 'Rogue: Arcane Trickster': [XSS] } };
const logOf = (patch) => [
  { type: 'award', amount: 600, seq: 1, label: 'Award' },
  { type: 'buy', cat: 'patch', cost: 0, level: 3, seq: 2, label: 'Identity', payload: { patch } },
];

const browser = await launchChromium();
const open = async (LOG, viewport = { width: 1400, height: 1000 }) => {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript((env) => { try { localStorage.setItem('pactLiveSheet', JSON.stringify(env)); localStorage.setItem('pactLSnoSpell', '0'); } catch (e) {} },
    { schema: 'pact-character/1', LOG, SEQ: LOG.length + 1 });
  await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.compute && document.querySelector('#sheet .shname'), { timeout: 25000 });
  return { ctx, page, errs };
};
const rowsIn = (page, sel) => page.evaluate((sel) => [...document.querySelectorAll(sel + ' .sprow')]
  .map(e => e.innerText.replace(/\s+/g, ' ').trim()), sel);
const sheetRows = (page) => page.evaluate(() => { toggleSheet();
  const t = [...document.querySelectorAll('#sheetbody .sprow')].map(e => e.innerText.replace(/\s+/g, ' ').trim()); toggleSheet(); return t; });
const has = (rows, re) => rows.some(t => re.test(t));

// 1. No tradition at all: before this fix the Character panel had no spell section and the 📋 Sheet only a side box.
{
  const { ctx, page, errs } = await open(logOf(base));
  const c = await rowsIn(page, '#sheet .spgrants');
  check('no tradition: the Character panel lists the lineage cantrip with its source', has(c, /^◆ Fire Bolt from Infernal Tiefling lineage/), JSON.stringify(c));
  check('…the lineage 1st-level spell, with its level', has(c, /^● Hellish Rebuke from Infernal Tiefling lineage · 1st-level/), JSON.stringify(c));
  check('…and the species-trait cantrip, labelled with the trait', has(c, /^◆ Thaumaturgy from Tiefling trait — Thaumaturgy cantrip/), JSON.stringify(c));
  const eng = await page.evaluate(() => grantedSpells(foldBuild(null)).map(g => g.name).sort().join(','));
  check('…exactly the rows the engine\'s grantedSpells() returns', eng === 'Fire Bolt,Hellish Rebuke,Thaumaturgy' && c.length === 3, eng);
  const s = await sheetRows(page);
  check('no tradition: the 📋 Sheet lists all three with their source', has(s, /Fire Bolt from Infernal Tiefling lineage/) && has(s, /Hellish Rebuke from Infernal Tiefling lineage/) && has(s, /Thaumaturgy from Tiefling trait/), JSON.stringify(s));
  check('no page errors', !errs.length, errs.join(' | '));
  await ctx.close();
}

// 2. A Wizard tradition beside them: the bought spells stay as they were; the granted ones sit in their own labelled block.
{
  const { ctx, page, errs } = await open(logOf(Object.assign({}, base, caster)));
  const all = await rowsIn(page, '#sheet .spellsec');
  const disc = await page.evaluate(() => [...document.querySelectorAll('#sheet .spdisc:not(.spgrants) .sprow')].map(e => e.innerText.replace(/\s+/g, ' ').trim()));
  check('bought cantrip and spell unchanged in the Wizard discipline', disc.includes('◆ Mage Hand') && disc.includes('● Magic Missile'), JSON.stringify(disc));
  check('…and no granted spell leaks into the discipline lists', !has(disc, /Fire Bolt|Thaumaturgy|Hellish/), JSON.stringify(disc));
  check('granted spells listed in the same Spellcasting section', has(all, /Fire Bolt from Infernal Tiefling lineage/) && has(all, /Thaumaturgy from Tiefling trait/), JSON.stringify(all));
  check('a choice-grant pick names its grant', has(all, /from Arcane Trickster/), JSON.stringify(all));
  check('the player-typed grant name is escaped (shown as text, never run)', await page.evaluate(() => !window.__pwn && !document.querySelector('#sheet .spgrants img')) && has(all, /<img src=x/), '');
  const s = await sheetRows(page);
  check('📋 Sheet: bought spells unchanged and granted spells labelled', s.includes('◆ Mage Hand') && s.includes('● Magic Missile') && has(s, /Fire Bolt from Infernal Tiefling lineage/) && has(s, /Thaumaturgy from Tiefling trait/), JSON.stringify(s));
  check('📋 Sheet: no injected element ran', await page.evaluate(() => { toggleSheet(); const ok = !window.__pwn && !document.querySelector('#sheetbody .spgrants img'); toggleSheet(); return ok; }));
  check('no page errors', !errs.length, errs.join(' | '));
  if (process.env.SHOT_DIR) await page.locator('#sheet .spellsec').screenshot({ path: path.join(process.env.SHOT_DIR, 'pack-spells-desktop.png') });
  await ctx.close();
  const ph = await open(logOf(Object.assign({}, base, caster)), { width: 390, height: 844 });
  const over = await ph.page.evaluate(() => { const g = document.querySelector('#sheet .spgrants'); return g ? g.scrollWidth - g.clientWidth : -1; });
  check('phone width: the granted block fits without sideways scrolling', over >= 0 && over <= 1, String(over));
  if (process.env.SHOT_DIR) await ph.page.locator('#sheet .spgrants').screenshot({ path: path.join(process.env.SHOT_DIR, 'pack-spells-phone.png') });
  await ph.ctx.close();
}

// 3. CharGen's Sheet tab renders through its own copy of renderCharSheet — it must list them too.
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.compute && window.grantedSpells && typeof renderCharSheet === 'function', { timeout: 25000 });
  const rows = await page.evaluate(async (LOG) => { const E = await import('/PACT/js/engine.js'); const b = E.foldBuild(LOG);
    const d = document.createElement('div'); d.innerHTML = renderCharSheet(b, E.compute(b), {});
    return [...d.querySelectorAll('.sprow')].map(e => e.textContent.replace(/\s+/g, ' ').trim()); }, logOf(Object.assign({}, base, caster)));
  check('CharGen Sheet tab: lineage and trait spells listed with their source', has(rows, /Fire Bolt from Infernal Tiefling lineage/) && has(rows, /Thaumaturgy from Tiefling trait/) && has(rows, /Hellish Rebuke/), JSON.stringify(rows));
  check('CharGen Sheet tab: bought spells unchanged', rows.includes('◆Mage Hand') || rows.includes('◆ Mage Hand'), JSON.stringify(rows));
  check('CharGen: no page errors', !errs.length, errs.join(' | '));
  await ctx.close();
}

await browser.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
