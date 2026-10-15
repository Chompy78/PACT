/* PACT — Live Sheet "Weapons & attacks" (feat/livesheet-weapons, owner request 2026-10-14).
 *   1. The panel is called "Weapons & attacks" and offers every standard Players Handbook simple + martial weapon
 *      (engine WEAPONS), plus the Unarmed Strike and a spell attack. Picking one fills damage dice/type, properties,
 *      range (normal/long) and reach, the attack ability and — where the build says — proficiency.
 *   2. A DM's campaign weapons (campaigns.rules.customWeapons, edited in DM Console's Campaign Rules) are offered to that
 *      campaign's characters only — escaped, never run — and a solo character sees the standard list only.
 *   3. Each weapon's stats sit on ONE line at desktop width (name · to hit · damage · properties/range); a phone may wrap.
 *   4. DM Console: the Campaign weapons editor loads, escapes, cleans and saves rules.customWeapons.
 * No Supabase: campaign rules are set on window directly, as each tool's cloud path would.
 *
 *   node testing/scripts/livesheet-weapons-e2e.mjs   (expect 0 failed)
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

const XSS = '"><img src=x onerror="window.__pwn=1">';
const CUSTOM = [
  { n: 'Sun Blade ' + XSS, dice: '1d8', type: 'Radiant', cat: 'martial', kind: 'melee', props: ['Finesse', 'Versatile (1d10)'], reach: 5 },
  { n: 'Harpoon Gun', dice: '1d10', type: 'Piercing', cat: 'martial', kind: 'ranged', props: 'Loading, Two-Handed', rn: 60, rl: 180 },
];
const LOG = [
  { type: 'award', amount: 400, seq: 1, label: 'Award' },
  { type: 'buy', cat: 'patch', cost: 0, level: 1, seq: 2, label: 'Identity',
    payload: { patch: { species: 'Human', originClass: 'Fighter', hd: 20, languages: 1, languageNames: ['Common'],
      stats: { STR: 16, DEX: 14, CON: 12, INT: 10, WIS: 10, CHA: 8 }, weaponProf: { simple: true } } } },
];

const browser = await launchChromium();
const open = async (viewport) => {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript((env) => { try { localStorage.setItem('pactLiveSheet', JSON.stringify(env)); } catch (e) {} },
    { schema: 'pact-character/1', LOG, SEQ: LOG.length + 1 });
  await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.campaignWeapons && window.WEAPONS && document.querySelector('#sheet .pssec'), null, { timeout: 25000 });
  await page.evaluate(() => { window.confirm = () => true; });
  return { ctx, page, errs };
};
const sheetWeapons = p => p.evaluate(() => foldBuild(null).appearance.playerSheet.weapons);
const topLine = (p, i) => p.evaluate(i => document.querySelectorAll('.pswpn .pswtop')[i].innerText.replace(/\s+/g, ' ').trim(), i);
const pick = (p, i, id) => p.evaluate(([i, id]) => { const s = document.querySelectorAll('.pswpick')[i]; s.value = id; s.dispatchEvent(new Event('change', { bubbles: true })); }, [i, id]);
const addWeapon = async p => { const n = await p.evaluate(() => document.querySelectorAll('.pswpick').length);
  await p.click('button:has-text("+ Add weapon or attack")');
  await p.waitForFunction(n => document.querySelectorAll('.pswpick').length === n + 1, n); };
const pickIds = (p, i) => p.evaluate(i => [...document.querySelectorAll('.pswpick')[i].querySelectorAll('option')].map(o => o.value).filter(Boolean), i);
const groupIds = (p, i, label) => p.evaluate(([i, label]) => { const g = [...document.querySelectorAll('.pswpick')[i].querySelectorAll('optgroup')].find(x => x.label === label);
  return g ? [...g.querySelectorAll('option')].map(o => o.textContent) : null; }, [i, label]);

// ---------- 1. standard weapons (solo character) ----------
const { ctx, page, errs } = await open({ width: 1400, height: 1000 });
check('the panel is called "Weapons & attacks"', await page.evaluate(() => [...document.querySelectorAll('#sheet .pssec h4')].some(h => h.textContent.includes('Weapons & attacks'))));
const std = await page.evaluate(() => window.WEAPONS.map(w => w.n));
check('the engine lists all 38 PHB simple + martial weapons (+ Unarmed Strike)', std.length === 39 &&
  ['Club', 'Dagger', 'Sling', 'Light Crossbow', 'Glaive', 'Whip', 'Blowgun', 'Longbow', 'Musket', 'Pistol', 'Unarmed Strike'].every(n => std.includes(n)), String(std.length));
await addWeapon(page);
const ids = await pickIds(page, 0);
check('every standard weapon can be picked, plus a spell attack', await page.evaluate(() => window.WEAPONS.map(w => w.id)).then(all => all.every(id => ids.includes(id))) && ids.includes('spell-attack'), String(ids.length));
check('…grouped Simple melee / Simple ranged / Martial melee / Martial ranged',
  (await groupIds(page, 0, 'Simple melee')).length === 10 && (await groupIds(page, 0, 'Simple ranged')).length === 4 &&
  (await groupIds(page, 0, 'Martial melee')).length === 18 && (await groupIds(page, 0, 'Martial ranged')).length === 6);
check('a solo character is offered no campaign weapons', (await groupIds(page, 0, "This campaign's weapons")) === null);

await pick(page, 0, 'longbow');
let w = (await sheetWeapons(page))[0];
check('picking the Longbow fills dice, type, properties and range', w.n === 'Longbow' && w.dice === '1d8' && w.type === 'Piercing' &&
  w.rn === 150 && w.rl === 600 && w.reach === '' && /Heavy/.test(w.props) && /Two-Handed/.test(w.props), JSON.stringify(w));
check('…a ranged weapon attacks with DEX', w.ab === 'DEX');
check('…and a martial weapon is not proficient for a Simple-only build', w.prof === false);
const exp = await page.evaluate(() => { const b = foldBuild(null), r = compute(b); return weaponAttack(b, r, b.appearance.playerSheet.weapons[0]); });
let line = await topLine(page, 0);
check('the one line shows name, to-hit (engine weaponAttack), damage and range',
  line.startsWith('Longbow') && line.includes('To hit ' + (exp.toHit >= 0 ? '+' : '') + exp.toHit) && line.includes('1d8 + ' + exp.dmgBonus + ' piercing') && line.includes('Range 150/600 ft'), line);

await addWeapon(page);
await pick(page, 1, 'dagger');
w = (await sheetWeapons(page))[1];
check('the Dagger: finesse ability, simple-proficient, reach 5 and thrown 20/60', w.ab === 'FIN' && w.prof === true && w.reach === 5 && w.rn === 20 && w.rl === 60, JSON.stringify(w));
line = await topLine(page, 1);
check('…shown as "Reach 5 ft · Thrown 20/60 ft"', line.includes('Reach 5 ft · Thrown 20/60 ft'), line);
await addWeapon(page);
await pick(page, 2, 'glaive');
check('a Reach weapon is prefilled with 10 ft reach', (await sheetWeapons(page))[2].reach === 10);
// Range fields are editable (all entries) and drive the line.
await page.evaluate(() => { const el = document.querySelector('[data-ps="weapons.2.reach"]'); el.value = '15'; el.dispatchEvent(new Event('change', { bubbles: true })); });
check('the range fields are editable', (await sheetWeapons(page))[2].reach === 15 && (await topLine(page, 2)).includes('Reach 15 ft'));
// A name the player typed is kept when they re-pick.
await page.evaluate(() => { const el = document.querySelector('[data-ps="weapons.2.n"]'); el.value = 'Grandad\'s polearm'; el.dispatchEvent(new Event('change', { bubbles: true })); });
await pick(page, 2, 'halberd');
w = (await sheetWeapons(page))[2];
check('re-picking keeps a name the player typed, but takes the new stats', w.n === 'Grandad\'s polearm' && w.wid === 'halberd' && w.dice === '1d10' && w.type === 'Slashing');
await addWeapon(page);
await pick(page, 3, 'spell-attack');
const spellExp = await page.evaluate(() => { const b = foldBuild(null), r = compute(b); return weaponAttack(b, r, b.appearance.playerSheet.weapons[3]); });
w = (await sheetWeapons(page))[3];
check('a spell attack uses the spellcasting ability', w.ab === 'SPELL' && w.n === 'Spell attack' && (await topLine(page, 3)).includes('To hit ' + (spellExp.toHit >= 0 ? '+' : '') + spellExp.toHit));

// ---------- 3. one line at desktop width ----------
const oneLine = p => p.evaluate(() => [...document.querySelectorAll('.pswpn .pswtop')].map(t => {
  const kids = [...t.children].filter(c => c.getBoundingClientRect().height > 0), tops = kids.map(c => c.getBoundingClientRect().top);
  return Math.max(...tops) - Math.min(...tops) < 8; }));
check('each weapon\'s stats sit on ONE line at desktop width', (await oneLine(page)).every(Boolean), JSON.stringify(await oneLine(page)));
check('…with the edit fields folded away once the weapon is named', await page.evaluate(() => [...document.querySelectorAll('.pswpn .pswrow')].every(r => r.hidden)));
await page.evaluate(() => document.querySelector('.pswpn .psedit').click());
check('✎ opens a weapon\'s edit fields', await page.evaluate(() => !document.querySelectorAll('.pswpn .pswrow')[0].hidden));

// ---------- 2. a DM's campaign weapons ----------
await page.evaluate(C => { window._rulesStatus = 'active'; window._cloudCampaignRules = { customWeapons: C }; render(); }, CUSTOM);
const camp = await groupIds(page, 0, "This campaign's weapons");
check('a campaign character is offered the DM\'s weapons', camp && camp.length === 2 && camp[1] === 'Harpoon Gun', JSON.stringify(camp));
check('…with markup stripped from the DM-typed name', camp && !/[<>"]/.test(camp[0]) && camp[0].startsWith('Sun Blade'), camp && camp[0]);
await addWeapon(page);
const cid = await page.evaluate(() => [...document.querySelectorAll('.pswpick')[4].querySelectorAll('option')].find(o => o.textContent.startsWith('Sun Blade')).value);
await pick(page, 4, cid);
w = (await sheetWeapons(page))[4];
check('picking a campaign weapon copies its stats', w.dice === '1d8' && w.type === 'Radiant' && w.ab === 'FIN' && /Versatile/.test(w.props) && w.reach === 5, JSON.stringify(w));
await addWeapon(page);
await pick(page, 5, 'custom:harpoon gun');
w = (await sheetWeapons(page))[5];
check('a ranged campaign weapon gets its range, no reach', w.rn === 60 && w.rl === 180 && w.reach === '' && w.ab === 'DEX', JSON.stringify(w));
check('…and its line reads "Range 60/180 ft"', (await topLine(page, 5)).includes('Range 60/180 ft'));
check('no DM-typed markup ran or was injected', await page.evaluate(() => !window.__pwn && !document.querySelector('#sheet img[src="x"]')));
check('no weapon value sits inside an onclick string', await page.evaluate(() => [...document.querySelectorAll('.pssec [onclick]')].every(e => !/Sun Blade|Harpoon|longbow/i.test(e.getAttribute('onclick')))));
await page.evaluate(() => { window._rulesStatus = 'none'; window._cloudCampaignRules = null; render(); });
check('leaving the campaign: the picker shows the standard list only…', (await groupIds(page, 0, "This campaign's weapons")) === null);
check('…but the weapon already copied onto the sheet stays', (await sheetWeapons(page))[4].type === 'Radiant');
check('Live Sheet: no page errors', errs.length === 0, errs.join(' | '));
if (process.env.SHOT_DIR) await page.locator('#sheet .pssec').nth(1).screenshot({ path: path.join(process.env.SHOT_DIR, 'livesheet-weapons-desktop.png') });
await ctx.close();

// ---------- phone: may wrap, never scrolls sideways ----------
{
  const { ctx, page, errs } = await open({ width: 390, height: 844 });
  await addWeapon(page); await pick(page, 0, 'heavy-crossbow');
  check('phone: no sideways scroll with a weapon on the sheet', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  check('phone: the weapon line is still readable (range shown)', (await topLine(page, 0)).includes('Range 100/400 ft'));
  check('phone: no page errors', errs.length === 0, errs.join(' | '));
  if (process.env.SHOT_DIR) await page.locator('#sheet .pssec').nth(1).screenshot({ path: path.join(process.env.SHOT_DIR, 'livesheet-weapons-phone.png') });
  await ctx.close();
}

// ---------- 4. DM Console: the Campaign weapons editor ----------
{
  const page = await browser.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(`http://localhost:${PORT}/PACT/tools/DM-Console.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.campaignWeapons && window._dmRulesPanel, null, { timeout: 25000 });
  await page.waitForTimeout(500);
  await page.evaluate(C => window._dmRulesPanel.load({ customWeapons: C }), CUSTOM);
  const rows = await page.evaluate(() => [...document.querySelectorAll('#ruleCustomWeapons .cwrow [data-cwf="n"]')].map(i => i.value));
  check('DM: the campaign\'s weapons load as rows', rows.length === 2 && rows[1] === 'Harpoon Gun', JSON.stringify(rows));
  check('DM: a DM-typed name is escaped into the field, never run', rows[0] === CUSTOM[0].n && await page.evaluate(() => !window.__pwn && !document.querySelector('#ruleCustomWeapons img')));
  check('DM: rows start locked with the rest of Campaign Rules', await page.evaluate(() => [...document.querySelectorAll('#ruleCustomWeapons input,#ruleCustomWeapons select,#ruleCustomWeapons button')].every(e => e.disabled)));
  await page.evaluate(() => document.getElementById('ruleLockBtn').click());
  check('DM: unlocking enables them', await page.evaluate(() => !document.querySelector('#ruleCustomWeapons [data-cwf="n"]').disabled && !document.getElementById('ruleAddCustomWeapon').disabled));
  let saved = await page.evaluate(() => window._dmRulesPanel.collectCustomWeapons());
  check('DM: Save rules stores the cleaned list (markup stripped, props as a list, ranges as feet)', saved.length === 2 && !/[<>"]/.test(saved[0].n) &&
    JSON.stringify(saved[1]) === JSON.stringify({ n: 'Harpoon Gun', dice: '1d10', type: 'Piercing', cat: 'martial', kind: 'ranged', props: ['Loading', 'Two-Handed'], rn: 60, rl: 180, reach: null }), JSON.stringify(saved));
  await page.evaluate(() => document.getElementById('ruleAddCustomWeapon').click());
  await page.evaluate(() => { const r = [...document.querySelectorAll('#ruleCustomWeapons .cwrow')].pop();
    const set = (f, v) => { const el = r.querySelector('[data-cwf="' + f + '"]'); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('n', 'Chakram'); set('dice', '1d6'); set('props', 'Thrown, Light'); set('rn', '30'); set('rl', '90'); });
  saved = await page.evaluate(() => window._dmRulesPanel.collectCustomWeapons());
  check('DM: "+ Add weapon" adds a row that saves', saved.length === 3 && saved[2].n === 'Chakram' && saved[2].rn === 30 && saved[2].rl === 90 && saved[2].reach === 5, JSON.stringify(saved[2]));
  check('DM: the count line follows', /3 campaign weapons/.test(await page.textContent('#ruleCustomWeaponsCount')));
  await page.evaluate(() => { const r = [...document.querySelectorAll('#ruleCustomWeapons .cwrow')].pop(); r.querySelector('[data-cwf="n"]').value = 'longsword'; });
  check('DM: a custom weapon may not reuse a standard weapon\'s name', (await page.evaluate(() => window._dmRulesPanel.collectCustomWeapons())).length === 2);
  await page.evaluate(() => document.querySelector('#ruleCustomWeapons button[data-cwdel="0"]').click());
  saved = await page.evaluate(() => window._dmRulesPanel.collectCustomWeapons());
  check('DM: ✕ removes a weapon', saved.length === 1 && saved[0].n === 'Harpoon Gun', JSON.stringify(saved));
  await page.evaluate(() => window._dmRulesPanel.load({}));
  check('DM: a campaign with none shows the standard-list note and saves []', /standard Players Handbook/.test(await page.textContent('#ruleCustomWeapons')) &&
    JSON.stringify(await page.evaluate(() => window._dmRulesPanel.collectCustomWeapons())) === '[]');
  // The whole-blob Save rules must carry the key, or every save would silently wipe the DM's weapons.
  const src = fs.readFileSync(path.join(REPO, 'tools/DM-Console.html'), 'utf8');
  const saveBlock = src.slice(src.indexOf("getElementById('ruleSaveBtn').addEventListener"), src.indexOf('await B.setCampaignRules', src.indexOf("getElementById('ruleSaveBtn').addEventListener")));
  check('DM: the Save rules blob includes customWeapons', /customWeapons:\s*_collectCustomWeapons\(\)/.test(saveBlock));
  check('DM: no page errors', errs.length === 0, errs.join(' | '));
  await page.close();
}

await browser.close(); server.close();
console.log(`\n${fail ? '✗' : '✓'} ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
