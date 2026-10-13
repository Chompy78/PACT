/* PACT — campaign-wide house rules reach all three tools (feat/campaign-house-rules-tools, PR2 of
 * D-GH-2026-10-13-campaign-house-rules).
 *
 * PR1 gave the engine a house-rules CONTEXT (campaign rules.charHouseRules + bans + a DM's per-character override);
 * this PR makes every tool stamp it on its folds. Proves, in a real browser:
 *
 *   1. ONE campaign character with a charHouseRules context shows the SAME "AP left" in the Live Sheet, CharGen and the
 *      DM Console — and it is the engine's campaign figure (the character's own house-ruled drawback is ignored in a
 *      campaign, owner decision U1), not its solo one (plan risk 1: a missed fold path).
 *   2. Live Sheet: a campaign CUSTOM drawback is offered at its custom value, bought at it, and bought off at 3x its
 *      CURRENT EFFECTIVE value (owner decision W1) — it used to buy off for 0 — and the buy-off names the purchase it
 *      cancels (targetSeq, addendum M4). A held printed drawback the campaign reprices buys off at 3x the new value.
 *      DM-typed names are escaped.
 *   3. V1: a campaign character below 0 AP keeps cloud-saving while its spend has not increased; a save that spends
 *      more is still held back (the server's rule). Live Sheet and CharGen.
 *   4. Offline: with no cloud, the rules snapshot in the character's own LOG prices it (Live Sheet and CharGen).
 *   5. CharGen never rewrites the character's OWN house-rules patch from campaign values (plan risk 2): after a
 *      campaign session the own patch is byte-identical; the DM's rules show in a read-only panel instead; a campaign
 *      draft re-prices its boons at the campaign's price (_cgRepriceDraft passes the context).
 *
 * No Supabase, no sign-in: campaign state is set on the page the way the cloud loaders set it, and saves are stubbed.
 *
 *   node testing/scripts/campaign-house-rules-tools-e2e.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const E = await import(path.join(REPO, 'js/engine.js'));
const PORT = Number(process.env.PACT_E2E_PORT) || 7989;
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

const CAMP = 'camp-1';
const XSS = '<img src=x onerror="window.__xss=1">Moon';
// The campaign's character house rules: Asthmatic (printed 2) is worth 7 here; one custom drawback; one XSS-named one.
const CHR = { draws: { Asthmatic: { ap: 7 }, 'Moon-Hexed': { ap: 5, fx: 'Howls at the full moon' }, [XSS]: { ap: 1, fx: '<b>bold</b>' } } };
const RULES = { charHouseRules: CHR };
const OWN_HR = { boons: {}, draws: { Asthmatic: { ap: 20 } }, disabled: { boons: [], draws: [] },
                 dmAllows: { bound: true, boons: true, drawbacks: true, tasha: true } };
const LOG = [
  { type: 'award', amount: 40, seq: 1, label: 'Award' },
  { type: 'buy', cat: 'oclass', payload: { v: 'Fighter' }, cost: 0, level: 1, seq: 2, label: 'Fighter' },
  { type: 'buy', cat: 'patch', _slot: 'houseRules', payload: { patch: { houseRules: OWN_HR } }, cost: 0, level: 1, seq: 3, label: 'DM customisations' },
  { type: 'buy', cat: 'drawback', payload: { v: 'Asthmatic' }, cost: -2, level: 1, seq: 4, label: 'Drawback — Asthmatic' },
  { type: 'buy', cat: 'skill', payload: { v: 'Athletics' }, cost: 3, level: 1, seq: 5, label: 'Skill — Athletics' },
  { type: 'creationLocked', seq: 6, ts: 1 },
];
const DM_AP = 5;
const ID = '11111111-2222-4333-8444-555555555555';
const CTX = { campaignId: CAMP, rules: CHR, bans: { boons: [], draws: [] } };
const spent = E.economy(LOG).spent;
const EXPECT_CAMP = E.compute(E.withHouseRulesCtx(E.foldBuild(LOG), CTX), { dmAp: DM_AP }).spendable - spent;
const EXPECT_SOLO = E.compute(E.foldBuild(LOG), { dmAp: DM_AP }).spendable - spent;
const EXPECT_OFFLINE = E.compute(E.withHouseRulesCtx(E.foldBuild(LOG), CTX), {}).spendable - spent;   // no DM AP offline
console.log(`engine: campaign AP left ${EXPECT_CAMP}, solo ${EXPECT_SOLO}, offline-from-snapshot ${EXPECT_OFFLINE}`);
check('CONTROL: the campaign context changes this character\'s AP left (else check 1 could not tell the paths apart)', EXPECT_CAMP !== EXPECT_SOLO);

const browser = await launchChromium();
const env = (log, extra) => Object.assign({ schema: 'pact-character/1', LOG: log, SEQ: log.length + 1, id: ID }, extra || {});

async function openLs(envelope) {
  const c = await browser.newContext(); const p = await c.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript((e) => { try { localStorage.setItem('pactLiveSheet', JSON.stringify(e)); } catch (x) {} }, envelope);
  await p.goto(`http://localhost:${PORT}/PACT/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.DATA && window._engineFold && document.body.textContent.length > 2000, { timeout: 25000 });
  await p.waitForTimeout(800);   // let the cloud bridge settle (signed out: it leaves the campaign state alone)
  return { c, p, errs };
}
async function openCg() {
  const c = await browser.newContext(); const p = await c.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(`http://localhost:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.DATA && typeof window._cgApplyEnvelope === 'function', { timeout: 25000 });
  await p.waitForTimeout(800);
  return { c, p, errs };
}
const cgApLeft = `compute(readBuild(),_cgDmOpts()).spendable-economy(LOG).spent`;

// ---- 1. the same AP left in all three tools -------------------------------------------------------------------------
console.log('One campaign character, three tools');
{
  const { c, p, errs } = await openLs(env(LOG, { campaignId: CAMP }));
  const ls = await p.evaluate(({ rules, dmAp }) => {
    window._cloudCampaignRules = rules; window._rulesStatus = 'active'; window._dmAp = dmAp; window._ignorePlayerAp = false;
    window.render();
    return { avail: apAvailable(null), shown: Number(document.getElementById('apFloatN').textContent), ctx: !!foldBuild(null)._hrCtx };
  }, { rules: RULES, dmAp: DM_AP });
  check('Live Sheet: its folds carry the campaign context', ls.ctx);
  check(`Live Sheet: AP left = the engine's campaign figure (${EXPECT_CAMP})`, ls.avail === EXPECT_CAMP && ls.shown === EXPECT_CAMP, JSON.stringify(ls));
  check('Live Sheet: no page errors', errs.filter(e => !NOISE.test(e)).length === 0, errs.join(' | '));
  await c.close();
}
{
  const { c, p, errs } = await openCg();
  const cg = await p.evaluate(({ log, id, camp, rules, dmAp, expr }) => {
    window._cgApplyEnvelope({ schema: 'pact-character/1', rules: window.DATA.version, name: 'Probe', LOG: log, SEQ: log.length + 1, id }, { clearHistory: true });
    window._cgCampaignId = camp; window._cgCampaignBound = true; window._cgBindingConfirmed = true;
    window._dmApStatus = 'active'; window._dmAp = dmAp; window._ignorePlayerAp = false;
    window._cloudCampaign = { id: camp, name: 'Camp', rules };
    render();
    return { ap: eval(expr), ctx: !!readBuild()._hrCtx };
  }, { log: LOG, id: ID, camp: CAMP, rules: RULES, dmAp: DM_AP, expr: cgApLeft });
  check('CharGen: its folds carry the campaign context', cg.ctx);
  check(`CharGen: AP left = the engine's campaign figure (${EXPECT_CAMP})`, cg.ap === EXPECT_CAMP, JSON.stringify(cg));
  check('CharGen: no page errors', errs.filter(e => !NOISE.test(e)).length === 0, errs.join(' | '));
  await c.close();
}
{
  const c = await browser.newContext({ viewport: { width: 1100, height: 900 } }); const p = await c.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(`http://localhost:${PORT}/PACT/tools/DM-Console.html`, { waitUntil: 'load' });
  await p.waitForFunction(() => !!window._campBridge && typeof window._dmRenderCloudRoster === 'function', { timeout: 20000 });
  const dm = await p.evaluate(({ log, camp, rules, dmAp }) => {
    window._campBridge.listCampaignInvites = () => Promise.resolve([]);
    window._dmCampaignApRules = { ignorePlayerAp: false, campaignId: camp, customFields: {}, rules };
    const cs = document.getElementById('campSection'); if (cs) cs.style.display = 'block';
    window._dmRenderCloudRoster(document.getElementById('campRoster'), [{ id: 'c1', name: 'Probe', ap: dmAp, player: 'P', playerLabel: '', dmNotes: '', stats: { LOG: log } }]);
    const st = [...document.querySelectorAll('#campRoster .card .stat')].find(s => s.querySelector('.k').textContent === 'AP');
    return { ap: st ? Number(st.querySelector('.v').textContent.split(' / ')[0]) : null, overrideCleared: window._dmHrCtxOverride === undefined };
  }, { log: LOG, camp: CAMP, rules: RULES, dmAp: DM_AP });
  check(`DM Console: the roster card's AP left = the engine's campaign figure (${EXPECT_CAMP})`, dm.ap === EXPECT_CAMP, JSON.stringify(dm));
  check('DM Console: the per-row context is cleared once the row is analysed', dm.overrideCleared);
  check('DM Console: no page errors', errs.filter(e => !NOISE.test(e)).length === 0, errs.join(' | '));
  await c.close();
}

// ---- 2. Live Sheet: custom drawback bought and bought off at the effective value --------------------------------------
console.log('Live Sheet: campaign custom drawback');
{
  // Still in creation: after the lock a NEW drawback is refused outright (owner P1), so the picker is exercised on a draft.
  const { c, p, errs } = await openLs(env(LOG.filter(e => e.type !== 'creationLocked'), { campaignId: CAMP }));
  const r = await p.evaluate(({ rules, xss }) => {
    window.confirm = () => true; window.alert = () => {};
    window._cloudCampaignRules = rules; window._rulesStatus = 'active'; window._dmAp = 0;
    Object.keys(catOpen).forEach(k => { catOpen[k] = 1; }); grpOpen['Drawbacks (gain AP)'] = 1;
    window.render(); refreshBuy();
    const tiles = [...document.querySelectorAll('#buy button.ib.draw')];
    const moon = tiles.find(t => t.querySelector('.ibhead') && t.querySelector('.ibhead').textContent.startsWith('Moon-Hexed '));
    const xssTile = tiles.find(t => t.querySelector('.ibhead') && t.querySelector('.ibhead').textContent.startsWith(xss));
    const out = { listed: !!moon, label: moon ? moon.querySelector('.ibhead').textContent : '', fx: moon ? moon.textContent.includes('Howls at the full moon') : false,
                  xssListed: !!xssTile, img: !!document.querySelector('#buy img[src="x"]'), xssRan: window.__xss === 1, boldParsed: !!(xssTile && xssTile.querySelector('b')) };
    takeDrawback('Moon-Hexed');
    const bought = LOG[LOG.length - 1];
    out.buy = { type: bought.type, cat: bought.cat, v: bought.payload && bought.payload.v, cost: bought.cost, seq: bought.seq };
    buyoffDrawback('Moon-Hexed');
    const off = LOG[LOG.length - 1];
    out.off = { type: off.type, refVal: off.refVal, cost: off.cost, targetSeq: off.targetSeq };
    buyoffDrawback('Asthmatic');
    const off2 = LOG[LOG.length - 1];
    out.off2 = { type: off2.type, refVal: off2.refVal, cost: off2.cost, targetSeq: off2.targetSeq };
    window.render();
    out.ledgerImg = !!document.querySelector('#ledger img[src="x"]');
    out.issues = (document.getElementById('tray') || {}).textContent || '';
    return out;
  }, { rules: RULES, xss: XSS });
  check('the custom drawback is offered in the picker at its campaign value (+5) with its campaign text', r.listed && /\+5$/.test(r.label) && r.fx, JSON.stringify([r.label, r.fx]));
  check('a DM-typed drawback name and text are shown as text, never parsed (no <img>, no script, no <b>)', r.xssListed && !r.img && !r.xssRan && !r.boldParsed, JSON.stringify(r));
  check('taking it records the custom value as the grant (cost -5)', r.buy.type === 'buy' && r.buy.cat === 'drawback' && r.buy.v === 'Moon-Hexed' && r.buy.cost === -5, JSON.stringify(r.buy));
  check('buying it off costs 3x its effective value (15 AP), not 0 (W1)', r.off.type === 'buyoff' && r.off.refVal === 'Moon-Hexed' && r.off.cost === 15, JSON.stringify(r.off));
  check('the buy-off names the purchase it cancels (targetSeq = that buy\'s seq, M4)', r.off.targetSeq === r.buy.seq, JSON.stringify([r.off.targetSeq, r.buy.seq]));
  check('a printed drawback the campaign reprices (Asthmatic 2 -> 7) buys off at 3x the new value (21)', r.off2.type === 'buyoff' && r.off2.cost === 21 && r.off2.targetSeq === 4, JSON.stringify(r.off2));
  check('the custom drawback is not reported as "no longer in rules"', !/Drawback no longer in rules/.test(r.issues), r.issues.slice(0, 200));
  check('no page errors', errs.filter(e => !NOISE.test(e)).length === 0, errs.join(' | '));
  await c.close();
}

// ---- 3. V1: below 0, keep saving while spend has not increased --------------------------------------------------------
console.log('V1: a campaign character below 0 AP');
// Over budget by construction: 3 AP spent, nothing earned but a 2 AP drawback (no DM AP, player AP ignored).
const NEG = [
  { type: 'buy', cat: 'oclass', payload: { v: 'Fighter' }, cost: 0, level: 1, seq: 1, label: 'Fighter' },
  { type: 'buy', cat: 'skill', payload: { v: 'Athletics' }, cost: 3, level: 1, seq: 2, label: 'Skill — Athletics' },
  { type: 'creationLocked', seq: 3, ts: 1 },
];
{
  const { c, p, errs } = await openLs(env(NEG, { campaignId: CAMP }));
  const r = await p.evaluate(async ({ camp }) => {
    window.alert = () => {};
    window._lsCampaignId = camp; window._cloudCampaignRules = {}; window._rulesStatus = 'active'; window._dmAp = 0;
    const calls = [];
    window._syncBridge = Object.assign({}, window._syncBridge || {}, { saveCharacter: (a) => { calls.push(a); return Promise.resolve({ id: a.id, synced: true }); } });
    const out = { avail: apAvailable(null) };
    out.unknownBlocks = _lsOverApBudget();
    _lsNoteCloudBase(LOG);                       // as a clean cloud load does
    out.cleanAllows = !_lsOverApBudget();
    _lsBudgetWarned = false; await _lsCloudPushOnce(); out.pushed = calls.length;
    LOG.push({ type: 'buy', cat: 'skill', payload: { v: 'Arcana' }, cost: 2, level: 1, seq: SEQ++, label: 'Skill — Arcana' });   // a spend increase
    out.increaseBlocks = _lsOverApBudget();
    await _lsCloudPushOnce(); out.pushedAfter = calls.length;
    return out;
  }, { camp: CAMP });
  check('CONTROL: the character really is below 0', r.avail < 0, String(r.avail));
  check('Live Sheet: with the server\'s spend unknown, below 0 still holds the save back (the old rule)', r.unknownBlocks === true);
  check('Live Sheet: below 0 with no spend increase since the server\'s copy, the cloud save is NOT refused (V1)', r.cleanAllows === true);
  check('...and the autosave really pushes it', r.pushed === 1, String(r.pushed));
  check('Live Sheet: a save that spends MORE while below 0 is still held back (as the server would)', r.increaseBlocks === true && r.pushedAfter === 1, JSON.stringify(r));
  check('no page errors', errs.filter(e => !NOISE.test(e)).length === 0, errs.join(' | '));
  await c.close();
}
{
  const { c, p, errs } = await openCg();
  const r = await p.evaluate(async ({ log, id, camp }) => {
    window.alert = () => {};
    window._cgApplyEnvelope({ schema: 'pact-character/1', rules: window.DATA.version, name: 'Neg', LOG: log, SEQ: log.length + 1, id }, { clearHistory: true });
    window._cgCampaignId = camp; window._cgCampaignBound = true; window._cgBindingConfirmed = true; window._cgEnforceApBudget = true;
    window._dmApStatus = 'active'; window._dmAp = 0; window._cloudCampaign = { id: camp, name: 'Camp', rules: {} };
    const calls = [];
    window._syncBridge = Object.assign({}, window._syncBridge || {}, { saveCharacter: (a) => { calls.push(a); return Promise.resolve({ id: a.id, synced: true }); } });
    const out = { avail: compute(readBuild(), _cgDmOpts()).spendable - economy(LOG).spent };
    out.unknownBlocks = _cgOverApBudget();
    _cgNoteCloudBase(LOG);
    out.cleanAllows = !_cgOverApBudget();
    _cgBudgetWarned = false; await _cgCloudPushOnce(); out.pushed = calls.length;
    LOG.push({ type: 'buy', cat: 'skill', payload: { v: 'Arcana' }, cost: 2, level: 1, seq: SEQ++, label: 'Skill — Arcana' });
    out.increaseBlocks = _cgOverApBudget();
    return out;
  }, { log: NEG, id: ID, camp: CAMP });
  check('CONTROL: the CharGen character really is below 0', r.avail < 0, String(r.avail));
  check('CharGen: unknown server spend still holds the save back', r.unknownBlocks === true);
  check('CharGen: below 0 with no spend increase, the cloud save is NOT refused (V1) and is pushed', r.cleanAllows === true && r.pushed === 1, JSON.stringify(r));
  check('CharGen: a spend increase while below 0 is still held back', r.increaseBlocks === true);
  check('no page errors', errs.filter(e => !NOISE.test(e)).length === 0, errs.join(' | '));
  await c.close();
}

// ---- 4. offline: the LOG's rules snapshot prices the character --------------------------------------------------------
console.log('Offline: the rules snapshot');
const SNAP_LOG = LOG.concat([{ type: 'rulesSnapshot', campRules: RULES, campaignId: CAMP, seq: 7, ts: 2 }]);
{
  const { c, p, errs } = await openLs(env(SNAP_LOG, { campaignId: CAMP }));
  const r = await p.evaluate(() => ({ status: window._rulesStatus, avail: apAvailable(null), ctx: foldBuild(null)._hrCtx || null }));
  check('Live Sheet (signed out): the context comes from the snapshot, with its campaign id', !!r.ctx && r.ctx.campaignId === 'camp-1' && r.status !== 'active', JSON.stringify(r));
  check(`Live Sheet (signed out): AP left = the engine's campaign figure without DM AP (${EXPECT_OFFLINE})`, r.avail === EXPECT_OFFLINE, String(r.avail));
  check('no page errors', errs.filter(e => !NOISE.test(e)).length === 0, errs.join(' | '));
  await c.close();
}
{
  const { c, p, errs } = await openCg();
  await p.evaluate(({ log, id, camp }) => {
    // The autosave-restore path: apply the envelope, then adopt the campaign binding it names.
    const d = { schema: 'pact-character/1', rules: window.DATA.version, name: 'Off', LOG: log, SEQ: log.length + 1, id, campaignId: camp };
    window._cgApplyEnvelope(d, { clearHistory: true }); _cgAdoptEnvelopeBinding(d);
  }, { log: SNAP_LOG, id: ID, camp: CAMP });
  await p.waitForTimeout(1200);   // the binding adopt resolves (signed out: unconfirmed, rules unavailable)
  const r = await p.evaluate((expr) => ({ status: window._dmApStatus, ap: eval(expr), ctx: readBuild()._hrCtx || null }), cgApLeft);
  check('CharGen (signed out): the context comes from the snapshot', !!r.ctx && r.ctx.campaignId === 'camp-1' && r.status !== 'active', JSON.stringify(r));
  check(`CharGen (signed out): AP left = the engine's campaign figure without DM AP (${EXPECT_OFFLINE})`, r.ap === EXPECT_OFFLINE, String(r.ap));
  const solo = await p.evaluate(({ log, id }) => {
    _cgResetCloudApState();   // a local load with no campaign id, as every non-cloud load path does first
    window._cgApplyEnvelope({ schema: 'pact-character/1', rules: window.DATA.version, name: 'Solo', LOG: log, SEQ: log.length + 1, id: '99999999-2222-4333-8444-555555555555' }, { clearHistory: true });
    return { ctx: readBuild()._hrCtx || null };
  }, { log: SNAP_LOG, id: ID });
  check('CharGen: a character that is NOT campaign-bound ignores an old snapshot in its LOG (it may have left) — solo', solo.ctx === null, JSON.stringify(solo));
  check('no page errors', errs.filter(e => !NOISE.test(e)).length === 0, errs.join(' | '));
  await c.close();
}

// ---- 5. CharGen: the own patch is never rewritten from campaign values ------------------------------------------------
console.log('CharGen: own house rules untouched in a campaign');
{
  const { c, p, errs } = await openCg();
  const BOON = Object.keys(E.DATA.boons).find(k => (E.DATA.boons[k].hd || 1) === 1 && E.DATA.boons[k].ap > 1 && !E.DATA.boons[k].noncore);
  const DRAFT = [
    { type: 'award', amount: 60, seq: 1, label: 'Award' },
    { type: 'buy', cat: 'oclass', payload: { v: 'Fighter' }, cost: 0, level: 1, seq: 2, label: 'Fighter' },
    { type: 'buy', cat: 'patch', _slot: 'houseRules', payload: { patch: { houseRules: OWN_HR } }, cost: 0, level: 1, seq: 3, label: 'DM customisations' },
    { type: 'buy', cat: 'boon', payload: { v: BOON }, cost: E.DATA.boons[BOON].ap, level: 1, seq: 4, label: 'Boon — ' + BOON },
  ];
  const CRULES = { charHouseRules: { boons: { [BOON]: { hd: 1, ap: 1 } }, draws: CHR.draws, dmAllows: { boons: true, drawbacks: false } } };
  const r = await p.evaluate(({ log, id, camp, rules, boon, xss }) => {
    window.alert = () => {}; window.confirm = () => true;
    window._cgApplyEnvelope({ schema: 'pact-character/1', rules: window.DATA.version, name: 'Own', LOG: log, SEQ: log.length + 1, id }, { clearHistory: true });
    const own = () => JSON.stringify(LOG.filter(e => e.type === 'buy' && e.cat === 'patch' && e._slot === 'houseRules'));
    const before = own();
    const soloPanelHidden = document.getElementById('dmEffPanel').style.display === 'none';
    window._cgCampaignId = camp; window._cgCampaignBound = true; window._cgBindingConfirmed = true;
    window._dmApStatus = 'active'; window._dmAp = 0; window._cloudCampaign = { id: camp, name: 'Camp', rules };
    render();
    // A campaign session: every route that could write the own slot.
    try { const t = document.getElementById('dm_boons'); if (t) { t.checked = false; updateDmToggles(); } } catch (e) {}
    try { document.getElementById('dmname').value = 'Sneaky'; document.getElementById('dmap').value = '9'; dmAdd(); } catch (e) {}
    try { dmToggleDisable('boon', boon); } catch (e) {}
    try { _cgSyncPatchSlot(PATCH_SLOTS.HOUSE_RULES); } catch (e) {}
    try { const s = document.getElementById('st_STR'); if (s) { s.value = String(Number(s.value) + 1); s.dispatchEvent(new Event('change', { bubbles: true })); } } catch (e) {}
    _cgRepriceDraft(); render();
    const boonEv = LOG.find(e => e.type === 'buy' && e.cat === 'boon');
    const panel = document.getElementById('dmEffPanel');
    const out = { same: own() === before, nOwn: LOG.filter(e => e._slot === 'houseRules').length,
      panelShown: panel.style.display !== 'none', panelText: panel.textContent,
      ownHidden: document.getElementById('dmCustomRow').style.display === 'none' && document.getElementById('dmCallsRow').style.display === 'none',
      img: !!document.querySelector('img[src="x"]'), xssRan: window.__xss === 1,
      boonCost: boonEv && boonEv.cost, soloPanelHidden };
    // Leaving the campaign: the own rules are back in force, still exactly as they were.
    window._cgCampaignId = null; window._cgCampaignBound = false; window._cgBindingConfirmed = false; window._dmApStatus = 'none'; window._cloudCampaign = null;
    try { _cgPendingCampaignId = null; } catch (e) {}
    render();
    out.afterLeaveSame = own() === before; out.afterLeaveCtx = readBuild()._hrCtx || null;
    out.afterLeavePanelHidden = panel.style.display === 'none';
    return out;
  }, { log: DRAFT, id: ID, camp: CAMP, rules: CRULES, boon: BOON, xss: XSS });
  check('CONTROL: with no campaign the read-only panel is hidden', r.soloPanelHidden);
  check('after a campaign session (toggles, add, disable, slot sync, a stat edit, a reprice) the OWN house-rules patch is byte-identical', r.same && r.nOwn === 1, JSON.stringify({ same: r.same, n: r.nOwn }));
  check('in a campaign the DM\'s rules show read-only, with their source', r.panelShown && /House rules set by your DM/.test(r.panelText) && /Moon-Hexed/.test(r.panelText) && /campaign/.test(r.panelText) && /Drawbacks: off/.test(r.panelText), r.panelText.slice(0, 300));
  check('...and the own editing controls are hidden', r.ownHidden);
  check('DM-typed names in the panel are text, never markup', !r.img && !r.xssRan, JSON.stringify(r));
  check(`a campaign draft re-prices its boon at the campaign's price (${BOON}: 1 AP) — _cgRepriceDraft passes the context`, r.boonCost === 1, String(r.boonCost));
  check('leaving the campaign: solo again, own patch still byte-identical, panel hidden', r.afterLeaveSame && r.afterLeaveCtx === null && r.afterLeavePanelHidden, JSON.stringify({ s: r.afterLeaveSame, c: r.afterLeaveCtx, h: r.afterLeavePanelHidden }));
  check('no page errors', errs.filter(e => !NOISE.test(e)).length === 0, errs.join(' | '));
  await c.close();
}

await browser.close();
server.close();
console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} passed / ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
