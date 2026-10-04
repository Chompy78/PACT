import { readFileSync } from 'node:fs';
import { economy, compute, foldBuild } from '../../../js/engine.js';
const snaps = JSON.parse(readFileSync(process.argv[2],'utf8'));
const LIMIT = { 'Fenwick Copperkettle':74, 'Skylar':76, 'Character':68, 'Moss Stormspud':79 };
const fmt = t => new Date(t).toLocaleString('en-AU',{timeZone:'Australia/Perth',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'});
const lab = log => { const m={}; for (const e of log) if (e.type==='buy') { const k=e._slot?('['+e.label+']'):e.label; m[k]=(m[k]||0)+1; } return m; };
for (const name of Object.keys(LIMIT)) {
  const list = snaps.filter(s=>s.cur===name).sort((a,b)=>new Date(a.t)-new Date(b.t)).map(s=>{ const log=(s.log||[]).filter(Boolean); const r=compute(foldBuild(log),{drawbackCap:12}); return { t:s.t, log, ledger:economy(log).spent, total:r.total, ceil:LIMIT[name]+(r.drawbackAp||0) }; });
  let lastIn=-1; list.forEach((x,i)=>{ if (x.total<=x.ceil) lastIn=i; });
  const cur=list[list.length-1];
  console.log(`\n=== ${name}: limit ${cur.ceil}, engine total now ${cur.total} (ledger ${cur.ledger}); ${list.length} versions, earliest ${fmt(list[0].t)} at ${list[0].total}`);
  if (lastIn<0) { console.log('   over the limit in EVERY kept version — crossing predates history'); continue; }
  const A=list[lastIn], B=list[lastIn+1]; console.log(`   last within: ${fmt(A.t)} total ${A.total} (ledger ${A.ledger})`);
  if (!B) { console.log('   never crossed'); continue; }
  const a=lab(A.log), b=lab(B.log); const add=Object.keys(b).filter(k=>(b[k]||0)>(a[k]||0)), rem=Object.keys(a).filter(k=>(a[k]||0)>(b[k]||0));
  console.log(`   crossing save: ${fmt(B.t)} total ${B.total}  +${add.join(', ')||'-'}  −${rem.join(', ')||'-'}`);
}
