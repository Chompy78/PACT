#!/usr/bin/env node
/**
 * PACT — ledger / tray / sheet-ledger stored-XSS gate (fix/ledger-xss-escaping).
 *
 * WHY THIS EXISTS. A character's LOG is player-controlled data that crosses users: a DM opens a
 * player's character in DM Console, or in Live Sheet via ?viewChar=. The 2026-10-12 audit found LOG
 * values reaching innerHTML raw in the ledger renders — an event's `rules` stamp (Live Sheet history
 * `.vtag`), the envelope's `rules` (Live Sheet "Loaded under … rules" tray line), and compute()'s line
 * labels, which embed the TRADITION NAME (`Trad 1 <name> — Foundation`) — in CharGen's ledger rows,
 * its "explain my cost" popup, Live Sheet's version banner, and both tools' printable-sheet AP Ledger. Plus an award's `amount`
 * (DM Console award list, Live Sheet AP column).
 *
 * Each tool loads a character whose tradition name, every event's `rules` and the envelope `rules`
 * are an <img onerror> payload, through the tool's real load path (file input / ?viewChar=), renders
 * every ledger-shaped view, and asserts that `window.__xss` stays unset AND the payload is visible as
 * literal text (proving the value really reached the render, so a pass is not a vacuous one).
 *
 * Live Sheet ?viewChar= needs a signed-in session and a database read; neither is available here, so
 * the two bridge calls it makes (A.currentSession, S.peekCharacter) are stubbed in place on the
 * sync-ready event — the handler itself, VIEW_ONLY and render() all run unmodified.
 *
 * USAGE:  node testing/scripts/ledger-xss-e2e.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = Number(process.env.PACT_E2E_PORT) || 7981;
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json',
               '.css':'text/css','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml' };
const server = http.createServer((req,res)=>{
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/PACT\/?/,'') || 'index.html';
  fs.readFile(path.join(REPO, rel), (e,d)=>{
    if(e){ res.writeHead(404); return res.end('nf'); }
    res.writeHead(200,{'Content-Type':MIME[path.extname(rel)]||'application/octet-stream','Cache-Control':'no-store'});
    res.end(d);
  });
});
await new Promise(r=>server.listen(PORT,r));
const BASE = `http://localhost:${PORT}/PACT/tools/`;

let pass=0, fail=0;
const check=(n,ok,d='')=>{ ok?pass++:fail++; console.log(`  ${ok?'PASS':'FAIL'}  ${n}${ok||!d?'':' — '+d}`); };

const P = '<img src=x onerror=window.__xss=1>';
// One character: tradition named P (so compute() emits "Trad 1 <P> — Foundation" etc.), every event
// stamped rules:P, and the envelope's own rules:P.
const LOG = [
  { seq:1, type:'award', amount:200, label:'Award — budget', rules:P, ts:1782635065907 },
  { seq:2, type:'name', name:'Xss Test', label:'Name — Xss Test', rules:P },
  { seq:3, type:'buy', cat:'patch', cost:7, label:'Spellcasting', rules:P,
    payload:{ patch:{ traditions:[{ name:P, rank:1, disciplines:[{ name:'Wizard', cantrips:1 }] }] } } },
];
const ENV = { schema:'pact-character/1', rules:P, name:'Xss Test', id:'xss-test', SEQ:4, LOG };
// A second LOG for the numeric fields a tampered file can turn into strings.
const LOG_AMT = [
  { seq:1, type:'award', amount:P, label:'Award', rules:'v0.350' },
  { seq:2, type:'name', name:'Amt Test', label:'Name — Amt Test', rules:'v0.350' },
];
const ENV_AMT = { schema:'pact-character/1', rules:'v0.350', name:'Amt Test', id:'amt-test', SEQ:3, LOG:LOG_AMT };
const file = (n,o) => ({ name:n+'.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(o)) });

const browser = await launchChromium();
async function open(url, init){
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => d.accept().catch(()=>{}));
  if(init) await page.addInitScript(init);
  await page.goto(url, { waitUntil:'load' });
  return { page, errors };
}
const settle = page => page.evaluate(() => new Promise(r => setTimeout(r, 250)));
// textContent of a node includes the payload as literal characters only if it was rendered as text.
const shows = (page, sel) => page.evaluate(([s,p]) => { const el=document.querySelector(s); return !!el && el.textContent.indexOf(p) !== -1; }, [sel, P]);
const xss = page => page.evaluate(() => window.__xss);

try {
  // ============================ CharGen ============================
  console.log('\n[ledger-xss] CharGen');
  {
    const { page, errors } = await open(BASE+'PACT-CharGen-Webtool.html');
    await page.waitForFunction(() => window.DATA && typeof window.compute==='function' && typeof window.renderLedger==='function', { timeout:20000 });
    await page.setInputFiles('#loadfile', file('xss', ENV));
    await page.waitForFunction(p => [...document.querySelectorAll('#ledger td')].some(td => td.textContent.indexOf(p)!==-1), P, { timeout:8000 }).catch(()=>{});
    await settle(page);
    check('ledger rows show the tradition name as text', await shows(page, '#ledger'));
    check('ledger row data-lab round-trips the raw label', await page.evaluate(p =>
      [...document.querySelectorAll('#ledger tr.lrow[data-lab]')].some(r => r.dataset.lab.indexOf(p)!==-1), P));
    // "Explain my cost": click the Foundation row, the same way a player (or a DM viewing a copy) does.
    await page.evaluate(p => { const r=[...document.querySelectorAll('#ledger tr.lrow[data-lab]')].find(r => r.dataset.lab.indexOf(p)!==-1); if(r) r.click(); }, P);
    await settle(page);
    check('explain-cost popup shows the label as text', await shows(page, '#explainbody'));
    // Printable sheet AP Ledger (renderCharSheet), mounted the way the sheet view mounts it.
    await page.evaluate(() => { const b=readBuild(), r=compute(b); const d=document.createElement('div'); d.id='__cs'; document.body.appendChild(d); d.innerHTML=renderCharSheet(b, r, {apText:''}); });
    await settle(page);
    check('character-sheet AP Ledger shows the label as text', await shows(page, '#__cs .shledger'));
    check('CharGen: window.__xss never set', (await xss(page)) === undefined, 'payload executed');
    check('CharGen: no page errors', errors.length===0, errors.join(' | '));
    await page.close();
  }

  // ============================ Live Sheet ============================
  const lsChecks = async (page, errors, tag) => {
    await settle(page);
    check(`${tag}: history ledger shows the rules stamp as text`, await page.evaluate(p =>
      [...document.querySelectorAll('#ledger .vtag')].some(v => v.textContent===p), P));
    check(`${tag}: "Loaded under … rules" tray line shows the envelope rules as text`, await shows(page, '#tray'));
    check(`${tag}: version-mismatch banner shows the envelope rules as text`, await shows(page, '#versionBanner'));
    // feat/livesheet-sheet-layout: the Live Sheet's 📋 Sheet is renderSheet() (the panel's body + AP Ledger); renderCharSheet() is CharGen-only.
    await page.evaluate(() => { const d=document.createElement('div'); d.id='__cs'; document.body.appendChild(d); d.innerHTML=renderSheet(); });
    await settle(page);
    check(`${tag}: character-sheet AP Ledger shows the tradition label as text`, await shows(page, '#__cs .shledger'));
    check(`${tag}: window.__xss never set`, (await xss(page)) === undefined, 'payload executed');
    check(`${tag}: no page errors`, errors.length===0, errors.join(' | '));
  };
  console.log('\n[ledger-xss] Live Sheet — file import');
  {
    const { page, errors } = await open(BASE+'PACT-Live-Char-Sheet.html');
    await page.waitForFunction(() => window._engineFold && window.DATA && typeof window.renderSheet==='function', { timeout:20000 });
    await page.setInputFiles('#imp', file('xss', ENV));
    await page.waitForFunction(() => document.querySelectorAll('#ledger tr').length > 2, { timeout:8000 }).catch(()=>{});
    await lsChecks(page, errors, 'Live Sheet import');
    await page.close();
  }
  console.log('\n[ledger-xss] Live Sheet — ?viewChar= (DM read-only view; auth + DB read stubbed)');
  {
    const init = `(() => {
      const REC = ${JSON.stringify({ id:'xss-test', name:'Xss Test', ap:0, gold:0, campaign_id:null, stats:ENV })};
      document.addEventListener('sync-ready', () => {
        window._authBridge.currentSession = () => Promise.resolve({ user:{ id:'dm-test' } });
        window._syncBridge.peekCharacter = () => Promise.resolve(JSON.parse(JSON.stringify(REC)));
      });
    })();`;
    const { page, errors } = await open(BASE+'PACT-Live-Char-Sheet.html?viewChar=xss-test', init);
    const reached = await page.waitForFunction(p => [...document.querySelectorAll('#ledger .vtag')].some(v => v.textContent.indexOf(p)!==-1)
      || (document.getElementById('ledger')||{}).innerHTML.indexOf('onerror')!==-1, P, { timeout:10000 }).then(()=>true).catch(()=>false);
    check('?viewChar= handler loaded the stubbed character', reached);
    await lsChecks(page, errors, 'Live Sheet ?viewChar');
    await page.close();
  }
  console.log('\n[ledger-xss] Live Sheet — string award amount');
  {
    const { page, errors } = await open(BASE+'PACT-Live-Char-Sheet.html');
    await page.waitForFunction(() => window._engineFold && window.DATA, { timeout:20000 });
    await page.setInputFiles('#imp', file('amt', ENV_AMT));
    await page.waitForFunction(() => document.querySelectorAll('#ledger tr').length > 1, { timeout:8000 }).catch(()=>{});
    await settle(page);
    check('history ledger AP column shows a string amount as text', await shows(page, '#ledger'));
    check('Live Sheet amount: window.__xss never set', (await xss(page)) === undefined, 'payload executed');
    check('Live Sheet amount: no page errors', errors.length===0, errors.join(' | '));
    await page.close();
  }

  // ============================ DM Console ============================
  console.log('\n[ledger-xss] DM Console');
  {
    const { page, errors } = await open(BASE+'DM-Console.html');
    await page.waitForFunction(() => !!window._campBridge, { timeout:20000 });
    await page.setInputFiles('#fileInput', [file('xss', ENV), file('amt', ENV_AMT)]);
    await page.waitForFunction(() => document.querySelectorAll('.ccard, .card').length >= 2, { timeout:8000 }).catch(()=>{});
    // Expand every card so the detail (casting, awards) renders too.
    await page.evaluate(() => document.querySelectorAll('.chead').forEach(h => h.click()));
    await settle(page);
    await page.evaluate(() => { const b=document.getElementById('ledgerBtn'); if(b) b.click(); });
    await settle(page);
    check('AP Ledger overlay shows the tradition label as text', await shows(page, '#ovBody'));
    check('imported-card award list shows a string amount as text', await page.evaluate(p =>
      [...document.querySelectorAll('.awrow .amt')].some(e => e.textContent.indexOf(p)!==-1), P));
    // Cloud roster card (the path a real DM hits): same envelope as a characters row.
    await page.evaluate(([e1,e2]) => {
      const d=document.createElement('div'); d.id='__roster'; document.body.appendChild(d);
      window._dmRenderCloudRoster(d, [
        { id:'xss-test', name:'Xss Test', stats:e1, ap:0, player:'', playerLabel:'', dmNotes:'' },
        { id:'amt-test', name:'Amt Test', stats:e2, ap:0, player:'', playerLabel:'', dmNotes:'' }]);
    }, [ENV, ENV_AMT]);
    await settle(page);
    // Narrow-screen table-view fallback (renderCards → detailHTML's award table), via its test seam,
    // with the string-amount character expanded.
    await page.evaluate(([e1,e2]) => window._dmRenderCardsTest([
        { id:'xss-test', name:'Xss Test', stats:e1, ap:0 }, { id:'amt-test', name:'Amt Test', stats:e2, ap:0 }], 1), [ENV, ENV_AMT]);
    await settle(page);
    check('table-view detail award table shows a string amount as text', await page.evaluate(p =>
      [...document.querySelectorAll('table.awards td.amt')].some(e => e.textContent.indexOf(p)!==-1), P));
    check('DM Console: window.__xss never set', (await xss(page)) === undefined, 'payload executed');
    check('DM Console: no page errors', errors.length===0, errors.join(' | '));
    await page.close();
  }
} catch (e) {
  console.error('\n✗ harness error:', e && e.stack || e);
  fail++;
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${fail===0?'✓':'✗'} ${pass} passed / ${fail} failed`);
process.exit(fail===0?0:1);
