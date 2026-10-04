#!/usr/bin/env node
/**
 * roundtrip-audit.mjs — does a CURRENT client leave a locked character's frozen history untouched when it merely loads and saves it?
 *
 * WHY. The server-freeze migration (docs/plans/2026-10-04-server-freeze-d2-e1.md) refuses any save that changes the protected part of a locked, sealed or
 * awarded character's history. The risk it cannot see from the database alone: a client that "normalises" a protected event on load (reorders, re-stamps,
 * rebuilds the log from its form) would make an HONEST save refusable. backup-replay-audit.mjs proves what past clients did; this proves what the clients we ship now do.
 *
 * For every live character in the export, in BOTH real tools (headless Chromium, the project's own harness):
 *   1. load it (Live Sheet: the local-save key; CharGen: _cgApplyEnvelope), let the tool write its own autosave envelope, and compare the PROTECTED projection of the
 *      saved log with the original — exactly the comparison the new trigger makes, restricted to the part the server would freeze (up to the last seal/award/lock);
 *   2. CharGen only: then change something harmless (the appearance text, which is exempt) and compare again.
 * The projection below mirrors sql/migrations/2026-10-05-server-freeze-d2-e1-stage1.sql (pact_ap_ledger_protected + pact_patch_protected_projection); keep them in step.
 *
 * Input: a JSON export {live:[{id,campaign_id,name,stats}]} made with a read-only query. It holds real player data: keep it OUT of the repository.
 * Options: --campaign-all treat EVERY character as campaign-bound, so the lock boundary applies to each locked character, not just the six that are sealed today (a stress test:
 *                         a client that rewrites a locked character's history shows up even where the rule would not freeze it yet); --synthetic   add Live-Sheet-origin variants (an "Imported budget" award at index 0, the shape that exposed a real defect).
 * Run: node testing/scripts/creation-lock-guard-test/roundtrip-audit.mjs <export.json> [report.json] [--campaign-all] [--synthetic]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from '../lib/launch-chromium.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const argv = process.argv.slice(2);
const ALLC = argv.includes('--campaign-all'), SYNTH = argv.includes('--synthetic');
const [exportPath, reportPath] = argv.filter(a => !a.startsWith('--'));
if (!exportPath) { console.error('usage: roundtrip-audit.mjs <export.json> [report.json]'); process.exit(2); }
const exp = JSON.parse(fs.readFileSync(exportPath, 'utf8'));

// ---- mirror of the server's protected projection ----
const EXEMPT = new Set(['appearance', 'houseRules', 'gold']);
const TEMP_EXEMPT = new Set(['traditions', 'innate', 'dabblerCantrips', 'martiallyBound', 'originClass', 'originClass2', 'species', 'species2', 'size', 'lineage']);
const PROT_TYPES = new Set(['buyoff', 'names', 'award', 'sessionSeal', 'dmRemoveBoon', 'dmUnlockDrawback']);
const strip = e => { const x = { ...e }; for (const k of ['seq', 'ts', 'rules', 'label']) delete x[k]; return x; };
const patchProj = e => {
  const p = e.payload && typeof e.payload.patch === 'object' && e.payload.patch && !Array.isArray(e.payload.patch) ? e.payload.patch : {};
  const q = {}; for (const [k, v] of Object.entries(p)) if (!EXEMPT.has(k) && !TEMP_EXEMPT.has(k)) q[k] = v;
  return Object.keys(q).length ? { type: e.type, cat: e.cat, cost: e.cost ?? null, gp: e.gp ?? null, days: e.days ?? null, patch: q } : null;
};
const protectedList = log => { const out = []; for (const e of log || []) {
  if (!e) continue;
  if (e.type === 'buy' && (e.cat || '') === 'patch') { const p = patchProj(e); if (p) out.push(p); }
  else if (PROT_TYPES.has(e.type) || (e.type === 'buy' && (e.cat || '') !== 'patch')) out.push(strip(e));
} return out; };
// the freeze boundary the server computes: last seal / non-discount award (campaign only) / currently-locked lock (campaign only)
const boundary = (log, campaign) => {
  let seal = 0, award = 0, lock = 0, ll = 0, lu = 0;
  (log || []).forEach((e, i) => { const o = i + 1;
    if (e.type === 'sessionSeal') seal = o;
    if (campaign && e.type === 'award' && !e.disc && !e.noLock) award = o;
    if (e.type === 'creationLocked') ll = o; if (e.type === 'creationUnlocked') lu = o; });
  if (campaign && ll && lu < ll) lock = ll;
  return Math.max(seal, award, lock);
};
// jsonb equality ignores object key order (arrays keep theirs): compare canonically, not as raw JSON text
const canon = v => Array.isArray(v) ? v.map(canon) : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const compare = (oldLog, newLog, campaign) => {
  const idx = boundary(oldLog, campaign);
  if (!idx) return { covered: false };
  const po = protectedList((oldLog || []).slice(0, idx)), pn = protectedList(newLog);
  if (pn.length < po.length) return { covered: true, ok: false, why: `protected list shrank ${po.length}->${pn.length}` };
  for (let i = 0; i < po.length; i++) if (!same(po[i], pn[i])) return { covered: true, ok: false, why: `protected event ${i} changed: ${JSON.stringify(po[i]).slice(0, 110)} -> ${JSON.stringify(pn[i]).slice(0, 110)}` };
  return { covered: true, ok: true };
};

// ---- the app, served locally ----
const PORT = 7981;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/PACT\/?/, '') || 'index.html';
  fs.readFile(path.join(REPO, rel), (e, d) => { if (e) { r.writeHead(404); return r.end('not found'); }
    r.writeHead(200, { 'Content-Type': MIME[path.extname(rel)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); r.end(d); });
});
await new Promise(r => server.listen(PORT, r));
const base = `http://localhost:${PORT}/PACT`;
const browser = await launchChromium();
const results = [];
try {
  const subjects = exp.live.slice();
  if (SYNTH) {   // Live-Sheet-origin variants: the first real log of each kind, with its award replaced by an "Imported budget" award at index 0, and a lock appended if missing
    for (const c of exp.live.filter(x => x.stats && Array.isArray(x.stats.LOG) && x.stats.LOG.length > 6).slice(0, 4)) {
      const log = c.stats.LOG.filter(e => e.type !== 'award').map(e => ({ ...e }));
      log.unshift({ seq: 0, ts: 1, type: 'award', amount: 79, note: 'Imported budget', label: 'Starting creation budget (79 AP)', noLock: true });
      if (!log.some(e => e.type === 'creationLocked')) log.push({ seq: 9999, ts: 2, type: 'creationLocked', label: 'Creation finished' });
      subjects.push({ ...c, name: c.name + ' (Live-Sheet-origin variant)', campaign_id: c.campaign_id || 'synthetic-campaign', stats: { ...c.stats, LOG: log } });
    }
  }
  for (const c of subjects) {
    const stats = c.stats; if (!stats || !Array.isArray(stats.LOG)) continue;
    const campaign = !!c.campaign_id || ALLC;
    const row = { name: c.name, campaign, events: stats.LOG.length, boundary: boundary(stats.LOG, campaign) };
    if (!row.boundary) { row.skipped = 'not frozen by the new rule (no seal, no award, not a locked campaign character)'; results.push(row); continue; }
    const env = JSON.stringify(stats);
    // Live Sheet
    try {
      const ctx = await browser.newContext(); const p = await ctx.newPage(); p.on('dialog', d => d.accept());
      await p.addInitScript(e => { try { localStorage.setItem('pactLiveSheet', e); } catch (x) {} }, env);
      await p.goto(`${base}/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' }); await p.waitForTimeout(2200);
      await p.evaluate(() => { try { save(); } catch (e) {} });
      const out = await p.evaluate(() => { try { return JSON.parse(localStorage.getItem('pactLiveSheet')); } catch (e) { return null; } });
      row.liveSheet = out && Array.isArray(out.LOG) ? compare(stats.LOG, out.LOG, campaign) : { covered: true, ok: false, why: 'no envelope written' };
      await ctx.close();
    } catch (e) { row.liveSheet = { covered: true, ok: false, why: 'harness error: ' + String(e.message).slice(0, 100) }; }
    // CharGen: load only, then a harmless edit
    try {
      const ctx = await browser.newContext(); const p = await ctx.newPage(); p.on('dialog', d => d.accept());
      await p.goto(`${base}/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' }); await p.waitForTimeout(2200);
      await p.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
      if (campaign) await p.evaluate(() => { window._cgCampaignId = '00000000-0000-0000-0000-00000000c001'; });   // the tool knows a bound character is campaign-bound
      await p.evaluate(e => { _cgApplyEnvelope(JSON.parse(e), {}); }, env); await p.waitForTimeout(600);
      await p.evaluate(() => { try { _cgAutosave(); } catch (e) {} });
      let out = await p.evaluate(() => { try { return JSON.parse(localStorage.getItem('pactCharGenAutosaveV2')); } catch (e) { return null; } });
      row.charGenLoad = out && Array.isArray(out.LOG) ? compare(stats.LOG, out.LOG, campaign) : { covered: true, ok: false, why: 'no envelope written' };
      await p.evaluate(() => { const el = document.querySelector('[id^="ap_"]:not([id$="_lock"])'); if (el) { el.value = (el.value || '') + ' '; el.dispatchEvent(new Event('change', { bubbles: true })); } });
      await p.waitForTimeout(500);
      await p.evaluate(() => { try { _cgAutosave(); } catch (e) {} });
      out = await p.evaluate(() => { try { return JSON.parse(localStorage.getItem('pactCharGenAutosaveV2')); } catch (e) { return null; } });
      row.charGenEdit = out && Array.isArray(out.LOG) ? compare(stats.LOG, out.LOG, campaign) : { covered: true, ok: false, why: 'no envelope written' };
      await ctx.close();
    } catch (e) { row.charGenLoad = row.charGenLoad || { covered: true, ok: false, why: 'harness error: ' + String(e.message).slice(0, 100) }; }
    results.push(row);
    const flag = r => r ? (r.ok ? 'ok' : 'DIFF') : '-';
    console.log(`${row.name.padEnd(24)} boundary@${String(row.boundary).padEnd(3)} liveSheet:${flag(row.liveSheet)} charGenLoad:${flag(row.charGenLoad)} charGenEdit:${flag(row.charGenEdit)}`);
  }
} finally { await browser.close(); server.close(); }
const covered = results.filter(r => !r.skipped);
const bad = covered.filter(r => [r.liveSheet, r.charGenLoad, r.charGenEdit].some(x => x && x.ok === false));
console.log(`\n${results.length} live characters; ${covered.length} frozen by the new rule; ${covered.length - bad.length} round-trip clean in all checks; ${bad.length} with a difference`);
for (const r of bad) for (const [k, v] of Object.entries({ liveSheet: r.liveSheet, charGenLoad: r.charGenLoad, charGenEdit: r.charGenEdit })) if (v && v.ok === false) console.log(`  DIFF ${r.name} [${k}]: ${v.why}`);
if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(results, null, 1));
process.exitCode = bad.length ? 1 : 0;
