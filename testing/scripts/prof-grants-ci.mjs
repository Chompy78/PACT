// feat/primal-order-magician-warden — gate for features that hand out a proficiency, a cantrip or a skill-check bonus.
// (docs/plans/2026-10-20-primal-order-magician-warden.md)
//
// The 2024 Druid Primal Order and Cleric Divine Order each offer two options. PACT sells them as separate features:
//   Warden / Protector     no price of their own ("free":true). They switch on weapon + armour proficiency flags (grantsProf), and the
//                          EXISTING proficiency lines charge for the union, so they cost exactly what buying the same proficiencies by
//                          hand costs: Warden 15 AP (Simple 1 + all martial 8 + Light 2 + Medium 4), Protector 21 (adds Heavy 6).
//   Magician / Thaumaturge 6 AP. One cantrip (kept in b.fsCantripNames under the feature's label) and a flat skill-check bonus
//                          (checkBonus: the WIS modifier, at least +1) that skillMods() adds to Arcana + Nature / Arcana + Religion.
//   the old keys           kept as retired ("bar":true) features, so a saved purchase still prices and replays. Only the Druid one carries a
//                          grandfathered grant (martial weapons + Medium armour, NOT Simple, NOT Light — owner decision Y1/Z1): it shows on
//                          the sheet but is never priced and raises no prerequisite warning.
// Pure Node, no browser. Run: node testing/scripts/prof-grants-ci.mjs
import { DATA, compute, baseBuild, MUT, priceOf, profGrants, skillMods, grantedSpells, weaponSheetDefaults, armourEligible } from '../../js/engine.js';

let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const clone = o => JSON.parse(JSON.stringify(o));

const W = 'Druid: Primal Order (Warden)', M = 'Druid: Primal Order (Magician)', OLD_D = 'Druid: Primal Order';
const P = 'Cleric: Divine Order (Protector)', T = 'Cleric: Divine Order (Thaumaturge)', OLD_C = 'Cleric: Divine Order (Protector/Thaumaturge)';

// A build with room to spare (so OVER BUDGET never muddies a warning check).
const mk = (cls, extra) => Object.assign(baseBuild(), { originClass: cls, hd: 3, budget: 500, stats: { STR: 10, DEX: 12, CON: 14, INT: 10, WIS: 14, CHA: 10 } }, extra || {});
const druid = extra => mk('Druid', extra), cleric = extra => mk('Cleric', extra);
const total = b => compute(b).total;
const line = (b, label) => { const l = compute(b).lines.find(x => x[0] === label); return l ? l[1] : 0; };
const delta = (withFeat, without) => total(withFeat) - total(without);
const profWarn = r => r.warnings.filter(w => /Simple|Light|proficiency|prerequisite|no longer in the rules/i.test(w));

console.log('== Warden: priced by the existing proficiency lines');
{ const base = druid(), w = druid({ features: [W] });
  ok(delta(w, base) === 15, 'Warden alone adds 15 AP in total', String(delta(w, base)));
  ok(line(w, 'Weapon proficiency') === 9 && line(w, 'Armour proficiency') === 6, 'split as 9 AP weapon + 6 AP armour', line(w, 'Weapon proficiency') + '/' + line(w, 'Armour proficiency'));
  ok(profWarn(compute(w)).length === 0, 'no "needs Simple first" or other proficiency warning', JSON.stringify(profWarn(compute(w))));
  ok(priceOf(base, 'feature', { v: W }) === 15, 'priceOf (the frozen cost the tools record) is 15');
  const x = mk('Fighter', { features: [W] });
  ok(delta(x, mk('Fighter')) === 15, 'a cross-class buyer also pays 15 (the feature itself never costs the floor of 1)', String(delta(x, mk('Fighter'))));
  const mb = mk('Druid', { features: [W], martiallyBound: 'Druid' });
  ok(delta(mb, mk('Druid', { martiallyBound: 'Druid' })) === 15, 'a Martially Bound Druid also pays 15 (the 1 AP floor of the Martially Bound discount does not apply to a free feature)', String(delta(mb, mk('Druid', { martiallyBound: 'Druid' })))); }

console.log('== Warden: never charges twice');
{ const own = druid({ weaponProf: { simple: true }, armour: { light: true } });
  ok(delta(druid({ features: [W], weaponProf: { simple: true }, armour: { light: true } }), own) === 12, 'after Simple + Light it adds only the remaining 12');
  const all = druid({ weaponProf: { simple: true, allMartial: true }, armour: { light: true, medium: true } });
  ok(delta(druid({ features: [W], weaponProf: { simple: true, allMartial: true }, armour: { light: true, medium: true } }), all) === 0, 'after buying all four by hand it adds 0');
  ok(delta(druid({ weaponProf: { simple: true, allMartial: true }, armour: { light: true, medium: true } }), druid({ features: [W] })) === 0, 'buying the four by hand after Warden costs 0 more (same total)');
  ok(total(druid({ weaponProf: { simple: true }, armour: { light: true } })) === total(druid()) + 3, 'control: without Warden the bought flags are still priced (Simple 1 + Light 2)'); }

console.log('== Protector');
{ ok(delta(cleric({ features: [P] }), cleric()) === 21, 'Protector adds 21 AP (Simple 1 + all martial 8 + Light 2 + Medium 4 + Heavy 6)', String(delta(cleric({ features: [P] }), cleric())));
  ok(armourEligible(cleric({ features: [P] }), 'Plate').ok === true || armourEligible(cleric({ features: [P] }), 'Plate').reasons.every(r => !/proficiency/.test(r)), 'Protector shows heavy armour proficiency on the sheet');
  ok(delta(cleric({ features: [P, W] }), cleric({ features: [P] })) === 0, 'Protector + Warden together cost the same as Protector alone (the flags overlap)'); }

console.log('== Magician and Thaumturge');
{ ok(delta(druid({ features: [M] }), druid()) === 6, 'Magician costs 6 AP for an origin Druid', String(delta(druid({ features: [M] }), druid())));
  ok(delta(mk('Fighter', { features: [M] }), mk('Fighter')) === 7, 'Magician costs 7 AP cross-class');
  ok(delta(cleric({ features: [T] }), cleric()) === 6, 'Thaumaturge costs 6 AP for an origin Cleric');
  ok(delta(druid({ features: [M, W] }), druid()) === 21, 'Magician + Warden are not exclusive: 6 + 15');
  const sm = (b, s) => skillMods(b).find(x => x.skill === s);
  ok(sm(druid({ features: [M] }), 'Arcana').bonus === 2 && sm(druid({ features: [M] }), 'Nature').bonus === 2, 'Magician adds the WIS modifier (+2 at WIS 14) to Arcana and Nature');
  ok(sm(druid({ features: [M] }), 'Religion').bonus === 0 && sm(druid({ features: [M] }), 'History').bonus === 0, 'no bonus to other skills');
  ok(sm(druid({ features: [M], stats: { STR: 10, DEX: 12, CON: 14, INT: 10, WIS: 8, CHA: 10 } }), 'Arcana').bonus === 1, 'a negative WIS modifier still gives the minimum +1');
  ok(sm(cleric({ features: [T] }), 'Religion').bonus === 2 && sm(cleric({ features: [T] }), 'Nature').bonus === 0, 'Thaumaturge: Arcana + Religion, not Nature');
  ok(sm(druid({ features: [M] }), 'Arcana').total === sm(druid(), 'Arcana').total + 2, 'the bonus is in the skill total');
  ok(sm(druid({ features: [M], skills: ['Arcana'] }), 'Arcana').total === sm(druid({ skills: ['Arcana'] }), 'Arcana').total + 2, 'it stacks with proficiency');
  ok(skillMods(druid()).every(s => s.bonus === 0), 'a build with neither feature has bonus 0 everywhere (nothing else changed)');
  const gs = b => grantedSpells(b).filter(s => s.kind === 'feature');
  ok(gs(druid({ features: [M], fsCantripNames: { [M]: ['Druidcraft'] } })).length === 1, 'the named cantrip appears in the spell list');
  ok(gs(druid({ features: [M], fsCantripNames: { [M]: ['Druidcraft', 'Guidance'] } })).length === 1, 'at most one cantrip counts');
  ok(gs(druid({ fsCantripNames: { [M]: ['Druidcraft'] } })).length === 0, 'a named cantrip without the feature grants nothing'); }

console.log('== the retired Druid Primal Order (grandfathered, one live character)');
{ const base = druid(), L = druid({ features: [OLD_D] });
  ok(delta(L, base) === 5, 'it still prices at its recorded 5 AP', String(delta(L, base)));
  ok(profWarn(compute(L)).length === 0, 'no proficiency warning (martial without Simple, Medium without Light, raise none)', JSON.stringify(profWarn(compute(L))));
  const g = profGrants(L);
  ok(g.weaponProf.allMartial === true && !g.weaponProf.simple, 'sheet: all martial weapons yes, Simple no');
  ok(g.armour.medium === true && !g.armour.light && !g.armour.heavy, 'sheet: Medium armour yes, Light no, Heavy no');
  ok(Object.keys(g.priced.weaponProf).length === 0 && Object.keys(g.priced.armour).length === 0, 'none of it is priced');
  ok(weaponSheetDefaults({ cat: 'martial', id: 'longsword', props: [] }, L).prof === true && weaponSheetDefaults({ cat: 'simple', id: 'club', props: [] }, L).prof === false, 'weapon list: martial proficient, simple not');
  ok(armourEligible(L, 'Half Plate').ok === true && armourEligible(L, 'Leather').ok === false, 'armour list: Half Plate ok, Leather not');
  // does not leak
  ok(Object.keys(profGrants(druid({ features: [W] })).priced.weaponProf).length === 2, 'control: Warden alone still sets simple + allMartial as priced');
  ok(profGrants(druid({ features: [M] })).weaponProf.allMartial === undefined, 'the new Magician key gets no grant');
  ok(profGrants(cleric({ features: [OLD_C] })).weaponProf.allMartial === undefined && profGrants(cleric({ features: [OLD_C] })).armour.medium === undefined, 'the retired Cleric key grants nothing');
  ok(delta(druid({ features: [OLD_D, W] }), druid({ features: [W] })) === 5, 'retired key + Warden: the 5 AP is added, the proficiency lines are charged once (Warden\'s)');
  // replays
  const b2 = druid(); MUT.feature(b2, { v: OLD_D });
  ok(b2.features.includes(OLD_D) && total(b2) - total(base) === 5, 'replaying a saved "buy feature" event for the old key still works and prices 5');
  ok(!compute(b2).warnings.some(w => /no longer in the rules data/.test(w)), 'no "no longer in the rules data" warning'); }

console.log('== data integrity');
{ const F = DATA.features;
  ok(F[OLD_D].bar === true && F[OLD_C].bar === true, 'both retired keys carry bar:true');
  ok(!(DATA.featureList || []).includes(OLD_D) && !(DATA.featureList || []).includes(OLD_C), 'neither retired key is in the purchase list');
  ok([W, M, P, T].every(k => (DATA.featureList || []).includes(k)), 'all four new keys are in the purchase list');
  ok(F[W].free === true && F[P].free === true && F[W].origin === 0 && F[P].cross === 0, 'Warden and Protector are free:true with 0/0 data prices');
  ok([M, T].every(k => F[k].origin === 6 && F[k].cross === 7), 'Magician and Thaumaturge are 6 origin / 7 cross');
  const flags = { weapons: ['simple', 'martial', 'allMartial', 'improvised'], armour: ['light', 'medium', 'heavy', 'shield'] };
  const bad = [];
  for (const [k, f] of Object.entries(F)) for (const key of ['grantsProf', 'grandfather']) if (f[key]) {
    for (const x of (f[key].weapons || [])) if (!flags.weapons.includes(x)) bad.push(k + ' weapon ' + x);
    for (const x of (f[key].armour || [])) if (!flags.armour.includes(x)) bad.push(k + ' armour ' + x);
  }
  ok(bad.length === 0, 'every proficiency flag a feature grants is a real flag', bad.join(' | '));
  const skills = (DATA.skillList || []).map(s => s[0]), badCb = [];
  for (const [k, f] of Object.entries(F)) if (f.checkBonus) for (const s of f.checkBonus.skills) if (!skills.includes(s)) badCb.push(k + ' ' + s);
  ok(badCb.length === 0, 'every skill a checkBonus names is a real skill', badCb.join(' | '));
  const free = Object.entries(F).filter(([, f]) => f.free).map(([k]) => k).sort().join(',');
  ok(free === [P, W].sort().join(','), 'exactly Warden and Protector are free:true (a stray free flag would give a feature away)', free); }

console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' passed / ' + fail + ' failed');
process.exit(fail ? 1 : 0);
