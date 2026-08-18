#!/usr/bin/env node
/**
 * PACT — event-log (timeline) unlock simulator.
 *
 * WHY THIS EXISTS. sim-unlock-economics.mjs prices STATIC builds: it knows what you own, never when
 * you bought it. That is fine for a flat or breadth-scaled unlock, and useless for an HD-tied one,
 * whose whole point is that the price depends on the character's tier at the moment of purchase.
 * This one replays a purchase TIMELINE through the real engine, so unlock timing is modelled instead
 * of assumed.
 *
 * HOW IT STAYS HONEST. Feature/ability pricing is never re-implemented — every purchase's cost is a
 * compute() delta on the build so far, so origin/sticker/cross, Martially Bound, stepped ladders and
 * the invocation surcharge all come from the engine. Only the UNLOCK line is modelled here, and it is
 * modelled by zeroing DATA.unlockCum (so the engine contributes nothing) and adding the candidate
 * model's price. That keeps exactly one pricing implementation in play at a time.
 *
 * STAMPED, NOT RECOMPUTED. An unlock's price is frozen into the LOG at the level it was bought, the
 * same way EV-015 pins Vigor ranks to the tier they were bought at. Recomputing it live would raise
 * the cost of an unlock you already own every time you level, which is the exact bug that fixture
 * exists to prevent.
 *
 * USAGE:  node testing/scripts/sim-unlock-timeline.mjs [--md]
 */
import { DATA, compute, baseBuild, foldBuild, economy } from '../../js/engine.js';

const LIVE_LADDER = DATA.unlockCum;
const ZERO = Array.from({ length: 16 }, () => 0);

/** Character tier from Hit Dice, per DATA.tierHD ({tier: minimum HD}). */
export function tierOf(hd) {
  let t = 1;
  for (const [tier, minHd] of Object.entries(DATA.tierHD)) if (hd >= minHd) t = Math.max(t, +tier);
  return t;
}

/** Unlock-cost models. (nth, charTier) -> AP for THAT unlock, stamped at purchase. */
export const UNLOCK_MODELS = {
  'current 7N':  (nth)            => 7 * nth,
  'flat 7':      ()               => 7,
  'flat 10':     ()               => 10,
  'HD 7+tier':   (_nth, tier)     => 7 + tier,
  'HD 7+2tier':  (_nth, tier)     => 7 + 2 * tier,
  'HD 7xtier':   (_nth, tier)     => 7 * tier,
  // Capped ladders. Proposed independently by two cold reviewers (Copilot at 14,
  // DeepSeek at 28) and absent from the original menu: keep escalation so breadth still
  // costs more, but clamp it so the 3rd-and-later unlock stops being unreachable.
  '7N cap 14':   (nth)            => Math.min(7 * nth, 14),
  '7N cap 21':   (nth)            => Math.min(7 * nth, 21),
  '7N cap 28':   (nth)            => Math.min(7 * nth, 28),
};

/**
 * Replay a timeline. `steps` is an ordered list of:
 *   {lvl, unlock:'Rogue'}                      — unlock a class at that level
 *   {lvl, feature:'Rogue: Sneak Attack'}       — buy a class feature
 *   {lvl, subabil:'Cleric|Life Domain|...'}    — buy a subclass ability
 *   {lvl, bundle:'Cleric|Life Domain'}         — buy a subclass spell bundle
 * Returns the frozen ledger plus per-level affordability.
 */
export function replay(originClass, steps, modelName, { origin2 = null } = {}) {
  const model = UNLOCK_MODELS[modelName];
  if (!model) throw new Error(`unknown unlock model: ${modelName}`);
  DATA.unlockCum = ZERO;                       // the engine contributes no unlock cost; we add ours
  try {
    const b = baseBuild();
    b.originClass = originClass;
    if (origin2) b.originClass2 = origin2;
    b.budget = 100000;
    b.hd = 1;
    b.features = []; b.subAbilities = []; b.subSpellBundles = []; b.unlockedClasses = [];

    const ledger = [];
    let nthUnlock = 0;

    for (const s of steps) {
      // Re-baseline AFTER setting Hit Dice and BEFORE the purchase. compute() charges for Hit Dice,
      // so without this the HD cost of levelling up lands inside the delta of whatever is bought next
      // — an early draft reported 131 AP for a single 28 AP feature bought at level 17 for exactly
      // that reason. Re-baselining every step also gives the right ledger semantics: a purchase is
      // frozen at the price it cost when made, and a later unlock does NOT retroactively refund it.
      b.hd = s.lvl;
      const tier = tierOf(s.lvl);
      const before = compute(b).total;
      let cost, label;
      if (s.unlock) {
        nthUnlock++;
        cost = model(nthUnlock, tier);           // STAMPED at this tier
        b.unlockedClasses.push(s.unlock);
        label = `unlock ${s.unlock}`;
      } else {
        const key = s.feature ? 'features' : s.subabil ? 'subAbilities' : 'subSpellBundles';
        const val = s.feature || s.subabil || s.bundle;
        b[key].push(val);
        cost = compute(b).total - before;
        label = val;
      }
      ledger.push({ lvl: s.lvl, tier, label, cost });
    }
    const spent = ledger.reduce((t, e) => t + e.cost, 0);
    // Affordability: cumulative spend at each level vs that level's AP budget.
    const breaches = [];
    let run = 0, byLvl = {};
    for (const e of ledger) { run += e.cost; byLvl[e.lvl] = run; }
    for (const [lvl, cum] of Object.entries(byLvl)) {
      const budget = DATA.apByLevel[lvl];
      if (budget != null && cum > budget) breaches.push({ lvl: +lvl, cum, budget, over: cum - budget });
    }
    return { spent, ledger, breaches, build: JSON.parse(JSON.stringify(b)) };
  } finally { DATA.unlockCum = LIVE_LADDER; }
}

/** Cheapest way to acquire `wants` (foreign-class features) by `lvl`, deciding which classes to unlock. */
export function cheapest(originClass, wants, modelName, lvl, { unlockAt = 1, origin2 = null } = {}) {
  const classesOf = w => (DATA.features[w] || {}).cls || w.split('|')[0];
  const foreign = [...new Set(wants.map(classesOf))].filter(c => c !== originClass && c !== origin2);
  let best = null;
  for (let mask = 0; mask < (1 << foreign.length); mask++) {
    const unlock = foreign.filter((_, i) => mask & (1 << i));
    const steps = [
      ...unlock.map(c => ({ lvl: unlockAt, unlock: c })),
      ...wants.map(w => (w.includes('|') ? { lvl, subabil: w } : { lvl, feature: w })),
    ];
    const r = replay(originClass, steps, modelName, { origin2 });
    if (!best || r.spent < best.spent) best = { ...r, unlock };
  }
  return best;
}

// ── self-check when run directly ────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`PACT unlock timeline — engine ${DATA.version}\n`);
  console.log('HD -> tier:', [1, 2, 3, 5, 9, 13, 17, 20].map(h => `${h}:T${tierOf(h)}`).join('  '));

  // The headline case: a non-Fighter martial who wants Fighter's third attack and nothing else.
  const WANT = ['Fighter: Extra Attack (3rd)'];
  console.log('\nOne T7 grab (Fighter: Extra Attack (3rd), sticker 28 / cross 35) by a Barbarian:');
  console.log('  model         unlock@L1  unlock@L17  no-unlock   cheapest');
  for (const mName of Object.keys(UNLOCK_MODELS)) {
    const early = replay('Barbarian', [{ lvl: 1, unlock: 'Fighter' }, { lvl: 17, feature: WANT[0] }], mName).spent;
    const late = replay('Barbarian', [{ lvl: 17, unlock: 'Fighter' }, { lvl: 17, feature: WANT[0] }], mName).spent;
    const none = replay('Barbarian', [{ lvl: 17, feature: WANT[0] }], mName).spent;
    const min = Math.min(early, late, none);
    const who = min === none ? 'DABBLE' : (min === early ? 'unlock early' : 'unlock late');
    console.log(`  ${mName.padEnd(13)} ${String(early).padStart(6)}     ${String(late).padStart(6)}      ${String(none).padStart(5)}      ${who}`);
  }
  console.log('\n  Read two things off this. (1) For ONE purchase, dabbling wins under every model — which');
  console.log('  is the intent. But under the current 7N and flat 7 it does not win, it TIES at 35: the');
  console.log('  surcharge does nothing at all to deter a single T7 grab, and unlocking is strictly');
  console.log('  better value for the same money because it opens the rest of the class too.');
  console.log('  (2) Only the HD-tied family makes unlock@L1 differ from unlock@L17. That is the new');
  console.log('  lever: it prices WHEN you commit, which no flat or breadth-scaled model can express.');
}
