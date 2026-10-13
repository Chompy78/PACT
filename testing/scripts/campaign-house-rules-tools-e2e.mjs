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
// Over budget by construction: 3 AP spent, nothing earned (no DM AP).
const NEG = [
  { type: 'buy', cat: 'oclass', payload: { v: 'Fighter' }, cost: 0, level: 1, seq: 1, label: 'Fighter' },
  { type: 'buy', cat: 'skill', payload: { v: 'Athletics' }, cost: 3, level: 1, seq: 2, label: 'Skill — Athletics' },
  { type: 'creationLocked', seq: 3, ts: 1 },
];
const SET_NEG_LS = `window.alert=()=>{}; window._cloudCampaignRules={}; window._rulesStatus='active'; window._dmAp=0;
  window.__calls=[]; window._syncBridge=Object.assign({}, window._syncBridge||{}, { saveCharacter:(a)=>{ window.__calls.push(a); return Promise.resolve({ id:a.id, synced:true }); } });`;
{
  const { c, p, errs } = await openLs(env(NEG, { campaignId: CAMP }));
  const r = await p.evaluate(async (set) => {
    eval(set);
    const out = { avail: apAvailable(null), bound: window._lsCampaignId };
    // The restored local copy is the base when the server's spend is unknown: a push that adds nothing goes through.
    out.restoredAllows = !_lsOverApBudget();
    _lsLocalSpentBase = null;                    // truly nothing known (no persisted spend, no restored copy)
    out.unknownBlocks = _lsOverApBudget();
    _lsNoteCloudBase(LOG);                       // as a clean cloud load does — and it is persisted for a reload
    out.persisted = localStorage.getItem('pactCloudSpent:' + __charId);
    out.cleanAllows = !_lsOverApBudget();
    _lsBudgetWarned = false; await _lsCloudPushOnce(); out.pushed = window.__calls.length;
    LOG.push({ type: 'buy', cat: 'skill', payload: { v: 'Arcana' }, cost: 2, level: 1, seq: SEQ++, label: 'Skill — Arcana' });   // a spend increase
    out.increaseBlocks = _lsOverApBudget();
    await _lsCloudPushOnce(); out.pushedAfter = window.__calls.length;
    return out;
  }, SET_NEG_LS);
  check('CONTROL: the character really is below 0, and bound', r.avail < 0 && r.bound === CAMP, JSON.stringify(r));
  check('Live Sheet: server spend unknown, but the restored local copy adds nothing — not refused (review item 4)', r.restoredAllows === true);
  check('Live Sheet: with nothing known at all, below 0 still holds the save back (the old rule)', r.unknownBlocks === true);
  check('Live Sheet: a learned server spend is persisted with the character', r.persisted === '3', String(r.persisted));
  check('Live Sheet: below 0 with no spend increase since the server\'s copy, the cloud save is NOT refused (V1)', r.cleanAllows === true);
  check('...and the autosave really pushes it', r.pushed === 1, String(r.pushed));
  check('Live Sheet: a save that spends MORE while below 0 is still held back (as the server would)', r.increaseBlocks === true && r.pushedAfter === 1, JSON.stringify(r));
  // A reload: the persisted server spend survives, even with the local copy dirty and no cloud load yet.
  await p.evaluate(() => { _lsLocalSpentBase = null; });
  await p.reload({ waitUntil: 'load' });
  await p.waitForFunction(() => window.DATA && window._engineFold && document.body.textContent.length > 2000, { timeout: 25000 });
  await p.waitForTimeout(800);
  const r2 = await p.evaluate((set) => { eval(set); _lsLocalSpentBase = null;   // prove it is the PERSISTED base that answers
    const o = { base: _lsSpendBase(), spent: economy(null).spent };
    o.allows = !_lsOverApBudget();               // the reloaded copy spends what the server holds
    LOG.push({ type: 'buy', cat: 'skill', payload: { v: 'Arcana' }, cost: 2, level: 1, seq: SEQ++, label: 'Skill — Arcana' });
    o.blocks = _lsOverApBudget();                // one that spends more is still refused
    return o; }, SET_NEG_LS);
  check('after a reload the persisted server spend (3) is the base: the extra spend is still refused, none extra is allowed', r2.base === 3 && r2.blocks === true && r2.allows === true, JSON.stringify(r2));
  check('no page errors', errs.filter(e => !NOISE.test(e)).length === 0, errs.join(' | '));
  await c.close();
}
{
  const { c, p, errs } = await openCg();
  const r = await p.evaluate(async ({ log, id, camp }) => {
    window.alert = () => {};
    try { localStorage.removeItem('pactCloudSpent:' + id); } catch (e) {}
    window._cgApplyEnvelope({ schema: 'pact-character/1', rules: window.DATA.version, name: 'Neg', LOG: log, SEQ: log.length + 1, id }, { clearHistory: true });
    window._cgCampaignId = camp; window._cgCampaignBound = true; window._cgBindingConfirmed = true; window._cgEnforceApBudget = true;
    window._dmApStatus = 'active'; window._dmAp = 0; window._cloudCampaign = { id: camp, name: 'Camp', rules: {} };
    const calls = [];
    window._syncBridge = Object.assign({}, window._syncBridge || {}, { saveCharacter: (a) => { calls.push(a); return Promise.resolve({ id: a.id, synced: true }); } });
    const out = { avail: compute(readBuild(), _cgDmOpts()).spendable - economy(LOG).spent };
    out.unknownBlocks = _cgOverApBudget();
    _cgLocalSpentBase = { id: __charId, spent: economy(LOG).spent };   // as _cgRestoreAutosave() records it
    out.restoredAllows = !_cgOverApBudget();
    _cgLocalSpentBase = null;
    _cgNoteCloudBase(LOG);
    out.persisted = localStorage.getItem('pactCloudSpent:' + __charId);
    _cgCloudSpentBase = null;                    // as after a reload: only the persisted value is left
    out.cleanAllows = !_cgOverApBudget();
    _cgBudgetWarned = false; await _cgCloudPushOnce(); out.pushed = calls.length;
    LOG.push({ type: 'buy', cat: 'skill', payload: { v: 'Arcana' }, cost: 2, level: 1, seq: SEQ++, label: 'Skill — Arcana' });
    out.increaseBlocks = _cgOverApBudget();
    return out;
  }, { log: NEG, id: ID, camp: CAMP });
  check('CONTROL: the CharGen character really is below 0', r.avail < 0, String(r.avail));
  check('CharGen: nothing known — the save is held back', r.unknownBlocks === true);
  check('CharGen: the restored local copy\'s spend is the base when the server\'s is unknown', r.restoredAllows === true);
  check('CharGen: the learned server spend is persisted and answers on its own (a reload)', r.persisted === '3' && r.cleanAllows === true && r.pushed === 1, JSON.stringify(r));
  check('CharGen: a spend increase while below 0 is still held back', r.increaseBlocks === true);
  check('no page errors', errs.filter(e => !NOISE.test(e)).length === 0, errs.join(' | '));
  await c.close();
}

// ---- 4. offline / unconfirmed: which context a character gets ---------------------------------------------------------
console.log('Offline: the rules snapshot, and a bound character without one');
const SNAP_LOG = LOG.concat([{ type: 'rulesSnapshot', campRules: RULES, campaignId: CAMP, seq: 7, ts: 2 }]);
const NULLCTX = { campaignId: CAMP, rules: null, bans: { boons: [], draws: [] } };
const EXPECT_BOUND_NOSNAP = E.compute(E.withHouseRulesCtx(E.foldBuild(LOG), NULLCTX), {}).spendable - spent;
const EXPECT_SOLO_NODM = E.compute(E.foldBuild(LOG), {}).spendable - spent;
console.log(`engine: bound-without-snapshot ${EXPECT_BOUND_NOSNAP}, solo ${EXPECT_SOLO_NODM}`);
const lsCase = async (envelope) => { const { c, p, errs } = await openLs(envelope);
  const r = await p.evaluate(() => ({ status: window._rulesStatus, avail: apAvailable(null), ctx: foldBuild(null)._hrCtx || null }));
  await c.close(); return { r, errs }; };
const cgCase = async (d, adopt) => { const { c, p, errs } = await openCg();
  await p.evaluate(({ d, adopt }) => { d.rules = window.DATA.version; window._cgApplyEnvelope(d, { clearHistory: true }); if (adopt) _cgAdoptEnvelopeBinding(d); }, { d, adopt });
  await p.waitForTimeout(1200);   // the binding adopt resolves (signed out: unconfirmed, rules unavailable)
  const r = await p.evaluate((expr) => ({ status: window._dmApStatus, ap: eval(expr), ctx: readBuild()._hrCtx || null,
    ownHidden: (document.getElementById('dmCustomRow') || {style:{}}).style.display === 'none' }), cgApLeft);
  await c.close(); return { r, errs }; };
const cgEnv = (log, extra) => Object.assign({ schema: 'pact-character/1', name: 'Off', LOG: log, SEQ: log.length + 1, id: ID }, extra || {});
{
  const { r, errs } = await lsCase(env(SNAP_LOG, { campaignId: CAMP }));
  check('Live Sheet (signed out, bound, snapshot): the context comes from the snapshot, with its campaign id', !!r.ctx && r.ctx.campaignId === CAMP && r.status !== 'active' && !!r.ctx.rules, JSON.stringify(r).slice(0, 200));
  check(`Live Sheet (signed out, bound, snapshot): AP left = the campaign figure without DM AP (${EXPECT_OFFLINE})`, r.avail === EXPECT_OFFLINE, String(r.avail));
  check('no page errors', errs.filter(e => !NOISE.test(e)).length === 0, errs.join(' | '));
}
{
  const { r, errs } = await lsCase(env(LOG, { campaignId: CAMP }));
  check('Live Sheet (bound, NO snapshot): a campaign context with no house rules — own rules still ignored (review item 2)', !!r.ctx && r.ctx.campaignId === CAMP && r.ctx.rules === null, JSON.stringify(r));
  check(`...AP left ${EXPECT_BOUND_NOSNAP} (the printed drawback value, not the own 20)`, r.avail === EXPECT_BOUND_NOSNAP, String(r.avail));
  check('no page errors', errs.filter(e => !NOISE.test(e)).length === 0, errs.join(' | '));
}
{
  const { r, errs } = await lsCase(env(SNAP_LOG));
  check('Live Sheet (UNBOUND, old snapshot in the LOG): solo — the snapshot is ignored (review item 3)', r.ctx === null && r.avail === EXPECT_SOLO_NODM, JSON.stringify(r));
  check('no page errors', errs.filter(e => !NOISE.test(e)).length === 0, errs.join(' | '));
}
{
  const { r, errs } = await cgCase(cgEnv(SNAP_LOG, { campaignId: CAMP }), true);
  check('CharGen (signed out, bound, snapshot): the context comes from the snapshot', !!r.ctx && r.ctx.campaignId === CAMP && r.status !== 'active' && !!r.ctx.rules, JSON.stringify(r).slice(0, 200));
  check(`CharGen (signed out, bound, snapshot): AP left = the campaign figure without DM AP (${EXPECT_OFFLINE})`, r.ap === EXPECT_OFFLINE, String(r.ap));
  check('no page errors', errs.filter(e => !NOISE.test(e)).length === 0, errs.join(' | '));
}
{
  const { r, errs } = await cgCase(cgEnv(LOG, { campaignId: CAMP }), true);
  check('CharGen (bound, NO snapshot): a campaign context with no house rules, the same as the Live Sheet', !!r.ctx && r.ctx.campaignId === CAMP && r.ctx.rules === null && r.ap === EXPECT_BOUND_NOSNAP, JSON.stringify(r));
  check('...and the own house-rules editor stays hidden (U1)', r.ownHidden === true);
  check('no page errors', errs.filter(e => !NOISE.test(e)).length === 0, errs.join(' | '));
}
{
  const { r, errs } = await cgCase(cgEnv(SNAP_LOG), true);
  check('CharGen (UNBOUND, old snapshot): solo, the same answer as the Live Sheet', r.ctx === null && r.ap === EXPECT_SOLO_NODM, JSON.stringify(r));
  check('no page errors', errs.filter(e => !NOISE.test(e)).length === 0, errs.join(' | '));
}

// ---- 6. no DM-typed text inside an onclick handler ---------------------------------------------------------------------
console.log('Live Sheet: DM-typed names never reach handler JavaScript');
{
  const EVIL = 'Moon");window.__xss=1;//', EVIL2 = "Moon');window.__xss=2;//", TRAIL = 'Trailing\\', HONEST_Q = 'Say "Ni"', HONEST_B = 'Back\\slash';
  const EVIL_FX = 'x");window.__xss=3;//';
  const rules = { charHouseRules: {
    draws: { [EVIL]: { ap: 1 }, [EVIL2]: { ap: 1 }, [TRAIL]: { ap: 1 }, [HONEST_Q]: { ap: 2 }, [HONEST_B]: { ap: 2 }, [XSS]: { ap: 1 } },
    boons: { [EVIL]: { hd: 1, ap: 1, fx: EVIL_FX }, [HONEST_Q]: { hd: 1, ap: 1, fx: 'quoted "fx" \\ here' }, [HONEST_B]: { hd: 1, ap: 1 } } } };
  const draft = LOG.filter(e => e.type !== 'creationLocked').concat([{ type: 'buy', cat: 'boon', payload: { v: EVIL }, cost: 1, level: 1, seq: 8, label: 'Boon' }]);
  const { c, p, errs } = await openLs(env(draft, { campaignId: CAMP }));
  const r = await p.evaluate(({ rules, names }) => {
    window.confirm = () => true; window.alert = () => {}; window.__flashed = [];
    const _f = window.flash; window.flash = function (m) { window.__flashed.push(String(m)); };
    window._cloudCampaignRules = rules; window._rulesStatus = 'active'; window._dmAp = 50;
    Object.keys(catOpen).forEach(k => { catOpen[k] = 1; }); grpOpen['Drawbacks (gain AP)'] = 1; grpOpen['Boons'] = 1;
    window.render(); refreshBuy();
    const tileFor = (sel, n) => [...document.querySelectorAll('#buy ' + sel)].find(t => t.querySelector('.ibhead') && t.querySelector('.ibhead').textContent.startsWith(n + ' '));
    const out = { handlers: [...document.querySelectorAll('#buy [onclick]')].filter(b => names.some(n => (b.getAttribute('onclick') || '').includes(n.slice(0, 6)))).length };
    for (const n of names) { const t = tileFor('button.ib.draw', n); if (t) t.click(); }
    out.xssAfterDrawClicks = window.__xss || 0;
    out.drawsBought = LOG.filter(e => e.type === 'buy' && e.cat === 'drawback').map(e => e.payload.v);
    refreshBuy();
    const boonTile = n => [...document.querySelectorAll('#buy button.ib')].find(t => t.querySelector('.ibhead') && t.querySelector('.ibhead').textContent.startsWith(n + ' (HD'));
    const tq = boonTile(names[3]), tb = boonTile(names[4]);
    const owned = [...document.querySelectorAll('#buy button.ib.dis')].find(t => t.textContent.startsWith(names[0] + ' (HD'));   // ibOwned() tile
    if (tq) tq.click(); if (tb) tb.click(); if (owned) owned.click();
    out.boonsBought = LOG.filter(e => e.type === 'buy' && e.cat === 'boon').map(e => e.payload.v);
    out.ownedFlash = window.__flashed.slice(-1)[0] || '';
    out.xss = window.__xss || 0; out.img = !!document.querySelector('img[src="x"]');
    window.flash = _f;
    return out;
  }, { rules, names: [EVIL, EVIL2, TRAIL, HONEST_Q, HONEST_B, XSS] });
  check('no buy-panel handler carries a DM-typed name (values ride in data-* attributes)', r.handlers === 0, String(r.handlers));
  check('quote breakouts ("…" and \'…\'), a trailing backslash and an <img> run nothing when rendered or clicked', r.xss === 0 && r.xssAfterDrawClicks === 0 && !r.img, JSON.stringify(r));
  check('clicking each drawback tile buys exactly that name — including the hostile ones, as plain text', [EVIL, EVIL2, TRAIL, HONEST_Q, HONEST_B, XSS].every(n => r.drawsBought.includes(n)), JSON.stringify(r.drawsBought));
  check('honest boon names with " and \\ still buy (ib() round-trips the payload)', r.boonsBought.includes(HONEST_Q) && r.boonsBought.includes(HONEST_B), JSON.stringify(r.boonsBought));
  check('an owned boon\'s hostile fx text is flashed as text by its tile, never run', r.ownedFlash === EVIL_FX && r.xss === 0, JSON.stringify(r.ownedFlash));
  check('no page errors', errs.filter(e => !NOISE.test(e)).length === 0, errs.join(' | '));
  await c.close();
}

// ---- 7. CharGen share link carries no derived keys --------------------------------------------------------------------
console.log('CharGen: share link');
{
  const { c, p, errs } = await openCg();
  const r = await p.evaluate(({ log, id, camp, rules }) => {
    window._cgApplyEnvelope({ schema: 'pact-character/1', rules: window.DATA.version, name: 'Share', LOG: log, SEQ: log.length + 1, id }, { clearHistory: true });
    window._cgCampaignId = camp; window._cgCampaignBound = true; window._cgBindingConfirmed = true;
    window._dmApStatus = 'active'; window._cloudCampaign = { id: camp, name: 'Camp', rules };
    const hadCtx = !!readBuild()._hrCtx;
    window._copyText = () => true; shareLink();
    const b = _decB(location.hash.slice(3));
    return { hadCtx, under: Object.keys(b).filter(k => k.charAt(0) === '_'), name: b.name };
  }, { log: LOG, id: ID, camp: CAMP, rules: RULES });
  check('CONTROL: the build being shared carries a house-rules context', r.hadCtx);
  check('the #b= link has no _-prefixed key (no _hrCtx / _dmHouseRulesByCampaign)', r.under.length === 0 && r.name === 'Share', JSON.stringify(r));
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
