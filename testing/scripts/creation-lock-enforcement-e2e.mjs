// creation-lock-enforcement-e2e.mjs — fix/creation-lock-enforcement, in a real browser.
//
// Three owner-reported bugs (2026-10-11):
//   1. Neither CharGen nor the Live Sheet showed that a character had finished creation — the
//      "Finish creating" button just disappeared.
//   2. After the lock, CharGen still sold traits from another species (guide §10: "other-race traits may
//      be taken only at character creation").
//   3. Vigor bought during creation re-priced upward when Hit Dice were raised after the lock.
//
// Run:  node testing/scripts/creation-lock-enforcement-e2e.mjs   (expect 0 failed)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = Number(process.env.PACT_E2E_PORT) || 7987;
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
const section=t=>console.log(`\n[creation-lock] == ${t} ==`);
const browser = await launchChromium();
const base = `http://localhost:${PORT}/PACT`;
const XTRAIT = 'Elf: Darkvision 60 ft';   // a Tier-1 trait with a cross-race price, bought by a Human

const ctx = await browser.newContext();
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
p.on('dialog', d=>d.accept());

section('CharGen');
await p.goto(`${base}/tools/PACT-CharGen-Webtool.html`, {waitUntil:'load'});
await p.waitForTimeout(2500);
const setSel = async (id, v)=>{ await p.evaluate(([id,v])=>{ const e=document.getElementById(id); e.value=String(v); e.dispatchEvent(new Event('change',{bubbles:true})); }, [id,v]); await p.waitForTimeout(300); };
const chip = id => p.evaluate(id=>{ const e=document.getElementById(id); return !!e && e.style.display!=='none'; }, id);
const vigorAP = () => p.evaluate(()=>{ const r=compute(readBuild()); const row=(r.lines||[]).find(x=>x[0]==='Vigor'); return row?row[1]:null; });
const xBox = () => p.evaluate(v=>{ const e=[...document.querySelectorAll('.racck')].find(x=>x.value===v); return e?{disabled:e.disabled,checked:e.checked}:null; }, XTRAIT);

await setSel('spec','Human');
// CON 14 so Vigor 2 is within its cap.
await p.evaluate(()=>{ const e=document.getElementById('st_CON'); e.value='14'; e.dispatchEvent(new Event('change',{bubbles:true})); });
await p.waitForTimeout(300);
await setSel('hardy', 2);
check('lock label hidden during creation', !(await chip('cgCreationLockedChip')));
const xb0 = await xBox();
check('another species\' trait can be ticked during creation', xb0 && !xb0.disabled, JSON.stringify(xb0));
const vBefore = await vigorAP();

// This test is about the lock, not about naming: switch the names-before-spending rule off (rules.requireNames:false) so
// "Finish creating" does not stop to ask for the blank language slot (feat/names-before-spending).
await p.evaluate(()=>{ window._cloudCampaign={rules:{requireNames:false}}; cgFinishCreating(true); });
await p.waitForTimeout(500);
check('lock label shown after Finish creating', await chip('cgCreationLockedChip'));
const xb1 = await xBox();
check('another species\' trait is greyed out after the lock', xb1 && xb1.disabled && !xb1.checked, JSON.stringify(xb1));
// Force the click anyway (a disabled box can be re-enabled from devtools): the engine must still refuse.
await p.evaluate(v=>{ const e=[...document.querySelectorAll('.racck')].find(x=>x.value===v); e.disabled=false; e.checked=true; e.dispatchEvent(new Event('change',{bubbles:true})); }, XTRAIT);
await p.waitForTimeout(500);
const owns = await p.evaluate(v=>(readBuild().racialTraits||[]).includes(v), XTRAIT);
check('forcing the tick does not buy it', !owns);

await setSel('hd', 5);
const vAfter = await vigorAP();
check('the Hit Dice raise went through', (await p.evaluate(()=>readBuild().hd))===5);
check('Vigor bought during creation keeps its price when Hit Dice rise after the lock', vBefore!=null && vAfter===vBefore, `${vBefore} -> ${vAfter}`);

section('Live Sheet');
await p.evaluate(()=>switchToLiveSheet());
await p.waitForTimeout(3000);
check('lock label shown for the locked character', await chip('creationLockedChip'));
const lsV = await p.evaluate(()=>{ const r=compute(foldBuild(null)); const row=(r.lines||[]).find(x=>x[0]==='Vigor'); return row?row[1]:null; });
check('Live Sheet prices that Vigor the same', lsV===vBefore, `${lsV}`);

const p2 = await ctx.newPage(); p2.on('pageerror',e=>errs.push(String(e)));
await p2.goto(`${base}/tools/PACT-Live-Char-Sheet.html?new=1`, {waitUntil:'load'});
await p2.waitForTimeout(2500);
await p2.evaluate(()=>{ LOG.length=0; render(); });
const fresh = await p2.evaluate(()=>{ const e=document.getElementById('creationLockedChip'); return !!e && e.style.display!=='none'; });
check('lock label hidden for a character still in creation', !fresh);

const fatal = errs.filter(e=>!/Failed to load|net::|supabase|fetch/i.test(e));
check('no fatal page errors', fatal.length===0, fatal.slice(0,2).join(' | '));

await browser.close(); server.close();
console.log(`\n${fail?'✗':'✓'} ${pass} passed / ${fail} failed`);
process.exit(fail?1:0);
