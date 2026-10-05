// feat/subclass-double-purchase-guard (owner decision P3, 2026-10-05) — gate for "one subclass ability is one purchase".
//
// All 192 subclass abilities are sold through TWO doors: b.subAbilities ("Class|Sub|Name") and a mirrored b.features ("Class: Name").
// Before this guard the two loops in compute() deduped only within their own collection, so an ability bought through both was
// charged twice with no warning (Anders Pipeleaf, 8 AP + 7 AP). The engine-parity fixtures CG-053..056 / EV-030..031 pin compute()'s
// output; this script pins the other half — what the TOOLS rely on:
//   * purchaseLegality() REFUSES the second purchase through either door (a "⛔ … duplicate" warning is a hard block),
//   * the refusal follows purchase order (P3: the copy bought FIRST is the one counted), not a fixed preference for one door,
//   * abilityIdent()/ownsAbility() give the pickers one shared identity for both key shapes,
//   * a clean first purchase, and a different ability through the other door, are NOT refused (the guard must not over-fire),
//   * every one of the 192 mirrored abilities round-trips (same identity from both key shapes), so no ability is left unguarded.
// Pure Node, no browser. Run: node testing/scripts/subclass-double-purchase-ci.mjs
import { DATA, compute, baseBuild, foldBuild, MUT, purchaseLegality, abilityIdent, ownsAbility, requiredHD, FEAT_ALIAS } from '../../js/engine.js';

let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const clone = o => JSON.parse(JSON.stringify(o));

const S = 'Rogue|Soulknife|Psionic Power / Psychic Blades';
const F = 'Rogue: Psionic Power / Psychic Blades';
const OTHER_S = 'Rogue|Soulknife|Soul Blades';          // a DIFFERENT Soulknife ability: must stay buyable
const OTHER_F = 'Rogue: Soul Blades';

// A Rogue build assembled the way the tools do: replay events through MUT (so the purchase order is stamped on the build).
const rogue = () => { const b = baseBuild(); b.originClass = 'Rogue'; b.hd = 8; b.budget = 300; b.freeSub = { Rogue: 'Soulknife' }; return b; };
const buy = (b, cat, v) => { const c = clone(b); MUT[cat](c, { v }); return c; };

console.log('== identity helpers');
ok(abilityIdent(S) === F, 'abilityIdent(subAbilMap key) is the mirrored feature label', abilityIdent(S));
ok(abilityIdent(F) === F, 'abilityIdent(feature label) is itself');
ok(abilityIdent('Rogue|NoSuchSub|Nothing') === 'Rogue|NoSuchSub|Nothing', 'an unknown subAbilMap key is returned unchanged (never throws)');
{ const bad = []; for (const [k, a] of Object.entries(DATA.subAbilMap)) { const id = a.cls + ': ' + a.name; if (abilityIdent(k) !== id || !DATA.features[id]) bad.push(k); }
  ok(bad.length === 0, 'all ' + Object.keys(DATA.subAbilMap).length + ' subclass abilities map to an existing mirrored feature', bad.slice(0, 3).join(' | ')); }
{ const b = buy(rogue(), 'subabil', S);
  ok(ownsAbility(b, S) && ownsAbility(b, F), 'owned via the subclass door -> ownsAbility true for BOTH key shapes');
  ok(!ownsAbility(b, OTHER_F) && !ownsAbility(b, OTHER_S), 'a different ability is not reported as owned'); }
{ const b = buy(rogue(), 'feature', F);
  ok(ownsAbility(b, S) && ownsAbility(b, F), 'owned via the feature door -> ownsAbility true for BOTH key shapes'); }
ok(!ownsAbility(rogue(), S) && !ownsAbility(rogue(), F), 'nothing owned -> false');

console.log('== purchaseLegality refuses the second door (P3: the copy bought first wins)');
{ const cur = buy(rogue(), 'subabil', S);                       // subclass door first
  const L = purchaseLegality(cur, 'feature', { v: F });          // ...then the feature door
  ok(L.hard.some(w => /duplicate/.test(w)), 'subclass first, then feature: REFUSED as a duplicate', JSON.stringify(L.hard));
  ok(L.hard.length === 1, 'exactly one hard reason (no double reporting)', JSON.stringify(L.hard)); }
{ const cur = buy(rogue(), 'feature', F);                       // feature door first
  const L = purchaseLegality(cur, 'subabil', { v: S });          // ...then the subclass door
  ok(L.hard.some(w => /duplicate/.test(w)), 'feature first, then subclass: REFUSED as a duplicate', JSON.stringify(L.hard));
  ok(L.hard.length === 1, 'exactly one hard reason (no double reporting)', JSON.stringify(L.hard)); }

console.log('== the guard must not over-fire');
{ const L = purchaseLegality(rogue(), 'subabil', { v: S });
  ok(L.hard.length === 0, 'a first purchase through the subclass door is allowed', JSON.stringify(L.hard)); }
{ const L = purchaseLegality(rogue(), 'feature', { v: F });
  ok(L.hard.length === 0, 'a first purchase through the feature door is allowed', JSON.stringify(L.hard)); }
{ const cur = buy(rogue(), 'subabil', S);
  const L = purchaseLegality(cur, 'feature', { v: OTHER_F });
  ok(!L.hard.some(w => /duplicate/.test(w)), 'a DIFFERENT ability through the other door is not a duplicate', JSON.stringify(L.hard));
  const L2 = purchaseLegality(buy(rogue(), 'feature', F), 'subabil', { v: OTHER_S });
  ok(!L2.hard.some(w => /duplicate/.test(w)), 'a DIFFERENT ability through the subclass door is not a duplicate', JSON.stringify(L2.hard)); }

console.log('== price: counted once, and the same as a single-door purchase');
{ const single = compute(buy(rogue(), 'subabil', S)).total;
  const both1 = compute(buy(buy(rogue(), 'subabil', S), 'feature', F)).total;
  const both2 = compute(buy(buy(rogue(), 'feature', F), 'subabil', S)).total;
  ok(both1 === single, 'subclass then feature costs the same as subclass alone', both1 + ' vs ' + single);
  ok(both2 === compute(buy(rogue(), 'feature', F)).total, 'feature then subclass costs the same as feature alone', both2 + ' vs ' + compute(buy(rogue(), 'feature', F)).total); }

console.log('== every mirrored ability is guarded (both orders, all of them)');
{ const miss = []; let n = 0;
  for (const [k, a] of Object.entries(DATA.subAbilMap)) {
    const id = a.cls + ': ' + a.name; const base = baseBuild(); base.originClass = a.cls; base.hd = 20; base.budget = 9999; base.freeSub = { [a.cls]: a.sub };
    const x = purchaseLegality(buy(base, 'subabil', k), 'feature', { v: id });
    const y = purchaseLegality(buy(base, 'feature', id), 'subabil', { v: k });
    n++;
    if (!x.hard.some(w => /duplicate/.test(w)) || !y.hard.some(w => /duplicate/.test(w))) miss.push(k);
  }
  ok(miss.length === 0, 'all ' + n + ' abilities refused as a duplicate in BOTH orders', miss.slice(0, 5).join(' | ')); }

console.log('== a build with no purchase order agrees with the order CharGen SAVES in (feature events first)');
{ const b = rogue(); b.features = [F]; b.subAbilities = [S];   // no b._abilDoor — CharGen reads two independent page lists
  const r = compute(b);
  ok(r.warnings.some(w => /duplicate: already owned as a Rogue class feature/.test(w)), 'unstamped: the SUBCLASS copy is the duplicate (the feature copy is treated as first)', JSON.stringify(r.warnings));
  // CharGen's save emits every `feature` event before any `subabil` event; reloading that log stamps feature-first. The live (unstamped)
  // view and the reloaded log must agree about which copy counts, or Save + Load would silently swap it.
  const replayed = compute(buy(buy(rogue(), 'feature', F), 'subabil', S));
  ok(JSON.stringify(replayed.warnings) === JSON.stringify(r.warnings) && replayed.total === r.total,
    'live unstamped build == the log CharGen saves (same warnings, same total)', JSON.stringify([replayed.warnings, r.warnings, replayed.total, r.total])); }

console.log('== the stamp stays honest');
{ // a copy that predates the stamp (base snapshot / legacy patch bundle) is the FIRST copy, whichever door buys next
  const b = rogue(); b.subAbilities = [S];                    // arrived with no buy event: unstamped
  const c = clone(b); MUT.feature(c, { v: F });
  ok(c._abilDoor && c._abilDoor[F] === 's', 'an older unstamped subclass copy is credited as first when the feature copy is bought later', JSON.stringify(c._abilDoor));
  ok(compute(c).warnings.some(w => /duplicate: already owned as a Soulknife subclass ability/.test(w)), '...so the LATER feature copy is the duplicate', JSON.stringify(compute(c).warnings));
  const b2 = rogue(); b2.features = [F];
  const c2 = clone(b2); MUT.subabil(c2, { v: S });
  ok(c2._abilDoor && c2._abilDoor[F] === 'f', 'an older unstamped feature copy is credited as first when the subclass copy is bought later', JSON.stringify(c2._abilDoor)); }
{ // remove the first copy in place, then buy through the other door and back: the stale stamp must not survive
  let b = buy(rogue(), 'feature', F);                         // stamp: feature first
  b.features = [];                                             // removed in place, not by replaying a log
  b = buy(b, 'subabil', S);                                    // stamp must reset to the subclass door
  ok(b._abilDoor[F] === 's', 'a stamp whose door no longer holds the ability is dropped and re-stamped', JSON.stringify(b._abilDoor));
  b = buy(b, 'feature', F);
  ok(compute(b).warnings.some(w => /duplicate: already owned as a Soulknife subclass ability/.test(w)), '...and the next copy is correctly the duplicate', JSON.stringify(compute(b).warnings)); }

console.log('== a repeated key is one duplicate, not several');
{ const b = rogue(); b.features = [F]; b.subAbilities = [S, S]; b._abilDoor = { [F]: 'f' };
  const r = compute(b);
  const dups = r.warnings.filter(w => /duplicate/.test(w));
  ok(dups.length === 1, 'subAbilities [S,S] + feature first: ONE duplicate warning', JSON.stringify(dups));
  const bl = (r.itemize && r.itemize['Blocked purchases']) || [];
  ok(bl.length === 1, '...and ONE Blocked-purchases line', JSON.stringify(bl)); }

console.log('== the two doors really are the same item (the premise of one shared identity)');
{ const bad = [];
  for (const [k, a] of Object.entries(DATA.subAbilMap)) {
    const f = DATA.features[a.cls + ': ' + a.name];
    if (!f) { bad.push(k + ' (no mirror)'); continue; }
    if (requiredHD(a) !== requiredHD(f)) bad.push(k + ' (requiredHD differs)');
    if (a.tier !== f.tier || a.origin !== f.origin || a.cross !== f.cross) bad.push(k + ' (tier/price differs)');
    if (f.inv) bad.push(k + ' (mirror is an Eldritch Invocation: those lists are not covered by ownsAbility)');
  }
  ok(bad.length === 0, 'every mirror has the same Hit-Dice requirement, tier and price, and none is an invocation', bad.slice(0, 4).join(' | ')); }
{ const mirrored = new Set(Object.values(DATA.subAbilMap).map(a => a.cls + ': ' + a.name));
  const hits = Object.entries(DATA.features).filter(([, f]) => (f.prereq || []).some(p => mirrored.has(p))).map(([k]) => k);
  // compute()'s prerequisite gate reads b.features only, while ownsAbility() reads both doors. That disagreement is latent (no data row has
  // this shape) — this assertion is what turns the next data edit that creates one into a failing test instead of a quiet bug.
  ok(hits.length === 0, 'no feature names a mirrored subclass ability as its prerequisite (the prereq gate sees b.features only)', hits.join(' | ')); }

console.log('== the mirrored-identity cache follows DATA');
{ const FK = 'Rogue: ZZ Cache Probe', SK = 'Rogue|Soulknife|ZZ Cache Probe';
  const stamp = () => { const c = buy(rogue(), 'subabil', SK); return c._abilDoor && c._abilDoor[FK]; };
  ok(stamp() === undefined, 'before the entry exists nothing is stamped');
  DATA.subAbilMap[SK] = { cls: 'Rogue', sub: 'Soulknife', name: 'ZZ Cache Probe', tb: 'T1 Passive', tier: 1, origin: 1, cross: 2 };
  DATA.features[FK] = { cls: 'Rogue', tb: 'T1 Passive', origin: 1, cross: 2, tier: 1, band: 3, rep: false };
  try { ok(stamp() === 's', 'a subAbilMap entry added AFTER the cache was built is picked up (no stale answer)', String(stamp())); }
  finally { delete DATA.subAbilMap[SK]; delete DATA.features[FK]; }
  ok(stamp() === undefined, '...and dropped again when it is removed'); }

// ---------------------------------------------------------------------------------------------------------------------------
// feat/subability-prereq — a subclass ability can name a prerequisite feature (Circle Forms needs Wild Shape). The subclass loop used
// to apply the Hit-Dice gate only; it now applies the same prerequisite gate the feature loop does, so BOTH doors enforce it.
const CF_S = 'Druid|Circle of the Moon|Circle Forms', CF_F = 'Druid: Circle Forms', WS = 'Druid: Wild Shape';
const druid = () => { const b = baseBuild(); b.originClass = 'Druid'; b.hd = 8; b.budget = 300; b.freeSub = { Druid: 'Circle of the Moon' }; return b; };

console.log('== prerequisites on subclass abilities: the three data copies agree');
{ const bad = [];
  for (const [k, a] of Object.entries(DATA.subAbilMap)) {
    const f = DATA.features[a.cls + ': ' + a.name];
    const sc = ((DATA.subclasses[a.cls] || {})[a.sub] || {}).abilities || [];
    const s = sc.find(x => x.name === a.name);
    const want = JSON.stringify(a.prereq || []);
    if (JSON.stringify((f && f.prereq) || []) !== want) bad.push(k + ' (features copy differs)');
    if (!s || JSON.stringify(s.prereq || []) !== want) bad.push(k + ' (subclasses copy differs)');
    for (const p of (a.prereq || [])) if (!DATA.features[p]) bad.push(k + ' (prerequisite ' + p + ' is not a feature)');
  }
  ok(bad.length === 0, 'subAbilMap, DATA.features and DATA.subclasses carry the same prereq for all ' + Object.keys(DATA.subAbilMap).length + ' abilities', bad.slice(0, 3).join(' | '));
  ok(JSON.stringify(DATA.subAbilMap[CF_S].prereq) === JSON.stringify([WS]), 'Circle Forms requires exactly base Wild Shape (not the 6-forms step: that would block a live character who owns Circle Forms without it)', JSON.stringify(DATA.subAbilMap[CF_S].prereq)); }

console.log('== prerequisites: both doors refuse it, and a met prerequisite changes nothing');
{ const L1 = purchaseLegality(druid(), 'subabil', { v: CF_S });
  ok(L1.hard.some(w => /requires Wild Shape first/.test(w)), 'subclass door without Wild Shape: REFUSED, naming the prerequisite', JSON.stringify(L1.hard));
  const L2 = purchaseLegality(druid(), 'feature', { v: CF_F });
  ok(L2.hard.some(w => /requires Wild Shape first/.test(w)), 'feature door without Wild Shape: REFUSED with the same reason', JSON.stringify(L2.hard));
  ok(JSON.stringify(L1.hard) === JSON.stringify(L2.hard), 'both doors give the IDENTICAL refusal text', JSON.stringify([L1.hard, L2.hard]));
  const withWS = buy(druid(), 'feature', WS);
  ok(purchaseLegality(withWS, 'subabil', { v: CF_S }).hard.length === 0, 'subclass door WITH Wild Shape: allowed');
  ok(purchaseLegality(withWS, 'feature', { v: CF_F }).hard.length === 0, 'feature door WITH Wild Shape: allowed');
  ok(purchaseLegality(druid(), 'feature', { v: WS }).hard.length === 0, 'Wild Shape itself stays buyable first'); }
{ // a met prerequisite must not change the price: compare against the same build with the prereq stripped from all three data copies
  const mk = () => buy(buy(druid(), 'feature', WS), 'subabil', CF_S);
  const withPrereq = compute(mk());
  const saved = [DATA.subAbilMap[CF_S].prereq, DATA.features[CF_F].prereq, DATA.subclasses.Druid['Circle of the Moon'].abilities.find(x => x.name === 'Circle Forms').prereq];
  delete DATA.subAbilMap[CF_S].prereq; delete DATA.features[CF_F].prereq; delete DATA.subclasses.Druid['Circle of the Moon'].abilities.find(x => x.name === 'Circle Forms').prereq;
  let without;
  try { without = compute(mk()); }
  finally { DATA.subAbilMap[CF_S].prereq = saved[0]; DATA.features[CF_F].prereq = saved[1]; DATA.subclasses.Druid['Circle of the Moon'].abilities.find(x => x.name === 'Circle Forms').prereq = saved[2]; }
  ok(withPrereq.total === without.total && JSON.stringify(withPrereq.warnings) === JSON.stringify(without.warnings),
    'with Wild Shape owned, the prerequisite changes neither the price nor the warnings (a live owner is unaffected)', JSON.stringify([withPrereq.total, without.total, withPrereq.warnings])); }
{ // order of purchase is irrelevant: the gate reads the final owned set
  const lateWS = buy(buy(druid(), 'subabil', CF_S), 'feature', WS);
  ok(compute(lateWS).warnings.length === 0, 'Circle Forms bought BEFORE Wild Shape is fine once Wild Shape is owned', JSON.stringify(compute(lateWS).warnings)); }

console.log('== a prerequisite that is itself blocked, and a prerequisite list with several entries');
{ // Wild Shape owned but Hit-Dice-gated (temporarily raised above this build's level): it is "blocked", so it must not satisfy Circle Forms
  const savedLvl = DATA.features[WS].lvl;
  DATA.features[WS].lvl = 15;
  try {
    const b = buy(buy(druid(), 'feature', WS), 'subabil', CF_S);        // hd 8: Wild Shape is blocked by its level gate
    const r = compute(b);
    ok(r.warnings.some(w => /Wild Shape — blocked: needs/.test(w)), 'precondition: Wild Shape is Hit-Dice-blocked at this level', JSON.stringify(r.warnings));
    ok(r.warnings.some(w => /Circle Forms — blocked: requires Wild Shape first/.test(w)), 'a BLOCKED prerequisite does not satisfy Circle Forms (the engine resolves prerequisites through blocks)', JSON.stringify(r.warnings));
  } finally { if (savedLvl === undefined) delete DATA.features[WS].lvl; else DATA.features[WS].lvl = savedLvl; } }
{ // two prerequisites, only one owned: still blocked, naming the FIRST missing one (same wording rule as the feature loop)
  const key = CF_S, a = DATA.subAbilMap[key], savedA = a.prereq, savedF = DATA.features[CF_F].prereq;
  a.prereq = [WS, 'Druid: Primal Order']; DATA.features[CF_F].prereq = [WS, 'Druid: Primal Order'];
  try {
    const b = buy(buy(druid(), 'feature', WS), 'subabil', CF_S);
    const w = compute(b).warnings.filter(x => /Circle Forms/.test(x));
    ok(w.length === 1 && /requires Primal Order first/.test(w[0]), 'with Wild Shape owned but a second prerequisite missing, it is blocked and names the missing one', JSON.stringify(w));
    const c = buy(b, 'feature', 'Druid: Primal Order');
    ok(compute(c).warnings.filter(x => /Circle Forms/.test(x)).length === 0, '...and unblocked once both are owned', JSON.stringify(compute(c).warnings));
  } finally { a.prereq = savedA; DATA.features[CF_F].prereq = savedF; } }

console.log('== prerequisites + the duplicate guard together');
{ const b = druid(); b.features = [CF_F]; b.subAbilities = [CF_S];       // both doors, no Wild Shape, unstamped -> feature copy counts
  const r = compute(b);
  const bl = (r.itemize && r.itemize['Blocked purchases']) || [];
  ok(bl.length === 1, 'both doors, prerequisite missing: the ability appears ONCE under Blocked purchases (counted copy blocked; duplicate not listed again)', JSON.stringify(bl));
  ok(r.warnings.filter(w => /requires Wild Shape first/.test(w)).length === 1 && r.warnings.filter(w => /duplicate/.test(w)).length === 1,
    '...with one prerequisite warning and one duplicate warning', JSON.stringify(r.warnings));
  const c = druid(); c.features = [CF_F]; c.subAbilities = [CF_S]; c._abilDoor = { [CF_F]: 's' };   // subclass copy counted, feature copy the duplicate
  const r2 = compute(c); const bl2 = (r2.itemize && r2.itemize['Blocked purchases']) || [];
  ok(bl2.length === 1, 'same with the subclass copy counted: still ONE Blocked-purchases line', JSON.stringify(bl2)); }

console.log('\n' + (fail ? '✗ ' + fail + ' FAILED / ' + pass + ' passed' : '✓ ' + pass + ' passed / 0 failed'));
process.exit(fail ? 1 : 0);
