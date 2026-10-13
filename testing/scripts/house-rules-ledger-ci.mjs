#!/usr/bin/env node
/**
 * house-rules-ledger-ci.mjs — the engine gate for CAMPAIGN-WIDE HOUSE RULES (feat/campaign-house-rules-engine,
 * D-GH-2026-10-13-campaign-house-rules, plan §12 (e)(f)(g)(h) + addendum M5/M6/W1).
 *
 * The parity fixtures CG-071..075 / EV-034..039 pin what compute() and economy() say for one log each. This gate
 * covers what a fixture cannot:
 *   (e)  priceOf()'s drawback pricer returns the EFFECTIVE value (own / campaign / override / pin), and (M6) that a
 *        SOLO character's own house-ruled drawback is now stamped at its own value — a behaviour change, on purpose.
 *   W1   drawbackBuyoffQuote(): 3x (or the DM's rate) of the CURRENT EFFECTIVE value, so a custom drawback no
 *        longer buys off for 0.
 *   (g)  repriceDraft(events, {houseRulesCtx}) prices a campaign draft's boons at campaign prices; without the
 *        option it is byte-identical; a DM-stamped buy is never re-costed (plan §6.5 option (a)).
 *   (h)  campaign Tasha off: an OWNED non-core item is explained without a ⛔, a NEW one is refused by
 *        purchaseLegality() with a ⛔.
 *        resolveHouseRules / effective tables / houseRulesImpact (incl. drawbackCap, M5) unit cases.
 *   (f)  THE LEDGER INVARIANT, fuzzed: over random campaign histories in which a DM changes the campaign's drawback
 *        values (S2: tick = dmRepriceDrawback, untick = pin), removes drawbacks / refunds boons (T2), awards DM AP,
 *        flips ignore-player-AP and the cap, the BROWSER's AP left (compute().spendable − economy().spent, D-GH30)
 *        equals an INDEPENDENT JS port of the server ledger (pact_ap_ledger_split + pact_hr_resolve + pact_hr_drawback_cap +
 *        the budget trigger, as sql/migrations/2026-10-13-campaign-house-rules-server.sql defines them), and equals the
 *        engine's own serverApLedger() model. One scoped exception, asserted in its own DIRECTION rather than skipped:
 *        Non-matching DM events (bad / stale / ambiguous targets, non-finite amounts) stay IN the compared log: the server,
 *        like the engine, counts a DM AP event only when it matches its target (PR #654 review).
 *          - a log with an UNTARGETED player buyoff (no targetSeq naming the purchase it cancels): the SQL keeps that
 *            bought-off drawback's grant (the old, accepted approximation), so the server is MORE lenient — asserted
 *            server ≥ browser. Targeted buyoffs (M4) and campaigns whose DM switched the cap off (owner decision Z1)
 *            are in the strict scope.
 *        With --dump-logs FILE it writes every history and the port's sums; run-house-rules.sh feeds them to the real SQL.
 *   Z1   the server cap rule == js/campaign.js drawbackCapFromRules() on the 45 shapes the SQL harness also checks.
 *        F4(a) (CharGen's cost-0 drawback events, Y1, out of scope) is excluded by construction: every drawback
 *        here is stamped at priceOf(), which is the behaviour this PR gives the Live Sheet.
 *
 * Run:  node testing/scripts/house-rules-ledger-ci.mjs [--iterations N] [--seed N] [--engine path/to/engine.js]
 * Exit 0 = all pass. Node built-ins only.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const ITER = parseInt(arg('iterations', '400'), 10);
const SEED = parseInt(arg('seed', '20261013'), 10);
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const E = await import(pathToFileURL(resolve(arg('engine', resolve(REPO, 'js/engine.js')))).href);
const { DATA, compute, foldBuild, economy, priceOf, purchaseLegality, repriceDraft, withHouseRulesCtx,
        resolveHouseRules, effectiveBoonTable, effectiveDrawbackTable, drawbackValue, drawbackBuyoffQuote,
        houseRulesImpact, serverApLedger } = E;

let pass = 0, fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  if (!ok || process.env.VERBOSE) console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};
const section = s => console.log(s);

// ---------------------------------------------------------------------------------------------------------------
// The INDEPENDENT server-ledger port. Written from sql/migrations/2026-10-13-campaign-house-rules-server.sql
// (pact_ap_ledger_split + pact_hr_resolve + pact_hr_drawback_cap + pact_enforce_ap_budget_consistency) — kept
// deliberately separate from js/engine.js's serverApLedger() so the two check each other.
//   award -> award_earned; buy/drawback -> drawback_earned += -cost; buyoff|names|buy(non-patch) -> spent += cost.
//   §6.4 + M1: dmRefundBoon -> spent += cost; dmRemoveDrawback -> drawback_earned -= grantBack;
//              dmRepriceDrawback -> drawback_earned += amount — each ONLY when dmEdit = true.
//   M4: a buyoff whose targetSeq equals the seq of the purchase its FIFO match cancels nets that purchase's
//       -cost + (sum of DM reprice amounts aimed at it before the buyoff) out of drawback_earned.
//   X1 + Z1: spendable = ap + (ignore ? 0 : award_earned) + (cap == null ? drawback_earned : least(cap, drawback_earned)),
//       cap = rules.drawbackCap.ap (Number(), max 0) when the drawbackCap object is present and not enabled:false, else none.
// ---------------------------------------------------------------------------------------------------------------
function sqlCap(rules) {                  // pact_hr_drawback_cap: mirrors js/campaign.js drawbackCapFromRules (Z1)
  const c = rules && rules.drawbackCap;
  if (!c || typeof c !== 'object' || Array.isArray(c) || c.enabled === false) return null;
  const n = Number(c.ap);
  return Number.isFinite(n) ? Math.max(0, n) : null;
}
function sqlLedgerPort(log, { dmAp = 0, ignorePlayerAp = false, capRule = null, chr = null, campaignId = null } = {}) {
  const { spent, award, draw } = sqlLedgerParts(log, chr, campaignId);
  const cap = sqlCap({ drawbackCap: capRule });
  return dmAp + (ignorePlayerAp ? 0 : award) + (cap == null ? draw : Math.min(cap, draw)) - spent;
}
// pact_hr_drawback_effective(name, charHouseRules, override): pin > override > campaign > printed (pact_drawback_printed,
// generated from DATA.drawbacks), 0 for an unknown name or an Object.prototype property name.
const PROTO_NAMES = new Set(['__proto__', 'constructor', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString',
  'toString', 'valueOf', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__']);
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const own = (o, k) => isObj(o) && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;
function sqlEffective(name, chr, ov) {
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  if (name == null || PROTO_NAMES.has(name)) return 0;
  if (isObj(ov)) {
    const pin = isObj(ov.pins) ? own(own(ov.pins, 'draws'), name) : undefined;
    if (isObj(pin) && Number.isFinite(Number(pin.ap))) return Number(pin.ap);
    const od = own(ov.draws, name); if (isObj(od)) return num(od.ap);
  }
  if (isObj(chr)) { const cd = own(chr.draws, name); if (isObj(cd)) return num(cd.ap); }
  const pr = own(DATA.drawbacks, name); return pr == null ? 0 : Number(pr);
}
function sqlLedgerParts(log, chr = null, campaignId = null) {     // pact_ap_ledger_split(log, chr, campaign)
  let spent = 0, award = 0, draw = 0;
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const fin = v => Number.isFinite(Number(v));
  const truthy = v => !(v === undefined || v === null || v === false || v === 0 || v === '');
  const evs = log.filter(Boolean);
  // pact_hr_resolve: one forward pass. Drawback/boon queues by name (FIFO), 'seq|name' maps per category (-1 = shared),
  // statuses, ΣΔ of matched reprices, which DM events matched and which purchase each buyoff cancelled.
  const N = () => Object.create(null);   // jsonb objects have no prototype: neither may these name-keyed maps
  const dq = N(), bq = N(), dmap = N(), bmap = N(), status = {}, delta = {}, buyoffOf = new Map();
  const drop = (q, j) => { if (q) { const x = q.indexOf(j); if (x >= 0) q.splice(x, 1); } };
  evs.forEach((ev, i) => {
    if (typeof ev !== 'object') return;
    const type = ev.type, cat = ev.cat == null ? '' : ev.cat;
    if (type === 'award') award += num(ev.amount);
    else if (type === 'buy' && cat === 'drawback') { /* per purchase, below */ }
    else if (type === 'buyoff' || type === 'names' || (type === 'buy' && cat !== 'patch')) spent += num(ev.cost);
    if (type === 'buy' && (cat === 'drawback' || cat === 'boon') && ev.payload && ev.payload.v != null) {
      const v = String(ev.payload.v), Q = cat === 'drawback' ? dq : bq, M = cat === 'drawback' ? dmap : bmap;
      (Q[v] = Q[v] || []).push(i); status[i] = 'open'; delta[i] = 0;
      if (ev.seq != null) { const k = ev.seq + '|' + v; M[k] = (k in M) ? -1 : i; }
    } else if ((type === 'dmRemoveDrawback' || type === 'dmRepriceDrawback' || type === 'dmRefundBoon')
               && ev.dmEdit === true && ev.refVal != null && ev.targetSeq != null) {
      const amt = type === 'dmRemoveDrawback' ? ev.grantBack : type === 'dmRepriceDrawback' ? ev.amount : ev.cost;
      if (amt != null && !fin(amt)) return;
      if (type !== 'dmRemoveDrawback' && !fin(amt)) return;
      const j = (type === 'dmRefundBoon' ? bmap : dmap)[ev.targetSeq + '|' + ev.refVal];
      if (j == null || j < 0 || status[j] !== 'open') return;
      if (type === 'dmRepriceDrawback') delta[j] += Number(amt);
      else if (type === 'dmRemoveDrawback') { status[j] = 'removed'; drop(dq[String(ev.refVal)], j); }
      else { status[j] = 'refunded'; drop(bq[String(ev.refVal)], j); spent += num(ev.cost); }
    } else if (type === 'buyoff' && ev.refVal != null) {
      const q = dq[String(ev.refVal)];
      if (q && q.length) { const j = q.shift(); status[j] = 'boughtOff'; buyoffOf.set(i, j); }
    } else if (type === 'dmRemoveBoon' && ev.refVal != null) {
      const q = bq[String(ev.refVal)];
      if (q && q.length) { const j = q.shift(); status[j] = 'dmRemoved'; }
    }
  });
  const netted = new Set();
  for (const [i, j] of buyoffOf) { const ev = evs[i], p = evs[j]; if (ev.targetSeq != null && p.seq != null && String(p.seq) === String(ev.targetSeq)) netted.add(j); }
  let ov = null;
  if (campaignId) for (const e of evs) if (isObj(e) && e.type === 'dmHouseRules' && e.dmEdit === true && typeof e.campaignId === 'string'
      && e.campaignId === campaignId && isObj(e.overrides)) ov = e.overrides;
  const openNames = new Set();   // F1: one grant per name among the open copies (the oldest)
  evs.forEach((ev, i) => {
    if (!isObj(ev) || ev.type !== 'buy' || (ev.cat == null ? '' : ev.cat) !== 'drawback') return;
    if (truthy(ev.dmEdit) && num(ev.cost) >= 0) return;                         // imposed
    if (!(i in status)) { draw += Math.min(-num(ev.cost), 0); return; }          // no name
    if (status[i] === 'removed' || netted.has(i)) return;
    if (status[i] === 'open') { const nm = String(ev.payload.v); if (openNames.has(nm)) return; openNames.add(nm); }
    draw += Math.min(-num(ev.cost) + delta[i], sqlEffective(String(ev.payload.v), chr, ov));
  });
  return { spent, award, draw };
}

// --dump-logs FILE: every generated history (with and without its junk events) and what this port says
// pact_ap_ledger_split returns for it. run-house-rules.sh feeds the file to the REAL SQL, so the port, the engine's
// serverApLedger() and the database are all checked against each other on the same random logs.
const DUMP = arg('dump-logs', null), dumped = [];
// The log as the database would store it: a JSON round trip (Infinity/NaN become null, exactly as a client's save would).
// 'camp-A' becomes a uuid there (the SQL takes the campaign as a uuid), in the log and in the campaign id alike.
const CAMP_UUID = 'c0ffee00-0000-4000-8000-00000000000a';
const dumpLog = (L, chr, campaignId) => { if (DUMP) {
  const J = JSON.parse(JSON.stringify(L).split('"camp-A"').join(JSON.stringify(CAMP_UUID)));
  const cid = campaignId === 'camp-A' ? CAMP_UUID : campaignId;
  const p = sqlLedgerParts(J, chr, cid); dumped.push({ log: J, chr, campaign: cid, spent: p.spent, award: p.award, draw: p.draw }); } };

const STM = 'Slow to Mend';               // printed 5, no stat cap / caster gate / wound flag
const ctx = (rules, id = 'camp-A', bans) => ({ campaignId: id, rules, bans: bans || { boons: [], draws: [] } });
const DM = 'dm-1';
const dmE = o => Object.assign({ dmEdit: true, dmId: DM, campaignId: 'camp-A' }, o);
const ovr = (overrides, cid = 'camp-A', seq = 50) => ({ type: 'dmHouseRules', campaignId: cid, overrides, seq, dmEdit: true, dmId: DM });
const patchHR = (hr, seq = 3) => ({ type: 'buy', cat: 'patch', _slot: 'houseRules', payload: { patch: { houseRules: hr } }, cost: 0, seq });
const award = (amount, seq) => ({ type: 'award', amount, seq });
const fighter = { type: 'buy', cat: 'oclass', payload: { v: 'Fighter' }, cost: 0, seq: 2 };

// ================================================================================================================
section('Z1 — the server cap rule == js/campaign.js drawbackCapFromRules() on every shape the SQL harness checks');
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(resolve(REPO, 'js/campaign.js'), 'utf8').match(/export function drawbackCapFromRules\(rules\) \{[\s\S]*?\n\}\n/);
  const real = new Function('return ' + src[0].replace('export ', ''))();
  const shapes = JSON.parse(readFileSync(resolve(REPO, 'testing/scripts/creation-lock-guard-test/drawback-cap-shapes.json'), 'utf8'));
  const eff = r => { const c = real(r); return Number.isFinite(c) ? Math.max(0, c) : null; };
  t(`all ${shapes.length} shapes: the real function still gives the recorded cap`, shapes.filter(x => eff(x.rules) !== x.cap).map(x => x.rules), []);
  t(`all ${shapes.length} shapes: the SQL port agrees`, shapes.filter(x => sqlCap(x.rules) !== x.cap).map(x => x.rules), []);
  t('serverApLedger: no drawbackCap -> uncapped (Z1), not DATA.drawbackCap',
    serverApLedger([{ type: 'buy', cat: 'drawback', payload: { v: 'A' }, cost: -20, seq: 1 }], { houseRulesCtx: ctx({ draws: { A: { ap: 20 } } }) }).drawbackGranted, 20);
  t('serverApLedger: cap 4', serverApLedger([{ type: 'buy', cat: 'drawback', payload: { v: 'A' }, cost: -20, seq: 1 }], { drawbackCap: 4, houseRulesCtx: ctx({ draws: { A: { ap: 20 } } }) }).drawbackGranted, 4);
}

section('M4 — a targeted buyoff nets out exactly the purchase FIFO cancels');
{
  const L = [{ type: 'award', amount: 10, seq: 1 }, { type: 'buy', cat: 'drawback', payload: { v: 'A' }, cost: -5, seq: 2 },
    dmE({ type: 'dmRepriceDrawback', refVal: 'A', targetSeq: 2, amount: 2, from: 5, to: 7, seq: 3 }),
    { type: 'buyoff', refVal: 'A', targetSeq: 2, cost: 21, seq: 4 }];
  t('netted incl. ΣΔ (engine model)', serverApLedger(L).drawbackEarned, 0);
  t('netted incl. ΣΔ (port)', sqlLedgerParts(L).draw, 0);
  t('activeEvents().buyoffTarget maps the buyoff to its purchase', [...E.activeEvents(L).buyoffTarget], [[3, 1]]);
  const U = L.map(e => e.type === 'buyoff' ? { type: 'buyoff', refVal: 'A', cost: 21, seq: 4 } : e);
  const A7 = ctx({ draws: { A: { ap: 7 } } }), A5 = ctx({ draws: { A: { ap: 5 } } });
  t('untargeted: the grant stays (old approximation)', [serverApLedger(U, { houseRulesCtx: A7 }).drawbackEarned, sqlLedgerParts(U, A7.rules, 'camp-A').draw], [7, 7]);
  const W = [{ type: 'buy', cat: 'drawback', payload: { v: 'A' }, cost: -5, seq: 1 }, { type: 'buy', cat: 'drawback', payload: { v: 'A' }, cost: -4, seq: 2 },
    { type: 'buyoff', refVal: 'A', targetSeq: 2, cost: 12, seq: 3 }];
  t('a targetSeq that is not the FIFO purchase nets nothing', [serverApLedger(W, { houseRulesCtx: A5 }).drawbackEarned, sqlLedgerParts(W, A5.rules, 'camp-A').draw], [9, 9]);
  // PR #654 review (ATK1): a refund whose target was renumbered matches nothing — and then counts on NEITHER side.
  const R = [{ type: 'award', amount: 10, seq: 1 }, { type: 'buy', cat: 'boon', payload: { v: 'Bulwark' }, cost: 10, seq: 200 },
    dmE({ type: 'dmRefundBoon', refVal: 'Bulwark', targetSeq: 2, cost: -10, seq: 3 })];
  t('an un-matched refund: engine model spends 10, port spends 10', [serverApLedger(R).spent, sqlLedgerParts(R).spent], [10, 10]);
  t('…and matched it refunds on both', [serverApLedger(R.map(e => e.seq === 200 ? Object.assign({}, e, { seq: 2 }) : e)).spent,
    sqlLedgerParts(R.map(e => e.seq === 200 ? Object.assign({}, e, { seq: 2 }) : e)).spent], [0, 0]);
  t('sealedFloor: a DM refund is a floor (repriceDraft never re-costs under it)', E.sealedFloor([{ type: 'buy', cat: 'boon', payload: { v: 'B' }, cost: 6, seq: 1 },
    dmE({ type: 'dmRefundBoon', refVal: 'B', targetSeq: 1, cost: -6, seq: 2 }), { type: 'buy', cat: 'skill', payload: { v: 'Arcana' }, cost: 1, seq: 3 }]), 2);
  t('sealedFloor: an unstamped (no dmEdit) refund is no floor', E.sealedFloor([{ type: 'buy', cat: 'boon', payload: { v: 'B' }, cost: 6, seq: 1 },
    { type: 'dmRefundBoon', refVal: 'B', targetSeq: 1, cost: -6, seq: 2 }]), 0);
}

// ================================================================================================================
section('AB1 — a drawback grants at most its effective value; an unknown name grants nothing');
{
  const D = (v, cost, seq, extra) => Object.assign({ type: 'buy', cat: 'drawback', payload: { v }, cost, seq }, extra || {});
  const both = (L, c) => [serverApLedger(L, { houseRulesCtx: c }).drawbackEarned, sqlLedgerParts(L, c ? c.rules : null, c ? c.campaignId : null).draw];
  const P = DATA.drawbacks[STM];
  t('a forged made-up name grants 0', both([D('Totally Fake', -1000, 1)], ctx({})), [0, 0]);
  t('a real name at an inflated cost grants its printed value', both([D(STM, -1000, 1)], ctx({})), [P, P]);
  t('a real name stamped BELOW its value (CharGen cost 0, F4a) grants what was stamped', both([D(STM, 0, 1)], ctx({})), [0, 0]);
  t('a campaign custom drawback grants its campaign value', both([D('Hexed Custom', -4, 1)], ctx({ draws: { 'Hexed Custom': { ap: 4 } } })), [4, 4]);
  t('…and 0 once the DM deletes it from the campaign (engine: no entry, no printed value)', both([D('Hexed Custom', -4, 1)], ctx({})), [0, 0]);
  t('a deleted REPRICE of a printed one falls back to the printed value', both([D(STM, -9, 1)], ctx({})), [P, P]);
  t('an override for this campaign counts; for another campaign not', [both([D('X', -6, 1), ovr({ draws: { X: { ap: 6 } } })], ctx({})),
    both([D('X', -6, 1), ovr({ draws: { X: { ap: 6 } } }, 'camp-B')], ctx({}))], [[6, 6], [0, 0]]);
  t('a pin beats the override', both([D('X', -6, 1), ovr({ draws: { X: { ap: 6 } }, pins: { draws: { X: { ap: 2 } } } })], ctx({})), [2, 2]);
  t('an override WITHOUT dmEdit is ignored', both([D('X', -6, 1), Object.assign(ovr({ draws: { X: { ap: 6 } } }), { dmEdit: false })], ctx({})), [0, 0]);
  t('an imposed drawback grants 0 whatever its name', both([D(STM, 0, 1, { dmEdit: true, dmLocked: true })], ctx({})), [0, 0]);
  t('a DM-granted (dmEdit, cost < 0) one is a normal grant', both([D(STM, -P, 1, { dmEdit: true })], ctx({})), [P, P]);
  t('an Object.prototype name grants 0', both([D('toString', -5, 1), D('constructor', -5, 2)], ctx({ draws: {} })), [0, 0]);
  // F1 (round-2 review): two OPEN player copies of one name grant once — browser, model and port alike.
  const dup = [award(10, 1), fighter].concat(Array.from({ length: 20 }, (_, k) => D(STM, -P, 10 + k)));
  t('F1: 20 copies of one drawback grant once (model, port)', both(dup, ctx({})), [P, P]);
  t('F1: …and once in the browser (compute)', compute(withHouseRulesCtx(foldBuild(dup), ctx({}))).drawbackAp, P);
  t('F1: …and in economy()', economy(dup).drawbackEarned, P);
  const retake = [award(10, 1), D(STM, -P, 2), { type: 'buyoff', refVal: STM, targetSeq: 2, cost: 3 * P, seq: 3 }, D(STM, -P, 4)];
  t('F1: a bought-off copy then a retake: the retake grants (the first is closed)', [both(retake, ctx({})), compute(withHouseRulesCtx(foldBuild(retake), ctx({}))).drawbackAp], [[P, P], P]);
  t('F1: an imposed copy beside a player copy: the player copy grants', both([D(STM, -P, 1), D(STM, 0, 2, { dmEdit: true, dmLocked: true })], ctx({})), [P, P]);
  t('F5: houseRulesImpact emits no reprice with ledgerDelta 0', (() => { const L = [award(79, 1), fighter, { type: 'creationLocked', seq: 3 }, D(STM, -3, 4),
      dmE({ type: 'dmRepriceDrawback', refVal: STM, targetSeq: 4, amount: 2, from: 3, to: 5, seq: 5 })];
    const [r] = houseRulesImpact([{ id: 'x', LOG: L }], ctx({ draws: { [STM]: { ap: 3 } } }), ctx({ draws: { [STM]: { ap: 5 } } }));
    return 'repriceEvent' in r.purchases[0]; })(), false);
  t('the engine\'s browser grant agrees on the deleted custom', compute(withHouseRulesCtx(foldBuild([award(79, 1), fighter, D('Hexed Custom', -4, 3)]), ctx({}))).drawbackAp, 0);
}

// ================================================================================================================
section('(e) + M6 — priceOf("drawback") prices at the EFFECTIVE value');
{
  const solo = foldBuild([award(79, 1), fighter, patchHR({ draws: { [STM]: { ap: 7 }, 'Bad Luck Charm': { ap: 4 } } })]);
  t('solo, own repriced built-in: -7 (was -5 from DATA alone)', priceOf(solo, 'drawback', { v: STM }), -7);
  t('M6 solo, own CUSTOM drawback: -4 (was 0 — DATA has no entry)', priceOf(solo, 'drawback', { v: 'Bad Luck Charm' }), -4);
  t('solo, untouched drawback: printed', priceOf(solo, 'drawback', { v: 'Slow-Footed' }), -(DATA.drawbacks['Slow-Footed']));
  const inC = withHouseRulesCtx(foldBuild([award(79, 1), fighter, patchHR({ draws: { [STM]: { ap: 7 } } })]), ctx({ draws: { [STM]: { ap: 3 } } }));
  t('campaign value beats own patch', priceOf(inC, 'drawback', { v: STM }), -3);
  const inC0 = withHouseRulesCtx(foldBuild([award(79, 1), fighter, patchHR({ draws: { 'Bad Luck Charm': { ap: 4 } } })]), ctx({}));
  t('in a campaign that lacks the own custom drawback: 0 (unknown to the campaign)', priceOf(inC0, 'drawback', { v: 'Bad Luck Charm' }), -0);
  const ov = withHouseRulesCtx(foldBuild([award(79, 1), fighter, ovr({ draws: { [STM]: { ap: 9 } } })]), ctx({ draws: { [STM]: { ap: 3 } } }));
  t('DM override for this campaign beats the campaign', priceOf(ov, 'drawback', { v: STM }), -9);
  const ovB = withHouseRulesCtx(foldBuild([award(79, 1), fighter, ovr({ draws: { [STM]: { ap: 9 } } }, 'camp-B')]), ctx({ draws: { [STM]: { ap: 3 } } }));
  t('override for ANOTHER campaign is ignored', priceOf(ovB, 'drawback', { v: STM }), -3);
  const pin = withHouseRulesCtx(foldBuild([award(79, 1), fighter, ovr({ draws: { [STM]: { ap: 9 } }, pins: { draws: { [STM]: { ap: 5 } } } })]), ctx({ draws: { [STM]: { ap: 3 } } }));
  t('a pin beats the override draws entry', priceOf(pin, 'drawback', { v: STM }), -5);
  const forged = withHouseRulesCtx(foldBuild([award(79, 1), fighter, Object.assign(ovr({ draws: { [STM]: { ap: 9 } } }), { dmEdit: false })]), ctx({ draws: { [STM]: { ap: 3 } } }));
  t('an override WITHOUT dmEdit is ignored', priceOf(forged, 'drawback', { v: STM }), -3);
  t('drawbackValue agrees with compute()\'s grant', drawbackValue(ov, STM), compute(withHouseRulesCtx(foldBuild([award(79, 1), fighter, ovr({ draws: { [STM]: { ap: 9 } } }), { type: 'buy', cat: 'drawback', payload: { v: STM }, cost: -9, seq: 60 }]), ctx({ draws: { [STM]: { ap: 3 } } }))).drawbackAp);
  t('opts.houseRulesCtx (explicit null) forces solo even with a stamp', compute(Object.assign(foldBuild([award(79, 1), fighter, patchHR({ draws: { [STM]: { ap: 7 } } }), { type: 'buy', cat: 'drawback', payload: { v: STM }, cost: -7, seq: 9 }]), { _hrCtx: ctx({}) }), { houseRulesCtx: null }).drawbackAp, 7);
}

section('W1 — buy-off base is the current effective value');
{
  const solo = foldBuild([award(79, 1), fighter, patchHR({ draws: { 'Bad Luck Charm': { ap: 4 } } })]);
  t('player-taken custom drawback: 3 × 4 = 12 (was 0)', drawbackBuyoffQuote(solo, 'Bad Luck Charm', { type: 'buy', cat: 'drawback', payload: { v: 'Bad Luck Charm' }, cost: -4 }), { base: 4, rate: 3, cost: 12 });
  const camp = withHouseRulesCtx(foldBuild([award(79, 1), fighter]), ctx({ draws: { [STM]: { ap: 2 } } }));
  t('campaign repriced built-in: 3 × 2', drawbackBuyoffQuote(camp, STM, { cost: -5 }).cost, 6);
  t('DM-imposed, flat rate: 1 × value', drawbackBuyoffQuote(camp, STM, { dmEdit: true, dmRemovalCost: 'flat', cost: 0 }), { base: 2, rate: 1, cost: 2 });
  t('DM-imposed, expensive: 3 × value', drawbackBuyoffQuote(camp, STM, { dmEdit: true, dmRemovalCost: 'expensive', cost: 0 }).cost, 6);
}

section('(g) repriceDraft(events, {houseRulesCtx})');
{
  const draft = [award(79, 1), fighter,
    { type: 'buy', cat: 'boon', payload: { v: 'Bulwark' }, cost: 6, seq: 3 },
    { type: 'buy', cat: 'boon', payload: { v: 'Deft Catch' }, cost: 3, seq: 4 }];
  const camp = ctx({ boons: { Bulwark: { hd: 1, ap: 10 } } });
  t('no opts: byte-identical to the one-argument call', JSON.stringify(repriceDraft(draft, undefined)), JSON.stringify(repriceDraft(draft)));
  t('houseRulesCtx null: byte-identical too', JSON.stringify(repriceDraft(draft, { houseRulesCtx: null })), JSON.stringify(repriceDraft(draft)));
  const rp = repriceDraft(draft, { houseRulesCtx: camp });
  t('campaign draft: Bulwark re-costed at the campaign price 10', rp[2].cost, 10);
  t('campaign draft: Deft Catch at its printed price', rp[3].cost, DATA.boons['Deft Catch'].ap);
  const withOv = draft.concat([ovr({ boons: { Bulwark: { hd: 1, ap: 12 } } }, 'camp-A', 9)]);
  t('a DM override LATER in the log prices the earlier boon too (one pricing context)', repriceDraft(withOv, { houseRulesCtx: camp })[2].cost, 12);
  // Two overrides around a buy: the LAST one is today's price. Regression (PR #648 review): the walk's final-override
  // map was shared by reference, so _replay wrote the earlier snapshot into it and the boon was re-costed at 20.
  const twoOv = [award(79, 1), { type: 'buy', cat: 'create', payload: {}, cost: 0, seq: 5 }, ovr({ boons: { Bulwark: { hd: 1, ap: 20 } } }, 'camp-A', 2),
    { type: 'buy', cat: 'boon', payload: { v: 'Bulwark' }, cost: 6, seq: 3 }, ovr({ boons: { Bulwark: { hd: 1, ap: 1 } } }, 'camp-A', 4)];
  t('two overrides around a buy: the boon re-costs at the LAST override (1), not the earlier one (20)', repriceDraft(twoOv, { houseRulesCtx: ctx({}) })[3].cost, 1);
  t('…and a second call agrees (no state leaks between calls)', repriceDraft(twoOv, { houseRulesCtx: ctx({}) })[3].cost, 1);
  t('…and the input log keeps its own two snapshots', [twoOv[2].overrides.boons.Bulwark.ap, twoOv[4].overrides.boons.Bulwark.ap], [20, 1]);
  const dmGrant = [award(79, 1), fighter,
    { type: 'buy', cat: 'boon', payload: { v: 'Bulwark' }, cost: 0, seq: 3, dmEdit: true, dmId: DM },
    { type: 'award', amount: 0, seq: 4, dmEdit: true, dmId: DM, disc: true },
    { type: 'buy', cat: 'boon', payload: { v: 'Deft Catch' }, cost: 0, seq: 5 }];
  const rg = repriceDraft(dmGrant);
  t('§6.5(a): a DM-stamped buy keeps its frozen cost in a draft', rg[2].cost, 0);
  t('…and the purchase after it still prices as its own delta', rg[4].cost, DATA.boons['Deft Catch'].ap);
  t('input not mutated', dmGrant[2].cost, 0);
}

section('(h) campaign Tasha off — owned kept, new refused');
{
  const owned = withHouseRulesCtx(Object.assign(foldBuild([award(79, 1), { type: 'buy', cat: 'oclass', payload: { v: 'Warlock' }, cost: 0, seq: 2 },
    { type: 'buy', cat: 'feature', payload: { v: 'Warlock: Pact of the Talisman' }, cost: 4, seq: 3 }])), ctx({ dmAllows: { tasha: false } }));
  const w = compute(owned).warnings;
  t('owned non-core: no ⛔ Tasha warning in a campaign', w.filter(x => /non-core/.test(x) && /^⛔/.test(x)).length, 0);
  t('owned non-core: the kept-text is there', w.some(x => /barred for new purchases by your campaign \(kept: you owned it before\)/.test(x)), true);
  const pl = purchaseLegality(owned, 'feature', { v: 'Warlock: Grasp of Hadar' });
  t('NEW non-core purchase is hard-blocked', pl.hard.some(x => /^⛔ Grasp of Hadar: non-core/.test(x)), true);
  t('…and the owned item does not count as new', pl.hard.some(x => /Pact of the Talisman/.test(x)), false);
  const soloT = Object.assign(foldBuild([award(79, 1), { type: 'buy', cat: 'oclass', payload: { v: 'Warlock' }, cost: 0, seq: 2 }, { type: 'tasharule', seq: 3 },
    { type: 'buy', cat: 'tasharule', payload: { v: false }, cost: 0, seq: 4 }]));
  t('solo Tasha off: a new non-core purchase is refused with the solo wording', purchaseLegality(soloT, 'feature', { v: 'Warlock: Grasp of Hadar' }).hard.some(x => /barred by DM house rules/.test(x)), true);
  const allowed = withHouseRulesCtx(foldBuild([award(79, 1)]), ctx({}));
  t('campaign with no Tasha setting: a non-core purchase is not refused for Tasha', purchaseLegality(allowed, 'feature', { v: 'Warlock: Grasp of Hadar' }).hard.some(x => /non-core/.test(x)), false);
}

section('resolveHouseRules / effective tables');
{
  const b = foldBuild([award(79, 1), patchHR({ dmAllows: { boons: false }, boons: { Bulwark: { hd: 1, ap: 1 } }, disabled: { boons: ['Deft Catch'], draws: [] } }),
    ovr({ dmAllows: { drawbacks: false }, boons: { 'Shiny New Boon': { hd: 2, ap: 7, fx: 'x' } }, disabled: { boons: [], draws: ['Slow-Footed'] } })]);
  const solo = resolveHouseRules(b);
  t('solo: own dmAllows', solo.dmAllows, { boons: false });
  t('solo: own boon, source own', [solo.boons.Bulwark.ap, solo.source.boons.Bulwark], [1, 'own']);
  t('solo: override ignored', 'Shiny New Boon' in solo.boons, false);
  t('solo: own disabled', solo.disabled.boons, ['Deft Catch']);
  const c = resolveHouseRules(b, ctx({ dmAllows: { tasha: false }, boons: { Bulwark: { hd: 1, ap: 9 } } }, 'camp-A', { boons: ['Executioner'], draws: [] }));
  t('campaign: own patch ignored, campaign value', [c.boons.Bulwark.ap, c.source.boons.Bulwark], [9, 'campaign']);
  t('campaign: dmAllows = campaign + override, own ignored', c.dmAllows, { tasha: false, drawbacks: false });
  t('campaign: override boon present', [c.boons['Shiny New Boon'].ap, c.source.boons['Shiny New Boon']], [7, 'override']);
  t('campaign: disabled = bans ∪ override.disabled', [c.disabled.boons, c.disabled.draws], [['Executioner'], ['Slow-Footed']]);
  const evil = resolveHouseRules({}, ctx(JSON.parse('{"boons":{"__proto__":{"ap":1},"constructor":{"ap":2},"Ok":{"hd":1,"ap":3},"Bad":5}}')));
  t('prototype keys and non-object entries are dropped', Object.keys(evil.boons), ['Ok']);
  t('…and nothing leaked onto Object.prototype', ({}).ap, undefined);
  const tb = withHouseRulesCtx(foldBuild([award(79, 1)]), ctx({ dmAllows: { boons: false }, boons: { 'Shiny': { hd: 1, ap: 2 } } }, 'camp-A', { boons: ['Bulwark'], draws: [] }));
  const T = effectiveBoonTable(tb);
  t('boon table: custom row', [T.Shiny.ap, T.Shiny.cat, T.Shiny.custom, T.Shiny.source], [2, 'DM custom', true, 'campaign']);
  t('boon table: banned row', [T.Bulwark.disabled, T.Bulwark.allowed], [true, false]);
  t('boon table: call off → nothing allowed', Object.values(T).some(r => r.allowed), false);
  const D = effectiveDrawbackTable(withHouseRulesCtx(foldBuild([award(79, 1)]), ctx({ draws: { [STM]: { ap: 1 } } })));
  t('drawback table: repriced row', [D[STM].ap, D[STM].custom], [1, true]);
  t('drawback table: a wound is not allowed for a player', D['Peg Leg'] ? D['Peg Leg'].allowed === !(DATA.wounds && DATA.wounds['Peg Leg'] && DATA.wounds['Peg Leg'].dmOnly) : true, true);
  t('solo table equals CharGen effBoons() shape for an untouched row', Object.keys(effectiveBoonTable(foldBuild([]))['Bulwark']).slice(0, 6), ['hd', 'ap', 'fx', 'cat', 'custom', 'source']);
}

section('houseRulesImpact — S2 preview (plan §7.1) and drawbackCap (M5)');
{
  const LOG = [award(79, 1), fighter, { type: 'creationLocked', seq: 3 },
    { type: 'buy', cat: 'drawback', payload: { v: STM }, cost: -3, seq: 4 }];
  const oldC = ctx({ draws: { [STM]: { ap: 3 } } }), newC = ctx({ draws: { [STM]: { ap: 5 } } });
  const [r] = houseRulesImpact([{ id: 'ana', LOG }], oldC, newC);
  const p = r.purchases[0];
  t('one held drawback, 3 → 5', [p.kind, p.name, p.seq, p.oldEffective, p.newEffective, p.valueDelta, p.ledgerDelta], ['drawback', STM, 4, 3, 5, 2, 2]);
  t('AP left before → after (browser)', [r.apLeft.before, r.apLeft.after], [82, 84]);
  t('server ledger agrees before, and after the reprice is applied', [r.serverApLeft.before, r.serverApLeft.afterIfApplied], [82, 84]);
  t('the event the RPC would stamp (M3: from = -cost + ΣΔ, to = new value)', p.repriceEvent, { type: 'dmRepriceDrawback', refVal: STM, targetSeq: 4, amount: 2, from: 3, to: 5 });
  // M5: a cap of 4 — the browser sees only +1 of the +2.
  const [rc] = houseRulesImpact([{ id: 'ana', LOG, drawbackCap: 4 }], oldC, newC);
  t('M5: with drawbackCap 4, apDelta is the capped change (+1)', rc.purchases[0].apDelta, 1);
  t('M5: and the ledger delta stays raw (+2) so the summed cap agrees on both sides', rc.purchases[0].ledgerDelta, 2);
  t('M5: browser after == server after with the cap', [rc.apLeft.after, rc.serverApLeft.afterIfApplied], [83, 83]);
  // A CharGen cost-0 drawback (F4a): the ledger gap is recorded so a ticked holder lands in agreement.
  const [rz] = houseRulesImpact([{ id: 'cg', LOG: LOG.slice(0, 3).concat([{ type: 'buy', cat: 'drawback', payload: { v: STM }, cost: 0, seq: 4 }]) }], oldC, newC);
  t('F4a holder: ledgerDelta = new value − ledger grant (5 − 0)', [rz.purchases[0].ledgerGrant, rz.purchases[0].ledgerDelta], [0, 5]);
  t('F4a holder: after the tick the two sides agree', rz.apLeft.after, rz.serverApLeft.afterIfApplied);
  // imposed / boons / T2 candidates
  const L2 = [award(79, 1), fighter,
    { type: 'buy', cat: 'boon', payload: { v: 'Bulwark' }, cost: 6, seq: 3 },
    { type: 'buy', cat: 'boon', payload: { v: 'Deft Catch' }, cost: 0, seq: 4, dmEdit: true, dmId: DM },
    { type: 'buy', cat: 'drawback', payload: { v: STM }, cost: 0, seq: 5, dmEdit: true, dmId: DM, dmLocked: true }];
  const [r2] = houseRulesImpact([{ id: 'bo', LOG: L2 }], ctx({}), ctx({ dmAllows: { boons: false }, draws: { [STM]: { ap: 9 } } }));
  const by = n => r2.purchases.find(x => x.name === n);
  t('imposed drawback: no value change, no reprice event', [by(STM).imposed, by(STM).valueDelta, 'repriceEvent' in by(STM)], [true, 0, false]);
  t('boons call off: both held boons are T2 candidates (barredNew)', [by('Bulwark').barredNew, by('Deft Catch').barredNew], [true, true]);
  t('DM-granted boon flagged (no refund — plan §7.2)', [by('Bulwark').dmGranted, by('Deft Catch').dmGranted], [false, true]);
  t('draft flag: not creation-locked', r2.locked, false);
  const L3 = [award(79, 1), fighter, { type: 'creationLocked', seq: 3 },
    { type: 'buy', cat: 'drawback', payload: { v: STM }, cost: -3, seq: 4 }, { type: 'buy', cat: 'drawback', payload: { v: STM }, cost: -3, seq: 4 }];
  const [r3] = houseRulesImpact([{ id: 'dup', LOG: L3 }], oldC, newC);
  t('a duplicated seq: both copies flagged ambiguousSeq and offered no reprice event (must be pinned)', r3.purchases.map(p => [p.ambiguousSeq, 'repriceEvent' in p]), [[true, false], [true, false]]);
  // PR #658 review: a seq the RPC can't take as targetSeq (a string, a fraction) or a cost that isn't a number is not targetable.
  const L4 = [award(79, 1), fighter, { type: 'creationLocked', seq: 3 },
    { type: 'buy', cat: 'drawback', payload: { v: STM }, cost: -3, seq: '4' },
    { type: 'buy', cat: 'drawback', payload: { v: 'Lame' }, cost: '-3', seq: 5 },
    { type: 'buy', cat: 'boon', payload: { v: 'Bulwark' }, cost: 6, seq: 6.5 },
    { type: 'buy', cat: 'boon', payload: { v: 'Alertness' }, cost: 6, seq: 7 }];
  const [r4] = houseRulesImpact([{ id: 'odd', LOG: L4 }], ctx({ draws: { [STM]: { ap: 3 }, Lame: { ap: 3 } } }), ctx({ draws: { [STM]: { ap: 5 }, Lame: { ap: 5 } } }));
  const by4 = n => r4.purchases.find(x => x.name === n);
  t('a string seq, a string cost and a fractional seq are flagged ambiguousSeq; a normal purchase is not',
    [by4(STM).ambiguousSeq, by4('Lame').ambiguousSeq, by4('Bulwark').ambiguousSeq, by4('Alertness').ambiguousSeq], [true, true, true, false]);
  t('...and get no reprice event (the RPC would refuse it and fail the whole call)', ['repriceEvent' in by4(STM), 'repriceEvent' in by4('Lame')], [false, false]);
  // row.overrides (feat/campaign-house-rules-overrides): a per-character override about to be written, same ctx both sides.
  const sameC = ctx({ draws: { [STM]: { ap: 3 } } });
  const [ro] = houseRulesImpact([{ id: 'ana', LOG, overrides: { draws: { [STM]: { ap: 6 } } } }], sameC, sameC);
  t('override preview: 3 → 6 for this character, with the reprice event the RPC would check', [ro.purchases[0].newEffective, ro.purchases[0].repriceEvent && ro.purchases[0].repriceEvent.to, ro.apLeft.after - ro.apLeft.before], [6, 6, 3]);
  t('override preview: server after (override + reprice applied) == browser after', ro.serverApLeft.afterIfApplied, ro.apLeft.after);
  const [rp] = houseRulesImpact([{ id: 'ana', LOG, overrides: { draws: { [STM]: { ap: 6 } }, pins: { draws: { [STM]: { ap: 3 } } } } }], sameC, sameC);
  t('override preview: a pin in the snapshot keeps the old value (no change, no event)', [rp.purchases[0].changed, 'repriceEvent' in rp.purchases[0], rp.apLeft.after], [false, false, rp.apLeft.before]);
  const [rn] = houseRulesImpact([{ id: 'ana', LOG }], sameC, sameC);
  t('no overrides key: nothing changes', [rn.purchases[0].changed, rn.apLeft.after === rn.apLeft.before], [false, true]);
}

// ================================================================================================================
// (f) the ledger invariant, fuzzed
// ================================================================================================================
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const PLAYER_DRAWS = Object.keys(DATA.drawbacks).filter(k => !(DATA.wounds && DATA.wounds[k]) && !(DATA.drawbackMaxStats && DATA.drawbackMaxStats[k]) && !(DATA.drawbackReq && DATA.drawbackReq[k])).slice(0, 8);
const BOONS = ['Bulwark', 'Deft Catch', 'Crippling Strike', 'Fleet as Thought'];
const stats = { checked: 0, buyoffLenient: 0, buyoffTargeted: 0, capOffOver12: 0, steps: 0, junk: 0, junkLogs: 0, ambiguous: 0, forged: 0, deleted: 0 };

function fuzzOne(rng) {
  const pick = a => a[Math.floor(rng() * a.length)];
  const int = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  let seq = 0; const S = () => ++seq;
  const LOG = [{ type: 'award', amount: int(40, 120), seq: S() }, Object.assign({}, fighter, { seq: S() })];
  // campaign state
  let rules = { draws: {} };
  for (const d of PLAYER_DRAWS) if (rng() < 0.3) rules.draws[d] = { ap: int(0, 9) };
  if (rng() < 0.3) rules.draws['Hexed Custom'] = { ap: int(1, 6) };
  let capRule = rng() < 0.6 ? { enabled: true, ap: int(4, 20) } : (rng() < 0.5 ? { enabled: false, ap: 12 } : null);
  let ignorePlayerAp = rng() < 0.4, dmAp = int(0, 60);
  let overrides = {};           // the character's current DM override snapshot for camp-A
  let forgedD = false;          // a forged drawback or a deleted custom: the frozen ledger no longer mirrors compute() (income identity off)
  // DM-stamped AP events that must NOT match (bad seq, wrong type, stale or ambiguous target, non-finite amount).
  // The engine must ignore them, and so must the server (it counts a DM AP event only when it matches); the RPC refuses them anyway.

  const JUNK = new Set(), ambiguous = new Set();
  const pushDm = ev => { if (ambiguous.has(ev.targetSeq)) JUNK.add(ev); LOG.push(ev); };
  const C = () => ctx(JSON.parse(JSON.stringify(rules)));
  const optsOf = () => { const o = { dmAp, ignorePlayerAp }; const cap = capRule && capRule.enabled !== false ? Number(capRule.ap) : undefined; if (cap != null) o.drawbackCap = cap; return o; };
  const cur = () => withHouseRulesCtx(foldBuild(LOG), C());
  const drawNames = () => PLAYER_DRAWS.concat(rules.draws['Hexed Custom'] ? ['Hexed Custom'] : []);
  // creation: a few purchases, then the lock
  for (let i = int(1, 5); i > 0; i--) {
    if (rng() < 0.5) { const v = pick(drawNames()); LOG.push({ type: 'buy', cat: 'drawback', payload: { v }, cost: priceOf(cur(), 'drawback', { v }), seq: S() }); }
    else { const v = pick(BOONS); LOG.push({ type: 'buy', cat: 'boon', payload: { v }, cost: priceOf(cur(), 'boon', { v }), seq: S() }); }
  }
  if (rng() < 0.2) LOG.push({ type: 'buy', cat: 'drawback', payload: { v: pick(PLAYER_DRAWS) }, cost: 0, seq: S(), dmEdit: true, dmId: DM, dmLocked: true });   // imposed
  if (rng() < 0.2) { const v = pick(BOONS); LOG.push({ type: 'buy', cat: 'boon', payload: { v }, cost: 0, seq: S(), dmEdit: true, dmId: DM }); }  // DM-granted
  LOG.push({ type: 'creationLocked', seq: S() });
  function junkStep() {
    stats.junk++;
    const ae = E.activeEvents(LOG);
    const buys = ae.evs.map((e, i) => [e, i]).filter(([e]) => e.type === 'buy' && (e.cat === 'drawback' || e.cat === 'boon') && e.seq != null);
    const k = int(0, 4);
    const junk = o => { const ev = dmE(Object.assign({ seq: S() }, o)); JUNK.add(ev); LOG.push(ev); };
    if (k === 0) {                                   // bad seq: no purchase has it
      const t = pick(['dmRefundBoon', 'dmRemoveDrawback', 'dmRepriceDrawback']);
      junk({ type: t, refVal: t === 'dmRefundBoon' ? pick(BOONS) : pick(PLAYER_DRAWS), targetSeq: seq + 1000, cost: -5, grantBack: 5, amount: 5 });
    } else if (k === 1 && buys.length) {             // wrong type: a boon event at a drawback purchase or vice versa
      const [e] = pick(buys); const v = e.payload.v;
      junk(e.cat === 'drawback' ? { type: 'dmRefundBoon', refVal: v, targetSeq: e.seq, cost: -5 } : { type: pick(['dmRemoveDrawback', 'dmRepriceDrawback']), refVal: v, targetSeq: e.seq, grantBack: 5, amount: 5 });
    } else if (k === 2) {                            // stale target: already bought off / removed / refunded / DM-removed
      const dead = buys.filter(([e, i]) => ae.boughtOff.has(i) || ae.drawRemoved.has(i) || ae.boonRefunded.has(i) || ae.boonRemoved.has(i));
      if (dead.length) { const [e] = pick(dead); const v = e.payload.v;
        junk(e.cat === 'boon' ? { type: 'dmRefundBoon', refVal: v, targetSeq: e.seq, cost: -(Number(e.cost) || 0) }
          : pick([{ type: 'dmRemoveDrawback', refVal: v, targetSeq: e.seq, grantBack: -(Number(e.cost) || 0) }, { type: 'dmRepriceDrawback', refVal: v, targetSeq: e.seq, amount: 3, from: 0, to: 3 }])); }
    } else if (k === 3) {                            // duplicate seq: a second purchase reuses a seq; any DM event aimed at it is ambiguous
      const ds = buys.filter(([e, i]) => e.cat === 'drawback' && !e.dmEdit && !ae.boughtOff.has(i) && !ae.drawRemoved.has(i));
      if (ds.length) { const [e] = pick(ds); const v = e.payload.v;
        LOG.push({ type: 'buy', cat: 'drawback', payload: { v }, cost: priceOf(cur(), 'drawback', { v }), seq: e.seq });
        ambiguous.add(e.seq);
        junk({ type: 'dmRepriceDrawback', refVal: v, targetSeq: e.seq, amount: 2, from: 0, to: 2 }); }
    } else if (buys.length) {                        // non-finite amount
      const [e] = pick(buys); const v = e.payload.v;
      junk(e.cat === 'boon' ? { type: 'dmRefundBoon', refVal: v, targetSeq: e.seq, cost: -Infinity } : { type: 'dmRepriceDrawback', refVal: v, targetSeq: e.seq, amount: Infinity });
    }
  }
  for (let step = int(3, 14); step > 0; step--) {
    stats.steps++;
    const roll = rng();
    if (roll < 0.25) {
      // S2: the DM changes a drawback value campaign-wide; each holder is ticked (reprice) or not (pin).
      const name = pick(drawNames());
      const before = C();
      const next = JSON.parse(JSON.stringify(rules)); next.draws[name] = { ap: int(0, 9) };
      const [imp] = houseRulesImpact([{ id: 'x', LOG }], before, ctx(next));
      const changed = imp.purchases.filter(p => p.kind === 'drawback' && p.changed && p.name === name);
      rules = next;
      if (changed.length) {
        // A holder whose purchase shares its seq+name can't be targeted (houseRulesImpact gives it no repriceEvent): the
        // console must PIN the name for this character instead — and a pin covers every copy, so then nothing is ticked.
        if (rng() < 0.6 && !changed.some(p => p.ambiguousSeq)) { for (const p of changed) pushDm(dmE(Object.assign({}, p.repriceEvent, { seq: S() }))); }
        else {
          overrides = JSON.parse(JSON.stringify(overrides));
          ((overrides.pins = overrides.pins || {}).draws = overrides.pins.draws || {})[name] = { ap: changed[0].oldEffective, reason: 'kept', at: 'x' };
          LOG.push(dmE({ type: 'dmHouseRules', overrides, seq: S() }));
        }
      }
    } else if (roll < 0.33) {
      // re-tick: drop the pins and reconcile every held copy to its new effective value
      // (not while a pinned holder is ambiguous — its pin is the only thing keeping both sides equal; it can't be ticked)
      if (overrides.pins && !houseRulesImpact([{ id: 'x', LOG }], C(), C())[0].purchases.some(p => p.ambiguousSeq)) {
        overrides = JSON.parse(JSON.stringify(overrides)); delete overrides.pins;
        LOG.push(dmE({ type: 'dmHouseRules', overrides, seq: S() }));
        const [imp] = houseRulesImpact([{ id: 'x', LOG }], C(), C());
        for (const p of imp.purchases) if (p.kind === 'drawback' && !p.imposed && p.ledgerGrant !== p.newEffective)
          pushDm(dmE({ type: 'dmRepriceDrawback', refVal: p.name, targetSeq: p.seq, amount: p.newEffective - p.ledgerGrant, from: p.ledgerGrant, to: p.newEffective, seq: S() }));
      }
    } else if (roll < 0.43) {
      // T2: remove one held, player-taken drawback (grant taken back = the ledger's grant for it)
      const [imp] = houseRulesImpact([{ id: 'x', LOG }], C(), C());
      const ds = imp.purchases.filter(p => p.kind === 'drawback' && !p.imposed);
      if (ds.length) { const p = pick(ds); pushDm(dmE({ type: 'dmRemoveDrawback', refVal: p.name, targetSeq: p.seq, grantBack: p.ledgerGrant, seq: S() })); }
    } else if (roll < 0.53) {
      // T2: refund one held, player-paid boon (refund = its frozen cost)
      const [imp] = houseRulesImpact([{ id: 'x', LOG }], C(), C());
      const bs = imp.purchases.filter(p => p.kind === 'boon' && !p.dmGranted);
      if (bs.length) { const p = pick(bs); pushDm(dmE({ type: 'dmRefundBoon', refVal: p.name, targetSeq: p.seq, cost: -p.frozenCost, seq: S() })); }
    } else if (roll < 0.63) {
      const v = pick(drawNames()); LOG.push({ type: 'buy', cat: 'drawback', payload: { v }, cost: priceOf(cur(), 'drawback', { v }), seq: S() });
    } else if (roll < 0.73) {
      const v = pick(BOONS); LOG.push({ type: 'buy', cat: 'boon', payload: { v }, cost: priceOf(cur(), 'boon', { v }), seq: S() });
    } else if (roll < 0.78) {
      const held = foldBuild(LOG).drawbacks;
      if (held.length) {
        const v = pick(held), ev = { type: 'buyoff', refVal: v, cost: drawbackBuyoffQuote(cur(), v).cost, seq: S() };
        // M4: an honest client stamps the seq of the purchase the buyoff cancels (the oldest open one of that name).
        if (rng() < 0.75) { const ae = E.activeEvents(LOG.concat([ev])); const j = ae.buyoffTarget.get(ae.evs.length - 1);
          if (j != null && ae.evs[j].seq != null) ev.targetSeq = ae.evs[j].seq; }
        LOG.push(ev);
      }
    } else if (roll < 0.86) {
      junkStep();
    } else if (roll < 0.88) {
      const k = int(0, 4);
      if (k === 0) {
        // forged by a player: no dmEdit — both sides must ignore it
        const v = pick(BOONS); LOG.push({ type: pick(['dmRefundBoon', 'dmRemoveDrawback', 'dmRepriceDrawback']), refVal: v, targetSeq: int(1, seq), cost: -50, grantBack: 50, amount: 50, seq: S() });
      } else if (k === 1) {
        // AB1: a forged drawback with a made-up name and a huge grant — worth 0 on both sides
        LOG.push({ type: 'buy', cat: 'drawback', payload: { v: pick(['Fake', 'Totally Real Curse', 'constructor', 'toString']) }, cost: -int(1, 1000), seq: S() }); stats.forged++; forgedD = true;
      } else if (k === 2) {
        // AB1: a real name stamped at an inflated cost — worth its effective value on both sides
        LOG.push({ type: 'buy', cat: 'drawback', payload: { v: pick(drawNames()) }, cost: -int(10, 1000), seq: S() }); stats.forged++; forgedD = true;
      } else {
        // AB1: the DM deletes the campaign's custom drawback (with no action for its holders, or a tick to 0 / a pin)
        if (rules.draws['Hexed Custom']) {
          const before = C(); const next = JSON.parse(JSON.stringify(rules)); delete next.draws['Hexed Custom'];
          const [imp] = houseRulesImpact([{ id: 'x', LOG }], before, ctx(next));
          const changed = imp.purchases.filter(p => p.kind === 'drawback' && p.changed && p.name === 'Hexed Custom');
          rules = next; stats.deleted++; forgedD = true;
          const a = rng();
          if (changed.length && a < 0.4 && !changed.some(p => p.ambiguousSeq)) { for (const p of changed) pushDm(dmE(Object.assign({}, p.repriceEvent, { seq: S() }))); }
          else if (changed.length && a < 0.7) {
            overrides = JSON.parse(JSON.stringify(overrides));
            ((overrides.pins = overrides.pins || {}).draws = overrides.pins.draws || {})['Hexed Custom'] = { ap: changed[0].oldEffective, reason: 'kept', at: 'x' };
            LOG.push(dmE({ type: 'dmHouseRules', overrides, seq: S() }));
          }
        }
      }
    } else if (roll < 0.91) { LOG.push({ type: 'award', amount: int(0, 20), seq: S() }); }
    else if (roll < 0.94) { dmAp = int(0, 60); }
    else if (roll < 0.97) { ignorePlayerAp = !ignorePlayerAp; }
    else { capRule = rng() < 0.7 ? { enabled: true, ap: int(0, 20) } : { enabled: false, ap: 12 }; }
  }
  // ---- the checks ----
  const o = optsOf();
  const fails = [];
  // 1. The engine IGNORES every non-matching DM event: the log with them and the log without them fold, price and
  //    tally identically.
  const FULL = LOG.slice();
  dumpLog(FULL, JSON.parse(JSON.stringify(rules)), 'camp-A');
  if (JUNK.size) {
    stats.junkLogs++;
    const clean = FULL.filter(e => !JUNK.has(e));
    const sig = L => { const r = compute(withHouseRulesCtx(foldBuild(L), C()), o), ec = economy(L);
      return JSON.stringify([r.total, r.spendable, r.drawbackAp, r.warnings, ec, foldBuild(L).boons, foldBuild(L).drawbacks]); };
    if (sig(FULL) !== sig(clean)) fails.push(`non-matching dmEdit events changed the engine's answer (${JUNK.size} of them)`);
    if (FULL.some(e => JUNK.has(e) && E.activeEvents(FULL).dmMatched.has(E.activeEvents(FULL).evs.indexOf(e)))) fails.push('a non-matching dmEdit event was reported as matched');
    // 2. The server comparison runs on the FULL log, junk included: since the PR #654 review the server counts a DM
    //    AP event only when it matches (pact_hr_resolve), exactly like the engine, so non-matching events must move
    //    neither side.
  }
  const browser = compute(cur(), o).spendable - economy(LOG).spent;
  const port = sqlLedgerPort(LOG, { dmAp, ignorePlayerAp, capRule, chr: rules, campaignId: 'camp-A' });
  const model = serverApLedger(LOG, Object.assign({}, o, { houseRulesCtx: C() })).apLeft;
  if (port !== model) fails.push(`engine serverApLedger() ${model} != independent SQL port ${port}`);
  const hasBuyoff = LOG.some(e => e.type === 'buyoff');
  // A history with a duplicated purchase seq: the holder can't be targeted (houseRulesImpact flags it ambiguousSeq;
  // the console must pin it), and this generator doesn't pin, so the server comparison is meaningless there.
  if (ambiguous.size) stats.ambiguous++;   // compared strictly too: an event aimed at a shared seq matches nothing on either side
  const capOff = o.drawbackCap === undefined;
  if (capOff && compute(cur(), o).drawbackAp > DATA.drawbackCap) stats.capOffOver12++;   // Z1: strict now (was the open question)
  // M4: a buyoff that names the purchase it cancels (targetSeq) is netted exactly; one that does not keeps the SQL's
  // old approximation (the grant stays), so the server is MORE lenient there — asserted in that direction.
  const ae = E.activeEvents(LOG);
  const untargeted = ae.evs.some((e, i) => e.type === 'buyoff' && ae.buyoffTarget.has(i)
    && !(e.targetSeq != null && ae.evs[ae.buyoffTarget.get(i)].seq != null && String(ae.evs[ae.buyoffTarget.get(i)].seq) === String(e.targetSeq)));
  if (hasBuyoff && !untargeted) stats.buyoffTargeted++;
  if (untargeted) { stats.buyoffLenient++; if (!(port >= browser)) fails.push(`untargeted buyoff log: server ${port} should be >= browser ${browser} (the SQL keeps a bought-off grant)`); }
  else { stats.checked++; if (port !== browser) fails.push(`AP left: browser ${browser} != server ${port}`); }
  // and the frozen ledger stays internally consistent: compute()'s grant vs economy().drawbackEarned agree on a
  // log with no buyoff and no cap in force (the income identity, carried into a campaign context).
  if (!hasBuyoff && capOff && !forgedD) {
    const eco = economy(LOG); const r = compute(cur(), { houseRulesCtx: C() });
    if (r.drawbackAp !== eco.drawbackEarned) fails.push(`income identity: compute().drawbackAp ${r.drawbackAp} != economy().drawbackEarned ${eco.drawbackEarned}`);
  }
  return fails.length ? { fails, LOG, opts: o, rules, capRule } : null;
}

section(`(f) ledger invariant — ${ITER} random campaign histories, seed ${SEED}`);
{
  const rng = mulberry32(SEED);
  let bad = 0;
  for (let i = 0; i < ITER; i++) {
    const r = fuzzOne(rng);
    if (r) { bad++; if (bad <= 3) { console.log(`  FAIL iteration ${i}: ${r.fails.join('; ')}`); console.log('    ' + JSON.stringify({ opts: r.opts, rules: r.rules, capRule: r.capRule, LOG: r.LOG })); } }
  }
  t(`fuzz: browser AP left == server ledger on every history (${stats.checked} strict, ${stats.buyoffLenient} untargeted-buyoff-lenient, ${stats.steps} DM/player steps)`, bad, 0);
  t('fuzz: the strict scope is not empty', stats.checked > ITER / 3, true);
  t('fuzz: targeted buyoffs (M4) reach the strict scope', stats.buyoffTargeted > 0, true);
  t('fuzz: cap-off campaigns granting more than DATA.drawbackCap reach the strict scope (Z1)', stats.capOffOver12 > 0, true);
  t('fuzz: non-matching dmEdit events were generated', stats.junk > ITER / 4, true);
  t(`fuzz: AB1 forged drawbacks (${stats.forged}) and deleted customs (${stats.deleted}) were generated`, stats.forged > ITER / 25 && stats.deleted > 0, true);
  console.log(`  ${stats.junk} non-matching dmEdit events across ${stats.junkLogs} histories — ignored by the engine AND the server; ${stats.ambiguous} histories with a duplicated seq, compared strictly`);
  console.log(`  coverage: ${stats.checked} strict equality (incl. ${stats.buyoffTargeted} with targeted buyoffs, ${stats.capOffOver12} cap-off with a grant > ${DATA.drawbackCap}), ${stats.buyoffLenient} server-more-lenient (an untargeted buyoff)`);
}

if (DUMP) { (await import('node:fs')).writeFileSync(DUMP, JSON.stringify(dumped)); console.log(`  wrote ${dumped.length} logs to ${DUMP}`); }
console.log(fail === 0 ? `\n✓ ${pass} passed / 0 failed` : `\n✗ ${fail} FAILED / ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
