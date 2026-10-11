#!/usr/bin/env node
/**
 * PACT — a character's STORED size matches its real size (fix/stored-size, D-GH-2026-10-11-stored-size).
 *
 * WHY THIS EXISTS. CharGen hides its size dropdown when size isn't a choice and parks it at "Small"; saving read that hidden
 * value, so 23 of 37 live characters stored size "Small" while the engine (which ignores a non-choosable stored size) said
 * Medium. Anything reading the raw database got it wrong. The rule now lives in js/engine.js sizeOf(), and CharGen stores
 * sizeOf().size unless the size is a choice.
 *
 * USAGE:  node testing/scripts/stored-size-ci.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const E = await import(path.join(REPO, 'js/engine.js'));
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

console.log('\n[stored-size] == engine ==');
// Written out independently of the code: who is Small, who chooses, who is Medium.
const cases = [
  ['Human', '(none)', 'Small', 'Medium', false], ['Human', 'Goliath', 'Small', 'Medium', false], ['Goliath', '(none)', undefined, 'Medium', false],
  ['Halfling', '(none)', 'Medium', 'Small', false], ['Gnome', 'Halfling', 'Medium', 'Small', false],
  ['Gnome', 'Human', 'Medium', 'Medium', true], ['Gnome', 'Human', 'Small', 'Small', true], ['Halfling', 'Elf', undefined, 'Small', true],
  ['Tiefling', '(none)', 'Small', 'Small', true], ['Tiefling', '(none)', undefined, 'Medium', true],
];
for (const [sp, sp2, stored, want, ch] of cases) {
  const b = Object.assign(E.baseBuild(), { species: sp, species2: sp2, size: stored });
  const s = E.sizeOf(b), c = E.compute(b);
  check(`${sp}${sp2 !== '(none)' ? '+' + sp2 : ''} stored ${stored}: ${want}${ch ? ' (a choice)' : ''}`,
    s.size === want && s.choosable === ch && c.size === want && c.sizeChoosable === ch, JSON.stringify(s));
}

console.log('\n[stored-size] == CharGen stores the real size ==');
const { launchChromium } = await import('./lib/launch-chromium.mjs');
const PORT = 7982;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/PACT\/?/, '') || 'index.html';
  fs.readFile(path.join(REPO, rel), (e, d) => {
    if (e) { r.writeHead(404); return r.end('not found'); }
    r.writeHead(200, { 'Content-Type': MIME[path.extname(rel)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    r.end(d);
  });
});
await new Promise(r => server.listen(PORT, r));
const browser = await launchChromium();
try {
  const p = await (await browser.newContext()).newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(`http://localhost:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.DATA && window.sizeOf && typeof readBuild === 'function', null, { timeout: 30000 });
  const set = async (id, v) => { await p.evaluate(([id, v]) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]); await p.waitForTimeout(300); };
  // What lands in the LOG, not just readBuild(): the last stored size across every patch event.
  const stored = () => p.evaluate(() => { let s; for (const e of LOG) { const pt = e && e.payload && e.payload.patch; if (pt && 'size' in pt) s = pt.size; } return { build: readBuild().size, log: s, hidden: document.getElementById('charsize').style.display === 'none' }; });
  await set('spec', 'Human'); await set('spec2', '(none)');
  let s = await stored();
  check('a Human stores Medium (the dropdown is hidden and parked at Small)', s.build === 'Medium' && s.log === 'Medium' && s.hidden, JSON.stringify(s));
  await set('spec', 'Halfling'); s = await stored();
  check('a Halfling stores Small', s.build === 'Small' && s.log === 'Small', JSON.stringify(s));
  await set('spec', 'Human'); await set('spec2', 'Gnome'); await set('charsize', 'Medium'); s = await stored();
  check('a Human+Gnome (a choice) stores the chosen Medium', s.build === 'Medium' && s.log === 'Medium' && !s.hidden, JSON.stringify(s));
  await set('charsize', 'Small'); s = await stored();
  check('...and the chosen Small', s.build === 'Small' && s.log === 'Small', JSON.stringify(s));
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
} finally {
  await browser.close(); server.close();
}
console.log(`\n${fail ? '✗' : '✓'} ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
