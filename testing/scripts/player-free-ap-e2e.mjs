#!/usr/bin/env node
// player-free-ap-e2e.mjs — fix/player-free-ap, in a real browser.
//
// Ways a player could grant themselves AP, or get AP back, that the 2026-10-12 audit found:
//   1. Live Sheet "+ Award AP" / "+ Discount" / "⎘ AP code" were live on a player's own CAMPAIGN character.
//      (⎀ Redeem of a DM-issued code must keep working.)
//   2. CharGen's DM Calls / DM customisations (priced house rules: a custom 60 AP drawback grants 60 AP)
//      were player-editable on a confirmed campaign character and after the creation lock.
//   3. CharGen starting gold could be lowered after Finish creating — an AP refund (1 AP per step).
//   5. A locked campaign character with no award (budget 0) could type a budget and append a fresh award.
//   6. Turning the DM "Bound" option off left Martially Bound in the LOG and never cleared Magically Bound.
// (Item 4 is a board-text change, no code.)
//
// No Supabase stack: the bridges are stubbed in the page. Run: node testing/scripts/player-free-ap-e2e.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = Number(process.env.PACT_E2E_PORT) || 7991;
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
const section=t=>console.log(`\n[player-free-ap] == ${t} ==`);
const browser = await launchChromium();
const base = `http://localhost:${PORT}/PACT`;
const C1 = '00000000-0000-0000-0000-00000000c001';

const ctx = await browser.newContext();
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
let dialogs=[]; p.on('dialog', d=>{ dialogs.push(d.type()+': '+d.message().slice(0,80)); d.type()==='prompt'?d.accept('5'):d.accept(); });

// ------------------------------------------------------------------------------------------------- Live Sheet
const lsFresh = async () => {
  await p.goto(`${base}/tools/PACT-Live-Char-Sheet.html`, {waitUntil:'load'});
  await p.evaluate(()=>{ try{ localStorage.clear(); }catch(e){} }); await p.reload({waitUntil:'load'});
  await p.waitForFunction(() => window.compute && window.apEncodeGrant && document.querySelector('#sheet .shname'), { timeout: 25000 });
  await p.waitForTimeout(400); dialogs=[];
};
const shown = id => p.evaluate(id=>{ const e=document.getElementById(id); return !!e && e.style.display!=='none'; }, id);
const awards = () => p.evaluate(()=>LOG.filter(e=>e.type==='award').length);

section('1. Live Sheet — no self-award on a campaign character; Redeem still works');
{
  await lsFresh();
  check('solo: + Award AP is offered', await shown('lsAwardBtn'));
  const a0 = await awards();
  await p.evaluate(()=>award(5,'solo award'));
  check('solo: award() still records an award (unchanged)', (await awards())===a0+1);

  await p.evaluate((C1)=>{ window._lsCampaignId=C1; render(); }, C1);
  check('campaign: + Award AP is hidden', !(await shown('lsAwardBtn')));
  check('campaign: + Discount is hidden', !(await shown('lsDiscountBtn')));
  check('campaign: ⎘ AP code is hidden', !(await shown('lsGrantBtn')));
  check('campaign: ⎀ Redeem is still offered', await p.evaluate(()=>{ const b=document.querySelector('[onclick="redeemGrant()"]'); return !!b && b.style.display!=='none'; }));
  const a1 = await awards();
  await p.evaluate(()=>{ award(6,'self'); award(2,'Discount: self',true); });
  check('campaign: award() appends nothing', (await awards())===a1);
  dialogs=[];
  await p.evaluate(()=>makeGrant());
  check('campaign: makeGrant() refuses before asking for an amount', !dialogs.some(d=>d.startsWith('prompt')), dialogs.join(' | '));
  const code = await p.evaluate(()=>window.apEncodeGrant({a:4,n:'session 3',d:'2026-10-12',id:window.makeGrantId()}));
  await p.evaluate((code)=>{ window.prompt=()=>code; redeemGrant(); }, code);
  const last = await p.evaluate(()=>{ const e=LOG[LOG.length-1]; return e&&{type:e.type,amount:e.amount,grantId:!!e.grantId}; });
  check('campaign: redeeming a DM-issued AP code still records the award', last && last.type==='award' && last.amount===4 && last.grantId, JSON.stringify(last));

  await p.evaluate(()=>{ window._lsCampaignId=null; render(); });
  check('back to solo: + Award AP is offered again', await shown('lsAwardBtn'));
}

// ------------------------------------------------------------------------------------------------- CharGen
const cgFresh = async () => {
  await p.goto(`${base}/tools/PACT-CharGen-Webtool.html`, {waitUntil:'load'}); await p.waitForTimeout(2500);
  await p.evaluate(()=>{ try{ localStorage.clear(); }catch(e){} }); await p.reload({waitUntil:'load'}); await p.waitForTimeout(2500);
  await p.evaluate((C1)=>{
    window._authBridge.currentSession = async()=>({user:{id:'test-session'}});
    window._syncBridge.refreshServerBinding = async()=>({ap:42, campaignId:C1});
    window._syncBridge.refreshServerAp = async()=>42;
    window._campaignBridge.getCampaign = async(id)=>({id, name:'Test campaign', rules:{}, ignore_player_ap:false});
    window.__C1 = C1;
  }, C1);
  dialogs=[];
};
const house = () => p.evaluate(()=>JSON.stringify(foldBuild(LOG).houseRules||{}));
const spent = () => p.evaluate(()=>compute(foldBuild(LOG)).total);
const dmDisabled = () => p.evaluate(()=>['dmname','dmap','dm_draws','dm_bound'].map(id=>document.getElementById(id).disabled));
const addCustomDrawback = () => p.evaluate(()=>{
  document.getElementById('dmkind').value='draw'; document.getElementById('dmname').value='Free Money';
  document.getElementById('dmap').value='60'; document.getElementById('dmdesc').value='x'; dmAdd(); });

section('2. CharGen — DM boons/drawbacks read-only on a confirmed campaign character and after the lock');
{
  await cgFresh();
  check('solo, in creation: the DM customisation controls are editable', (await dmDisabled()).every(x=>!x));
  await p.evaluate(()=>{ window._cgCampaignId=window.__C1; window._cgCampaignBound=true; window._cgBindingConfirmed=false; render(); });
  // Changed by feat/campaign-house-rules-tools (review of #655, owner decision U1): a bound character — confirmed or not —
  // is priced under its campaign's rules, where its own house rules are ignored, so its own editor is read-only (and
  // hidden) too. Was "still editable" while the own rules applied to an unconfirmed binding.
  check('unconfirmed binding, in creation: the own house-rules controls are read-only (campaign rules apply, U1)', (await dmDisabled()).every(x=>x));
  await p.evaluate(()=>{ window._cgBindingConfirmed=true; render(); });
  check('confirmed campaign character: the controls are disabled', (await dmDisabled()).every(x=>x));
  const h0 = await house();
  await addCustomDrawback();
  check('confirmed campaign character: dmAdd() of a 60 AP drawback changes no house rule', (await house())===h0);
  await p.evaluate(()=>{ const e=document.getElementById('dm_draws'); e.disabled=false; e.checked=false; e.dispatchEvent(new Event('change',{bubbles:true})); });
  await p.waitForTimeout(200);
  check('confirmed campaign character: forcing the Drawbacks toggle off changes no house rule', (await house())===h0);
  check('...and the box is put back', await p.evaluate(()=>document.getElementById('dm_draws').checked));

  await cgFresh();
  await p.evaluate(()=>cgFinishCreating(true)); await p.waitForTimeout(300);
  check('solo, after the lock: the controls are disabled', (await dmDisabled()).every(x=>x));
  const h1 = await house(), s1 = await spent();
  await addCustomDrawback();
  await p.evaluate(()=>{ dmDisableBuiltin(); dmToggleDisable('draw','Free Money'); });
  check('solo, after the lock: the house-rule writers change nothing', (await house())===h1);
  check('...and compute() is unchanged', (await spent())===s1);
}

section('3. CharGen — starting gold cannot change after the lock');
{
  await cgFresh();
  const setGold = v => p.evaluate(v=>{ const e=document.getElementById('gold'); e.value=String(v); e.dispatchEvent(new Event('change',{bubbles:true})); }, v);
  await setGold(4); await p.waitForTimeout(300);
  check('(precondition) in creation, starting gold 4 is recorded', await p.evaluate(()=>foldBuild(LOG).gold===4));
  await p.evaluate(()=>cgFinishCreating(true)); await p.waitForTimeout(300);
  const s0 = await spent(), n0 = await p.evaluate(()=>LOG.length);
  await setGold(0); await p.waitForTimeout(300);
  const st = await p.evaluate(()=>({gold:foldBuild(LOG).gold, field:document.getElementById('gold').value}));
  check('after the lock: lowering gold is refused (LOG still 4)', st.gold===4, JSON.stringify(st));
  check('...the field shows 4 again', String(st.field)==='4', JSON.stringify(st));
  check('...and no AP came back', (await spent())===s0);
  await setGold(9); await p.waitForTimeout(300);
  check('after the lock: raising gold is refused too (no in-play gold purchase exists)', await p.evaluate(()=>foldBuild(LOG).gold===4));
  check('...and nothing was appended', (await p.evaluate(()=>LOG.length))===n0);
}

section('5. CharGen — a locked campaign character with no award cannot append one');
{
  await cgFresh();
  await p.evaluate(()=>{ LOG=LOG.filter(e=>e.type!=='award'); document.getElementById('budget').value='0'; render(); });
  await p.evaluate(()=>cgFinishCreating(true)); await p.waitForTimeout(300);
  await p.evaluate(()=>{ window._cgCampaignId=window.__C1; window._cgCampaignBound=true; window._cgBindingConfirmed=true; render(); });
  check('(precondition) no award in the LOG', (await awards())===0);
  check('the budget field is disabled', await p.evaluate(()=>document.getElementById('budget').disabled));
  await p.evaluate(()=>{ const el=document.getElementById('budget'); el.disabled=false; el.value='200'; el.dispatchEvent(new Event('change',{bubbles:true})); });
  await p.waitForTimeout(300);
  check('typing a budget anyway appends no award', (await awards())===0);
  check('...and the field snaps back to 0', await p.evaluate(()=>document.getElementById('budget').value==='0'));
  // solo, locked: unchanged (the player is their own DM)
  await cgFresh();
  await p.evaluate(()=>cgFinishCreating(true)); await p.waitForTimeout(300);
  await p.evaluate(()=>{ const el=document.getElementById('budget'); el.value='150'; el.dispatchEvent(new Event('change',{bubbles:true})); });
  await p.waitForTimeout(300);
  check('solo, locked: the budget is still the player\'s own (unchanged behaviour)', await p.evaluate(()=>foldBuild(LOG).budget===150));
}

section('6. CharGen — turning the DM "Bound" option off clears both Bound grants through the LOG');
{
  await cgFresh();
  await p.evaluate(()=>{ const e=document.getElementById('martiallyBound'); e.value='Fighter'; e.dispatchEvent(new Event('change',{bubbles:true})); });
  await p.waitForTimeout(200);
  await p.evaluate(()=>addTrad()); await p.waitForTimeout(200);
  await p.evaluate(()=>{ const d=document.querySelector('.tcard .disc-name'); const o=[...d.options].find(o=>o.value&&o.value!=='(none)'); d.value=o.value; d.dispatchEvent(new Event('change',{bubbles:true})); });
  await p.waitForTimeout(200);
  await p.evaluate(()=>{ const c=document.querySelector('.tcard .disc-bound'); c.checked=true; c.dispatchEvent(new Event('change',{bubbles:true})); });
  await p.waitForTimeout(300);
  const lines = () => p.evaluate(()=>compute(foldBuild(LOG)).lines.map(l=>l[0]).filter(n=>/Bound \(gain\)/.test(n)));
  const before = await lines();
  check('(precondition) both Bound grants are in compute()', before.includes('Martially Bound (gain)') && before.includes('Magically Bound (gain)'), JSON.stringify(before));
  await p.evaluate(()=>{ const e=document.getElementById('dm_bound'); e.checked=false; e.dispatchEvent(new Event('change',{bubbles:true})); });
  await p.waitForTimeout(400);
  const after = await lines();
  check('Bound off: Martially Bound is gone from compute(foldBuild(LOG))', !after.includes('Martially Bound (gain)'), JSON.stringify(after));
  check('Bound off: Magically Bound is gone from compute(foldBuild(LOG))', !after.includes('Magically Bound (gain)'), JSON.stringify(after));
  check('...and the Magically Bound box is unticked and disabled', await p.evaluate(()=>{ const c=document.querySelector('.tcard .disc-bound'); return !c.checked && c.disabled; }));
}

check('no page errors', errs.length===0, errs.join(' | ').slice(0,400));
console.log(`\n[player-free-ap] ${pass} passed, ${fail} failed`);
await browser.close(); server.close();
process.exit(fail?1:0);
