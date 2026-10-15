/* PACT — Live Sheet "Wearing" row: armour worn, shield in hand, and the AC following class features
 * (feat/livesheet-armour-ac, rules v0.377, owner request 2026-10-14).
 *   1. Live Sheet: a Barbarian with Unarmored Defense (DEX 14, CON 16) and shield training shows AC 17 (10 + 2 + 3, +2 shield);
 *      the sheet's own "Wearing" dropdown + Shield box change it — set the shield down (15), wear Chain Mail (16), pick
 *      Mage Armor (15), take everything off (17 again). Every choice is ONE cost-0 LOG event and survives a reload.
 *   2. A Monk with Unarmored Defense: 10 + DEX + WIS only with the shield set down.
 *   3. CharGen: the same character's AC equals the Live Sheet's; its "Shield in hand" box and Mage Armor option work; a
 *      character that never touched the shield keeps a byte-identical Armour patch (no new shieldWorn key).
 *   4. DM Console: the imported character's roster AC equals compute()'s.
 *
 *   node testing/scripts/livesheet-armour-ac-e2e.mjs            (expect 0 failed)
 *   PACT_REPO=<other checkout> node …                            runs the same cases against another checkout (old code)
 *   PACT_E2E_PORT=<port>                                         serve on another port (default 7996)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = process.env.PACT_REPO || path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = Number(process.env.PACT_E2E_PORT) || 7996;
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
const base = `http://localhost:${PORT}/PACT`;
const LS_URL = `${base}/tools/PACT-Live-Char-Sheet.html`, CG_URL = `${base}/tools/PACT-CharGen-Webtool.html`, DM_URL = `${base}/tools/DM-Console.html`;

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };
const section = t => console.log(`\n[armour-ac] == ${t} ==`);
const safe = async (fn, dflt = null) => { try { return await fn(); } catch (e) { return dflt; } };

const mkLog = (cls, feature, stats, armour, name = 'Brakka') => [
  { seq: 1, type: 'award', amount: 300, label: 'Award' },
  { seq: 2, type: 'buy', cat: 'patch', cost: 0, label: 'Identity', payload: { patch: { species: 'Human', originClass: cls, hd: 3, stats } } },
  { seq: 3, type: 'name', name },
  { seq: 4, type: 'buy', cat: 'patch', cost: 0, label: 'Armour', payload: { patch: { armour, wornArmour: '' } } },
  { seq: 5, type: 'buy', cat: 'feature', cost: 5, payload: { v: feature }, label: 'Class feature — ' + feature },
];
const BARB = mkLog('Barbarian', 'Barbarian: Unarmored Defense', { STR: 16, DEX: 14, CON: 16, INT: 8, WIS: 10, CHA: 8 },
  { light: true, medium: true, heavy: true, shield: true });
const MONK = mkLog('Monk', 'Monk: Unarmored Defense', { STR: 10, DEX: 16, CON: 10, INT: 8, WIS: 16, CHA: 8 },
  { light: false, medium: false, heavy: false, shield: true }, 'Monk');

const MONK_LOG = MONK;
const browser = await launchChromium();
async function lsPage(id, LOG) {
  const ctx = await browser.newContext();
  await ctx.addInitScript(env => {
    try { if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); localStorage.setItem('pactLiveSheet', JSON.stringify(env)); } } catch (e) {}
  }, { schema: 'pact-character/1', name: 'Brakka', id, LOG, SEQ: LOG.length + 1 });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  page.on('dialog', d => d.accept());
  await page.goto(LS_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.compute && document.querySelector('#sheet .shname'), { timeout: 25000 });
  await page.waitForTimeout(400);
  return { ctx, page, errs };
}
// The AC the sheet SHOWS (the AC KPI), and the AC compute() gives for the folded LOG — they must agree.
const lsAc = p => p.evaluate(() => {
  const kp = [...document.querySelectorAll('#sheet .kpis .kp')].find(k => (k.querySelector('span') || {}).textContent === 'AC');
  return { shown: kp ? +kp.querySelector('b').textContent : null, engine: compute(foldBuild(null)).ac, tip: kp ? kp.getAttribute('title') : '' };
});
const lsLast = p => p.evaluate(() => { const e = LOG[LOG.length - 1]; return { cat: e.cat, cost: e.cost, v: e.payload && e.payload.v, n: LOG.length }; });
const pick = (p, v) => p.evaluate(v => { const s = document.getElementById('lsWornArmour'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, v);
const shield = (p, on) => p.evaluate(on => { const c = document.getElementById('lsShieldWorn'); c.checked = on; c.dispatchEvent(new Event('change', { bubbles: true })); }, on);

// -------------------------------------------------------------------------------------------------
section('1. Live Sheet — Barbarian Unarmored Defense, the Wearing row');
let barbLogAfter = null;
{
  const { ctx, page, errs } = await lsPage('id-barb', BARB);
  const has = await page.evaluate(() => ({ sel: !!document.getElementById('lsWornArmour'), sh: !!document.getElementById('lsShieldWorn') }));
  check('the sheet has a "Wearing" armour dropdown and a Shield box', has.sel && has.sh, JSON.stringify(has));
  let a = await lsAc(page);
  check('no armour + shield in hand: AC 17 = 10 + Dex 2 + Con 3 + shield 2', a.shown === 17 && a.engine === 17, JSON.stringify(a));
  check('the AC tooltip names Unarmored Defense (from compute()\'s acInfo)', /Unarmored Defense \(Barbarian\)/.test(a.tip || ''), a.tip);
  if (has.sel && has.sh) {
    await shield(page, false); await page.waitForTimeout(200);
    a = await lsAc(page); let l = await lsLast(page);
    check('Shield set down: AC 15, one free shieldWorn event', a.shown === 15 && l.cat === 'shieldWorn' && l.cost === 0 && l.v === false, JSON.stringify([a, l]));
    await pick(page, 'Chain Mail'); await page.waitForTimeout(200);
    a = await lsAc(page); l = await lsLast(page);
    check('wearing Chain Mail: AC 16 (armour replaces Unarmored Defense)', a.shown === 16 && l.cat === 'wornArmour' && l.cost === 0 && l.v === 'Chain Mail', JSON.stringify([a, l]));
    await pick(page, 'Mage Armor'); await page.waitForTimeout(200);
    a = await lsAc(page);
    check('Mage Armor: AC 15 (13 + Dex 2 ties Unarmored Defense 15)', a.shown === 15 && a.engine === 15, JSON.stringify(a));
    await pick(page, ''); await shield(page, true); await page.waitForTimeout(200);
    a = await lsAc(page);
    check('nothing worn, shield back in hand: AC 17 again', a.shown === 17, JSON.stringify(a));
    const sum = await page.evaluate(() => { const ev = LOG.filter(e => e.cat === 'shieldWorn' || e.cat === 'wornArmour'); return { n: ev.length, cost: ev.reduce((s, e) => s + (e.cost || 0), 0), total: compute(foldBuild(null)).total }; });
    check('the five choices cost nothing (5 events, 0 AP)', sum.n === 5 && sum.cost === 0, JSON.stringify(sum));
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.compute && document.querySelector('#sheet .shname'), { timeout: 25000 }); await page.waitForTimeout(400);
    await shield(page, false); await page.waitForTimeout(200); await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.compute && document.querySelector('#sheet .shname'), { timeout: 25000 }); await page.waitForTimeout(400);
    a = await lsAc(page);
    const box = await page.evaluate(() => document.getElementById('lsShieldWorn').checked);
    check('after a reload the choice is kept (shield down, AC 15, box unticked)', a.shown === 15 && box === false, JSON.stringify([a, box]));
    barbLogAfter = await page.evaluate(() => JSON.parse(JSON.stringify(LOG)));
  }
  check('no page errors', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

section('2. Live Sheet — Monk Unarmored Defense needs the shield set down');
{
  const { ctx, page, errs } = await lsPage('id-monk', MONK);
  let a = await lsAc(page);
  check('Monk with a shield in hand: AC 15 (10 + Dex 3 + shield 2 — Unarmored Defense off)', a.shown === 15, JSON.stringify(a));
  const nudge = await page.evaluate(() => (document.getElementById('lsAcNudge') || {}).textContent || '');
  check('the Wearing row shows a nudge: setting the shield down would give AC 16', /Set the shield down: Monk Unarmored Defense would give AC 16 \(now 15\)/.test(nudge), nudge);
  if (await page.evaluate(() => !!document.getElementById('lsShieldWorn'))) {
    await shield(page, false); await page.waitForTimeout(200);
    a = await lsAc(page);
    check('shield set down: AC 16 = 10 + Dex 3 + Wis 3', a.shown === 16 && a.engine === 16, JSON.stringify(a));
    check('...and the nudge is gone', await page.evaluate(() => !document.getElementById('lsAcNudge')));
  } else check('shield set down: AC 16 = 10 + Dex 3 + Wis 3', false, 'no Shield box');
  check('no page errors', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

// -------------------------------------------------------------------------------------------------
section('3. CharGen agrees, and keeps older characters byte-identical');
async function cgPage(env) {
  const ctx = await browser.newContext();
  await ctx.addInitScript(env => { try { if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); localStorage.setItem('pactCharGenAutosaveV2', JSON.stringify(env)); } } catch (e) {} }, env);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  page.on('dialog', d => d.accept());
  await page.goto(CG_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.compute && typeof readBuild === 'function', { timeout: 25000 }); await page.waitForTimeout(1500);
  return { ctx, page, errs };
}
{
  const env = { schema: 'pact-character/1', name: 'Brakka', id: 'id-cg', LOG: BARB, SEQ: BARB.length + 1 };
  const { ctx, page, errs } = await cgPage(env);
  const r = await page.evaluate(() => ({ form: compute(readBuild()).ac, log: compute(foldBuild(LOG)).ac,
    armourPatches: LOG.filter(e => e.cat === 'patch' && e.payload && e.payload.patch && 'armour' in e.payload.patch).map(e => Object.keys(e.payload.patch).sort().join(',')),
    hasMA: !![...document.getElementById('wornArmour').options].find(o => o.value === 'Mage Armor'), box: !!document.getElementById('shieldWorn') }));
  check('CharGen AC = 17, same as the Live Sheet (form and LOG)', r.form === 17 && r.log === 17, JSON.stringify(r));
  check('an untouched character\'s Armour patch carries no new shieldWorn key', r.armourPatches.length > 0 && r.armourPatches.every(k => k === 'armour,wornArmour'), JSON.stringify(r.armourPatches));
  check('CharGen offers Mage Armor and a "Shield in hand" box', r.hasMA && r.box, JSON.stringify(r));
  if (r.box) {
    await page.evaluate(() => { const c = document.getElementById('shieldWorn'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForTimeout(400);
    const r2 = await page.evaluate(() => ({ form: compute(readBuild()).ac, log: compute(foldBuild(LOG)).ac, sw: foldBuild(LOG).shieldWorn }));
    check('unticking "Shield in hand" in CharGen: AC 15, recorded in the LOG', r2.form === 15 && r2.log === 15 && r2.sw === false, JSON.stringify(r2));
    await page.evaluate(() => { const s = document.getElementById('wornArmour'); s.value = 'Mage Armor'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForTimeout(400);
    const r3 = await page.evaluate(() => ({ form: compute(readBuild()).ac, w: foldBuild(LOG).wornArmour }));
    check('Mage Armor picked in CharGen: kept in the LOG, AC 15', r3.w === 'Mage Armor' && r3.form === 15, JSON.stringify(r3));
    // The "Shield in hand" box must not carry its touched state into the next character (New Character, or a load).
    const armourKeys = () => page.evaluate(() => ({ box: document.getElementById('shieldWorn').checked, sw: readBuild().shieldWorn,
      keys: LOG.filter(e => e.cat === 'patch' && e.payload && e.payload.patch && 'armour' in e.payload.patch).map(e => Object.keys(e.payload.patch).sort().join(',')) }));
    await page.evaluate(() => resetBuild()); await page.waitForTimeout(600);
    await page.evaluate(() => { const c = document.getElementById('a_shield'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForTimeout(400);
    const r4 = await armourKeys();
    check('New Character after touching the box: box ticked, shieldWorn unset, a new Armour patch has no shieldWorn key',
      r4.box === true && r4.sw === undefined && r4.keys.length > 0 && r4.keys.every(k => k === 'armour,wornArmour'), JSON.stringify(r4));
    await page.evaluate(() => { const c = document.getElementById('shieldWorn'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForTimeout(300);
    await page.evaluate(env => _cgApplyEnvelope(env, { clearHistory: true }), { schema: 'pact-character/1', name: 'Other', id: 'id-other', LOG: MONK_LOG, SEQ: 9 });
    await page.waitForTimeout(600);
    await page.evaluate(() => { const c = document.getElementById('a_light'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForTimeout(400);
    const r5 = await armourKeys();
    check('loading another character after touching the box: reset too (no shieldWorn key written)',
      r5.box === true && r5.sw === undefined && r5.keys.every(k => k === 'armour,wornArmour'), JSON.stringify(r5));
  }
  check('no page errors', errs.length === 0, errs.join(' | '));
  await ctx.close();
}
if (barbLogAfter) {   // the Live Sheet's own log (shield set down) opens in CharGen with the same AC and box state
  const { ctx, page, errs } = await cgPage({ schema: 'pact-character/1', name: 'Brakka', id: 'id-cg2', LOG: barbLogAfter, SEQ: 99 });
  const r = await page.evaluate(() => ({ form: compute(readBuild()).ac, box: document.getElementById('shieldWorn').checked }));
  check('the Live Sheet\'s log (shield down) opens in CharGen at AC 15 with the box unticked', r.form === 15 && r.box === false, JSON.stringify(r));
  check('no page errors', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

// -------------------------------------------------------------------------------------------------
section('4. DM Console roster AC = compute()');
{
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(DM_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window._campBridge && window.compute, { timeout: 20000 });
  const file = (n, o) => ({ name: n + '.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(o)) });
  await page.setInputFiles('#fileInput', [file('brakka', { schema: 'pact-character/1', rules: 'v0.377', name: 'Brakka', id: 'id-dm', SEQ: 9, LOG: BARB }),
    file('monk', { schema: 'pact-character/1', rules: 'v0.377', name: 'Monk', id: 'id-dm2', SEQ: 99, LOG: [...MONK, { seq: 6, type: 'buy', cat: 'shieldWorn', cost: 0, payload: { v: false } }] })]);
  await page.waitForTimeout(1200);
  const acs = await safe(() => page.evaluate(() => {
    const out = {};
    document.querySelectorAll('.ac2-in').forEach(i => { const cell = i.parentElement; const v = parseInt((cell.textContent || '').trim(), 10); out[i.getAttribute('data-ac2key')] = v; });
    return out;
  }), {});
  check('DM Console shows Brakka at AC 17 and the Monk (shield down) at AC 16', acs.Brakka === 17 && acs.Monk === 16, JSON.stringify(acs));
  check('no page errors', errs.length === 0, errs.join(' | '));
  await page.close();
}

await browser.close(); server.close();
console.log(`\n${fail ? '✗' : '✓'} ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
