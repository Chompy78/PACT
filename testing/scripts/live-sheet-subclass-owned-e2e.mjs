/* PACT — Live Sheet: a subclass ability held through ONE door shows as owned in BOTH pickers.
 *
 * feat/subclass-double-purchase-guard (owner decision P3, 2026-10-05). All 192 subclass abilities are sold twice: in the
 * "Subclasses & abilities" list (b.subAbilities) and, mirrored, in the class-feature lists (b.features). Each list used to
 * test ownership against its OWN collection only, so a Rogue who already held Psionic Power / Psychic Blades through the
 * subclass list was still offered it as a plain 8 AP class feature a few sections further down — and bought it (Anders
 * Pipeleaf, 8 AP + 7 AP, found 2026-10-05). The pure-Node gate (subclass-double-purchase-ci.mjs) pins the engine; this one
 * proves the PAGE uses the shared check (ownsAbility) in every list that can sell the ability.
 *
 * No Supabase, no sign-in: the character is seeded straight into localStorage, as live-sheet-unlock-e2e.mjs does.
 *
 *   node testing/scripts/live-sheet-subclass-owned-e2e.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = 7997;   // distinct from cloud-e2e 7970 / seed 7971 / dm-console-ui 7973 / chargen-flows 7979 / protected-roundtrip 7991 / live-sheet-unlock 7992 / dm-console-unlock 7994 / wounds-ui 7995 / 7996
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

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

const S = 'Rogue|Soulknife|Psionic Power / Psychic Blades';
const F = 'Rogue: Psionic Power / Psychic Blades';
const LOGBASE = [
  { type: 'award', amount: 200, seq: 1, label: 'Award — budget (200 AP)' },
  { type: 'buy', cat: 'oclass', payload: { v: 'Rogue' }, cost: 0, level: 1, seq: 2, label: 'Origin class — Rogue' },
  { type: 'buy', cat: 'patch', payload: { patch: { hd: 10 } }, cost: 0, level: 10, seq: 3, label: 'Hit Dice → 10' },   // Soul Blades (T5) needs 9 HD
  { type: 'buy', cat: 'patch', payload: { patch: { freeSub: { Rogue: 'Soulknife' } } }, cost: 0, level: 6, seq: 4, label: 'Subclasses · 0 AP' },
];
const viaSub = [...LOGBASE, { type: 'buy', cat: 'subabil', payload: { v: S }, cost: 8, level: 6, seq: 5, label: 'Subclass ability — ' + S }];
const viaFeat = [...LOGBASE, { type: 'buy', cat: 'feature', payload: { v: F }, cost: 8, level: 6, seq: 5, label: 'Class feature — ' + F }];

async function open(browser, LOG) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('dialog', d => d.accept());
  await page.addInitScript((env) => { try { localStorage.setItem('pactLiveSheet', JSON.stringify(env)); } catch (e) {} },
    { schema: 'pact-character/1', LOG, SEQ: LOG.length + 1 });
  await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' });
  // Wait on the condition, never a bare sleep — the bridge lands on engine-ready, after the deferred module.
  await page.waitForFunction(() => window.DATA && window._engineFold && typeof window.ownsAbility === 'function'
    && document.getElementById('buy') && document.getElementById('buy').innerHTML.length > 200, { timeout: 25000 });
  // The buy panel renders each section lazily: only a category/group that is OPEN has a body. Open the two that can sell the
  // ability — "Rogue features" (the mirrored class-feature list) and "Subclasses & abilities" — then re-render.
  await page.evaluate(() => { catOpen['Class & subclass'] = 1; grpOpen['Rogue features'] = true; grpOpen['Subclasses & abilities'] = true; refreshBuy(); });
  await page.waitForFunction(() => [...document.querySelectorAll('#buy h4')].some(h => /Subclasses & abilities/.test(h.textContent))
    && document.querySelectorAll('#buy button.ib').length > 40, { timeout: 15000 });
  return { page, errs, close: () => ctx.close() };
}
// Every buy-panel tile for this ability: the class-feature tile reads "Psionic Power / Psychic Blades · T3", the subclass
// tile reads "Soulknife: Psionic Power / Psychic Blades · T3 At-Will". Owned tiles are the greyed `.ib.dis` ones.
const tiles = (page) => page.evaluate(() =>
  [...document.querySelectorAll('#buy button.ib')]
    .filter(b => /Psionic Power \/ Psychic Blades/.test(b.textContent))
    .map(b => ({ text: b.textContent.trim().slice(0, 70), owned: /✓/.test(b.textContent) })));

const browser = await launchChromium();

console.log('Case 1 — held through the SUBCLASS door');
{
  const { page, errs, close } = await open(browser, viaSub);
  const t = await tiles(page);
  check('the page exposes the engine\'s ownsAbility()', await page.evaluate(() => typeof window.ownsAbility === 'function'));
  check('the ability is offered in BOTH lists (class features + subclass abilities)', t.length >= 2, JSON.stringify(t));
  check('...and EVERY tile for it is greyed as owned — none is buyable again', t.length >= 2 && t.every(x => x.owned), JSON.stringify(t));
  check('no page errors', errs.length === 0, errs.join(' | '));
  await close();
}

console.log('Case 2 — held through the FEATURE door');
{
  const { page, errs, close } = await open(browser, viaFeat);
  const t = await tiles(page);
  check('the ability is offered in BOTH lists', t.length >= 2, JSON.stringify(t));
  check('...and EVERY tile for it is greyed as owned — none is buyable again', t.length >= 2 && t.every(x => x.owned), JSON.stringify(t));
  check('no page errors', errs.length === 0, errs.join(' | '));
  await close();
}

console.log('Case 3 — control: owned through neither door');
{
  const { page, errs, close } = await open(browser, LOGBASE);
  const t = await tiles(page);
  check('the ability is offered in both lists', t.length >= 2, JSON.stringify(t));
  check('...and NO tile is greyed (the guard must not over-fire)', t.length >= 2 && t.every(x => !x.owned), JSON.stringify(t));
  check('no page errors', errs.length === 0, errs.join(' | '));
  await close();
}

console.log('Case 4 — a DIFFERENT Soulknife ability stays buyable');
{
  const { page, errs, close } = await open(browser, viaSub);
  const t = await page.evaluate(() => [...document.querySelectorAll('#buy button.ib')]
    .filter(b => /Soul Blades/.test(b.textContent)).map(b => ({ text: b.textContent.trim().slice(0, 60), owned: /✓/.test(b.textContent) })));
  check('Soul Blades is offered', t.length >= 1, JSON.stringify(t));
  check('...and is NOT greyed as owned', t.length >= 1 && t.every(x => !x.owned), JSON.stringify(t));
  check('no page errors', errs.length === 0, errs.join(' | '));
  await close();
}

await browser.close();
server.close();
console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} passed / ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
