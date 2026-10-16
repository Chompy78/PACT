/* PACT — compulsory descriptions on certain boons and drawbacks, approved (and locked) by the DM.
 *
 * feat/boon-drawback-notes (D-GH-2026-10-15-boon-drawback-notes). Pins the three tools' halves:
 *
 *   Live Sheet  buying a flagged item asks for its description (required, capped, cancel = not bought); an
 *               unflagged one never asks; the note shows on the Character panel and the 📋 Sheet, escaped; it can
 *               be edited until the DM approves it, and an approved note on a campaign character cannot be changed
 *               until a DM unlock (a solo character's note is never locked).
 *   CharGen     the same on the boon/drawback checkboxes, the notes panel and the 📋 Sheet.
 *   DM Console  the notes awaiting approval are listed above the cards and on each card; Approve / Unlock send
 *               exactly one dmApproveNote / dmUnlockNote event; a server that does not know the event yet gets a
 *               plain message; every note is escaped.
 *
 * No Supabase: the bridge calls are stubbed and recorded (same approach as dm-console-unlock-e2e.mjs). The server's
 * refusal of a player changing an approved note is tested in Docker by
 * testing/scripts/creation-lock-guard-test/run-notes.sh.
 *
 *   node testing/scripts/boon-drawback-notes-e2e.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
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

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

const XSS = '<img src=x onerror="window.__xss=1">Never lie';
const award = { type: 'award', amount: 79, seq: 1, label: 'Award — Level 1 (79 AP)' };
const oclass = { type: 'buy', cat: 'oclass', payload: { v: 'Fighter' }, cost: 0, level: 1, seq: 2, label: 'Origin class — Fighter' };
const coh = (seq) => ({ type: 'buy', cat: 'drawback', payload: { v: 'Code of Honour' }, cost: -3, level: 1, seq, label: 'Drawback — Code of Honour' });
const note = (seq, text, cat = 'drawback', name = 'Code of Honour') => ({ type: 'itemNote', cat, refVal: name, text, seq, label: 'Note — ' + name });
const approve = (seq, text, cat = 'drawback', name = 'Code of Honour') => ({ type: 'dmApproveNote', cat, refVal: name, text, campaignId: 'camp-1', seq, dmEdit: true, dmId: 'dm', label: 'DM approved description — ' + name });
const unlockN = (seq, cat = 'drawback', name = 'Code of Honour') => ({ type: 'dmUnlockNote', cat, refVal: name, note: 'new oath', campaignId: 'camp-1', seq, dmEdit: true, dmId: 'dm', label: 'DM unlocked description — ' + name });

// Every prompt()/alert() is answered from a queue the test sets, and recorded.
const DIALOG_STUBS = () => {
  window.__answers = []; window.__prompts = []; window.__alerts = [];
  window.prompt = (m, d) => { window.__prompts.push(String(m)); return window.__answers.length ? window.__answers.shift() : null; };
  window.alert = (m) => { window.__alerts.push(String(m)); };
  window.confirm = () => true;
};

const browser = await launchChromium();

// ================================================================================================ Live Sheet
async function openLS(LOG) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript((env) => { try { localStorage.setItem('pactLiveSheet', JSON.stringify(env)); } catch (e) {} },
    { schema: 'pact-character/1', LOG, SEQ: LOG.length + 1 });
  await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window._engineFold && typeof window.takeDrawback === 'function'
    && document.getElementById('ledger') && document.getElementById('ledger').innerHTML.length > 50, { timeout: 25000 });
  await page.evaluate(DIALOG_STUBS);
  return { page, errs, close: () => ctx.close() };
}
const lsLog = (page) => page.evaluate(() => LOG.map(e => ({ type: e.type, cat: e.cat, v: e.payload && e.payload.v, refVal: e.refVal, text: e.text })));

console.log('Live Sheet — buying a flagged drawback asks for its description');
{
  const { page, errs, close } = await openLS([award, oclass]);
  check('DATA.notePrompts flags Code of Honour (and not Oath of Poverty)',
    await page.evaluate(() => !!DATA.notePrompts.drawback['Code of Honour'] && !DATA.notePrompts.drawback['Oath of Poverty (permanent)']));
  const n0 = (await lsLog(page)).length;
  await page.evaluate(() => { window.__answers = ['   ', null]; takeDrawback('Code of Honour'); });
  check('an empty answer is refused with a message, then Cancel buys nothing',
    (await lsLog(page)).length === n0 && (await page.evaluate(() => window.__alerts.some(a => /required/i.test(a)))));
  check('...and the question shown is the item\'s own prompt',
    await page.evaluate(() => /code of honour/i.test(window.__prompts[0] || '')));
  await page.evaluate(() => { window.__answers = ['x'.repeat(501), 'Never strike an unarmed foe.']; window.__alerts = []; takeDrawback('Code of Honour'); });
  const log = await lsLog(page);
  check('a 501-character answer is refused and re-asked', await page.evaluate(() => window.__alerts.some(a => /500 characters/.test(a))));
  const last2 = log.slice(-2);
  check('the purchase and its note are recorded together (buy, then itemNote)',
    last2[0].type === 'buy' && last2[0].v === 'Code of Honour' && last2[1].type === 'itemNote'
    && last2[1].refVal === 'Code of Honour' && last2[1].cat === 'drawback' && last2[1].text === 'Never strike an unarmed foe.', JSON.stringify(last2));
  check('the note shows on the Character panel', await page.evaluate(() =>
    [...document.querySelectorAll('#sheet .lsnote-text')].some(d => /unarmed foe/.test(d.textContent))));
  const before = (await lsLog(page)).length;
  await page.evaluate(() => { window.__prompts = []; takeDrawback('Heavy Sleeper'); });
  check('an unflagged drawback is bought without a question',
    (await lsLog(page)).length === before + 1 && (await page.evaluate(() => window.__prompts.length)) === 0);
  await page.evaluate(() => { window.__answers = ['Never strike an unarmed foe; never break a promise.']; lsEditItemNote('drawback', 'Code of Honour'); });
  const ed = (await lsLog(page)).slice(-1)[0];
  check('a solo character can edit the note (a newer itemNote is appended)', ed.type === 'itemNote' && /promise/.test(ed.text), JSON.stringify(ed));
  await page.evaluate(() => { toggleSheet(); });
  check('the 📋 Sheet shows the note in its own box', await page.evaluate(() =>
    [...document.querySelectorAll('.shnotes')].some(d => /promise/.test(d.textContent))));
  check('no page errors', errs.length === 0, errs.join(' | '));
  await close();
}

console.log('Live Sheet — an approved note on a campaign character is locked until the DM unlocks it');
{
  const { page, errs, close } = await openLS([award, oclass, coh(3), note(4, XSS), approve(5, XSS)]);
  await page.evaluate(() => { window._lsCampaignId = 'camp-1'; render(); });
  check('the note text is escaped (no <img> injected) and shown', await page.evaluate(() =>
    !document.querySelector('#sheet .lsnote-text img') && [...document.querySelectorAll('#sheet .lsnote-text')].some(d => /Never lie/.test(d.textContent)) && !window.__xss));
  check('it is marked approved, with no Edit button', await page.evaluate(() => {
    const r = document.querySelector('#sheet .lsnote'); return !!r && /approved/.test(r.textContent) && !r.querySelector('.lsnote-edit'); }));
  const n0 = (await lsLog(page)).length;
  await page.evaluate(() => { window.__answers = ['changed']; lsEditItemNote('drawback', 'Code of Honour'); });
  check('lsEditItemNote() refuses with a message and records nothing',
    (await lsLog(page)).length === n0 && (await page.evaluate(() => window.__alerts.some(a => /unlock/i.test(a)))));
  await page.evaluate(() => { window._lsCampaignId = null; render(); });
  check('the same approved note on a SOLO character is editable (solo notes are never locked)', await page.evaluate(() =>
    !!document.querySelector('#sheet .lsnote .lsnote-edit')));
  await page.evaluate(() => { window._lsCampaignId = 'camp-2'; render(); });
  check('an approval made in a DIFFERENT campaign does not lock it (a moved character needs its new DM)', await page.evaluate(() =>
    !!document.querySelector('#sheet .lsnote .lsnote-edit') && /awaiting DM approval/.test(document.querySelector('#sheet .lsnote').textContent)));
  check('no page errors', errs.length === 0, errs.join(' | '));
  await close();
}
{
  // A: the approved note was rewritten IN PLACE (possible while the character was solo): the approval no longer matches.
  const { page, errs, close } = await openLS([award, oclass, coh(3), note(4, 'Swapped oath'), approve(5, 'Old oath')]);
  await page.evaluate(() => { window._lsCampaignId = 'camp-1'; render(); });
  check('A: an approval of a DIFFERENT text does not approve or lock the current note', await page.evaluate(() => {
    const r = document.querySelector('#sheet .lsnote'); return !!r && /awaiting DM approval/.test(r.textContent) && !!r.querySelector('.lsnote-edit'); }));
  check('no page errors', errs.length === 0, errs.join(' | '));
  await close();
}
{
  const { page, errs, close } = await openLS([award, oclass, coh(3), note(4, 'Old oath'), approve(5, 'Old oath'), unlockN(6)]);
  await page.evaluate(() => { window._lsCampaignId = 'camp-1'; render(); });
  await page.evaluate(() => { window.__answers = ['New oath']; lsEditItemNote('drawback', 'Code of Honour'); });
  const last = (await lsLog(page)).slice(-1)[0];
  check('after a DM unlock the player can change it again', last.type === 'itemNote' && last.text === 'New oath', JSON.stringify(last));
  check('...and it is awaiting approval again', await page.evaluate(() => /awaiting DM approval/.test((document.querySelector('#sheet .lsnote') || {}).textContent || '')));
  check('no page errors', errs.length === 0, errs.join(' | '));
  await close();
}

// ================================================================================================ CharGen
console.log('CharGen — ticking a flagged boon/drawback asks for its description');
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window._cgApplyEnvelope === 'function' && !!window.DATA && document.querySelector('.drawck'), { timeout: 25000 });
  await page.waitForTimeout(800);
  await page.evaluate(DIALOG_STUBS);
  const cgLog = () => page.evaluate(() => LOG.map(e => ({ type: e.type, cat: e.cat, v: e.payload && e.payload.v, refVal: e.refVal, text: e.text })));
  const box = (v) => `input.drawck[value="${v}"]`;
  const n0 = (await cgLog()).length;
  await page.evaluate(() => { window.__answers = [null]; });
  await page.click(box('Code of Honour'));
  check('Cancel leaves the box unticked and buys nothing',
    !(await page.isChecked(box('Code of Honour'))) && !(await cgLog()).some(e => e.type === 'buy' && e.v === 'Code of Honour'), `log ${n0} -> ${(await cgLog()).length}`);
  await page.evaluate((x) => { window.__answers = [x]; }, XSS);
  await page.click(box('Code of Honour'));
  const log = await cgLog();
  const bi = log.findIndex(e => e.type === 'buy' && e.v === 'Code of Honour');
  check('with a description the drawback is bought and its note recorded right after it',
    bi >= 0 && log[bi + 1] && log[bi + 1].type === 'itemNote' && log[bi + 1].text === XSS, JSON.stringify(log.slice(-3)));
  check('the notes panel shows it, escaped', await page.evaluate(() =>
    !document.querySelector('#cgItemNotes img') && /Never lie/.test((document.getElementById('cgItemNotes') || {}).textContent || '') && !window.__xss));
  await page.evaluate(() => { window.__prompts = []; });
  await page.click(box('Heavy Sleeper'));
  check('an unflagged drawback is ticked without a question', (await page.evaluate(() => window.__prompts.length)) === 0
    && (await cgLog()).some(e => e.type === 'buy' && e.v === 'Heavy Sleeper'));
  const nU = (await cgLog()).length;
  await page.evaluate(() => { window.__answers = ['Dice, always dice.']; });
  await page.click(box('Compulsion'));
  const afterBuy = (await cgLog()).length;
  await page.evaluate(() => undo());
  check('E: the purchase and its description are ONE undo step', afterBuy === nU + 2 && (await cgLog()).length === nU
    && !(await page.isChecked(box('Compulsion'))), `${nU} -> ${afterBuy} -> ${(await cgLog()).length}`);
  await page.evaluate(() => { window.__answers = ['Edited oath']; cgEditItemNote('drawback', 'Code of Honour'); });
  check('the note can be edited before approval', (await cgLog()).slice(-1)[0].text === 'Edited oath');
  // Approved by the DM while in a campaign: locked.
  await page.evaluate(() => {
    LOG.push({ type: 'dmApproveNote', cat: 'drawback', refVal: 'Code of Honour', text: 'Edited oath', campaignId: 'camp-1', seq: SEQ++, dmEdit: true, dmId: 'dm', label: 'DM approved' });
    window._cgCampaignId = 'camp-1'; render();
  });
  check('an approved note shows as approved with no Edit button', await page.evaluate(() => {
    const r = document.querySelector('#cgItemNotes .cgnote'); return !!r && /approved/.test(r.textContent) && !r.querySelector('.cgnote-edit'); }));
  const n1 = (await cgLog()).length;
  await page.evaluate(() => { window.__answers = ['sneaky']; window.__alerts = []; cgEditItemNote('drawback', 'Code of Honour'); });
  check('cgEditItemNote() refuses it while the character is in a campaign',
    (await cgLog()).length === n1 && (await page.evaluate(() => window.__alerts.some(a => /unlock/i.test(a)))));
  await page.evaluate(() => { toggleSheet(); });
  check('the note helpers never shadow CharGen\'s campaign globals (cloud save reads window._cgCampaignId)',
    await page.evaluate(() => typeof window._cgCampaignId === 'string' && typeof window._cgCampaignBound !== 'function'));
  check('the 📋 Sheet shows the note', await page.evaluate(() => [...document.querySelectorAll('.shnotes')].some(d => /Edited oath/.test(d.textContent))));
  await page.evaluate(() => { try { toggleSheet(); } catch (e) {} });
  // D: Randomise rebuilds the log from the form — the descriptions and their approval must come through verbatim.
  const fam = () => page.evaluate(() => JSON.stringify(LOG.filter(e => ['itemNote', 'dmApproveNote', 'dmUnlockNote'].includes(e.type))));
  const famBefore = await fam();
  await page.evaluate(() => { window.confirm = () => true; randomizeRoll(); });
  await page.waitForTimeout(500);
  check('D: Randomise keeps every note and approval event verbatim (same seq/ts)', (await fam()) === famBefore,
    `${famBefore.length} vs ${(await fam()).length}`);
  check('D: ...and no later event reuses a carried seq', await page.evaluate(() => {
    const seqs = LOG.filter(e => ['itemNote', 'dmApproveNote'].includes(e.type)).map(e => e.seq); return seqs.every(q => SEQ > q); }));
  // D: the Live-Sheet-file load branch rebuilds the log too; it must carry the notes, and an approval makes it a copy.
  const lsFile = { rules: 'v0.376', name: 'Notes file', id: '99999999-2222-3333-4444-555555555555', LOG: [
    { type: 'buy', cat: 'drawback', payload: { v: 'Code of Honour' }, cost: -3, level: 1, seq: 1, label: 'Drawback — Code of Honour' },
    { type: 'itemNote', cat: 'drawback', refVal: 'Code of Honour', text: 'File oath', seq: 2 },
    { type: 'dmApproveNote', cat: 'drawback', refVal: 'Code of Honour', text: 'File oath', campaignId: 'camp-9', seq: 3, dmEdit: true, dmId: 'dm' } ] };
  await page.setInputFiles('#loadfile', { name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(lsFile)) });
  await page.waitForFunction(() => LOG.some(e => e.type === 'itemNote' && e.text === 'File oath'), null, { timeout: 8000 }).catch(() => {});
  check('D: loading a Live Sheet file keeps its note and approval events', await page.evaluate(() =>
    LOG.some(e => e.type === 'itemNote' && e.text === 'File oath' && e.seq === 2) && LOG.some(e => e.type === 'dmApproveNote' && e.seq === 3)));
  check('D: ...and, carrying a DM approval, it opens as a separate copy (fresh id)', await page.evaluate(() => currentCharId() !== '99999999-2222-3333-4444-555555555555'));
  // E (post-lock): a purchase that is refused is never asked about; a cancelled description buys nothing.
  await page.evaluate(() => { window._cgCampaignId = null; LOG.push({ type: 'creationLocked', seq: SEQ++, ts: Date.now() }); render(); window.__prompts = []; window.__alerts = []; window.__f = []; });
  const nL0 = (await cgLog()).length;
  await page.evaluate(() => { window.__answers = ['never used']; const el = document.querySelector('input.boonck[value="Patron"]'); if (el) el.click(); });
  check('E: after the lock, an UNAFFORDABLE flagged boon is refused WITHOUT asking for a description (asked after the checks)',
    (await page.evaluate(() => window.__prompts.length)) === 0 && (await cgLog()).length === nL0, String(await page.evaluate(() => window.__prompts.length)));
  await page.evaluate(() => { window.__answers = []; LOG.push({ type: 'award', amount: 100, label: 'AP', seq: SEQ++, ts: Date.now() }); render(); window.__prompts = []; });
  const nL = (await cgLog()).length;
  await page.evaluate(() => { window.__answers = [null]; const el = document.querySelector('input.boonck[value="Patron"]'); if (el) el.click(); });
  check('E: after the lock, cancelling the description buys nothing',
    (await page.evaluate(() => window.__prompts.length)) === 1 && (await cgLog()).length === nL);
  await page.evaluate(() => { window.__answers = ['The Silver Hand']; const el = document.querySelector('input.boonck[value="Patron"]'); if (el) el.click(); });
  const pl = (await cgLog()).slice(-2);
  check('E: ...and with one, the post-lock purchase and its note are appended together', pl[0].type === 'buy' && pl[0].v === 'Patron'
    && pl[1].type === 'itemNote' && pl[1].text === 'The Silver Hand', JSON.stringify(pl));
  check('no page errors', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

// ================================================================================================ DM Console
console.log('DM Console — notes awaiting approval, Approve and Unlock');
{
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(`http://localhost:${PORT}/PACT/tools/DM-Console.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window._campBridge && typeof window._dmRenderCloudRoster === 'function', { timeout: 20000 });
  await page.evaluate(() => {
    window.__calls = []; window.__reloads = 0; window.__alerts = []; window.__answers = []; window.__fail = null;
    window._dmCampaignApRules = { campaignId: 'camp-1', rules: {} };
    window._campBridge.listCampaignInvites = () => Promise.resolve([]);
    window._campBridge.dmEditCharacterLog = (id, events) => { window.__calls.push({ id, events }); return window.__fail ? Promise.reject(new Error(window.__fail)) : Promise.resolve(events); };
    window._dmReloadRoster = () => { window.__reloads++; };
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.prompt = () => (window.__answers.length ? window.__answers.shift() : null);
    window.confirm = () => true;
  });
  const patron = { type: 'buy', cat: 'boon', payload: { v: 'Patron' }, cost: 4, level: 1, seq: 4, label: 'Boon — Patron' };
  const row = (id, log) => ({ id, name: 'Notes probe ' + id, ap: 0, player: 'Player', playerLabel: '', dmNotes: '', stats: { LOG: log } });
  const rows = [
    row('c-pending', [award, oclass, coh(3), patron, note(5, XSS)]),
    row('c-approved', [award, oclass, coh(3), note(4, 'Old oath'), approve(5, 'Old oath')]),
  ];
  await page.evaluate((rs) => { window._dmRenderCloudRoster(document.getElementById('campRoster'), rs); }, rows);
  const panel = await page.evaluate(() => { const p = document.getElementById('campNotesPending'); return p ? { text: p.textContent, html: p.innerHTML, approve: p.querySelectorAll('.dm-note-approve-btn').length } : null; });
  check('the roster lists the ONE note awaiting approval above the cards', !!panel && /\(1\)/.test(panel.text) && panel.approve === 1, panel && panel.text);
  check('...escaped (no <img>), with the note text', !!panel && !/<img/i.test(panel.html) && /Never lie/.test(panel.text) && !(await page.evaluate(() => window.__xss)));
  check('a held flagged boon with no note yet is shown as not written (and cannot be approved)', await page.evaluate(() => {
    const r = document.querySelector('.card[data-id="c-pending"] .dm-note-row[data-name="Patron"]'); return !!r && /not written/.test(r.textContent) && !r.querySelector('button'); }));
  check('the approved note on the other card offers Unlock, not Approve', await page.evaluate(() => {
    const r = document.querySelector('.card[data-id="c-approved"] .dm-note-row'); return !!r && !!r.querySelector('.dm-note-unlock-btn') && !r.querySelector('.dm-note-approve-btn'); }));
  await page.evaluate(() => document.querySelector('#campNotesPending .dm-note-approve-btn').click());   // #campRoster is hidden without a signed-in campaign
  const c1 = await page.evaluate(() => window.__calls.slice());
  check('Approve sends exactly one dmApproveNote {cat, refVal} for that character',
    c1.length === 1 && c1[0].id === 'c-pending' && c1[0].events.length === 1 && c1[0].events[0].type === 'dmApproveNote'
    && c1[0].events[0].cat === 'drawback' && c1[0].events[0].refVal === 'Code of Honour', JSON.stringify(c1));
  check('B: ...carrying the exact text the DM was shown', c1[0] && c1[0].events[0].text === XSS);
  check('...and reloads the roster', (await page.evaluate(() => window.__reloads)) === 1);
  await page.evaluate(() => { window.__answers = ['They swore a new oath']; });
  await page.evaluate(() => document.querySelector('.card[data-id="c-approved"] .dm-note-unlock-btn').click());
  const c2 = await page.evaluate(() => window.__calls.slice(1));
  check('Unlock sends exactly one dmUnlockNote with the reason',
    c2.length === 1 && c2[0].id === 'c-approved' && c2[0].events[0].type === 'dmUnlockNote' && c2[0].events[0].refVal === 'Code of Honour'
    && c2[0].events[0].note === 'They swore a new oath', JSON.stringify(c2));
  // A server without the migration refuses the new event type: plain message, not a database error.
  await page.evaluate((rs) => { window.__fail = 'dm_edit_character_log: unsupported event type dmApproveNote'; window._dmRenderCloudRoster(document.getElementById('campRoster'), rs); }, rows);
  await page.evaluate(() => document.querySelector('#campNotesPending .dm-note-approve-btn').click());   // #campRoster is hidden without a signed-in campaign
  await page.waitForFunction(() => window.__alerts.length > 0, { timeout: 5000 });
  check('before the migration is applied the DM gets a plain "server not updated" message',
    await page.evaluate(() => /has not been updated/.test(window.__alerts[0] || '')), await page.evaluate(() => window.__alerts[0]));
  await page.evaluate((rs) => { window.__alerts = []; window.__fail = 'dm_edit_character_log: the description of drawback "Code of Honour" changed since this page loaded — reload and read it again'; window._dmRenderCloudRoster(document.getElementById('campRoster'), rs); }, rows);
  await page.evaluate(() => document.querySelector('#campNotesPending .dm-note-approve-btn').click());
  await page.waitForFunction(() => window.__alerts.length > 0, { timeout: 5000 });
  check('B: the server\'s "changed since this page loaded" refusal reaches the DM as a reload message',
    await page.evaluate(() => /changed since this page loaded — reload the roster/.test(window.__alerts[0] || '')), await page.evaluate(() => window.__alerts[0]));
  // Archived-campaign peek blocks the write.
  await page.evaluate((rs) => { window.__fail = null; window.__calls = []; window._dmPeekActive = true; window._dmPeekBlocks = () => { window.__blocked = 1; }; window._dmRenderCloudRoster(document.getElementById('campRoster'), rs); }, rows);
  await page.evaluate(() => document.querySelector('#campNotesPending .dm-note-approve-btn').click());   // #campRoster is hidden without a signed-in campaign
  check('an archived-campaign peek blocks Approve', (await page.evaluate(() => window.__calls.length)) === 0 && (await page.evaluate(() => window.__blocked)) === 1);
  check('no page errors', errs.length === 0, errs.join(' | '));
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
