/* PACT — DM Console: the campaign "Character house rules" editor (feat/campaign-house-rules-dm-editor, PR4 of
 * D-GH-2026-10-13-campaign-house-rules).
 *
 * Proves, in the real console:
 *   1. S2 — repricing a drawback characters hold lists every holder with old -> new and AP left before -> after; a
 *      ticked holder gets a dmRepriceDrawback (from / to / amount the server checks), an unticked one a pin in its
 *      override snapshot (its existing override kept), a draft holder is listed but not tickable and gets nothing,
 *      and the whole change is ONE dm_apply_house_rules_change call. AP left after a tick updates live.
 *   2. T2 — "Also remove from characters who own it": a paid boon is refunded, a DM-granted boon (the oldest copy) is
 *      removed without refund through dm_edit_character_log, a drawback's grant is taken back, a second copy's
 *      removal is labelled as moving 0, a character pushed below 0 AP is shown below 0 (V1, not refused), and the
 *      gold/downtime note shows. Unticked, owners keep what they own (the dialog says so) and nothing is removed.
 *   3. The player tools then show the new values: the ticked holder's AP left in the Live Sheet, CharGen and the
 *      DM Console roster equals the preview's "after", and equals the server-ledger model (serverApLedger) — browser
 *      and server agree; the pinned holder is unchanged.
 *   4. An un-migrated server: the section says so in plain words (probe on open) and Save explains instead of erroring.
 *   5. The generic "Save rules" never sends charHouseRules and keeps the cached copy.
 *   6. DM-typed names are escaped everywhere (editor, review dialog, grant-boon picker); the grant-boon / impose-drawback
 *      pickers use the effective tables (campaign custom items, effective prices) and a grant records the effective cost.
 *
 * No Supabase: the bridge calls go to a small stateful fake server in this script (page.exposeFunction) that stamps
 * events the way the RPC does and checks a reprice's from / to / amount against the engine. The SQL itself is
 * rehearsed by testing/scripts/creation-lock-guard-test/run-house-rules.sh.
 *
 *   node testing/scripts/dm-campaign-house-rules-e2e.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';
import { createHouseRulesHarness } from './lib/house-rules-fake-server.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const E = await import(path.join(REPO, 'js/engine.js'));
const CR = await import(path.join(REPO, 'js/campaign-rules.js'));
const PORT = Number(process.env.PACT_E2E_PORT) || 7966;
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
const NOISE = /Failed to load resource|net::|supabase|fetch|NetworkError|Load failed|ERR_/i;

// ---- the campaign and its characters ------------------------------------------------------------------------------
const CAMP = '0c000000-0000-4000-8000-000000000001';
const XSS = '<img src=x onerror="window.__xss=1">Moon';
const CHR0 = { schema: 1, draws: { 'Moon-Hexed': { ap: 3, fx: 'Howls at the full moon' } }, boons: { 'Star Ward': { hd: 1, ap: 4, fx: 'A ward of stars' } } };
const RULES0 = { bannedBoons: [], bannedDrawbacks: [], charHouseRules: CHR0, dmNotes: 'keep me' };
const id = n => `0c000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const base = (award) => [
  { type: 'award', amount: award, seq: 1, label: 'Award' },
  { type: 'buy', cat: 'oclass', payload: { v: 'Fighter' }, cost: 0, level: 1, seq: 2, label: 'Fighter' },
];
const draw = (seq, v, cost) => ({ type: 'buy', cat: 'drawback', payload: { v }, cost, level: 1, seq, label: 'Drawback — ' + v });
const boon = (seq, v, cost, extra) => Object.assign({ type: 'buy', cat: 'boon', payload: { v }, cost, level: 1, seq, label: 'Boon — ' + v }, extra || {});
const lock = seq => ({ type: 'creationLocked', seq, ts: 1 });
// Ana: finished, holds Moon-Hexed (3) — will be TICKED.
const ANA = base(20).concat([draw(3, 'Moon-Hexed', -3), { type: 'buy', cat: 'skill', payload: { v: 'Athletics' }, cost: 3, level: 1, seq: 4, label: 'Skill' }, lock(5)]);
// Cy: finished, holds Moon-Hexed and already has a DM override for this campaign — left UNTICKED (pinned; override kept).
const CY_OV = { boons: { 'Star Ward': { hd: 1, ap: 2 } } };
const CY = base(10).concat([draw(3, 'Moon-Hexed', -3), lock(4),
  { type: 'dmHouseRules', overrides: CY_OV, campaignId: CAMP, seq: 5, ts: 2, dmEdit: true, dmId: 'dm', label: 'DM house rules' }]);
// Bo: still a draft, holds Moon-Hexed — listed, not tickable, nothing sent.
const BO = base(10).concat([draw(3, 'Moon-Hexed', -3)]);
// Xi: XSS-named character, finished, holds the XSS-named campaign drawback and two paid boons + a DM grant + two copies of a drawback.
const XI = base(30).concat([
  draw(3, XSS, -1),
  boon(4, 'Star Ward', 4),
  boon(5, 'Star Ward', 4, { dmEdit: true, dmId: 'dm' }), { type: 'award', amount: 4, seq: 6, dmEdit: true, dmId: 'dm', label: 'Award — DM boon grant' },
  draw(7, 'Asthmatic', -2), draw(8, 'Asthmatic', -2),
  lock(9)]);
// Neg: finished, spent most of what its drawback gave — taking the grant back drives it below 0.
const NEG = base(0).concat([draw(3, 'Moon-Hexed', -3), { type: 'buy', cat: 'skill', payload: { v: 'Stealth' }, cost: 3, level: 1, seq: 4, label: 'Skill' }, lock(5)]);
const CHARS0 = [
  { id: id(1), name: 'Ana', ap: 0, LOG: ANA },
  { id: id(2), name: 'Bo', ap: 0, LOG: BO },
  { id: id(3), name: 'Cy', ap: 0, LOG: CY },
  { id: id(4), name: '<b onmouseover="window.__xss=1">Xi</b>', ap: 0, LOG: XI },
  { id: id(5), name: 'Neg', ap: 0, LOG: NEG },
];

const browser = await launchChromium();
// The fake server (RPC stamping + M3 checks) and the page wiring are shared with dm-house-rules-e2e.mjs; --dump-calls <file>
// writes the calls this console really sent for run-dm-house-rules-replay.sh to replay against the real migration.
const HR = createHouseRulesHarness({ E, CR, CAMP, RULES0, CHARS0, browser, PORT });
const { srv, nextSeq, reset, openDm, applyCalls, serverApLeft } = HR;
const browserApLeft = (log, rules) => HR.browserApLeft(log, rules, 0);
const unlock = p => p.evaluate(() => { if (document.getElementById('ruleMultiDisc').disabled) document.getElementById('ruleLockBtn').click(); });
const setAp = (p, kind, name, ap) => p.evaluate(({ kind, name, ap }) => {
  const row = [...document.querySelectorAll('#chrTable .chr-row')].find(r => r.getAttribute('data-kind') === kind && r.getAttribute('data-name') === name);
  const inp = row && row.querySelector('.chr-ap'); if (!inp) return false;
  inp.value = String(ap); inp.dispatchEvent(new Event('input', { bubbles: true })); return true;
}, { kind, name, ap });
const reviewOpen = p => p.waitForFunction(() => { const o = document.getElementById('chrReview'); return o && o.classList.contains('on'); }, { timeout: 8000 });
const clickSave = p => p.evaluate(() => document.getElementById('chrSaveBtn').click());

// ======================================================================================================================
console.log('The editor renders the campaign\'s rules, escaped');
reset();
let { c: ctx, p, errs } = await openDm();
{
  const r = await p.evaluate(() => ({
    rows: [...document.querySelectorAll('#chrTable .chr-row')].map(x => x.getAttribute('data-kind') + ':' + x.getAttribute('data-name')),
    calls: [...document.querySelectorAll('#chrCalls .chr-call')].map(x => x.getAttribute('data-key') + '=' + x.checked),
    locked: document.getElementById('chrSaveBtn').disabled,
  }));
  check('the custom boon and drawback are listed', r.rows.includes('boon:Star Ward') && r.rows.includes('draw:Moon-Hexed'), JSON.stringify(r.rows));
  check('the four DM Calls are shown, all on', r.calls.length === 4 && r.calls.every(x => x.endsWith('=true')), JSON.stringify(r.calls));
  check('the section starts locked with the rest of Campaign Rules', r.locked);
  await unlock(p);
  check('...and unlocks with the shared rules lock', !(await p.evaluate(() => document.getElementById('chrSaveBtn').disabled)));
  // add an XSS-named custom drawback through the add row
  await p.evaluate((x) => {
    document.getElementById('chrAddKind').value = 'draw'; document.getElementById('chrAddName').value = x;
    document.getElementById('chrAddAp').value = '1'; document.getElementById('chrAddFx').value = '<b>bold</b>';
    document.getElementById('chrAddBtn').click();
  }, XSS);
  const x = await p.evaluate((x) => ({ listed: !!document.querySelector('#chrTable .chr-row[data-kind="draw"]') && [...document.querySelectorAll('#chrTable .chr-row')].some(r => r.getAttribute('data-name') === x),
    img: document.querySelectorAll('#chrTable img').length, xss: !!window.__xss, status: document.getElementById('chrSaveStatus').textContent }), XSS);
  check('a DM-typed XSS name is added and shown as text (no element, nothing ran)', x.listed && x.img === 0 && !x.xss, JSON.stringify(x));
  check('the status says there are unsaved changes', /unsaved/i.test(x.status), x.status);
  // a bad value is refused before anything is sent
  await setAp(p, 'draw', 'Moon-Hexed', '');
  await clickSave(p); await p.waitForTimeout(150);
  check('a blank AP is refused in plain words and nothing is sent',
    applyCalls().length === 0 && (await p.evaluate(() => window.__alerts.some(m => /whole number from 0 to 1000/.test(m)))));
}

// ======================================================================================================================
console.log('S2 — repricing a held drawback: tick / untick, one RPC call');
{
  // Save the XSS custom drawback first? No — keep it in the same change; the review must escape it too. Reprice 3 -> 5.
  await setAp(p, 'draw', 'Moon-Hexed', 5);
  srv.calls.length = 0; await p.evaluate(() => { window.__alerts.length = 0; });
  await clickSave(p);
  await reviewOpen(p);
  const d = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('#chrReview .chr-tbl tbody tr')].map(tr => ({ text: tr.textContent, tick: !!tr.querySelector('.chr-tick'), after: (tr.querySelector('.chr-after') || {}).textContent }));
    return { rows, img: document.querySelectorAll('#chrReview img, #chrReview b[onmouseover]').length, xss: !!window.__xss };
  });
  const row = n => d.rows.find(r => r.text.includes(n) && r.text.includes('Moon-Hexed'));
  check('the roster was read fresh for the preview', srv.calls.some(c => c.op === 'roster'));
  check('Ana (finished) is listed with 3 → 5 AP and a tick', row('Ana') && row('Ana').tick && /3 → 5 AP/.test(row('Ana').text), JSON.stringify(row('Ana')));
  check('Cy (finished, has an override) is listed with a tick', row('Cy') && row('Cy').tick);
  check('Bo (still in creation) is listed but NOT tickable, with the reason', row('Bo') && !row('Bo').tick && /creation/i.test(row('Bo').text), JSON.stringify(row('Bo')));
  check('the review escapes every name (no element from a name, nothing ran)', d.img === 0 && !d.xss);
  check('a 0 is shown as 0, not blank (Neg: AP left "0 → 0")', row('Neg') && row('Neg').text.includes('0 → 0'), row('Neg') && row('Neg').text);
  const anaBefore = browserApLeft(ANA, RULES0);
  check(`Ana's AP left shows ${anaBefore} → ${anaBefore} while unticked (keeps the old value)`, row('Ana') && row('Ana').text.includes(`${anaBefore} → ${anaBefore}`), row('Ana') && row('Ana').text);
  // tick Ana
  await p.evaluate(() => { const t = [...document.querySelectorAll('#chrReview .chr-tick')].find(x => x.closest('tr').textContent.includes('Ana')); t.click(); });
  const afterTxt = await p.evaluate(() => [...document.querySelectorAll('#chrReview tr')].find(tr => tr.textContent.includes('Ana')).querySelector('.chr-after').textContent);
  check(`ticking Ana updates her AP left after to ${anaBefore + 2}`, afterTxt === String(anaBefore + 2), afterTxt);
  await p.evaluate(() => document.getElementById('chrReviewApply').click());
  await p.waitForFunction(() => /Saved/.test(document.getElementById('chrSaveStatus').textContent) || window.__alerts.length > 1, { timeout: 8000 });
  const calls = applyCalls();
  check('exactly ONE dm_apply_house_rules_change call', calls.length === 1, String(calls.length));
  const call = calls[0] && calls[0].a;
  check('...carrying the new campaign rules (Moon-Hexed 5, the XSS drawback, schema 1)',
    call && call.chr && call.chr.schema === 1 && call.chr.draws['Moon-Hexed'].ap === 5 && call.chr.draws[XSS] && call.chr.draws[XSS].ap === 1, JSON.stringify(call && call.chr));
  const acts = (call && call.actions) || [];
  const ana = acts.filter(a => a.character === id(1)), cy = acts.filter(a => a.character === id(3)), bo = acts.filter(a => a.character === id(2));
  check('Ana: one reprice {targetSeq 3, from 3, to 5, amount +2}', ana.length === 1 && ana[0].kind === 'reprice' && ana[0].targetSeq === 3 && ana[0].from === 3 && ana[0].to === 5 && ana[0].amount === 2, JSON.stringify(ana));
  check('Cy: one override snapshot pinning Moon-Hexed at 3 AND keeping its existing override',
    cy.length === 1 && cy[0].kind === 'override' && cy[0].overrides.pins.draws['Moon-Hexed'].ap === 3 && cy[0].overrides.boons['Star Ward'].ap === 2, JSON.stringify(cy));
  check('Bo (draft): nothing sent', bo.length === 0, JSON.stringify(bo));
  check('the call carries the rules this save was previewed against (expected = the stored rules)', call && call.expected && JSON.stringify(call.expected.charHouseRules) === JSON.stringify(CHR0), JSON.stringify(call && call.expected));
  check('...and Cy\'s override action the snapshot it was built from (expected = his existing override)', cy[0] && JSON.stringify(cy[0].expected) === JSON.stringify(CY_OV), JSON.stringify(cy[0] && cy[0].expected));
  check('the server accepted it (from/to/amount checked against the engine)', !(await p.evaluate(() => window.__alerts.some(m => /not saved/i.test(m)))), JSON.stringify(await p.evaluate(() => window.__alerts)));
  check('no generic rules save was made', !srv.calls.some(c => c.op === 'setRules'));
  const cached = await p.evaluate(() => window._dmCampaignApRules.rules.charHouseRules);
  check('the console\'s cached campaign rules now carry the new values', cached && cached.draws['Moon-Hexed'].ap === 5, JSON.stringify(cached && cached.draws));
}

// ---- 3. the player tools then show the new values -----------------------------------------------------------------
console.log('After S2: the player tools, the roster and the server agree');
{
  const ana2 = srv.chars.find(c => c.id === id(1)).LOG, cy2 = srv.chars.find(c => c.id === id(3)).LOG;
  const bAna = browserApLeft(ana2, srv.rules), sAna = serverApLeft(ana2, srv.rules);
  const bAna0 = browserApLeft(ANA, RULES0);
  check(`Ana: browser AP left ${bAna} = server ledger ${sAna} = before + 2`, bAna === sAna && bAna === bAna0 + 2, `${bAna0} -> ${bAna} / ${sAna}`);
  const bCy = browserApLeft(cy2, srv.rules), sCy = serverApLeft(cy2, srv.rules), bCy0 = browserApLeft(CY, RULES0);
  check(`Cy (pinned): browser AP left unchanged (${bCy0}) and = server ledger`, bCy === bCy0 && bCy === sCy, `${bCy} / ${sCy}`);
  // DM Console roster card
  await p.evaluate(() => window._dmReloadRoster && window._dmReloadRoster());
  await p.waitForFunction(() => document.querySelectorAll('#campRoster .card').length >= 4, { timeout: 8000 }).catch(() => {});
  const card = await p.evaluate((nm) => {
    const c = [...document.querySelectorAll('#campRoster .card')].find(x => x.textContent.includes(nm));
    const st = c && [...c.querySelectorAll('.stat')].find(s => s.querySelector('.k') && s.querySelector('.k').textContent === 'AP');
    return st ? Number(st.querySelector('.v').textContent.split(' / ')[0]) : null;
  }, 'Ana');
  check(`DM Console roster: Ana's AP left = ${bAna}`, card === bAna, String(card));
  // Live Sheet
  const lc = await browser.newContext(); const lp = await lc.newPage(); const lerrs = []; lp.on('pageerror', e => lerrs.push(String(e)));
  await lp.addInitScript((e) => { try { localStorage.setItem('pactLiveSheet', JSON.stringify(e)); } catch (x) {} },
    { schema: 'pact-character/1', LOG: ana2, SEQ: nextSeq(ana2), id: id(1), campaignId: CAMP });
  await lp.goto(`http://localhost:${PORT}/PACT/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' });
  await lp.waitForFunction(() => window.DATA && window._engineFold && document.body.textContent.length > 2000, { timeout: 25000 });
  await lp.waitForTimeout(600);
  const ls = await lp.evaluate((rules) => { window._cloudCampaignRules = rules; window._rulesStatus = 'active'; window._dmAp = 0; window._ignorePlayerAp = false; window.render(); return apAvailable(null); }, srv.rules);
  check(`Live Sheet: Ana's AP left = ${bAna}`, ls === bAna, String(ls));
  check('Live Sheet: no page errors', lerrs.filter(e => !NOISE.test(e)).length === 0, lerrs.join(' | '));
  await lc.close();
  // CharGen
  const gc = await browser.newContext(); const gp = await gc.newPage(); const gerrs = []; gp.on('pageerror', e => gerrs.push(String(e)));
  await gp.goto(`http://localhost:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' });
  await gp.waitForFunction(() => window.DATA && typeof window._cgApplyEnvelope === 'function', { timeout: 25000 });
  await gp.waitForTimeout(600);
  const cg = await gp.evaluate(({ log, cid, camp, rules }) => {
    window._cgApplyEnvelope({ schema: 'pact-character/1', rules: window.DATA.version, name: 'Ana', LOG: log, SEQ: log.length + 10, id: cid }, { clearHistory: true });
    window._cgCampaignId = camp; window._cgCampaignBound = true; window._cgBindingConfirmed = true;
    window._dmApStatus = 'active'; window._dmAp = 0; window._ignorePlayerAp = false;
    window._cloudCampaign = { id: camp, name: 'Camp', rules };
    render();
    return compute(readBuild(), _cgDmOpts()).spendable - economy(LOG).spent;
  }, { log: ana2, cid: id(1), camp: CAMP, rules: srv.rules });
  check(`CharGen: Ana's AP left = ${bAna}`, cg === bAna, String(cg));
  check('CharGen: no page errors', gerrs.filter(e => !NOISE.test(e)).length === 0, gerrs.join(' | '));
  await gc.close();
}
await ctx.close();

// ======================================================================================================================
console.log('T2 — switching Boons off with "Also remove": refund, DM-grant removal, no per-holder skipping');
reset();
({ c: ctx, p, errs } = await openDm());
{
  await unlock(p);
  await p.evaluate(() => { const cb = document.querySelector('#chrCalls .chr-call[data-key="boons"]'); cb.click(); });
  // first WITHOUT "Also remove": owners keep, the dialog says so; then cancel
  await clickSave(p); await reviewOpen(p);
  const kept = await p.evaluate(() => document.getElementById('chrReview').textContent);
  check('unticked T2: the dialog says owners keep what they own and how to take it away', /keep/.test(kept) && /Also remove/.test(kept), kept.slice(0, 200));
  await p.evaluate(() => document.querySelector('#chrReview [data-chr-act="cancel"]').click());
  check('Cancel sends nothing', applyCalls().length === 0);
  await p.evaluate(() => { document.getElementById('chrT2').checked = true; });
  await clickSave(p); await reviewOpen(p);
  const d = await p.evaluate(() => [...document.querySelectorAll('#chrReview .chr-tbl tbody tr')].map(tr => tr.textContent));
  const xiRefund = d.find(t => t.includes('Star Ward') && t.includes('#4'));
  const xiGrant = d.find(t => t.includes('Star Ward') && t.includes('#5'));
  check('Xi\'s paid Star Ward (#4) is refunded +4', xiRefund && /\+4 refunded/.test(xiRefund), xiRefund);
  check('Xi\'s DM-granted Star Ward (#5) is removed without refund', xiGrant && /no refund/.test(xiGrant), xiGrant);
  check('the gold/downtime note is shown for a refund', await p.evaluate(() => /AP only/.test(document.getElementById('chrReview').textContent)));
  await p.evaluate(() => document.getElementById('chrReviewApply').click());
  await p.waitForFunction(() => /Saved/.test(document.getElementById('chrSaveStatus').textContent) || window.__alerts.length > 0, { timeout: 8000 });
  const acts = (applyCalls()[0] || { a: { actions: [] } }).a.actions.filter(a => a.character === id(4));
  check('Xi: one refundBoon at seq 4 in the RPC (the server stamps the amount)', acts.length === 1 && acts[0].kind === 'refundBoon' && acts[0].targetSeq === 4 && !('cost' in acts[0]), JSON.stringify(acts));
  const dme = srv.calls.filter(c => c.op === 'dmEdit');
  check('the DM grant is removed with ONE dm_edit_character_log dmRemoveBoon AFTER the RPC',
    dme.length === 1 && dme[0].a.cid === id(4) && dme[0].a.events.length === 1 && dme[0].a.events[0].type === 'dmRemoveBoon' && dme[0].a.events[0].refVal === 'Star Ward'
    && srv.calls.findIndex(c => c.op === 'dmEdit') > srv.calls.findIndex(c => c.op === 'apply' && c.a.actions.length), JSON.stringify(dme.map(x => x.a)));
  const xi2 = srv.chars.find(c => c.id === id(4)).LOG, b2 = E.foldBuild(xi2);
  check('...and both Star Wards are gone from Xi\'s build', !(b2.boons || []).includes('Star Ward'), JSON.stringify(b2.boons));
  const bx = browserApLeft(xi2, srv.rules), sx = serverApLeft(xi2, srv.rules);
  check(`Xi: browser AP left ${bx} = server ledger ${sx} after the refund`, bx === sx);
}
await ctx.close();

console.log('T2 — switching Drawbacks off with "Also remove": grant taken back, second copy labelled, below 0 shown');
reset();
({ c: ctx, p, errs } = await openDm());
{
  await unlock(p);
  await p.evaluate(() => { document.querySelector('#chrCalls .chr-call[data-key="drawbacks"]').click(); document.getElementById('chrT2').checked = true; });
  await clickSave(p); await reviewOpen(p);
  const d = await p.evaluate(() => [...document.querySelectorAll('#chrReview .chr-tbl tbody tr')].map(tr => tr.textContent));
  const negRow = d.find(t => t.startsWith('Neg'));
  const neg0 = browserApLeft(NEG, RULES0);
  check(`Neg's grant is taken back and AP left goes below 0 (${neg0} → ${neg0 - 3}), shown, not refused`, negRow && /−3 given back/.test(negRow) && /below 0/.test(negRow), negRow);
  const asth = d.filter(t => t.includes('Asthmatic'));
  check('Xi\'s two Asthmatic copies: the first gives back −2, the second is labelled as giving nothing', asth.length === 2 && /−2 given back/.test(asth[0]) && /second copy/.test(asth[1]), JSON.stringify(asth));
  const boRow = d.find(t => t.startsWith('Bo'));
  check('Bo (draft) is listed and not touched', boRow && /not touched/.test(boRow), boRow);
  check('the dialog explains below 0 (they keep playing and saving)', await p.evaluate(() => /below 0 AP/.test(document.getElementById('chrReview').textContent)));
  await p.evaluate(() => document.getElementById('chrReviewApply').click());
  await p.waitForFunction(() => /Saved/.test(document.getElementById('chrSaveStatus').textContent) || window.__alerts.length > 0, { timeout: 8000 });
  const acts = (applyCalls()[0] || { a: { actions: [] } }).a.actions;
  const negA = acts.filter(a => a.character === id(5)), xiA = acts.filter(a => a.character === id(4) && a.name === 'Asthmatic');
  check('Neg: a removeDrawback at seq 3', negA.length === 1 && negA[0].kind === 'removeDrawback' && negA[0].targetSeq === 3, JSON.stringify(negA));
  check('Xi: removeDrawback for seq 7 and 8, the second with a "0 AP" label', xiA.length === 2 && xiA[0].targetSeq === 7 && !xiA[0].label && xiA[1].targetSeq === 8 && /0 AP/.test(xiA[1].label), JSON.stringify(xiA));
  check('Bo (draft): nothing sent', !acts.some(a => a.character === id(2)));
  const neg2 = srv.chars.find(c => c.id === id(5)).LOG;
  const bn = browserApLeft(neg2, srv.rules), sn = serverApLeft(neg2, srv.rules);
  check(`Neg after: browser ${bn} = server ${sn} = ${neg0 - 3} (below 0)`, bn === sn && bn === neg0 - 3 && bn < 0);
}
await ctx.close();

// ======================================================================================================================
console.log('Two DMs at once: a stale editor is refused, by the console and by the server');
reset();
({ c: ctx, p, errs } = await openDm());
{
  await unlock(p);
  await setAp(p, 'draw', 'Moon-Hexed', 7);
  srv.rules.charHouseRules = { schema: 1, draws: { 'Moon-Hexed': { ap: 9 } } };   // another DM saved meanwhile
  await p.evaluate(() => { window.__alerts.length = 0; });
  await clickSave(p); await p.waitForTimeout(300);
  const al = await p.evaluate(() => window.__alerts.slice(-1)[0] || '');
  check('the console re-reads the campaign at save time and refuses: "another DM changed …", no dialog, nothing sent',
    /another DM changed/.test(al) && applyCalls().length === 0 && !(await p.evaluate(() => { const o = document.getElementById('chrReview'); return !!(o && o.classList.contains('on')); })), al);
  check('...and the other DM\'s rules are untouched', srv.rules.charHouseRules.draws['Moon-Hexed'].ap === 9);
  await ctx.close();
}
reset();
({ c: ctx, p, errs } = await openDm());
{
  await unlock(p);
  await setAp(p, 'draw', 'Moon-Hexed', 7);
  srv.staleRead = JSON.parse(JSON.stringify(RULES0));                                // the console reads the old rules…
  srv.rules.charHouseRules = { schema: 1, draws: { 'Moon-Hexed': { ap: 9 } } };       // …and another DM saves just after
  await clickSave(p); await reviewOpen(p);
  await p.evaluate(() => { window.__alerts.length = 0; document.getElementById('chrReviewApply').click(); });
  await p.waitForFunction(() => window.__alerts.length > 0, { timeout: 5000 });
  const al = await p.evaluate(() => window.__alerts.slice(-1)[0]);
  check('a race the console cannot see is refused by the SERVER (expected ≠ stored), in plain words', /another DM changed/.test(al) && !/PACT house rules:/.test(al), al);
  check('...and nothing was written', srv.rules.charHouseRules.draws['Moon-Hexed'].ap === 9 && !srv.chars.some(c => c.LOG.some(e => e.type === 'dmRepriceDrawback')));
  await ctx.close();
}
reset();
({ c: ctx, p, errs } = await openDm());
{
  // a character's override written by another DM between the preview and the save
  await unlock(p);
  await setAp(p, 'draw', 'Moon-Hexed', 5);
  await clickSave(p); await reviewOpen(p);
  const cy = srv.chars.find(c => c.id === id(3));
  cy.LOG.push({ type: 'dmHouseRules', overrides: { boons: {} }, campaignId: CAMP, seq: 99, ts: 9, dmEdit: true, dmId: 'dm2', label: 'other DM' });
  await p.evaluate(() => { window.__alerts.length = 0; document.getElementById('chrReviewApply').click(); });
  await p.waitForFunction(() => window.__alerts.length > 0, { timeout: 5000 });
  const al = await p.evaluate(() => window.__alerts.slice(-1)[0]);
  check('an override another DM wrote meanwhile is not overwritten: the server refuses (expected snapshot ≠ latest)', /another DM changed/.test(al) && srv.rules.charHouseRules.draws['Moon-Hexed'].ap === 3, al);
  await ctx.close();
}

// ======================================================================================================================
console.log('An un-migrated server');
reset(); srv.missing = true;
({ c: ctx, p, errs } = await openDm());
{
  // the probe ran when the section was opened (with only a campaign id)
  await p.evaluate(() => { const d = document.getElementById('campCharHouseRulesDetails'); d.open = false; });
  await p.evaluate(() => { const d = document.getElementById('campCharHouseRulesDetails'); d.open = true; });
  await p.waitForFunction(() => !document.getElementById('chrServerMsg').hidden, { timeout: 5000 }).catch(() => {});
  const m = await p.evaluate(() => ({ hidden: document.getElementById('chrServerMsg').hidden, text: document.getElementById('chrServerMsg').textContent }));
  check('opening the section shows a plain message that the server is not updated', !m.hidden && /not been updated/.test(m.text) && !/PGRST|schema cache/.test(m.text), JSON.stringify(m));
  const probe = srv.calls.filter(c => c.op === 'apply');
  check('...found by a no-op probe (campaign id only, no rules, no actions)', probe.length >= 1 && probe[0].a.chr == null && probe[0].a.actions.length === 0, JSON.stringify(probe));
  await unlock(p);
  await setAp(p, 'draw', 'Moon-Hexed', 6);
  await clickSave(p); await p.waitForTimeout(200);
  const al = await p.evaluate(() => window.__alerts.slice(-1)[0] || '');
  check('Save says so in plain words and opens no dialog', /not been updated/.test(al) && !(await p.evaluate(() => { const o = document.getElementById('chrReview'); return !!(o && o.classList.contains('on')); })), al);
  check('...and nothing was written', srv.rules.charHouseRules.draws['Moon-Hexed'].ap === 3);
}
await ctx.close();
reset();
({ c: ctx, p, errs } = await openDm());
{
  // migrated probe OK, but the RPC later turns out missing (e.g. rolled back): still a plain message
  await unlock(p);
  await setAp(p, 'draw', 'Moon-Hexed', 6);
  await clickSave(p); await reviewOpen(p);
  srv.missing = true;
  await p.evaluate(() => document.getElementById('chrReviewApply').click());
  await p.waitForFunction(() => window.__alerts.length > 0, { timeout: 5000 });
  const al = await p.evaluate(() => window.__alerts.slice(-1)[0]);
  check('a missing function at save time is reported in plain words too', /not been updated/.test(al), al);
  // a refusal (the roster changed under the DM): the server's reason, without the raw prefix, and nothing written
  srv.missing = false; srv.refuse = 'PACT house rules: action 1 — from (2) is not the purchase\'s current grant (3)';
  await p.evaluate(() => { window.__alerts.length = 0; });
  await clickSave(p); await p.waitForTimeout(300);
  const al2 = await p.evaluate(() => window.__alerts.slice(-1)[0] || '');
  check('after a missing-function answer the console stops offering the save (says so again, no dialog)', /not been updated/.test(al2), al2);
  await ctx.close();
}
reset(); srv.refuse = 'PACT house rules: action 1 — from (2) is not the purchase\'s current grant (3)';
({ c: ctx, p, errs } = await openDm());
{
  await unlock(p);
  await setAp(p, 'draw', 'Moon-Hexed', 6);
  await clickSave(p); await reviewOpen(p);
  await p.evaluate(() => document.getElementById('chrReviewApply').click());
  await p.waitForFunction(() => window.__alerts.length > 0, { timeout: 5000 });
  const al = await p.evaluate(() => window.__alerts.slice(-1)[0]);
  check('a server refusal is shown with its reason, without the raw "PACT house rules:" prefix, and says nothing changed',
    /refused/.test(al) && /current grant/.test(al) && !/PACT house rules:/.test(al) && /nothing was changed/.test(al), al);
  check('...and nothing was written', srv.rules.charHouseRules.draws['Moon-Hexed'].ap === 3);
  await ctx.close();
}

// ======================================================================================================================
console.log('The generic "Save rules" never sends charHouseRules');
reset();
({ c: ctx, p, errs } = await openDm());
{
  await unlock(p);
  await p.evaluate(() => document.getElementById('ruleSaveBtn').click());
  await p.waitForFunction(() => /Saved|Error/.test(document.getElementById('ruleSaveStatus').textContent), { timeout: 5000 });
  const sent = srv.calls.filter(c => c.op === 'setRules').map(c => c.a.rules);
  check('Save rules was sent once, WITHOUT charHouseRules', sent.length === 1 && !('charHouseRules' in sent[0]), JSON.stringify(sent.map(s => Object.keys(s))));
  const kept = await p.evaluate(() => ({ ap: window._dmCampaignApRules.rules.charHouseRules, ed: (window._dmCharHouseRulesTest.draft() || {}).draws }));
  check('...and the console keeps the campaign\'s house rules cached (the roster keeps pricing with them)', kept.ap && kept.ap.draws['Moon-Hexed'].ap === 3, JSON.stringify(kept));
  // DM notes save: same
  srv.calls.length = 0;
  await p.evaluate(() => { document.getElementById('dmNotesText').value = 'n'; document.getElementById('dmNotesSaveBtn').click(); });
  await p.waitForTimeout(200);
  const sent2 = srv.calls.filter(c => c.op === 'setRules').map(c => c.a.rules);
  check('Save notes does not send charHouseRules either', sent2.length === 1 && !('charHouseRules' in sent2[0]), JSON.stringify(sent2.map(s => Object.keys(s))));
}

// ======================================================================================================================
console.log('Grant-boon / impose-drawback pickers use the effective tables');
{
  srv.calls.length = 0;
  await p.evaluate(() => window._dmReloadRoster());
  await p.waitForFunction(() => document.querySelectorAll('#campRoster .dm-grant-boon-sel').length >= 4, { timeout: 8000 }).catch(() => {});
  const g = await p.evaluate((cid) => {
    const sel = [...document.querySelectorAll('#campRoster .dm-grant-boon-sel')].find(s => s.getAttribute('data-cid') === cid);
    const o = sel && [...sel.options].find(x => x.value === 'Star Ward');
    return { has: !!o, ap: o && o.getAttribute('data-ap'), text: o && o.textContent };
  }, id(3));
  check('Cy\'s grant picker lists the campaign boon at HIS effective price (override 2 AP)', g.has && g.ap === '2', JSON.stringify(g));
  await p.evaluate((cid) => {
    const card = [...document.querySelectorAll('#campRoster .dm-grant-boon-sel')].find(s => s.getAttribute('data-cid') === cid);
    card.value = 'Star Ward';
    document.querySelector('#campRoster .dm-grant-boon-btn[data-cid="' + cid + '"]').click();
  }, id(3));
  await p.waitForTimeout(300);
  const ge = srv.calls.filter(c => c.op === 'dmEdit')[0];
  check('...and a grant records that cost on the buy and the award', ge && ge.a.events[0].cost === 2 && ge.a.events[1].amount === 2, JSON.stringify(ge && ge.a.events));
  const imp = await p.evaluate((cid) => {
    document.querySelector('#campRoster .dm-impose-draw-open[data-cid="' + cid + '"]').click();
    const it = [...document.querySelectorAll('#dmDrawPick .dp-item')].find(x => x.getAttribute('data-name') === 'Moon-Hexed');
    const grp = [...document.querySelectorAll('#dmDrawPick .dp-grp')].map(x => x.textContent);
    const res = { has: !!it, ap: it && it.querySelector('.dp-ap').textContent, grp };
    document.getElementById('dpCancel').click();
    return res;
  }, id(1));
  check('the impose picker lists the campaign drawback in its own group at its campaign value', imp.has && imp.ap === '3 AP' && imp.grp.some(x => /Campaign drawbacks/.test(x)), JSON.stringify(imp));
  // A 0 is a price, not a blank (PR #658 review: esc(0) was '' so data-ap="" and the grant fell back to the printed price).
  srv.calls.length = 0;
  await p.evaluate(() => {
    const r = Object.assign({}, window._dmCampaignApRules.rules);
    r.charHouseRules = Object.assign({}, r.charHouseRules, { boons: Object.assign({}, (r.charHouseRules || {}).boons, { Bulwark: { hd: 1, ap: 0 } }),
      draws: Object.assign({}, (r.charHouseRules || {}).draws, { Lame: { ap: 0 } }) });
    window._dmCampaignApRules.rules = r;
  });
  srv.rules = await p.evaluate(() => window._dmCampaignApRules.rules);
  await p.evaluate(() => window._dmReloadRoster());
  await p.waitForFunction(() => document.querySelectorAll('#campRoster .dm-grant-boon-sel').length >= 4, { timeout: 8000 }).catch(() => {});
  const z = await p.evaluate((cid) => {
    const sel = [...document.querySelectorAll('#campRoster .dm-grant-boon-sel')].find(s => s.getAttribute('data-cid') === cid);
    const o = sel && [...sel.options].find(x => x.value === 'Bulwark');
    sel.value = 'Bulwark';
    document.querySelector('#campRoster .dm-grant-boon-btn[data-cid="' + cid + '"]').click();
    document.querySelector('#campRoster .dm-impose-draw-open[data-cid="' + cid + '"]').click();
    const it = [...document.querySelectorAll('#dmDrawPick .dp-item')].find(x => x.getAttribute('data-name') === 'Lame');
    const res = { dataAp: o && o.getAttribute('data-ap'), text: o && o.textContent, imp: it && it.querySelector('.dp-ap').textContent };
    document.getElementById('dpCancel').click();
    return res;
  }, id(1));
  await p.waitForTimeout(300);
  const zg = srv.calls.filter(c => c.op === 'dmEdit')[0];
  check('a boon repriced to 0: the grant picker says "0 AP" (data-ap="0")', z.dataAp === '0' && /\(0 AP\)/.test(z.text), JSON.stringify(z));
  check('...and the grant records cost 0 with a 0 award, not the printed price', zg && zg.a.events[0].cost === 0 && zg.a.events[1].amount === 0, JSON.stringify(zg && zg.a.events));
  check('a drawback repriced to 0 shows "0 AP" in the impose picker', z.imp === '0 AP', z.imp);
  check('the "Also remove" tooltip says only boons and drawbacks are removed (never Bound bindings)',
    await p.evaluate(() => { const t = document.getElementById('chrT2').parentElement.querySelector('.infobtn').title; return /BOONS and DRAWBACKS/.test(t) && /Bound bindings are never removed/.test(t); }));
  check('Live Sheet resolves a loaded cloud character\'s campaign with getCampaign (an archived campaign is not in listMyCampaigns)',
    /async function loadCloudChar[\s\S]*?getCampaign\(rec\.campaign_id\)[\s\S]*?\} else \{/.test(fs.readFileSync(path.join(REPO, 'tools/PACT-Live-Char-Sheet.html'), 'utf8')));
}
check('no XSS fired anywhere in the console', !(await p.evaluate(() => !!window.__xss)));
const fatal = errs.filter(e => !NOISE.test(e));
check('no fatal page errors', fatal.length === 0, fatal.slice(0, 3).join(' | '));
await ctx.close();

// ======================================================================================================================
// The player tools are STRICT when a bound character's campaign rules are unknown (offline / unconfirmed, no snapshot of its
// campaign): no boon or drawback priced at a guess, no post-lock drawback (PR #654 round-3 finding 4).
console.log('Player tools: a bound character whose campaign rules are unknown is strict');
{
  const LOCKED = base(30).concat([draw(3, 'Asthmatic', -2), lock(4)]);
  const snap = { type: 'rulesSnapshot', campRules: { charHouseRules: CHR0 }, campaignId: CAMP, seq: 5, ts: 5 };
  const lsOpen = async (log, campaignId) => {
    const c = await browser.newContext(); const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.addInitScript((e) => { try { localStorage.setItem('pactLiveSheet', JSON.stringify(e)); } catch (x) {} },
      Object.assign({ schema: 'pact-character/1', LOG: log, SEQ: nextSeq(log), id: id(9) }, campaignId ? { campaignId } : {}));
    await p.goto(`http://localhost:${PORT}/PACT/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' });
    await p.waitForFunction(() => window.DATA && window._engineFold && document.body.textContent.length > 2000, { timeout: 25000 });
    await p.waitForTimeout(600);
    await p.evaluate(() => { window.__al = []; window.alert = m => window.__al.push(String(m)); window.confirm = () => true; });
    return { c, p, errs };
  };
  const probe = p => p.evaluate(() => {
    const n0 = LOG.length;
    const bar = { boon: _lsBarGrant('boon'), drawback: _lsBarGrant('drawback'), buyoff: _lsBarGrant('buyoff'), skill: _lsBarGrant('skill') };
    buy('boon', { v: 'Star Ward' }, 'Boon — Star Ward'); takeDrawback('Lame'); buyoffDrawback('Asthmatic');
    return { bar, added: LOG.length - n0, alerts: window.__al.slice(), status: window._rulesStatus };
  });
  { const { c, p, errs } = await lsOpen(LOCKED, CAMP);
    const r = await probe(p);
    check('Live Sheet, bound + rules unknown: boons, drawbacks and buy-offs are refused with a plain reason (other buys are not)',
      /haven't loaded/.test(r.bar.boon) && /haven't loaded/.test(r.bar.drawback) && /haven't loaded/.test(r.bar.buyoff) && r.bar.skill === '', JSON.stringify(r.bar));
    check('...and nothing was added to the log by buy / take / buy off', r.added === 0 && r.alerts.length >= 3, JSON.stringify(r));
    check('Live Sheet: no page errors', errs.filter(e => !NOISE.test(e)).length === 0, errs.join(' | '));
    await c.close(); }
  { const { c, p } = await lsOpen(LOCKED.concat([snap]), CAMP);
    const r = await p.evaluate(() => ({ boon: _lsBarGrant('boon'), drawback: _lsBarGrant('drawback') }));
    check('Live Sheet CONTROL: with a snapshot of its campaign, boons are priced (no refusal) and a post-lock drawback is refused by the campaign rule, not the unknown-rules one',
      r.boon === '' && /once creation is finished/.test(r.drawback), JSON.stringify(r));
    await c.close(); }
  { const { c, p } = await lsOpen(LOCKED, null);
    const r = await p.evaluate(() => ({ boon: _lsBarGrant('boon'), drawback: _lsBarGrant('drawback') }));
    check('Live Sheet CONTROL: a solo character is unaffected (its own rules; post-lock drawbacks allowed)', r.boon === '' && r.drawback === '', JSON.stringify(r));
    await c.close(); }
  // CharGen
  const gc = await browser.newContext(); const gp = await gc.newPage(); const gerrs = []; gp.on('pageerror', e => gerrs.push(String(e)));
  await gp.goto(`http://localhost:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' });
  await gp.waitForFunction(() => window.DATA && typeof window._cgApplyEnvelope === 'function', { timeout: 25000 });
  await gp.waitForTimeout(600);
  const cg = await gp.evaluate(({ log, cid, camp, snap }) => {
    window.__al = []; window.alert = m => window.__al.push(String(m)); window.confirm = () => true;
    const load = (l) => { window._cgApplyEnvelope({ schema: 'pact-character/1', rules: window.DATA.version, name: 'Off', LOG: l, SEQ: l.length + 10, id: cid }, { clearHistory: true }); };
    const out = {};
    load(log); window._cgCampaignId = camp; window._cgCampaignBound = true; window._cgBindingConfirmed = false; window._cloudCampaign = null; window._dmApStatus = 'unavailable';
    const n0 = LOG.length;
    out.unknown = _cgHrRulesUnknown(); out.gate = window.postLockAllowance(_cgGateRules());
    out.boon = _cgPostLockAppend([{ cat: 'boon', payload: { v: 'Star Ward' }, label: 'Boon — Star Ward' }]);
    out.draw = _cgPostLockAppend([{ cat: 'drawback', payload: { v: 'Lame' }, label: 'Drawback — Lame' }]);
    out.added = LOG.length - n0; out.alerts = window.__al.slice();
    load(log.concat([snap])); window._cgCampaignId = camp; window._cgCampaignBound = true;
    out.withSnap = _cgHrRulesUnknown();
    load(log); window._cgCampaignId = null; window._cgCampaignBound = false; window._cgPendingCampaignId = null;
    out.solo = { unknown: _cgHrRulesUnknown(), gate: window.postLockAllowance(_cgGateRules()) };
    return out;
  }, { log: LOCKED, cid: id(9), camp: CAMP, snap });
  check('CharGen, bound + rules unknown: post-lock drawbacks and bindings refused (gate reads {}, not "solo")', cg.unknown && cg.gate.drawbacks === false && cg.gate.bindings === false, JSON.stringify(cg.gate));
  check('...an in-play boon or drawback is refused with a plain reason and nothing is added', cg.boon === false && cg.draw === false && cg.added === 0 && cg.alerts.some(m => /haven't loaded/.test(m)), JSON.stringify(cg));
  check('CharGen CONTROL: with a snapshot of its campaign the rules are known', cg.withSnap === false);
  check('CharGen CONTROL: a solo character is unaffected', cg.solo.unknown === false && cg.solo.gate.drawbacks === true, JSON.stringify(cg.solo));
  check('CharGen: no page errors', gerrs.filter(e => !NOISE.test(e)).length === 0, gerrs.join(' | '));
  await gc.close();
}

await browser.close();
server.close();
await HR.writeDump(fs);
console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} passed / ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
