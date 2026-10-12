/* PACT — Live Sheet: rename, description and notes that travel (fix/livesheet-name-description-notes, owner report 2026-10-12:
 * "I cannot change the name and see the description when I should be able to").
 *   1. Rename from the character card's ✎ (not the DM-tools strip): trimmed, survives reload; blank and "(DM copy)" refused.
 *   2. Every appearance field set in CharGen + a Backstory typed there show in the Live Sheet after Switch to Live Sheet.
 *   3. Existing device-local notes (both tools' buckets) are copied into the LOG once: both values kept, no duplication on
 *      reload, a cleared field stays cleared, the copy-in is not an undo step and leaves Redo alone.
 *   4. The DM read-only view never copies in or saves.
 *   5. CharGen regression (live data loss): a Setup-panel appearance edit and 🎲 Randomise keep the Live Sheet's sheet
 *      (playerSheet) and the Backstory instead of wiping them.
 *   6. CharGen Sheet: a Backstory typed with real keystrokes lands in the LOG in full on blur.
 *   7. A LOCKED character: appearance edits and the copy-in still land.
 *
 *   node testing/scripts/livesheet-name-notes-e2e.mjs            (expect 0 failed)
 *   PACT_REPO=<other checkout> node …                             runs the same cases against another checkout (old code)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = process.env.PACT_REPO || path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = 7992;
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
const LS_URL = `${base}/tools/PACT-Live-Char-Sheet.html`, CG_URL = `${base}/tools/PACT-CharGen-Webtool.html`;

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };
const section = t => console.log(`\n[name-notes] == ${t} ==`);
const safe = async (fn, dflt = null) => { try { return await fn(); } catch (e) { return dflt; } };

const IDENT = { type: 'buy', cat: 'patch', cost: 0, label: 'Identity',
  payload: { patch: { species: 'Human', originClass: 'Rogue', hd: 3, stats: { STR: 10, DEX: 14, CON: 12, INT: 10, WIS: 12, CHA: 10 } } } };
const mkLog = (extra = []) => [
  { seq: 1, type: 'award', amount: 200, label: 'Award' },
  { seq: 2, ...IDENT },
  { seq: 3, type: 'name', name: 'Tamsin' },
  { seq: 4, type: 'buy', cat: 'skill', cost: 1, payload: { v: 'Stealth' }, label: 'Skill: Stealth' },
  ...extra.map((e, i) => ({ seq: 5 + i, ...e })),
];

const browser = await launchChromium();
// A context whose Live Sheet autosave is seeded ONCE (a reload then reads what the page itself saved).
async function lsPage({ id, LOG, scratch = {} }) {
  const ctx = await browser.newContext();
  await ctx.addInitScript(({ env, scratch }) => {
    try {
      if (!sessionStorage.getItem('__seeded')) {
        sessionStorage.setItem('__seeded', '1');
        localStorage.setItem('pactLiveSheet', JSON.stringify(env));
        Object.keys(scratch).forEach(k => localStorage.setItem(k, JSON.stringify(scratch[k])));
      }
    } catch (e) {}
  }, { env: { schema: 'pact-character/1', name: 'Tamsin', id, LOG, SEQ: LOG.length + 1 }, scratch });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  const answers = []; const seen = [];
  page.on('dialog', d => { seen.push(d.type() + ':' + d.message()); if (d.type() === 'prompt') { const a = answers.shift(); a == null ? d.dismiss() : d.accept(a); } else d.accept(); });
  await page.goto(LS_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.compute && document.querySelector('#sheet .shname'), { timeout: 25000 });
  await page.waitForTimeout(400);
  return { ctx, page, errs, answers, seen };
}
const lsReady = p => p.waitForFunction(() => window.compute && document.querySelector('#sheet .shname'), { timeout: 25000 }).then(() => p.waitForTimeout(400));
const lsName = p => p.evaluate(() => foldBuild(null).name);
const lsAp = p => p.evaluate(() => foldBuild(null).appearance || {});

// -------------------------------------------------------------------------------------------------
section('1. rename from the character card');
{
  const { ctx, page, errs, answers, seen } = await lsPage({ id: 'id-rename', LOG: mkLog() });
  const btn = await page.$('#sheet .shname .shrename');
  check('the card name has a ✎ Rename button (not only the DM-tools strip)', !!btn);
  answers.push('  Tamsin Reed  ');
  if (btn) await btn.click(); else await safe(() => page.evaluate(() => lsRename()));
  await page.waitForTimeout(400);
  check('the new name is trimmed and in the LOG', await lsName(page) === 'Tamsin Reed', await lsName(page));
  check('the card shows it', /Tamsin Reed/.test(await page.textContent('#sheet .shname')));
  await page.reload({ waitUntil: 'load' }); await lsReady(page);
  check('…and survives a reload', await lsName(page) === 'Tamsin Reed', await lsName(page));
  const n0 = await page.evaluate(() => LOG.length);
  answers.push('   ');
  await safe(() => page.evaluate(() => lsRename())); await page.waitForTimeout(300);
  check('a blank name is refused (nothing written)', await lsName(page) === 'Tamsin Reed' && await page.evaluate(() => LOG.length) === n0);
  answers.push('Tamsin (DM copy)');
  await safe(() => page.evaluate(() => lsRename())); await page.waitForTimeout(300);
  check('a name ending " (DM copy)" is refused', await lsName(page) === 'Tamsin Reed', await lsName(page));
  check('the refusals were explained', seen.filter(s => s.startsWith('alert:')).length >= 2, seen.join(' | ').slice(0, 200));
  await safe(() => page.evaluate(() => toggleSheet()));
  check('the 📋 Sheet\'s Character Name has the same ✎', !!(await page.$('#sheetbody .shrename')));
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

// -------------------------------------------------------------------------------------------------
section('2. CharGen description + Backstory reach the Live Sheet (Switch to Live Sheet)');
const AP = { gender: 'Woman', age: '31', height: '5\'7"', build: 'Wiry', hair: 'Auburn', eyes: 'Grey', nose: 'Hooked', skin: 'Freckled',
  marks: 'Scar on chin', voice: 'Husky', demeanour: 'Wary', quirk: 'Hums', likes: 'Rain', dislikes: 'Bells', father: 'A miller',
  mother: 'A sailor', hometown: 'Saltmere', profession: 'Fence', familyfor: 'Debts', famevent: 'The flood', secret: 'A twin',
  drink: 'Cider', ambition: 'A ship', fear: 'Drowning', prized: 'A compass', faith: 'None', companion: 'A crow',
  custom1Label: 'Lucky number', custom1Text: 'Seven', overall: 'A wiry <b>auburn</b> woman.' };
const BACK = 'Raised on the docks; owes the Guild.\nSecond line.';
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  page.on('dialog', d => d.accept());
  await page.goto(CG_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.compute && typeof readBuild === 'function', { timeout: 25000 }); await page.waitForTimeout(1500);
  await page.evaluate(ap => {
    Object.keys(ap).forEach(k => { const e = document.getElementById('ap_' + k); if (!e) return; e.value = ap[k];
      e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); });
  }, AP);
  await page.waitForTimeout(300);
  await page.evaluate(() => toggleSheet());
  await page.click('#sheetbody [data-mf="notes"]');
  await page.fill('#sheetbody [data-mf="notes"]', BACK);
  await page.click('#sheetbody [data-mf="alignment"]');   // blur the Backstory → change
  await page.keyboard.type('CN');
  await page.click('#sheetbody [data-mf="playerName"]');
  await page.waitForTimeout(300);
  await page.evaluate(() => switchToLiveSheet());
  await page.waitForURL(/Live-Char-Sheet/, { timeout: 15000 });
  await lsReady(page); await page.waitForTimeout(600);
  const desc = await safe(() => page.textContent('#sheet .lsdesc'), '');
  const missing = Object.keys(AP).filter(k => k !== 'custom1Label' && k !== 'overall').filter(k => !desc.includes(AP[k]));
  check('the Live Sheet Character panel has an Appearance & description block', !!desc);
  check('…showing every appearance field set in CharGen (' + (Object.keys(AP).length - 2) + ' + custom + overall)', missing.length === 0 && desc.includes('Lucky number') && desc.includes('A wiry <b>auburn</b> woman.'), 'missing: ' + missing.join(','));
  check('…escaped (the <b> in the description is text, not markup)', !(await safe(() => page.$('#sheet .lsdesc b:text("auburn")'))));
  check('…including the Backstory and Alignment typed on the CharGen Sheet', desc.includes('owes the Guild') && desc.includes('CN'), desc.slice(-160));
  await page.evaluate(() => toggleSheet());
  check('the Live Sheet Sheet\'s Backstory shows the text', await safe(() => page.inputValue('#sheetbody [data-mf="notes"]'), '') === BACK);
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

// -------------------------------------------------------------------------------------------------
section('3. one-time copy-in of device-local notes');
{
  const id = 'id-copy';
  const scratch = {
    'pactCharSheetManual:livesheet': { [id]: { notes: 'LS story', alignment: 'NG', playerName: 'Sam', spelllist: 'Shield' } },
    'pactCharSheetManual:chargen': { [id]: { notes: 'CG story', alignment: 'LG', allies: 'Thieves Guild' } },
  };
  const { ctx, page, errs } = await lsPage({ id, LOG: mkLog(), scratch });
  await page.waitForTimeout(400);
  const ap = await lsAp(page);
  check('Backstory: both devices\' values kept, this tool\'s first', ap.backstory === 'LS story\n\n— also saved in the Character Creator on this device —\nCG story', JSON.stringify(ap.backstory));
  check('Alignment: both kept as "NG / LG"', ap.alignment === 'NG / LG', ap.alignment);
  check('Player name and Allies copied from whichever bucket had them', ap.playerName === 'Sam' && ap.allies === 'Thieves Guild');
  check('the spell tracker stays device-local (not copied)', !('spelllist' in ap));
  check('the copy-in sits at LOG index 0, the last purchase is still last', await page.evaluate(() => !!(LOG[0].payload && LOG[0].payload.patch && LOG[0].payload.patch.appearance) && LOG[LOG.length - 1].cat === 'skill'));
  check('the copy-in is not an undo step and leaves Redo empty', await page.evaluate(() => REDO.length === 0));
  check('local scratch is kept (not deleted)', await page.evaluate(() => !!JSON.parse(localStorage.getItem('pactCharSheetManual:chargen'))['id-copy']));
  await page.reload({ waitUntil: 'load' }); await lsReady(page); await page.waitForTimeout(400);
  const ap2 = await lsAp(page);
  check('reload: no duplication / re-join', ap2.alignment === 'NG / LG' && ap2.backstory === ap.backstory && await page.evaluate(() => LOG.filter(e => e.payload && e.payload.patch && e.payload.patch.appearance).length === 1));
  await page.evaluate(() => toggleSheet());
  await page.fill('#sheetbody [data-mf="notes"]', '');
  await page.dispatchEvent('#sheetbody [data-mf="notes"]', 'change');
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: 'load' }); await lsReady(page); await page.waitForTimeout(400);
  check('a Backstory the player cleared stays cleared after reload (not re-copied)', (await lsAp(page)).backstory === '', JSON.stringify((await lsAp(page)).backstory));
  await page.evaluate(() => undo()); await page.waitForTimeout(200);
  check('Undo after the copy-in undoes the last purchase, not the notes', await page.evaluate(() => !(foldBuild(null).skills || []).includes('Stealth') && foldBuild(null).appearance.alignment === 'NG / LG'));
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

// -------------------------------------------------------------------------------------------------
section('4. the DM read-only view never copies in or saves');
{
  const { ctx, page, errs } = await lsPage({ id: 'id-own', LOG: mkLog() });
  const out = await page.evaluate(async () => {
    localStorage.setItem('pactCharSheetManual:livesheet', JSON.stringify({ 'id-dm': { notes: 'player-local' } }));
    const saved = localStorage.getItem('pactLiveSheet');
    // the same state the ?viewChar= path sets after peekCharacter() (that path needs a signed-in DM + Supabase)
    VIEW_ONLY = true; LOG = [{ seq: 1, type: 'award', amount: 10 }, { seq: 2, type: 'name', name: 'Theirs' }]; SEQ = 3; __charId = 'id-dm'; render();
    await new Promise(r => setTimeout(r, 300));
    return { n: LOG.length, ap: foldBuild(null).appearance, sameSave: localStorage.getItem('pactLiveSheet') === saved,
             btn: !!document.querySelector('#sheet .shrename') };
  });
  check('VIEW_ONLY: LOG unchanged, nothing copied in', out.n === 2 && !(out.ap && out.ap.backstory), JSON.stringify(out));
  check('VIEW_ONLY: nothing saved', out.sameSave);
  check('VIEW_ONLY: no ✎ Rename on the card', !out.btn);
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

// -------------------------------------------------------------------------------------------------
section('5. CharGen keeps the Live Sheet\'s sheet and the Backstory (Setup edit, Randomise)');
{
  const id = 'id-cgkeep';
  const LOG = mkLog([{ type: 'buy', cat: 'patch', cost: 0, label: 'Appearance', _slot: 'appearance',
    payload: { patch: { appearance: { hair: 'Black', backstory: 'Keep me', playerSheet: { coins: { gp: 12 }, weapons: [{ name: 'Dagger' }] } } } } }]);
  const { ctx, page, errs } = await lsPage({ id, LOG });
  await page.evaluate(() => switchToCharGen());
  await page.waitForURL(/CharGen/, { timeout: 15000 });
  await page.waitForFunction(() => window.compute && typeof readBuild === 'function' && (readBuild().name === 'Tamsin'), { timeout: 25000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { const e = document.getElementById('ap_hair'); e.value = 'Silver';
    e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(400);
  const a = await page.evaluate(() => readBuild().appearance || {});
  check('Setup-panel edit landed', a.hair === 'Silver', a.hair);
  check('…and the Live Sheet\'s weapons/coins survived it', !!(a.playerSheet && a.playerSheet.weapons && a.playerSheet.weapons[0] && a.playerSheet.weapons[0].name === 'Dagger' && a.playerSheet.coins.gp === 12), JSON.stringify(a.playerSheet));
  check('…and the Backstory survived it', a.backstory === 'Keep me', JSON.stringify(a.backstory));
  check('…still ONE appearance event (written in place)', await page.evaluate(() => LOG.filter(e => e.type === 'buy' && e.cat === 'patch' && e.payload.patch && 'appearance' in e.payload.patch).length === 1));
  await page.evaluate(() => randomizeRoll('', 0)); await page.waitForTimeout(800);
  const r = await page.evaluate(() => readBuild().appearance || {});
  check('🎲 Randomise keeps the Live Sheet\'s sheet and the Backstory', r.backstory === 'Keep me' && !!(r.playerSheet && r.playerSheet.weapons && r.playerSheet.weapons.length === 1), JSON.stringify({ b: r.backstory, ps: r.playerSheet }));
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

// -------------------------------------------------------------------------------------------------
section('6. CharGen Sheet: a Backstory typed key by key lands in full');
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  page.on('dialog', d => d.accept());
  await page.goto(CG_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.compute && typeof readBuild === 'function', { timeout: 25000 }); await page.waitForTimeout(1500);
  await page.evaluate(() => toggleSheet());
  const TXT = 'Thirty characters of backstory';
  await page.click('#sheetbody [data-mf="notes"]');
  await page.keyboard.type(TXT, { delay: 15 });
  await page.click('#sheetbody [data-mf="playerName"]');   // blur
  await page.waitForTimeout(300);
  check('the full typed text is in the LOG', await page.evaluate(() => (readBuild().appearance || {}).backstory) === TXT, await page.evaluate(() => JSON.stringify((readBuild().appearance || {}).backstory)));
  check('…and on screen', await page.inputValue('#sheetbody [data-mf="notes"]') === TXT);
  check('clicking from Backstory into Player Name keeps the focus there (the Sheet rebuild puts it back)', await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-mf') === 'playerName'));
  await page.click('#sheetbody [data-mf="allies"]');
  await page.keyboard.type('Unsaved guild', { delay: 10 });   // no blur: the tab is closed / hidden mid-typing
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  check('a field still being typed in is flushed to the LOG on pagehide', await page.evaluate(() => (readBuild().appearance || {}).allies) === 'Unsaved guild');
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

// -------------------------------------------------------------------------------------------------
section('7. a LOCKED character still takes appearance edits and the copy-in');
{
  const id = 'id-locked';
  const LOG = mkLog([{ type: 'creationLockConfig', payload: { threshold: 20 } }, { type: 'creationLocked' }, { type: 'buy', cat: 'skill', cost: 2, payload: { v: 'Arcana' }, label: 'Skill: Arcana' }]);
  const { ctx, page, errs } = await lsPage({ id, LOG, scratch: { 'pactCharSheetManual:livesheet': { [id]: { notes: 'Locked but mine' } } } });
  check('copy-in landed on a locked character', (await lsAp(page)).backstory === 'Locked but mine');
  await page.evaluate(() => _shCommitAppearanceField('hair', 'Copper')); await page.waitForTimeout(200);
  const ap = await lsAp(page);
  check('an appearance edit landed and kept the backstory', ap.hair === 'Copper' && ap.backstory === 'Locked but mine');
  check('the lock and the post-lock purchase are untouched and in order', await page.evaluate(() => { const t = LOG.map(e => e.type + ':' + (e.cat || '')); return t.indexOf('creationLocked:') < t.lastIndexOf('buy:skill') && LOG[LOG.length - 1].payload.v === 'Arcana'; }));
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

await browser.close(); server.close();
console.log(`\n${fail ? '✗' : '✓'} ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
