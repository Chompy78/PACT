/* PACT — a DM sets ONE campaign character's house rules (feat/dm-house-rules-editor, D-GH-2026-10-12-dm-house-rules-editor).
 *
 * Since fix/player-free-ap (#638) a player cannot change a confirmed campaign character's houseRules (DM Calls and
 * custom/repriced boons and drawbacks — priced by compute()). This pins the DM half, in a real browser:
 *
 *   DM Console
 *   1. The "house rules for this character" block shows the character's CURRENT rules (the engine's fold of the LOG).
 *   2. Save calls / Add or reprice / Remove each send exactly ONE appended buy/patch event whose payload is ONLY
 *      patch.houseRules (the whole next object, everything else carried over), at cost 0.
 *   3. compute(foldBuild(LOG + that event)) reflects it: the DM call and a repriced boon's price; AP left does not move.
 *   4. It refuses (sending nothing): a character still in creation (or reopened), changing a drawback the character
 *      holds, a no-op, a bad AP, an existing rule outside the server's limits (named), and deleting a custom rule the
 *      character still holds. The archived-campaign peek blocks it. A server without the
 *      migration gets a plain-language message. Player/DM text renders escaped.
 *   CharGen
 *   5. The player opening that character (a confirmed campaign character) sees the DM's rules and still cannot change them.
 *
 * No Supabase stack: the bridge calls are stubbed and recorded (the server half is testing/sql/dm-house-rules-test.sql).
 *   node testing/scripts/dm-house-rules-e2e.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
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
// An ephemeral port, not a fixed one: parallel agent runs collided on hard-coded ports (see the audit follow-ups board item).
await new Promise(r => server.listen(0, r));
const PORT = server.address().port;

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

const browser = await launchChromium();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}/PACT/tools/DM-Console.html`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window._campBridge && typeof window._dmRenderCloudRoster === 'function' && !!window._engineFold, { timeout: 20000 });

await page.evaluate(() => {
  window.__calls = []; window.__alerts = []; window.__confirms = []; window.__reloads = 0; window.__blocked = 0;
  window._campBridge.listCampaignInvites = () => Promise.resolve([]);
  window._campBridge.dmEditCharacterLog = (id, events) => { window.__calls.push({ id, events: JSON.parse(JSON.stringify(events)) }); return Promise.resolve(events); };
  window._dmReloadRoster = () => { window.__reloads++; };
  window.alert = (m) => { window.__alerts.push(String(m)); };
  window.confirm = (m) => { window.__confirms.push(String(m)); return true; };
});

// Pick real rules data, so the test follows DATA rather than hard-coding prices.
const pick = await page.evaluate(() => {
  const boon = DATA.boonList.find(n => { const b = DATA.boons[n]; return b && (Number(b.hd) || 1) <= 1 && !b.noncore && !b.minStats && !b.minStatsAny && (+b.ap || 0) >= 3; });
  const draw = (DATA.drawbackList || Object.keys(DATA.drawbacks)).find(n => DATA.drawbacks[n] >= 2
    && !(DATA.drawbackReq && DATA.drawbackReq[n]) && !(DATA.wounds && DATA.wounds[n]) && !(DATA.drawbackMaxStats && DATA.drawbackMaxStats[n]));
  return { boon, boonAp: +DATA.boons[boon].ap, draw, drawAp: DATA.drawbacks[draw] };
});
check('(precondition) found a plain boon and drawback in DATA', !!pick.boon && !!pick.draw, JSON.stringify(pick));

const XSS = '<img src=x onerror="window.__xss=1">Evil';
const mkLog = (awardAmt) => [
  { seq: 1, ts: 1, type: 'award', amount: awardAmt, label: 'Award' },
  { seq: 2, ts: 2, type: 'buy', cat: 'oclass', payload: { v: 'Fighter' }, cost: 0, level: 1, label: 'Fighter' },
  { seq: 3, ts: 3, type: 'buy', cat: 'patch', _slot: 'houseRules', cost: 0, label: 'DM customisations', payload: { patch: { houseRules: {
      boons: { [XSS]: { hd: 1, ap: 5, fx: 'a custom boon nobody holds' } }, draws: {}, disabled: { boons: [], draws: [] },
      dmAllows: { bound: true, boons: true, drawbacks: true, tasha: true } } } } },
  { seq: 4, ts: 4, type: 'buy', cat: 'boon', payload: { v: pick.boon }, cost: pick.boonAp, level: 1, label: 'Boon — ' + pick.boon },
  { seq: 5, ts: 5, type: 'buy', cat: 'drawback', payload: { v: pick.draw }, cost: -pick.drawAp, level: 1, label: 'Drawback — ' + pick.draw },
  { seq: 6, ts: 6, type: 'creationLocked', label: 'Finished creating' },
];
const row = (id, log) => ({ id, name: 'House probe ' + id, ap: 0, player: 'Player', playerLabel: '', dmNotes: '', stats: { LOG: log, SEQ: 7 } });
const render = (rows) => page.evaluate((rs) => { window._dmRenderCloudRoster(document.getElementById('campRoster'), rs); }, rows);
// Engine view of a log — the SAME functions every tool folds and prices with.
const engine = (log) => page.evaluate((log) => {
  const F = window._engineFold, b = F.foldBuild(log), r = compute(b, {});
  return { hr: b.houseRules || {}, total: r.total, left: r.spendable - F.economy(log).spent, warnings: r.warnings || [] };
}, log);
const lastCall = () => page.evaluate(() => window.__calls[window.__calls.length - 1] || null);
const click = (sel) => page.evaluate((sel) => { const b = document.querySelector('#campRoster ' + sel); if (!b) return false; b.disabled = false; b.click(); return true; }, sel);
const settle = () => page.evaluate(async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); });
const reset = () => page.evaluate(() => { window.__calls.length = 0; window.__alerts.length = 0; window.__confirms.length = 0; });
const asStored = (ev, seq) => Object.assign({}, ev, { seq, ts: seq, dmEdit: true, dmId: 'dm' });   // what the server returns

const LOG = mkLog(79);
console.log('1. The block shows the character\'s current house rules');
await render([row('c1', LOG)]);
const shown = await page.evaluate(() => ({
  block: !!document.querySelector('#campRoster .dm-hr-btn[data-act="calls"]'),
  calls: [...document.querySelectorAll('#campRoster .dm-hr-call')].map(c => [c.getAttribute('data-key'), c.checked]),
  removeNames: [...document.querySelectorAll('#campRoster .dm-hr-btn[data-act="remove"]')].map(b => b.getAttribute('data-name')),
  imgs: document.querySelectorAll('#campRoster img').length, xss: !!window.__xss,
}));
check('the house-rules block renders on a campaign character\'s card', shown.block);
check('...with the four DM calls, all on (as the log says)', JSON.stringify(shown.calls) === JSON.stringify([['bound', true], ['boons', true], ['drawbacks', true], ['tasha', true]]), JSON.stringify(shown.calls));
check('...and lists the custom boon from the log', shown.removeNames.includes(XSS), JSON.stringify(shown.removeNames));
check('a custom name with markup renders as TEXT (esc), not an element', shown.imgs === 0 && !shown.xss);

console.log('2. Save calls — Boons off');
const base = await engine(LOG);
await reset();
await page.evaluate(() => { document.querySelector('#campRoster .dm-hr-call[data-key="boons"]').checked = false; });
await click('.dm-hr-btn[data-act="calls"]'); await settle();
let call = await lastCall();
check('exactly one RPC call, for this character, with one event', call && call.id === 'c1' && call.events.length === 1, JSON.stringify(call && call.events.length));
let ev = call && call.events[0];
check('...an appended buy/patch whose payload is ONLY patch.houseRules',
  ev && ev.type === 'buy' && ev.cat === 'patch' && JSON.stringify(Object.keys(ev.payload)) === '["patch"]' && JSON.stringify(Object.keys(ev.payload.patch)) === '["houseRules"]', JSON.stringify(ev));
check('...at cost 0, with no seq/ts/dmEdit of its own (the server stamps those)', ev && ev.cost === 0 && !('seq' in ev) && !('dmEdit' in ev));
check('...Boons off, the other three calls still on', ev && JSON.stringify(ev.payload.patch.houseRules.dmAllows) === JSON.stringify({ bound: true, boons: false, drawbacks: true, tasha: true }));
check('...and the custom boon carried over untouched', ev && ev.payload.patch.houseRules.boons[XSS] && ev.payload.patch.houseRules.boons[XSS].ap === 5);
check('the DM was asked to confirm, and the roster reloads after', await page.evaluate(() => window.__confirms.length === 1 && window.__reloads >= 1));
const LOG2 = LOG.concat([asStored(ev, 7)]);
const e2 = await engine(LOG2);
check('compute(foldBuild(LOG + event)) sees the DM call: dmAllows.boons === false', e2.hr.dmAllows && e2.hr.dmAllows.boons === false, JSON.stringify(e2.hr.dmAllows));
check('...and the player\'s own house-rules event (seq 3) is still there, unchanged', JSON.stringify(LOG2[2]) === JSON.stringify(LOG[2]));
check('...and a calls change moves no AP', e2.total === base.total && e2.left === base.left, `${base.total}/${base.left} -> ${e2.total}/${e2.left}`);

console.log('3. Add / reprice — the held boon, 2 AP cheaper');
await render([row('c1', LOG2)]);
await reset();
const setForm = (kind, name, hd, ap, fx) => page.evaluate(([kind, name, hd, ap, fx]) => {
  const q = c => document.querySelector('#campRoster .' + c);
  q('dm-hr-kind').value = kind; q('dm-hr-name').value = name; q('dm-hr-hd').value = hd; q('dm-hr-ap').value = ap; q('dm-hr-fx').value = fx;
}, [kind, name, hd, ap, fx]);
await setForm('boon', pick.boon, '', String(pick.boonAp - 2), '');
await click('.dm-hr-btn[data-act="add"]'); await settle();
call = await lastCall(); ev = call && call.events[0];
const rb = ev && ev.payload.patch.houseRules.boons[pick.boon];
check('one event, repricing the boon (HD from the built-in, AP lowered by 2)', rb && rb.ap === pick.boonAp - 2 && rb.hd === (await page.evaluate(b => Number(DATA.boons[b].hd) || 1, pick.boon)), JSON.stringify(rb));
check('...keeping the earlier Boons-off call', ev && ev.payload.patch.houseRules.dmAllows.boons === false);
const LOG3 = LOG2.concat([asStored(ev, 8)]);
const e3 = await engine(LOG3);
check('compute() prices the boon at the DM\'s figure: total is 2 AP lower', e3.total === e2.total - 2, `${e2.total} -> ${e3.total}`);
check('...but AP left is unchanged — what they paid stays paid, nothing is refunded', e3.left === e2.left, `${e2.left} -> ${e3.left}`);

console.log('4. Drawbacks — one the character HOLDS keeps its value; a new custom one is fine');
await render([row('c1', LOG3)]);
await reset();
await setForm('draw', pick.draw, '', String(pick.drawAp + 1), 'house version');
await click('.dm-hr-btn[data-act="add"]'); await settle();
check('repricing a drawback the character HOLDS is refused, nothing sent (the server ledger keeps its frozen value)',
  await page.evaluate(() => window.__calls.length === 0 && window.__alerts.some(m => /holds the drawback/.test(m))));
await reset();
await setForm('draw', 'Sworn Rival', '', '3', 'a house drawback');
await click('.dm-hr-btn[data-act="add"]'); await settle();
call = await lastCall(); ev = call && call.events[0];
check('a custom drawback nobody holds is sent', ev && ev.payload.patch.houseRules.draws['Sworn Rival'] && ev.payload.patch.houseRules.draws['Sworn Rival'].ap === 3);
const e4 = await engine(LOG3.concat([asStored(ev, 9)]));
check('...and moves no AP', e4.left === e3.left && e4.total === e3.total, `${e3.left} -> ${e4.left}`);

console.log('5. Refusals — nothing is sent');
// Review finding 1: a character still in creation. repriceDraft() would re-stamp the DM event's cost on the player's
// next save (award 79, Bulwark 6, DM reprices to 1 -> the event became -5), so the DM Console refuses.
const DRAFT = LOG.filter(e => e.type !== 'creationLocked');
check('(precondition) the engine calls the draft log a creation draft, the locked one not',
  await page.evaluate(([d, l]) => window.isCreationDraft(d) && !window.isCreationDraft(l), [DRAFT, LOG]));
await render([row('c4', DRAFT)]);
check('a character still in creation shows a "once they finish creating" note', await page.evaluate(() => !!document.querySelector('#campRoster .dm-hr-draft')));
await reset();
await setForm('boon', pick.boon, '', '1', '');
await click('.dm-hr-btn[data-act="add"]'); await settle();
check('...and a house-rules edit on it is refused, nothing sent', await page.evaluate(() => window.__calls.length === 0 && window.__alerts.some(m => /still in character creation/.test(m))));
const REOPENED = LOG.concat([{ seq: 7, ts: 7, type: 'creationUnlocked', label: 'DM reopened creation' }]);
await render([row('c5', REOPENED)]);
await reset();
await page.evaluate(() => { document.querySelector('#campRoster .dm-hr-call[data-key="bound"]').checked = false; });
await click('.dm-hr-btn[data-act="calls"]'); await settle();
check('a character whose creation the DM reopened is refused too', await page.evaluate(() => window.__calls.length === 0 && window.__alerts.some(m => /still in character creation/.test(m))));
// Review finding 4: an EXISTING rule outside the server's limits (CharGen accepts a negative/fractional AP) used to ride
// along on every save and come back as a raw database error. It is named, and removing it clears the way.
const BAD = LOG.map(e => e.seq === 3 ? JSON.parse(JSON.stringify(e)) : e);
BAD[2].payload.patch.houseRules.boons['Old Gift'] = { hd: 1, ap: -4, fx: '' };
await render([row('c6', BAD)]);
await reset();
await page.evaluate(() => { document.querySelector('#campRoster .dm-hr-call[data-key="tasha"]').checked = false; });
await click('.dm-hr-btn[data-act="calls"]'); await settle();
check('an existing out-of-limits rule is NAMED in a plain message, and nothing is sent', await page.evaluate(() => window.__calls.length === 0
  && window.__alerts.some(m => /Old Gift/.test(m) && /whole number from 0 to 1000/.test(m) && !/dm_edit_character_log/.test(m))));
await reset();
await page.evaluate(() => { const b = [...document.querySelectorAll('#campRoster .dm-hr-btn[data-act="remove"]')].find(x => x.getAttribute('data-name') === 'Old Gift'); b.click(); });
await settle();
call = await lastCall();
check('...removing that rule is allowed and sends the rules without it', call && call.events[0] && !('Old Gift' in call.events[0].payload.patch.houseRules.boons));
await render([row('c1', LOG)]);
await reset();
await click('.dm-hr-btn[data-act="calls"]'); await settle();
check('saving the calls unchanged sends nothing ("Nothing to change")', await page.evaluate(() => window.__calls.length === 0 && window.__alerts.some(m => /Nothing to change/.test(m))));
await reset();
await setForm('boon', 'Gift', '1', '-5', '');
await click('.dm-hr-btn[data-act="add"]'); await settle();
check('a negative AP (a hidden grant) is refused', await page.evaluate(() => window.__calls.length === 0 && window.__alerts.some(m => /0 to 1000/.test(m))));
// A custom boon the character HOLDS cannot have its rule deleted (it would orphan it and refund it).
const HOLD = mkLog(79).concat([{ seq: 7, ts: 7, type: 'buy', cat: 'boon', payload: { v: XSS }, cost: 5, level: 1, label: 'Boon — custom' }]);
await render([row('c3', HOLD)]);
await reset();
await page.evaluate((n) => { const b = [...document.querySelectorAll('#campRoster .dm-hr-btn[data-act="remove"]')].find(x => x.getAttribute('data-name') === n); b.click(); }, XSS);
await settle();
check('deleting a custom boon the character holds is refused', await page.evaluate(() => window.__calls.length === 0 && window.__alerts.some(m => /is on this character/.test(m))));
await render([row('c1', LOG)]);
await reset();
await page.evaluate((n) => { const b = [...document.querySelectorAll('#campRoster .dm-hr-btn[data-act="remove"]')].find(x => x.getAttribute('data-name') === n); b.click(); }, XSS);
await settle();
call = await lastCall();
check('...but deleting one they do NOT hold sends the rules without it', call && call.events[0] && !(XSS in call.events[0].payload.patch.houseRules.boons));

console.log('6. Server without the migration, and the archived-campaign peek');
await render([row('c1', LOG)]);
await reset();
await page.evaluate(() => { window._campBridge.dmEditCharacterLog = () => Promise.reject(new Error('dm_edit_character_log: unsupported buy category patch')); });
await page.evaluate(() => { document.querySelector('#campRoster .dm-hr-call[data-key="tasha"]').checked = false; });
await click('.dm-hr-btn[data-act="calls"]');
await page.waitForFunction(() => window.__alerts.length > 0, { timeout: 5000 });
const oldMsg = await page.evaluate(() => window.__alerts[window.__alerts.length - 1]);
check('a server without the migration: a plain-language message, not the raw database error', /has not been updated/.test(oldMsg) && !/dm_edit_character_log/.test(oldMsg), oldMsg.slice(0, 100));
await render([row('c1', LOG)]);
await reset();
await page.evaluate(() => { window._campBridge.dmEditCharacterLog = () => Promise.reject(new Error('dm_edit_character_log: house rules can be changed only after the character has finished creation')); });
await page.evaluate(() => { document.querySelector('#campRoster .dm-hr-call[data-key="tasha"]').checked = false; });
await click('.dm-hr-btn[data-act="calls"]');
await page.waitForFunction(() => window.__alerts.length > 0, { timeout: 5000 });
const draftMsg = await page.evaluate(() => window.__alerts[window.__alerts.length - 1]);
check('the server\'s "finish creation first" refusal is shown in plain words', /Finish creating/.test(draftMsg) && !/dm_edit_character_log/.test(draftMsg), draftMsg.slice(0, 100));
await page.evaluate(() => { window._campBridge.dmEditCharacterLog = (id, events) => { window.__calls.push({ id, events }); return Promise.resolve(events); }; });
await render([row('c1', LOG)]);
await reset();
await page.evaluate(() => {
  window._dmPeekActive = true; window._dmPeekBlocks = () => { window.__blocked++; };
  document.querySelector('#campRoster .dm-hr-call[data-key="tasha"]').checked = false;
  document.querySelector('#campRoster .dm-hr-btn[data-act="calls"]').click();
});
await settle();
check('in an archived-campaign peek, Save calls sends NOTHING and goes through the shared peek guard',
  await page.evaluate(() => window.__calls.length === 0 && window.__blocked === 1));
await page.evaluate(() => { window._dmPeekActive = false; });

const fatal = errors.filter(e => !/Failed to load resource|net::|supabase|fetch|NetworkError|Load failed/i.test(e));
check('DM Console: no fatal page errors', fatal.length === 0, fatal.slice(0, 3).join(' | '));

// ------------------------------------------------------------------------------------------------- CharGen
console.log('7. CharGen — the player sees the DM\'s rules on their confirmed campaign character, and still cannot change them');
const C1 = '00000000-0000-0000-0000-00000000c001';
const cg = await browser.newPage();
const cgErr = []; cg.on('pageerror', e => cgErr.push(String(e)));
cg.on('dialog', d => d.accept());
await cg.goto(`http://localhost:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' });
await cg.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
await cg.reload({ waitUntil: 'load' });
await cg.waitForFunction(() => typeof window._cgApplyEnvelope === 'function' && !!window.compute && !!document.getElementById('dm_boons'), { timeout: 25000 });
await cg.waitForTimeout(1500);
await cg.evaluate((C1) => {
  window._authBridge.currentSession = async () => ({ user: { id: 'test-session' } });
  window._syncBridge.refreshServerBinding = async () => ({ ap: 0, campaignId: C1 });
  window._syncBridge.refreshServerAp = async () => 0;
  window._campaignBridge.getCampaign = async (id) => ({ id, name: 'Test campaign', rules: {}, ignore_player_ap: false });
}, C1);
await cg.evaluate(([L, C1]) => {
  _cgApplyEnvelope({ schema: 'pact-character/1', rules: DATA.version, name: 'House probe', LOG: L, SEQ: L.length + 1 }, { clearHistory: true });
  window._cgCampaignId = C1; window._cgCampaignBound = true; window._cgBindingConfirmed = true; render();
}, [LOG3, C1]);
await cg.waitForTimeout(300);
const cgState = await cg.evaluate((boon) => ({
  boonsBox: document.getElementById('dm_boons').checked, boonsDisabled: document.getElementById('dm_boons').disabled,
  hr: JSON.stringify(foldBuild(LOG).houseRules || {}), price: ((foldBuild(LOG).houseRules || {}).boons || {})[boon],
}), pick.boon);
check('CharGen shows the DM\'s call: the Boons box is OFF', cgState.boonsBox === false);
check('...and loading did not rewrite any event of the stored log (the DM\'s two appended events included)',
  await cg.evaluate((L) => L.every((e, i) => JSON.stringify(LOG[i]) === JSON.stringify(e)), LOG3));
check('...and disabled for the player', cgState.boonsDisabled === true);
check('...and folds the DM\'s repriced boon', cgState.price && cgState.price.ap === pick.boonAp - 2, JSON.stringify(cgState.price));
await cg.evaluate(() => { const e = document.getElementById('dm_boons'); e.disabled = false; e.checked = true; e.dispatchEvent(new Event('change', { bubbles: true })); });
await cg.waitForTimeout(200);
await cg.evaluate(() => { document.getElementById('dmkind').value = 'boon'; document.getElementById('dmname').value = 'Free Power';
  document.getElementById('dmhd').value = '1'; document.getElementById('dmap').value = '0'; document.getElementById('dmdesc').value = 'x'; dmAdd(); });
const cgAfter = await cg.evaluate(() => JSON.stringify(foldBuild(LOG).houseRules || {}));
check('the player forcing Boons back on, or adding a free boon, changes NO house rule', cgAfter === cgState.hr);
check('...and the box is put back to the DM\'s setting', await cg.evaluate(() => document.getElementById('dm_boons').checked === false));
const cgFatal = cgErr.filter(e => !/Failed to load resource|net::|supabase|fetch|NetworkError|Load failed/i.test(e));
check('CharGen: no fatal page errors', cgFatal.length === 0, cgFatal.slice(0, 3).join(' | '));

await browser.close();
server.close();
console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} passed / ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
