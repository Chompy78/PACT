/* PACT — Live Sheet layout (feat/livesheet-sheet-layout, owner request 2026-10-14).
 *   1. Skills are colour-coded by ability, with the same colour map as the Stats card and its saves (_CSABCOL).
 *   2. The description PARAGRAPH and the backstory are always shown; only the individual fields fold away (owner AR1).
 *   Review of #672: tools/instruments/custom proficiencies keep their check bonus and ✦; typed slot boxes are never hidden;
 *   a Sheet redraw keeps the focused field; the class/species line is escaped; starting gold from AP is shown.
 *   3. The Character panel and the 📋 Sheet show the same sections in the same order, with the same labels and styling —
 *      one renderer (_lsCharBody) — and the Sheet then adds only its at-the-table extras (HP, death saves, AP ledger).
 *
 *   node testing/scripts/livesheet-sheet-layout-e2e.mjs   (expect 0 failed; PACT_E2E_PORT to change the port)
 *   SHOT_DIR=<dir> node …     also saves desktop and phone screenshots of the panel and the Sheet
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = Number(process.env.PACT_E2E_PORT) || 7995;
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
const LOG = [
  { type: 'award', amount: 600, seq: 1, label: 'Award' },
  { type: 'buy', cat: 'patch', cost: 0, level: 3, seq: 2, label: 'Identity',
    payload: { patch: { name: 'Wren', species: 'Tiefling', lineage: 'Infernal', originClass: 'Rogue', hd: 3, languages: 2, languageNames: ['Common', XSS],
      stats: { STR: 8, DEX: 16, CON: 12, INT: 14, WIS: 12, CHA: 13 }, saves: ['DEX', 'INT'], skills: ['Stealth', 'Perception', 'Arcana'], expertise: ['Stealth'],
      racialSpells: ['Fire Bolt'], racialTraits: ['Tiefling: Thaumaturgy cantrip'], weaponProf: { simple: true }, armour: { light: true },
      tools: ["Thieves' tools"], toolExpertise: ["Thieves' tools"], customProfs: ['Ship rigging ' + XSS],
      boons: ['Boon of Combat Prowess'], drawbacks: ['Asthmatic'],
      traditions: [{ name: 'Arcane', rank: 1, disciplines: [{ name: 'Wizard', cantrips: 1, slots: [2,0,0,0,0,0,0,0,0], known: [1,0,0,0,0,0,0,0,0], cantripNames: ['Mage Hand'], knownNames: [['Magic Missile']] }] }],
      appearance: { overall: 'A wiry tiefling with a crooked grin.', hair: 'black', backstory: 'Grew up on the docks.' } } } },
];

const browser = await launchChromium();
const open = async (viewport, seedLocal) => {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript(([env, seed]) => { try { localStorage.setItem('pactLiveSheet', JSON.stringify(env)); localStorage.setItem('pactLSnoSpell', '0');
    if (seed) localStorage.setItem('pactCharSheetManual:livesheet', JSON.stringify({ [env.id]: seed })); } catch (e) {} },
    [{ schema: 'pact-character/1', LOG, SEQ: LOG.length + 1, id: 'layout-test-1' }, seedLocal || null]);
  await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.compute && document.querySelector('#sheet .shskills'), { timeout: 25000 });
  return { ctx, page, errs };
};
const openSheet = (page) => page.evaluate(() => { if (document.getElementById('sheetview').style.display !== 'block') toggleSheet(); });
const closeSheet = (page) => page.evaluate(() => { if (document.getElementById('sheetview').style.display === 'block') toggleSheet(); });

// The section outline of a view: every heading-like label, in document order.
const outline = (page, root) => page.evaluate((root) => {
  const R = document.querySelector(root);
  return [...R.querySelectorAll('.shname, .shc > h5, .seg > b:first-child, .lsdtop > b, .lsdfold > summary, .sphd, .spname, .splevel .lh > span:first-child, .pssec > h4, .skpp')]
    .map(e => (e.firstChild && e.firstChild.nodeType === 3 ? e.firstChild.textContent : e.textContent).replace(/\s+/g, ' ').trim()); }, root);

{
  const { ctx, page, errs } = await open({ width: 1400, height: 1000 }, { equip: 'Rope, lantern', curHP: '11' });

  // 1. skills in their ability colour — the same map as the Stats card and its saves
  const sk = await page.evaluate(() => [...document.querySelectorAll('#sheet .skrow')].map(r => ({ ab: r.querySelector('.skab').textContent,
    c: getComputedStyle(r.querySelector('.skab')).color, bar: getComputedStyle(r).borderLeftColor })));
  const col = await page.evaluate(() => _CSABCOL);
  const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };
  check('every skill shows its ability in that ability\'s colour', sk.length > 10 && sk.every(s => s.c === rgb(col[s.ab]) && s.bar === rgb(col[s.ab])), JSON.stringify(sk.filter(s => s.c !== rgb(col[s.ab])).slice(0, 3)));
  const stat = await page.evaluate(() => [...document.querySelectorAll('#sheet .shstats .abx b')].map(b => [b.textContent, getComputedStyle(b).color]));
  check('…the same colours as the Stats card', stat.every(([a, c]) => c === rgb(col[a])), JSON.stringify(stat));
  const pp = await page.evaluate(() => { const p = skillMods(foldBuild(null)).find(k => k.skill === 'Perception'); return [10 + p.total, (document.querySelector('#sheet .skpp') || {}).textContent]; });
  check('Passive Perception (from skillMods) under the skills', pp[1] && pp[1].includes(String(pp[0])), JSON.stringify(pp));

  // 2. description paragraph always visible; only the fields fold
  const d = await page.evaluate(() => { const box = document.querySelector('#sheet .lsdesc'), ta = box.querySelector('[data-lsd="overall"]'), bs = box.querySelector('[data-lsd="backstory"]'), hair = box.querySelector('[data-lsd="hair"]'), f = box.querySelector('details.lsdfold');
    return { para: ta && ta.checkVisibility() && ta.value, back: bs && bs.checkVisibility() && bs.value, folded: f && !f.open, hairHidden: hair && !hair.checkVisibility(), outside: f && !f.contains(ta) && !f.contains(bs) }; });
  check('the description paragraph and the backstory are shown with the fields folded', d.para === 'A wiry tiefling with a crooked grin.' && d.back === 'Grew up on the docks.' && d.folded && d.hairHidden && d.outside, JSON.stringify(d));
  await page.click('#sheet .lsdfold summary');
  check('opening "Details" shows the fields', await page.evaluate(() => document.querySelector('#sheet [data-lsd="hair"]').checkVisibility()));
  await page.click('#sheet .lsdfold summary');

  // review of #672: tools keep their bonus and ✦, custom proficiencies are listed, starting gold is shown
  const tl = await page.evaluate(() => { const seg = [...document.querySelectorAll('#sheet .seg')].find(x => /^Tools\/Instr:/.test(x.innerText)); const b = foldBuild(null), r = compute(b);
    return { t: seg ? seg.innerText : '', exp: '(DEX +' + (r.mods.DEX + 2 * r.prof) + ') ✦', gold: [...document.querySelectorAll('#sheet .seg')].some(x => x.innerText === 'Starting gold from AP: ' + r.goldGp + ' gp') }; });
  check('Tools line: a tool shows its check bonus and ✦ expertise', tl.t.includes("Thieves' tools " + tl.exp), tl.t);
  check('…custom proficiencies are listed (escaped)', /Ship rigging <img src=x/.test(tl.t), tl.t);
  check('Starting gold from AP is shown', tl.gold);

  // 3. the Character panel and the 📋 Sheet: same sections, same order, same labels, same styling
  const mid = await outline(page, '#sheet');
  await openSheet(page);
  const sh = await outline(page, '#sheetbody');
  check('the Sheet starts with exactly the Character panel\'s sections, in order', JSON.stringify(sh.slice(0, mid.length)) === JSON.stringify(mid), `panel ${JSON.stringify(mid)}\n         sheet ${JSON.stringify(sh)}`);
  check('…then only its at-the-table extras', JSON.stringify(sh.slice(mid.length)).match(/At the table/) && JSON.stringify(sh.slice(mid.length)).match(/AP Ledger/), JSON.stringify(sh.slice(mid.length)));
  for (const lab of ['Stats', 'Skills', 'General', 'Species:', 'Languages:', 'Proficiencies:', 'Species traits:', 'Features:', 'Drawbacks:', 'Appearance & description', 'Spellcasting', 'From heritage & other sources'])
    check(`both views have "${lab}"`, mid.some(t => t.startsWith(lab)) && sh.some(t => t.startsWith(lab)));
  const sty = await page.evaluate(() => { const g = (sel) => { const e = document.querySelector(sel); const c = getComputedStyle(e); return [c.fontSize, c.fontWeight, c.color, c.borderLeftWidth].join('/'); };
    return ['.skrow.on', '.abx', '.shc > h5', '.seg', '.sprow'].map(s => [s, g('#sheet ' + s), g('#sheetbody ' + s)]); });
  check('…styled the same (skills, ability boxes, headings, rows)', sty.every(([, a, b]) => a === b), JSON.stringify(sty.filter(([, a, b]) => a !== b)));
  check('the Sheet keeps the at-the-table fields (HP seeded to max, death saves)', await page.evaluate(() => document.querySelector('#sheetbody [data-mf="curHP"]').value === '11' && document.querySelectorAll('#sheetbody [data-mf^="ds_"]').length === 6));
  check('older device-only notes are still shown, never hidden', await page.evaluate(() => (document.querySelector('#sheetbody [data-mf="equip"]') || {}).value === 'Rope, lantern'));
  check('player text is escaped in both views', await page.evaluate(() => !window.__pwn && !document.querySelector('#sheet img[src="x"], #sheetbody img[src="x"]') && /<img src=x/.test(document.querySelector('#sheetbody').innerText)));

  // #670's Wearing row and AC/HP tooltips live in the shared body: both views carry them, ids stay unique
  const wr = await page.evaluate(() => ({ panel: !!document.querySelector('#sheet #lsWornArmour'), sheet: !!document.querySelector('#sheetbody #lsWornArmourSh'),
    dupIds: [...document.querySelectorAll('[id]')].map(e => e.id).filter((x, i, a) => a.indexOf(x) !== i),
    tips: ['#sheet', '#sheetbody'].map(h => [...document.querySelectorAll(h + ' .shstats .kp')].filter(k => /^(AC|HP) \d+ = /.test(k.title)).length) }));
  check('the Wearing row is in both the panel and the Sheet, with unique ids', wr.panel && wr.sheet && !wr.dupIds.length, JSON.stringify(wr));
  check('…and both carry the AC and HP breakdown tooltips', wr.tips[0] === 2 && wr.tips[1] === 2, JSON.stringify(wr.tips));
  const ac = await page.evaluate(() => { const s = document.getElementById('lsWornArmourSh'); const o = [...s.options].find(x => x.value && !x.disabled); if (!o) return null;
    s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); const r = compute(foldBuild(null), _dmOpts());
    return { want: r.ac, worn: foldBuild(null).wornArmour, panel: document.querySelector('#sheet .shstats .kp b').textContent, sheet: document.querySelector('#sheetbody .shstats .kp b').textContent, v: o.value }; });
  check('choosing armour in the Sheet updates the AC in both views (from compute())', ac && ac.worn === ac.v && ac.panel === String(ac.want) && ac.sheet === String(ac.want), JSON.stringify(ac));

  // a Sheet redraw keeps the focused field (review of #672)
  await page.focus('#sheetbody [data-mf="tempHP"]');
  await page.evaluate(() => render());
  check('a redraw while the Sheet is open keeps the focused field', await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-mf') === 'tempHP' && document.getElementById('sheetbody').contains(document.activeElement)));

  // an edit made in the Sheet shows in both views
  await page.evaluate(() => { const t = document.querySelector('#sheetbody [data-lsd="overall"]'); t.value = 'Edited in the Sheet.'; t.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(100);
  check('a description edit in the Sheet updates both views', await page.evaluate(() => document.querySelector('#sheetbody [data-lsd="overall"]').value === 'Edited in the Sheet.' && document.querySelector('#sheet [data-lsd="overall"]').value === 'Edited in the Sheet.'));
  if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, 'layout-sheet-desktop.png'), fullPage: false });
  await closeSheet(page);
  if (process.env.SHOT_DIR) await page.locator('#sheet').screenshot({ path: path.join(process.env.SHOT_DIR, 'layout-panel-desktop.png') });
  check('no page errors', !errs.length, errs.join(' | '));
  await ctx.close();
}

// a non-caster with slot numbers typed on this device still sees them (review of #672)
{
  const save = LOG[1].payload.patch.traditions; delete LOG[1].payload.patch.traditions;
  const { ctx, page, errs } = await open({ width: 1400, height: 1000 }, { slot_L1: '2/1' });
  await openSheet(page);
  check('typed spell-slot boxes stay visible on a non-caster', await page.evaluate(() => (document.querySelector('#sheetbody [data-mf="slot_L1"]') || {}).value === '2/1'));
  await closeSheet(page);
  check('no page errors (non-caster)', !errs.length, errs.join(' | '));
  await ctx.close();
  LOG[1].payload.patch.traditions = save;
}

// phone width: neither view scrolls sideways
{
  const { ctx, page, errs } = await open({ width: 390, height: 844 });
  const over = (sel) => page.evaluate((sel) => { const e = document.querySelector(sel); return e.scrollWidth - e.clientWidth; }, sel);
  check('phone: the Character panel fits the width', await over('#sheet') <= 1, String(await over('#sheet')));
  await openSheet(page);
  check('phone: the 📋 Sheet fits the width', await over('#sheetview') <= 1, String(await over('#sheetview')));
  if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, 'layout-sheet-phone.png'), fullPage: true });
  check('phone: no page errors', !errs.length, errs.join(' | '));
  await ctx.close();
}

await browser.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
