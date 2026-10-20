/* PACT — Bard: Magical Secrets as a list-widening, in both tools' known-spell pools.
 *
 * feat/magical-secrets-list-widening (owner decision BO1, v0.384). From 10 HD a Bard who owns the feature may name Bard-discipline
 * spells from the Bard, Cleric, Druid and Wizard lists. Both tools build that pool in their own eligibleSpells(b, ti, di); this drives
 * it with a hand-made build and checks a Cleric-only leveled spell is offered with the feature at 10 HD and not otherwise, that a
 * cantrip is never widened, and that a Wizard discipline is untouched.
 *
 *   node testing/scripts/magical-secrets-widening-e2e.mjs
 *
 * No Supabase, no sign-in: the tools are loaded as-is and the pure function is called on a synthetic build.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = Number(process.env.PACT_E2E_PORT) || 7963;
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

const browser = await launchChromium();
const TOOLS = [['live', 'PACT-Live-Char-Sheet.html'], ['chargen', 'PACT-CharGen-Webtool.html']];

for (const [label, file] of TOOLS) {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e))); page.on('dialog', d => d.accept());
  await page.goto(`http://localhost:${PORT}/PACT/tools/${file}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.widenedLists && typeof window.eligibleSpells === 'function', { timeout: 25000 });
  const r = await page.evaluate(() => {
    const MS = 'Bard: Magical Secrets', S = DATA.spells;
    // a leveled spell only on the Cleric list (not Bard), one only on the Wizard list, and a Cleric-only cantrip
    const clericOnly = S.find(s => s.l > 0 && s.l <= 3 && s.c.indexOf('Cleric') >= 0 && s.c.indexOf('Bard') < 0);
    const wizardOnly = S.find(s => s.l > 0 && s.l <= 3 && s.c.indexOf('Wizard') >= 0 && s.c.indexOf('Bard') < 0 && s.c.indexOf('Cleric') < 0);
    const clericCantrip = S.find(s => s.l === 0 && s.c.indexOf('Cleric') >= 0 && s.c.indexOf('Bard') < 0);
    const mk = (cls, hd, features) => ({ hd, features, subSpellBundles: [], traditions: [{ rank: 3, disciplines: [{ name: cls }] }] });
    const has = (el, nm) => !!el && Object.keys(el.byLevel).some(L => el.byLevel[L].some(x => x.name === nm));
    const flagged = (el, nm) => { for (const L of Object.keys(el.byLevel)) { const x = el.byLevel[L].find(y => y.name === nm); if (x) return !!x.widened; } return null; };
    const base = eligibleSpells(mk('Bard', 12, []), 0, 0), wide = eligibleSpells(mk('Bard', 12, [MS]), 0, 0), low = eligibleSpells(mk('Bard', 9, [MS]), 0, 0);
    const wiz = eligibleSpells(mk('Wizard', 12, [MS]), 0, 0);
    return { cler: clericOnly && clericOnly.n, wiz: wizardOnly && wizardOnly.n, cant: clericCantrip && clericCantrip.n,
      baseHasCleric: has(base, clericOnly.n), wideHasCleric: has(wide, clericOnly.n), wideHasWizard: has(wide, wizardOnly.n),
      lowHasCleric: has(low, clericOnly.n), wideHasCantrip: has(wide, clericCantrip.n), flag: flagged(wide, clericOnly.n),
      wizHasCleric: has(wiz, clericOnly.n) };
  });
  check(`${label}: test fixtures found (${r.cler} / ${r.wiz} / ${r.cant})`, !!(r.cler && r.wiz && r.cant));
  check(`${label}: a Bard without the feature cannot list a Cleric-only spell`, r.baseHasCleric === false);
  check(`${label}: a Bard with Magical Secrets at 10+ HD can list a Cleric-only spell`, r.wideHasCleric === true);
  check(`${label}: and a Wizard-only spell`, r.wideHasWizard === true);
  check(`${label}: the widened spell is flagged widened`, r.flag === true);
  check(`${label}: at 9 HD the pool is not widened`, r.lowHasCleric === false);
  check(`${label}: a cantrip is never widened`, r.wideHasCantrip === false);
  check(`${label}: a Wizard discipline is not changed by the Bard feature`, r.wizHasCleric === false);
  check(`${label}: no page error`, errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await browser.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
