#!/usr/bin/env node
// PACT — LOG-direct engine fuzzer (Phase 2 of the test-tool improvement plan; Phase 1 was
// random-manual-e2e.mjs's independent oracle, D-GH-2026-07-13-random-e2e-real-oracle).
//
// random-manual-e2e.mjs drives the real browser UI (species selects, +/- steppers, buy-panel
// tiles) — that's essential for catching UI-level bugs (the charsize/lineage clobber this
// session found), but it's slow (Playwright + a real page load per iteration) and every event
// it can generate has to survive a DOM click path first, so it can only reach LOG shapes the
// UI itself is capable of producing.
//
// This script skips the UI entirely: it constructs LOG event objects directly (the same shape
// `MUT`'s handlers expect — see the per-category table below, reverse-engineered from
// js/engine.js's `MUT` map and `_replay()`) and feeds them straight into `foldBuild()`/
// `compute()`/`rebuildStateFromEvents()`. Pure Node, no browser, no DOM — so it can run
// thousands of iterations in the time random-manual-e2e.mjs runs a handful, and it can reach
// LOG shapes (wild `ti`/`di`/`L` indices, duplicate buys, out-of-range stat values, `patch`
// bundles with arbitrary fields) no UI click sequence would ever produce. It is deliberately
// NOT trying to generate "legal" characters — DATA-pool values keep most events realistic so
// they exercise real MUT code paths, but the LOG-cost/budget-legality checks that matter for a
// real character are already covered by engine-parity's fixed fixtures and random-manual-e2e's
// independent oracle. This tool's job is narrower and complementary: does the engine ever
// throw, produce NaN, or disagree with itself, on ANY LOG a MUT-shaped event stream can form?
//
// On a failure, a lightweight delta-debug (single-element removal, iterated to a fixpoint)
// shrinks the failing LOG down to a minimal reproducer before printing it.
//
// Usage: node testing/scripts/log-fuzz.mjs [--iterations N] [--events N] [--seed N]
// Exit code 0 = no failures found; 1 = at least one failure (shrunk repro printed for each).

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---------- CLI args ----------
const args = process.argv.slice(2);
function argVal(name, dflt) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const v = args[i + 1];
  return v === undefined ? true : v;
}
const ITERATIONS = parseInt(argVal('iterations', '500'), 10);
const MAX_EVENTS = parseInt(argVal('events', '40'), 10);
if (!Number.isInteger(ITERATIONS) || ITERATIONS < 1) { console.error(`--iterations must be a positive integer, got ${argVal('iterations', '500')}`); process.exit(1); }
if (!Number.isInteger(MAX_EVENTS) || MAX_EVENTS < 1) { console.error(`--events must be a positive integer, got ${argVal('events', '40')}`); process.exit(1); }
const SEED = parseInt(argVal('seed', String(Date.now() & 0xffffffff)), 10);

// ---------- seeded RNG (mulberry32 — same generator as random-manual-e2e.mjs, so a --seed is
// reproducible but the two harnesses' seeds are not interchangeable with each other) ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const chance = (rng, p) => rng() < p;
const int = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));
const deepClone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
const deepEqualJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function log(msg) { console.log(`[fuzz] ${msg}`); }

// ---------- LOG generation ----------
// One `ctx` per generated LOG, tracking just enough running state to keep most events
// referencing things that actually exist (a `found` before a `rank`, a bought drawback before
// its `buyoff`) — see js/engine.js's MUT map, reproduced in the table below. Every handler is
// null-safe on a bad ti/di/index (silently no-ops rather than throwing — confirmed against
// js/engine.js:471-476), so occasionally handing it garbage is intentional chaos coverage, not
// a generator bug.
const STATS = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const ARMOUR_TYPES = ['light', 'medium', 'heavy', 'shield'];

function makeCtx() {
  return { tradCount: 0, discsByTi: {}, drawbacksBought: [], n: 0 };
}

function tradTi(rng, ctx, wild) {
  if (wild && chance(rng, 0.15)) return int(rng, 0, 5); // may or may not exist — no-op is fine
  return ctx.tradCount > 0 ? int(rng, 0, ctx.tradCount - 1) : 0;
}
function discDi(rng, ctx, ti, wild) {
  if (wild && chance(rng, 0.15)) return int(rng, 0, 5);
  const count = ctx.discsByTi[ti] || 0;
  return count > 0 ? int(rng, 0, count - 1) : 0;
}
function fuzzLevel(rng) {
  // mostly a legal 1-9 slot level; occasionally an out-of-range value to probe the
  // `d.slots[p.L-1]` / `d.known[p.L-1]` array-write boundary js/engine.js:474-475.
  return chance(rng, 0.8) ? int(rng, 1, 9) : int(rng, -3, 15);
}

// cat -> (rng, DATA, ctx) => payload. Matches js/engine.js's MUT map exactly (cat is the LOG
// event's `e.cat`, dispatched by `_replay()` — NOT `e.type`, which is always `'buy'` here).
const CAT_GENERATORS = {
  create: () => ({}),
  patch: (rng) => ({ patch: { gold: int(rng, 0, 200) } }),
  hd: (rng) => ({ to: int(rng, 1, 20) }),
  prof: (rng) => ({ to: int(rng, 2, 6) }),
  abil: (rng) => ({ ab: pick(rng, STATS), to: int(rng, 1, 20) }),
  skill: (rng, DATA) => ({ v: pick(rng, DATA.skillList)[0] }),
  expertise: (rng, DATA) => ({ v: pick(rng, DATA.skillList)[0] }),
  toolexpertise: (rng, DATA) => ({ v: pick(rng, DATA.toolList) }),
  save: (rng) => ({ v: pick(rng, STATS) }),
  lineage: (rng, DATA, ctx) => ({ v: chance(rng, 0.3) ? '' : `Lineage-${ctx.n}` }),
  wornArmour: (rng) => ({ v: chance(rng, 0.3) ? '' : pick(rng, ['Leather', 'Chain Mail', 'Plate']) }),
  racialspell: (rng, DATA, ctx) => ({ v: `spell-${ctx.n}` }),
  feat: () => ({ anything: 'the handler is a no-op, garbage payload is safe (js/engine.js:457)' }),
  feature: (rng, DATA, ctx) => ({ v: `feature-${ctx.n}` }),
  art: (rng, DATA) => ({ v: pick(rng, DATA.artList) }),
  boon: (rng, DATA) => ({ v: pick(rng, DATA.boonList) }),
  mvbuy: () => ({}),
  tool: (rng, DATA) => ({ v: pick(rng, DATA.toolList) }),
  instrument: (rng, DATA) => ({ v: pick(rng, DATA.instrumentList) }),
  mastery: (rng, DATA) => ({ v: pick(rng, DATA.masteries) }),
  language: (rng) => ({ to: int(rng, 1, 10) }),
  vigor: (rng) => ({ to: int(rng, 0, 10) }),
  grit: (rng) => ({ to: int(rng, 0, 10) }),
  armour: (rng) => ({ v: pick(rng, ARMOUR_TYPES) }),
  wprof: (rng) => ({ wp: { simple: chance(rng, 0.5), allMartial: chance(rng, 0.5), improvised: chance(rng, 0.5) } }),
  species: (rng, DATA) => ({ v: pick(rng, DATA.species) }),
  oclass: (rng, DATA) => ({ v: pick(rng, DATA.classes) }),
  racial: (rng, DATA) => ({ v: pick(rng, DATA.racialList) }),
  drawback: (rng, DATA, ctx) => {
    const v = pick(rng, DATA.drawbackList);
    ctx.drawbacksBought.push(v);
    return { v };
  },
  attune: (rng) => ({ to: int(rng, 0, 10) }),
  ki: (rng) => ({ to: int(rng, 0, 20) }),
  sorcery: (rng) => ({ to: int(rng, 0, 20) }),
  mbound: (rng, DATA) => ({ v: pick(rng, DATA.classes) }),
  subbundle: (rng, DATA, ctx) => ({ v: `bundle-${ctx.n}` }),
  unlockclass: (rng, DATA) => ({ v: pick(rng, DATA.classes) }),
  freesub: (rng, DATA, ctx) => ({ cls: pick(rng, DATA.classes), sub: `sub-${ctx.n}` }),
  subabil: (rng, DATA, ctx) => ({ v: `subabil-${ctx.n}` }),
  tasharule: (rng) => ({ v: chance(rng, 0.5) }),
  found: (rng, DATA, ctx) => {
    let ti;
    if (ctx.tradCount === 0 || chance(rng, 0.4)) { ti = ctx.tradCount; ctx.tradCount++; ctx.discsByTi[ti] = 0; }
    else { ti = int(rng, 0, ctx.tradCount - 1); }
    const di = ctx.discsByTi[ti] || 0;
    ctx.discsByTi[ti] = di + 1;
    return { ti, trad: `trad-${ti}`, disc: `disc-${ti}-${di}` };
  },
  rank: (rng, DATA, ctx) => ({ ti: tradTi(rng, ctx, true), to: int(rng, 0, 10) }),
  cantrip: (rng, DATA, ctx) => { const ti = tradTi(rng, ctx, true); return { ti, di: discDi(rng, ctx, ti, true), to: int(rng, 0, 10) }; },
  slot: (rng, DATA, ctx) => { const ti = tradTi(rng, ctx, true); return { ti, di: discDi(rng, ctx, ti, true), L: fuzzLevel(rng), to: int(rng, 0, 10) }; },
  known: (rng, DATA, ctx) => { const ti = tradTi(rng, ctx, true); return { ti, di: discDi(rng, ctx, ti, true), L: fuzzLevel(rng), to: int(rng, 0, 10) }; },
  dbound: (rng, DATA, ctx) => { const ti = tradTi(rng, ctx, true); return { ti, di: discDi(rng, ctx, ti, true), v: chance(rng, 0.5) }; },
};
const CATS = Object.keys(CAT_GENERATORS);

function genNamesEvent(rng, ctx) {
  const e = { type: 'names', cost: int(rng, 0, 5) };
  if (chance(rng, 0.3)) e.eb = `epicboon-${ctx.n}`;
  if (chance(rng, 0.3)) e.fs = [`style-${ctx.n}`];
  if (chance(rng, 0.3)) e.mm = [`metamagic-${ctx.n}`];
  if (chance(rng, 0.3)) e.mv = [`maneuver-${ctx.n}`];
  if (chance(rng, 0.3)) e.dab = [[`dabbler-${ctx.n}`]];
  if (chance(rng, 0.3)) e.inn = [[`innate-${ctx.n}`]];
  if (chance(rng, 0.3)) e.feat = { [`feat-${ctx.n}`]: true };
  if (chance(rng, 0.3)) e.lang = [`lang-${ctx.n}`];
  if (chance(rng, 0.3) && ctx.tradCount > 0) {
    const ti = int(rng, 0, ctx.tradCount - 1);
    e.tr = [{ ti, di: discDi(rng, ctx, ti, false), cn: [`cantrip-${ctx.n}`], kn: [`known-${ctx.n}`] }];
  }
  return e;
}

// Weighted top-level event-type draw: mostly `buy` (across every MUT category), with the
// other four LOG event types (award/buyoff/name/names/creationLocked/campaignBound) mixed in
// at realistic-ish proportions — see js/engine.js:434 for the documented event vocabulary.
function genEvent(rng, DATA, ctx) {
  ctx.n++;
  const roll = rng();
  if (roll < 0.78) {
    const cat = pick(rng, CATS);
    const payload = CAT_GENERATORS[cat](rng, DATA, ctx);
    const cost = cat === 'drawback' ? -int(rng, 0, 20) : int(rng, 0, 20);
    const e = { type: 'buy', cat, payload, cost };
    if (chance(rng, 0.1)) e.noLock = true;
    return e;
  }
  if (roll < 0.86) return { type: 'award', amount: int(rng, 0, 50) };
  if (roll < 0.90) {
    const refVal = ctx.drawbacksBought.length && chance(rng, 0.7)
      ? pick(rng, ctx.drawbacksBought) : `unknown-drawback-${ctx.n}`;
    return { type: 'buyoff', refVal, cost: int(rng, 0, 30) };
  }
  if (roll < 0.93) return { type: 'name', name: `Char-${ctx.n}` };
  if (roll < 0.96) return genNamesEvent(rng, ctx);
  if (roll < 0.98) return { type: 'creationLocked' };
  return { type: 'campaignBound', campaignId: `camp-${ctx.n}` };
}

function genLog(rng, DATA, maxEvents) {
  const ctx = makeCtx();
  const n = int(rng, 1, maxEvents);
  const events = [];
  for (let i = 0; i < n; i++) events.push(genEvent(rng, DATA, ctx));
  return events;
}

// ---------- oracle ----------
// Recursively hunts for a NaN (or the literal string "NaN", in case something stringified a
// NaN before storing it) anywhere in a compute()/foldBuild() result — the class of bug a wild
// fuzzer is best positioned to catch: unguarded arithmetic on a garbage `payload.to`/`payload.L`
// silently producing a NaN that a real UI, constrained to legal dropdown values, would never
// trigger.
function findNaN(obj, pathStr = '$', seen = new Set()) {
  if (typeof obj === 'number' && Number.isNaN(obj)) return pathStr;
  if (obj === 'NaN') return pathStr;
  if (obj == null || typeof obj !== 'object') return null;
  if (seen.has(obj)) return null;
  seen.add(obj);
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const r = findNaN(obj[i], `${pathStr}[${i}]`, seen);
      if (r) return r;
    }
    return null;
  }
  for (const k of Object.keys(obj)) {
    const r = findNaN(obj[k], `${pathStr}.${k}`, seen);
    if (r) return r;
  }
  return null;
}

// Runs every check against one LOG; returns [{tag, note}] (empty = clean). Each tag is a
// stable string so shrink() can target "the same failure", not just "any failure", while
// removing events from a candidate LOG.
function runChecks(ENGINE, LOG) {
  const failures = [];

  let build, result;
  try {
    build = ENGINE.foldBuild(LOG);
    result = ENGINE.compute(deepClone(build));
  } catch (e) {
    failures.push({ tag: 'throw', note: `foldBuild()/compute() threw: ${e && e.stack ? e.stack.split('\n')[0] : e}` });
    return failures; // nothing else is meaningful to check once this has thrown
  }

  // NaN-hunt every object this function produces, not just `build`/`result` — `deepEqualJSON`
  // is a JSON.stringify comparison, and JSON.stringify serializes NaN (and undefined-valued
  // keys) the same as `null`, so a purity check below comparing e.g. `{x:NaN}` against
  // `{x:null}` (or two DIFFERENT NaN-producing paths) would see them as "equal" and miss a real
  // divergence. Independently NaN-scanning each object closes that gap without needing a
  // NaN-aware deep-equal.
  const nanScan = (label, obj) => { const p = findNaN(obj); if (p) failures.push({ tag: 'nan', note: `NaN found at ${label}${p.slice(1)}` }); };
  nanScan('$.result', result);
  nanScan('$.build', build);

  // fold purity: foldBuild always starts from a fresh baseBuild(), so replaying the same LOG
  // twice must be byte-identical — a MUT handler leaking state across calls would violate this.
  const build2 = ENGINE.foldBuild(LOG);
  nanScan('$.build2', build2);
  if (!deepEqualJSON(build, build2)) failures.push({ tag: 'foldPurity', note: 'foldBuild(LOG) is not deterministic (two calls on the same LOG differed)' });

  // compute purity (Phase 1 pattern, ported): same input twice -> same output; input untouched.
  const r1 = ENGINE.compute(deepClone(build));
  const r2 = ENGINE.compute(deepClone(build));
  nanScan('$.r1', r1);
  nanScan('$.r2', r2);
  if (!deepEqualJSON(r1, r2)) failures.push({ tag: 'computePurity', note: 'compute() is not deterministic on the same input' });
  const probe = deepClone(build);
  const before = deepClone(probe);
  try {
    const r3 = ENGINE.compute(probe);
    nanScan('$.r3', r3);
    if (!deepEqualJSON(before, probe)) failures.push({ tag: 'computeMutates', note: 'compute() mutated its input build object' });
  } catch (e) {
    // Not swallowed: r1/r2 above already called compute() successfully on an equivalent clone,
    // so a throw here means compute() is non-deterministic (throws on some calls, not others) —
    // a real, distinct finding, not something the earlier top-of-function throw check could see.
    failures.push({ tag: 'throw', note: `compute() threw non-deterministically (succeeded twice above, then threw on a 3rd equivalent call): ${e && e.message}` });
  }

  // dual entry point agreement: rebuildStateFromEvents(null, LOG) replays from the same blank
  // baseBuild() as foldBuild(). Compared on `.result` (compute()'s priced output — the only
  // thing any UI/DM-Console surface actually reads) rather than `.build`: `seedBuild()`
  // unconditionally normalizes a few keys (e.g. `houseRules` to `{}`) that `baseBuild()` leaves
  // absent until a MUT handler lazily creates them, so the two entry points' raw internal build
  // shape has a known, harmless, always-present cosmetic delta on an empty/near-empty LOG that
  // would otherwise drown every real finding in noise. `.result` was verified to agree exactly
  // even when `.build` doesn't (confirmed by hand against a `LOG=[]` run before shipping this).
  try {
    const alt = ENGINE.rebuildStateFromEvents(null, LOG);
    if (!deepEqualJSON(alt.result, result)) failures.push({ tag: 'dualEntry', note: 'rebuildStateFromEvents(null, LOG).result disagrees with compute(foldBuild(LOG))' });
  } catch (e) {
    failures.push({ tag: 'throw', note: `rebuildStateFromEvents(null, LOG) threw where foldBuild()/compute() did not: ${e && e.message}` });
  }

  return failures;
}

// ---------- shrink ----------
// Lightweight delta-debug: repeatedly drop one event at a time (scanning back-to-front so
// index shifts from an earlier removal don't skip an element) as long as the SAME tagged
// failure still reproduces. Not maximally minimal (a real ddmin also tries larger chunks) but
// simple, and more than good enough to turn a 40-event LOG into the handful of events that
// actually matter for a human reading the failure.
function shrink(ENGINE, LOG, tag, maxAttempts = 2000) {
  let cur = LOG.slice();
  let attempts = 0;
  let changed = true;
  while (changed && attempts < maxAttempts) {
    changed = false;
    for (let i = cur.length - 1; i >= 0 && attempts < maxAttempts; i--) {
      const candidate = cur.slice(0, i).concat(cur.slice(i + 1));
      attempts++;
      const stillFails = runChecks(ENGINE, candidate).some(f => f.tag === tag);
      if (stillFails) { cur = candidate; changed = true; break; }
    }
  }
  return cur;
}

// ---------- main ----------
async function main() {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const REPO_ROOT = path.resolve(HERE, '..', '..');
  const ENGINE = await import(pathToFileURL(path.join(REPO_ROOT, 'js', 'engine.js')).href);

  log(`engine ${ENGINE.DATA?.version ?? 'unknown'} — ${ITERATIONS} iterations, up to ${MAX_EVENTS} events/LOG, seed=${SEED}`);

  const rng = mulberry32(SEED);
  const failedRuns = [];

  for (let i = 0; i < ITERATIONS; i++) {
    const LOG = genLog(rng, ENGINE.DATA, MAX_EVENTS);
    const failures = runChecks(ENGINE, LOG);
    if (failures.length === 0) continue;

    // One shrink per distinct tag seen this iteration, so e.g. a 'throw' and an unrelated
    // 'nan' in the same random LOG each get their own minimal repro instead of one shrink
    // accidentally optimizing for whichever tag happens to be checked first.
    const seenTags = [...new Set(failures.map(f => f.tag))];
    for (const tag of seenTags) {
      const minimal = shrink(ENGINE, LOG, tag);
      const minimalFailures = runChecks(ENGINE, minimal).filter(f => f.tag === tag);
      failedRuns.push({ iteration: i, tag, notes: minimalFailures.map(f => f.note), log: minimal });
    }
  }

  if (failedRuns.length === 0) {
    log(`${ITERATIONS}/${ITERATIONS} iterations clean — no throws, no NaN, no self-disagreement`);
    process.exit(0);
  }

  console.log(`\n✗ ${failedRuns.length} failure(s) found across ${ITERATIONS} iterations (seed=${SEED}):\n`);
  for (const f of failedRuns) {
    console.log(`--- iteration ${f.iteration}, tag=${f.tag} ---`);
    f.notes.forEach(n => console.log(`  ${n}`));
    console.log(`  minimal repro LOG (${f.log.length} event(s)):`);
    console.log(JSON.stringify(f.log, null, 2).split('\n').map(l => `    ${l}`).join('\n'));
  }
  process.exit(1);
}

main().catch(e => { console.error('Run failed:', e); process.exit(1); });
