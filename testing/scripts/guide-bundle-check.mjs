#!/usr/bin/env node
/**
 * guide-bundle-check.mjs — verify the Players Guide's subclass bonus-spell bundles against the engine.
 *
 * WHY THIS IS A THIRD TOOL
 * ------------------------
 * guide-price-check.mjs resolves a row NAME to a DATA.features key; bundles don't live in DATA.features,
 * they live in DATA.subclasses[Class][Subclass].spellBundle. guide-spell-check.mjs keys on SPELL LEVEL;
 * bundles have no spell level. Both checkers therefore report bundle rows as `ambiguous`/unparsed and
 * neither can prove a single one of them. This closes that hole.
 *
 * THE COLUMN CONVENTION (this differs from the rest of Appendix A — read this before "fixing" it)
 * -----------------------------------------------------------------------------------------------
 * Ordinary feature rows print `Sticker (Origin)`. A bundle has no sticker: engine.js:341 charges
 * `_isO ? bundle.origin : bundle.cross` and nothing else. So a bundle row's price cell is really
 * `Cross (Origin)` — e.g. Life Domain {origin:6, cross:8} prints "8 (6)". When origin === cross the
 * guide prints the bare number ("4" for the Paladin Oaths), because a parenthetical repeating the same
 * figure reads as a discount that doesn't exist.
 *
 * WHAT IT CHECKS
 *   1. Every per-subclass bundle row's price equals that subclass's spellBundle.
 *   2. Every engine bundle has at least one guide row (a missing row is a silent omission — this is how
 *      Circle of the Stars went unpriced in the guide while the engine charged 5 AP for it).
 *   3. Every guide bundle row resolves to an engine bundle (no phantom bundles).
 *   4. Class-level summary rows cover the real per-subclass range, and say so when it varies.
 *   5. Appendix J lists EVERY subclass of every bundle-granting class, including the ones with no
 *      bundle at all — an omitted subclass reads as an oversight, an explicit "none" reads as a rule.
 *
 * USAGE
 *   node guide-bundle-check.mjs <guide.html> [--engine <dir>] [--json <out>]
 *
 * Exit 0 = everything matches. Exit 1 = at least one finding.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const guidePath = argv.find(a => !a.startsWith('--'));
const flag = n => { const i = argv.indexOf(n); return i === -1 ? null : argv[i + 1]; };
if (!guidePath) { console.error('usage: node guide-bundle-check.mjs <guide.html> [--engine <dir>] [--json <out>]'); process.exit(2); }
const { DATA } = await import(resolve(join(flag('--engine') || join(HERE, '..', '..', 'js'), 'engine-data.js')));
const jsonOut = flag('--json');

// ---- html helpers (same conventions as the other two checkers) ---------------------------
const decode = s => s
  .replace(/&#x27;|&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/[‘’]/g, "'")
  .replace(/&nbsp;/g, ' ').replace(/&minus;/g, '−').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const strip = s => decode(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const cellsOf = tr => [...tr.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)].map(m => strip(m[1]));

const html = readFileSync(guidePath, 'utf-8');
const lineAt = i => html.slice(0, i).split('\n').length;

const findings = [];
const note = (line, kind, what, detail) => findings.push({ line, kind, what, detail });

// ---- engine side -------------------------------------------------------------------------
/** "Class|Subclass" -> {origin, cross, cantrips} for every subclass that actually sells a bundle. */
const bundles = new Map();
/** Subclass name -> Class, for resolving a guide section header to a class. Asserted unique below. */
const subToClass = new Map();
/** Classes that grant bonus spells at all, in DATA.classes order. */
const bundleClasses = [];
for (const cls of DATA.classes) {
  for (const sub of (DATA.subList[cls] || [])) {
    if (subToClass.has(sub)) note(0, 'engine', `subclass name "${sub}" is used by both ${subToClass.get(sub)} and ${cls}`, 'checker resolves section headers by subclass name; duplicates make that ambiguous');
    subToClass.set(sub, cls);
    const bn = ((DATA.subclasses[cls] || {})[sub] || {}).spellBundle;
    if (bn) { bundles.set(`${cls}|${sub}`, bn); if (!bundleClasses.includes(cls)) bundleClasses.push(cls); }
  }
}

// ---- guide side --------------------------------------------------------------------------
/** "8 (6)" -> {cross:8, origin:6} · "4" -> {cross:4, origin:4} · "varies 5-11" -> {lo:5, hi:11} */
function parsePrice(cell) {
  const c = cell.replace(/[–—−]/g, '-').trim();
  if (/^none\b/i.test(c)) return { none: true };
  const varies = c.match(/^varies\s+(\d+)\s*-\s*(\d+)$/i);
  if (varies) return { lo: +varies[1], hi: +varies[2] };
  const pair = c.match(/^(\d+)\s*\((\d+)\)$/);
  if (pair) return { cross: +pair[1], origin: +pair[2] };
  const one = c.match(/^(\d+)$/);
  if (one) return { cross: +one[1], origin: +one[1] };
  return null;
}

/** How the guide should print a given bundle. */
const fmt = bn => bn.origin === bn.cross ? String(bn.cross) : `${bn.cross} (${bn.origin})`;

// The spells a bundle actually charges for. A bundle prices the grants unlocking at character level
// <= 5; everything above rides free. Circle of the Land is stored per terrain, so fall back to a
// prefix match. Returns null when a subclass has no grant entry at all.
const SG = (DATA.spellGrants || {}).subclassSpells || {};
function paidGrants(cls, sub) {
  const e = SG[`${cls}: ${sub}`] || SG[Object.keys(SG).find(k => k.startsWith(`${cls}: ${sub} (`)) || ''];
  return e && e.spells ? e.spells.filter(s => s.charLevel <= 5) : null;
}

// Bundle rows that are deliberately not subclass spell lists.
const NOT_A_SUBCLASS_BUNDLE = [/^Pact of the Tome\b/];

// Walk every table row in document order, tracking which subclass block we're inside.
// A subclass header row is `<subclass name> | | |` — the price/status cells are blank.
const seen = new Map();          // "Class|Subclass" -> [lines]
const summarised = new Set();    // classes whose class-level table carries a "… bonus spells" row
let currentSub = null, currentClass = null;
for (const m of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
  const cells = cellsOf(m[1]);
  if (cells.length < 3) continue;
  const label = cells[0], line = lineAt(m.index);

  if (subToClass.has(label) && !cells[1] && !cells[2]) { currentSub = label; currentClass = subToClass.get(label); continue; }
  if (!/^Bundle$/.test(cells[1] || '')) continue;
  if (NOT_A_SUBCLASS_BUNDLE.some(re => re.test(label))) continue;

  const price = parsePrice(cells[2] || '');

  // Class-level summary row ("Domain bonus spells", "Circle bonus spells", ...) — no subclass block yet.
  if (/\bbonus spells$/i.test(label)) {
    // Resolve the class from the nearest preceding <h3>.
    const before = html.slice(0, m.index);
    const h3 = [...before.matchAll(/<h3\b[^>]*>([^<]*)</g)].pop();
    const cls = h3 && DATA.classes.find(c => strip(h3[1]) === c);
    if (!cls) { note(line, 'unresolved-summary', label, `no class heading found before this row`); continue; }
    const mine = [...bundles.entries()].filter(([k]) => k.startsWith(cls + '|')).map(([, v]) => v);
    if (!mine.length) { note(line, 'phantom-summary', `${cls}: "${label}"`, 'no subclass of this class has a spellBundle'); continue; }
    summarised.add(cls);
    const subsTotal = (DATA.subList[cls] || []).length;
    const anyNone = mine.length < subsTotal;
    const lo = Math.min(...mine.map(b => b.cross)), hi = Math.max(...mine.map(b => b.cross));
    // A summary row must carry the real figure — the flat price when every bundle agrees, the range
    // when they don't — and must say "none" out loud when some subclass sells nothing, because no
    // number and no range can express "there is nothing here to buy".
    const wantPrice = lo === hi ? fmt(mine[0]) : `varies ${lo}–${hi}`;
    const cell = (cells[2] || '').replace(/[–—−]/g, '-');
    if (!cell.includes(wantPrice.replace(/[–—−]/g, '-')))
      note(line, 'summary-mismatch', `${cls}: "${label}"`, `guide "${cells[2]}" should carry "${wantPrice}"`);
    if (anyNone && !/none/i.test(cell))
      note(line, 'summary-hides-none', `${cls}: "${label}"`,
        `${subsTotal - mine.length} of ${subsTotal} subclasses sell no bundle — the row must say so, a price cannot`);
    continue;
  }

  // Per-subclass bundle row.
  if (!currentSub) { note(line, 'no-subclass-context', label, 'bundle row outside any subclass block'); continue; }
  const key = `${currentClass}|${currentSub}`;
  const bn = bundles.get(key);
  if (!bn) { note(line, 'phantom-bundle', `${key}: "${label}"`, 'the engine sells no bundle for this subclass'); continue; }
  if (!seen.has(key)) seen.set(key, []);
  seen.get(key).push(line);
  if (!price) { note(line, 'unparsed-price', `${key}: "${label}"`, `cell "${cells[2]}"`); continue; }
  if (price.cross !== bn.cross || price.origin !== bn.origin)
    note(line, 'price-mismatch', `${key}: "${label}"`, `guide "${cells[2]}" — engine ${fmt(bn)}`);
}

// ---- coverage: every engine bundle must be printed somewhere ------------------------------
for (const key of bundles.keys())
  if (!seen.has(key)) note(0, 'missing-row', key, `engine charges ${fmt(bundles.get(key))} but no guide row prices it`);

// A class whose table has no summary row at all can't be caught by the loop above — there is no row
// to check. Ranger reached v0.346 this way: two of its subclasses sell bundles and its class table
// never mentioned them.
for (const cls of bundleClasses)
  if (!summarised.has(cls)) note(0, 'missing-summary-row', cls, `${[...bundles.keys()].filter(k => k.startsWith(cls + '|')).length} subclass bundle(s) exist but the class table has no "… bonus spells" row`);

// ---- Appendix J: every subclass of a bundle-granting class must appear, "none" included ----
const appx = html.match(/<h2 id="appendix-j-[^"]*"[\s\S]*?(?=<h2\b|<\/main>)/);
if (!appx) note(0, 'missing-appendix', 'Appendix J', 'no <h2 id="appendix-j-..."> section — the per-subclass working table is absent');
else {
  const labels = new Set();
  const appxLine = lineAt(html.indexOf(appx[0]));
  for (const m of appx[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
    const c = cellsOf(m[1]);
    if (c.length < 3 || !c[1] || !subToClass.has(c[1])) continue;   // column 2 is the subclass
    labels.add(c[1]);
    // Appendix J prints the price a second time; a table nobody checks is a table that drifts.
    const key = `${subToClass.get(c[1])}|${c[1]}`, bn = bundles.get(key), price = parsePrice(c[2]);
    if (!price) { note(appxLine, 'unparsed-price', `Appendix J · ${key}`, `cell "${c[2]}"`); continue; }
    if (!bn) { if (!price.none) note(appxLine, 'appendix-phantom', `Appendix J · ${key}`, `prices this at "${c[2]}" but the engine sells no bundle — it must read "none"`); continue; }
    if (price.none) { note(appxLine, 'appendix-mismatch', `Appendix J · ${key}`, `says "none" but the engine charges ${fmt(bn)}`); continue; }
    if (price.cross !== bn.cross || price.origin !== bn.origin)
      note(appxLine, 'appendix-mismatch', `Appendix J · ${key}`, `guide "${c[2]}" — engine ${fmt(bn)}`);
    // Appendix J names the spells you pay for. Check that list against DATA.spellGrants rather than
    // trusting prose: a renamed or dropped spell would otherwise sit there indefinitely.
    const want = paidGrants(subToClass.get(c[1]), c[1]);
    if (want) {
      const printed = (c[3] || '');
      const missing = want.filter(s => !printed.includes(s.name));
      if (missing.length)
        note(appxLine, 'appendix-spell-gap', `Appendix J · ${key}`,
          `paid grants not named in the row: ${missing.map(s => s.name).join(', ')}`);
    }
  }
  for (const cls of bundleClasses)
    for (const sub of (DATA.subList[cls] || []))
      if (!labels.has(sub))
        note(appxLine, 'appendix-gap', `${cls} · ${sub}`,
          bundles.has(`${cls}|${sub}`) ? 'bundle-granting subclass missing from Appendix J'
                                       : 'subclass with NO bundle missing from Appendix J — omission reads as an oversight, not a rule');
}

// ---- report -------------------------------------------------------------------------------
console.log(`guide-bundle-check — ${guidePath}`);
console.log(`engine DATA.version = ${DATA.version}`);
console.log(`${bundles.size} engine bundles across ${bundleClasses.length} classes (${bundleClasses.join(', ')})\n`);
if (!findings.length) console.log('no findings');
else for (const f of findings) console.log(`  ${f.line ? 'L' + f.line : '  --'}  [${f.kind}] ${f.what}\n        ${f.detail}`);
console.log(`\nsummary: ${findings.length} finding(s); ${[...seen.values()].flat().length} bundle row(s) verified`);
if (jsonOut) { writeFileSync(jsonOut, JSON.stringify({ guide: guidePath, dataVersion: DATA.version, findings }, null, 2)); console.log(`wrote ${jsonOut}`); }
process.exit(findings.length ? 1 : 0);
