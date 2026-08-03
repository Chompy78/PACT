// PACT — creation-lock backfill DRY RUN (read-only, never writes anything anywhere).
//
// Plan: docs/plans/2026-08-02-creation-lock-switch.md, step 7 + Verification.
//
// The backfill appends a `campaignBound` event to the END of each already-campaign-bound
// character's LOG, so the automatic creation lock applies to them going forward. The claim this
// script exists to prove is that doing so changes NOTHING about their current state — every
// existing purchase keeps its frozen price, because the engine stamps each racial-trait purchase
// with the lock state as of just before that purchase, and an event appended after them all
// cannot retroactively alter those stamps.
//
// Cold review (2026-08-02) correctly rejected an earlier, weaker version of this check that
// compared only AP totals: equal totals cannot distinguish "nothing changed" from "two things
// changed and cancelled out". This version diffs the FULL folded build (including the per-trait
// `_raceTraitLocked` map) AND the FULL compute() output, key by key.
//
// It also proves the backfill is not merely harmless but actually EFFECTIVE, by simulating one
// further racial-trait purchase after the appended marker and asserting it prices at the locked
// rate. A backfill that changed nothing AND did nothing would pass a safety check while being
// pointless.
//
// Usage:  node testing/scripts/creation-lock-backfill-dryrun.mjs <characters.json>
// where <characters.json> is [{ id, name, campaign_id, stats: { LOG, SEQ, rules } }, ...]
// exported read-only from the database. This script never connects to anything.

import { readFile } from 'node:fs/promises';
import { compute, foldBuild, DATA, creationLockThreshold } from '../../js/engine.js';

const TRAIT_PROBE = 'Halfling: Naturally Stealthy';   // own-species, non-pack, banded => reprices on lock

// Optional 2nd arg: a JSON file of {campaignId: rulesObject}. When supplied, the backfill also
// stamps each character's TUNED campaign creation-lock threshold (that campaign's own budget curve
// — see creationLockThreshold()), instead of letting the engine fall back to DATA.level1AP. Since
// fix/ap-budget-curve-standard that fallback is the Standard budget curve's L1 (79), so it is the
// right kind of number either way; supplying rules only matters for a campaign on Generous (83) or
// a custom curve.
const rulesFile = process.argv[3];

function deepDiff(a, b, path = '', out = []) {
  if (a === b) return out;
  const ta = a === null ? 'null' : typeof a, tb = b === null ? 'null' : typeof b;
  if (ta !== tb) { out.push(`${path}: type ${ta} -> ${tb}`); return out; }
  if (ta !== 'object') { if (a !== b) out.push(`${path}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`); return out; }
  if (Array.isArray(a) !== Array.isArray(b)) { out.push(`${path}: array-ness changed`); return out; }
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) deepDiff(a?.[k], b?.[k], path ? `${path}.${k}` : k, out);
  return out;
}

const file = process.argv[2];
if (!file) { console.error('usage: node creation-lock-backfill-dryrun.mjs <characters.json>'); process.exit(2); }

const chars = JSON.parse(await readFile(file, 'utf8'));
const campRules = rulesFile ? JSON.parse(await readFile(rulesFile, 'utf8')) : null;
let failures = 0;

console.log(`creation-lock backfill DRY RUN — ${chars.length} character(s), read-only\n`);
console.log(`engine default threshold (DATA.level1AP) = ${DATA.level1AP}\n`);

for (const c of chars) {
  const log = (c.stats && Array.isArray(c.stats.LOG)) ? c.stats.LOG : null;
  const label = `${c.name || '(unnamed)'} [${c.id}]`;
  if (!log) { console.log(`SKIP  ${label} — no stats.LOG (nothing to back-fill)\n`); continue; }

  const seqMax = log.reduce((m, e) => Math.max(m, e?.seq || 0), 0);
  const marker = { type: 'campaignBound', campaignId: c.campaign_id, seq: seqMax + 1, ts: Date.now(),
                   label: 'Campaign — backfilled membership marker' };
  const after = [...log, marker];
  // Stamp the campaign's threshold alongside the membership marker, so the lock fires against the
  // BUDGET curve rather than the engine's pace-curve fallback.
  let thr = null;
  if (campRules) {
    thr = creationLockThreshold(campRules[c.campaign_id]);
    after.push({ type: 'creationLockConfig', payload: { threshold: thr }, seq: seqMax + 2,
                 ts: Date.now(), label: `Campaign creation-lock threshold (${thr} AP)` });
  }

  const bBefore = foldBuild(log),  rBefore = compute(bBefore);
  const bAfter  = foldBuild(after), rAfter = compute(bAfter);

  const buildDiff   = deepDiff(bBefore, bAfter, 'build');
  const computeDiff = deepDiff(rBefore, rAfter, 'compute');
  const spent = log.filter(e => e?.type === 'buy').reduce((s, e) => s + (e.cost || 0), 0);

  console.log(`${label}`);
  console.log(`  events: ${log.length}  ·  logged spend: ${spent}  ·  tier: ${rBefore.tier}  ·  total: ${rBefore.total}`);
  console.log(`  per-trait lock map: ${JSON.stringify(bBefore._raceTraitLocked || null)}`);

  if (buildDiff.length === 0 && computeDiff.length === 0) {
    console.log('  SAFE   full build + full compute() output are byte-identical after the backfill');
  } else {
    failures++;
    console.log('  UNSAFE differences found — DO NOT RUN THE REAL BACKFILL:');
    [...buildDiff, ...computeDiff].slice(0, 25).forEach(d => console.log(`    - ${d}`));
  }

  // Effectiveness: would a NEW own-species trait purchase after the marker price as locked?
  const probe = { type: 'buy', cat: 'racial', payload: { v: TRAIT_PROBE }, cost: 0,
                  seq: seqMax + 3, ts: Date.now(), label: 'probe' };
  const bProbe = foldBuild([...after, probe]);
  const lockedNow = !!(bProbe._raceTraitLocked || {})[TRAIT_PROBE];
  const effThr = thr != null ? thr : DATA.level1AP;
  const overThreshold = spent > effThr;
  console.log(`  effect: a future "${TRAIT_PROBE}" would price ${lockedNow ? 'LOCKED (expensive)' : 'unlocked (cheap)'}`
            + ` — spend ${spent} ${overThreshold ? '>' : '<='} threshold ${effThr}`
            + (thr != null ? ' (campaign budget curve)' : ' (engine fallback — no campaign rules supplied)'));
  if (!lockedNow && overThreshold) { failures++; console.log('  WARNING: over threshold but not locking — backfill would be ineffective'); }
  console.log('');
}

console.log(failures === 0
  ? 'RESULT: dry run clean — backfill is safe (no state change) and effective where spend warrants it.'
  : `RESULT: ${failures} problem(s) — do NOT run the real backfill.`);
process.exit(failures === 0 ? 0 : 1);
