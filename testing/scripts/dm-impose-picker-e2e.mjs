/* PACT — the DM Console "Impose a drawback" pop-up picker.
 *
 * feat/dm-impose-picker. The impose control used to be a bare dropdown: a DM chose a drawback by name and price alone,
 * with no sight of what it does. It is now a button that opens a window — a searchable, grouped list on the left and, on
 * the right, the effect text, wound tier/place, buy-off cost (flat and 3x), which normal limits do NOT apply when imposed,
 * and a warning if it clashes with what the character already holds. This proves, in a real browser, that:
 *
 *   1. the card shows an opener button (and the old controls stay in the DOM, hidden — they are the one send path);
 *   2. the window lists EVERY drawback exactly once, grouped wounds-first, and search narrows it (and hides empty groups);
 *   3. the detail pane is read from DATA (effect text, tier, place, flat and tripled buy-off, the "cap not applied" note,
 *      the caster warning) and warns about a same-place wound / a second copy the character already has;
 *   4. choosing a wound defaults Locked + flat, and moving between wounds does NOT undo what the DM changed;
 *   5. Escape / Cancel close it and send nothing, focus returns to the opener;
 *   6. Impose sends exactly one drawback purchase at cost 0 carrying the window's Locked and removal-cost choices.
 *
 * No Supabase, no sign-in: bridge calls are stubbed and recorded. Each "absent" check has a control proving the thing it
 * looks for could have appeared.
 *
 *   node testing/scripts/dm-impose-picker-e2e.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = 7996;   // distinct from wounds-ui 7995 / dm-console-unlock 7994 / live-sheet-unlock 7992 / protected-roundtrip 7991
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
const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
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
// The character already holds a player-taken Lame (a leg wound), so a second leg wound and a second Lame should warn.
const LOG = [
  { type: 'award', amount: 79, seq: 1, label: 'Award' },
  { type: 'buy', cat: 'oclass', payload: { v: 'Fighter' }, cost: 0, level: 1, seq: 2, label: 'Fighter' },
  { type: 'buy', cat: 'drawback', payload: { v: 'Lame' }, cost: -3, level: 1, seq: 3, label: 'Drawback — Lame' },
];
await page.evaluate((log) => { window._dmRenderCloudRoster(document.getElementById('campRoster'),
  [{ id: 'c1', name: 'Picker probe', ap: 0, player: 'Player', playerLabel: '', dmNotes: '', stats: { LOG: log } }]); }, LOG);

// The card's "DM tools" section is collapsed until a DM opens it, so open it the way a DM would (a button inside a collapsed
// section cannot take focus, which is what the focus-return check below needs).
// Open every collapsed ancestor of the button (the section, and the roster card's awards/detail wrapper) so it is really visible.
await page.evaluate(() => {
  // The campaign section is hidden until a DM signs in; this test renders the roster directly, so show it.
  const cs = document.getElementById('campSection'); if (cs) cs.style.display = 'block';
  let n = document.querySelector('#campRoster .dm-impose-draw-open');
  while (n && n.id !== 'campRoster') { if (n.classList && (n.classList.contains('sec') || n.classList.contains('card'))) n.classList.add('open'); n = n.parentElement; }
});
const openerVisible = await page.evaluate(() => document.querySelector('#campRoster .dm-impose-draw-open').offsetParent !== null);
const hiddenBy = openerVisible ? '' : await page.evaluate(() => { let n = document.querySelector('#campRoster .dm-impose-draw-open'); while (n) { if (getComputedStyle(n).display === 'none') return n.tagName + '.' + n.className + '#' + n.id; n = n.parentElement; } return 'nothing'; });
check('CONTROL: the opener is really visible once its sections are open (so the focus check below can mean something)', openerVisible, hiddenBy);
const isOpen = () => page.evaluate(() => { const o = document.getElementById('dmDrawPick'); return !!(o && o.classList.contains('on')); });
const detail = () => page.evaluate(() => (document.getElementById('dpDetail') || {}).textContent || '');
const pickItem = (n) => page.evaluate((name) => { [...document.querySelectorAll('#dmDrawPick .dp-item')].find(b => b.getAttribute('data-name') === name).click(); }, n);
const openIt = () => page.evaluate(() => document.querySelector('#campRoster .dm-impose-draw-open').click());

// ---- 1. the card -----------------------------------------------------------------------------------------------------
console.log('The card');
const card = await page.evaluate(() => {
  const o = document.querySelector('#campRoster .dm-impose-draw-open');
  const hid = document.querySelector('#campRoster .dm-impose-draw-hidden');
  return { opener: !!o, held: o && JSON.parse(o.getAttribute('data-held') || '[]'),
    controls: ['.dm-impose-draw-sel', '.dm-impose-draw-locked', '.dm-impose-draw-rate', '.dm-impose-draw-btn'].every(s => !!document.querySelector('#campRoster ' + s)),
    hiddenOk: !!(hid && hid.style.display === 'none' && hid.contains(document.querySelector('#campRoster .dm-impose-draw-btn'))) };
});
check('the card has a "Choose a drawback…" button', card.opener);
check('it carries the drawbacks this character already holds (Lame)', card.held && card.held.includes('Lame'), JSON.stringify(card.held));
check('the old select / Locked / rate / Impose controls are still in the DOM, hidden', card.controls && card.hiddenOk);
check('the window is closed until the button is clicked', !(await isOpen()));

// ---- 2. the list -----------------------------------------------------------------------------------------------------
console.log('The list');
await openIt();
check('clicking the button opens the window', await isOpen());
const list = await page.evaluate(() => {
  const dlg = document.querySelector('#dmDrawPick [role="dialog"]');
  const groups = [...document.querySelectorAll('#dmDrawPick .dp-group')].map(g => ({ label: g.querySelector('.dp-grp').textContent, names: [...g.querySelectorAll('.dp-item')].map(i => i.getAttribute('data-name')) }));
  return { dialog: !!(dlg && dlg.getAttribute('aria-modal') === 'true'), groups, all: groups.flatMap(g => g.names), total: Object.keys(window.DATA.drawbacks).length,
    focusSearch: document.activeElement && document.activeElement.id === 'dpSearch', impose: document.getElementById('dpImpose').disabled };
});
check('it is a real dialog (role=dialog, aria-modal) and focus lands in the search box', list.dialog && list.focusSearch);
check('three groups, wounds first', JSON.stringify(list.groups.map(g => g.label)) === JSON.stringify(['Wounds — minor', 'Wounds — moderate', 'Other drawbacks']), JSON.stringify(list.groups.map(g => g.label)));
check('every drawback is listed exactly once', list.all.length === list.total && new Set(list.all).size === list.total, `${list.all.length} items / ${list.total} drawbacks`);
const dmOnly = await page.evaluate(() => Object.keys(window.DATA.wounds).filter(n => window.DATA.wounds[n].dmOnly));
check('CONTROL: the wound-only list has the 19 entries (so the two checks around it are not vacuous)', dmOnly.length === 19, `${dmOnly.length}`);
check('all 19 wound-only entries are present, in the wound groups', dmOnly.every(n => list.groups[0].names.concat(list.groups[1].names).includes(n)));
check('Impose is disabled until something is chosen', list.impose === true);
// (moved here from wounds-ui-e2e when the dropdown became this picker)
check('the Grievous drawbacks stay in "Other drawbacks" (Missing Arm, Glass Frame, Slow to Mend, Mute)', ['Missing Arm', 'Glass Frame', 'Slow to Mend', 'Mute'].every(n => list.groups[2].names.includes(n)));
check('Withered Arm and Peg Leg are under moderate wounds, Bad Knee under minor', list.groups[1].names.includes('Withered Arm') && list.groups[1].names.includes('Peg Leg') && list.groups[0].names.includes('Bad Knee'));
check('none of the wound-only entries is in "Other drawbacks"', dmOnly.every(n => !list.groups[2].names.includes(n)));
check('the page behind the window is inert while it is open (a screen reader / Tab cannot reach it)', await page.evaluate(() => !!document.getElementById('campSection').closest('[inert]')));
await page.fill('#dpSearch', 'peg');
const s1 = await page.evaluate(() => ({ shown: [...document.querySelectorAll('#dmDrawPick .dp-item')].filter(i => !i.hidden).map(i => i.getAttribute('data-name')),
  groupsShown: [...document.querySelectorAll('#dmDrawPick .dp-group')].filter(g => !g.hidden).length }));
check('searching "peg" leaves only Peg Leg, and hides the groups that emptied', JSON.stringify(s1.shown) === JSON.stringify(['Peg Leg']) && s1.groupsShown === 1, JSON.stringify(s1));
await pickItem('Peg Leg');
await page.fill('#dpSearch', 'knee');
const s1b = await page.evaluate(() => ({ shown: [...document.querySelectorAll('#dmDrawPick .dp-item')].filter(i => !i.hidden).map(i => i.getAttribute('data-name')),
  btn: document.getElementById('dpImposeLbl').textContent }));
check('a chosen drawback stays listed when a search would hide it (so the pane and button never describe something out of sight)',
  s1b.shown.includes('Peg Leg') && s1b.shown.includes('Bad Knee') && s1b.btn === 'Impose Peg Leg', JSON.stringify(s1b));
await page.fill('#dpSearch', '');
await pickItem('Withered Arm');   // leave a clean selection for the next section
await page.fill('#dpSearch', '');
const s2 = await page.evaluate(() => [...document.querySelectorAll('#dmDrawPick .dp-item')].filter(i => !i.hidden).length);
check('clearing the search restores the full list', s2 === list.total, `${s2}`);

// ---- 3. the detail pane ----------------------------------------------------------------------------------------------
console.log('The detail pane');
await pickItem('Withered Arm');
const wa = await page.evaluate(() => ({ text: document.getElementById('dpDetail').textContent, fx: window.DATA.drawbackFx['Withered Arm'], ap: window.DATA.drawbacks['Withered Arm'],
  locked: document.getElementById('dpLocked').checked, rate: document.getElementById('dpRate').value, label: document.getElementById('dpImposeLbl').textContent, off: document.getElementById('dpImpose').disabled }));
check('shows the engine\'s own effect text for the wound', wa.text.includes(wa.fx), wa.fx);
check('shows tier, place and that only a DM can impose it', /Wound — moderate/.test(wa.text) && /Place: arm/.test(wa.text) && /Only a DM can impose this/.test(wa.text));
check('shows the buy-off cost, flat and tripled, and that it pays 0 AP', wa.text.includes(`${wa.ap} AP (flat)`) && wa.text.includes(`${wa.ap * 3} AP (expensive`) && /pays 0 AP/.test(wa.text), wa.text.slice(0, 300));
check('choosing a wound defaults Locked + flat', wa.locked === true && wa.rate === 'flat');
check('the button names what it will impose and is enabled', wa.label === 'Impose Withered Arm' && wa.off === false, wa.label);
check('CONTROL: no clash warning for an arm wound on a character with only a leg wound', !/same place|already has/.test(wa.text));

await pickItem('Crushed Leg');
const cl = await detail();
check('an alias says which wound it repeats, and that players can take the original (Crushed Leg = Lame)', /Same effect as Lame/.test(cl) && /players can also take/.test(cl), cl.slice(0, 220));
await pickItem('Shattered Hand');
const sh = await detail();
check('...and when the original is DM-only too it says so (Shattered Hand = Maimed Hand)', /Same effect as Maimed Hand/.test(sh) && /also DM-only/.test(sh), sh.slice(0, 220));
await pickItem('Addled Memory');
check('CONTROL: a wound with its own mechanics has no "same effect" line', !/Same effect as/.test(await detail()));
await pickItem('Peg Leg');
const pl = await detail();
check('Peg Leg: warns the character already has Lame in the same place (leg)', /Already has\s*Lame\s*in the same place \(leg\)/.test(pl), pl.slice(-200));
check('Peg Leg: says its normal stat cap is not applied when imposed', /DEX/.test(pl) && /not applied/.test(pl));
await pickItem('Lame');
const lm = await detail();
check('Lame: warns this character already has Lame (a second copy)', /already has Lame/.test(lm) && /second copy/.test(lm), lm.slice(-200));
await pickItem('Mana Leak');
const ml = await detail();
check('a caster-only drawback shows the spellcasting warning', /spellcasting discipline/.test(ml));
check('CONTROL: an ordinary drawback has no wound badge and no clash text', /Ordinary drawback/.test(ml) && !/Wound —/.test(ml) && !/same place/.test(ml));

// ---- 4. defaults: moving between wounds -------------------------------------------------------------------------------
console.log('Defaults');
await page.evaluate(() => { document.getElementById('dpLocked').checked = false; document.getElementById('dpRate').value = 'expensive'; });
await pickItem('Bad Knee');   // ordinary drawback -> wound: defaults apply
const toWound = await page.evaluate(() => ({ l: document.getElementById('dpLocked').checked, r: document.getElementById('dpRate').value }));
check('moving from an ordinary drawback to a wound re-applies Locked + flat', toWound.l === true && toWound.r === 'flat', JSON.stringify(toWound));
await page.evaluate(() => { document.getElementById('dpLocked').checked = false; document.getElementById('dpRate').value = 'expensive'; });
await pickItem('Withered Arm');   // wound -> wound: leave the DM's changes alone
const between = await page.evaluate(() => ({ l: document.getElementById('dpLocked').checked, r: document.getElementById('dpRate').value }));
check('moving from one wound to another leaves what the DM changed alone', between.l === false && between.r === 'expensive', JSON.stringify(between));

// ---- 5. closing sends nothing -----------------------------------------------------------------------------------------
console.log('Closing');
await page.keyboard.press('Escape');
check('Escape closes it', !(await isOpen()));
const focusNow = await page.evaluate(() => { const a = document.activeElement; return { ok: !!(a && a.classList.contains('dm-impose-draw-open')), what: a ? a.tagName + '.' + a.className + '#' + a.id : 'none',
  vis: (() => { const o = document.querySelector('#campRoster .dm-impose-draw-open'); return o ? o.offsetParent !== null : 'missing'; })() }; });
check('...and returns focus to the button that opened it', focusNow.ok, JSON.stringify(focusNow));
await openIt();
await pickItem('Bad Knee');
await page.click('#dpCancel');
check('Cancel closes it', !(await isOpen()));
check('closing without Impose sent nothing', (await page.evaluate(() => window.__calls.length)) === 0);

// ---- 6. Impose --------------------------------------------------------------------------------------------------------
console.log('Impose');
await openIt();
await pickItem('Bad Knee');
await page.evaluate(() => { document.getElementById('dpRate').value = 'expensive'; });   // Locked stays at the wound default (ticked); both differ from the card's own (unticked, flat)
await page.click('#dpImpose');
await page.waitForFunction(() => window.__calls.length === 1, { timeout: 5000 });
const sent = await page.evaluate(() => window.__calls[0]);
const ev = sent && sent.events && sent.events[0];
check('Impose sends one drawback purchase for the chosen wound at cost 0', sent.events.length === 1 && ev.type === 'buy' && ev.cat === 'drawback' && ev.payload.v === 'Bad Knee' && ev.cost === 0, JSON.stringify(ev));
check('...carrying the window\'s choices (Locked, expensive removal — both differ from the card\'s own defaults)', ev.dmLocked === true && ev.dmRemovalCost === 'expensive', JSON.stringify(ev));
check('...to the right character', sent.id === 'c1');
check('the window closes once it has sent', !(await isOpen()));
check('no alert fired (nothing failed)', (await page.evaluate(() => window.__alerts.length)) === 0);
// The page disables Impose while a send is in flight and re-renders the roster afterwards; the reload is stubbed here, so
// re-enable it by hand (as the real re-render would) before the second send.
await page.evaluate(() => { document.querySelector('#campRoster .dm-impose-draw-btn').disabled = false; });
await openIt();
await pickItem('Withered Arm');
await page.click('#dpImpose');
await page.waitForFunction(() => window.__calls.length === 2, { timeout: 5000 });
const ev2 = await page.evaluate(() => window.__calls[1].events[0]);
check('a second impose defaults to Locked + flat for a fresh wound pick', ev2.payload.v === 'Withered Arm' && ev2.dmLocked === true && ev2.dmRemovalCost === 'flat', JSON.stringify(ev2));

// A third send with Locked explicitly UNticked: the card's last state was (ticked, flat), so this differs on both settings.
await page.evaluate(() => { document.querySelector('#campRoster .dm-impose-draw-btn').disabled = false; });
await openIt();
await pickItem('Maimed Hand');
await page.evaluate(() => { document.getElementById('dpLocked').checked = false; document.getElementById('dpRate').value = 'expensive'; });
await page.click('#dpImpose');
await page.waitForFunction(() => window.__calls.length === 3, { timeout: 5000 });
const ev3 = await page.evaluate(() => window.__calls[2].events[0]);
check('an explicitly UNticked Locked and expensive removal are what get sent', ev3.payload.v === 'Maimed Hand' && ev3.dmLocked === false && ev3.dmRemovalCost === 'expensive', JSON.stringify(ev3));

check('the page behind is no longer inert once the window has closed', await page.evaluate(() => !document.getElementById('campSection').closest('[inert]')));
check('with no "how it happened" text the label is exactly as before (no stray suffix)',
  (await page.evaluate(() => window.__calls[0].events[0].label)) === 'Drawback — Bad Knee (DM imposed)');

// ---- 7. the optional "how it happened" text (K1) ----------------------------------------------------------------------
console.log('How it happened');
await page.evaluate(() => { document.querySelector('#campRoster .dm-impose-draw-btn').disabled = false; });
await openIt();
await pickItem('Bad Knee');
await page.fill('#dpFlavor', '  crushed   by a\n collapsing gantry <b>x</b> ' + 'z'.repeat(120));
await page.click('#dpImpose');
await page.waitForFunction(() => window.__calls.length === 4, { timeout: 5000 });
const lab4 = await page.evaluate(() => window.__calls[3].events[0]);
const suffix = (lab4.label.split('(DM imposed): ')[1]) || '';
check('the text is appended to the label after "(DM imposed): "', lab4.label.startsWith('Drawback — Bad Knee (DM imposed): crushed by a collapsing gantry <b>x</b>'), lab4.label);
check('...whitespace collapsed to single spaces and trimmed, and no longer than 80 characters (the input\'s own maxlength trims first)', suffix.length > 60 && suffix.length <= 80 && !/\s{2}/.test(suffix) && suffix === suffix.trim(), `${suffix.length}`);
// The send handler's own 80-character cap, independent of the input's maxlength: put a 200-character note straight into the
// hidden field (as a re-rendered or scripted page could) and send.
await page.evaluate(() => { const c = document.querySelector('#campRoster .dm-impose-draw-btn').getAttribute('data-cid');
  document.querySelector('#campRoster .dm-impose-draw-btn').disabled = false;
  document.querySelector('#campRoster .dm-impose-draw-sel[data-cid="' + c + '"]').value = 'Bad Knee';
  document.querySelector('#campRoster .dm-impose-draw-note[data-cid="' + c + '"]').value = 'q'.repeat(200);
  document.querySelector('#campRoster .dm-impose-draw-btn').click(); });
await page.waitForFunction(() => window.__calls.length === 5, { timeout: 5000 });
const capped = await page.evaluate(() => window.__calls[4].events[0].label.split('(DM imposed): ')[1] || '');
check('the send handler itself caps the text at 80 characters', capped.length === 80, `${capped.length}`);
check('...the real drawback name is still the payload, so buy-off matches by the drawback and not the text', lab4.payload.v === 'Bad Knee' && lab4.cost === 0);
check('...and it travels as an ordinary event (the same keys as before, plus nothing new)',
  JSON.stringify(Object.keys(lab4).sort()) === JSON.stringify(Object.keys(await page.evaluate(() => window.__calls[0].events[0])).sort()));

// ---- 8. a send that cannot happen says so, and keeps the window open ---------------------------------------------------
console.log('Failure handling');
await page.evaluate(() => { document.querySelector('#campRoster .dm-impose-draw-btn').disabled = true; });
await openIt();
await pickItem('Lame');
await page.click('#dpImpose');
const dis = await page.evaluate(() => ({ open: document.getElementById('dmDrawPick').classList.contains('on'), msg: document.getElementById('dpMsg').textContent, calls: window.__calls.length, sel: document.getElementById('dpImposeLbl').textContent }));
check('while the previous impose is still being sent: the window stays open, says why, and sends nothing', dis.open && /still being sent/.test(dis.msg) && dis.calls === 5, JSON.stringify(dis));
check('...and keeps the DM\'s choice', dis.sel === 'Impose Lame');
await page.evaluate(() => { document.querySelector('#campRoster .dm-impose-draw-btn').disabled = false; });
await page.click('#dpImpose');
await page.waitForFunction(() => window.__calls.length === 6, { timeout: 5000 });
check('once the button is free the same click sends it', (await page.evaluate(() => window.__calls[5].events[0].payload.v)) === 'Lame');

await page.evaluate(() => { document.querySelector('#campRoster .dm-impose-draw-btn').disabled = false; });
await openIt();
await pickItem('Bad Knee');
await page.evaluate(() => { document.querySelector('#campRoster .dm-impose-draw-hidden').remove(); });   // as if the roster re-rendered under the window
await page.click('#dpImpose');
const gone = await page.evaluate(() => ({ open: document.getElementById('dmDrawPick').classList.contains('on'), msg: document.getElementById('dpMsg').textContent, calls: window.__calls.length }));
check('if the card was refreshed under the window: it stays open, says so, and sends nothing', gone.open && /refreshed/.test(gone.msg) && gone.calls === 6, JSON.stringify(gone));
await page.click('#dpCancel');
check('Cancel still closes it and releases the page', !(await isOpen()) && (await page.evaluate(() => !document.getElementById('campSection').closest('[inert]'))));

// ---- 9. the player's side: the text is shown, and markup in it is inert ----------------------------------------------------
console.log('The player\'s Live Sheet');
{
  const lctx = await browser.newContext();
  const lp = await lctx.newPage();
  const lerrs = []; lp.on('pageerror', e => lerrs.push(String(e)));
  const NOTE = 'crushed by a gantry <img src=x onerror="window.__xss=1"> <b>bold</b>';
  const LLOG = [
    { type: 'award', amount: 79, seq: 1, label: 'Award' },
    { type: 'buy', cat: 'oclass', payload: { v: 'Fighter' }, cost: 0, level: 1, seq: 2, label: 'Fighter' },
    { type: 'buy', cat: 'drawback', payload: { v: 'Bad Knee' }, cost: 0, level: 1, seq: 3, dmEdit: true, dmId: 'dm', dmLocked: true, dmRemovalCost: 'flat',
      label: 'Drawback — Bad Knee (DM imposed): ' + NOTE },
  ];
  await lp.addInitScript((env) => { try { localStorage.setItem('pactLiveSheet', JSON.stringify(env)); } catch (e) {} },
    { schema: 'pact-character/1', LOG: LLOG, SEQ: LLOG.length + 1 });
  await lp.goto(`http://localhost:${PORT}/PACT/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' });
  await lp.waitForFunction(() => window.DATA && window._engineFold && document.body && document.body.textContent.length > 2000, { timeout: 25000 });
  // The history/ledger is drawn on demand; try the common ways a player would open it.
  await lp.evaluate(() => { try { if (typeof showLog === 'function') showLog(); } catch (e) {} try { document.querySelectorAll('[onclick*="og"], #logBtn, [data-tab="log"]').forEach(b => b.click && b.click()); } catch (e) {} });
  await lp.waitForTimeout(500);
  const seen = await lp.evaluate(() => ({ text: document.body.textContent.includes('crushed by a gantry'), img: !!document.querySelector('img[src="x"]'),
    xss: window.__xss === 1, rawTag: document.body.innerHTML.includes('<img src="x" onerror') }));
  check('the DM\'s "how it happened" text is shown to the player (CONTROL — otherwise the safety checks below prove nothing)', seen.text, JSON.stringify(seen));
  check('markup inside it is NOT parsed: no <img> was created and no script ran', !seen.img && !seen.xss && !seen.rawTag, JSON.stringify(seen));
  check('no page errors on the Live Sheet', lerrs.length === 0, lerrs.join(' | '));
  await lctx.close();

  // The same character opened in CharGen: whatever it draws from the label must not turn the markup into elements either.
  const cctx = await browser.newContext();
  const cp = await cctx.newPage();
  const cerrs = []; cp.on('pageerror', e => cerrs.push(String(e)));
  await cp.goto(`http://localhost:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' });
  await cp.waitForFunction(() => window.DATA && typeof window._cgApplyEnvelope === 'function', { timeout: 25000 });
  await cp.evaluate((log) => { window._cgApplyEnvelope({ schema: 'pact-character/1', rules: window.DATA.version, name: 'Wounded', LOG: log, SEQ: log.length + 1,
    id: '11111111-2222-3333-4444-555555555555' }, { clearHistory: true }); }, LLOG);
  await cp.waitForTimeout(500);
  const cseen = await cp.evaluate(() => ({ img: !!document.querySelector('img[src="x"]'), xss: window.__xss === 1, rawTag: document.body.innerHTML.includes('<img src="x" onerror') }));
  check('CharGen: markup in the text is NOT parsed there either', !cseen.img && !cseen.xss && !cseen.rawTag, JSON.stringify(cseen));
  check('no page errors on CharGen', cerrs.length === 0, cerrs.join(' | '));
  await cctx.close();
}

check('no page errors', errs.filter(e => !/Failed to load resource|net::|supabase|fetch|NetworkError|Load failed/i.test(e)).length === 0, errs.join(' | '));
await ctx.close();
await browser.close();
server.close();
console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} passed / ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
