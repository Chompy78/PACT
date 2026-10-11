#!/usr/bin/env node
/**
 * guide-price-check.mjs — diff the Players Guide's printed price cells against the live engine.
 *
 * WHY THIS EXISTS
 * ---------------
 * The 2026-08 guide-vs-engine audit (`pact-guide/plans/guide-audit-report.md`, 171 findings) is a
 * hand-written document, and re-verification found its "Fix:" lines are not reliable: several quote
 * a feature's `origin` or `cross` number where the guide's column actually needs the *sticker*
 * price (confirmed wrong for findings #36, #41, #42). Applying that audit verbatim introduces new
 * errors. This script replaces eyeballing with a mechanical, re-runnable diff so the eventual
 * `documents-rules` stamp asserts a reconciliation that actually happened.
 *
 * THE PRICING RULE (the thing nothing else wrote down)
 * ---------------------------------------------------
 * From js/engine.js:290, non-repeatable features:   sticker = max(1, cross - tier)
 * From js/engine.js:289, repeatable (stepped) ones:  on the n-th purchase,
 *     tier = min(7, f.tier + n - 1); sticker = DATA.MASTER[tier][f.band];
 *     origin = max(1, sticker - (tier - 1))
 * Appendix A tables print "Sticker (Origin)" — confirmed by the column header and by the guide's
 * own "pay the sticker (origin) price off the Master Cost Table" callout.
 *
 * USAGE
 *   node guide-price-check.mjs <guide.html> [--engine <dir>] [--json <out>]
 *
 * <guide.html>   path to PACT-Players-Guide.html
 * --engine <dir> directory containing engine-data.js (default: ../../js relative to this file)
 * --json <out>   also write the full machine-readable report to this path
 *
 * Exit 0 = no mismatches. Exit 1 = at least one mismatch (details printed).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

// ---- args -------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const guidePath = argv.find(a => !a.startsWith('--'));
const flag = n => { const i = argv.indexOf(n); return i === -1 ? null : argv[i + 1]; };
if (!guidePath) {
  console.error('usage: node guide-price-check.mjs <guide.html> [--engine <dir>] [--json <out>]');
  process.exit(2);
}
const engineDir = flag('--engine') || join(HERE, '..', '..', 'js');
const jsonOut = flag('--json');

const { DATA } = await import(resolve(join(engineDir, 'engine-data.js')));

// ---- engine-side price model ------------------------------------------------------------
const stickerOf = f => Math.max(1, f.cross - f.tier);

/** Full stepped ladder for a repeatable feature: [{n, tier, sticker, origin}, ...] */
function ladderOf(f, steps) {
  const out = [];
  for (let n = 1; n <= steps; n++) {
    const tier = Math.min(7, f.tier + n - 1);
    const sticker = DATA.MASTER[tier][f.band];
    out.push({ n, tier, sticker, origin: Math.max(1, sticker - (tier - 1)) });
  }
  return out;
}

// ---- html helpers -----------------------------------------------------------------------
const decode = s => s
  .replace(/&#x27;|&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
  // The guide sets typographic apostrophes (111 of them) as house style; engine keys use the
  // straight ASCII form ("Warlock: Devil's Sight"). Normalise for COMPARISON only — rewriting the
  // guide's punctuation to match a data key would be a visible regression in a player document.
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/&nbsp;/g, ' ').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const strip = s => decode(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

/** Split the document into <table>...</table> blocks, keeping source line numbers. */
const CLASSES = ['Barbarian','Bard','Cleric','Druid','Fighter','Monk','Paladin','Ranger','Rogue','Sorcerer','Warlock','Wizard'];

function tables(html) {
  const out = [];
  const re = /<table\b[^>]*>[\s\S]*?<\/table>/g;
  let m;
  while ((m = re.exec(html))) {
    // Class context: the nearest heading before this table naming one of the twelve classes.
    // Disambiguates rows like "Fighting Style" / "Channel Divinity" that several classes share.
    const before = html.slice(0, m.index);
    let cls = null;
    const heads = [...before.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/g)];
    for (let i = heads.length - 1; i >= 0 && !cls; i--) {
      const txt = strip(heads[i][1]);
      cls = CLASSES.find(c => new RegExp(`\\b${c}\\b`).test(txt)) || null;
    }
    out.push({ html: m[0], line: before.split('\n').length, cls });
  }
  return out;
}

const rowsOf = t => [...t.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(m => m[1]);
const cellsOf = tr => [...tr.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)].map(m => strip(m[1]));

// ---- engine key resolution --------------------------------------------------------------
// Guide rows print a bare feature name ("Iron Mind"); engine keys are "Ranger: Iron Mind".
// subAbilMap keys are "Class|Subclass|Name".
const featureIndex = new Map(); // bare name (lowered) -> [{key, entry, kind}]
const push = (name, rec) => {
  const k = name.toLowerCase();
  if (!featureIndex.has(k)) featureIndex.set(k, []);
  featureIndex.get(k).push(rec);
};
for (const [key, entry] of Object.entries(DATA.features || {})) {
  const bare = decode(key.split(': ').slice(1).join(': ')) || decode(key);
  push(bare, { key, entry, kind: 'feature', cls: entry.cls });
  // Engine keys bundle several guide-facing names into one entry. Index the unambiguous
  // restatements too, so a guide row naming either half still resolves:
  //   "Elemental Fury / Improved circle" -> also "Elemental Fury", "Improved circle"
  //   "Combat Superiority (maneuvers)"   -> also "Combat Superiority"
  //   "Bardic Inspiration die"           -> also "Bardic Inspiration"
  // These are aliases for MATCHING only; the price compared is always the one entry's.
  const alts = new Set();
  if (bare.includes(' / ')) bare.split(' / ').forEach(x => alts.add(x.trim()));
  const paren = bare.match(/^(.+?)\s*\(([^)]*)\)$/);
  if (paren && !/\d/.test(paren[2])) alts.add(paren[1].trim());
  const die = bare.match(/^(.+?) die$/i);
  if (die) alts.add(die[1].trim());
  for (const a of alts) if (a && a.toLowerCase() !== bare.toLowerCase()) push(a, { key, entry, kind: 'feature', cls: entry.cls, viaAlias: bare });
}
// A few guide rows name a step by its in-play EFFECT ("3 attacks, L11") where the engine names it by
// ordinal ("Extra Attack (2nd)"). Nothing in the bare-name or parenthetical rules can bridge that, and
// because "Extra Attack" alone resolves to the first matching class (a buy-once Bard entry), these rows
// were reported as `phantom-step-row` — a checker false positive, not a guide defect: the engine really
// does carry Fighter: Extra Attack (2nd) at T5 Premium 20 (16) and (3rd) at T7 Premium 28 (22), exactly
// what the guide prints. Map them explicitly rather than loosening the general rules.
const EFFECT_NAMED_STEPS = {
  'Extra Attack (3 attacks, L11)': 'Fighter: Extra Attack (2nd)',
  'Extra Attack (4 attacks, L20)': 'Fighter: Extra Attack (3rd)',
};
for (const [rowName, key] of Object.entries(EFFECT_NAMED_STEPS)) {
  const entry = (DATA.features || {})[key];
  if (entry) push(rowName, { key, entry, kind: 'feature', cls: entry.cls, viaAlias: key });
}
for (const [key, entry] of Object.entries(DATA.subAbilMap || {})) {
  push(decode(entry.name || key.split('|').pop()), { key, entry, kind: 'subAbil', cls: entry.cls });
}
// Subclass spell bundles live on DATA.subclasses, not in features/subAbilMap. The guide prints
// them as "<Subclass> spells | Bundle | N (M)" rows, so index them under those row names too.
for (const [cls, subs] of Object.entries(DATA.subclasses || {})) {
  for (const [sub, def] of Object.entries(subs || {})) {
    const bn = def && def.spellBundle;
    if (!bn) continue;
    // Since v0.350 a bundle is a Tier-3 subclass purchase with the normal three tiers, so it feeds the
    // ordinary comparison path unchanged: pass the real cross and tier, and the checker derives the
    // printed sticker as cross - tier itself. (Passing bn.sticker as `cross` here double-subtracts the
    // tier and reports every bundle row as a mismatch.)
    const entry = { cls, tier: bn.tier ?? 0, tb: 'Bundle', origin: bn.origin,
                    cross: bn.cross, rep: false, _bundle: true };
    const GENERIC = { Cleric: 'Domain', Paladin: 'Oath', Sorcerer: 'Origin', Warlock: 'Patron', Druid: 'Circle' };
    const aliases = [`${sub} spells`, `${sub} spells + cantrip`, `${sub} bonus spells`, sub];
    // "Circle of the Land" is printed per land type in the guide; the engine has one bundle.
    if (sub === 'Circle of the Land') for (const land of ['Arid', 'Polar', 'Temperate', 'Tropical'])
      aliases.push(`${land}: Circle Spells + cantrip`, `↳ ${land}: Circle Spells + cantrip`);
    if (GENERIC[cls]) aliases.push(`${GENERIC[cls]} bonus spells`, `${GENERIC[cls]} spells`);
    for (const alias of aliases) push(alias, { key: `${cls}|${sub}|spellBundle`, entry, kind: 'bundle', cls });
  }
}

/** Resolve a guide row name to a single engine entry, using class context to disambiguate. */
function resolveFeature(name, cls) {
  let cands = featureIndex.get(name.toLowerCase()) || [];
  // "Second Wind (3 uses, L4)" -> "Second Wind (3 uses)": the guide appends the unlocking level,
  // the engine key does not. Exact-match on the level-stripped form before any prefix guessing.
  if (cands.length === 0) {
    const noLevel = name.replace(/,\s*L\d+\s*\)/, ')').trim();
    if (noLevel !== name) cands = featureIndex.get(noLevel.toLowerCase()) || [];
  }
  // Stepped ladder rows print the step in the name ("Sneak Attack 1d6", "Extra Attack (2
  // attacks, L5)", "Martial Arts die (d8, L5)"). Fall back to the longest engine bare-name
  // that prefixes the row name, so the row resolves to its base repeatable feature.
  if (cands.length === 0) {
    const lower = name.toLowerCase();
    let best = null;
    for (const bare of featureIndex.keys()) {
      if (lower.startsWith(bare) && bare.length > 3 && (!best || bare.length > best.length)) best = bare;
    }
    if (best) cands = (featureIndex.get(best) || []).map(c => ({ ...c, viaPrefix: best }));
  }
  if (cands.length === 0) return { status: 'missing' };
  if (cands.length === 1) return { status: 'ok', ...cands[0] };
  // A subclass ability is normally present BOTH as a flat DATA.features key and as a
  // subAbilMap entry, with identical numbers. That is not a real ambiguity — collapse it.
  // Narrow by the table's class BEFORE collapsing identical numbers: collapsing first dropped Paladin's
  // Fighting Style (same numbers as Ranger's) so a Paladin-table row could never find its own entry.
  const sig = c => `${c.entry.tier}|${c.entry.tb}|${c.entry.origin}|${c.entry.cross}`;
  const pool = cls && cands.some(c => c.cls === cls) ? cands.filter(c => c.cls === cls) : cands;
  const distinct = [...new Map(pool.map(c => [sig(c), c])).values()];
  if (distinct.length === 1) return { status: 'ok', ...distinct[0] };
  return { status: 'ambiguous', candidates: distinct.map(c => `${c.key} [${sig(c)}]`) };
}

// ---- cell parsing -----------------------------------------------------------------------
/** "14 (11)" -> {sticker:14, origin:11}; "12" -> {sticker:12, origin:null}; else null */
function parsePrice(cell) {
  const m = cell.match(/^(\d+)\s*(?:\((\d+)\))?$/);
  if (!m) return null;
  return { sticker: +m[1], origin: m[2] == null ? null : +m[2] };
}
/** Split "A / B (x / y) / C" on the " / " separators OUTSIDE parentheses -> ["A", "B (x / y)", "C"]. */
function splitCombined(name) {
  const parts = [];
  let depth = 0, cur = '';
  for (let i = 0; i < name.length; i++) {
    const ch = name[i];
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && name.startsWith(' / ', i)) { parts.push(cur.trim()); cur = ''; i += 2; continue; }
    cur += ch;
  }
  parts.push(cur.trim());
  return parts.filter(Boolean);
}
/** "24–28" -> {lo:24, hi:28}; anything else null. A range is a claim about EVERY member it covers. */
function parseRange(cell) {
  const m = cell.match(/^(\d+)\s*[–-]\s*(\d+)$/);
  return m ? { lo: +m[1], hi: +m[2] } : null;
}
/** Compare one engine entry against a printed price cell / range / tier. Returns [] when it agrees. */
function priceProblems(f, price, range, tb) {
  const why = [];
  let note = '';
  if (price) {
    if (price.sticker !== stickerOf(f)) why.push(`sticker ${price.sticker}→${stickerOf(f)}`);
    if (price.origin != null && price.origin !== f.origin) why.push(`origin ${price.origin}→${f.origin}`);
    // Diagnose the specific error the audit kept making.
    if (why.length) {
      if (price.sticker === f.origin) note = ' [guide printed ORIGIN in the sticker column]';
      else if (price.sticker === f.cross) note = ' [guide printed CROSS in the sticker column]';
    }
  } else if (range && (stickerOf(f) < range.lo || stickerOf(f) > range.hi)) {
    why.push(`range ${range.lo}–${range.hi} excludes the engine sticker ${stickerOf(f)}`);
  }
  if (tb && tb.tierHi == null && tb.tier !== f.tier) why.push(`tier T${tb.tier}→T${f.tier}`);
  return { why, note };
}
/** "T4 Passive" -> {tier:4, band:'Passive'}; "T5–T6 Passive" -> {tier:5, tierHi:6, band:'Passive'} */
function parseTierBand(cell) {
  const m = cell.match(/^T(\d)(?:\s*[–-]\s*T?(\d))?\s+(.+)$/);
  if (!m) return null;
  return { tier: +m[1], tierHi: m[2] ? +m[2] : null, band: m[3].trim() };
}

// ---- reviewed exceptions ----------------------------------------------------------------
// A row the checker cannot resolve to ONE engine entry with ONE comparable price is listed as
// `ambiguous`, `unparsed-price` or `stepped-feature`. Those used to be only listed, never failed, so a NEW row
// of such a kind (the way four combined rows went stale unnoticed for six weeks) passed silently. Now every
// one must be listed here WITH A REASON, and an entry that no longer matches any row is itself a failure, so
// the list cannot rot. Key: kind | class heading of the table (or -) | sub-section header row (or -) | row name.
// The keys are coupled to the SERVED copy's headings and row names: this checker is meant to run against
// docs/PACT-Players-Guide.html. Run against the pact-guide master it will report stale/unreviewed entries wherever
// the two files' tables differ (see guide-table-diff.mjs) — that is name drift, not a new unreviewed row.
// An entry whose reason starts "OPEN QUESTION" is a suspected guide-vs-engine disagreement, kept green only until
// an owner decides; the summary line counts them (open-questions=N) so they stay visible.
const ALLOW = {
  // -- overview table with no class heading: the row is one class's, priced for it
  'ambiguous|-|-|Fighting Style': "Overview table (no class heading): the row is Fighter's (12). Ranger's and Paladin's Fighting Style are checked in their own class tables.",
  'ambiguous|-|-|Channel Divinity': "Overview table (no class heading): the row is Cleric's (T2, 5 (4)). Paladin's Channel Divinity is a separate T3 entry, checked in the Paladin table.",
  // -- bundle rows: one printed row, one engine bundle per subclass
  'ambiguous|Druid|-|Circle bonus spells': 'A bundle row printed as "varies a–b": the engine has one bundle per subclass at different prices. Not compared.',
  'ambiguous|Sorcerer|-|Origin bonus spells': 'A bundle row printed as "varies a–b": the engine has one bundle per subclass at different prices. Not compared.',
  'ambiguous|Warlock|-|Patron bonus spells': 'A bundle row printed as "varies a–b": the engine has one bundle per subclass at different prices. Not compared.',
  // -- rows the guide deliberately prints without a price
  'unparsed-price|Cleric|-|Divine Order (Protector/Thaumaturge)': 'The guide prints no price (status "skill grant → ladder"), so there is nothing to compare. Whether the engine\'s flat 5 (5) is meant to be that price is NOT verified here.',
  'unparsed-price|Druid|-|Primal Order': 'The guide prints no price (status "skill grant → ladder"), so there is nothing to compare. Whether the engine\'s flat 5 (5) is meant to be that price is NOT verified here.',
  'unparsed-price|Fighter|-|Weapon Mastery': 'Engine entry is bar:true (not buyable as a feature) and the guide prints no price and points to the mastery ladder: they agree.',
  'unparsed-price|Paladin|-|Weapon Mastery': 'Engine entry is bar:true (not buyable as a feature) and the guide prints no price and points to the mastery ladder: they agree.',
  'unparsed-price|Ranger|-|Weapon Mastery': 'Engine entry is bar:true (not buyable as a feature) and the guide prints no price and points to the mastery ladder: they agree.',
  'unparsed-price|Rogue|-|Weapon Mastery': 'Engine entry is bar:true (not buyable as a feature) and the guide prints no price and points to the mastery ladder: they agree.',
  'unparsed-price|Fighter|Champion|Additional Fighting Style': 'Engine entry is bar:true and the guide says "Barred → A&T": they agree.',
  // -- OPEN QUESTIONS: the guide and the engine look like they disagree; listed here only so the checker stays green until an owner decides
  'unparsed-price|Fighter|Battle Master|Improved Combat Superiority': 'OPEN QUESTION (board: guide-vs-engine rows the checker cannot see): the guide says "Included in Premium" and prints no price, but the engine sells it separately at 14 (10) with no bar.',
  'unparsed-price|Ranger|Gloom Stalker|Iron Mind': 'OPEN QUESTION (board: guide-vs-engine rows the checker cannot see): the guide says "Barred (→ saves)" with no price but status "Buy", while the engine sells it at 14 (11) with no bar.',
  // -- stepped
  'stepped-feature|Sorcerer|-|Metamagic (2 options, L2) (SP)': 'The engine prices Metamagic as 2 x purchase number (a special case in engine.js), so a single printed cell has no one engine price to match.',
  'stepped-feature|Sorcerer|-|Metamagic (+1 option, L10) (SP)': 'The engine prices Metamagic as 2 x purchase number (a special case in engine.js), so a single printed cell has no one engine price to match.',
  'stepped-feature|Sorcerer|-|Metamagic (+1 option, L17) (SP)': 'The engine prices Metamagic as 2 x purchase number (a special case in engine.js), so a single printed cell has no one engine price to match.',
};
const LISTED_KINDS = new Set(['ambiguous', 'unparsed-price', 'stepped-feature']);
const allowKey = f => `${f.kind}|${f.table || '-'}|${f.context || '-'}|${f.name}`;

// ---- main scan --------------------------------------------------------------------------
const html = readFileSync(guidePath, 'utf-8');
const findings = [];
let rowsChecked = 0, tablesScanned = 0;

for (const t of tables(html)) {
  const rows = rowsOf(t.html);
  if (!rows.length) continue;
  const header = cellsOf(rows[0]).map(c => c.toLowerCase());
  const priceCol = header.findIndex(h => h.startsWith('sticker'));
  if (priceCol === -1) continue;            // not a priced feature table
  // Some non-feature tables (spell-slot ladders, AP-by-level, purchase ladders) also carry a
  // "Sticker" column. They key on a level/rank/purchase index, not a named feature — skip them.
  if (/^(spell level|level|rank|purchase|slot|ap|step|n)\b/.test(header[0] || '')) continue;
  const nameCol = 0;
  const tbCol = header.findIndex(h => h.includes('tier'));
  const statusCol = header.findIndex(h => h.includes('status'));
  tablesScanned++;

  let context = null;                        // most recent subclass/section header row
  for (const tr of rows.slice(1)) {
    const c = cellsOf(tr);
    if (c.length < 2) continue;
    const name = c[nameCol];
    if (!name) continue;
    const priceCell = c[priceCol] ?? '';
    const tbCell = tbCol === -1 ? '' : (c[tbCol] ?? '');
    // A header/divider row: name present, everything else blank.
    if (!priceCell && !tbCell) { context = name; continue; }

    const price = parsePrice(priceCell);
    const tb = parseTierBand(tbCell);
    const status = statusCol === -1 ? '' : (c[statusCol] ?? '');
    rowsChecked++;

    const range = parseRange(priceCell);
    const base = { line: t.line, context, name, guide: { tierBand: tbCell, price: priceCell, status }, table: t.cls };

    // A combined row "A / B / C" that is NOT one engine entry's own name (a few engine keys bundle names, e.g.
    // "Psionic Power / Psychic Blades") makes a claim about EACH name. resolveFeature's prefix fallback would
    // match only the first name and never look at the rest — which is how "Roving / Tireless" stayed wrong.
    const members = splitCombined(name);
    if (members.length > 1 && !featureIndex.has(name.toLowerCase()) && (price || range || tb)) {
      for (const part of members) {
        const pb = { ...base, name: `${name} ⟶ ${part}` };
        const pr = resolveFeature(part, t.cls);
        if (pr.status === 'missing') { findings.push({ ...pb, kind: 'no-engine-key', detail: `combined-row member "${part}" matches no engine entry` }); continue; }
        if (pr.status === 'ambiguous') { findings.push({ ...pb, kind: 'ambiguous', detail: `combined-row member matches ${pr.candidates.length}: ${pr.candidates.join(', ')}` }); continue; }
        if (pr.entry.rep) { findings.push({ ...pb, kind: 'stepped-feature', engineKey: pr.key, detail: 'combined-row member is repeatable/stepped in engine' }); continue; }
        const { why, note } = priceProblems(pr.entry, price, range, tb);
        if (why.length) findings.push({ ...pb, kind: 'price-mismatch', engineKey: pr.key, detail: why.join(', ') + note + ' (combined-row member)',
          engine: `${pr.entry.tb} | ${stickerOf(pr.entry)} (${pr.entry.origin})` });
      }
      continue;
    }

    const res = resolveFeature(name, t.cls);

    if (res.status === 'missing') {
      // Only report as a real problem when the row looks like a priced feature row.
      if (price || tb) findings.push({ ...base, kind: 'no-engine-key',
        detail: 'no DATA.features / subAbilMap entry matches this row name' });
      continue;
    }
    if (res.status === 'ambiguous') {
      findings.push({ ...base, kind: 'ambiguous', detail: `matches ${res.candidates.length}: ${res.candidates.join(', ')}` });
      continue;
    }

    const f = res.entry;
    const engine = f.rep
      ? { rep: true, ladder: ladderOf(f, 8) }
      : { rep: false, tier: f.tier, band: f.tb, sticker: stickerOf(f), origin: f.origin };

    if (f.rep) {
      // Stepped feature: a single printed cell can't be checked against one value; surface the
      // real ladder so a human (or a follow-up rule) can rebuild the row set correctly.
      findings.push({ ...base, kind: 'stepped-feature', engineKey: res.key,
        detail: 'repeatable/stepped in engine — verify the whole row set, not one cell',
        engine: engine.ladder.map(s => `T${s.tier} ${s.sticker}(${s.origin})`).join(' ') });
      continue;
    }

    // A row that reached its engine entry only by PREFIX carries a step qualifier the engine key
    // does not ("Extra Attack (3 attacks, L11)" -> "Extra Attack"). Comparing it against the BASE
    // feature's price is meaningless and produced false price-mismatches. Two real cases:
    //   - the engine has explicit sibling variants ("Fighter: Extra Attack (2nd)/(3rd)") -> the row
    //     maps to one of those, so report the variants and let a human pick, don't assert a mismatch;
    //   - the engine has no siblings and the base is buy-once -> the row describes a purchase that
    //     does not exist at all, which is the actual defect worth reporting.
    if (res.viaPrefix && /\(\s*(?:\d+(?:st|nd|rd|th)?\b|\+\d+|d\d+)/i.test(name)) {
      const bare = res.key.includes(': ') ? res.key.split(': ').slice(1).join(': ') : res.key;
      // The FIRST step of a ladder legitimately prints the base feature's own price
      // ("Extra Attack (2 attacks, L5)" is just "Extra Attack"). If the cell already matches the
      // base exactly, the row is correct — say nothing rather than manufacturing a finding.
      const pr = parsePrice(priceCell);
      if (pr && pr.sticker === stickerOf(f) && (pr.origin == null || pr.origin === f.origin)) continue;
      // Search variants by BARE name, not by the resolved key's class prefix: a row in a
      // class-agnostic table resolves to whichever class happened to match first, and
      // "Bard: Extra Attack (2nd)" does not exist while "Fighter: Extra Attack (2nd)" does.
      const sibs = Object.entries(DATA.features || {})
        .filter(([k, v]) => {
          if (k === res.key || v.tier == null) return false;
          const kb = k.includes(': ') ? k.split(': ').slice(1).join(': ') : k;
          return kb !== bare && kb.startsWith(bare + ' (');
        })
        .map(([k, v]) => `${k} ${v.tb} ${stickerOf(v)} (${v.origin})`);
      findings.push({ ...base,
        kind: sibs.length ? 'variant-row' : 'phantom-step-row',
        engineKey: res.key,
        detail: sibs.length
          ? `stepped row resolves to base "${bare}"; engine has explicit variants — check against those, not the base`
          : `engine has only "${res.key}" (rep:false) and no variant keys — this stepped purchase does not exist`,
        engine: sibs.length ? sibs.join(' · ') : `${f.tb} ${stickerOf(f)} (${f.origin}), buy-once` });
      continue;
    }

    if (!price && !range) {
      findings.push({ ...base, kind: 'unparsed-price', engineKey: res.key,
        detail: `engine says ${stickerOf(f)} (${f.origin})`, engine });
      continue;
    }

    const { why, note } = priceProblems(f, price, range, tb);
    if (why.length) {
      findings.push({ ...base, kind: 'price-mismatch', engineKey: res.key,
        detail: why.join(', ') + note,
        engine: `${f.tb} | ${stickerOf(f)} (${f.origin})` });
    }
  }
}

// ---- report -----------------------------------------------------------------------------
const byKind = findings.reduce((a, f) => (a[f.kind] = (a[f.kind] || 0) + 1, a), {});
console.log(`guide-price-check — ${guidePath}`);
console.log(`engine DATA.version = ${DATA.version}`);
console.log(`scanned ${tablesScanned} priced tables, ${rowsChecked} feature rows\n`);

const order = ['price-mismatch', 'phantom-step-row', 'no-engine-key', 'variant-row', 'stepped-feature', 'ambiguous', 'unparsed-price'];
for (const kind of order) {
  const group = findings.filter(f => f.kind === kind);
  if (!group.length) continue;
  console.log(`## ${kind} (${group.length})`);
  for (const f of group) {
    const ctx = f.context ? `${f.context} › ` : '';
    console.log(`  line ${f.line}  ${ctx}${f.name}`);
    console.log(`      guide:  ${f.guide.tierBand} | ${f.guide.price} | ${f.guide.status}`);
    if (f.engine) console.log(`      engine: ${typeof f.engine === 'string' ? f.engine : JSON.stringify(f.engine)}`);
    console.log(`      ${f.detail}`);
  }
  console.log('');
}

// Reviewed exceptions: every listed-kind finding must be in ALLOW; every ALLOW entry must still match a row.
const unreviewed = findings.filter(f => LISTED_KINDS.has(f.kind) && !(allowKey(f) in ALLOW));
const seenKeys = new Set(findings.map(allowKey));
const staleAllow = Object.keys(ALLOW).filter(k => !seenKeys.has(k));
if (unreviewed.length) {
  console.log('## unreviewed (' + unreviewed.length + ') — a row the checker cannot compare, and nobody has said why that is fine');
  for (const f of unreviewed) console.log(`  line ${f.line}  ${allowKey(f)}`);
  console.log('  Fix the row, or add its key to ALLOW with a reason.\n');
}
if (staleAllow.length) {
  console.log('## stale ALLOW entries (' + staleAllow.length + ') — match no row any more; delete them');
  for (const k of staleAllow) console.log('  ' + k);
  console.log('');
}

const openQuestions = findings.filter(f => LISTED_KINDS.has(f.kind) && String(ALLOW[allowKey(f)] || '').startsWith('OPEN QUESTION')).length;
console.log('summary: ' + (Object.keys(byKind).length
  ? Object.entries(byKind).map(([k, v]) => `${k}=${v}`).join('  ')
  : 'no findings')
  + (unreviewed.length ? `  UNREVIEWED=${unreviewed.length}` : '') + (staleAllow.length ? `  STALE-ALLOW=${staleAllow.length}` : '')
  + (openQuestions ? `  open-questions=${openQuestions}` : ''));

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({
    guide: guidePath, dataVersion: DATA.version, tablesScanned, rowsChecked, byKind, findings
  }, null, 2));
  console.log(`wrote ${jsonOut}`);
}

process.exit(findings.some(f => ['price-mismatch','phantom-step-row','no-engine-key'].includes(f.kind)) || unreviewed.length || staleAllow.length ? 1 : 0);
