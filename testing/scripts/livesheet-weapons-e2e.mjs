/* PACT — Live Sheet "Weapons & attacks" (feat/livesheet-weapons, owner request 2026-10-14).
 *   1. The panel is called "Weapons & attacks" and offers every standard Players Handbook simple + martial weapon
 *      (engine WEAPONS), plus the Unarmed Strike and a spell attack. Picking one fills damage dice/type, properties,
 *      range (normal/long) and reach, the attack ability and — where the build says — proficiency.
 *   2. A DM's campaign weapons (campaigns.rules.customWeapons, edited in DM Console's Campaign Rules) are offered to that
 *      campaign's characters only — escaped, never run — and a solo character sees the standard list only.
 *   3. Each weapon's stats sit on ONE line at desktop width (name · to hit · damage · properties/range); a phone may wrap.
 *   4. DM Console: the Weapons editor loads, escapes, cleans and saves rules.customWeapons (stable ids, capped) and
 *      rules.weaponList {list, strict}.
 *   Owner decisions 2026-10-15: AL2 — a linked weapon (ref) takes its stats from the current definition, so a DM's edit
 *   reaches every sheet; AM2 — those stats are read-only on the sheet (name, proficiency, magic and notes stay the
 *   player's); free-text and older entries stay editable; and the campaign weapon list with "only these" on and off.
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
  { id: 'sb1', n: 'Sun Blade ' + XSS, dice: '1d8', type: 'Radiant', cat: 'martial', kind: 'melee', props: ['Finesse', 'Versatile (1d10)'], reach: 5 },
  { id: 'hg1', n: 'Harpoon Gun', dice: '1d10', type: 'Piercing', cat: 'martial', kind: 'ranged', props: 'Ammunition (Harpoon, Bolt), Loading, Two-Handed', rn: 60, rl: 180 },
  { id: 'nl1', n: 'Net Launcher', dice: '1', type: 'Bludgeoning', cat: 'other', kind: 'ranged', props: 'Special', rn: 15, rl: 30 },
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

const setPs = (p, key, v) => p.evaluate(([key, v]) => { const el = document.querySelector('[data-ps="' + key + '"]');
  if (el.type === 'checkbox') el.checked = v; else el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, [key, v]);
const disabled = (p, key) => p.evaluate(key => document.querySelector('[data-ps="' + key + '"]').disabled, key);
const setRules = async (p, rules) => { await p.evaluate(R => { window._rulesStatus = R ? 'active' : 'none'; window._cloudCampaignRules = R; render(); }, rules); await p.waitForTimeout(150); };

// ---------- 1. standard weapons (solo character) ----------
const { ctx, page, errs } = await open({ width: 1400, height: 1000 });
// An older saved weapon (no ref) that kept its range in the notes, as the pre-#667 panel suggested.
await page.evaluate(() => _psCommit({ coins: {}, notes: [], weapons: [{ n: 'Old bow', ab: 'DEX', prof: true, bonus: '', dice: '1d6', type: 'Piercing', notes: 'Range 80/320, two-handed' }] }));
check('the panel is called "Weapons & attacks"', await page.evaluate(() => [...document.querySelectorAll('#sheet .pssec h4')].some(h => h.textContent.includes('Weapons & attacks'))));
check('an older weapon\'s notes show on its one line', (await topLine(page, 0)).includes('Range 80/320, two-handed'), await topLine(page, 0));
check('…and it stays free text: its stats are editable', !(await disabled(page, 'weapons.0.dice')) && !(await disabled(page, 'weapons.0.reach')));
const std = await page.evaluate(() => window.WEAPONS.map(w => w.n));
check('the engine lists all 38 PHB simple + martial weapons (+ Unarmed Strike)', std.length === 39 &&
  ['Club', 'Dagger', 'Sling', 'Light Crossbow', 'Glaive', 'Whip', 'Blowgun', 'Longbow', 'Musket', 'Pistol', 'Unarmed Strike'].every(n => std.includes(n)), String(std.length));
await addWeapon(page);   // #1
check('an unnamed new row has no ✎ (its fields are already open)', await page.evaluate(() => !document.querySelectorAll('.pswpn')[1].querySelector('.psedit') && !document.querySelectorAll('.pswpn .pswrow')[1].hidden));
const ids = await pickIds(page, 1);
check('every standard weapon can be picked, plus a spell attack', (await page.evaluate(() => window.WEAPONS.map(w => 'std:' + w.id))).every(id => ids.includes(id)) && ids.includes('atk:spell'), String(ids.length));
check('…grouped Simple melee / Simple ranged / Martial melee / Martial ranged',
  (await groupIds(page, 1, 'Simple melee')).length === 10 && (await groupIds(page, 1, 'Simple ranged')).length === 4 &&
  (await groupIds(page, 1, 'Martial melee')).length === 18 && (await groupIds(page, 1, 'Martial ranged')).length === 6);
check('a solo character is offered no campaign weapons', (await groupIds(page, 1, "This campaign's weapons")) === null);

await pick(page, 1, 'std:longbow');
let w = (await sheetWeapons(page))[1];
check('picking the Longbow fills dice, type, properties and range, and links it', w.n === 'Longbow' && w.ref === 'std:longbow' && w.dice === '1d8' && w.type === 'Piercing' &&
  w.rn === 150 && w.rl === 600 && w.reach === '' && /Heavy/.test(w.props) && /Two-Handed/.test(w.props), JSON.stringify(w));
check('…a ranged weapon attacks with DEX', w.ab === 'DEX');
check('…and a martial weapon is not proficient for a Simple-only build', w.prof === false);
const exp = await page.evaluate(() => { const b = foldBuild(null), r = compute(b); return weaponAttack(b, r, b.appearance.playerSheet.weapons[1]); });
let line = await topLine(page, 1);
check('the one line shows name, to-hit (engine weaponAttack), damage and range',
  line.startsWith('Longbow') && line.includes('To hit ' + (exp.toHit >= 0 ? '+' : '') + exp.toHit) && line.includes('1d8 + ' + exp.dmgBonus + ' piercing') && line.includes('Range 150/600 ft'), line);
// AM2: a standard weapon's stats are locked; name, proficiency, magic and notes are the player's.
const LOCKED = ['ab', 'dice', 'type', 'props', 'rn', 'rl', 'reach'], OWN = ['n', 'prof', 'bonus', 'notes'];
check('AM2: a standard weapon\'s stats are read-only (ability, dice, type, properties, range, reach)', (await Promise.all(LOCKED.map(f => disabled(page, 'weapons.1.' + f)))).every(Boolean));
check('AM2: …its name, proficiency, magic bonus and notes stay editable', (await Promise.all(OWN.map(f => disabled(page, 'weapons.1.' + f)))).every(d => !d));
await setPs(page, 'weapons.1.dice', '4d12');
await setPs(page, 'weapons.1.rn', '999');
w = (await sheetWeapons(page))[1];
check('AM2: …and a forced edit to a locked stat is ignored', w.dice === '1d8' && w.rn === 150, JSON.stringify(w));
await setPs(page, 'weapons.1.prof', true); await setPs(page, 'weapons.1.bonus', '1'); await setPs(page, 'weapons.1.notes', 'Grandad\'s');
w = (await sheetWeapons(page))[1];
check('AM2: …while the player\'s own fields save', w.prof === true && w.bonus === 1 && w.notes === 'Grandad\'s', JSON.stringify(w));

await addWeapon(page);   // #2
await pick(page, 2, 'std:dagger');
w = (await sheetWeapons(page))[2];
check('the Dagger: finesse ability, simple-proficient, reach 5 and thrown 20/60', w.ab === 'FIN' && w.prof === true && w.reach === 5 && w.rn === 20 && w.rl === 60, JSON.stringify(w));
check('…shown as "Reach 5 ft · Thrown 20/60 ft"', (await topLine(page, 2)).includes('Reach 5 ft · Thrown 20/60 ft'), await topLine(page, 2));
await addWeapon(page);   // #3
await pick(page, 3, 'std:glaive');
check('a Reach weapon is prefilled with 10 ft reach', (await sheetWeapons(page))[3].reach === 10);
await setPs(page, 'weapons.3.n', 'Grandad\'s polearm');
await pick(page, 3, 'std:halberd');
w = (await sheetWeapons(page))[3];
check('re-picking keeps a name the player typed, but takes the new stats', w.n === 'Grandad\'s polearm' && w.ref === 'std:halberd' && w.dice === '1d10' && w.type === 'Slashing');
await addWeapon(page);   // #4 free text
await setPs(page, 'weapons.4.n', 'Thrown chair');
await setPs(page, 'weapons.4.reach', '15');
await setPs(page, 'weapons.4.dice', '1d3');
w = (await sheetWeapons(page))[4];
check('a free-text entry (no weapon picked) is fully editable, range fields included', !w.ref && w.reach === 15 && w.dice === '1d3' && (await topLine(page, 4)).includes('Reach 15 ft'), JSON.stringify(w));
await addWeapon(page);   // #5 spell attack
await pick(page, 5, 'atk:spell');
const spellExp = await page.evaluate(() => { const b = foldBuild(null), r = compute(b); return weaponAttack(b, r, b.appearance.playerSheet.weapons[5]); });
w = (await sheetWeapons(page))[5];
check('a spell attack uses the spellcasting ability (locked), dice stay the player\'s', w.ab === 'SPELL' && w.n === 'Spell attack' && await disabled(page, 'weapons.5.ab') && !(await disabled(page, 'weapons.5.dice')) &&
  (await topLine(page, 5)).includes('To hit ' + (spellExp.toHit >= 0 ? '+' : '') + spellExp.toHit));

// ---------- 3. one line at desktop width ----------
const oneLine = p => p.evaluate(() => [...document.querySelectorAll('.pswpn .pswtop')].map(t => {
  const kids = [...t.children].filter(c => c.getBoundingClientRect().height > 0), tops = kids.map(c => c.getBoundingClientRect().top);
  return Math.max(...tops) - Math.min(...tops) < 8; }));
check('each weapon\'s stats sit on ONE line at desktop width', (await oneLine(page)).every(Boolean), JSON.stringify(await oneLine(page)));
check('…with the edit fields folded away once a weapon is picked', await page.evaluate(() => [1, 2, 3, 5].every(i => document.querySelectorAll('.pswpn .pswrow')[i].hidden)));
await page.evaluate(() => document.querySelectorAll('.pswpn')[1].querySelector('.psedit').click());
check('✎ opens a weapon\'s edit fields', await page.evaluate(() => !document.querySelectorAll('.pswpn .pswrow')[1].hidden));

// ---------- 2. a DM's campaign weapons ----------
await setRules(page, { customWeapons: CUSTOM });
const camp = await groupIds(page, 0, "This campaign's weapons");
check('a campaign character is offered the DM\'s weapons', camp && camp.length === 3 && camp[1] === 'Harpoon Gun', JSON.stringify(camp));
check('…with markup stripped from the DM-typed name', camp && !/[<>"]/.test(camp[0]) && camp[0].startsWith('Sun Blade'), camp && camp[0]);
await addWeapon(page);   // #6
await pick(page, 6, 'camp:sb1');
w = (await sheetWeapons(page))[6];
check('picking a campaign weapon copies its stats and links it by id', w.ref === 'camp:sb1' && w.dice === '1d8' && w.type === 'Radiant' && w.ab === 'FIN' && /Versatile/.test(w.props) && w.reach === 5, JSON.stringify(w));
check('AM2: a campaign weapon\'s stats are read-only too', (await Promise.all(LOCKED.map(f => disabled(page, 'weapons.6.' + f)))).every(Boolean));
await addWeapon(page);   // #7
await pick(page, 7, 'camp:hg1');
w = (await sheetWeapons(page))[7];
check('a ranged campaign weapon gets its range, no reach', w.rn === 60 && w.rl === 180 && w.reach === '' && w.ab === 'DEX', JSON.stringify(w));
check('…"Ammunition (Harpoon, Bolt)" stays one property', w.props === 'Ammunition (Harpoon, Bolt), Loading, Two-Handed', w.props);
await setPs(page, 'weapons.7.n', 'Old Faithful');
await addWeapon(page);   // #8
await setPs(page, 'weapons.8.prof', true);
await pick(page, 8, 'camp:nl1');
check('a campaign weapon with no simple/martial category is not proficient (not carried over)', (await sheetWeapons(page))[8].prof === false);
check('no DM-typed markup ran or was injected', await page.evaluate(() => !window.__pwn && !document.querySelector('#sheet img[src="x"]')));
check('no weapon value sits inside an onclick string', await page.evaluate(() => [...document.querySelectorAll('.pssec [onclick]')].every(e => !/Sun Blade|Harpoon|longbow|sb1|hg1/i.test(e.getAttribute('onclick')))));

// AL2: the DM edits and renames a campaign weapon — every sheet linked to it follows.
const EDITED = CUSTOM.map(c => c.id === 'sb1' ? Object.assign({}, c, { n: 'Dawn Blade', dice: '2d6', type: 'Fire', props: ['Heavy'] })
  : c.id === 'hg1' ? Object.assign({}, c, { rn: 90, rl: 270 }) : c);
await setRules(page, { customWeapons: EDITED });
w = (await sheetWeapons(page))[6];
check('AL2: a DM\'s edit reaches the sheet (dice, type, properties, ability)', w.dice === '2d6' && w.type === 'Fire' && w.props === 'Heavy' && w.ab === 'STR', JSON.stringify(w));
check('AL2: …a rename follows when the player kept the weapon\'s name', w.n === 'Dawn Blade' && (await topLine(page, 6)).startsWith('Dawn Blade'));
w = (await sheetWeapons(page))[7];
check('AL2: …a name the player chose is kept while the stats update', w.n === 'Old Faithful' && w.rn === 90 && w.rl === 270, JSON.stringify(w));

// The campaign weapon list (like the language list): "only these" off = everything; on = the ticked ones.
await setRules(page, { customWeapons: EDITED, weaponList: { list: ['dagger', 'longbow'], strict: false } });
check('list, "only these" OFF: every standard weapon is still offered', (await groupIds(page, 0, 'Martial melee')).length === 18);
check('…and nothing is flagged', await page.evaluate(() => !document.querySelector('.pswflag')));
await setRules(page, { customWeapons: EDITED, weaponList: { list: ['dagger', 'longbow'], strict: true } });
check('list, "only these" ON: only the ticked standard weapons are offered', JSON.stringify(await groupIds(page, 0, 'Simple melee')) === '["Dagger"]' &&
  JSON.stringify(await groupIds(page, 0, 'Martial ranged')) === '["Longbow"]' && (await groupIds(page, 0, 'Martial melee')) === null, JSON.stringify(await groupIds(page, 0, 'Simple melee')));
check('…plus the campaign\'s own weapons and the Unarmed Strike', (await groupIds(page, 0, "This campaign's weapons")).length === 3 && (await groupIds(page, 0, 'Other attacks')).includes('Unarmed Strike'));
check('…a weapon already on the sheet is kept, marked "not on this campaign\'s weapon list"', (await sheetWeapons(page))[3].ref === 'std:halberd' &&
  (await topLine(page, 3)).includes("not on this campaign's weapon list") && !(await topLine(page, 1)).includes('not on this'), await topLine(page, 3));
check('…and its picker still shows it', (await page.evaluate(() => document.querySelectorAll('.pswpick')[3].value)) === 'std:halberd');

// Blocking-bug regression (re-review of 447222a): DM Console saves "every box ticked" as [] — that must mean ALL weapons.
await setRules(page, { customWeapons: EDITED, weaponList: { list: [], strict: true } });
check('"only these" ON with every weapon ticked (saved as []): every standard weapon is offered', (await groupIds(page, 0, 'Martial melee')).length === 18 &&
  (await groupIds(page, 0, 'Simple melee')).length === 10 && !(await topLine(page, 3)).includes('not on'));
await setRules(page, { customWeapons: EDITED, weaponList: { list: [], none: true, strict: true } });
check('"only these" ON with nothing ticked: no standard weapon, only the campaign\'s own + Unarmed Strike + spell attack',
  (await groupIds(page, 0, 'Simple melee')) === null && (await groupIds(page, 0, 'Martial ranged')) === null &&
  (await groupIds(page, 0, "This campaign's weapons")).length === 3 && JSON.stringify(await groupIds(page, 0, 'Other attacks')) === '["Unarmed Strike","Spell attack"]');
// AO1: with "only these" ON a player can't type in a weapon of their own.
await setRules(page, { customWeapons: EDITED, weaponList: { list: ['dagger'], strict: true } });
check('AO1: typed-in weapons already on the sheet stay, flagged as off-list', (await sheetWeapons(page))[4].n === 'Thrown chair' &&
  (await topLine(page, 4)).includes("not on this campaign's weapon list") && (await topLine(page, 0)).includes("not on this campaign's weapon list"));
await addWeapon(page);   // #9
check('AO1: a new entry\'s name box is shut until a weapon is picked', await disabled(page, 'weapons.9.n'));
await setPs(page, 'weapons.9.n', 'Homemade spear');
check('AO1: …and a forced name is refused', (await sheetWeapons(page))[9].n === '' && /only allows weapons from its list/.test(await page.evaluate(() => (document.getElementById('flashmsg') || {}).textContent || '')));
await pick(page, 9, 'std:unarmed-strike');
w = (await sheetWeapons(page))[9];
check('AO1: the Unarmed Strike is still allowed', w.ref === 'std:unarmed-strike' && w.n === 'Unarmed Strike' && w.prof === true && !(await topLine(page, 9)).includes('not on'));
await setRules(page, { customWeapons: EDITED, weaponList: { list: ['dagger'], strict: false } });
check('AO1: with "only these" OFF, typed-in weapons are fine again (no flag, name editable)', !(await topLine(page, 4)).includes('not on') && !(await disabled(page, 'weapons.4.n')));
// Several renders before the queued save runs make ONE save (coalesced).
const saves = await page.evaluate(R => { let n = 0; const orig = window._psCommit; window._psCommit = function (p) { n++; return orig(p); };
  window._cloudCampaignRules = R; render(); render(); render();
  return new Promise(res => setTimeout(() => { window._psCommit = orig; res(n); }, 200)); },
  { customWeapons: EDITED.map(c => c.id === 'hg1' ? Object.assign({}, c, { rn: 100 }) : c), weaponList: { list: ['dagger'], strict: false } });
check('a DM edit seen over several renders is saved once', saves === 1 && (await sheetWeapons(page))[7].rn === 100, `saves=${saves}`);

await setRules(page, null);
check('leaving the campaign: the picker shows the standard list only…', (await groupIds(page, 0, "This campaign's weapons")) === null && (await groupIds(page, 0, 'Martial melee')).length === 18);
w = (await sheetWeapons(page))[6];
check('…a campaign weapon already on the sheet stays, with its last stats, flagged', w.dice === '2d6' && (await topLine(page, 6)).includes('not on the campaign weapon list'), await topLine(page, 6));
check('…and, with nothing left to update it, becomes editable', !(await disabled(page, 'weapons.6.dice')));
check('Live Sheet: no page errors', errs.length === 0, errs.join(' | '));
if (process.env.SHOT_DIR) await page.locator('#sheet .pssec').nth(1).screenshot({ path: path.join(process.env.SHOT_DIR, 'livesheet-weapons-desktop.png') });
await ctx.close();

// ---------- phone: may wrap, never scrolls sideways ----------
{
  const { ctx, page, errs } = await open({ width: 390, height: 844 });
  await addWeapon(page); await pick(page, 0, 'std:heavy-crossbow');
  check('phone: no sideways scroll with a weapon on the sheet', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  check('phone: the weapon line is still readable (range shown)', (await topLine(page, 0)).includes('Range 100/400 ft'));
  check('phone: no page errors', errs.length === 0, errs.join(' | '));
  if (process.env.SHOT_DIR) await page.locator('#sheet .pssec').nth(1).screenshot({ path: path.join(process.env.SHOT_DIR, 'livesheet-weapons-phone.png') });
  await ctx.close();
}

// ---------- 4. DM Console: the Weapons editor ----------
{
  const page = await browser.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(`http://localhost:${PORT}/PACT/tools/DM-Console.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.campaignWeapons && window._dmRulesPanel, null, { timeout: 25000 });
  await page.waitForTimeout(500);
  await page.evaluate(C => window._dmRulesPanel.load({ customWeapons: C, weaponList: { list: ['dagger', 'longbow'], strict: true } }), CUSTOM);
  const rows = await page.evaluate(() => [...document.querySelectorAll('#ruleCustomWeapons .cwrow')].map(r => [r.getAttribute('data-cwid'), r.querySelector('[data-cwf="n"]').value]));
  check('DM: the campaign\'s weapons load as rows, each with its id', rows.length === 3 && rows[1][0] === 'hg1' && rows[1][1] === 'Harpoon Gun', JSON.stringify(rows));
  check('DM: a DM-typed name is escaped into the field, never run', rows[0][1].startsWith('Sun Blade') && await page.evaluate(() => !window.__pwn && !document.querySelector('#ruleCustomWeapons img')));
  const ticked = () => page.evaluate(() => [...document.querySelectorAll('#ruleWeaponsStd input:checked')].map(c => c.value));
  check('DM: the weapon list loads its ticks and "only these"', JSON.stringify(await ticked()) === '["dagger","longbow"]' && await page.isChecked('#ruleWeaponsStrict'));
  check('DM: rows and ticks start locked with the rest of Campaign Rules', await page.evaluate(() => [...document.querySelectorAll('#ruleCustomWeapons input,#ruleCustomWeapons select,#ruleCustomWeapons button,#ruleWeaponsStd input')].every(e => e.disabled)));
  await page.evaluate(() => document.getElementById('ruleLockBtn').click());
  check('DM: unlocking enables them', await page.evaluate(() => !document.querySelector('#ruleCustomWeapons [data-cwf="n"]').disabled && !document.getElementById('ruleAddCustomWeapon').disabled && !document.querySelector('#ruleWeaponsStd input').disabled));
  let wl = await page.evaluate(() => window._dmRulesPanel.collectWeaponList());
  check('DM: Save rules stores the weapon list', JSON.stringify(wl.list) === '["dagger","longbow"]' && wl.strict === true, JSON.stringify(wl));
  await page.evaluate(() => document.getElementById('ruleWeaponsAll').click());
  await page.evaluate(() => { const c = document.getElementById('ruleWeaponsStrict'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); });
  wl = await page.evaluate(() => window._dmRulesPanel.collectWeaponList());
  check('DM: every weapon ticked saves the empty (= full) list', JSON.stringify(wl.list) === '[]' && wl.strict === false, JSON.stringify(wl));
  await page.evaluate(() => { const c = document.querySelector('#ruleWeaponsStd input[value="glaive"]'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); });
  check('DM: an unticked weapon with "only these" off warns that players still see it', await page.evaluate(() => getComputedStyle(document.getElementById('ruleWeaponsStrictHint')).display !== 'none'));
  let saved = await page.evaluate(() => window._dmRulesPanel.collectCustomWeapons());
  check('DM: Save rules stores the cleaned list, ids kept (markup stripped, bracketed commas kept, ranges in feet)', saved.length === 3 && saved[0].id === 'sb1' && !/[<>"]/.test(saved[0].n) &&
    JSON.stringify(saved[1]) === JSON.stringify({ id: 'hg1', n: 'Harpoon Gun', dice: '1d10', type: 'Piercing', cat: 'martial', kind: 'ranged', props: ['Ammunition (Harpoon, Bolt)', 'Loading', 'Two-Handed'], rn: 60, rl: 180, reach: null }), JSON.stringify(saved[1]));
  await page.evaluate(() => { const f = document.querySelector('#ruleCustomWeapons .cwrow[data-cwid="hg1"] [data-cwf="n"]'); f.value = 'Whaling Gun'; f.dispatchEvent(new Event('input', { bubbles: true })); });
  saved = await page.evaluate(() => window._dmRulesPanel.collectCustomWeapons());
  check('DM: renaming a weapon keeps its id (players\' sheets stay linked)', saved[1].id === 'hg1' && saved[1].n === 'Whaling Gun');
  await page.evaluate(() => document.getElementById('ruleAddCustomWeapon').click());
  await page.evaluate(() => { const r = [...document.querySelectorAll('#ruleCustomWeapons .cwrow')].pop();
    const set = (f, v) => { const el = r.querySelector('[data-cwf="' + f + '"]'); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('n', 'Chakram'); set('dice', '1d6'); set('props', 'Thrown, Light'); set('rn', '30'); set('rl', '90'); });
  saved = await page.evaluate(() => window._dmRulesPanel.collectCustomWeapons());
  check('DM: "+ Add weapon" adds a row with a new id that saves', saved.length === 4 && saved[3].n === 'Chakram' && /^w[a-z0-9]+$/.test(saved[3].id) && saved[3].rn === 30 && saved[3].reach === 5, JSON.stringify(saved[3]));
  check('DM: the count line follows', /4 own weapons/.test(await page.textContent('#ruleCustomWeaponsCount')));
  await page.evaluate(() => { const f = [...document.querySelectorAll('#ruleCustomWeapons .cwrow')].pop().querySelector('[data-cwf="n"]'); f.value = 'Longsword'; f.dispatchEvent(new Event('input', { bubbles: true })); });
  const note = await page.evaluate(() => { const n = [...document.querySelectorAll('#ruleCustomWeapons .cwrow')].pop().querySelector('.cwnote'); return getComputedStyle(n).display !== 'none' ? n.textContent : ''; });
  saved = await page.evaluate(() => window._dmRulesPanel.collectCustomWeapons());
  check('DM: a weapon named like a standard one is kept (its own id), with a visible note', saved.length === 4 && saved[3].n === 'Longsword' && /standard weapon/.test(note), note);
  await page.evaluate(() => document.querySelector('#ruleCustomWeapons button[data-cwdel="0"]').click());
  saved = await page.evaluate(() => window._dmRulesPanel.collectCustomWeapons());
  check('DM: ✕ removes a weapon', saved.length === 3 && saved[0].id === 'hg1', JSON.stringify(saved.map(x => x.id)));
  const MANY = Array.from({ length: 55 }, (_, i) => ({ id: 'm' + i, n: 'Blade ' + i, dice: '1d6' }));
  await page.evaluate(M => window._dmRulesPanel.load({ customWeapons: M }), MANY);
  check('DM: a campaign keeps at most 50 own weapons (rules are copied into every bound character)', (await page.evaluate(() => window._dmRulesPanel.collectCustomWeapons())).length === 50 &&
    await page.evaluate(() => document.querySelectorAll('#ruleCustomWeapons .cwrow').length) === 50 && /most a campaign can have is 50/.test(await page.textContent('#ruleCustomWeaponsCount')));
  await page.evaluate(() => { if (document.querySelector('#ruleCustomWeapons [data-cwf="n"]').disabled) document.getElementById('ruleLockBtn').click(); });
  check('DM: …and "+ Add weapon" is off at the cap', await page.evaluate(() => { const a = document.getElementById('ruleAddCustomWeapon'); a.click(); return document.querySelectorAll('#ruleCustomWeapons .cwrow').length === 50; }));
  await page.evaluate(() => window._dmRulesPanel.load({}));
  check('DM: a campaign with none shows the standard-list note, every weapon ticked, and saves []', /standard Players Handbook/.test(await page.textContent('#ruleCustomWeapons')) &&
    (await ticked()).length === 38 && JSON.stringify(await page.evaluate(() => window._dmRulesPanel.collectCustomWeapons())) === '[]' &&
    JSON.stringify((await page.evaluate(() => window._dmRulesPanel.collectWeaponList())).list) === '[]');
  // Blocking-bug regression: the panel shows exactly what players get, via the engine.
  const offered = wl => page.evaluate(wl => window.campaignWeapons({ weaponList: wl }).chosen.length, wl);
  await page.evaluate(() => window._dmRulesPanel.load({ weaponList: { list: [], strict: true } }));
  wl = await page.evaluate(() => window._dmRulesPanel.collectWeaponList());
  check('DM: all ticked + "only these": loads all ticked, saves [] — and players get every weapon', (await ticked()).length === 38 && JSON.stringify(wl.list) === '[]' && !wl.none && wl.strict && (await offered(wl)) === 38);
  await page.evaluate(() => window._dmRulesPanel.load({ weaponList: { list: ['dagger', 'whip'], strict: true } }));
  wl = await page.evaluate(() => window._dmRulesPanel.collectWeaponList());
  check('DM: some ticked + "only these": round-trips, players get those', JSON.stringify(await ticked()) === '["dagger","whip"]' && JSON.stringify(wl.list) === '["dagger","whip"]' && (await offered(wl)) === 2);
  await page.evaluate(() => window._dmRulesPanel.load({ weaponList: { list: [], none: true, strict: true } }));
  wl = await page.evaluate(() => window._dmRulesPanel.collectWeaponList());
  check('DM: none ticked + "only these": loads none ticked, saves none:true — players get no standard weapon', (await ticked()).length === 0 && wl.none === true && (await offered(wl)) === 0 &&
    await page.evaluate(() => getComputedStyle(document.getElementById('ruleWeaponsNoneHint')).display !== 'none'));
  await page.evaluate(() => { if (document.getElementById('ruleWeaponsAll').disabled) document.getElementById('ruleLockBtn').click(); document.getElementById('ruleWeaponsAll').click(); document.getElementById('ruleWeaponsNone').click(); });
  wl = await page.evaluate(() => window._dmRulesPanel.collectWeaponList());
  check('DM: "Untick all" saves none:true, never [] (which would mean all)', wl.none === true && JSON.stringify(wl.list) === '[]' && (await offered(wl)) === 0);
  await page.evaluate(() => window._dmRulesPanel.load({ customWeapons: [{ n: 'R&D gun' }, { n: 'R D gun' }] }));
  const dup = await page.evaluate(() => window._dmRulesPanel.collectCustomWeapons().map(w => w.id + '=' + w.n));
  check('DM: two older weapons whose names make the same id are both kept (numbered), "&" kept', JSON.stringify(dup) === '["n-r-d-gun=R&D gun","n-r-d-gun-2=R D gun"]', JSON.stringify(dup));
  // The whole-blob Save rules must carry both keys, or every save would silently wipe them.
  const src = fs.readFileSync(path.join(REPO, 'tools/DM-Console.html'), 'utf8');
  const st = src.indexOf("getElementById('ruleSaveBtn').addEventListener"), saveBlock = src.slice(st, src.indexOf('B.setCampaignRules', st));
  check('DM: the Save rules blob includes customWeapons and weaponList', /customWeapons:\s*_collectCustomWeapons\(\)/.test(saveBlock) && /weaponList:/.test(saveBlock));
  check('DM: no page errors', errs.length === 0, errs.join(' | '));
  await page.close();
}

await browser.close(); server.close();
console.log(`\n${fail ? '✗' : '✓'} ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
