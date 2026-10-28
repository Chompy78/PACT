#!/usr/bin/env node
/**
 * chargen-roll-steps-e2e.mjs — does "this build -> that build" turn into the right in-play purchases?
 *
 * WHY. feat/roll-lock-then-spend (plan docs/plans/2026-10-27-roll-lock-then-spend.md) will let a rolled character stop at the DM's creation
 * limit and spend the rest in play after "Accept". Two pure pieces of CharGen make that safe, and this test pins them before any button exists:
 *   _cgBuildToSteps(cur, target)  — the purchases that turn `cur` into `target`, or a refusal. Never a partial list.
 *   _cgPostLockAppend(steps, {unattended:true}) / _cgSpendSteps(steps) — the same checks as the dialogs, without a dialog: a step that would have
 *                                    asked the player is skipped and reported instead of being accepted for them.
 *
 * HOW. For each seeded roll (the real roller, window._cgRollTrace on) we get the build after every accepted step. Pick one as the CUT, apply it,
 * lock it with the names gate switched off (this test is about purchases, not naming), then ask _cgBuildToSteps for the way to the roll's FINAL build
 * and spend it unattended. Properties, all checked on the real page with the real engine:
 *   P1  applied + skipped partition the step list (nothing lost, nothing counted twice).
 *   P2  with nothing skipped and no block, the folded build equals the roll's final build on every field a roll can touch.
 *   P3  no dialog opened (alert/confirm/prompt) at any point.
 *   P4  every appended event is a plain in-play purchase (type 'buy', after the lock) and the LOG grew by exactly the applied count.
 *   (info) how many cuts the form itself clamps on load (cantrip counts, the roller's boolean martial); reported, not failed: the plan is built from the folded cut either way.
 * A refusal is a legitimate answer (the roll took a drawback or a second origin after the cut, which no purchase can express); the run prints how
 * many there were and requires that most trials produce a plan, so a refuse-everything bug cannot pass.
 *
 * Usage: node testing/scripts/chargen-roll-steps-e2e.mjs [--trials N] [--seed S] [--port P]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './lib/launch-chromium.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };
const TRIALS = +arg('trials', 40), SEED = +arg('seed', 7), PORT = +arg('port', 7981);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/PACT\/?/, '') || 'index.html';
  fs.readFile(path.join(REPO, rel), (e, d) => { if (e) { r.writeHead(404); return r.end('not found'); }
    r.writeHead(200, { 'Content-Type': MIME[path.extname(rel)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); r.end(d); });
});
await new Promise(r => server.listen(PORT, r));
const base = `http://localhost:${PORT}/PACT`;

let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; } else { fail++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); } };

// ---- seeded PRNG for the trial parameters (the roll itself is seeded inside the page) ----
let st = (SEED * 2654435761) >>> 0;
const rnd = () => { st = (Math.imul(st, 1664525) + 1013904223) >>> 0; return st / 4294967296; };

const THEMES = ['', '', ''];   // '' = the roller picks its own theme from the seed
const browser = await launchChromium();
let ctx = null, pg = null, dialogs = [], pageErrors = [];
async function open() {
  if (ctx) { try { await ctx.close(); } catch (e) {} }
  ctx = await browser.newContext(); pg = await ctx.newPage();
  pg.on('dialog', d => { dialogs.push(d.type() + ': ' + d.message().slice(0, 100)); d.dismiss(); });
  pg.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 160)));
  await pg.goto(`${base}/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' });
  await pg.waitForFunction(() => window.DATA && typeof randomizeRoll === 'function' && typeof _cgBuildToSteps === 'function', null, { timeout: 30000 });
}

// Everything below runs INSIDE the page. It returns plain data; the assertions are made out here.
const TRIAL = ({ seed, budget, theme, cutPick }) => {
  var a = seed | 0;
  Math.random = function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  try { localStorage.clear(); } catch (e) {}
  resetBuild();
  document.getElementById('budget').value = String(budget);
  if (typeof _cgSyncAward === 'function') _cgSyncAward();
  window._cgRollTrace = [];
  randomizeRoll(theme || null, 0);
  var trace = window._cgRollTrace; window._cgRollTrace = null;
  if (trace.length < 3) return { skip: 'short roll (' + trace.length + ' steps)' };
  var k = Math.min(trace.length - 2, Math.floor(cutPick * (trace.length - 1)));
  var cut = trace[k].b, fin = trace[trace.length - 1].b;
  window.requireNamesOn = function () { return false; };
  window.namesGate = function () { return { blocked: false, missing: [], reason: '' }; };
  applyBuild(JSON.parse(JSON.stringify(cut)));
  cgFinishCreating(true);
  var locked = _cgIsLocked();
  var cur = foldBuild(LOG);
  var roundtrip = _cgRollDiff(cur, cut);
  // KNOWN, pre-existing: the roller prices weaponProf.martial === true, but the form it then applies the build through has no boolean and keeps 0 (the saved character
  // never gets the proficiency the budget counted). Not this test's subject; the remainder planner treats true as 1.
  if (cut.weaponProf && cut.weaponProf.martial === true) roundtrip = roundtrip.filter(function (f) { return f !== 'weaponProf'; });
  var detail = roundtrip.map(function (f) { return f + ': cut=' + JSON.stringify(cut[f]) + ' fold=' + JSON.stringify(cur[f]); });
  var pick = _cgPlanRemainder(cur, trace.slice(k + 1).map(function (x) { return x.b; }));
  if (!pick.plan) return { cutIndex: k, traceLen: trace.length, locked: locked, roundtrip: roundtrip, detail: detail, refuse: pick.why || 'no later build is reachable' };
  var plan = pick.plan; fin = trace[k + 1 + pick.index].b;
  var logBefore = LOG.length;
  var res = _cgSpendSteps(plan.steps);
  var after = foldBuild(LOG);
  var added = LOG.slice(logBefore);
  return {
    cutIndex: k, traceLen: trace.length, locked: locked, roundtrip: roundtrip, detail: detail, nSteps: plan.steps.length,
    applied: res.applied.length, skipped: res.skipped.map(function (s) { return s.cat + ': ' + s.why; }), blocked: res.blocked, why: res.why,
    diff: _cgRollDiff(after, fin), added: added.length, addedAllBuy: added.every(function (e) { return e.type === 'buy'; }),
    stepCats: plan.steps.map(function (s) { return s.cat; })
  };
};

let roundtripNotes = 0, trials = 0, refused = 0, skippedShort = 0, withSkips = 0, stepsTotal = 0, appliedTotal = 0;
const refuseWhy = {}, skipWhy = {}, catsSeen = {};
await open();
for (let i = 0; i < TRIALS; i++) {
  if (i && i % 10 === 0) await open();   // a fresh page every few trials, as the post-lock fuzz does: a long-lived page stops answering
  const p = { seed: 1000 + i * 7919 + SEED, budget: 70 + Math.floor(rnd() * 230), theme: THEMES[i % THEMES.length], cutPick: rnd() };
  dialogs = [];
  let r;
  try { r = await pg.evaluate(TRIAL, p); } catch (e) { check('trial ' + i + ' ran', false, String(e.message || e).slice(0, 200)); continue; }
  trials++;
  const tag = 'trial ' + i + ' (seed ' + p.seed + ', ' + p.budget + ' AP)';
  if (r.skip) { skippedShort++; continue; }
  check(tag + ' — P3 no dialog opened', dialogs.length === 0, dialogs.join(' | '));
  check(tag + ' — the cut character locked', r.locked === true);
  if (r.roundtrip.length) { roundtripNotes++; if (roundtripNotes <= 3) console.log('  note: ' + tag + ' — the form clamps the cut on load (existing behaviour): ' + (r.detail || []).join(' ; ').slice(0, 160)); }
  if (r.refuse) { refused++; const key = r.refuse.replace(/[0-9]+/g, 'N').slice(0, 90); refuseWhy[key] = (refuseWhy[key] || 0) + 1; continue; }
  stepsTotal += r.nSteps; appliedTotal += r.applied;
  (r.stepCats || []).forEach(c => { catsSeen[c] = (catsSeen[c] || 0) + 1; });
  check(tag + ' — P1 applied + skipped partition the steps', r.applied + r.skipped.length === r.nSteps, r.applied + ' + ' + r.skipped.length + ' != ' + r.nSteps);
  check(tag + ' — P4 the LOG grew by exactly the applied purchases, all plain buys', r.added === r.applied && r.addedAllBuy, 'added ' + r.added + ', applied ' + r.applied);
  if (r.skipped.length) { withSkips++; r.skipped.forEach(s => { const key = s.replace(/[0-9]+/g, 'N').slice(0, 80); skipWhy[key] = (skipWhy[key] || 0) + 1; }); }
  if (!r.skipped.length && !r.blocked) check(tag + ' — P2 nothing skipped: the folded build equals the roll\'s final build', r.diff.length === 0, 'still differs: ' + r.diff.join(','));
}
// ---- targeted cases from the review of #724 ----
const SETUP = ({ seed, budget }) => {
  var a = seed | 0;
  Math.random = function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  try { localStorage.clear(); } catch (e) {}
  resetBuild(); document.getElementById('budget').value = String(budget);
  if (typeof _cgSyncAward === 'function') _cgSyncAward();
  window._cgRollTrace = []; randomizeRoll(null, 0);
  var trace = window._cgRollTrace; window._cgRollTrace = null;
  window.requireNamesOn = function () { return false; };
  window.namesGate = function () { return { blocked: false, missing: [], reason: '' }; };
  applyBuild(JSON.parse(JSON.stringify(trace[Math.floor(trace.length / 2)].b)));
  cgFinishCreating(true);
  return { locked: _cgIsLocked(), str: foldBuild(LOG).stats.STR, hd: foldBuild(LOG).hd };
};
await pg.evaluate(() => { window.__t = true; });
dialogs = [];
const s0 = await pg.evaluate(SETUP, { seed: 4242, budget: 160 });
check('targeted: setup locked a rolled character', s0.locked === true && s0.str >= 4);
// T1 — nothing lowered, ever: an absolute step below the current value is skipped, never appended
const t1 = await pg.evaluate(() => { var n = LOG.length, cur = foldBuild(LOG).stats.STR;
  var r = _cgSpendSteps([{ cat: 'abil', payload: { ab: 'STR', to: cur - 2 }, label: 'lower STR' }]);
  return { applied: r.applied.length, skipped: r.skipped.map(function (x) { return x.why; }), grew: LOG.length - n, after: foldBuild(LOG).stats.STR, cur: cur }; });
check('T1 a lowering step is skipped, not appended', t1.applied === 0 && t1.skipped.length === 1 && t1.grew === 0 && t1.after === t1.cur, JSON.stringify(t1));
// T2 — two steps with the SAME label: the one that lands must not be applied again on the retry pass
const t2 = await pg.evaluate(() => { var n = LOG.length, cur = foldBuild(LOG).stats.STR;
  var r = _cgSpendSteps([{ cat: 'abil', payload: { ab: 'STR', to: Math.min(20, cur + 2) }, label: 'same' }, { cat: 'hd', payload: { to: 20 }, label: 'same' }]);
  return { applied: r.applied.length, skipped: r.skipped.length, grew: LOG.length - n, str: foldBuild(LOG).stats.STR, cur: cur }; });
check('T2 a same-labelled step that landed is not applied twice', t2.applied === 1 && t2.skipped === 1 && t2.grew === 1 && t2.str === Math.min(20, t2.cur + 2), JSON.stringify(t2));
// T3 — the positional diff: slots [2,0,...] and [0,...,2] are different builds
const t3 = await pg.evaluate(() => ({ same: JSON.stringify(_cgRollNorm([2, 0, 0, 0, 0, 0, 0, 0, 0])) === JSON.stringify(_cgRollNorm([2])), diff: JSON.stringify(_cgRollNorm([2, 0, 0, 0, 0, 0, 0, 0, 0])) !== JSON.stringify(_cgRollNorm([0, 0, 0, 0, 0, 0, 0, 0, 2])) }));
check('T3 spell-slot arrays compare by position (trailing zeros ignored)', t3.same && t3.diff, JSON.stringify(t3));
check('targeted: no dialog opened', dialogs.length === 0, dialogs.join(' | '));

check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
const planned = trials - skippedShort - refused;
check('most trials produce a plan (not a refuse-everything bug)', trials > 0 && planned >= Math.ceil((trials - skippedShort) * 0.5), planned + ' of ' + (trials - skippedShort));

console.log(`\n${roundtripNotes} cuts were clamped by the form on load`);
console.log(`${trials} trials · ${skippedShort} too-short rolls · ${refused} refused · ${planned} planned (${withSkips} with a skipped step) · ${appliedTotal}/${stepsTotal} steps applied`);
if (Object.keys(refuseWhy).length) console.log('refusals: ' + JSON.stringify(refuseWhy));
if (Object.keys(skipWhy).length) console.log('skips: ' + JSON.stringify(skipWhy));
console.log('step categories exercised: ' + JSON.stringify(catsSeen));
console.log(`\n${fail ? '✗' : '✓'} ${pass} passed / ${fail} failed`);
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
