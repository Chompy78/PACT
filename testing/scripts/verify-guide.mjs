#!/usr/bin/env node
/**
 * verify-guide.mjs — one command, one verdict: is docs/PACT-Players-Guide.html correct?
 *
 * WHY THIS EXISTS
 * ---------------
 * Three separate checkers each answer part of the question, each prints a different summary format,
 * and one of them (guide-price-check) fails on finding kinds that are easy to mistake for noise. That
 * made "is the guide correct?" a question you had to remember three commands and a convention to
 * answer. This runs all three, adds the structural checks none of them do, and prints PASS or FAIL.
 *
 * Run this BEFORE copying the guide over pact-guide's master. A green run is the evidence that this
 * repo's copy is the one that should win.
 *
 *   node testing/scripts/verify-guide.mjs [guide.html]
 *
 * Exit 0 = every check passed. Exit 1 = at least one failed.
 *
 * WHAT IT CANNOT TELL YOU — read this before treating green as "safe to overwrite the master"
 *   - Whether the master has edits this copy lacks. It compares the guide to the ENGINE, not to the
 *     master. Only a `diff` against the master can tell you that, and only you can run it.
 *   - Whether the prose is true. It checks priced cells, not sentences.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const guide = resolve(process.argv[2] || join(HERE, '..', '..', 'docs', 'PACT-Players-Guide.html'));
const { DATA } = await import(resolve(join(HERE, '..', '..', 'js', 'engine-data.js')));

const results = [];
const record = (name, ok, detail) => { results.push({ name, ok, detail }); return ok; };

// ---- 1-4. the content checkers -------------------------------------------------------------
// guide-example-check joined on 2026-08-18. The three above verify PRICES against the engine; none of
// them noticed that three worked examples stopped adding up when the class unlock moved 7 -> 8, because
// example arithmetic is a layer above the prices it is built from.
for (const [name, script] of [
  ['feature prices  ', 'guide-price-check.mjs'],
  ['spell economy   ', 'guide-spell-check.mjs'],
  ['subclass bundles', 'guide-bundle-check.mjs'],
  ['worked examples ', 'guide-example-check.mjs'],
]) {
  let out = '', ok = true;
  try { out = execFileSync('node', [join(HERE, script), guide], { encoding: 'utf-8' }); }
  catch (e) { ok = false; out = (e.stdout || '') + (e.stderr || ''); }
  const summary = out.trim().split('\n').filter(l => /^summary:/.test(l)).pop()
                || out.trim().split('\n').pop() || '(no output)';
  record(name, ok, summary.replace(/^summary:\s*/, ''));
}

// ---- 4. structural sanity — no checker above would notice a broken table --------------------
const html = readFileSync(guide, 'utf-8');
const count = re => (html.match(re) || []).length;
const pairs = [['<table', '</table>'], ['<tr', '</tr>'], ['<td', '</td>'], ['<h2', '</h2>'], ['<h3', '</h3>']];
const unbalanced = pairs
  .map(([o, c]) => ({ o, n: count(new RegExp(o + '\\b', 'g')), m: count(new RegExp(c.replace('/', '\\/'), 'g')) }))
  .filter(x => x.n !== x.m);
record('html structure ', unbalanced.length === 0,
  unbalanced.length ? unbalanced.map(x => `${x.o} ${x.n} vs ${x.m}`).join(', ') : `balanced across ${pairs.length} tag pairs`);

// ---- 5. every nav link resolves to a real anchor --------------------------------------------
const anchors = new Set([...html.matchAll(/\sid=["']([^"']+)["']/g)].map(m => m[1]));
const dead = [...html.matchAll(/href=["']#([^"']+)["']/g)].map(m => m[1]).filter(a => !anchors.has(a));
record('nav anchors    ', dead.length === 0,
  dead.length ? `${dead.length} dead link(s): ${[...new Set(dead)].slice(0, 4).join(', ')}` : `all resolve (${anchors.size} anchors)`);

// ---- 6. embedded artwork ---------------------------------------------------------------------
// Added after a real loss: a sync that made the served copy byte-identical to the pact-guide master
// silently deleted NINE chapter illustrations, because the master carries one JPEG cover where this
// repo carries ten optimised WebPs. Prose grew in the same change, so the 324 KB drop read as the
// compaction the sync was expected to produce. Nothing above notices — prices, structure and anchors
// were all still perfect. This is deliberately a fixed inventory, not a count: it must be edited on
// purpose, so an image can never leave the guide as a side effect of something else.
const EXPECTED_ART = [
  'PACT cover banner', 'The Unwritten Future', 'Growth Through Choice', 'Lessons Learned',
  'Coin Into Capability', 'Echoes of the Past', 'Many Roads', 'Shaping Possibility',
  'Every Choice Has Weight', 'The Ever-Unwritten Future',
];
const artAlts = [...html.matchAll(/<img[^>]*\balt=["']([^"']*)["']/g)].map(m => m[1]);
const missingArt = EXPECTED_ART.filter(a => !artAlts.includes(a));
const strayArt = artAlts.filter(a => !EXPECTED_ART.includes(a));
const nonWebp = [...html.matchAll(/<img[^>]*src=["']data:(image\/[a-z]+)/g)].map(m => m[1]).filter(t => t !== 'image/webp');
record('embedded art   ', missingArt.length === 0 && strayArt.length === 0 && nonWebp.length === 0,
  missingArt.length ? `MISSING: ${missingArt.join(', ')}`
  : strayArt.length ? `unexpected: ${strayArt.join(', ')} — update EXPECTED_ART if deliberate`
  : nonWebp.length ? `${nonWebp.length} image(s) not WebP: ${[...new Set(nonWebp)].join(', ')}`
  : `all ${EXPECTED_ART.length} present, all WebP`);

// ---- 7. theming ------------------------------------------------------------------------------
// Lost in the same sync that took the artwork, and for the same reason: the pact-guide master carries
// a single hardcoded Parchment palette, so syncing to it flattened every custom property and deleted
// the pre-paint script. The guide is the only page in the app that reads the theme index.html writes,
// so losing it made the guide silently ignore the user's choice — including their dark mode.
//
// The check is threefold because each part failed independently: the script must be present, every
// theme must define the FULL variable set (a partial override leaks Parchment colours into Midnight),
// and no variable may be self-referential — the pre-sync :root had nine `--bg:var(--bg)` declarations,
// which are cyclic and therefore invalid, so restoring it verbatim would have shipped a broken default.
const style = (html.match(/<style>[\s\S]*?<\/style>/) || [''])[0];
const themeBlocks = [...style.matchAll(/\[data-theme="([a-z]+)"\]\s*\{([\s\S]*?)\}/g)];
const rootKeys = new Set([...((style.match(/:root\s*\{[\s\S]*?\}/) || [''])[0])
  .matchAll(/(--[a-z-]+)\s*:/g)].map(m => m[1]));
const cyclic = [...style.matchAll(/(--[a-z-]+)\s*:\s*var\(\1\)/g)].map(m => m[1]);
const partial = themeBlocks
  .map(b => ({ name: b[1], keys: new Set([...b[2].matchAll(/(--[a-z-]+)\s*:/g)].map(m => m[1])) }))
  .filter(t => [...rootKeys].some(k => !t.keys.has(k)))
  .map(t => t.name);
// Resolve against :root ONLY, not the union of every block. A variable declared solely inside a
// [data-theme] block is undefined in the default Parchment theme — which is precisely the failure a
// union check waves through, since the theme blocks would still "declare" it.
const danglingVars = [...new Set([...html.matchAll(/var\((--[a-z-]+)\)/g)].map(m => m[1]))]
  .filter(v => !rootKeys.has(v));
const EXPECTED_THEMES = ['midnight', 'dragonfire', 'contrast'];
const missingThemes = EXPECTED_THEMES.filter(t => !themeBlocks.some(b => b[1] === t));
record('theming        ',
  html.includes('pact-theme') && html.includes('prefers-color-scheme')
    && !missingThemes.length && !cyclic.length && !partial.length && !danglingVars.length,
  !html.includes('pact-theme') ? 'pre-paint theme script MISSING — the guide will ignore the app theme'
  : !html.includes('prefers-color-scheme') ? 'no prefers-color-scheme fallback'
  : missingThemes.length ? `theme(s) MISSING: ${missingThemes.join(', ')}`
  : cyclic.length ? `self-referential (cyclic, invalid): ${cyclic.join(' ')}`
  : partial.length ? `incomplete override, will leak Parchment: ${partial.join(', ')}`
  : danglingVars.length ? `undefined var(): ${danglingVars.join(' ')}`
  : `script + ${themeBlocks.length} themes, all ${rootKeys.size} vars covered, 0 dangling`);

// ---- 7b. drawback text: the guide and DATA.drawbackFx must say the same thing ------------------
// Added once the two sides actually agreed — a gate that is red on arrival is not a gate. Two failures
// it exists to catch, both real on 2026-08-19:
//   * the guide and the tools describing the same drawback differently (three did, on whether a stat
//     cap was a hard requirement or a DM-enforced advisory);
//   * a capped drawback whose description never mentions its cap (seven did) — which became a hard
//     block the moment the tools started enforcing caps, i.e. a wall with no sign on it.
// DECODE ENTITIES BEFORE COMPARING. The first version of this comparison reported ten mismatches, seven
// of which were `&#x27;` vs `'` on descriptions that were otherwise identical. And compare the WHOLE
// cell, not `includes()` — five cells had extra text appended that a substring test waved through.
{
  const dec = t => t.replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');
  const H = dec(html);
  const fx = DATA.drawbackFx || {}, caps = DATA.drawbackMaxStats || {};
  const differs = [], undocumented = [];
  for (const [name, text] of Object.entries(fx)) {
    if (!text) continue;
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = H.match(new RegExp('<td[^>]*>' + esc + '</td>\\s*<td[^>]*>([\\s\\S]*?)</td>'));
    if (!m) continue;                                   // no row of its own (the Afflictions share one)
    if (m[1].replace(/<[^>]+>/g, '').trim() !== text.trim()) differs.push(name);
  }
  for (const d of Object.keys(caps)) if (!/cap:/i.test(fx[d] || '')) undocumented.push(d);
  record('drawback text', !differs.length && !undocumented.length,
    differs.length || undocumented.length
      ? `${differs.length} differ from the guide [${differs.join(', ')}] · ${undocumented.length} capped but undocumented [${undocumented.join(', ')}]`
      : `${Object.keys(fx).length} descriptions agree with the guide · all ${Object.keys(caps).length} stat caps documented`);
}

// ---- 8. version markers ---------------------------------------------------------------------
const cv = (html.match(/content-version:\s*(v[\d.]+)/) || [])[1];
const dr = (html.match(/documents-rules:\s*version=(v[\d.]+)/) || [])[1];
// The markers must also be VISIBLE. They lived only in these head comments and the <title>, so a reader
// could not see either version — reported 2026-08-19. #guideVer renders both, labelled, reading these
// same comments at runtime so the block and the markers cannot disagree.
const visible = /id='guideVer'|id="guideVer"/.test(html) && /content-version/.test(html) && /documents-rules/.test(html);
record('version markers', !!cv && visible,
  `content-version ${cv || 'ABSENT'} · documents-rules ${dr || 'not stamped'} · engine DATA.version ${DATA.version}`
  + (visible ? ' · shown on-page' : '  ← #guideVer block MISSING, reader cannot see either version')
  + (dr && dr !== DATA.version ? `  ← stamped against an older engine` : ''));

// ---- report -----------------------------------------------------------------------------------
const w = Math.max(...results.map(r => r.name.length));
console.log(`verify-guide — ${guide}\n`);
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(w)}  ${r.detail}`);
const failed = results.filter(r => !r.ok);
console.log(`\n${failed.length ? `FAIL — ${failed.length} of ${results.length} checks failed` : `PASS — all ${results.length} checks passed`}`);
if (!failed.length) console.log(
  `\nThis proves the guide agrees with the engine. It does NOT prove the guide is newer than\n` +
  `pact-guide's master — diff against the master before overwriting it.`);
process.exit(failed.length ? 1 : 0);
