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

// ---- 1-3. the three content checkers -------------------------------------------------------
for (const [name, script] of [
  ['feature prices  ', 'guide-price-check.mjs'],
  ['spell economy   ', 'guide-spell-check.mjs'],
  ['subclass bundles', 'guide-bundle-check.mjs'],
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

// ---- 6. version markers ---------------------------------------------------------------------
const cv = (html.match(/content-version:\s*(v[\d.]+)/) || [])[1];
const dr = (html.match(/documents-rules:\s*version=(v[\d.]+)/) || [])[1];
record('version markers', !!cv,
  `content-version ${cv || 'ABSENT'} · documents-rules ${dr || 'not stamped'} · engine DATA.version ${DATA.version}`
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
