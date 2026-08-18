#!/usr/bin/env node
/**
 * PACT — "build it as abusively as possible" combat optimiser.
 *
 * WHY THIS EXISTS. The unlock-pricing question is really "can someone assemble a better combat
 * character by shopping in other classes than by staying home?" That is not answerable by staring at
 * a price table. This builds the strongest combat package an origin class can reach inside a level's
 * AP budget, letting it shop anywhere, and reports what it cost under each candidate unlock model.
 *
 * THE POWER METRIC IS THE ENGINE'S OWN, NOT MINE. Score is the sum of `tier` over the combat features
 * acquired. Tier is the designer's declared power scale — the thing every price in DATA is derived
 * from — so using it avoids inventing damage weights and then discovering the conclusion was an
 * artifact of the weights. It has one honest limitation, stated because it matters: Tier measures what
 * the designer thought a thing was worth, so this cannot find abuse that consists of a feature being
 * MIS-tiered. It finds abuse of the ACCESS RULES, which is the question actually on the table.
 *
 * Pricing is compute()'s throughout, via sim-unlock-timeline's replay(). Nothing is re-implemented.
 *
 * USAGE:  node testing/scripts/sim-combat-abuse.mjs [level]        (default 20)
 */
import { DATA, compute, baseBuild } from '../../js/engine.js';
import { replay, UNLOCK_MODELS, tierOf } from './sim-unlock-timeline.mjs';

const LVL = +(process.argv.find(a => /^\d+$/.test(a)) || 20);
const BUDGET = DATA.apByLevel[LVL];

// ── the combat pool ─────────────────────────────────────────────────────────────────────────────
// Named explicitly rather than regex-matched, so what counts as "combat" is auditable and any
// argument about the result is an argument about this list rather than about a hidden filter.
const COMBAT = [
  // attacks & action economy
  'Fighter: Extra Attack', 'Fighter: Extra Attack (2nd)', 'Fighter: Extra Attack (3rd)',
  'Barbarian: Extra Attack', 'Monk: Extra Attack', 'Paladin: Extra Attack', 'Ranger: Extra Attack',
  'Bard: Extra Attack', 'Warlock: Thirsting Blade',
  'Fighter: Action Surge', 'Fighter: Action Surge (2nd use)',
  'Monk: Flurry / Patient Defense / Step',
  // damage riders
  'Rogue: Sneak Attack', 'Rogue: Cunning Strike', 'Rogue: Improved Cunning Strike (L11)',
  'Barbarian: Rage', 'Barbarian: Reckless Attack', 'Barbarian: Brutal Strike',
  'Barbarian: Brutal Strike, improved (L13)', 'Barbarian: Brutal Strike, improved (L17)',
  'Paladin: Radiant Strikes', 'Cleric: Blessed Strikes', 'Fighter: Studied Attacks',
  'Monk: Stunning Strike', 'Monk: Empowered Strikes / Self-Restoration',
  // durability / mitigation that directly buys combat rounds
  'Fighter: Second Wind', 'Fighter: Second Wind (3 uses)', 'Fighter: Second Wind (4 uses)',
  'Fighter: Indomitable', 'Fighter: Indomitable (2 uses)', 'Fighter: Indomitable (3 uses)',
  'Barbarian: Relentless Rage', 'Barbarian: Persistent Rage', 'Barbarian: Indomitable Might',
  'Monk: Deflect Attacks', 'Monk: Evasion', 'Paladin: Aura of Courage',
].filter(k => { if (!DATA.features[k]) { console.error(`  ! not in DATA.features, dropped: ${k}`); return false; } return true; });

// NON-STACKING GROUPS. Six classes each sell a "Extra Attack" and they are the same second attack;
// the engine charges for all six (102 AP for a Rogue) and warns that "a 2nd attack doesn't stack; the
// duplicates add no benefit". The first version of this optimiser duly bought all six, because raw
// summed Tier counts them as +24 of power. That is the metric being gamed, not the game — so only the
// first member of a group scores. Fighter's (2nd)/(3rd) are NOT in the group: those are genuinely
// additional attacks and do stack on top.
const NON_STACKING = [
  ['Fighter: Extra Attack', 'Barbarian: Extra Attack', 'Monk: Extra Attack', 'Paladin: Extra Attack',
   'Ranger: Extra Attack', 'Bard: Extra Attack', 'Warlock: Thirsting Blade'],
];
const groupOf = k => NON_STACKING.findIndex(g => g.includes(k));
/** Score a set, crediting each non-stacking group at most once. */
function score(set) {
  const seen = new Set();
  let t = 0;
  for (const k of set) {
    const g = groupOf(k);
    if (g >= 0) { if (seen.has(g)) continue; seen.add(g); }
    t += DATA.features[k].tier;
  }
  return t;
}

const PREREQ = Object.fromEntries(COMBAT.map(k => [k, DATA.features[k].prereq || []]));
// Stepped attack/use ladders are only meaningful in order; encode the ones the names imply.
const IMPLIED = {
  'Fighter: Extra Attack (2nd)': ['Fighter: Extra Attack'],
  'Fighter: Extra Attack (3rd)': ['Fighter: Extra Attack (2nd)'],
  'Fighter: Second Wind (3 uses)': ['Fighter: Second Wind'],
  'Fighter: Second Wind (4 uses)': ['Fighter: Second Wind (3 uses)'],
  'Fighter: Indomitable (2 uses)': ['Fighter: Indomitable'],
  'Fighter: Indomitable (3 uses)': ['Fighter: Indomitable (2 uses)'],
  'Fighter: Action Surge (2nd use)': ['Fighter: Action Surge'],
  'Barbarian: Brutal Strike, improved (L13)': ['Barbarian: Brutal Strike'],
  'Barbarian: Brutal Strike, improved (L17)': ['Barbarian: Brutal Strike, improved (L13)'],
  'Rogue: Improved Cunning Strike (L11)': ['Rogue: Cunning Strike'],
  'Barbarian: Relentless Rage': ['Barbarian: Rage'],
  'Barbarian: Persistent Rage': ['Barbarian: Relentless Rage'],
};
const needs = k => [...new Set([...(PREREQ[k] || []), ...(IMPLIED[k] || [])])];

/** Marginal AP for `feat` given a set already owned, at this level, priced by compute(). */
function priceOf(originClass, owned, unlocked, feat) {
  const b = baseBuild();
  b.originClass = originClass; b.budget = 1e6; b.hd = LVL;
  b.unlockedClasses = [...unlocked];
  b.features = [...owned];
  const before = compute(b).total;
  b.features.push(feat);
  return compute(b).total - before;
}

/** Greedy best-ratio knapsack with prerequisite closure. Ties broken by cheaper. */
function pack(originClass, unlocked, budget) {
  const owned = new Set(); let spent = 0;
  for (;;) {
    let best = null;
    for (const k of COMBAT) {
      if (owned.has(k)) continue;
      const chain = [];
      const walk = x => { for (const p of needs(x)) if (!owned.has(p)) { walk(p); if (!chain.includes(p)) chain.push(p); } };
      walk(k); chain.push(k);
      if (chain.some(c => !COMBAT.includes(c))) continue;             // prereq outside the pool
      let cost = 0; const sim = [...owned];
      for (const c of chain) { cost += priceOf(originClass, sim, unlocked, c); sim.push(c); }
      if (spent + cost > budget) continue;
      const gain = score([...owned, ...chain]) - score([...owned]);
      if (gain <= 0) continue;    // a duplicate of something non-stacking: pure waste, never buy it
      const ratio = gain / Math.max(1, cost);
      if (!best || ratio > best.ratio + 1e-9 || (Math.abs(ratio - best.ratio) < 1e-9 && cost < best.cost))
        best = { chain, cost, gain, ratio };
    }
    if (!best) break;
    for (const c of best.chain) owned.add(c);
    spent += best.cost;
  }
  return { owned: [...owned], spent };
}

// ── run ─────────────────────────────────────────────────────────────────────────────────────────
console.log(`PACT combat-abuse optimiser — engine ${DATA.version}, level ${LVL}, budget ${BUDGET} AP, char tier T${tierOf(LVL)}`);
console.log(`Pool: ${COMBAT.length} named combat features. Score = sum of Tier (the engine's own power scale).\n`);

const ORIGINS = ['Rogue', 'Fighter', 'Barbarian'];
const FOREIGN = ['Fighter', 'Barbarian', 'Rogue', 'Monk', 'Paladin', 'Ranger', 'Warlock', 'Cleric', 'Bard'];

for (const origin of ORIGINS) {
  console.log(`\n${'='.repeat(78)}\n${origin.toUpperCase()} — most combat Tier reachable inside ${BUDGET} AP\n${'='.repeat(78)}`);
  const cands = FOREIGN.filter(c => c !== origin);

  // Reserve AP for unlocks under each model, then pack the rest. Try unlocking 0..3 foreign classes.
  for (const mName of ['current 7N', 'flat 7', 'flat 10', 'HD 7+tier', 'HD 7xtier']) {
    let best = null;
    const tryUnlock = (set, when) => {
      const steps = set.map(c => ({ lvl: when, unlock: c }));
      const unlockCost = steps.length ? replay(origin, steps, mName).spent : 0;
      if (unlockCost > BUDGET) return;
      const r = pack(origin, set, BUDGET - unlockCost);
      const sc = score(r.owned);
      const total = unlockCost + r.spent;
      if (!best || sc > best.score || (sc === best.score && total < best.total))
        best = { score: sc, total, unlockCost, when, set, owned: r.owned };
    };
    tryUnlock([], 1);
    for (const a of cands) { tryUnlock([a], 1); tryUnlock([a], LVL); }
    for (const a of cands) for (const b of cands) if (a < b) { tryUnlock([a, b], 1); tryUnlock([a, b], LVL); }
    const uw = best.set.length ? `${best.set.join('+')} @L${best.when} (${best.unlockCost} AP)` : 'none';
    console.log(`  ${mName.padEnd(12)} score ${String(best.score).padStart(3)}  spent ${String(best.total).padStart(3)}/${BUDGET}  features ${String(best.owned.length).padStart(2)}  unlocks: ${uw}`);
    if (mName === 'flat 7') {
      const own = best.owned.filter(k => DATA.features[k].cls === origin).length;
      const foreignBought = best.owned.filter(k => DATA.features[k].cls !== origin);
      console.log(`               ${own}/${best.owned.length} from ${origin} itself, ${foreignBought.length} foreign:`);
      for (const c of [...new Set(foreignBought.map(k => DATA.features[k].cls))])
        console.log(`                 ${c}: ` + foreignBought.filter(k => DATA.features[k].cls === c)
          .map(k => k.split(': ')[1]).join(' · '));
    }
  }
}
