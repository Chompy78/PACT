/* PACT — DM AP discount in the real tools (feat/dm-ap-discount, D-GH-2026-10-13-dm-ap-discount).
 *
 * WHAT IT PROVES, in a real browser against the real tool files:
 *   DM Console — the "discount a purchase" control lists exactly the priced purchases the engine would honour a
 *     discount against (not drawbacks, not free buys), with what each already has off; the button sends ONE
 *     dmDiscount event keyed by seq + category with a whole-AP amount (a % is converted against the full price,
 *     and capped at what is left); an empty note or amount is refused before anything is sent; a server without
 *     the migration gets a plain-language message; the archived-campaign peek blocks it; and the campaign total
 *     of discounts appears above the cards. Player-written labels are escaped (no injected element survives).
 *   Live Sheet — a discounted purchase shows "DM discount −N AP (you paid …)"; the discount row is tagged as the
 *     one DM edit that DOES give AP back; AP left rises by the discount while the AP-value figure keeps the full
 *     price (owner decision B1).
 *   CharGen — readBuild() carries the discount from its LOG into compute(), so its spendable total agrees.
 *
 * The cloud is stubbed (no network): dm_edit_character_log is replaced by a recorder, as the unlock tests do.
 * Run:  node testing/scripts/dm-ap-discount-e2e.mjs     (expect 0 failed; exits non-zero otherwise)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = Number(process.env.PACT_E2E_PORT) || 7996;   // distinct from dm-console-unlock 7994 / live-sheet-unlock 7992
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

const award = { type: 'award', amount: 79, seq: 1, label: 'Award — Level 1 (79 AP)' };
const oclass = { type: 'buy', cat: 'oclass', payload: { v: 'Fighter' }, cost: 0, level: 1, seq: 2, label: 'Origin class — Fighter' };
const save = { type: 'buy', cat: 'save', payload: { v: 'CON' }, cost: 8, level: 1, seq: 3, label: 'Saving throw — CON' };
const skill = { type: 'buy', cat: 'skill', payload: { v: 'Perception' }, cost: 4, level: 1, seq: 4, label: 'Skill — <img src=x onerror=window.__xss=1>' };
const draw = { type: 'buy', cat: 'drawback', payload: { v: 'Lame' }, cost: -4, level: 1, seq: 5, label: 'Drawback — Lame' };
const disc = (seq, targetSeq, targetCat, amount, note) =>
  ({ type: 'dmDiscount', targetSeq, targetCat, amount, note, seq, dmEdit: true, dmId: 'dm', label: 'DM discount — ' + amount + ' AP off' });
const BASE = [award, oclass, save, skill, draw];

const browser = await launchChromium();

// ===================================================================================================== DM Console
{
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://localhost:${PORT}/PACT/tools/DM-Console.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window._campBridge && typeof window._dmRenderCloudRoster === 'function', { timeout: 20000 });
  await page.evaluate(() => {
    window.__calls = []; window.__alerts = []; window.__reloads = 0; window.__blocked = 0;
    window._campBridge.listCampaignInvites = () => Promise.resolve([]);
    window._campBridge.dmEditCharacterLog = (id, events) => { window.__calls.push({ id, events }); return Promise.resolve(events); };
    window._dmReloadRoster = () => { window.__reloads++; };
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.confirm = () => true;
  });
  const row = (id, log) => ({ id, name: 'Discount probe ' + id, ap: 0, player: 'Player', playerLabel: '', dmNotes: '', stats: { LOG: log } });
  const render = (rows) => page.evaluate((rs) => { window._dmRenderCloudRoster(document.getElementById('campRoster'), rs); }, rows);
  const offered = () => page.evaluate(() => {
    const sel = document.querySelector('#campRoster .dm-discount-sel');
    return sel ? [...sel.options].map(o => ({ seq: o.value, cat: o.getAttribute('data-cat'), cost: o.getAttribute('data-cost'), done: o.getAttribute('data-done') })) : null;
  });
  const setForm = (seq, amount, mode, note) => page.evaluate(([seq, amount, mode, note]) => {
    const q = (c) => document.querySelector('#campRoster .' + c);
    q('dm-discount-sel').value = String(seq); q('dm-discount-amt').value = amount; q('dm-discount-mode').value = mode; q('dm-discount-note').value = note;
  }, [seq, amount, mode, note]);
  const click = () => page.evaluate(() => { const b = document.querySelector('#campRoster .dm-discount-btn'); b.disabled = false; b.click(); });

  console.log('DM Console — what is offered');
  await render([row('c1', BASE.concat([disc(6, 4, 'skill', 1, 'earlier')]))]);
  const opts = await offered();
  check('the discount control renders', Array.isArray(opts));
  check('only the two priced purchases are offered (no free origin class, no drawback)',
    opts && opts.map(o => o.seq).join(',') === '3,4', JSON.stringify(opts));
  check('...each keyed by seq with its category and cost', opts && opts[0].cat === 'save' && opts[0].cost === '8' && opts[1].cat === 'skill');
  check('...and what the skill already has off (1 AP, from the engine)', opts && opts[1].done === '1');
  check('a player-written label is escaped — no injected element ran or exists',
    await page.evaluate(() => !window.__xss && !document.querySelector('#campRoster img[src="x"]')));
  check('the character shows its discount total and AP value / AP paid',
    await page.evaluate(() => /1 AP/.test(document.querySelector('#campRoster .dm-discount-total').textContent)));
  check('the campaign total appears above the cards',
    await page.evaluate(() => { const n = document.getElementById('campDiscountTotal'); return !!n && /1 AP/.test(n.textContent); }));

  console.log('DM Console — what the button sends');
  await setForm(3, '', 'ap', 'a teacher');
  await click();
  check('an empty amount is refused and nothing is sent', await page.evaluate(() => window.__calls.length === 0 && window.__alerts.length === 1));
  await setForm(3, '2', 'ap', '   ');
  await click();
  check('an empty note is refused and nothing is sent', await page.evaluate(() => window.__calls.length === 0 && window.__alerts.length === 2));
  await setForm(3, '2', 'ap', '  Taught by the guild  ');
  await click();
  await page.waitForFunction(() => window.__calls.length === 1, { timeout: 5000 });
  let sent = await page.evaluate(() => window.__calls[0]);
  const ev = sent && sent.events[0];
  check('one call, one event, for this character', sent && sent.id === 'c1' && sent.events.length === 1);
  check('...a dmDiscount keyed by seq 3 + category save, 2 AP, note trimmed',
    ev && ev.type === 'dmDiscount' && ev.targetSeq === 3 && ev.targetCat === 'save' && ev.amount === 2 && ev.note === 'Taught by the guild', JSON.stringify(ev));
  check('...carrying nothing that could fake another event (no cost/payload)', ev && !('cost' in ev) && !('payload' in ev));
  check('...and the roster reloads', await page.evaluate(async () => { await Promise.resolve(); return window.__reloads === 1; }));

  await render([row('c1', BASE.concat([disc(6, 4, 'skill', 1, 'earlier')]))]);
  await setForm(3, '25', 'pct', 'quarter off');
  await click();
  await page.waitForFunction(() => window.__calls.length === 2, { timeout: 5000 });
  sent = await page.evaluate(() => window.__calls[1]);
  check('25% of an 8 AP purchase sends 2 AP', sent && sent.events[0].amount === 2, JSON.stringify(sent && sent.events[0]));
  await render([row('c1', BASE.concat([disc(6, 4, 'skill', 1, 'earlier')]))]);
  await setForm(4, '10', 'ap', 'more than it cost');
  await click();
  await page.waitForFunction(() => window.__calls.length === 3, { timeout: 5000 });
  sent = await page.evaluate(() => window.__calls[2]);
  check('asking for more than is left is capped (4 AP skill, 1 already off → 3)', sent && sent.events[0].amount === 3);
  await render([row('c1', BASE.concat([disc(6, 4, 'skill', 1, 'earlier')]))]);
  await setForm(4, '-5', 'ap', 'undo');
  await click();
  await page.waitForFunction(() => window.__calls.length === 4, { timeout: 5000 });
  sent = await page.evaluate(() => window.__calls[3]);
  check('a negative amount is a correction, limited to what is there (−1)', sent && sent.events[0].amount === -1);

  console.log('DM Console — refusals and the archived peek');
  await render([row('c1', BASE)]);
  const msg = await page.evaluate(async () => {
    window.__alerts.length = 0;
    window._campBridge.dmEditCharacterLog = () => Promise.reject(new Error('dm_edit_character_log: unsupported event type dmDiscount'));
    const q = (c) => document.querySelector('#campRoster .' + c);
    q('dm-discount-amt').value = '1'; q('dm-discount-note').value = 'fine';
    q('dm-discount-btn').click();
    for (let i = 0; i < 40 && !window.__alerts.length; i++) await new Promise(r => setTimeout(r, 25));
    return window.__alerts[0] || '';
  });
  check('a server without the migration says so in plain words', /has not been updated/i.test(msg) && !/dm_edit_character_log/.test(msg), msg.slice(0, 80));
  await page.evaluate(() => { window._campBridge.dmEditCharacterLog = (id, events) => { window.__calls.push({ id, events }); return Promise.resolve(events); }; });
  await render([row('c1', BASE)]);
  await page.evaluate(() => {
    window.__calls.length = 0; window.__blocked = 0;
    window._dmPeekActive = true; window._dmPeekBlocks = () => { window.__blocked++; };
    const q = (c) => document.querySelector('#campRoster .' + c);
    q('dm-discount-amt').value = '1'; q('dm-discount-note').value = 'fine';
    q('dm-discount-btn').click();
  });
  check('an archived-campaign peek sends NOTHING and goes through the shared guard',
    await page.evaluate(() => window.__calls.length === 0 && window.__blocked === 1));
  await page.evaluate(() => { window._dmPeekActive = false; });
  await render([row('c2', [award, oclass, draw])]);
  check('a character with nothing priced gets an explanation instead of a control',
    (await offered()) === null && await page.evaluate(() => /nothing to discount/.test(document.getElementById('campRoster').textContent)));
  check('no page errors in the DM Console', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ===================================================================================================== Live Sheet
async function openLive(LOG) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript((env) => { try { localStorage.setItem('pactLiveSheet', JSON.stringify(env)); } catch (e) {} },
    { schema: 'pact-character/1', LOG, SEQ: LOG.length + 1 });
  await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window._engineFold && document.getElementById('ledger')
    && document.getElementById('ledger').innerHTML.length > 50, { timeout: 25000 });
  return { page, errs, close: () => ctx.close() };
}
{
  console.log('Live Sheet — the discount is visible and moves AP left');
  const plain = await openLive(BASE);
  const leftPlain = await plain.page.evaluate(() => Number(document.getElementById('apFloatN').textContent));
  await plain.close();
  const { page, errs, close } = await openLive(BASE.concat([disc(6, 3, 'save', 3, 'Taught by <b>the guild</b>')]));
  const left = await page.evaluate(() => Number(document.getElementById('apFloatN').textContent));
  check('AP left rises by exactly the discount (3)', left === leftPlain + 3, `${leftPlain} -> ${left}`);
  const rows = await page.evaluate(() => [...document.querySelectorAll('#ledger tr')].map(tr => ({ html: tr.innerHTML, text: tr.textContent })));
  const saveRow = rows.find(r => /Saving throw — CON/.test(r.text));
  check('the discounted purchase says "DM discount −3 AP (you paid 5)"', !!saveRow && /DM discount −3 AP \(you paid 5\)/.test(saveRow.text));
  const dRow = rows.find(r => /DM discount — 3 AP off/.test(r.text));
  check('the discount has its own row showing +3', !!dRow && /\+3/.test(dRow.text));
  check("...tagged as the DM edit that gives AP back, with the DM's note escaped",
    !!dRow && /gave it back to you/.test(dRow.html) && /&lt;b&gt;the guild&lt;\/b&gt;/.test(dRow.html));
  check('...and NOT with the "never changed your spendable AP" promise', !!dRow && !/never changed your spendable AP/.test(dRow.html));
  check('the AP summary shows AP value, AP paid and the discount',
    await page.evaluate(() => /12 AP value · 9 paid · 3 DM discount/.test((document.getElementById('lms') || {}).textContent || '')));
  // The centre panel spells AP left out as a sum of its sources (#650); the discount is one of them, or the parts
  // would not add up to the figure. Checked arithmetically from the rendered terms, not just by text.
  const sum = await page.evaluate(() => {
    const t = (document.getElementById('eco') || {}).textContent || '';
    const m = t.match(/(-?\d+) AP left = (.*?) − (\d+) spent/);
    if (!m) return { t: t.slice(0, 200) };
    const parts = [...m[2].matchAll(/(-?\d+) (player|DM discount|DM|drawbacks)/g)].map(x => ({ n: Number(x[1]), lab: x[2] }));
    return { left: Number(m[1]), spent: Number(m[3]), parts, ign: /<s>/.test(document.getElementById('eco').innerHTML) };
  });
  check('the AP-left sum has a "DM discount" term of 3', !!sum.parts && sum.parts.some(p => p.lab === 'DM discount' && p.n === 3), JSON.stringify(sum));
  check('...and its parts add up to AP left', !!sum.parts && sum.parts.reduce((a, p) => a + p.n, 0) - sum.spent === sum.left, JSON.stringify(sum));
  check('no page errors in the Live Sheet', errs.length === 0, errs.join(' | '));
  await close();
}

// ===================================================================================================== CharGen
{
  console.log('CharGen — readBuild() carries the discount');
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && typeof window.compute === 'function' && typeof readBuild === 'function', { timeout: 25000 });
  const r = await page.evaluate(([base, d]) => {
    LOG = base.slice();
    const a = { b: readBuild().dmDiscount, s: compute(readBuild(), {}).spendable };
    LOG = base.concat([d]);
    const b2 = readBuild();
    return { before: a, after: { b: b2.dmDiscount, s: compute(b2, {}).spendable, ign: compute(b2, { ignorePlayerAp: true }).dmDiscountAp } };
  }, [BASE, disc(6, 3, 'save', 3, 'x')]);
  check('no discount → readBuild().dmDiscount is 0', r.before.b === 0, JSON.stringify(r));
  check('with a discount → readBuild().dmDiscount is 3', r.after.b === 3, JSON.stringify(r));
  check('...and spendable rises by 3', r.after.s === r.before.s + 3, JSON.stringify(r));
  check('...and still counts when the campaign ignores player AP', r.after.ign === 3, JSON.stringify(r));
  check('no page errors in CharGen', errs.length === 0, errs.join(' | '));
  await page.close();
}

await browser.close();
server.close();
console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} passed / ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
