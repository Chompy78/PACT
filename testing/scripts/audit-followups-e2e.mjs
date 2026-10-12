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
    // window.__srvId (optional): the server answers only for that character id; any other id has no row.
    window.__srvId = null;
    window._syncBridge.refreshServerBinding = async(id)=>{ await wait(); return (window.__srvId==null || id===window.__srvId) ? window.__srv : null; };
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

  // A newer resolve (here: a cloud load of a SOLO character) takes over while an adopt is still in flight.
  await cgFresh();
  await p.evaluate(()=>{ window.__delay = 2500; });
  await p.evaluate((txt)=>loadFile(new File([txt],'probe.json',{type:'application/json'})), env);
  await p.waitForTimeout(400);
  check('(precondition) an adopt is in flight', await p.evaluate(()=>!!window._cgBindingPending));
  await p.evaluate(()=>_cgResolveDmApStatus(0, null)); await p.waitForTimeout(300);
  const stP = await p.evaluate(()=>({pending:!!window._cgBindingPending, bound:_cgIsCampaignBound(), why:_cgCreationApRefused()}));
  check('a newer resolve clears the pending flag and the stale pending campaign', !stP.pending && !stP.bound && stP.why==='', JSON.stringify(stP));
  await p.waitForTimeout(2600);
  const stP2 = await p.evaluate(()=>({pending:!!window._cgBindingPending, bound:_cgIsCampaignBound(), why:_cgCreationApRefused()}));
  check('...and the old adopt finishing late does not bring them back', !stP2.pending && !stP2.bound && stP2.why==='', JSON.stringify(stP2));
  await p.evaluate(()=>render());   // a real cloud load renders after its resolve
  check('...so the solo character keeps its Building-level row', await rowShown());

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
  const FID = '11111111-2222-4333-8444-555555555555';
  const PROT = ['creationLockConfig','creationLocked','creationUnlocked','award','sessionSeal'];
  // (a) nothing the rebuild would lose that the server protects: the file's id and binding are kept.
  const raw = await p.evaluate(([C1,FID,PROT])=>{ const e=_cgEnvelope(false); return JSON.stringify({name:'Untagged Probe', rules:e.rules, LOG:e.LOG.filter(x=>!PROT.includes(x.type)), SEQ:e.SEQ, id:FID, campaignId:C1}); }, [C1,FID,PROT]);
  await p.evaluate(()=>resetBuild()); await p.waitForTimeout(300);
  await p.evaluate((FID)=>{ window.__srvId = FID; }, FID);   // the server has a row for the FILE's id only
  await p.evaluate((txt)=>loadFile(new File([txt],'ls.json',{type:'application/json'})), raw);
  await p.waitForTimeout(1500);
  const st = await p.evaluate(()=>({cid:currentCharId(), id:window._cgCampaignId, ap:window._dmAp, status:window._dmApStatus, confirmed:!!window._cgBindingConfirmed}));
  check('the untagged file keeps its own character id', st.cid===FID, JSON.stringify(st));
  check('the untagged file\'s character is bound to its campaign', st.id===C1, JSON.stringify(st));
  check('...confirmed by the server for that id, with its DM AP (42)', st.confirmed && st.ap===42 && st.status==='active', JSON.stringify(st));

  // (b) a LOG with an award / lock events: the rebuild would drop them, so the row must not be overwritten —
  // it opens as a separate copy (fresh id, no binding) and says so.
  await cgFresh();
  const raw2 = await p.evaluate(([C1,FID])=>{ cgFinishCreating(true); const e=_cgEnvelope(false);
    return JSON.stringify({name:'Protected Probe', rules:e.rules, LOG:e.LOG, SEQ:e.SEQ, id:FID, campaignId:C1}); }, [C1,FID]);
  check('(precondition) the protected file carries lock events and an award', await p.evaluate((t)=>{ const L=JSON.parse(t).LOG; return L.some(e=>e.type==='creationLocked') && L.some(e=>e.type==='award'); }, raw2));
  await p.evaluate(()=>resetBuild()); await p.waitForTimeout(300);
  await p.evaluate((FID)=>{ window.__srvId = FID; window.__flashes=[]; const f=window.flash; window.flash=function(m){ window.__flashes.push(String(m)); return f&&f.apply(this,arguments); }; }, FID);
  await p.evaluate((txt)=>loadFile(new File([txt],'ls2.json',{type:'application/json'})), raw2);
  await p.waitForTimeout(1500);
  const st2 = await p.evaluate(()=>({cid:currentCharId(), id:window._cgCampaignId, pend:(typeof _cgPendingCampaignId!=='undefined')?_cgPendingCampaignId:null, fl:window.__flashes}));
  check('protected history: opens with a FRESH id, not the file\'s', st2.cid && st2.cid!==FID, JSON.stringify(st2));
  check('...and is not bound to the campaign', !st2.id && !st2.pend, JSON.stringify(st2));
  check('...and says it opened as a copy', st2.fl.some(m=>/separate copy/.test(m)), JSON.stringify(st2.fl));
}

// -------------------------------------------------------------------------------------------------
section('5. Randomise keeps the character id');
{
  await cgFresh();
  const id0 = await p.evaluate(()=>currentCharId());
  await p.evaluate(()=>randomizeRoll(null, 0)); await p.waitForTimeout(800);
  const id1 = await p.evaluate(()=>currentCharId());
  check('a re-roll is the same character (same id)', id0===id1, `${id0} -> ${id1}`);
  check('...and its saved envelope carries that id', await p.evaluate((id0)=>_cgEnvelope(false).id===id0, id0));

  // The server's creation-lock guard compares the old lock family to the new one position by position
  // (pact_lock_family: lock/unlock/config events, minus seq/ts/rules/label). Since the roll keeps the id it
  // UPDATEs the real row, so the old family must be an exact prefix of the new one.
  const fam = () => p.evaluate(()=>LOG.filter(e=>e&&['creationLocked','creationUnlocked','creationLockConfig'].includes(e.type))
    .map(e=>{ const o=Object.assign({},e); delete o.seq; delete o.ts; delete o.rules; delete o.label; return JSON.stringify(o); }));
  const isPrefix = (a,b) => a.length<=b.length && a.every((x,i)=>x===b[i]);
  // (a) the invite-join seed: a DM-set threshold first, then the tool's own auto-arm.
  await cgFresh();
  await p.evaluate(()=>{ LOG = LOG.filter(e=>!['creationLocked','creationUnlocked','creationLockConfig'].includes(e.type));
    LOG.unshift({type:'creationLockConfig',payload:{threshold:79},seq:SEQ++,ts:Date.now(),systemEdit:true});
    _cgEnsureLockArmed(); render(); });
  const la0 = await p.evaluate(()=>JSON.stringify(LOG));
  const fa0 = await fam();
  check('(precondition) invite seed: [threshold, auto]', fa0.length===2 && /threshold/.test(fa0[0]) && /auto/.test(fa0[1]), JSON.stringify(fa0));
  await p.evaluate(()=>randomizeRoll(null, 0)); await p.waitForTimeout(800);
  const fa1 = await fam();
  if(process.env.PACT_DUMP_ROLL_LOGS) fs.writeFileSync(process.env.PACT_DUMP_ROLL_LOGS, JSON.stringify({before:JSON.parse(la0), after:await p.evaluate(()=>LOG)}));
  check('invite seed: the old lock family is an exact prefix of the rolled one', isPrefix(fa0, fa1), JSON.stringify(fa1));
  check('invite seed: no second auto-arm', fa1.filter(x=>/"auto"/.test(x)).length===1, JSON.stringify(fa1));
  // (b) a DM reopen: [auto, ..., locked, unlocked], then a roll.
  await cgFresh();
  await p.evaluate(()=>cgFinishCreating(true)); await p.waitForTimeout(300);
  await p.evaluate(()=>{ LOG.push({type:'creationUnlocked',seq:SEQ++,ts:Date.now(),label:'Creation reopened by the DM'}); render(); });
  const fb0 = await fam();
  check('(precondition) reopened: the family ends locked, unlocked', /creationLocked/.test(fb0[fb0.length-2]||'') && /creationUnlocked/.test(fb0[fb0.length-1]||''), JSON.stringify(fb0));
  await p.evaluate(()=>randomizeRoll(null, 0)); await p.waitForTimeout(800);
  const fb1 = await fam();
  check('reopened: the old lock family is an exact prefix of the rolled one', isPrefix(fb0, fb1), JSON.stringify(fb1));
  check('reopened: the roll left the character reopened (not locked)', await p.evaluate(()=>!_cgIsLocked()));
}

// -------------------------------------------------------------------------------------------------
section('6. a Setup appearance edit on a LOG with two appearance events');
{
  await cgFresh();
  await p.evaluate(()=>{ const e=document.getElementById('ap_hair'); e.value='Black'; e.dispatchEvent(new Event('change',{bubbles:true})); });
  await p.waitForTimeout(300);
  // A second, later, untagged appearance event (what a Live Sheet edit can leave behind) — it wins the fold.
  const env = await p.evaluate(()=>{
    const e=_cgEnvelope(false); const cur=JSON.parse(JSON.stringify(foldBuild(e.LOG).appearance||{}));
    e.LOG.push({type:'buy',cat:'patch',payload:{patch:{appearance:Object.assign(cur,{hair:'Red',backstory:'Grew up on a barge.'})}},cost:0,seq:e.SEQ,ts:Date.now(),label:'Appearance'});
    e.SEQ+=1; return JSON.stringify(e); });
  await p.evaluate(()=>resetBuild()); await p.waitForTimeout(300);
  await p.evaluate((txt)=>loadFile(new File([txt],'dup.json',{type:'application/json'})), env);
  await p.waitForTimeout(1200);
  const apEvents = () => p.evaluate(()=>LOG.map((e,i)=>({i,e})).filter(x=>x.e.type==='buy'&&x.e.cat==='patch'&&x.e.payload&&x.e.payload.patch&&('appearance' in x.e.payload.patch)).map(x=>({i:x.i,ap:x.e.payload.patch.appearance})));
  const before = await apEvents();
  check('(precondition) the loaded LOG has two appearance events', before.length===2, JSON.stringify(before.map(x=>x.i)));
  check('(precondition) the form shows the later one (hair Red)', await p.evaluate(()=>document.getElementById('ap_hair').value==='Red'));
  await p.evaluate(()=>{ const e=document.getElementById('ap_eyes'); e.value='Green'; e.dispatchEvent(new Event('change',{bubbles:true})); });
  await p.waitForTimeout(400);
  const after = await apEvents();
  const fold = await p.evaluate(()=>foldBuild(LOG).appearance||{});
  check('still two appearance events (none added, none dropped)', after.length===2, JSON.stringify(after.map(x=>x.i)));
  check('the earlier event is untouched', JSON.stringify(after[0])===JSON.stringify(before[0]));
  check('the edit landed on the later event, at the same position', after[1] && after[1].i===before[1].i && after[1].ap.eyes==='Green', JSON.stringify(after[1]));
  check('the folded appearance has the new eyes, the later hair, and the backstory', fold.eyes==='Green' && fold.hair==='Red' && fold.backstory==='Grew up on a barge.', JSON.stringify(fold));
}

// -------------------------------------------------------------------------------------------------
section('4. Live Sheet: the non-core switch is locked on a campaign or finished character');
{
  const lsFresh = async () => {
    await p.goto(`${base}/tools/PACT-Live-Char-Sheet.html`, {waitUntil:'load'});
    await p.evaluate(()=>{ try{ localStorage.clear(); }catch(e){} }); await p.reload({waitUntil:'load'});
    await p.waitForFunction(() => window.compute && document.querySelector('#sheet .shname'), { timeout: 25000 });
    await p.waitForTimeout(400); dialogs=[];
  };
  const tasha = () => p.evaluate(()=>{ const b=foldBuild(null); return !((b.houseRules&&b.houseRules.dmAllows&&b.houseRules.dmAllows.tasha)===false); });
  await lsFresh();
  const t0 = await tasha();
  await p.evaluate(()=>toggleTasha()); await p.waitForTimeout(150);
  check('solo, in creation: the switch still flips (unchanged)', (await tasha())===!t0);
  await p.evaluate((C1)=>{ window._lsCampaignId=C1; render(); }, C1);
  const n0 = await p.evaluate(()=>LOG.length), t1 = await tasha();
  await p.evaluate(()=>toggleTasha()); await p.waitForTimeout(150);
  check('campaign character: toggleTasha() appends nothing', (await p.evaluate(()=>LOG.length))===n0 && (await tasha())===t1);
  await lsFresh();
  await p.evaluate(()=>{ window.confirm=()=>true; finishCreating(); });
  await p.waitForTimeout(200);
  check('(precondition) the character is finished', await p.evaluate(()=>window._engineCreationLockState(LOG).locked));
  const n1 = await p.evaluate(()=>LOG.length), t2 = await tasha();
  await p.evaluate(()=>toggleTasha()); await p.waitForTimeout(150);
  check('finished solo character: toggleTasha() appends nothing', (await p.evaluate(()=>LOG.length))===n1 && (await tasha())===t2);
}

check('no page errors', errs.length===0, errs.join(' | ').slice(0,400));
console.log(`\n[audit-followups] ${pass} passed, ${fail} failed`);
await browser.close(); server.close();
process.exit(fail?1:0);
