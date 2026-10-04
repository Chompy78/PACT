#!/usr/bin/env node
/**
 * imposed-drawback-grants-ci.mjs — the gate for "a DM-imposed drawback grants no AP in compute()"
 * (fix/imposed-drawbacks-grant-no-ap, D-GH-2026-10-04-imposed-drawbacks-grant-no-ap).
 *
 * WHAT WAS WRONG. A DM can impose a drawback on a campaign character. It is recorded at cost 0, so the player is
 * paid nothing and economy().drawbackEarned says 0. But compute() derived the drawback grant from the drawback
 * NAMES in the build, which cannot tell imposed from chosen, so it credited the table value anyway. Four imposed
 * wounds read 93 AP remaining against a true 79 and fired "Drawbacks grant 14 AP — the guide caps them at 12" and
 * "4 drawbacks chosen". Three screens were affected: the DM Console's "Granted by drawbacks" row, the warnings a
 * PLAYER sees, and the creation ceiling (Live Sheet feeds it compute().drawbackAp).
 *
 * WHAT THIS PINS. The parity fixtures EV-025/EV-026 pin the warning lists; parity records only total/warnings, so
 * `remaining`, the ledger rows and the ceiling are asserted here, against the frozen ledger (economy()) — the
 * number the Live Sheet already shows — so compute() and the ledger can never disagree about an imposed drawback.
 * Every imposed case has a PLAYER-TAKEN control built from the same drawbacks: without it an empty warning list
 * could mean "the warnings are broken for everyone" rather than "imposed drawbacks are exempt".
 *
 * Run:  node testing/scripts/imposed-drawback-grants-ci.mjs     (expect 0 failed; exits non-zero otherwise)
 * Uses only Node built-ins — no npm, no browser, no network.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { compute, foldBuild, economy, creationCeiling } = await import(pathToFileURL(resolve(REPO, 'js/engine.js')).href);

let pass = 0, fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};

// ---- event builders --------------------------------------------------------------------------------------
const award = { type: 'award', amount: 79, seq: 1, label: 'Award — Level 1 (79 AP)' };
const oclass = { type: 'buy', cat: 'oclass', payload: { v: 'Fighter' }, cost: 0, level: 1, seq: 2, label: 'Fighter' };
const imposed = (seq, v) => ({ type: 'buy', cat: 'drawback', payload: { v }, cost: 0, level: 1, seq,
  dmEdit: true, dmId: 'dm', dmLocked: true, dmRemovalCost: 'flat', label: `${v} (DM imposed)` });
const taken = (seq, v, ap) => ({ type: 'buy', cat: 'drawback', payload: { v }, cost: -ap, level: 1, seq, label: `${v} (+${ap} AP)` });
// Peg Leg 4 + Lame 3 + Old Wound 3 + One-Eyed 4 = 14 table AP. Chosen so no stat cap fires at the default stats.
const FOUR = [['Peg Leg', 4], ['Lame', 3], ['Old Wound', 3], ['One-Eyed', 4]];
const allImposed = [award, oclass, ...FOUR.map(([v], i) => imposed(3 + i, v))];
const allTaken = [award, oclass, ...FOUR.map(([v, ap], i) => taken(3 + i, v, ap))];

const run = (evs, opts) => { const r = compute(foldBuild(evs), opts); return { r, eco: economy(evs) }; };
const grantWarn = (w) => w.filter(x => /^Drawbacks grant/.test(x));
const chosenWarn = (w) => w.filter(x => /drawbacks chosen/.test(x));

console.log('four DM-imposed drawbacks — the player was paid nothing');
{
  const { r, eco } = run(allImposed);
  t('compute().remaining equals the frozen ledger (79) — not 93', r.remaining, eco.available);
  t('...and is 79', r.remaining, 79);
  t('compute().drawbackAp is 0', r.drawbackAp, 0);
  t('no "Drawbacks grant N AP" warning', grantWarn(r.warnings), []);
  t('no "N drawbacks chosen" warning', chosenWarn(r.warnings), []);
  const rows = (r.itemize && r.itemize['Drawbacks (refund)']) || [];
  t('the four are still LISTED so a DM can see them, each at 0 and labelled',
    rows.map(x => x.join('|')), FOUR.map(([v]) => `${v} (DM imposed)|0`));
  t('the ledger line itself is 0', (r.lines.find(l => l[0] === 'Drawbacks (refund)') || [null, null])[1], 0);
}

console.log('control — the same four PLAYER-TAKEN still pay and still warn');
{
  const { r, eco } = run(allTaken);
  t('compute().remaining equals the frozen ledger (93)', r.remaining, eco.available);
  t('...and is 79 + 14 = 93', r.remaining, 93);
  t('compute().drawbackAp is 14', r.drawbackAp, 14);
  t('the "Drawbacks grant 14 AP" warning still fires', grantWarn(r.warnings).length, 1);
  t('the "4 drawbacks chosen" warning still fires', chosenWarn(r.warnings).length, 1);
  const rows = (r.itemize && r.itemize['Drawbacks (refund)']) || [];
  t('rows are the plain names at their negative AP', rows.map(x => x.join('|')), FOUR.map(([v, ap]) => `${v}|${-ap}`));
}

console.log('mixed — two chosen, two imposed: only the chosen ones count');
{
  const evs = [award, oclass, taken(3, 'Peg Leg', 4), taken(4, 'Lame', 3), imposed(5, 'Old Wound'), imposed(6, 'One-Eyed')];
  const { r, eco } = run(evs);
  t('drawbackAp is the two chosen (4 + 3 = 7)', r.drawbackAp, 7);
  t('remaining equals the ledger (86)', r.remaining, eco.available);
  t('no cap warning (7 is under 12)', grantWarn(r.warnings), []);
  const five = [award, oclass, taken(3, 'Peg Leg', 4), taken(4, 'Lame', 3), taken(5, 'Old Wound', 3), taken(6, 'One-Eyed', 4),
                imposed(7, 'Frail')];
  const w = chosenWarn(run(five).r.warnings);
  t('"N chosen" counts the four the player took, not the imposed fifth ("4 drawbacks chosen", not 5)',
    w.length === 1 && /^4 drawbacks chosen/.test(w[0]), true);
}

console.log('campaign cap — imposed drawbacks neither consume nor trip it');
{
  t('four imposed under a 12 AP campaign cap: no cap warning and no grant',
    [grantWarn(run(allImposed, { drawbackCap: 12 }).r.warnings), run(allImposed, { drawbackCap: 12 }).r.drawbackAp], [[], 0]);
  const c = run(allTaken, { drawbackCap: 12 });
  t('control: four player-taken under the same cap are clipped to 12 and warn', [c.r.drawbackAp, grantWarn(c.r.warnings).length], [12, 1]);
}

console.log('creation ceiling — an imposed drawback must not raise it (Live Sheet feeds it compute().drawbackAp)');
{
  const lockCfg = { type: 'creationLockConfig', auto: true, threshold: 50, confirmed: true, seq: 99 };
  const imp = [...allImposed, lockCfg], tak = [...allTaken, lockCfg];
  const ci = creationCeiling(imp, { drawbackAp: compute(foldBuild(imp)).drawbackAp });
  const ct = creationCeiling(tak, { drawbackAp: compute(foldBuild(tak)).drawbackAp });
  t('imposed: drawbackBonus is 0, so the ceiling equals its base', [ci.drawbackBonus, ci.ceiling === ci.base], [0, true]);
  t('control: player-taken: drawbackBonus is 14, so the ceiling is raised by it', [ct.drawbackBonus, ct.ceiling === ct.base + 14], [14, true]);
}

console.log('unrelated rules are untouched by imposition');
{
  const pair = [award, oclass, imposed(3, 'Frail'), imposed(4, 'Glass Frame')];
  t('Frail + Glass Frame still warns that the two HP penalties do not stack — about HP, not AP',
    run(pair).r.warnings.some(x => /Frail and Glass Frame can't be taken together/.test(x)), true);
}

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} passed / ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
