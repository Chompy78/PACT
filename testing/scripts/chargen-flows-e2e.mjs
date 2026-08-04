#!/usr/bin/env node
/**
 * PACT — CharGen flow gate: tool handoff identity, and invite-decline recovery.
 *
 * WHY THIS EXISTS. Both scenarios below were reported by the 2026-08-04 usability review, and both
 * turned on behaviour no gate could see:
 *
 *   1. TOOL HANDOFF IDENTITY. A character moved CharGen -> Live Sheet -> CharGen must remain ONE
 *      character. If its id changes on any leg, the next cloud save inserts a second row and the
 *      original stops receiving updates -- a silently orphaned duplicate, invisible to the DM. The
 *      local half of that chain is fully testable without a stack, and is what this asserts.
 *
 *   2. INVITE-DECLINE RECOVERY. Declining the invite prompt used to clear the token and hide the
 *      banner, so a player who clicked Cancel lost the invite with no explanation and no way back.
 *      Worth a permanent check because it is invisible on the happy path -- and because Playwright
 *      auto-dismisses confirm() by default, which is precisely how the review walked into it while
 *      believing it had found a broken sign-in redirect.
 *
 * Needs no Supabase stack: supabase-js is vendored, so the module bridges load offline and fire their
 * events. The signed-in half is covered by cloud-e2e.
 *
 * USAGE:  node testing/scripts/chargen-flows-e2e.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = 7979;   // distinct from cloud-e2e 7970 / seed 7971 / dm-console-ui 7973
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json',
               '.css':'text/css','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml' };
const server = http.createServer((q,r)=>{
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/PACT\/?/,'') || 'index.html';
  fs.readFile(path.join(REPO, rel), (e,d)=>{
    if(e){ r.writeHead(404); return r.end('not found'); }
    r.writeHead(200,{'Content-Type':MIME[path.extname(rel)]||'application/octet-stream','Cache-Control':'no-store'});
    r.end(d);
  });
});
await new Promise(r=>server.listen(PORT,r));

let pass=0, fail=0;
const check=(n,ok,d='')=>{ ok?pass++:fail++; console.log(`  ${ok?'PASS':'FAIL'}  ${n}${d?' — '+d:''}`); };
const section=t=>console.log(`\n[chargen-flows] == ${t} ==`);

/* Fall back to whatever chromium is on disk when the pinned client and the pre-provisioned browser
   builds disagree; CI installs a matching one and never reaches this. */
async function launchChromium(){
  try { return await chromium.launch(); }
  catch (e) {
    const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
    const cands = [path.join(root,'chromium')];
    try { for (const d of fs.readdirSync(root).filter(n=>/^chromium-\d+$/.test(n)).sort().reverse())
            cands.push(path.join(root,d,'chrome-linux','chrome')); } catch {}
    for (const exe of cands) { try { if (fs.existsSync(exe)) return await chromium.launch({executablePath:exe}); } catch {} }
    throw e;
  }
}
const browser = await launchChromium();
const base = `http://localhost:${PORT}/PACT`;
const PROBE = `window.__pactProbeId = function(){ try { return currentCharId(); } catch(e){ return 'ERR:'+e.message; } };`;

// -------------------------------------------------------------------------------------------------
section('a character keeps ONE id across CharGen <-> Live Sheet');
{
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e)));

  await p.goto(`${base}/tools/PACT-CharGen-Webtool.html`, {waitUntil:'load'});
  await p.waitForTimeout(2500);
  await p.evaluate(PROBE);
  await p.evaluate(()=>{ const e=document.getElementById('cname'); if(e){ e.value='Handoff Probe'; e.dispatchEvent(new Event('change')); } });
  await p.waitForTimeout(400);
  const idStart = await p.evaluate(()=>window.__pactProbeId());

  await p.evaluate(()=>switchToLiveSheet());
  await p.waitForTimeout(3000);
  await p.evaluate(PROBE);
  const idLS = await p.evaluate(()=>window.__pactProbeId());

  await p.evaluate(()=>switchToCharGen());
  await p.waitForTimeout(3000);
  await p.evaluate(PROBE);
  const idBack = await p.evaluate(()=>window.__pactProbeId());

  check('CharGen mints a UUID id', /^[0-9a-f-]{36}$/.test(String(idStart)), String(idStart));
  check('Live Sheet adopts the SAME id on handoff', idLS===idStart, `${idStart} -> ${idLS}`);
  check('CharGen adopts the SAME id on the return leg', idBack===idStart, `${idStart} -> ${idBack}`);
  check('round trip is one character, not two', idStart===idLS && idLS===idBack);
  const fatal = errs.filter(e=>!/Failed to load|net::|supabase|fetch/i.test(e));
  check('no fatal page errors across the round trip', fatal.length===0, fatal.slice(0,2).join(' | '));
  await ctx.close();
}

// -------------------------------------------------------------------------------------------------
section('declining an invite is recoverable, not a one-way door');
{
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  let dialogs = 0;
  p.on('dialog', d => { dialogs++; d.dismiss(); });        // the player clicks Cancel

  await p.goto(`${base}/tools/PACT-CharGen-Webtool.html?invite=TOK123`, {waitUntil:'load'});
  await p.waitForTimeout(2500);

  const out = await p.evaluate(async ()=>{
    // Stub a session and re-fire sync-ready so tryRedeem takes the signed-in path. The listener body
    // builds fresh closures per dispatch, so this is a clean second run rather than a resumed one.
    window._authBridge.currentSession = async()=>({user:{id:'test-session'}});
    document.dispatchEvent(new Event('sync-ready'));
    await new Promise(r=>setTimeout(r,600));
    const bn = document.getElementById('cgInviteBanner');
    let tok=null; try{ tok = sessionStorage.getItem(window.PENDING_INVITE_KEY); }catch(e){}
    return { visible: bn.style.display!=='none', text: bn.textContent.slice(0,80),
             btns: [...bn.querySelectorAll('button')].map(x=>x.textContent), tokenKept: tok };
  });

  check('the confirm prompt was shown and declined', dialogs===1, `dialogs=${dialogs}`);
  check('the banner stays visible after a decline', out.visible, String(out.visible));
  check('it says the invite was not accepted', /not accepted/i.test(out.text), out.text);
  check('an "Accept invite" way back is offered', out.btns.includes('Accept invite'), JSON.stringify(out.btns));
  check('an explicit "Discard invite" is offered', out.btns.includes('Discard invite'), JSON.stringify(out.btns));
  check('the token is KEPT, not silently wiped', out.tokenKept==='TOK123', String(out.tokenKept));
  await ctx.close();
}

console.log(`\n[chargen-flows] ${fail ? fail+' of '+(pass+fail)+' checks FAILED' : 'all '+pass+' checks passed'}`);
await browser.close(); server.close();
process.exit(fail?1:0);
