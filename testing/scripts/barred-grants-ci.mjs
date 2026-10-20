// feat/bar-unreviewed-grants — ten abilities are barred "for the time being" (v0.382) until the owner reviews each one.
// Six class features (Disciplined Survivor, Iron Mind, Otherworldly Glamour, Bonus Skills, Magical Secrets, Body and Mind) and two arts
// (Telepathic, Tavern Brawler) carry bar:true; the free off-list spell picks of Eldritch Knight, Arcane Trickster and Magical Secrets
// (DATA.spellGrants.choiceGrants) carry bar:true and ownedChoiceGrants() skips them. bar never touches pricing: a character that already
// owns one keeps the same price and replays unchanged. The two epic boons Boon of Fortitude and Boon of Skill are deliberately NOT barred.
// Pure Node. Run: node testing/scripts/barred-grants-ci.mjs
import { DATA, compute, baseBuild, ownedChoiceGrants, grantedSpells } from '../../js/engine.js';

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? ' — ' + x : '')); } };
const clone = o => JSON.parse(JSON.stringify(o));
const mk = (cls, extra) => Object.assign(baseBuild(), { originClass: cls, hd: 20, budget: 900, stats: { STR: 10, DEX: 12, CON: 14, INT: 12, WIS: 12, CHA: 10 } }, extra || {});
const total = b => compute(b).total;

const FEATS = { 'Monk: Disciplined Survivor (Focus)': 'Monk', 'Ranger: Iron Mind': 'Ranger', 'Ranger: Otherworldly Glamour': 'Ranger',
  'Bard: Bonus Skills': 'Bard', 'Bard: Magical Secrets': 'Bard', 'Monk: Body and Mind': 'Monk' };
const ARTS = ['Telepathic', 'Tavern Brawler'], GRANTS = ['Bard: Magical Secrets', 'Fighter: Eldritch Knight', 'Rogue: Arcane Trickster'];

console.log('== the flags');
for (const k of Object.keys(FEATS)) ok(DATA.features[k] && DATA.features[k].bar === true, k + ' is bar:true');
for (const k of Object.keys(FEATS)) ok(DATA.featureList.indexOf(k) < 0, k + ' is out of featureList (search-all)');
for (const k of ARTS) ok(DATA.arts[k] && DATA.arts[k].bar === true, k + ' (art) is bar:true');
for (const k of GRANTS) ok(DATA.spellGrants.choiceGrants[k].bar === true, k + ' choice grant is bar:true');
ok(!DATA.boons['Boon of Fortitude'].bar && !DATA.boons['Boon of Skill'].bar, 'Boon of Fortitude and Boon of Skill are not barred');
ok(!DATA.spellGrants.choiceGrants['Wizard: Spellbook'].bar, 'Wizard: Spellbook is untouched');

console.log('== an owner keeps their price (bar never reprices)');
const PRICE = { 'Monk: Disciplined Survivor (Focus)': [19, 30], 'Ranger: Iron Mind': [11, 18], 'Ranger: Otherworldly Glamour': [9, 14],
  'Bard: Bonus Skills': [9, 14], 'Bard: Magical Secrets': [13, 22], 'Monk: Body and Mind': [19, 32] };
for (const [k, cls] of Object.entries(FEATS)) {
  const own = total(mk(cls, { features: [k] })) - total(mk(cls));
  const other = total(mk('Wizard', { features: [k] })) - total(mk('Wizard'));
  ok(own === PRICE[k][0], k + ' still costs its origin price ' + PRICE[k][0] + ' to a ' + cls, String(own));
  ok(other === PRICE[k][1], k + ' still costs its cross-class price ' + PRICE[k][1] + ' to another class', String(other));
}
for (const k of ARTS) {
  const d = total(mk('Fighter', { arts: [k] })) - total(mk('Fighter'));
  ok(d === DATA.arts[k].ap, k + ' (art) still costs ' + DATA.arts[k].ap + ' to an owner', String(d));
}

console.log('== the free off-list spell picks are switched off');
const named = key => ({ [key]: ['Fireball', 'Shield', 'Counterspell', 'Wish', 'Time Stop', 'Meteor Swarm'] });
const ek = mk('Fighter', { freeSub: { Fighter: 'Eldritch Knight' }, grantNames: named('Fighter: Eldritch Knight') });
const at = mk('Rogue', { freeSub: { Rogue: 'Arcane Trickster' }, grantNames: named('Rogue: Arcane Trickster') });
const ms = mk('Bard', { features: ['Bard: Magical Secrets'], grantNames: named('Bard: Magical Secrets') });
for (const [n, b] of [['Eldritch Knight', ek], ['Arcane Trickster', at], ['Magical Secrets', ms]]) {
  ok(ownedChoiceGrants(b).length === 0, n + ': ownedChoiceGrants() lists no free-pick block', JSON.stringify(ownedChoiceGrants(b).map(g => g.key)));
  ok(grantedSpells(b).filter(s => s.kind === 'grant').length === 0, n + ': grantedSpells() lists no granted pick');
}
{ // mutation check: without the flag the engine would list the block, so the zero above is the flag's doing, not an empty fixture
  const saved = DATA.spellGrants.choiceGrants['Fighter: Eldritch Knight'].bar;
  delete DATA.spellGrants.choiceGrants['Fighter: Eldritch Knight'].bar;
  ok(ownedChoiceGrants(ek).length === 1, 'control: with bar removed the Eldritch Knight block comes back', String(ownedChoiceGrants(ek).length));
  DATA.spellGrants.choiceGrants['Fighter: Eldritch Knight'].bar = saved;
}
ok(total(ek) === total(mk('Fighter', { freeSub: { Fighter: 'Eldritch Knight' } })), 'naming grant spells changes no price');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
