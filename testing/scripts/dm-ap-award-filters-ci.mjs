#!/usr/bin/env node
/**
 * PACT — "Edit AP awards" filter/sort gate.
 *
 * WHY THIS EXISTS. The Edit AP awards modal (feat/dm-ap-award-editing, PR #534) had no UI coverage at
 * all: dm-console-ui-e2e.mjs never opens it, because it needs a selected campaign and an award history.
 * Both are reachable offline — `window._dmSetCampIdTest` already exists as a hook, and the history call
 * is one bridge method to stub — so the filters and the sort added on 2026-09-08 are gated here.
 *
 * THE TWO CHECKS THAT MATTER are the ones a naive implementation fails:
 *   · sorting must MOVE the existing rows, not re-render them, or a DM's staged amount/note/reason is
 *     silently destroyed mid-edit;
 *   · the note filter must read the input's CURRENT value, so a row can be found by what was just typed.
 * Both are asserted below, and both go red if the implementation re-renders or reads data-orig-note.
 *
 * USAGE:  node testing/scripts/dm-ap-award-filters-ci.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = 7975;   // not 7970/7971/7973
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json',
               '.css':'text/css','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml' };
const server = http.createServer((req,res)=>{
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/PACT\/?/,'') || 'index.html';
  fs.readFile(path.join(REPO, rel), (e,d)=>{
    if(e){ res.writeHead(404); return res.end('nf'); }
    res.writeHead(200,{'Content-Type':MIME[path.extname(rel)]||'application/octet-stream','Cache-Control':'no-store'});
    res.end(d);
  });
});
await new Promise(r=>server.listen(PORT,r));

let pass=0, fail=0;
const check=(n,ok,d='')=>{ ok?pass++:fail++; console.log(`  ${ok?'PASS':'FAIL'}  ${n}${d?' — '+d:''}`); };

const browser = await launchChromium();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type()==='error') errors.push('console: '+m.text()); });

await page.goto(`http://localhost:${PORT}/PACT/tools/DM-Console.html`, { waitUntil:'load' });
await page.waitForFunction(() => !!window._campBridge, { timeout: 15000 });

// Four awards, deliberately shaped so every filter and every sort key discriminates: two characters,
// three distinct days, amounts out of alphabetical order, two DMs.
const AWARDS = [
  { id:'a1', characterName:'Skylar', amount:6, note:'session four base',      created_at:'2026-09-01T20:00:00Z', dm:'john' },
  { id:'a2', characterName:'Archer', amount:2, note:'clean heist bonus',      created_at:'2026-09-03T20:00:00Z', dm:'john' },
  { id:'a3', characterName:'Skylar', amount:4, note:'downtime study',         created_at:'2026-09-05T20:00:00Z', dm:'zoe'  },
  { id:'a4', characterName:'Bram',   amount:8, note:'heist and the branding', created_at:'2026-09-05T20:00:00Z', dm:'zoe'  },
];

await page.evaluate((awards) => {
  window._campBridge.listCampaignInvites = () => Promise.resolve([]);
  window._campBridge.getPartyAwardHistory = () => Promise.resolve(awards);
  window._dmSetCampIdTest('live-1');
}, AWARDS);

await page.click('#campEditAwardsBtn');
await page.waitForSelector('.ea-tbody tr[data-award-id]', { timeout: 10000 });

const visible = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('.ea-tbody tr[data-award-id]'))
       .filter(tr => tr.style.display !== 'none')
       .map(tr => tr.getAttribute('data-award-id')));
const order = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('.ea-tbody tr[data-award-id]'))
       .map(tr => tr.getAttribute('data-award-id')));
const setF = (sel, val) => page.evaluate(([s,v]) => {
  const el = document.querySelector(s); el.value = v;
  el.dispatchEvent(new Event(el.type === 'date' ? 'change' : 'input', { bubbles:true }));
}, [sel, val]);

console.log('\nEdit AP awards — filters');
check('all four rows render', (await order()).length === 4, (await order()).join(','));

await setF('.ea-filter', 'sky');
check('character filter keeps only Skylar', JSON.stringify(await visible()) === '["a1","a3"]', (await visible()).join(','));
await setF('.ea-filter', '');

await setF('.ea-note-filter', 'heist');
check('note filter matches a word inside the note', JSON.stringify(await visible()) === '["a2","a4"]', (await visible()).join(','));
await setF('.ea-note-filter', '');

await setF('.ea-from', '2026-09-03');
check('date from', JSON.stringify(await visible()) === '["a2","a3","a4"]', (await visible()).join(','));
await setF('.ea-to', '2026-09-03');
check('date from+to is an inclusive range', JSON.stringify(await visible()) === '["a2"]', (await visible()).join(','));
await setF('.ea-from', ''); await setF('.ea-to', '');

await setF('.ea-filter', 'skylar'); await setF('.ea-note-filter', 'downtime');
check('filters combine (AND, not OR)', JSON.stringify(await visible()) === '["a3"]', (await visible()).join(','));
await page.click('.ea-clear');
check('Clear restores every row', (await visible()).length === 4);

console.log('\nEdit AP awards — sort');
const clickSort = async k => { await page.click(`.ea-sort[data-sort="${k}"]`); };
await clickSort('amt');
check('sort by amount ascending', JSON.stringify(await order()) === '["a2","a3","a1","a4"]', (await order()).join(','));
await clickSort('amt');
check('same header again reverses', JSON.stringify(await order()) === '["a4","a1","a3","a2"]', (await order()).join(','));
await clickSort('char');
// Ascending on the names in play (skylar/archer/skylar/bram): "archer" < "bram" < "skylar", so Archer
// (a2) sorts first and Bram (a4) second — a4 before a2 here was a typo in this check, not a real
// ordering the implementation should produce. The two Skylar rows (a1, a3) keep their relative order
// from the prior amt-descending sort (a4,a1,a3,a2), which is what a stable sort guarantees.
check('sort by character', JSON.stringify(await order()) === '["a2","a4","a1","a3"]', (await order()).join(','));
await clickSort('day');
check('sort by date', (await order())[0] === 'a1', (await order()).join(','));

console.log('\nEdit AP awards — a DM\'s typing survives');
await page.evaluate(() => {
  const tr = document.querySelector('tr[data-award-id="a3"]');
  tr.querySelector('.ea-amt').value = '99';
  tr.querySelector('.ea-note').value = 'edited but not saved';
  tr.querySelector('.ea-editnote').value = 'because I said so';
  tr.querySelector('.ea-note').dispatchEvent(new Event('input', { bubbles:true }));
});
await clickSort('char'); await clickSort('char'); await setF('.ea-filter', 'sky'); await page.click('.ea-clear');
const kept = await page.evaluate(() => {
  const tr = document.querySelector('tr[data-award-id="a3"]');
  return [tr.querySelector('.ea-amt').value, tr.querySelector('.ea-note').value, tr.querySelector('.ea-editnote').value];
});
check('staged amount survives sorting and filtering', kept[0] === '99', kept[0]);
check('staged note survives', kept[1] === 'edited but not saved', kept[1]);
check('reason-for-change survives', kept[2] === 'because I said so', kept[2]);

await setF('.ea-note-filter', 'edited but not saved');
check('note filter reads the LIVE input, not the loaded value', JSON.stringify(await visible()) === '["a3"]', (await visible()).join(','));
await setF('.ea-note-filter', 'downtime');
check('the loaded note no longer matches once retyped', (await visible()).length === 0, (await visible()).join(','));

await setF('.ea-note-filter', 'heist');
const counter = await page.evaluate(() => document.querySelector('.ea-count').textContent);
check('counter warns that a hidden row still has unsaved changes', /hidden row/.test(counter), counter);
await setF('.ea-note-filter', '');

console.log('\nEdit AP awards — editable date (item 4, owner decision A)');
// Reset a3 back to its loaded values first — the previous section left it with genuine unsaved
// changes (amt/note), which would otherwise also be sent by the Save clicks below and both break the
// "Nothing changed" assertion and hit the real (unstubbed) network.
await page.evaluate(() => {
  const tr = document.querySelector('tr[data-award-id="a3"]');
  tr.querySelector('.ea-amt').value = tr.getAttribute('data-orig-amount');
  tr.querySelector('.ea-note').value = tr.getAttribute('data-orig-note');
  tr.querySelector('.ea-note').dispatchEvent(new Event('input', { bubbles:true }));
});
// Stub editApAward for the rest of this file — nothing below should reach real Supabase.
await page.evaluate(() => { window._eaEditCalls = []; window._campBridge.editApAward = (...args) => { window._eaEditCalls.push(args); return Promise.resolve(42); }; });

// Deliberately no hardcoded absolute time string anywhere below — the CI machine's local timezone is
// unknown, and <input type="datetime-local"> is always local-time by spec. Every check here is
// RELATIVE: round-trip the loaded value back unchanged (must not register as a change — guards
// against the microsecond-vs-whole-second precision loss between Postgres's created_at and what the
// input can represent), or shift it by a known, large, unambiguous delta.
const dateVal = sel => page.evaluate(s => document.querySelector(s).value, sel);
const setDate = (sel, v) => page.evaluate(([s,v]) => {
  const el = document.querySelector(s); el.value = v;
  el.dispatchEvent(new Event('change', { bubbles:true }));
}, [sel, v]);

const a1Sel = 'tr[data-award-id="a1"] .ea-date';
const origA1 = await dateVal(a1Sel);
// Seconds are optional in the readback: some browsers normalize a datetime-local value's trailing
// ":00" seconds away even with step="1" set, which is a display quirk, not a precision loss — the
// second-level comparisons below work off Date.parse(), not this string, either way.
check('date input pre-fills from created_at', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(origA1), origA1);

// Re-set the exact same value (simulates a no-op click into the field) — must NOT count as a change.
await setDate(a1Sel, origA1);
await page.click('.ea-save');
let status = await page.evaluate(() => document.querySelector('.ea-status').textContent);
check('re-setting the same second is not treated as a change', status === 'Nothing changed.', status);

const p = n => String(n).padStart(2,'0');

// Sorting by date must reflect the LIVE edit immediately, before Save — that IS the feature (owner:
// "a lot are awarded at the same second and the ordering makes it hard for me to understand"). Shift
// a1 (originally the earliest, 2026-09-01) 10 days forward from its OWN original local value — plain
// local-time arithmetic, no UTC accessors — to land past every other row (latest is a4/a3,
// 2026-09-05) and actually change the sort-by-date order.
const farFuture = new Date(new Date(origA1).getTime() + 10*24*3600*1000);
const farVal = `${farFuture.getFullYear()}-${p(farFuture.getMonth()+1)}-${p(farFuture.getDate())}T${p(farFuture.getHours())}:${p(farFuture.getMinutes())}:${p(farFuture.getSeconds())}`;
await setDate(a1Sel, farVal);
await clickSort('day');
const orderAfterDateEdit = await order();
check('sort by date reflects an unsaved live edit, not just the loaded value', orderAfterDateEdit[orderAfterDateEdit.length-1] === 'a1', orderAfterDateEdit.join(','));

// The required-reason rule applies here too — a1's date genuinely changed, so it needs one or Save
// correctly refuses the whole batch (this is exactly what caught this test's own first draft: it
// tried to Save with no reason filled in, and got zero calls back — the app enforcing its own rule
// correctly, not a bug).
await page.evaluate(() => { document.querySelector('tr[data-award-id="a1"] .ea-editnote').value = 'correcting a bulk-award timestamp collision'; });
await page.evaluate(() => { window._eaEditCalls = []; });   // clear the no-op Save click's (empty) log
await page.click('.ea-save');
const calls = await page.evaluate(() => window._eaEditCalls);
check('Save calls editApAward exactly once for the one changed row', calls.length === 1, JSON.stringify(calls));
if(calls.length === 1){
  const [id, amt, note, createdAt, reason] = calls[0];
  check('...for the right award', id === 'a1', id);
  check('...amount/note unchanged (only the date was edited)', amt === 6 && note === 'session four base', JSON.stringify([amt,note]));
  check('...createdAt is a valid ISO string', typeof createdAt === 'string' && !isNaN(Date.parse(createdAt)), createdAt);
  check('...reason for the change was required and sent', typeof reason === 'string' && reason.length > 0, reason);
}

check('no page errors', errors.length === 0, errors.slice(0,2).join(' | '));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
