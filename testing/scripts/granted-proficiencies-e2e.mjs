/* PACT — weapon and armour proficiency a feature already grants (Warden), shown in both tools without being written to the build.
 *
 * ui/show-granted-proficiencies. profGrants() makes Druid Warden / Cleric Protector (and the legacy Primal Order) switch weapon and armour
 * proficiency on at compute time. CharGen reads its tick boxes back as the build (_domReadBuildRaw), so a granted flag drawn as a TICKED
 * box would be saved as a purchase and could refund AP. So the boxes keep showing only what was bought, and a "From Warden" note names
 * the rest. The Live Sheet shows the granted buy buttons as owned. Neither tool may put a granted flag into the build or the log.
 *
 *   node testing/scripts/granted-proficiencies-e2e.mjs
 *
 * No Supabase, no sign-in: the Live Sheet character is seeded into localStorage; CharGen is loaded through its own envelope loader.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = Number(process.env.PACT_E2E_PORT) || 7962;
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

const W = 'Druid: Primal Order (Warden)';
const buy = (n, cat, v, cost) => ({ type: 'buy', cat, payload: { v }, cost, level: 1, seq: n, label: (cat === 'feature' ? 'Class feature — ' : '') + v });
const WARDEN = [
  { type: 'award', amount: 300, seq: 1, label: 'Award — budget (300 AP)' },
  buy(2, 'oclass', 'Druid', 0),
  buy(3, 'feature', W, 0),
];
const PLAIN = WARDEN.slice(0, 2);
const env = (LOG) => ({ schema: 'pact-character/1', rules: 'v0', name: 'Granted Prof Test', LOG, SEQ: LOG.length + 1 });
const GRANTED_WEAPONS = ['simple', 'allMartial'], GRANTED_ARMOUR = ['light', 'medium'];   // Warden: Protector adds Heavy, Shield is never granted

const browser = await launchChromium();

async function chargenCase(label, LOG, granted) {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e))); page.on('dialog', d => d.accept());
  await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && typeof window._cgApplyEnvelope === 'function' && typeof window.readBuild === 'function', { timeout: 25000 });
  await page.evaluate((e) => window._cgApplyEnvelope(e, {}), env(LOG));
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const vis = id => { const el = document.getElementById(id); return el && el.style.display !== 'none' ? el.textContent : ''; };
    const b = window.readBuild();
    return {
      wp: vis('wpGrant'), arm: vis('armGrant'),
      boxes: ['wp_simple', 'wp_all', 'a_light', 'a_med', 'a_heavy'].map(id => document.getElementById(id).checked),
      weaponProf: b.weaponProf || {}, armour: b.armour || {},
    };
  });
  if (granted) {
    check(`chargen ${label}: weapon note names Warden, Simple and martial`, /Warden/.test(r.wp) && /Simple weapons/.test(r.wp) && /martial/i.test(r.wp), r.wp);
    check(`chargen ${label}: armour note names Warden, Light and Medium (not Heavy)`, /Warden/.test(r.arm) && /Light/.test(r.arm) && /Medium/.test(r.arm) && !/Heavy/.test(r.arm), r.arm);
    check(`chargen ${label}: the boxes still show only what was bought (none ticked)`, r.boxes.every(x => !x), JSON.stringify(r.boxes));
    check(`chargen ${label}: no granted flag is read back as the build`,
      !GRANTED_WEAPONS.some(k => r.weaponProf[k]) && !GRANTED_ARMOUR.some(k => r.armour[k]), JSON.stringify([r.weaponProf, r.armour]));
  } else {
    check(`chargen ${label}: no note without a granting feature`, r.wp === '' && r.arm === '', JSON.stringify([r.wp, r.arm]));
  }
  check(`chargen ${label}: no page error`, errs.length === 0, errs.join(' | '));
  await ctx.close();
}

async function liveCase(label, LOG, granted) {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e))); page.on('dialog', d => d.accept());
  await page.addInitScript((e) => { try { localStorage.setItem('pactLiveSheet', JSON.stringify(e)); } catch (x) {} }, env(LOG));
  await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window._engineFold && document.getElementById('buy') && document.getElementById('buy').innerHTML.length > 200, { timeout: 25000 });
  const r = await page.evaluate(() => {
    // The buy groups only draw when open or searched, so search for each label in turn.
    const info = t => { window.setBuyQuery(t.toLowerCase()); const x = [...document.querySelectorAll('#buy button.ib')].find(y => y.textContent.indexOf(t) === 0);
      return x ? { dis: x.classList.contains('dis'), text: x.textContent } : null; };
    const b = window.foldBuild(null);
    return {
      simple: info('Simple weapons'), martial: info('All martial'), light: info('Light armour'), medium: info('Medium armour'), heavy: info('Heavy armour'), shield: info('Shield'),
      weaponProf: b.weaponProf || {}, armour: b.armour || {},
    };
  });
  if (granted) {
    for (const k of ['simple', 'martial', 'light', 'medium']) {
      check(`live ${label}: ${k} shows as owned "from Primal Order (Warden)"`, !!(r[k] && r[k].dis && /from Primal Order \(Warden\)/.test(r[k].text)), JSON.stringify(r[k]));
    }
    check(`live ${label}: Heavy and Shield (not granted by Warden) stay buy buttons`, !!(r.heavy && !r.heavy.dis && r.shield && !r.shield.dis), JSON.stringify([r.heavy, r.shield]));
    check(`live ${label}: Heavy no longer says it needs Medium first (Warden grants Medium) and costs only its own 6 AP`,
      !!(r.heavy && !/needs/.test(r.heavy.text) && /Heavy armour 6/.test(r.heavy.text)), JSON.stringify(r.heavy));
    check(`live ${label}: nothing granted is in the folded build`,
      !GRANTED_WEAPONS.some(k => r.weaponProf[k]) && !GRANTED_ARMOUR.some(k => r.armour[k]), JSON.stringify([r.weaponProf, r.armour]));
  } else {
    check(`live ${label}: Simple weapons and Light armour stay buy buttons`, !!(r.simple && !r.simple.dis && r.light && !r.light.dis), JSON.stringify([r.simple, r.light]));
  }
  check(`live ${label}: no page error`, errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await chargenCase('Warden', WARDEN, true);
await chargenCase('no feature', PLAIN, false);
await liveCase('Warden', WARDEN, true);
await liveCase('no feature', PLAIN, false);

await browser.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
