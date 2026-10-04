/* PACT — DM Console: the "unlock a locked drawback" control.
 *
 * feat/dm-unlock-drawback (D-GH-2026-10-04-dm-unlock-drawback). What a DM can click here becomes a write
 * into a PLAYER's log through a SECURITY DEFINER function, so the console's half of it is pinned:
 *
 *   1. WHICH purchases are offered. Only DM-imposed + locked + still-open + not-yet-unlocked ones, identified
 *      by the imposed purchase's seq. A player-taken drawback, an already-unlocked one, or one that is not
 *      locked must never appear — and a same-named player-taken one must never be the one released.
 *   2. WHAT the button sends. Exactly one dmUnlockDrawback event {refVal, targetSeq, note, label}; the story
 *      beat is required (owner decision B1) and is trimmed.
 *   3. THAT it respects the archived-campaign peek, like every other DM write on a roster card.
 *
 * Deliberately cheap, same as dm-console-ui-e2e.mjs: no Supabase stack, no sign-in. The bridge calls are
 * stubbed and recorded; only the console's wiring and rendering are under test. The server-side validation
 * lives in testing/sql/rls-baseline-test.sql, and the engine's matching in dm-unlock-drawback-ci.mjs.
 *
 *   node testing/scripts/dm-console-unlock-e2e.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = 7994;   // distinct from cloud-e2e 7970 / seed 7971 / dm-console-ui 7973 / chargen-flows 7979 / protected-roundtrip 7991 / live-sheet-unlock 7992
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

const browser = await launchChromium();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}/PACT/tools/DM-Console.html`, { waitUntil: 'load' });
// Wait on the condition, never a bare sleep — the bridge lands on campaign-ready, after the deferred module.
await page.waitForFunction(() => !!window._campBridge && typeof window._dmRenderCloudRoster === 'function', { timeout: 20000 });

// Stub every bridge call this control touches and record them; nothing here reaches a network.
await page.evaluate(() => {
  window.__calls = []; window.__alerts = []; window.__reloads = 0; window.__blocked = 0;
  window._campBridge.listCampaignInvites = () => Promise.resolve([]);
  window._campBridge.dmEditCharacterLog = (id, events) => { window.__calls.push({ id, events }); return Promise.resolve(events); };
  window._dmReloadRoster = () => { window.__reloads++; };
  window.alert = (m) => { window.__alerts.push(String(m)); };
  window.confirm = () => true;
});

// ---- the roster row ----------------------------------------------------------------------------------
//  seq 3  player-taken Peg Leg            -> never offered (not DM-imposed)
//  seq 4  DM-imposed LOCKED Peg Leg       -> offered (the one under test; same name as seq 3)
//  seq 5  DM-imposed LOCKED Lame          -> NOT offered: seq 6 below already unlocked it
//  seq 7  DM-imposed UNLOCKED Frail       -> never offered (dmLocked false: nothing to release)
const award = { type: 'award', amount: 79, seq: 1, label: 'Award' };
const oclass = { type: 'buy', cat: 'oclass', payload: { v: 'Fighter' }, cost: 0, level: 1, seq: 2, label: 'Fighter' };
const dmBuy = (seq, v, locked) => ({ type: 'buy', cat: 'drawback', payload: { v }, cost: 0, level: 1, seq,
  dmEdit: true, dmId: 'dm', dmLocked: locked, dmRemovalCost: 'flat', label: `Drawback — ${v} (DM imposed)` });
const LOG = [
  award, oclass,
  { type: 'buy', cat: 'drawback', payload: { v: 'Peg Leg' }, cost: -4, level: 1, seq: 3, label: 'Drawback — Peg Leg' },
  dmBuy(4, 'Peg Leg', true),
  dmBuy(5, 'Lame', true),
  { type: 'dmUnlockDrawback', refVal: 'Lame', targetSeq: 5, note: 'already done', seq: 6, dmEdit: true, dmId: 'dm', label: 'DM unlocked — Lame' },
  dmBuy(7, 'Frail', false),
];
const row = (id, log) => ({ id, name: 'Unlock probe ' + id, ap: 0, player: 'Player', playerLabel: '', dmNotes: '', stats: { LOG: log } });

async function render(rows) {
  await page.evaluate((rs) => { window._dmRenderCloudRoster(document.getElementById('campRoster'), rs); }, rows);
}
const offered = () => page.evaluate(() => {
  const sel = document.querySelector('#campRoster .dm-unlock-draw-sel');
  return sel ? [...sel.options].map(o => ({ value: o.value, name: o.getAttribute('data-name') })) : null;
});

console.log('Which locked drawbacks are offered');
await render([row('c1', LOG)]);
const opts = await offered();
check('the Unlock control renders', Array.isArray(opts));
check('exactly one drawback is offered (the imposed, locked, still-locked Peg Leg)', opts && opts.length === 1, JSON.stringify(opts));
check('...identified by the IMPOSED purchase\'s seq (4), not the same-named player-taken one (3)',
  opts && opts[0] && opts[0].value === '4' && opts[0].name === 'Peg Leg', JSON.stringify(opts));
check('the story-beat box is present, capped at 200 characters',
  await page.evaluate(() => { const n = document.querySelector('#campRoster .dm-unlock-draw-note'); return !!n && n.maxLength === 200; }));

console.log('What the Unlock button sends');
const click = () => page.evaluate(() => document.querySelector('#campRoster .dm-unlock-draw-btn').click());
await click();
check('an EMPTY story beat is refused with a message and nothing is sent',
  await page.evaluate(() => window.__calls.length === 0 && window.__alerts.some(m => /story beat/i.test(m))));
await page.evaluate(() => { document.querySelector('#campRoster .dm-unlock-draw-note').value = '   Recovered the surgeon\'s journal   '; });
await click();
await page.waitForFunction(() => window.__calls.length === 1, { timeout: 5000 });
const sent = await page.evaluate(() => window.__calls[0]);
check('exactly one RPC call, for this character', sent && sent.id === 'c1');
check('...carrying exactly one event', sent && sent.events.length === 1);
const ev = sent && sent.events[0];
check('...a dmUnlockDrawback keyed to the imposed purchase (name + seq 4)',
  ev && ev.type === 'dmUnlockDrawback' && ev.refVal === 'Peg Leg' && ev.targetSeq === 4, JSON.stringify(ev));
check('...with the story beat TRIMMED', ev && ev.note === 'Recovered the surgeon\'s journal', JSON.stringify(ev && ev.note));
check('...and nothing that could move AP or fake another event type (no cost/amount/payload)',
  ev && !('cost' in ev) && !('amount' in ev) && !('payload' in ev), JSON.stringify(ev));
check('...and the roster is reloaded afterwards', await page.evaluate(async () => { await Promise.resolve(); return window.__reloads === 1; }));

console.log('When the server refuses, the DM gets a plain-language reason');
await render([row('c1', LOG)]);
const tryUnlockAndReadAlert = (serverMessage) => page.evaluate(async (msg) => {
  window.__alerts.length = 0;
  window._campBridge.dmEditCharacterLog = () => Promise.reject(new Error(msg));
  document.querySelector('#campRoster .dm-unlock-draw-note').value = 'a perfectly good story beat';
  document.querySelector('#campRoster .dm-unlock-draw-btn').click();
  for (let i = 0; i < 40 && !window.__alerts.length; i++) await new Promise(r => setTimeout(r, 25));
  return window.__alerts[window.__alerts.length - 1] || '';
}, serverMessage);
const msgOld = await tryUnlockAndReadAlert('dm_edit_character_log: unsupported event type dmUnlockDrawback');
check('a server without the migration says so, in plain words (not the raw database error)',
  /has not been updated/i.test(msgOld) && !/dm_edit_character_log/.test(msgOld), msgOld.slice(0, 90));
const msgDup = await tryUnlockAndReadAlert('dm_edit_character_log: no single DM-imposed, locked drawback "Peg Leg" at seq 4 to unlock (found 2)');
check('an un-unlockable target (missing, already unlocked, or ambiguous) says so, in plain words',
  /cannot be unlocked automatically/i.test(msgDup) && !/dm_edit_character_log/.test(msgDup), msgDup.slice(0, 90));
await page.evaluate(() => { window._campBridge.dmEditCharacterLog = (id, events) => { window.__calls.push({ id, events }); return Promise.resolve(events); }; });

console.log('Hand-edited stamps are not offered an unlock the server would refuse');
await render([row('c4', [award, oclass, Object.assign(dmBuy(3, 'Peg Leg', true), { dmLocked: 1 })])]);
check('dmLocked: 1 (truthy, not true) is not offered', (await offered()) === null);

console.log('After the unlock lands, the control goes away');
await render([row('c1', LOG.concat([{ type: 'dmUnlockDrawback', refVal: 'Peg Leg', targetSeq: 4, note: 'done', seq: 8, dmEdit: true, dmId: 'dm', label: 'DM unlocked — Peg Leg' }]))]);
check('no locked drawback left -> no Unlock control at all', (await offered()) === null);

console.log('A character with nothing to unlock');
await render([row('c2', [award, oclass, dmBuy(3, 'Peg Leg', false)])]);
check('an imposed-but-never-locked drawback offers nothing', (await offered()) === null);

console.log('The archived-campaign peek still blocks it');
await render([row('c3', LOG)]);
await page.evaluate(() => {
  window.__calls.length = 0; window.__blocked = 0;
  window._dmPeekActive = true; window._dmPeekBlocks = () => { window.__blocked++; };
  document.querySelector('#campRoster .dm-unlock-draw-note').value = 'a perfectly good story beat';
  const b = document.querySelector('#campRoster .dm-unlock-draw-btn'); b.disabled = false; b.click();
});
check('clicking Unlock in an archived-campaign peek sends NOTHING', await page.evaluate(() => window.__calls.length === 0));
check('...and goes through the shared peek guard', await page.evaluate(() => window.__blocked === 1));
await page.evaluate(() => { window._dmPeekActive = false; });

const fatal = errors.filter(e => !/Failed to load resource|net::|supabase|fetch|NetworkError|Load failed/i.test(e));
check('no fatal page errors', fatal.length === 0, fatal.slice(0, 3).join(' | '));

await browser.close();
server.close();
console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} passed / ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
