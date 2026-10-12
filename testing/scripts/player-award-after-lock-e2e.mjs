#!/usr/bin/env node
// player-award-after-lock-e2e.mjs — fix/server-player-award-after-lock, in a real browser.
//
// The database now refuses (pact_enforce_player_ap_ceiling, sql/migrations/2026-10-12-server-player-award-after-lock.sql) any rise in a
// campaign character's LOG award total from anyone but its DM once the character is creation-locked or sealed. The tools must not offer
// a write the server refuses (it would strand every later autosave), so:
//   1. Live Sheet ⎀ Redeem of an AP code refuses on a locked or sealed campaign character (H2: a code is tamper-evident, not secret),
//      and still works on a solo character, an unlocked campaign character, and one whose creation the DM reopened. The
//      self-award refusal message stops suggesting Redeem where Redeem is refused.
//   2. CharGen's Budget field refuses a change on a SEALED campaign character that was never creation-locked (locked was already
//      covered by fix/player-free-ap item 5), and stays the player's own on a solo sealed character.
//
// No Supabase stack: the bridges are stubbed in the page. Run: node testing/scripts/player-award-after-lock-e2e.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = 7964;
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
const section=t=>console.log(`\n[player-award-after-lock] == ${t} ==`);
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
const awardSum = () => p.evaluate(()=>LOG.filter(e=>e.type==='award').reduce((s,e)=>s+(+e.amount||0),0));
const redeem = async () => {
  const code = await p.evaluate(()=>window.apEncodeGrant({a:4,n:'session 3',d:'2026-10-12',id:window.makeGrantId()}));
  const before = await awardSum();
  await p.evaluate((code)=>{ window.prompt=()=>code; redeemGrant(); }, code);
  return (await awardSum()) - before;
};
const lsState = (campaign, extra) => p.evaluate(([C, extra])=>{
  window._lsCampaignId = C; extra.forEach(t=>LOG.push({seq:SEQ++, ts:Date.now(), type:t})); render();
}, [campaign, extra]);

section('1. Live Sheet — Redeem on a finished campaign character');
{
  await lsFresh(); await lsState(C1, ['creationLocked']);
  check('campaign, creation-locked: redeeming an AP code adds no AP', (await redeem())===0);
  const selfMsg = () => p.evaluate(()=>{ let m=''; const f=window.flash; window.flash=x=>{m=String(x);}; award(5,'self'); window.flash=f; return m; });
  check('campaign, locked: the self-award refusal does not suggest Redeem', !/Redeem/.test(await selfMsg()));
  await lsFresh(); await lsState(C1, []);
  check('campaign, not locked: the self-award refusal still suggests Redeem', /Redeem/.test(await selfMsg()));
  await lsFresh(); await lsState(C1, ['sessionSeal']);
  check('campaign, sealed (not locked): redeeming adds no AP', (await redeem())===0);
  await lsFresh(); await lsState(C1, ['creationLocked','creationUnlocked']);
  check('campaign, creation reopened by the DM: redeeming still works', (await redeem())===4);
  await lsFresh(); await lsState(C1, []);
  check('campaign, creation not locked: redeeming still works', (await redeem())===4);
  await lsFresh(); await lsState(null, ['creationLocked','sessionSeal']);
  check('solo, locked and sealed: redeeming still works (the player is their own DM)', (await redeem())===4);
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
const typeBudget = async v => { await p.evaluate(v=>{ const el=document.getElementById('budget'); el.disabled=false; el.value=String(v); el.dispatchEvent(new Event('change',{bubbles:true})); }, v); await p.waitForTimeout(300); };
const sealNoAward = (bound) => p.evaluate((bound)=>{
  LOG=LOG.filter(e=>e.type!=='award'); document.getElementById('budget').value='0';
  LOG.push({seq:SEQ++, ts:Date.now(), type:'sessionSeal', note:'S1'});
  if(bound){ window._cgCampaignId=window.__C1; window._cgCampaignBound=true; window._cgBindingConfirmed=true; }
  render();
}, bound);

section('2. CharGen — the Budget on a SEALED campaign character that was never locked');
{
  await cgFresh(); await sealNoAward(true);
  check('(precondition) not creation-locked, sealed, no award', await p.evaluate(()=>!_cgIsLocked() && LOG.some(e=>e.type==='sessionSeal') && !LOG.some(e=>e.type==='award')));
  check('the budget field is disabled', await p.evaluate(()=>document.getElementById('budget').disabled));
  await typeBudget(200);
  check('typing a budget anyway appends no award', await p.evaluate(()=>!LOG.some(e=>e.type==='award')));
  check('...and the field snaps back to 0', await p.evaluate(()=>document.getElementById('budget').value==='0'));
  await cgFresh(); await sealNoAward(false);
  await typeBudget(150);
  check('solo, sealed: the budget is still the player\'s own (unchanged behaviour)', await p.evaluate(()=>foldBuild(LOG).budget===150));
}

check('no page errors', errs.length===0, errs.join(' | ').slice(0,400));
console.log(`\n[player-award-after-lock] ${pass} passed, ${fail} failed`);
await browser.close(); server.close();
process.exit(fail?1:0);
