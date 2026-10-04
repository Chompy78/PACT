/* PACT — wounds in the three tools: players can't pick the DM-only ones, a DM can impose all of them.
 *
 * feat/permanent-wounds (D-GH-2026-10-04-permanent-wounds). The four NEW wound entries (Maimed Hand, Bad Knee, Brittle
 * Bones, Withered Arm) exist only for a DM to impose. They are hidden from players by living in DATA.drawbacks but NOT in
 * DATA.drawbackList, and by one explicit filter in CharGen's grid. This proves, in a real browser, that:
 *
 *   1. CharGen's drawback grid does not offer them — but still shows one the character ALREADY holds (a DM imposed it),
 *      checked, so it can't vanish from view;
 *   2. the Live Sheet's drawback panel does not offer them;
 *   3. the DM Console's impose dropdown offers ALL of them, grouped as Wounds (minor / moderate) before the rest, and
 *      choosing a wound defaults the control to Locked + flat (choosing an ordinary drawback leaves it alone), and the
 *      Impose button then sends exactly that.
 *
 * No Supabase, no sign-in: characters are seeded into localStorage / applied as envelopes, and bridge calls are stubbed and
 * recorded. Every "not offered" check has a control that the panel really rendered (otherwise an empty result could just
 * mean the panel never drew).
 *
 *   node testing/scripts/wounds-ui-e2e.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = 7995;   // distinct from cloud-e2e 7970 / seed 7971 / dm-console-ui 7973 / chargen-flows 7979 / protected-roundtrip 7991 / live-sheet-unlock 7992 / dm-console-unlock 7994
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

const NEW = ['Maimed Hand', 'Bad Knee', 'Brittle Bones', 'Withered Arm'];
const browser = await launchChromium();

// ---- 1. CharGen ------------------------------------------------------------------------------------------------------
console.log('CharGen — the drawback grid');
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && typeof window.buildDrawGrid === 'function' && typeof window._cgApplyEnvelope === 'function', { timeout: 25000 });
  await page.evaluate(() => window.buildDrawGrid());
  const grid = await page.evaluate(() => (document.getElementById('drawgrid') || {}).textContent || '');
  check('CONTROL: the grid really rendered (an ordinary drawback and a Grievous one are listed)', /Lame/.test(grid) && /Missing Arm/.test(grid), `${grid.length} chars`);
  check('none of the four wound-only entries is offered', NEW.filter(n => grid.includes(n)).length === 0, NEW.filter(n => grid.includes(n)).join(', '));
  check('reused wounds stay takable (Peg Leg, Old Wound, Trembling Hands are listed)', ['Peg Leg', 'Old Wound', 'Trembling Hands'].every(n => grid.includes(n)));

  // A DM imposes Bad Knee; the character is opened in CharGen: it must stay visible and checked.
  const held = await page.evaluate(() => {
    const V = window.DATA.version;
    const ev = (o, i) => Object.assign({ seq: i + 1, ts: 1000 + i, rules: V }, o);
    const LOG = [
      ev({ type: 'buy', cat: 'oclass', payload: { v: 'Fighter' }, cost: 0, level: 1, label: 'Fighter' }, 0),
      ev({ type: 'award', amount: 79, cost: 0, label: 'budget', noLock: true }, 1),
      ev({ type: 'buy', cat: 'drawback', payload: { v: 'Bad Knee' }, cost: 0, level: 1, dmEdit: true, dmId: 'dm', dmLocked: true, dmRemovalCost: 'flat', label: 'Wound — Bad Knee (DM imposed)' }, 2),
    ];
    window._cgApplyEnvelope({ schema: 'pact-character/1', rules: V, name: 'Wounded', LOG, SEQ: LOG.length + 1, id: '11111111-2222-3333-4444-555555555555' }, { clearHistory: true });
    window.buildDrawGrid();
    const box = document.querySelector('#drawgrid input.drawck[value="Bad Knee"]');
    return { listed: !!box, checked: !!(box && box.checked), buildHolds: (typeof readBuild === 'function' ? readBuild().drawbacks : []).includes('Bad Knee') };
  });
  check('a character HOLDING an imposed wound still lists it in the grid', held.listed);
  check('...checked', held.checked);
  check('...and its build really holds it', held.buildHolds);
  const after = await page.evaluate(() => (document.getElementById('drawgrid') || {}).textContent || '');
  check('...but the OTHER wound-only entries remain hidden', ['Maimed Hand', 'Brittle Bones', 'Withered Arm'].every(n => !after.includes(n)));
  check('no page errors', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

// ---- 2. Live Sheet ---------------------------------------------------------------------------------------------------
console.log('Live Sheet — the drawback panel');
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  const LOG = [
    { type: 'award', amount: 79, seq: 1, label: 'Award' },
    { type: 'buy', cat: 'oclass', payload: { v: 'Fighter' }, cost: 0, level: 1, seq: 2, label: 'Fighter' },
  ];
  await page.addInitScript((env) => { try { localStorage.setItem('pactLiveSheet', JSON.stringify(env)); } catch (e) {} },
    { schema: 'pact-character/1', LOG, SEQ: LOG.length + 1 });
  await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window._engineFold && typeof window.takeDrawback === 'function'
    && document.body && document.body.textContent.length > 2000, { timeout: 25000 });
  // The buy panel draws each section LAZILY, only while it is open, so open the drawbacks section (and its category) the way a
  // player would — a first version of this check read the page without doing so, saw no drawbacks at all, and "passed" the
  // not-offered check vacuously; the control below is what caught it.
  await page.evaluate(() => { grpOpen['Drawbacks (gain AP)'] = 1; Object.keys(catOpen).forEach(k => { catOpen[k] = 1; }); refreshBuy(); });
  await page.waitForFunction(() => document.body.textContent.includes('Peg Leg'), { timeout: 10000 });
  const text = await page.evaluate(() => document.body.textContent);
  check('CONTROL: the drawback panel really rendered (ordinary drawbacks are offered)', ['Lame', 'Peg Leg', 'Missing Arm'].every(n => text.includes(n)));
  check('none of the four wound-only entries is offered', NEW.filter(n => text.includes(n)).length === 0, NEW.filter(n => text.includes(n)).join(', '));
  check('no page errors', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

// ---- 3. DM Console ---------------------------------------------------------------------------------------------------
console.log('DM Console — the impose dropdown');
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(`http://localhost:${PORT}/PACT/tools/DM-Console.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window._campBridge && typeof window._dmRenderCloudRoster === 'function', { timeout: 20000 });
  await page.evaluate(() => {
    window.__calls = []; window.__alerts = [];
    window._campBridge.listCampaignInvites = () => Promise.resolve([]);
    window._campBridge.dmEditCharacterLog = (id, events) => { window.__calls.push({ id, events }); return Promise.resolve(events); };
    window._dmReloadRoster = () => {};
    window.alert = (m) => { window.__alerts.push(String(m)); };
  });
  const LOG = [
    { type: 'award', amount: 79, seq: 1, label: 'Award' },
    { type: 'buy', cat: 'oclass', payload: { v: 'Fighter' }, cost: 0, level: 1, seq: 2, label: 'Fighter' },
  ];
  await page.evaluate((log) => { window._dmRenderCloudRoster(document.getElementById('campRoster'),
    [{ id: 'c1', name: 'Wound probe', ap: 0, player: 'Player', playerLabel: '', dmNotes: '', stats: { LOG: log } }]); }, LOG);

  const info = await page.evaluate(() => {
    const sel = document.querySelector('#campRoster .dm-impose-draw-sel');
    if (!sel) return null;
    const groups = [...sel.querySelectorAll('optgroup')].map(g => ({ label: g.label, names: [...g.querySelectorAll('option')].map(o => o.value) }));
    return { groups, all: [...sel.options].map(o => o.value).filter(Boolean), total: Object.keys(window.DATA.drawbacks).length };
  });
  check('the impose dropdown renders', !!info);
  check('three groups, wounds first: minor, moderate, then the rest',
    info && JSON.stringify(info.groups.map(g => g.label)) === JSON.stringify(['Wounds — minor', 'Wounds — moderate', 'Other drawbacks']), info && JSON.stringify(info.groups.map(g => g.label)));
  check('ALL four wound-only entries are offered to the DM', info && NEW.every(n => info.all.includes(n)));
  check('they sit in the wound groups, not "Other drawbacks"', info && NEW.every(n => !info.groups[2].names.includes(n)));
  check('every drawback is reachable exactly once (nothing lost, nothing doubled)',
    info && info.all.length === info.total && new Set(info.all).size === info.total, info && `${info.all.length} options / ${info.total} drawbacks`);
  check('the Grievous drawbacks stay in "Other drawbacks" (Missing Arm, Glass Frame, Slow to Mend, Mute)',
    info && ['Missing Arm', 'Glass Frame', 'Slow to Mend', 'Mute'].every(n => info.groups[2].names.includes(n)));
  check('moderate wounds are listed under moderate (Withered Arm, Peg Leg), minor under minor (Bad Knee)',
    info && info.groups[1].names.includes('Withered Arm') && info.groups[1].names.includes('Peg Leg') && info.groups[0].names.includes('Bad Knee'));

  // Defaults: a wound defaults to Locked + flat; an ordinary drawback leaves the DM's settings alone.
  const pick = (name) => page.evaluate((n) => {
    const sel = document.querySelector('#campRoster .dm-impose-draw-sel');
    sel.value = n; sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { locked: document.querySelector('#campRoster .dm-impose-draw-locked').checked, rate: document.querySelector('#campRoster .dm-impose-draw-rate').value };
  }, name);
  await page.evaluate(() => { document.querySelector('#campRoster .dm-impose-draw-locked').checked = false; document.querySelector('#campRoster .dm-impose-draw-rate').value = 'expensive'; });
  const ord = await pick('Mana Leak');
  check('choosing an ORDINARY drawback leaves the DM\'s Locked/rate settings untouched', ord.locked === false && ord.rate === 'expensive', JSON.stringify(ord));
  const wnd = await pick('Withered Arm');
  check('choosing a WOUND defaults the control to Locked', wnd.locked === true, JSON.stringify(wnd));
  check('...and to the flat removal price', wnd.rate === 'flat', JSON.stringify(wnd));
  // Moving between two wounds to compare them must not undo what the DM has since changed.
  await page.evaluate(() => { document.querySelector('#campRoster .dm-impose-draw-locked').checked = false; document.querySelector('#campRoster .dm-impose-draw-rate').value = 'expensive'; });
  const wnd2 = await pick('Bad Knee');
  check('switching from one wound to another leaves the DM\'s Locked/rate settings untouched', wnd2.locked === false && wnd2.rate === 'expensive', JSON.stringify(wnd2));
  await page.evaluate(() => { document.querySelector('#campRoster .dm-impose-draw-locked').checked = true; document.querySelector('#campRoster .dm-impose-draw-rate').value = 'flat'; });
  await pick('Withered Arm');

  // What the Impose button then sends.
  await page.evaluate(() => document.querySelector('#campRoster .dm-impose-draw-btn').click());
  await page.waitForFunction(() => window.__calls.length === 1, { timeout: 5000 });
  const sent = await page.evaluate(() => window.__calls[0]);
  const ev = sent && sent.events && sent.events[0];
  check('Impose sends one drawback purchase for that wound, at cost 0 (the player is paid nothing)',
    ev && ev.type === 'buy' && ev.cat === 'drawback' && ev.payload && ev.payload.v === 'Withered Arm' && ev.cost === 0, JSON.stringify(ev));
  check('...Locked and flat, as defaulted', ev && ev.dmLocked === true && ev.dmRemovalCost === 'flat', JSON.stringify(ev));
  check('no page errors', errs.filter(e => !/Failed to load resource|net::|supabase|fetch|NetworkError|Load failed/i.test(e)).length === 0, errs.join(' | '));
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} passed / ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
