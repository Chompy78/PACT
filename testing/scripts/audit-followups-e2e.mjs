#!/usr/bin/env node
// audit-followups-e2e.mjs — chore/audit-fix-followups-2026-10-12, in a real browser.
//
// Small follow-ups found by the adversarial reviews of the 2026-10-12 audit fixes (PRs #633–#638):
//   1. CharGen's wallet refresh (DM gold + downtime window) wrote its result after its awaits with no
//      generation check, so switching campaign A -> B mid-fetch painted A's gold onto B.
//   2. CharGen offered the creation-AP controls while a campaign binding was still being confirmed, and
//      on a finished character with an unconfirmed binding — both write a threshold the server refuses.
//   3. CharGen's load of an untagged (Live Sheet) file ignored the file's campaign binding.
//   4. The Live Sheet let a campaign / finished character flip the DM's non-core (Tasha) switch.
//   5. CharGen's Randomise minted a new character id, so a re-roll became a second cloud row.
//   6. A CharGen Setup appearance edit on a LOG that already has two appearance events.
//
// No Supabase stack: the auth/sync/campaign bridges are stubbed in the page.
// Run: node testing/scripts/audit-followups-e2e.mjs   (PACT_E2E_PORT overrides the port)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = Number(process.env.PACT_E2E_PORT) || 7998;
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
const section=t=>console.log(`\n[audit-followups] == ${t} ==`);
const browser = await launchChromium();
const base = `http://localhost:${PORT}/PACT`;
const C1 = '00000000-0000-0000-0000-00000000c001';
const C2 = '00000000-0000-0000-0000-00000000c002';

const ctx = await browser.newContext();
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
let dialogs=[]; p.on('dialog', d=>{ dialogs.push(d.type()+': '+d.message().slice(0,100)); d.accept(); });

const cgFresh = async () => {
  await p.goto(`${base}/tools/PACT-CharGen-Webtool.html`, {waitUntil:'load'}); await p.waitForTimeout(2500);
  await p.evaluate(()=>{ try{ localStorage.clear(); }catch(e){} }); await p.reload({waitUntil:'load'}); await p.waitForTimeout(2500);
  await p.evaluate((C1)=>{
    window._authBridge.currentSession = async()=>({user:{id:'test-session'}});
    window.__srv = {ap:42, campaignId:C1}; window.__delay = 0;
    const wait = ()=>new Promise(r=>setTimeout(r, window.__delay));
    window._syncBridge.refreshServerBinding = async()=>{ await wait(); return window.__srv; };
    window._syncBridge.refreshServerAp = async()=>{ await wait(); return window.__srv ? window.__srv.ap : null; };
    window._campaignBridge.getCampaign = async(id)=>({id, name:'Test campaign '+id.slice(-2), rules:{}, ignore_player_ap:false});
    window.__C1 = C1;
  }, C1);
  dialogs = [];
};
const thresholdConfigs = () => p.evaluate(()=>LOG.filter(e=>e.type==='creationLockConfig'&&e.payload&&('threshold' in e.payload)).length);
const rowShown = () => p.evaluate(()=>{ const r=document.getElementById('buildLevel').closest('.row'); return !!r && r.style.display!=='none' && r.offsetParent!==null; });
const pickOtherCurve = () => p.evaluate(()=>{
  const thr=_creationLockState().threshold, C=DATA.levelBudgetCurves||{}; const c=Object.keys(C).find(k=>C[k].l1!==thr);
  const el=document.getElementById('buildCurve'); el.value=c; el.dispatchEvent(new Event('change',{bubbles:true})); return c; });

// -------------------------------------------------------------------------------------------------
section('1. wallet refresh: a stale campaign fetch does not overwrite the newer one');
{
  await cgFresh();
  await p.evaluate((C2)=>{
    const sleep = ms=>new Promise(r=>setTimeout(r,ms));
    // Answers in call order: campaign A's gold is slow (600 ms), campaign B's is immediate.
    window.__goldQ = [{v:100,d:600},{v:7,d:0}];
    window._syncBridge.refreshServerGold = async()=>{ const g=window.__goldQ.shift(); await sleep(g.d); return g.v; };
    window._dmBridge = window._dmBridge || {};
    window._dmBridge.getDowntimeWindow = async(cid)=>({days: cid===C2 ? 2 : 30, declaredAt:'2026-10-12T00:00:00Z'});
    window.__C2 = C2;
  }, C2);
  // A's resolve is inside its (slow) gold fetch when the player switches to B.
  await p.evaluate(()=>{ _cgResolveDmApStatus(0, window.__C1); });
  await p.waitForTimeout(200);
  await p.evaluate(()=>_cgResolveDmApStatus(0, window.__C2));
  await p.waitForTimeout(1200);
  const st = await p.evaluate(()=>({gold:window._cgDmGold, days:window._cgDmWindow&&window._cgDmWindow.days, camp:window._cgCampaignId}));
  check('(precondition) the character ends on campaign B', st.camp===C2, JSON.stringify(st));
  check('B\'s DM gold (7) stays, not A\'s late 100', st.gold===7, JSON.stringify(st));
  check('B\'s downtime window (2 days) stays, not A\'s 30', st.days===2, JSON.stringify(st));
}

// -------------------------------------------------------------------------------------------------
section('2. no creation-AP threshold while the binding is confirming, or on a finished campaign character');
{
  await cgFresh();
  await p.evaluate(()=>{ const e=document.getElementById('cname'); e.value='Pending Probe'; e.dispatchEvent(new Event('change',{bubbles:true})); });
  await p.waitForTimeout(300);
  await p.evaluate(()=>{ window._cgCampaignId = window.__C1; });
  const env = await p.evaluate(()=>JSON.stringify(_cgEnvelope(false)));
  await p.evaluate(()=>resetBuild()); await p.waitForTimeout(300);
  await p.evaluate(()=>{ window.__delay = 2500; });
  await p.evaluate((txt)=>loadFile(new File([txt],'probe.json',{type:'application/json'})), env);
  await p.waitForTimeout(600);
  check('(precondition) the binding is still being confirmed', await p.evaluate(()=>!window._cgBindingConfirmed && _cgIsCampaignBound()));
  check('while confirming: no Building-level row', !(await rowShown()));
  const n0 = await thresholdConfigs();
  await pickOtherCurve(); await p.waitForTimeout(200);
  check('while confirming: picking a level writes no threshold', (await thresholdConfigs())===n0);
  await p.evaluate(()=>{ window.prompt = ()=>'90'; setCreationAp(); }); await p.waitForTimeout(200);
  check('while confirming: setCreationAp() writes no threshold', (await thresholdConfigs())===n0);
  await p.waitForTimeout(2800);
  check('confirmed afterwards: still no row (the DM owns it)', !(await rowShown()));

  // Offline / unconfirmed: the controls stay open, with the note.
  await cgFresh();
  await p.evaluate(()=>{ window.__srv = null; });
  await p.evaluate((txt)=>loadFile(new File([txt],'probe.json',{type:'application/json'})), env);
  await p.waitForTimeout(1500);
  check('(precondition) unconfirmed binding, resolve finished', await p.evaluate(()=>!window._cgBindingConfirmed && _cgIsCampaignBound() && !window._cgBindingPending));
  check('unconfirmed (offline): the Building-level row stays usable', await rowShown());
  const n1 = await thresholdConfigs();
  await p.evaluate(()=>{ window.prompt = ()=>'90'; setCreationAp(); }); await p.waitForTimeout(200);
  check('unconfirmed (offline): setCreationAp() still works', (await thresholdConfigs())===n1+1);

  // Finished character, unconfirmed binding.
  await cgFresh();
  await p.evaluate(()=>cgFinishCreating(true)); await p.waitForTimeout(300);
  await p.evaluate(()=>{ window._cgCampaignId = window.__C1; window._cgCampaignBound = true; window._cgBindingConfirmed = false; render(); });
  const n2 = await thresholdConfigs();
  await pickOtherCurve(); await p.waitForTimeout(200);
  await p.evaluate(()=>_cgApplyBuildLevel()); await p.waitForTimeout(200);
  check('finished + unconfirmed binding: a level pick writes no threshold', (await thresholdConfigs())===n2);
  await p.evaluate(()=>{ window.prompt = ()=>'90'; setCreationAp(); }); await p.waitForTimeout(200);
  check('finished + unconfirmed binding: setCreationAp() writes no threshold', (await thresholdConfigs())===n2);
}

// -------------------------------------------------------------------------------------------------
section('3. an untagged Live Sheet file adopts its campaign binding');
{
  await cgFresh();
  const raw = await p.evaluate((C1)=>{ const e=_cgEnvelope(false); return JSON.stringify({name:'Untagged Probe', rules:e.rules, LOG:e.LOG, SEQ:e.SEQ, campaignId:C1}); }, C1);
  await p.evaluate(()=>resetBuild()); await p.waitForTimeout(300);
  await p.evaluate((txt)=>loadFile(new File([txt],'ls.json',{type:'application/json'})), raw);
  await p.waitForTimeout(1500);
  const st = await p.evaluate(()=>({id:window._cgCampaignId, ap:window._dmAp, status:window._dmApStatus}));
  check('the untagged file\'s character is bound to its campaign', st.id===C1, JSON.stringify(st));
  check('...with its DM AP (42)', st.ap===42 && st.status==='active', JSON.stringify(st));
}

check('no page errors', errs.length===0, errs.join(' | ').slice(0,400));
console.log(`\n[audit-followups] ${pass} passed, ${fail} failed`);
await browser.close(); server.close();
process.exit(fail?1:0);
