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
 *        equals an INDEPENDENT JS port of the server ledger (pact_ap_ledger_spend + the budget trigger, as plan
 *        §6.4 + addendum M1/M4/X1 will leave them), and equals the engine's own serverApLedger() model.
 *        Two scoped exceptions, each asserted in its own DIRECTION rather than skipped:
 *          - a log with a player buyoff: the SQL keeps a bought-off drawback's grant (its documented, accepted
 *            approximation), so the server is MORE lenient — asserted server ≥ browser;
 *          - a campaign with the DM's drawback cap switched OFF whose drawbacks grant more than DATA.drawbackCap:
 *            X1's server falls back to capping at DATA.drawbackCap while compute() does not cap at all, so the
 *            server is STRICTER — asserted server ≤ browser, and counted in the output (open owner question).
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
// The INDEPENDENT server-ledger port. Written from sql/rls-policies.sql's pact_ap_ledger_spend and
// pact_enforce_ap_budget_consistency as they stand, plus exactly the plan's §6.4 additions as the addendum amends
// them — kept deliberately separate from js/engine.js's serverApLedger() so the two check each other.
//   SQL today: award -> earned; buy/drawback -> earned += -cost; buyoff|names|buy(non-patch) -> spent += cost.
//   §6.4 + M1: dmRefundBoon -> spent += cost; dmRemoveDrawback -> drawback_earned -= grantBack;
//              dmRepriceDrawback -> drawback_earned += amount — each ONLY when dmEdit = true.
//   §6.4 split + X1: spendable = ap + (ignore ? 0 : award_earned) + least(cap, drawback_earned),
//              cap = rules.drawbackCap.ap when enabled, else DATA.drawbackCap.
// ---------------------------------------------------------------------------------------------------------------
function sqlLedgerPort(log, { dmAp = 0, ignorePlayerAp = false, capRule = null } = {}) {
  let spent = 0, award = 0, draw = 0;
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  for (const ev of log) {
    const type = ev.type, cat = ev.cat == null ? '' : ev.cat;
    if (type === 'award') award += num(ev.amount);
    else if (type === 'buy' && cat === 'drawback') draw += num(ev.cost) * -1;
    else if (type === 'buyoff' || type === 'names' || (type === 'buy' && cat !== 'patch')) spent += num(ev.cost);
    else if (type === 'dmRefundBoon' && ev.dmEdit === true) spent += num(ev.cost);
    else if (type === 'dmRemoveDrawback' && ev.dmEdit === true) draw -= num(ev.grantBack);
    else if (type === 'dmRepriceDrawback' && ev.dmEdit === true) draw += num(ev.amount);
  }
  const cap = (capRule && capRule.enabled !== false && Number.isFinite(Number(capRule.ap))) ? Number(capRule.ap) : DATA.drawbackCap;
  return dmAp + (ignorePlayerAp ? 0 : award) + Math.min(cap, draw) - spent;
}

const STM = 'Slow to Mend';               // printed 5, no stat cap / caster gate / wound flag
const ctx = (rules, id = 'camp-A', bans) => ({ campaignId: id, rules, bans: bans || { boons: [], draws: [] } });
const DM = 'dm-1';
const dmE = o => Object.assign({ dmEdit: true, dmId: DM, campaignId: 'camp-A' }, o);
const ovr = (overrides, cid = 'camp-A', seq = 50) => ({ type: 'dmHouseRules', campaignId: cid, overrides, seq, dmEdit: true, dmId: DM });
const patchHR = (hr, seq = 3) => ({ type: 'buy', cat: 'patch', _slot: 'houseRules', payload: { patch: { houseRules: hr } }, cost: 0, seq });
const award = (amount, seq) => ({ type: 'award', amount, seq });
const fighter = { type: 'buy', cat: 'oclass', payload: { v: 'Fighter' }, cost: 0, seq: 2 };

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
}

// ================================================================================================================
// (f) the ledger invariant, fuzzed
// ================================================================================================================
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const PLAYER_DRAWS = Object.keys(DATA.drawbacks).filter(k => !(DATA.wounds && DATA.wounds[k]) && !(DATA.drawbackMaxStats && DATA.drawbackMaxStats[k]) && !(DATA.drawbackReq && DATA.drawbackReq[k])).slice(0, 8);
const BOONS = ['Bulwark', 'Deft Catch', 'Crippling Strike', 'Fleet as Thought'];
const stats = { checked: 0, buyoffLenient: 0, capStricter: 0, steps: 0 };

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
        if (rng() < 0.6) { for (const p of changed) LOG.push(dmE(Object.assign({}, p.repriceEvent, { seq: S() }))); }
        else {
          overrides = JSON.parse(JSON.stringify(overrides));
          ((overrides.pins = overrides.pins || {}).draws = overrides.pins.draws || {})[name] = { ap: changed[0].oldEffective, reason: 'kept', at: 'x' };
          LOG.push(dmE({ type: 'dmHouseRules', overrides, seq: S() }));
        }
      }
    } else if (roll < 0.33) {
      // re-tick: drop the pins and reconcile every held copy to its new effective value
      if (overrides.pins) {
        overrides = JSON.parse(JSON.stringify(overrides)); delete overrides.pins;
        LOG.push(dmE({ type: 'dmHouseRules', overrides, seq: S() }));
        const [imp] = houseRulesImpact([{ id: 'x', LOG }], C(), C());
        for (const p of imp.purchases) if (p.kind === 'drawback' && !p.imposed && p.ledgerGrant !== p.newEffective)
          LOG.push(dmE({ type: 'dmRepriceDrawback', refVal: p.name, targetSeq: p.seq, amount: p.newEffective - p.ledgerGrant, from: p.ledgerGrant, to: p.newEffective, seq: S() }));
      }
    } else if (roll < 0.43) {
      // T2: remove one held, player-taken drawback (grant taken back = the ledger's grant for it)
      const [imp] = houseRulesImpact([{ id: 'x', LOG }], C(), C());
      const ds = imp.purchases.filter(p => p.kind === 'drawback' && !p.imposed);
      if (ds.length) { const p = pick(ds); LOG.push(dmE({ type: 'dmRemoveDrawback', refVal: p.name, targetSeq: p.seq, grantBack: p.ledgerGrant, seq: S() })); }
    } else if (roll < 0.53) {
      // T2: refund one held, player-paid boon (refund = its frozen cost)
      const [imp] = houseRulesImpact([{ id: 'x', LOG }], C(), C());
      const bs = imp.purchases.filter(p => p.kind === 'boon' && !p.dmGranted);
      if (bs.length) { const p = pick(bs); LOG.push(dmE({ type: 'dmRefundBoon', refVal: p.name, targetSeq: p.seq, cost: -p.frozenCost, seq: S() })); }
    } else if (roll < 0.63) {
      const v = pick(drawNames()); LOG.push({ type: 'buy', cat: 'drawback', payload: { v }, cost: priceOf(cur(), 'drawback', { v }), seq: S() });
    } else if (roll < 0.73) {
      const v = pick(BOONS); LOG.push({ type: 'buy', cat: 'boon', payload: { v }, cost: priceOf(cur(), 'boon', { v }), seq: S() });
    } else if (roll < 0.78) {
      const held = foldBuild(LOG).drawbacks;
      if (held.length) { const v = pick(held); LOG.push({ type: 'buyoff', refVal: v, cost: drawbackBuyoffQuote(cur(), v).cost, seq: S() }); }
    } else if (roll < 0.84) {
      // forged by a player: no dmEdit — both sides must ignore it
      const v = pick(BOONS); LOG.push({ type: pick(['dmRefundBoon', 'dmRemoveDrawback', 'dmRepriceDrawback']), refVal: v, targetSeq: int(1, seq), cost: -50, grantBack: 50, amount: 50, seq: S() });
    } else if (roll < 0.9) { LOG.push({ type: 'award', amount: int(0, 20), seq: S() }); }
    else if (roll < 0.94) { dmAp = int(0, 60); }
    else if (roll < 0.97) { ignorePlayerAp = !ignorePlayerAp; }
    else { capRule = rng() < 0.7 ? { enabled: true, ap: int(0, 20) } : { enabled: false, ap: 12 }; }
  }
  // ---- the checks ----
  const o = optsOf();
  const browser = compute(cur(), o).spendable - economy(LOG).spent;
  const port = sqlLedgerPort(LOG, { dmAp, ignorePlayerAp, capRule });
  const model = serverApLedger(LOG, o).apLeft;
  const fails = [];
  if (port !== model) fails.push(`engine serverApLedger() ${model} != independent SQL port ${port}`);
  const hasBuyoff = LOG.some(e => e.type === 'buyoff');
  const uncappedGrant = compute(cur(), Object.assign({}, o, { drawbackCap: undefined })).drawbackAp;
  const capOff = o.drawbackCap === undefined;
  const capGap = capOff && uncappedGrant > DATA.drawbackCap;
  // The buyoff direction is asserted with the cap question taken out (an uncapped server when the DM's cap is off),
  // so the two scoped differences cannot mask each other.
  const portNoX1 = capOff ? sqlLedgerPort(LOG, { dmAp, ignorePlayerAp, capRule: { enabled: true, ap: 1e9 } }) : port;
  if (hasBuyoff) { stats.buyoffLenient++; if (!(portNoX1 >= browser)) fails.push(`buyoff log: server ${portNoX1} should be >= browser ${browser} (the SQL keeps a bought-off grant)`); }
  else if (capGap) { stats.capStricter++; if (!(port <= browser)) fails.push(`cap-off log: server ${port} should be <= browser ${browser}`); }
  else { stats.checked++; if (port !== browser) fails.push(`AP left: browser ${browser} != server ${port}`); }
  // and the frozen ledger stays internally consistent: compute()'s grant vs economy().drawbackEarned agree on a
  // log with no buyoff and no cap in force (the income identity, carried into a campaign context).
  if (!hasBuyoff && capOff) {
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
  t(`fuzz: browser AP left == server ledger on every history (${stats.checked} strict, ${stats.buyoffLenient} buyoff-lenient, ${stats.capStricter} cap-off-stricter, ${stats.steps} DM/player steps)`, bad, 0);
  t('fuzz: the strict scope is not empty', stats.checked > ITER / 3, true);
  console.log(`  coverage: ${stats.checked} strict equality, ${stats.buyoffLenient} server-more-lenient (buyoff), ${stats.capStricter} server-STRICTER (cap switched off, grant > ${DATA.drawbackCap} — open owner question, see the decision record)`);
}

console.log(fail === 0 ? `\n✓ ${pass} passed / 0 failed` : `\n✗ ${fail} FAILED / ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
