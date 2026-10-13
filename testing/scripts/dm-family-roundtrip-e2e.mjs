/* PACT — honest saves keep the DM family intact (feat/campaign-house-rules-server, M1).
 *
 * sql/migrations/2026-10-13-campaign-house-rules-server.sql adds trg_pact_dm_family_guard: on a campaign character, a
 * writer who is not that campaign's DM may not add, change, remove or reorder any event in the "DM family" — an event
 * with a truthy dmEdit, or one of the DM-only types (dmHouseRules, dmRefundBoon, dmRemoveDrawback, dmRepriceDrawback,
 * dmRemoveBoon, dmUnlockDrawback, sessionSeal). The Docker harness (run-house-rules.sh) proves the database refuses a
 * forgery and accepts hand-written honest saves. What it cannot see is whether the SHIPPED tools ever rewrite one of
 * those events when a player merely opens and saves a character — a tool that re-stamps, relabels, re-costs or drops a
 * DM event would make every honest save of that character refusable once the migration is applied.
 *
 * So: characters carrying EVERY family type (plus a creation draft with a DM-granted boon, which repriceDraft must not
 * re-cost — plan §6.5(a)) are loaded into the real Live Sheet and CharGen; each tool saves, the Live Sheet also buys off a
 * drawback and CharGen also makes a harmless edit; the saved family must equal the original exactly (jsonb equality:
 * key order ignored, everything else compared). The family projection below mirrors public.pact_dm_family().
 *
 *   node testing/scripts/dm-family-roundtrip-e2e.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
               '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/PACT\/?/, '') || 'index.html';
  fs.readFile(path.join(REPO, rel), (e, d) => {
    if (e) { r.writeHead(404); return r.end('not found'); }
    r.writeHead(200, { 'Content-Type': MIME[path.extname(rel)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    r.end(d);
  });
});
await new Promise(r => server.listen(Number(process.env.PACT_E2E_PORT) || 0, r));   // ephemeral by default: no clash with other gates
const base = `http://localhost:${server.address().port}/PACT`;

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

// ---- mirror of public.pact_dm_family() ----
const DM_TYPES = new Set(['dmHouseRules', 'dmRefundBoon', 'dmRemoveDrawback', 'dmRepriceDrawback', 'dmRemoveBoon', 'dmUnlockDrawback', 'sessionSeal']);
const truthy = v => !(v === undefined || v === null || v === false || v === 0 || v === '');
const family = log => (log || []).filter(e => e && typeof e === 'object' && !Array.isArray(e) && (truthy(e.dmEdit) || DM_TYPES.has(e.type)));
const canon = v => Array.isArray(v) ? v.map(canon) : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const firstDiff = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) if (!same(a[i], b[i])) return `#${i}: ${JSON.stringify(a[i]).slice(0, 140)} -> ${JSON.stringify(b[i]).slice(0, 140)}`; return ''; };

// ---- the characters ----
const CAMP = 'c1000000-0000-0000-0000-000000000001', DM = 'd0000000-0000-0000-0000-000000000001';
const dm = o => Object.assign({ dmEdit: true, dmId: DM }, o);
const LOCKED = [
  { seq: 1, ts: 1, type: 'award', amount: 79, note: 'Budget', noLock: true, label: 'Award — budget (79 AP)' },
  { seq: 2, ts: 2, type: 'buy', cat: 'oclass', payload: { v: 'Fighter' }, cost: 0, level: 1, label: 'Origin class — Fighter' },
  { seq: 3, ts: 3, type: 'buy', cat: 'drawback', payload: { v: 'Slow to Mend' }, cost: -5, level: 1, label: 'Drawback — Slow to Mend' },
  { seq: 4, ts: 4, type: 'buy', cat: 'drawback', payload: { v: 'Squeamish' }, cost: -3, level: 1, label: 'Drawback — Squeamish' },
  { seq: 5, ts: 5, type: 'buy', cat: 'boon', payload: { v: 'Bulwark' }, cost: 6, level: 1, label: 'Boon — Bulwark' },
  dm({ seq: 6, ts: 6, type: 'buy', cat: 'boon', payload: { v: 'Deft Catch' }, cost: 3, level: 1, label: 'Boon — Deft Catch (DM granted)' }),
  dm({ seq: 7, ts: 7, type: 'award', amount: 3, note: 'DM boon grant', label: 'Award — DM boon grant (3 AP)' }),
  dm({ seq: 8, ts: 8, type: 'buy', cat: 'drawback', payload: { v: 'Peg Leg' }, cost: 0, level: 1, dmLocked: true, dmRemovalCost: 'flat', label: 'Drawback — Peg Leg (DM imposed)' }),
  { seq: 9, ts: 9, type: 'creationLocked', label: 'Creation finished' },
  dm({ seq: 10, ts: 10, type: 'dmUnlockDrawback', refVal: 'Peg Leg', targetSeq: 8, note: 'the leg heals', label: 'DM unlocked — Peg Leg' }),
  dm({ seq: 11, ts: 11, type: 'dmHouseRules', campaignId: CAMP, overrides: { pins: { draws: { Squeamish: { ap: 3, reason: 'kept', at: '2026-10-13' } } } }, label: 'DM house rules for this character' }),
  dm({ seq: 12, ts: 12, type: 'dmRepriceDrawback', campaignId: CAMP, refVal: 'Slow to Mend', targetSeq: 3, amount: 2, from: 5, to: 7, label: 'DM repriced drawback — Slow to Mend 5 → 7 AP' }),
  dm({ seq: 13, ts: 13, type: 'dmRefundBoon', campaignId: CAMP, refVal: 'Bulwark', targetSeq: 5, cost: -6, label: 'DM refund — Bulwark (6 AP)' }),
  dm({ seq: 14, ts: 14, type: 'dmRemoveDrawback', campaignId: CAMP, refVal: 'Squeamish', targetSeq: 4, grantBack: 3, label: 'DM removed drawback — Squeamish (−3 AP)' }),
  dm({ seq: 15, ts: 15, type: 'sessionSeal', note: 'Session 1', sealedBy: DM, sealedRole: 'dm', label: 'Session 1' }),
  dm({ seq: 16, ts: 16, type: 'dmRemoveBoon', refVal: 'Deft Catch', label: 'DM removed — Deft Catch' }),
  { seq: 17, ts: 17, type: 'buy', cat: 'skill', payload: { v: 'Stealth' }, cost: 2, level: 1, label: 'Skill — Stealth' },
];
// A creation DRAFT in a campaign with a DM-granted boon and an override: repriceDraft must keep the DM buy's frozen cost.
const DRAFT = [
  { seq: 1, ts: 1, type: 'award', amount: 79, note: 'Budget', noLock: true, label: 'Award — budget (79 AP)' },
  { seq: 2, ts: 2, type: 'buy', cat: 'oclass', payload: { v: 'Fighter' }, cost: 0, level: 1, label: 'Origin class — Fighter' },
  { seq: 3, ts: 3, type: 'buy', cat: 'boon', payload: { v: 'Bulwark' }, cost: 6, level: 1, label: 'Boon — Bulwark' },
  dm({ seq: 4, ts: 4, type: 'buy', cat: 'boon', payload: { v: 'Deft Catch' }, cost: 1, level: 1, label: 'Boon — Deft Catch (DM granted)' }),
  dm({ seq: 5, ts: 5, type: 'award', amount: 1, note: 'DM boon grant', label: 'Award — DM boon grant (1 AP)' }),
  dm({ seq: 6, ts: 6, type: 'dmHouseRules', campaignId: CAMP, overrides: { boons: { Bulwark: { hd: 1, ap: 9 } } }, label: 'DM house rules for this character' }),
];
// A Live-Sheet-origin character ("Imported budget" first) with DM entries after the lock.
const IMPORTED = [
  { seq: 0, ts: 1, type: 'award', amount: 79, note: 'Imported budget', label: 'Starting creation budget (79 AP)', noLock: true },
].concat(LOCKED.slice(1));

const SUBJECTS = [
  { name: 'locked campaign character with every DM-family type', LOG: LOCKED, buyoff: 'Slow to Mend' },
  { name: 'creation draft with a DM-granted boon and an override', LOG: DRAFT },
  { name: 'Live-Sheet-origin (Imported budget) locked character', LOG: IMPORTED, buyoff: 'Peg Leg' },
];

const browser = await launchChromium();
try {
  for (const s of SUBJECTS) {
    console.log(s.name);
    const env = { schema: 'pact-character/1', name: 'Fam', LOG: s.LOG, SEQ: s.LOG.length + 2 };
    const fam0 = family(s.LOG);
    check('the fixture carries DM-family events', fam0.length >= 2, String(fam0.length));
    // ---- Live Sheet: load, save; then an honest in-play action (a buy-off) and save again ----
    {
      const ctx = await browser.newContext(); const p = await ctx.newPage(); const errs = [];
      p.on('pageerror', e => errs.push(String(e))); p.on('dialog', d => d.accept());
      await p.addInitScript(e => { try { localStorage.setItem('pactLiveSheet', e); } catch (x) {} }, JSON.stringify(env));
      await p.goto(`${base}/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' });
      await p.waitForFunction(() => window.DATA && window._engineFold && typeof window.save === 'function'
        && document.getElementById('ledger') && document.getElementById('ledger').innerHTML.length > 50, { timeout: 25000 });
      await p.evaluate(() => save());
      let out = await p.evaluate(() => JSON.parse(localStorage.getItem('pactLiveSheet') || 'null'));
      const f1 = family(out && out.LOG);
      check('Live Sheet load + save: DM family unchanged', same(fam0, f1), firstDiff(fam0, f1));
      if (s.buyoff) {
        const n0 = await p.evaluate(() => LOG.length);
        await p.evaluate(v => buyoffDrawback(v), s.buyoff);
        await p.evaluate(() => save());
        out = await p.evaluate(() => JSON.parse(localStorage.getItem('pactLiveSheet') || 'null'));
        const f2 = family(out && out.LOG);
        check(`Live Sheet buy-off of ${s.buyoff}: a buyoff was appended`, out && out.LOG.length === n0 + 1 && out.LOG[out.LOG.length - 1].type === 'buyoff',
          out ? `${n0} -> ${out.LOG.length}` : 'no envelope');
        check('Live Sheet buy-off + save: DM family unchanged', same(fam0, f2), firstDiff(fam0, f2));
      }
      check('Live Sheet: no page errors', errs.length === 0, errs.join(' | ').slice(0, 200));
      await ctx.close();
    }
    // ---- CharGen: load as a campaign-bound character, autosave; then a harmless edit and autosave again ----
    {
      const ctx = await browser.newContext(); const p = await ctx.newPage(); const errs = [];
      p.on('pageerror', e => errs.push(String(e))); p.on('dialog', d => d.accept());
      await p.goto(`${base}/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' });
      await p.waitForFunction(() => window.DATA && typeof window._cgApplyEnvelope === 'function' && typeof window._cgAutosave === 'function', { timeout: 25000 });
      await p.evaluate(() => { try { localStorage.clear(); } catch (e) {} window._cgCampaignId = 'c1000000-0000-0000-0000-000000000001'; });
      await p.evaluate(e => { _cgApplyEnvelope(JSON.parse(e), {}); }, JSON.stringify(env));
      await p.waitForTimeout(400);
      await p.evaluate(() => _cgAutosave());
      let out = await p.evaluate(() => JSON.parse(localStorage.getItem('pactCharGenAutosaveV2') || 'null'));
      const f1 = family(out && out.LOG);
      check('CharGen load + autosave: DM family unchanged', same(fam0, f1), firstDiff(fam0, f1));
      await p.evaluate(() => { const el = document.querySelector('[id^="ap_"]:not([id$="_lock"])'); if (el) { el.value = (el.value || '') + ' tall'; el.dispatchEvent(new Event('change', { bubbles: true })); } });
      await p.waitForTimeout(300);
      await p.evaluate(() => _cgAutosave());
      out = await p.evaluate(() => JSON.parse(localStorage.getItem('pactCharGenAutosaveV2') || 'null'));
      const f2 = family(out && out.LOG);
      check('CharGen harmless edit + autosave: DM family unchanged', same(fam0, f2), firstDiff(fam0, f2));
      check('CharGen: no page errors', errs.length === 0, errs.join(' | ').slice(0, 200));
      await ctx.close();
    }
  }
} finally { await browser.close(); server.close(); }

console.log(fail === 0 ? `\n✓ ${pass} passed / 0 failed` : `\n✗ ${fail} FAILED / ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
