#!/usr/bin/env node
/**
 * guide-spell-check.mjs — verify the Players Guide's spell-economy tables against the live engine.
 *
 * WHY THIS IS A SEPARATE TOOL
 * ---------------------------
 * guide-price-check.mjs resolves a row NAME to a DATA.features key. The spellcasting tables key on
 * SPELL LEVEL instead ("Spell level | Sticker | Origin (−1) | …"), so none of that machinery applies.
 * This checks a different thing: that the printed grids equal what engine.js actually charges, and
 * that the worked examples' running totals really add up.
 *
 * THE COST MODEL (read out of js/engine.js so it can't drift)
 * ----------------------------------------------------------
 *   slot at level L, discount dd   max(1, DATA.slotSticker[L-1] - dd)      engine.js:417
 *   spell known at L, discount dd  max(1, DATA.knownUnit[L-1]  - dd)      engine.js:375
 *   innate spell at L              DATA.innate5x[L-1]   — NO discount     engine.js:444
 *   Hit-Dice gate for level L      DATA.hdGate[L-1]                       engine.js:380
 *   Foundation                     max(1, 7 - baseDisc)                   engine.js:351
 *   Rank r cumulative              max(0, DATA.rankCum[r-1] - baseDisc*r) engine.js:352
 * `dd` is the spell economy's own ±1/±2 modifier (origin Tradition, +bound), NOT the +Tier surcharge.
 *
 * USAGE
 *   node guide-spell-check.mjs <guide.html> [--engine <dir>] [--json <out>]
 *
 * Exit 0 = every checked cell matches. Exit 1 = at least one mismatch.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const guidePath = argv.find(a => !a.startsWith('--'));
const flag = n => { const i = argv.indexOf(n); return i === -1 ? null : argv[i + 1]; };
if (!guidePath) { console.error('usage: node guide-spell-check.mjs <guide.html> [--engine <dir>] [--json <out>]'); process.exit(2); }
const { DATA } = await import(resolve(join(flag('--engine') || join(HERE, '..', '..', 'js'), 'engine-data.js')));
const jsonOut = flag('--json');

// ---- html helpers (same conventions as guide-price-check) --------------------------------
const decode = s => s
  .replace(/&#x27;|&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/[‘’]/g, "'")
  .replace(/&nbsp;/g, ' ').replace(/&minus;/g, '−').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const strip = s => decode(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const cellsOf = tr => [...tr.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)].map(m => strip(m[1]));

const html = readFileSync(guidePath, 'utf-8');
const tables = [];
for (const m of html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/g)) {
  tables.push({ html: m[0], line: html.slice(0, m.index).split('\n').length,
                rows: [...m[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(r => cellsOf(r[1])) });
}

const findings = [];
let checked = 0;
const note = (line, what, guide, engine, detail) => findings.push({ line, what, guide, engine, detail });

// ---- column header -> expected value for spell level L -----------------------------------
// `base` is the column this one discounts from, when the header says "Origin (−N)".
function columnModel(header, prevBase) {
  const h = header.toLowerCase();
  if (/min\.?\s*hit dice/.test(h)) return { name: 'hdGate', f: L => DATA.hdGate[L - 1], base: null };
  if (/standard slot cost|^sticker$/.test(h)) return { name: 'slot sticker', f: L => DATA.slotSticker[L - 1], base: 'slot' };
  if (/innate/.test(h)) return { name: 'innate (3×)', f: L => DATA.innate5x[L - 1], base: null };
  if (/^ap cost$/.test(h)) return { name: 'spell known', f: L => DATA.knownUnit[L - 1], base: 'known' };
  const disc = h.match(/\(\s*[−-]\s*(\d)\s*\)/);
  if (disc && prevBase) {
    const d = +disc[1];
    const src = prevBase === 'slot' ? (L => DATA.slotSticker[L - 1]) : (L => DATA.knownUnit[L - 1]);
    return { name: `${prevBase} −${d}`, f: L => Math.max(1, src(L) - d), base: prevBase };
  }
  return null;
}

/** "1", "1st", "1st–2nd", "9th" -> [levels] */
function levelsOf(cell) {
  const c = cell.replace(/\s/g, '');
  const range = c.match(/^(\d)(?:st|nd|rd|th)?[–—-](\d)(?:st|nd|rd|th)?$/);
  if (range) { const out = []; for (let L = +range[1]; L <= +range[2]; L++) out.push(L); return out; }
  const one = c.match(/^(\d)(?:st|nd|rd|th)?$/);
  return one ? [+one[1]] : null;
}

// ---- 1. spell-level grids ----------------------------------------------------------------
for (const t of tables) {
  if (!t.rows.length) continue;
  const head = t.rows[0];
  if (!head[0] || !/^spell level$/i.test(head[0])) continue;

  // Transposed form: "Spell level | 1st | 2nd | …" with the data on following rows.
  if (levelsOf(head[1] || '')) {
    for (const row of t.rows.slice(1)) {
      const model = columnModel(row[0] || '', null);
      if (!model) continue;
      for (let i = 1; i < row.length; i++) {
        const Ls = levelsOf(head[i] || ''); if (!Ls) continue;
        const got = Number(row[i]); if (!Number.isFinite(got)) continue;
        for (const L of Ls) {
          const want = model.f(L); checked++;
          if (want !== got) note(t.line, `${model.name} @ L${L}`, got, want, `transposed row "${row[0]}"`);
        }
      }
    }
    continue;
  }

  // Normal form: one row per spell level.
  let prevBase = null;
  const models = head.map((h, i) => { if (i === 0) return null; const m = columnModel(h, prevBase); if (m && m.base) prevBase = m.base; return m; });
  for (const row of t.rows.slice(1)) {
    const Ls = levelsOf(row[0] || ''); if (!Ls) continue;
    for (let i = 1; i < row.length; i++) {
      const model = models[i]; if (!model) continue;
      const got = Number(row[i]); if (!Number.isFinite(got)) continue;
      for (const L of Ls) {
        const want = model.f(L); checked++;
        if (want !== got) note(t.line, `${model.name} @ L${L}`, got, want, `column "${head[i]}"`);
      }
    }
  }
}

// ---- 2. worked examples: does "Running" actually accumulate "AP"? -------------------------
// The audit found Worked Example 3 wrong on BOTH line items and running total, so the total is
// checked independently of whether each line item is right.
for (const t of tables) {
  if (!t.rows.length) continue;
  const head = t.rows[0].map(h => h.toLowerCase());
  const iAP = head.findIndex(h => /^ap$/.test(h));
  const iRun = head.findIndex(h => /^running$/.test(h));
  if (iAP === -1 || iRun === -1) continue;
  let acc = 0, first = true;
  for (const row of t.rows.slice(1)) {
    // Number('') is 0, not NaN - so a section-header row like ["Origin purchases", "", ""] would
    // otherwise read as a real 0-AP line and desync the accumulator. Require actual digits.
    const rawAP = (row[iAP] || '').trim(), rawRun = (row[iRun] || '').trim();
    const num = t => Number(t.replace(/\u2212/g, '-').replace(/^\+/, '').replace(/,/g, ''));
    if (!/\d/.test(rawAP) || !/\d/.test(rawRun)) { continue; }
    const ap = num(rawAP), run = num(rawRun);
    if (!Number.isFinite(ap) || !Number.isFinite(run)) { first = false; continue; }
    acc = first ? ap : acc + ap; first = false;
    checked++;
    if (acc !== run) { note(t.line, `running total after "${(row[0] || '').slice(0, 40)}"`, run, acc, 'worked example'); acc = run; }
  }
}

// ---- report -------------------------------------------------------------------------------
console.log(`guide-spell-check — ${guidePath}`);
console.log(`engine DATA.version = ${DATA.version}`);
console.log(`checked ${checked} cells\n`);
if (!findings.length) console.log('no mismatches');
else for (const f of findings) {
  console.log(`  L${f.line}  ${f.what}`);
  console.log(`      guide: ${f.guide}   engine: ${f.engine}   (${f.detail})`);
}
console.log(`\nsummary: ${findings.length} mismatch(es) across ${checked} checked cells`);
if (jsonOut) { writeFileSync(jsonOut, JSON.stringify({ guide: guidePath, dataVersion: DATA.version, checked, findings }, null, 2)); console.log(`wrote ${jsonOut}`); }
process.exit(findings.length ? 1 : 0);
