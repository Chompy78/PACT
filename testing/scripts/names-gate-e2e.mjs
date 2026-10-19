/* PACT — names before spending: a locked character cannot spend AP while a language or spell slot is unnamed.
 *
 * feat/names-before-spending (docs/plans/2026-10-15-names-before-spending.md; owner decisions C1 D1 E2 M1 I1 J1 Q1). The pure-Node
 * gate (names-slots-ci.mjs) pins the engine's namesGate(); this proves both tools USE it:
 *   Live Sheet — a paid purchase and a drawback buy-off are refused with the reason while a slot is blank; naming it lets the purchase
 *                through; a free purchase and a drawback are never refused; the campaign switch (rules.requireNames:false) turns it off;
 *                an unlocked draft is never refused; a DM award is unaffected.
 *   CharGen    — the same for the after-lock purchase path; "Finish creating" refuses while a slot is blank (and not when the switch is off).
 *   DM Console — the switch is on by default and Save rules writes it.
 *
 * No Supabase, no sign-in: characters are seeded into localStorage / loaded through CharGen's own envelope loader.
 *   node testing/scripts/names-gate-e2e.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = Number(process.env.PACT_E2E_PORT) || 7964;
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

const patch = (n, p) => ({ type: 'buy', cat: 'patch', payload: { patch: p }, cost: 0, level: 1, seq: n, label: 'Patch' });
const BASE = [
  { type: 'award', amount: 300, seq: 1, label: 'Award — budget (300 AP)' },
  { type: 'buy', cat: 'oclass', payload: { v: 'Fighter' }, cost: 0, level: 1, seq: 2, label: 'Origin class — Fighter' },
  patch(3, { hd: 3 }),
];
const LOCK = { type: 'creationLocked', rules: 'v0', seq: 4, ts: 4, label: 'Creation finished' };
const LOCKED = [...BASE, LOCK];            // one language slot, blank
const NAMED = [...LOCKED, { type: 'names', lang: ['Common'], cost: 0, seq: 5, ts: 5, label: 'Named' }];
const SWITCH_OFF = { type: 'rulesSnapshot', campRules: { requireNames: false }, seq: 6, ts: 6 };
const env = (LOG) => ({ schema: 'pact-character/1', rules: 'v0', name: 'Names Gate', LOG, SEQ: LOG.length + 10 });

const browser = await launchChromium();

async function openLive(LOG) {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  const dialogs = [];
  await page.exposeFunction('__dlg', (kind, msg) => dialogs.push({ kind, msg }));
  await page.addInitScript((e) => {
    try { localStorage.setItem('pactLiveSheet', JSON.stringify(e)); } catch (x) {}
    window.__confirmAnswer = false;
    window.confirm = (m) => { window.__dlg('confirm', String(m)); return window.__confirmAnswer; };
    window.alert = (m) => { window.__dlg('alert', String(m)); };
  }, env(LOG));
  await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.namesGate && typeof window.buy === 'function'
    && document.getElementById('buy') && document.getElementById('buy').innerHTML.length > 200, { timeout: 25000 });
  return { page, errs, dialogs };
}
const logLen = (page) => page.evaluate(() => LOG.length);

// ---------- Live Sheet ----------
{
  const { page, errs, dialogs } = await openLive(LOCKED);
  const price = await page.evaluate(() => window.priceOf('save', { v: 'WIS' }));
  check('precondition: a saving throw costs AP', price > 0, 'price ' + price);

  let n0 = await logLen(page);
  await page.evaluate(() => window.buy('save', { v: 'WIS' }, 'Saving throw — WIS'));
  check('live: locked + blank language: a paid purchase is refused', (await logLen(page)) === n0);
  check('live: the refusal names the slot and points at the dialog', dialogs.some(d => /Language 1 is still blank/.test(d.msg) && /Name spells & languages/.test(d.msg)), JSON.stringify(dialogs.map(d => d.msg.slice(0, 60))));

  const greyed = await page.evaluate(() => /Name your languages and spells first/.test(document.getElementById('buy').innerHTML));
  check('live: the buy panel greys paid buttons with the reason', greyed);

  n0 = await logLen(page);
  const free = await page.evaluate(() => window.priceOf('skill', { v: 'Athletics' }));
  await page.evaluate(() => window.buy('skill', { v: 'Athletics' }, 'Skill — Athletics'));
  check('live: a free (0 AP) purchase is not refused', free === 0 && (await logLen(page)) === n0 + 1, 'price ' + free);

  n0 = await logLen(page);
  const nd = dialogs.length;
  await page.evaluate(() => window.buy('drawback', { v: 'Geas of the Road' }, 'Drawback — Geas of the Road'));
  // (a drawback may still be refused for ITS OWN reasons after creation — the point is that the names gate is not one of them)
  check('live: a drawback (it gives AP) is not refused for names', !dialogs.slice(nd).some(d => /still blank/.test(d.msg)));

  n0 = await logLen(page);
  await page.evaluate(() => window.emit({ type: 'names', lang: ['Common'], cost: 0, label: 'Named' }));
  check('live: naming the slot works while the gate is blocking', (await logLen(page)) === n0 + 1);
  n0 = await logLen(page);
  await page.evaluate(() => window.buy('save', { v: 'WIS' }, 'Saving throw — WIS'));
  check('live: after naming, the same purchase goes through', (await logLen(page)) === n0 + 1);
  check('live: no page errors', errs.length === 0, errs.join(' | '));
}
{
  // the purchase that CREATES a blank slot is allowed; the next one waits
  const { page } = await openLive(NAMED);
  let n0 = await logLen(page);
  await page.evaluate(() => window.buy('language', { to: 2 }, 'Languages → 2'));
  check('live: buying a language slot is allowed (the slot itself)', (await logLen(page)) === n0 + 1);
  n0 = await logLen(page);
  await page.evaluate(() => window.buy('save', { v: 'WIS' }, 'Saving throw — WIS'));
  check('live: ...and the NEXT paid purchase waits for its name', (await logLen(page)) === n0);
}
{
  const { page } = await openLive([...LOCKED, SWITCH_OFF]);
  const n0 = await logLen(page);
  await page.evaluate(() => window.buy('save', { v: 'WIS' }, 'Saving throw — WIS'));
  check('live: rules.requireNames:false turns the gate off', (await logLen(page)) === n0 + 1);
}
{
  const { page } = await openLive(BASE);   // never locked
  const n0 = await logLen(page);
  await page.evaluate(() => window.buy('save', { v: 'WIS' }, 'Saving throw — WIS'));
  check('live: an unlocked draft is never refused', (await logLen(page)) === n0 + 1);
}
{
  const { page } = await openLive(LOCKED);
  const n0 = await logLen(page);
  await page.evaluate(() => window.award(5, 'DM award'));
  check('live: an AP award is unaffected', (await logLen(page)) === n0 + 1);
}

// ---------- CharGen ----------
async function openCG(LOG, rules) {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  const dialogs = [];
  await page.exposeFunction('__dlg', (kind, msg) => dialogs.push({ kind, msg }));
  await page.addInitScript(() => {
    window.__confirmAnswer = false;
    window.confirm = (m) => { window.__dlg('confirm', String(m)); return window.__confirmAnswer; };
    window.alert = (m) => { window.__dlg('alert', String(m)); };
  });
  await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.namesGate && typeof window._cgApplyEnvelope === 'function', { timeout: 25000 });
  await page.evaluate(([e, r]) => { if (r) window._cloudCampaign = { rules: r }; window._cgApplyEnvelope(e, {}); }, [env(LOG), rules || null]);
  return { page, errs, dialogs };
}
{
  const { page, errs, dialogs } = await openCG(LOCKED);
  const n0 = await page.evaluate(() => LOG.length);
  const ok = await page.evaluate(() => window._cgPostLockAppend([{ cat: 'save', payload: { v: 'WIS' }, label: 'Saving throw — WIS' }]));
  check('chargen: locked + blank language: an after-lock paid purchase is refused', ok === false && (await page.evaluate(() => LOG.length)) === n0);
  check('chargen: the refusal names the slot', dialogs.some(d => /Language 1 is still blank/.test(d.msg)), JSON.stringify(dialogs.map(d => d.msg.slice(0, 60))));
  check('chargen: no page errors', errs.length === 0, errs.join(' | '));
}
{
  const { page } = await openCG(NAMED);
  const n0 = await page.evaluate(() => LOG.length);
  const ok = await page.evaluate(() => window._cgPostLockAppend([{ cat: 'save', payload: { v: 'WIS' }, label: 'Saving throw — WIS' }]));
  check('chargen: after naming, the purchase goes through', ok === true && (await page.evaluate(() => LOG.length)) === n0 + 1);
}
{
  const { page } = await openCG(LOCKED, { requireNames: false });
  const ok = await page.evaluate(() => window._cgPostLockAppend([{ cat: 'save', payload: { v: 'WIS' }, label: 'Saving throw — WIS' }]));
  check('chargen: rules.requireNames:false turns the gate off', ok === true);
}
{
  // "Finish creating" asks for the names first
  const { page, dialogs } = await openCG(BASE);
  await page.evaluate(() => window.cgFinishCreating(true));
  const locked = await page.evaluate(() => LOG.some(e => e && e.type === 'creationLocked'));
  check('chargen: Finish creating refuses while a slot is blank', !locked && dialogs.some(d => /Language 1 is still blank/.test(d.msg)), JSON.stringify(dialogs.map(d => d.msg.slice(0, 60))));
}
{
  const { page } = await openCG([...BASE, { type: 'names', lang: ['Common'], cost: 0, seq: 5, ts: 5, label: 'Named' }]);
  await page.evaluate(() => { window.__confirmAnswer = true; window.cgFinishCreating(true); });
  check('chargen: Finish creating works once everything is named', await page.evaluate(() => LOG.some(e => e && e.type === 'creationLocked')));
}
{
  const { page } = await openCG(BASE, { requireNames: false });
  await page.evaluate(() => { window.__confirmAnswer = true; window.cgFinishCreating(true); });
  check('chargen: Finish creating works with the campaign switch off', await page.evaluate(() => LOG.some(e => e && e.type === 'creationLocked')));
}

// ---------- DM Console ----------
{
  const html = fs.readFileSync(path.join(REPO, 'tools/DM-Console.html'), 'utf8');
  check('dm: the switch exists, ticked when the rule is absent, and Save rules writes it',
    /id="ruleRequireNames"/.test(html) && /ruleRequireNames\.checked = r\.requireNames !== false/.test(html) && /requireNames: ruleRequireNames\.checked/.test(html));
}

await browser.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
