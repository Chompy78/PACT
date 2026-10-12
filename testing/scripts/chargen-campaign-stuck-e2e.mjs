#!/usr/bin/env node
// chargen-campaign-stuck-e2e.mjs — fix/chargen-campaign-stuck-states, in a real browser.
//
// Four CharGen paths that left a CAMPAIGN character stuck (2026-10-12 logic audit):
//   1. The Building-level picker and the "Confirm or change" creation-AP link wrote a creationLockConfig
//      with a threshold, which the server's creation-lock guard refuses from a player — autosave then
//      dead-ended on a "history is locked" error. They must not be offered on a campaign character.
//   2. Local Load of a saved campaign character never adopted its campaign binding (0 DM AP).
//   3. Undo across New Character restored the campaign character without its binding (0 DM AP).
//   4. A refused budget edit left the refused figure showing in #budget.
//
// No Supabase stack: the auth/sync/campaign bridges are stubbed in the page so the DM-AP resolve has
// something to read (42 AP, campaign C1). Run: node testing/scripts/chargen-campaign-stuck-e2e.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = 7983;
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
const section=t=>console.log(`\n[chargen-campaign-stuck] == ${t} ==`);
const browser = await launchChromium();
const base = `http://localhost:${PORT}/PACT`;
const C1 = '00000000-0000-0000-0000-00000000c001';

const ctx = await browser.newContext();
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
let dialogs=[]; p.on('dialog', d=>{ dialogs.push(d.message().slice(0,100)); d.accept(); });

const fresh = async () => {
  await p.goto(`${base}/tools/PACT-CharGen-Webtool.html`, {waitUntil:'load'}); await p.waitForTimeout(2500);
  await p.evaluate(()=>{ try{ localStorage.clear(); }catch(e){} }); await p.reload({waitUntil:'load'}); await p.waitForTimeout(2500);
  // Stub the cloud: a signed-in session, the character's server-held AP, and its campaign.
  await p.evaluate((C1)=>{
    window._authBridge.currentSession = async()=>({user:{id:'test-session'}});
    window._syncBridge.refreshServerAp = async()=>42;
    window._campaignBridge.getCampaign = async(id)=>({id, name:'Test campaign', rules:{}, ignore_player_ap:false});
    window.__C1 = C1;
  }, C1);
  dialogs = [];
};
const thresholdConfigs = () => p.evaluate(()=>LOG.filter(e=>e.type==='creationLockConfig'&&e.payload&&('threshold' in e.payload)).length);
const rowShown = () => p.evaluate(()=>{ const r=document.getElementById('buildLevel').closest('.row'); return !!r && r.style.display!=='none' && r.offsetParent!==null; });

// -------------------------------------------------------------------------------------------------
section('1. no build-level / creation-AP controls on a campaign character');
{
  await fresh();
  check('a solo character still shows the Building-level row', await rowShown());
  await p.evaluate(()=>{ window._cgCampaignId = window.__C1; window._cgCampaignBound = true; render(); });
  check('a campaign character does NOT show the Building-level row', !(await rowShown()));
  check('...and the creation-AP note offers no "Confirm or change" link',
    !(await p.evaluate(()=>/setCreationAp/.test(document.getElementById('warns').innerHTML))));
  const n0 = await thresholdConfigs();
  // a track whose level-1 budget differs from the current threshold, so the old code DID emit a new one
  const curve = await p.evaluate(()=>{ const thr=_creationLockState().threshold, C=DATA.levelBudgetCurves||{}; return Object.keys(C).find(k=>C[k].l1!==thr); });
  check('(precondition) a track with a different creation AP exists', !!curve, String(curve));
  await p.evaluate((c)=>{ const el=document.getElementById('buildCurve'); el.value=c; el.dispatchEvent(new Event('change',{bubbles:true})); }, curve);
  await p.waitForTimeout(300);
  check('picking a level anyway writes no creation-AP threshold', (await thresholdConfigs())===n0);
  await p.evaluate(()=>{ window.prompt = ()=>'90'; setCreationAp(); });
  await p.waitForTimeout(200);
  check('calling setCreationAp() anyway writes no creation-AP threshold', (await thresholdConfigs())===n0);
}

// -------------------------------------------------------------------------------------------------
section('2. Local Load of a saved campaign character adopts its DM AP');
let env;
{
  await fresh();
  await p.evaluate(()=>{ const e=document.getElementById('cname'); e.value='Campaign Probe'; e.dispatchEvent(new Event('change',{bubbles:true})); });
  await p.waitForTimeout(300);
  await p.evaluate(()=>{ window._cgCampaignId = window.__C1; });
  env = await p.evaluate(()=>JSON.stringify(_cgEnvelope(false)));
  check('the saved file carries the campaign binding', JSON.parse(env).campaignId===C1);
  await p.evaluate(()=>resetBuild()); await p.waitForTimeout(300);
  check('(precondition) New Character cleared the binding', await p.evaluate(()=>!window._cgCampaignId && !window._dmAp));
  await p.evaluate((txt)=>loadFile(new File([txt],'probe.json',{type:'application/json'})), env);
  await p.waitForTimeout(1500);
  const st = await p.evaluate(()=>({id:window._cgCampaignId, ap:window._dmAp, status:window._dmApStatus, name:document.getElementById('cname').value}));
  check('the loaded character is the saved one', st.name==='Campaign Probe', JSON.stringify(st));
  check('...bound to its campaign', st.id===C1, JSON.stringify(st));
  check('...with its DM AP (42), not 0', st.ap===42 && st.status==='active', JSON.stringify(st));
}

// -------------------------------------------------------------------------------------------------
section('3. New Character -> Undo restores the campaign binding');
{
  // continues from section 2: a loaded campaign character with 42 DM AP
  await p.evaluate(()=>resetBuild()); await p.waitForTimeout(300);
  check('(precondition) New Character is a solo character with no DM AP', await p.evaluate(()=>!window._cgCampaignId && !window._dmAp));
  await p.evaluate(()=>undo()); await p.waitForTimeout(1500);
  const st = await p.evaluate(()=>({id:window._cgCampaignId, ap:window._dmAp, name:document.getElementById('cname').value}));
  check('Undo brings the campaign character back', st.name==='Campaign Probe', JSON.stringify(st));
  check('...with its campaign binding and DM AP again', st.id===C1 && st.ap===42, JSON.stringify(st));
  await p.evaluate(()=>redo()); await p.waitForTimeout(800);
  const st2 = await p.evaluate(()=>({id:window._cgCampaignId, ap:window._dmAp}));
  check('Redo to the blank character drops the binding again (no bleed onto a solo character)', !st2.id && !st2.ap, JSON.stringify(st2));
}

// -------------------------------------------------------------------------------------------------
section('4. a refused budget edit snaps back');
{
  // A FINISHED campaign character: the server freezes everything before its creationLocked (D2), which
  // includes the budget award, so a budget edit is refused client-side.
  await fresh();
  await p.evaluate(()=>cgFinishCreating(true)); await p.waitForTimeout(300);
  await p.evaluate(()=>{ window._cgCampaignId = window.__C1; window._cgCampaignBound = true; render(); });
  const before = await p.evaluate(()=>({v:document.getElementById('budget').value, floor:Math.max(_cgSealedFloor(),_cgLockFloor()), awards:JSON.stringify(LOG.filter(e=>e.type==='award'))}));
  check('(precondition) the budget award sits inside the locked prefix', before.floor>0, JSON.stringify(before));
  await p.evaluate(()=>{ const el=document.getElementById('budget'); el.value='150'; el.dispatchEvent(new Event('change',{bubbles:true})); });
  await p.waitForTimeout(400);
  const after = await p.evaluate(()=>({v:document.getElementById('budget').value, awards:JSON.stringify(LOG.filter(e=>e.type==='award')), hint:document.getElementById('buildLevel_hint').textContent}));
  check('the award in the LOG is unchanged (the edit was refused)', after.awards===before.awards);
  check('#budget shows the real figure again, not the refused 150', after.v===before.v, `${before.v} -> ${after.v}`);
  check('...and the build-level hint does not claim 150', !/^150 AP/.test(after.hint), after.hint);
}

const fatal = errs.filter(e=>!/Failed to load|net::|supabase|fetch/i.test(e));
check('no fatal page errors', fatal.length===0, fatal.slice(0,2).join(' | '));
await ctx.close(); await browser.close(); server.close();
console.log(`\n[chargen-campaign-stuck] ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
