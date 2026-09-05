/* PACT — protected-event round-trip gate.
 *
 * ONE INVARIANT: a character's PROTECTED EVENTS must survive a CharGen load unchanged.
 *
 * Protected events are the ones pact_ap_ledger_protected() projects and trg_pact_locked_history
 * refuses to let shrink — 'buyoff', 'names', 'award', 'sessionSeal', 'dmRemoveBoon', and every
 * non-patch 'buy'. If a tool drops one, the next cloud save is rejected with
 * "PACT: locked character history cannot shrink", which reaches the player as a raw Postgres error.
 *
 * WHY THIS GATE EXISTS, and why it is not testing a bug that exists today.
 * /code-review ultra on PR #503 predicted a live failure here: CharGen's replaceWholeLogFromBuild()
 * re-synthesises the ENTIRE log from the DOM, and CharGen cannot emit 'dmRemoveBoon' at all
 * (grep -c returns 0). Reproduced 2026-09-05 — the predicted failure does NOT occur, because every
 * cloud load runs through _cgApplyEnvelope, which rebuilds and then reinstates the saved log verbatim,
 * and _cgBlockedBySeal() refuses the genuinely destructive entry points with a readable message.
 *
 * What IS true, and is asserted below as its own check: the rebuild really does destroy those events.
 * Safety is a property of CALLER DISCIPLINE — all four call sites either restore afterwards or refuse
 * first — not of the function. A fifth caller that forgets both conventions reintroduces the failure.
 * This gate turns that discipline into something CI enforces, which is the whole reason it was written
 * rather than closing the finding as "no bug".
 *
 * Assertion 2 is deliberately a "this still breaks" check. If someone later makes
 * replaceWholeLogFromBuild() preserve protected events by construction — the right long-term fix — that
 * assertion SHOULD start failing, and its message says so. It is a tripwire on a known-fragile
 * mechanism, not a demand that the mechanism stay fragile.
 *
 * No Supabase, no credentials: the projection below mirrors the SQL, so the trigger's own comparison is
 * reproduced client-side.
 *
 *   node testing/scripts/protected-events-roundtrip-ci.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = 7991;   // distinct from cloud-e2e 7970 / seed 7971 / dm-console-ui 7973 / chargen-flows 7979
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

const browser = await launchChromium();
const page = await browser.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`, {waitUntil:'load'});
// Wait on the condition, never a bare sleep — the bridge lands on engine-ready, after the deferred module.
await page.waitForFunction(()=>typeof window._cgApplyEnvelope==='function' && !!window.DATA, {timeout:20000});
await page.waitForTimeout(1200);   // let the boot's own LOG bootstrap settle before we overwrite it

// NOTE FOR ANYONE EXTENDING THIS FILE: read `LOG` as a BARE IDENTIFIER inside page.evaluate, never as
// `window.LOG`. It is declared with `let`, so it is not a property of window — `window.LOG` is undefined
// and every assertion silently reports zero events. That cost a false "confirmed bug" on the first run
// of this very script; _cgSealedFloor() returning 6 for a supposedly empty log is what gave it away.
const SEED = await page.evaluate(()=>{
  const V = window.DATA.version;
  const ev = (o,i)=>Object.assign({seq:i+1, ts:1000+i, rules:V}, o);
  const LOG = [
    ev({type:'buy', cat:'patch',  payload:{patch:{species:'Human', stats:{STR:14,DEX:12,CON:13,INT:10,WIS:11,CHA:10}}}},0),
    ev({type:'name', payload:{v:'Seal Probe'}},1),
    ev({type:'award', cost:0, amount:40, label:'starting budget', noLock:true},2),
    ev({type:'buy', cat:'abil', cost:4, payload:{ab:'STR', to:14}},3),
    ev({type:'award', cost:0, amount:10, label:'DM award'},4),
    ev({type:'dmRemoveBoon', cost:0, payload:{v:'Toughness'}, label:'DM removed a boon'},5),
    ev({type:'sessionSeal', idem:'seal-abc-123', label:'seal'},6),
  ];
  return {schema:'pact-character/1', rules:V, name:'Seal Probe', LOG, SEQ:LOG.length+1,
          id:'11111111-2222-3333-4444-555555555555'};
});

// Mirror of pact_ap_ledger_protected() — same IN list, same `- seq - ts - rules - label` projection —
// so this compares what the trigger compares rather than an approximation of it.
await page.evaluate(`window.__proj = function(log){
  return (log||[]).filter(function(e){
    const t=e&&e.type;
    return ['buyoff','names','award','sessionSeal','dmRemoveBoon'].indexOf(t)>-1
        || (t==='buy' && (e.cat||'')!=='patch');
  }).map(function(e){ const o=Object.assign({},e); delete o.seq; delete o.ts; delete o.rules; delete o.label; return o; });
};`);
await page.evaluate(()=>{ window.alert=function(m){ window.__lastAlert=String(m); return true; }; });

const before = await page.evaluate(s=>window.__proj(s.LOG).length, SEED);

console.log(`\n[protected-roundtrip] the load path preserves protected events`);
await page.evaluate(s=>{ window._cgApplyEnvelope(s, {clearHistory:true}); }, SEED);
await page.waitForTimeout(700);
const afterLoad = await page.evaluate(()=>({
  types:(LOG||[]).map(e=>e.type).join(','),
  seal:(LOG||[]).filter(e=>e.type==='sessionSeal').length,
  boon:(LOG||[]).filter(e=>e.type==='dmRemoveBoon').length,
  projLen:window.__proj(LOG).length,
  floor:(typeof _cgSealedFloor==='function')?_cgSealedFloor():-1,
}));
check('sessionSeal survives a load', afterLoad.seal===1, `found ${afterLoad.seal}`);
check('dmRemoveBoon survives a load', afterLoad.boon===1, `found ${afterLoad.boon}`);
check('the protected projection does not shrink across a load',
      afterLoad.projLen>=before, `${before} -> ${afterLoad.projLen} (the trigger refuses any shrink)`);
check('the loaded character reads as sealed', afterLoad.floor>0, `_cgSealedFloor()=${afterLoad.floor}`);

console.log(`\n[protected-roundtrip] the rebuild is still the fragile part (tripwire — see header)`);
const afterRebuild = await page.evaluate(()=>{
  const snap = JSON.parse(JSON.stringify(LOG));
  replaceWholeLogFromBuild(_domReadBuild());
  const out = { seal:(LOG||[]).filter(e=>e.type==='sessionSeal').length,
                boon:(LOG||[]).filter(e=>e.type==='dmRemoveBoon').length,
                projLen:window.__proj(LOG).length };
  LOG.length=0; snap.forEach(function(e){LOG.push(e);});   // restore for the guard check below
  return out;
});
check('replaceWholeLogFromBuild still drops protected events — if this FAILS, the rebuild was made '
      + 'safe by construction: delete this assertion and say so in the commit',
      afterRebuild.seal===0 && afterRebuild.boon===0,
      `projection ${before} -> ${afterRebuild.projLen}`);

console.log(`\n[protected-roundtrip] the guard on the destructive paths still fires`);
const guard = await page.evaluate(()=>({
  blocked:(typeof _cgBlockedBySeal==='function')?_cgBlockedBySeal('Rolling a random character'):null,
  alert:window.__lastAlert||'',
}));
check('_cgBlockedBySeal() refuses a whole-build replacement on a sealed character', guard.blocked===true);
check('...and explains why rather than failing silently', /locked/i.test(guard.alert),
      JSON.stringify(guard.alert.slice(0,60)));

const fatal = errs.filter(e=>!/Failed to load resource|net::|supabase|fetch|NetworkError|Load failed/i.test(e));
check('no fatal page errors', fatal.length===0, fatal.slice(0,2).join(' | '));

console.log(`\n[protected-roundtrip] ${fail===0?'✓':'✗'} ${pass} passed / ${fail} failed`);
await browser.close(); server.close();
process.exit(fail?1:0);
