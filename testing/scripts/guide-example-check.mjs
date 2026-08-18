#!/usr/bin/env node
/**
 * PACT — worked-example arithmetic gate.
 *
 * WHY THIS EXISTS. On 2026-08-18 the class-unlock price moved 7 -> 8 and three worked examples silently
 * stopped adding up: each had an unlock in its last purchase row, so the row's AP, the running total,
 * the stated budget and the "Total x / y" row all needed to move by 1. Every existing gate passed.
 * guide-price-check verifies feature PRICES against the engine; nothing verified that the examples'
 * own sums are internally consistent. AGENTS.md had already recorded worked-example line items as
 * unverified — this is what that gap costs when a price actually changes.
 *
 * WHAT IT CHECKS. Every table whose header row reads Purchase | AP | Running:
 *   1. running-total accumulation — each row's Running equals the previous Running plus this row's AP;
 *   2. the closing "Total x / y" row — x equals the final Running;
 *   3. the budget — y equals the AP figure in the example's own heading ("… · Level 6 · 218 AP · …");
 *   4. component sums — where a row spells its parts out, "unlock Fighter (8) + Action Surge (4) +
 *      Second Wind (3)", those figures add up to the row's AP. This is the one that would have caught
 *      all three breaks directly, at the row rather than three columns downstream.
 *
 * It deliberately does NOT re-price rows through compute(): the labels are prose written for players,
 * and a parser that guessed at them would produce false findings on wording changes. Prices are already
 * the job of guide-price-check; this covers the arithmetic that sits on top of them.
 *
 * USAGE:  node testing/scripts/guide-example-check.mjs [guide.html]
 * Exit 0 = no findings.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const FILE = process.argv[2] ||
  path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../docs/PACT-Players-Guide.html');
const html = readFileSync(FILE, 'utf8');
const strip = s => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#x27;/g, "'")
  // The guide sets negative AP with a real minus sign (U+2212), not a hyphen. An early draft of this
  // checker matched only /^-?\d+$/, so every drawback-refund row was skipped, the running total lost
  // track, and it reported nine arithmetic errors that were entirely its own.
  .replace(/[\u2212\u2013\u2014]/g, '-')
  .replace(/\s+/g, ' ').trim();

const findings = [];
const note = (ex, kind, detail) => findings.push({ ex, kind, detail });

// Split each table into rows of cells.
const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/g)];
let examined = 0, rowsChecked = 0, componentRows = 0;

for (const t of tables) {
  const rows = [...t[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)]
    .map(r => [...r[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(c => strip(c[1])));
  if (!rows.length) continue;
  const head = rows[0].map(h => h.toLowerCase());
  if (!(head[0] === 'purchase' && head[1] === 'ap' && head[2] === 'running')) continue;
  examined++;

  // Name the example by the nearest preceding heading, so a finding is findable by a human.
  const before = html.slice(0, t.index);
  const h = [...before.matchAll(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/g)].pop();
  const ex = h ? strip(h[1]).slice(0, 60) : `table #${examined}`;

  // The example's stated budget, from the nearest preceding "Level N · X AP" — but only if it is
  // CLOSE. Appendix I's heroes each carry one, §3's worked examples carry none, and taking the last
  // match at any distance paired §3 tables with an appendix hero's budget and reported six mismatches
  // that were purely the pairing. A budget line belongs to a table only if it is the run-up to it.
  const BUDGET_WINDOW = 2500;
  const bud = [...before.matchAll(/Level\s+\d+\s*·\s*(\d+)\s*AP/g)].pop();
  const stated = (bud && before.length - bud.index <= BUDGET_WINDOW) ? +bud[1] : null;

  let run = 0, lastRun = null;
  for (const cells of rows.slice(1)) {
    if (cells.length < 2) continue;
    const label = cells[0];

    // Closing row: "Total" then "x / y".
    const tot = (cells[1] || '').match(/^(\d+)\s*\/\s*(\d+)$/);
    if (/^total$/i.test(label) && tot) {
      if (+tot[1] !== lastRun)
        note(ex, 'total-mismatch', `Total row says ${tot[1]}, but the last Running is ${lastRun}`);
      if (stated != null && +tot[2] !== stated)
        note(ex, 'budget-mismatch', `Total row budget ${tot[2]} but the heading says ${stated} AP`);
      continue;
    }

    // The AP column is written for humans: "+16", "-4", "18". Accept an explicit sign either way.
    // Matching only /^-?\d+$/ silently SKIPPED every "+N" row, which desynchronised the running total
    // and produced a second wave of findings that were the checker's, not the guide's.
    const num = v => /^[+-]?\d+$/.test(v || '') ? +v : null;
    const ap = num(cells[1]);
    const got = num(cells[2]);
    if (ap == null || got == null) continue;
    rowsChecked++;
    run += ap;
    if (got !== run)
      note(ex, 'running-total', `"${label.slice(0, 54)}" — ${lastRun ?? 0} + ${ap} = ${run}, row says ${got}`);
    run = got;               // resync so one bad row reports once rather than cascading
    lastRun = got;

    // Component sum. A component is a parenthesised figure whose NUMBER COMES FIRST — "(8)" or
    // "(8 unlock)" — so "(level 6)" and "(4/3/3)" are not mistaken for AP. Needs two or more to be
    // a spelled-out breakdown rather than an aside.
    const parts = [...label.matchAll(/\((\d+)(?:\s+[a-z][a-z ]*)?\)/g)].map(m => +m[1]);
    const inline = [...label.matchAll(/\((\d+)\s+\w+\s*\+\s*(\d+)\s+\w+\)/g)];
    const comps = inline.length ? [+inline[0][1], +inline[0][2]] : parts;
    if (comps.length >= 2) {
      componentRows++;
      const sum = comps.reduce((a, b) => a + b, 0);
      if (sum !== ap)
        note(ex, 'component-sum', `"${label.slice(0, 54)}" — ${comps.join(' + ')} = ${sum}, but the row charges ${ap}`);
    }
  }
}

console.log(`guide-example-check — ${path.basename(FILE)}`);
console.log(`${examined} worked-example table(s), ${rowsChecked} purchase row(s), ${componentRows} with a spelled-out breakdown\n`);
if (!findings.length) { console.log('no findings'); process.exit(0); }
for (const f of findings) console.log(`  ${f.kind.padEnd(16)} ${f.ex}\n      ${f.detail}`);
console.log(`\nsummary: ${findings.length} finding(s)`);
process.exit(1);
