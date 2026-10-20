/* PACT — the ✎ Name spells & languages dialog: its rows, in both tools.
 *
 * refactor/names-slot-helper (PR 1 of docs/plans/2026-10-15-names-before-spending.md). Two jobs:
 *
 *   node testing/scripts/names-dialog-e2e.mjs --snapshot out.json
 *       Open the dialog in CharGen and the Live Sheet for a fixed set of seeded characters and write the dialog body
 *       (#namesBox innerHTML, datalists included) to out.json. Run it BEFORE and AFTER a change to openNames(): the
 *       two files must be byte-identical — that is the proof a refactor changed no behaviour.
 *
 *   node testing/scripts/names-dialog-e2e.mjs
 *       Assert that the dialog's language/spell rows are exactly the engine's allNameableSlots() — same keys, same
 *       order, same current names — in both tools, so the dialog and any gate built on the helper cannot disagree.
 *
 * No Supabase, no sign-in: the Live Sheet character is seeded into localStorage; CharGen is loaded through its own
 * envelope loader.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = Number(process.env.PACT_E2E_PORT) || 7998;
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json',
               '.css':'text/css','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml' };
const server = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/PACT\/?/, '') || 'index.html';
  fs.readFile(path.join(REPO, rel), (e, d) => {
    if (e) { r.writeHead(404); return r.end('not found'); }
    r.writeHead(200, { 'Content-Type': MIME[path.extname(rel)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    r.end(d);
  });
});
await new Promise(r => server.listen(PORT, r));

const snapIdx = process.argv.indexOf('--snapshot');
const SNAP = snapIdx > 0 ? process.argv[snapIdx + 1] : null;

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

// A Warlock + Wizard character with every language/spell slot kind owned, some named and some blank.
const patch = (n, p) => ({ type: 'buy', cat: 'patch', payload: { patch: p }, cost: 0, level: 1, seq: n, label: 'Patch' });
const FULL = [
  { type: 'award', amount: 400, seq: 1, label: 'Award — budget (400 AP)' },
  { type: 'buy', cat: 'oclass', payload: { v: 'Warlock' }, cost: 0, level: 1, seq: 2, label: 'Origin class — Warlock' },
  patch(3, { hd: 12 }),
  patch(4, { languages: 3, languageNames: ['Common', ''], dabblerCantrips: 2, dabblerCantripNames: ['Light', ''],
    innate: [2, 1, 0, 0, 0, 0, 0, 0, 0], innateNames: [['Bless', ''], ['Misty Step']],
    traditions: [{ name: 'Arcane', rank: 9, disciplines: [
      { name: 'Warlock', cantrips: 3, cantripNames: ['Eldritch Blast', ''], known: [2, 2, 1, 1, 1, 0, 0, 0, 0],
        knownNames: [['Hex', ''], [], ['Fireball']], arcanum: [1, 1, 1, 0], arcanumNames: [['Mass Suggestion'], [''], []] },
      { name: 'Wizard', cantrips: 1, cantripNames: [''], known: [1, 0, 0, 0, 0, 0, 0, 0, 0], knownNames: [['']] },
    ] }] }),
];
const MINIMAL = [
  { type: 'award', amount: 100, seq: 1, label: 'Award — budget (100 AP)' },
  { type: 'buy', cat: 'oclass', payload: { v: 'Fighter' }, cost: 0, level: 1, seq: 2, label: 'Origin class — Fighter' },
];
const SEEDS = { full: FULL, minimal: MINIMAL };

const browser = await launchChromium();
const out = {};
const M1_PREFIX = /^(lang|dab|inn|tr)::/;
const rowsOf = (html) => [...html.matchAll(/data-k="([^"]+)"/g)].map(m => m[1]);

for (const [seedName, LOG] of Object.entries(SEEDS)) {
  const env = { schema: 'pact-character/1', rules: 'v0', name: 'Names Test', LOG, SEQ: LOG.length + 1 };

  // ---- Live Sheet ----
  {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(String(e))); page.on('dialog', d => d.accept());
    await page.addInitScript((e) => { try { localStorage.setItem('pactLiveSheet', JSON.stringify(e)); } catch (x) {} }, env);
    await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.DATA && window._engineFold && typeof window.openNames === 'function'
      && document.getElementById('buy') && document.getElementById('buy').innerHTML.length > 200, { timeout: 25000 });
    const r = await page.evaluate(async () => {
      window.openNames();
      const box = document.getElementById('namesBox');
      const helper = (typeof window.allNameableSlots === 'function') ? window.allNameableSlots(window.foldBuild(null)) : null;
      return { html: box ? box.innerHTML : null, helper: helper ? helper.map(s => ({ key: s.key, name: s.name })) : null };
    });
    out[`live:${seedName}`] = r.html;
    check(`live ${seedName}: dialog opened`, !!r.html && errs.length === 0, errs.join(' | '));
    if (!SNAP) liveCompare('live ' + seedName, r);
  }

  // ---- CharGen ----
  {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(String(e))); page.on('dialog', d => d.accept());
    await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.DATA && typeof window._cgApplyEnvelope === 'function' && typeof window.openNames === 'function', { timeout: 25000 });
    const r = await page.evaluate(async (e) => {
      window._cgApplyEnvelope(e, {});
      window.openNames();
      const box = document.getElementById('namesBox');
      const helper = (typeof window.allNameableSlots === 'function') ? window.allNameableSlots(window.readBuild()) : null;
      return { html: box ? box.innerHTML : null, helper: helper ? helper.map(s => ({ key: s.key, name: s.name })) : null };
    }, env);
    out[`chargen:${seedName}`] = r.html;
    check(`chargen ${seedName}: dialog opened`, !!r.html && errs.length === 0, errs.join(' | '));
    if (!SNAP) chargenCompare('chargen ' + seedName, r);
  }
}
await browser.close(); server.close();

// The M1 kinds: languages and spells. The other rows in the Live Sheet dialog (fighting styles, Metamagic, maneuvers,
// choice-grant spells, epic-boon ability) are deliberately not part of the helper.
function rowCompare(label, r, skipArcanum) {
  if (!r.helper) { check(`${label}: allNameableSlots is exposed`, false, 'window.allNameableSlots missing'); return; }
  const domKeys = rowsOf(r.html).filter(k => M1_PREFIX.test(k));
  const helperKeys = r.helper.map(s => s.key).filter(k => !(skipArcanum && /^tr::\d+::\d+::a::/.test(k)));
  check(`${label}: dialog rows == helper slots (same keys, same order)`, JSON.stringify(domKeys) === JSON.stringify(helperKeys),
    `dialog ${domKeys.length}, helper ${helperKeys.length}`);
}
function liveCompare(label, r) { rowCompare(label, r, false); }
// CharGen's dialog has no Arcanum rows (board task feat/chargen-names-arcanum-rows), so they are excluded from its comparison.
function chargenCompare(label, r) { rowCompare(label, r, true); }

if (SNAP) { fs.writeFileSync(SNAP, JSON.stringify(out, null, 1)); console.log('snapshot written: ' + SNAP); }
else { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
