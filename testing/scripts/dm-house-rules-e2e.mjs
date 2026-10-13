/* PACT — a DM sets ONE campaign character's house-rule OVERRIDES (feat/campaign-house-rules-overrides, PR5 of
 * D-GH-2026-10-13-campaign-house-rules). Reworks #642's per-character editor (feat/dm-house-rules-editor,
 * D-GH-2026-10-12-dm-house-rules-editor) and adapts its e2e: the editor now writes a `dmHouseRules` override SNAPSHOT for the
 * selected campaign through dm_apply_house_rules_change(), on top of the campaign's Character house rules.
 *
 *   DM Console
 *   1. The block shows this character's current overrides (the engine's fold: the last DM-stamped dmHouseRules for this
 *      campaign) with the value each one replaces (campaign, else printed), escaped.
 *   2. Save calls / Set for them / Disable / Use the campaign value / Re-enable / Apply the current value each send exactly
 *      ONE RPC call (no campaign rules) whose first action is the WHOLE next override snapshot, everything else carried over.
 *   3. The engine then sees it: the call, an override price, a disabled item; AP left does not move for a boon or a call.
 *   4. A held drawback whose value changes (refused by #642) opens the single-holder S2 review: ticked = a reprice after the
 *      override (server and browser agree), unticked = a pin in the same snapshot (AP unchanged); "Apply the current value"
 *      later removes the pin with a reprice. A character still in creation (refused by #642) can be edited; its row is not
 *      tickable and nothing AP-moving is sent.
 *   5. Still refused (nothing sent): a no-op, a bad AP, an existing override outside the server's limits (named — removing it
 *      is allowed), deleting an override-only custom boon the character holds. The archived peek blocks it. An un-migrated
 *      server and a server refusal get plain-language messages. Player/DM text renders escaped.
 *   CharGen
 *   6. The player opening that character sees the DM's override in the effective rules, and the character's own house-rules
 *      patch is untouched.
 *
 * No Supabase: the shared fake server in lib/house-rules-fake-server.mjs; --dump-calls <file> writes what the console sent
 * for creation-lock-guard-test/run-dm-house-rules-replay.sh to replay against the real migration.
 *   node testing/scripts/dm-house-rules-e2e.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';
import { createHouseRulesHarness } from './lib/house-rules-fake-server.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const E = await import(path.join(REPO, 'js/engine.js'));
const CR = await import(path.join(REPO, 'js/campaign-rules.js'));
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
// An ephemeral port unless one is given: parallel agent runs collided on hard-coded ports.
await new Promise(r => server.listen(Number(process.env.PACT_E2E_PORT) || 0, r));
const PORT = server.address().port;

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };
const NOISE = /Failed to load resource|net::|supabase|fetch|NetworkError|Load failed|ERR_/i;

const CAMP = '0c000000-0000-4000-8000-0000000000aa';
const XSS = '<img src=x onerror="window.__xss=1">Gift';
const CHR = { schema: 1, draws: { 'Moon-Hexed': { ap: 3, fx: 'Howls' } }, boons: { 'Star Ward': { hd: 1, ap: 4 } } };
const RULES0 = { bannedBoons: [], bannedDrawbacks: [], charHouseRules: CHR };
const id = n => `0c000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;
const OWN = { type: 'buy', cat: 'patch', _slot: 'houseRules', payload: { patch: { houseRules: { boons: {}, draws: { 'Moon-Hexed': { ap: 20 } }, disabled: { boons: [], draws: [] }, dmAllows: { bound: true, boons: true, drawbacks: true, tasha: true } } } }, cost: 0, level: 1, seq: 3, label: 'DM customisations' };
const ov = (seq, overrides) => ({ type: 'dmHouseRules', overrides, campaignId: CAMP, seq, ts: 1, dmEdit: true, dmId: 'dm', label: 'DM house rules' });
const base = () => [{ type: 'award', amount: 30, seq: 1, label: 'Award' }, { type: 'buy', cat: 'oclass', payload: { v: 'Fighter' }, cost: 0, level: 1, seq: 2, label: 'Fighter' }];
// Ana: finished; her own (ignored in a campaign) patch; holds Moon-Hexed and an override-only custom boon "Old Gift";
// her overrides already name an XSS custom boon and Old Gift.
const ANA = base().concat([OWN,
  { type: 'buy', cat: 'drawback', payload: { v: 'Moon-Hexed' }, cost: -3, level: 1, seq: 4, label: 'Drawback — Moon-Hexed' },
  ov(5, { boons: { [XSS]: { hd: 1, ap: 5, fx: '<b>x</b>' }, 'Old Gift': { hd: 1, ap: 2 } } }),
  { type: 'buy', cat: 'boon', payload: { v: 'Old Gift' }, cost: 2, level: 1, seq: 6, label: 'Boon — Old Gift' },
  { type: 'creationLocked', seq: 7, ts: 2 }]);
// Dee: still a draft, holds Moon-Hexed.
const DEE = base().concat([{ type: 'buy', cat: 'drawback', payload: { v: 'Moon-Hexed' }, cost: -3, level: 1, seq: 3, label: 'Drawback — Moon-Hexed' }]);
// Eve: finished, an existing override OUTSIDE the server's limits.
const EVE = base().concat([{ type: 'buy', cat: 'skill', payload: { v: 'Athletics' }, cost: 3, level: 1, seq: 3, label: 'Skill' }, { type: 'creationLocked', seq: 4 },
  ov(5, { boons: { 'Too Big': { hd: 1, ap: 2000 } } })]);
const CHARS0 = [
  { id: id(1), name: 'Ana', ap: 0, LOG: ANA },
  { id: id(2), name: 'Dee', ap: 0, LOG: DEE },
  { id: id(3), name: 'Eve', ap: 0, LOG: EVE },
];

const browser = await launchChromium();
const HR = createHouseRulesHarness({ E, CR, CAMP, RULES0, CHARS0, browser, PORT });
const { srv, reset, openDm, applyCalls, browserApLeft, serverApLeft } = HR;
const ctxNow = () => CR.houseRulesCtxFromRules(srv.rules, CAMP);
const logOf = n => srv.chars.find(c => c.id === id(n)).LOG;
const resolved = n => E.resolveHouseRules(E.withHouseRulesCtx(E.foldBuild(logOf(n)), ctxNow()));

async function openRoster() {
  const o = await openDm({ openEditor: false });
  await o.p.evaluate(() => window._dmReloadRoster());
  await o.p.waitForFunction(() => document.querySelectorAll('#campRoster .dm-hr-block').length >= 3, { timeout: 10000 });
  return o;
}
const block = (p, n) => p.evaluate((cid) => {
  const b = document.querySelector('#campRoster .dm-hr-block[data-cid="' + cid + '"]'); if (!b) return null;
  return { rows: [...b.querySelectorAll('.dm-hr-btn[data-name]')].map(x => ({ act: x.getAttribute('data-act'), kind: x.getAttribute('data-kind'), name: x.getAttribute('data-name'),
             text: x.closest('.dm-hr-row').textContent })),
           calls: [...b.querySelectorAll('.dm-hr-call')].map(s => [s.getAttribute('data-key'), s.value, s.options[0].textContent]),
           imgs: b.querySelectorAll('img').length, text: b.textContent };
}, id(n));
const fill = (p, n, f) => p.evaluate(({ cid, f }) => {
  const q = c => document.querySelector('#campRoster .' + c + '[data-cid="' + cid + '"]');
  if (f.kind) q('dm-hr-kind').value = f.kind;
  q('dm-hr-name').value = f.name || ''; q('dm-hr-ap').value = f.ap == null ? '' : String(f.ap);
  q('dm-hr-hd').value = f.hd == null ? '' : String(f.hd); q('dm-hr-fx').value = f.fx || '';
}, { cid: id(n), f });
const press = (p, n, act, kind, name) => p.evaluate(({ cid, act, kind, name }) => {
  window.__alerts.length = 0;
  const b = [...document.querySelectorAll('#campRoster .dm-hr-btn[data-cid="' + cid + '"]')].find(x => x.getAttribute('data-act') === act
    && (kind == null || x.getAttribute('data-kind') === kind) && (name == null || x.getAttribute('data-name') === name));
  if (!b) return false; b.click(); return true;
}, { cid: id(n), act, kind, name });
const review = p => p.waitForFunction(() => { const o = document.getElementById('chrReview'); return o && o.classList.contains('on'); }, { timeout: 8000 }).then(() => true, () => false);
const reviewText = p => p.evaluate(() => document.getElementById('chrReview').textContent);
const apply = async p => { await p.evaluate(() => document.getElementById('chrReviewApply').click());
  await p.waitForFunction(() => document.querySelectorAll('#campRoster .dm-hr-block').length >= 3 && !document.getElementById('chrReview').classList.contains('on'), { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(250); };
const alerts = p => p.evaluate(() => window.__alerts.slice());

// ======================================================================================================================
console.log('The block shows the character\'s overrides, with the value each replaces, escaped');
let { c: ctx, p, errs } = await openRoster();
{
  const b = await block(p, 1);
  check('the override block renders on a campaign character\'s card', !!b);
  check('...four calls, each on "campaign (on)" (no override)', b && b.calls.length === 4 && b.calls.every(c => c[1] === '' && /campaign \(on\)/.test(c[2])), JSON.stringify(b && b.calls));
  const x = b && b.rows.find(r => r.name === XSS);
  check('...the XSS-named override boon is listed, as text', x && b.imgs === 0 && !(await p.evaluate(() => !!window.__xss)), JSON.stringify(x));
  check('...with what it replaces: "only this character has it"', x && /only this character has it/.test(x.text), x && x.text);
}

console.log('Save calls: one RPC call, the whole snapshot, AP unchanged');
{
  const left0 = browserApLeft(logOf(1), srv.rules);
  await p.evaluate((cid) => { document.querySelector('#campRoster .dm-hr-call[data-cid="' + cid + '"][data-key="boons"]').value = 'off'; }, id(1));
  await press(p, 1, 'calls');
  check('a review opens (single holder)', await review(p));
  check('...saying this changes no drawback they hold', /changes no drawback they hold/.test(await reviewText(p)));
  srv.calls.length = 0;
  await apply(p);
  const calls = applyCalls();
  check('exactly ONE dm_apply_house_rules_change call, with NO campaign rules', calls.length === 1 && calls[0].a.chr == null, JSON.stringify(calls.map(c => c.a.chr)));
  const a = calls[0] && calls[0].a.actions;
  check('...ONE override action for Ana: the whole snapshot (Boons off, both custom boons carried over)',
    a && a.length === 1 && a[0].kind === 'override' && a[0].character === id(1) && a[0].overrides.dmAllows.boons === false
    && a[0].overrides.boons[XSS].ap === 5 && a[0].overrides.boons['Old Gift'].ap === 2 && Object.keys(a[0].overrides.dmAllows).length === 1, JSON.stringify(a));
  check('...with nothing the server stamps itself (no seq / ts / dmEdit / campaignId)', a && !('seq' in a[0]) && !('dmEdit' in a[0]) && !('campaignId' in a[0]));
  check('...and `expected` = the snapshot it was built from (the server refuses it if another DM wrote one meanwhile)', a && JSON.stringify(a[0].expected) === JSON.stringify(ANA[4].overrides), JSON.stringify(a && a[0].expected));
  const r = resolved(1);
  check('the engine sees it: Boons OFF for Ana (source: override)', r.dmAllows.boons === false && r.source.dmAllows.boons === 'override', JSON.stringify(r.dmAllows));
  check('...her own house-rules patch (seq 3) is untouched', JSON.stringify(logOf(1)[2]) === JSON.stringify(OWN));
  check('...and AP left did not move', browserApLeft(logOf(1), srv.rules) === left0);
  const b = await block(p, 1);
  check('the card now shows "off for them" for Boons', b && b.calls.find(c => c[0] === 'boons')[1] === 'off', JSON.stringify(b && b.calls));
}

console.log('Set for them: a campaign boon repriced for this character only, inherited value shown');
{
  await fill(p, 1, { kind: 'boon', name: 'Star Ward', ap: 2 });
  await press(p, 1, 'add'); await review(p); srv.calls.length = 0; await apply(p);
  const a = applyCalls()[0] && applyCalls()[0].a.actions[0];
  check('one override with Star Ward at 2 AP, HD from the campaign rule (1)', a && a.overrides.boons['Star Ward'].ap === 2 && a.overrides.boons['Star Ward'].hd === 1, JSON.stringify(a && a.overrides.boons));
  const t = E.effectiveBoonTable(E.withHouseRulesCtx(E.foldBuild(logOf(1)), ctxNow()));
  check('the engine prices Star Ward at 2 for Ana (override) and 4 for Dee (campaign)', t['Star Ward'].ap === 2 && t['Star Ward'].source === 'override'
    && E.effectiveBoonTable(E.withHouseRulesCtx(E.foldBuild(logOf(2)), ctxNow()))['Star Ward'].ap === 4);
  const row = (await block(p, 1)).rows.find(r => r.name === 'Star Ward');
  check('the card shows the value it replaces: "campaign: 4 AP"', row && /campaign: 4 AP/.test(row.text), row && row.text);
}

console.log('A held drawback (refused by #642): single-holder S2 — tick, untick, then apply the current value');
{
  const left0 = browserApLeft(logOf(1), srv.rules);
  await fill(p, 1, { kind: 'draw', name: 'Moon-Hexed', ap: 6 });
  await press(p, 1, 'add'); await review(p);
  const t = await reviewText(p);
  check('the review lists Ana\'s Moon-Hexed 3 → 6 with a tick', /Moon-Hexed/.test(t) && /3 → 6 AP/.test(t) && await p.evaluate(() => document.querySelectorAll('#chrReview .chr-tick').length === 1), t.slice(0, 160));
  await p.evaluate(() => document.querySelector('#chrReview .chr-tick').click());
  const after = await p.evaluate(() => document.querySelector('#chrReview .chr-after').textContent);
  check(`ticking shows AP left ${left0} → ${left0 + 3}`, after === String(left0 + 3), after);
  srv.calls.length = 0; await apply(p);
  const a = applyCalls()[0] && applyCalls()[0].a.actions;
  check('ticked: the override (Moon-Hexed 6, no pin) THEN a reprice {from 3, to 6, amount 3}',
    a && a.length === 2 && a[0].kind === 'override' && a[0].overrides.draws['Moon-Hexed'].ap === 6 && !a[0].overrides.pins
    && a[1].kind === 'reprice' && a[1].targetSeq === 4 && a[1].from === 3 && a[1].to === 6 && a[1].amount === 3, JSON.stringify(a));
  check('...accepted (from / to checked against the override just written)', !(await alerts(p)).some(m => /not saved/i.test(m)), JSON.stringify(await alerts(p)));
  const b1 = browserApLeft(logOf(1), srv.rules), s1 = serverApLeft(logOf(1), srv.rules);
  check(`...AP left ${left0} → ${b1}, browser = server`, b1 === left0 + 3 && b1 === s1, `${b1} / ${s1}`);
  // untick: 6 -> 8, kept at 6 with a pin
  await fill(p, 1, { kind: 'draw', name: 'Moon-Hexed', ap: 8 });
  await press(p, 1, 'add'); await review(p); srv.calls.length = 0; await apply(p);
  const u = applyCalls()[0] && applyCalls()[0].a.actions;
  check('unticked: ONE override with Moon-Hexed 8 AND a pin keeping 6, no reprice',
    u && u.length === 1 && u[0].overrides.draws['Moon-Hexed'].ap === 8 && u[0].overrides.pins.draws['Moon-Hexed'].ap === 6, JSON.stringify(u));
  check('...AP left unchanged, browser = server', browserApLeft(logOf(1), srv.rules) === b1 && serverApLeft(logOf(1), srv.rules) === b1);
  const pinRow = (await block(p, 1)).rows.find(r => r.act === 'unpin');
  check('the card lists the pin ("kept at 6 AP") with "Apply the current value"', pinRow && /kept at 6 AP/.test(pinRow.text), pinRow && pinRow.text);
  check('...and "now" is the value applying it would give: HER rule (8 AP), not the campaign\'s 3', pinRow && /now 8 AP \(your rule for them\)/.test(pinRow.text), pinRow && pinRow.text);
  // apply the current value: removes the pin, tick -> reprice 6 -> 8
  await press(p, 1, 'unpin', 'pin', 'Moon-Hexed'); await review(p);
  await p.evaluate(() => document.querySelector('#chrReview .chr-tick').click());
  srv.calls.length = 0; await apply(p);
  const q = applyCalls()[0] && applyCalls()[0].a.actions;
  check('"Apply the current value", ticked: the override without the pin, then a reprice 6 → 8',
    q && q.length === 2 && !q[0].overrides.pins && q[1].kind === 'reprice' && q[1].from === 6 && q[1].to === 8, JSON.stringify(q));
  const b2 = browserApLeft(logOf(1), srv.rules);
  check('...AP left +2 more, browser = server', b2 === b1 + 2 && b2 === serverApLeft(logOf(1), srv.rules), `${b1} -> ${b2}`);
  // "Apply the current value" left unticked = nothing changes
  await fill(p, 1, { kind: 'draw', name: 'Moon-Hexed', ap: 9 }); await press(p, 1, 'add'); await review(p); await apply(p);   // unticked -> pin 8
  await press(p, 1, 'unpin', 'pin', 'Moon-Hexed'); await review(p); srv.calls.length = 0;
  await p.evaluate(() => document.getElementById('chrReviewApply').click()); await p.waitForTimeout(300);
  check('"Apply the current value" left unticked sends nothing and says so', applyCalls().length === 0 && (await alerts(p)).some(m => /Nothing changed/.test(m)), JSON.stringify(await alerts(p)));
}

console.log('A character still in creation (refused by #642) can be edited; nothing AP-moving is sent');
{
  await fill(p, 2, { kind: 'draw', name: 'Moon-Hexed', ap: 5 });
  await press(p, 2, 'add'); await review(p);
  const t = await reviewText(p);
  check('the review lists Dee\'s drawback, not tickable, with the reason', /creation/.test(t) && await p.evaluate(() => document.querySelectorAll('#chrReview .chr-tick').length === 0), t.slice(0, 200));
  srv.calls.length = 0; await apply(p);
  const a = applyCalls()[0] && applyCalls()[0].a.actions;
  check('...ONE override action, no reprice', a && a.length === 1 && a[0].kind === 'override' && a[0].character === id(2), JSON.stringify(a));
}

console.log('Disable / re-enable for this character');
{
  await fill(p, 1, { kind: 'draw', name: 'Lame' });
  await press(p, 1, 'disable'); await review(p); srv.calls.length = 0; await apply(p);
  const a = applyCalls()[0] && applyCalls()[0].a.actions[0];
  check('Disable sends the snapshot with disabled.draws = [Lame]', a && JSON.stringify(a.overrides.disabled) === JSON.stringify({ draws: ['Lame'] }), JSON.stringify(a && a.overrides.disabled));
  check('...and the engine bars Lame for Ana only', E.effectiveDrawbackTable(E.withHouseRulesCtx(E.foldBuild(logOf(1)), ctxNow())).Lame.allowed === false
    && E.effectiveDrawbackTable(E.withHouseRulesCtx(E.foldBuild(logOf(2)), ctxNow())).Lame.allowed === true);
  await press(p, 1, 'reenable', 'offdraw', 'Lame'); await review(p); srv.calls.length = 0; await apply(p);
  const r = applyCalls()[0] && applyCalls()[0].a.actions[0];
  check('Re-enable sends the snapshot without it', r && !r.overrides.disabled, JSON.stringify(r && r.overrides));
}

console.log('Still refused, sending nothing');
{
  srv.calls.length = 0;
  await press(p, 1, 'calls');   // unchanged
  await p.waitForTimeout(250);
  check('saving the calls unchanged: "Nothing to change", nothing sent', applyCalls().length === 0 && (await alerts(p)).some(m => /Nothing to change/.test(m)));
  await fill(p, 1, { kind: 'boon', name: 'Neg', ap: -1 }); await press(p, 1, 'add'); await p.waitForTimeout(100);
  check('a negative AP is refused', applyCalls().length === 0 && (await alerts(p)).some(m => /0 to 1000/.test(m)));
  await press(p, 1, 'remove', 'boon', 'Old Gift'); await p.waitForTimeout(100);
  check('deleting an override-only custom boon the character HOLDS is refused', applyCalls().length === 0 && (await alerts(p)).some(m => /is on this character/.test(m)), JSON.stringify(await alerts(p)));
  await press(p, 1, 'remove', 'boon', XSS); await review(p); srv.calls.length = 0; await apply(p);
  const a = applyCalls()[0] && applyCalls()[0].a.actions[0];
  check('...but one they do NOT hold is removed from the snapshot', a && !(XSS in (a.overrides.boons || {})) && a.overrides.boons['Old Gift'], JSON.stringify(a && a.overrides.boons));
  // Eve: an existing override outside the limits
  srv.calls.length = 0;
  await fill(p, 3, { kind: 'boon', name: 'Fine', ap: 1 }); await press(p, 3, 'add'); await p.waitForTimeout(150);
  check('an existing override outside the server\'s limits is NAMED, and nothing is sent', applyCalls().length === 0 && (await alerts(p)).some(m => /Too Big/.test(m) && /0 to 1000/.test(m)), JSON.stringify(await alerts(p)));
  await press(p, 3, 'remove', 'boon', 'Too Big'); await review(p); srv.calls.length = 0; await apply(p);
  const e = applyCalls()[0] && applyCalls()[0].a.actions[0];
  check('...removing that override is allowed (an empty snapshot)', e && JSON.stringify(e.overrides) === '{}', JSON.stringify(e && e.overrides));
}

console.log('Two DMs: a card drawn before another DM\'s override is refused, not overwritten');
{
  const ana = srv.chars.find(c => c.id === id(1));
  const before = JSON.stringify(E.foldBuild(ana.LOG)._dmHouseRulesByCampaign[CAMP]);
  const prev = JSON.parse(before), theirs = Object.assign({}, prev, { draws: Object.assign({}, prev.draws, { Lame: { ap: 1 } }) });
  ana.LOG.push({ type: 'dmHouseRules', overrides: theirs, campaignId: CAMP, seq: 90, ts: 9, dmEdit: true, dmId: 'dm2', label: 'other DM' });
  srv.calls.length = 0;
  await fill(p, 1, { kind: 'boon', name: 'Star Ward', ap: 1 });
  await press(p, 1, 'add'); await p.waitForTimeout(300);
  const al = await alerts(p);
  check('the stale card is refused in plain words and nothing is sent', applyCalls().length === 0 && al.some(m => /since this card was drawn/.test(m)), JSON.stringify(al));
  check('...the other DM\'s override is intact', JSON.stringify(E.foldBuild(ana.LOG)._dmHouseRulesByCampaign[CAMP]) === JSON.stringify(theirs));
  await p.waitForFunction(() => document.querySelectorAll('#campRoster .dm-hr-block').length >= 3, { timeout: 8000 });
  await p.waitForTimeout(300);
  const b = await block(p, 1);
  check('...and the roster is redrawn from the fresh snapshot (Lame now listed)', b && b.rows.some(r => r.name === 'Lame'), JSON.stringify(b && b.rows.map(r => r.name)));
}

console.log('Server messages and the archived peek');
{
  srv.refuse = 'PACT house rules: action 1 — that character is archived; un-archive it first';
  await fill(p, 2, { kind: 'boon', name: 'Star Ward', ap: 3 }); await press(p, 2, 'add'); await review(p); await apply(p);
  let al = await alerts(p);
  check('a server refusal: plain words, no raw prefix, "nothing was changed"', al.some(m => /refused/.test(m) && /archived/.test(m) && !/PACT house rules:/.test(m) && /nothing was changed/.test(m)), JSON.stringify(al));
  srv.refuse = null; srv.missing = true;
  await press(p, 2, 'add'); await review(p); await apply(p);
  al = await alerts(p);
  check('an un-migrated server: a plain-language message, not the raw error', al.some(m => /has not been updated/.test(m) && !/PGRST|schema cache/.test(m)), JSON.stringify(al));
  srv.calls.length = 0;
  await press(p, 2, 'add'); await p.waitForTimeout(200);
  check('...after which the editor says so straight away, without calling again', applyCalls().length === 0 && (await alerts(p)).some(m => /has not been updated/.test(m)));
  srv.missing = false;
  await p.evaluate(() => { window.__blocked = 0; window._dmPeekActive = true; window._dmPeekBlocks = () => { window.__blocked++; }; });
  await press(p, 1, 'calls');
  check('in an archived-campaign peek nothing is sent, through the shared peek guard', applyCalls().length === 0 && await p.evaluate(() => window.__blocked === 1));
  await p.evaluate(() => { window._dmPeekActive = false; });
}
check('no XSS fired in the console', !(await p.evaluate(() => !!window.__xss)));
check('DM Console: no fatal page errors', errs.filter(e => !NOISE.test(e)).length === 0, errs.filter(e => !NOISE.test(e)).slice(0, 3).join(' | '));
await ctx.close();

// ======================================================================================================================
console.log('CharGen: the player sees the DM\'s override, and the own patch is untouched');
{
  const gc = await browser.newContext(); const gp = await gc.newPage(); const gerrs = []; gp.on('pageerror', e => gerrs.push(String(e)));
  await gp.goto(`http://localhost:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' });
  await gp.waitForFunction(() => window.DATA && typeof window._cgApplyEnvelope === 'function', { timeout: 25000 });
  await gp.waitForTimeout(600);
  const log = logOf(1);
  const r = await gp.evaluate(({ log, cid, camp, rules }) => {
    window._cgApplyEnvelope({ schema: 'pact-character/1', rules: window.DATA.version, name: 'Ana', LOG: log, SEQ: log.length + 20, id: cid }, { clearHistory: true });
    window._cgCampaignId = camp; window._cgCampaignBound = true; window._cgBindingConfirmed = true;
    window._dmApStatus = 'active'; window._dmAp = 0; window._ignorePlayerAp = false;
    window._cloudCampaign = { id: camp, name: 'Camp', rules };
    render();
    const own = LOG.filter(e => e.type === 'buy' && e.cat === 'patch' && e._slot === 'houseRules');
    return { star: effBoons()['Star Ward'], own: JSON.stringify(own), n: LOG.length, added: LOG.slice(log.length).map(e => e.type + (e.cat ? '/' + e.cat : '') + (e._slot ? '/' + e._slot : '')), ap: compute(readBuild(), _cgDmOpts()).spendable - economy(LOG).spent };
  }, { log, cid: id(1), camp: CAMP, rules: srv.rules });
  check('CharGen prices Star Ward at the DM\'s override for Ana (2 AP)', r.star && r.star.ap === 2 && r.star.source === 'override', JSON.stringify(r.star));
  // CharGen's loader appends its own bookkeeping to an envelope it opens (a `name` event, a `creationLockConfig`) — nothing else.
  check('...the character\'s own house-rules patch is byte-identical, and no patch or DM event was appended',
    r.own === JSON.stringify([OWN]) && r.added.every(t => t === 'name' || t === 'creationLockConfig'), JSON.stringify(r.added));
  check('...and its AP left = the console\'s / the server\'s', r.ap === browserApLeft(log, srv.rules) && r.ap === serverApLeft(log, srv.rules), String(r.ap));
  check('CharGen: no page errors', gerrs.filter(e => !NOISE.test(e)).length === 0, gerrs.join(' | '));
  await gc.close();
}

await browser.close();
server.close();
await HR.writeDump(fs);
console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} passed / ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
