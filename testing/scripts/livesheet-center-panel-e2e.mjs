/* PACT — Live Sheet center panel (feat/livesheet-center-panel, owner request 2026-10-12).
 *   1. Every skill, owned or not, in a vertical list with its ability and total bonus (engine skillMods()).
 *   2. A tap-able ⓘ after each boon and drawback that shows its effect (drawbacks' hover text was always blank:
 *      it read .fx off DATA.drawbacks[x], which is a price).
 *   3. The "not named" notice lists WHICH spells and languages are blank.
 *   6. The player's own sheet: coins, weapons (engine weaponAttack()) and note sections, saved with the character.
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
const PORT = Number(process.env.PACT_E2E_PORT) || 7989;
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

// 6. The player's own sheet: coins, weapons (to-hit / damage worked out by the engine), note sections — saved in the LOG.
const XSS = '"><img src=x onerror="window.__pwn=1">';
await page.click('button:has-text("+ Add weapon")');
await page.waitForSelector('.pswpn');
const setPs = async (key, v) => page.evaluate(([key, v]) => { const el = document.querySelector('[data-ps="' + key + '"]');
  if (el.type === 'checkbox') el.checked = v; else el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, [key, v]);
await setPs('weapons.0.n', 'Rapier ' + XSS);
await setPs('weapons.0.ab', 'FIN');
await setPs('weapons.0.bonus', '1');
await setPs('weapons.0.dice', '1d8');
await setPs('weapons.0.type', 'Piercing');
const wexp = await page.evaluate(() => { const b = foldBuild(null), r = compute(b); return { hit: Math.max(r.mods.STR, r.mods.DEX) + r.prof + 1, dmg: Math.max(r.mods.STR, r.mods.DEX) + 1 }; });
const wrow = await page.evaluate(() => document.querySelector('.pswpn .pswtop').innerText.replace(/\s+/g, ' '));
check('a finesse weapon\'s to-hit = best of STR/DEX + proficiency + magic', wrow.includes('To hit +' + wexp.hit), wrow);
check('…and its damage shows dice + bonus + type', wrow.includes('1d8 + ' + wexp.dmg + ' piercing'), wrow);
await page.click('button:has-text("+ Add section")');
await setPs('notes.0.t', '🎒 Gear');
await setPs('notes.0.x', 'Rope (50 ft)\nLantern');
await setPs('coins.sp', '23');
const saved = await page.evaluate(() => foldBuild(null).appearance.playerSheet);
check('weapons, notes and coins are saved in the character', saved && saved.weapons[0].dice === '1d8' && saved.notes[0].x.includes('Lantern') && saved.coins.sp === 23, JSON.stringify(saved).slice(0, 200));
check('editing the sheet adds only one history entry', await page.evaluate(() => LOG.filter(e => e.cat === 'patch' && e.payload && e.payload.patch && e.payload.patch.appearance).length === 1));
check('player text is escaped (no injected element ran)', await page.evaluate(() => !window.__pwn && !document.querySelector('#sheet img[src="x"]')));
// (A reload would re-seed this harness's character, so check the saved copy itself.)
check('they are in the saved character (what a reload or cloud save reads)', await page.evaluate(() => {
  const env = JSON.parse(localStorage.getItem('pactLiveSheet') || '{}');
  return JSON.stringify(env.LOG || []).includes('Lantern') && JSON.stringify(env.LOG || []).includes('Rapier'); }));
if (process.env.SHOT_DIR) await page.locator('#sheet .shmain').screenshot({ path: path.join(process.env.SHOT_DIR, 'livesheet-player-sheet.png') });
await page.evaluate(() => { window.confirm = () => true; });
await page.click('.pswpn .psdel');
check('a weapon can be removed', await page.evaluate(() => foldBuild(null).appearance.playerSheet.weapons.length === 0));

// feat/livesheet-centre-columns: name on top, then Stats · Skills · General side by side, then Spellcasting/notes below.
check('Stats, Skills and General sit side by side under the name', await page.evaluate(() => {
  const r = s => document.querySelector('#sheet ' + s).getBoundingClientRect();
  const n = r('.shname'), st = r('.shstats'), sk = r('.shskills'), g = r('.shmain');
  return n.bottom <= st.top + 1 && st.right <= sk.left + 1 && sk.right <= g.left + 1 && Math.abs(st.top - sk.top) < 2 && Math.abs(sk.top - g.top) < 2; }));
check('the description block is inside General', await page.evaluate(() => !!document.querySelector('#sheet .shmain .lsdesc')));
check('coins/weapons/notes come after the three columns', await page.evaluate(() => {
  const c = document.querySelector('#sheet .shcols3').getBoundingClientRect(), p = document.querySelector('#sheet .pssec').getBoundingClientRect();
  return p.top >= c.bottom - 1; }));
// feat/livesheet-sheet-view-desc: the Character panel points at the full Sheet; the tip shows once, then goes for good.
check('the Character panel has an "Open full sheet" button and a one-time tip', await page.evaluate(() => !!document.querySelector('#sheet .lssheetbtn') && !!document.getElementById('lsSheetTip')));
await page.evaluate(() => { toggleSheet(); toggleSheet(); render(); });
check('…opening the Sheet retires the tip (remembered)', await page.evaluate(() => !document.getElementById('lsSheetTip') && localStorage.getItem('pactLsSheetTipSeen') === '1'));
check('the Sheet view uses the same collapsed Appearance & description block', await page.evaluate(() => { toggleSheet();
  const d = document.querySelector('#sheetbody .lsdesc'); const ok = !!d && !d.open && !!d.querySelector('[data-lsd="overall"]') && !d.querySelector('[data-lsd="alignment"]')
    && ![...document.querySelectorAll('#sheetbody h5')].some(h => /Personality|Backstory/.test(h.textContent)); toggleSheet(); return ok; }));
check('the Sheet view gives features, boons and drawbacks an ⓘ', await page.evaluate(() => { toggleSheet();
  const t = [...document.querySelectorAll('#sheetbody .fxi')].map(e => e.title); toggleSheet(); return t.some(x => /miss into a hit/.test(x)) && t.some(x => /Dash/.test(x)); }));
check('the description is collapsed by default', await page.evaluate(() => !document.querySelector('#sheet .lsdesc').open));
await page.click('#sheet .lsdesc summary');
await page.fill('#sheet [data-lsd="hair"]', 'copper "braided" <b>x</b>');
await page.press('#sheet [data-lsd="hair"]', 'Tab');
await page.waitForTimeout(150);
check('editing a description field saves it in the character', await page.evaluate(() => (foldBuild(null).appearance || {}).hair) === 'copper "braided" <b>x</b>');
check('…the block stays open and focus moves on to the next field', await page.evaluate(() =>
  document.querySelector('#sheet .lsdesc').open && document.activeElement && document.activeElement.getAttribute('data-lsd') === 'eyes'));
check('…and the value is escaped (no element injected)', await page.evaluate(() => !document.querySelector('#sheet .lsdesc .lsdgrid b')));
await page.fill('#sheet [data-lsd="eyes"]', 'grey');
await page.press('#sheet [data-lsd="eyes"]', 'Tab');
await page.waitForTimeout(150);
const regen = await page.evaluate(() => { const before = LOG.length; lsRegenDesc(); const b = foldBuild(null);
  return { para: b.appearance.overall, want: pactComposeDescription(b.appearance, { name: b.name, species: b.species, originClass: b.originClass }), shown: document.querySelector('#sheet [data-lsd="overall"]').value, grew: LOG.length - before }; });
check('🪶 Regenerate paragraph writes the paragraph from the fields', /grey eyes/.test(regen.para) && regen.para === regen.want && regen.shown === regen.para, regen.para);
check('…without adding a history entry', regen.grew === 0, String(regen.grew));
const asked = await page.evaluate(() => { let n = 0; const c = window.confirm; window.confirm = () => { n++; return false; };   // the weapon test above stubbed it to true
  _shCommitAppearanceField('overall', 'Hand-written.'); lsRegenDesc(); window.confirm = c; return n; });
const kept = await page.evaluate(() => foldBuild(null).appearance.overall);
check('…and asks before replacing a hand-written paragraph (cancel keeps it)', asked === 1 && kept === 'Hand-written.', kept);
const SHOT = process.env.SHOT_DIR;
if (SHOT) { fs.mkdirSync(SHOT, { recursive: true }); await page.locator('#sheet').screenshot({ path: path.join(SHOT, 'livesheet-center-panel-desktop.png') }); }
// fix/livesheet-header-and-panel-width: drag Buy's inner edge to widen it; remembered after a reload; double-click resets.
{
  const buyW = () => page.evaluate(() => Math.round(document.querySelector('.layout>.card').getBoundingClientRect().width));
  await page.evaluate(() => { const c = document.querySelector('.layout>.card'); c.classList.remove('clp'); });
  const g = await page.locator('.layout>.card:nth-child(1)>.colgrip').boundingBox();
  const w0 = await buyW();
  await page.mouse.move(g.x + 5, g.y + g.height / 2); await page.mouse.down();
  await page.mouse.move(g.x + 125, g.y + g.height / 2, { steps: 6 }); await page.mouse.up();
  const w1 = await buyW();
  check('dragging the Buy panel\'s edge widens it', w1 >= w0 + 110, w0 + ' -> ' + w1);
  check('…and the width is remembered', await page.evaluate(() => (JSON.parse(localStorage.getItem('pactLsPanelWidth') || '{}').buy || 0)) === w1);
  await page.locator('.layout>.card:nth-child(1)>.colgrip').dblclick();
  check('double-clicking the edge resets it', await buyW() === 300, String(await buyW()));
}
const fatal = errs.filter(e => !/Failed to load|net::|supabase|fetch/i.test(e));
check('no fatal page errors (desktop)', fatal.length === 0, fatal.slice(0, 2).join(' | '));
await ctx.close();

const ph = await run({ width: 390, height: 844 });
check('on a phone the skills list stacks above the sheet', await ph.page.evaluate(() => {
  const a = document.querySelector('.shskills').getBoundingClientRect(), b = document.querySelector('.shmain').getBoundingClientRect();
  return a.bottom <= b.top + 1; }));
check('no sideways scroll on a phone', await ph.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
// fix/livesheet-header-and-panel-width: the pinned phone header is only the sheet name, the character name and the buttons.
const hdr = await ph.page.evaluate(() => { const t = document.querySelector('.top'), r = t.getBoundingClientRect();
  return { h: Math.round(r.height), over: t.scrollWidth > t.clientWidth + 1, name: getComputedStyle(document.getElementById('topCharName')).display !== 'none' && document.getElementById('topCharName').textContent,
    eco: !t.contains(document.getElementById('eco')), cut: [...t.children].some(e => e.offsetParent && e.getBoundingClientRect().right > window.innerWidth + 1) }; });
check('phone header: two short rows, nothing cut off or scrolling sideways', hdr.h <= 90 && !hdr.over && !hdr.cut, JSON.stringify(hdr));
check('phone header: shows the character name', hdr.name === await ph.page.evaluate(() => foldBuild(null).name || 'New Character'), String(hdr.name));
check('phone: the AP summary scrolls with the sheet, not pinned', await ph.page.evaluate(() => document.getElementById('lsScroll').contains(document.getElementById('eco'))));
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
