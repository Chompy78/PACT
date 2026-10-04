import { readFileSync } from 'node:fs';
import { compute, foldBuild, economy } from '../../../js/engine.js';
const live = JSON.parse(readFileSync(process.argv[2],'utf8'));
const snaps = JSON.parse(readFileSync(process.argv[3],'utf8'));
const LIMIT = { 'Anders Pipeleaf':72, 'Caspian':74, 'Fenwick Copperkettle':74, 'Skylar':76, 'Character':68, 'Moss Stormspud':79 };
const fmt = t => new Date(t).toLocaleString('en-AU',{timeZone:'Australia/Perth',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'});
const lab = log => { const m={}; for (const e of log) if (e.type==='buy') { const k=e.label; m[k]=(m[k]||0)+1; } return m; };
for (const c of live) {
  const log=c.stats.LOG.filter(Boolean); const r=compute(foldBuild(log),{drawbackCap:12});
  const lim=LIMIT[c.name]; let cross='';
  if (c.kind==='livesheet') {
    const T=log.map((e,i)=>compute(foldBuild(log.slice(0,i+1)),{drawbackCap:12}).total); let li=-1; T.forEach((t,i)=>{ if(t<=lim) li=i; }); const k=li+1; cross = k<log.length ? `${log[k].label} (${fmt(log[k].ts)}) ${li>=0?T[li]:0} → ${T[k]}` : "never";
  } else {
    const L=snaps.filter(s=>s.cur===c.name).sort((a,b)=>new Date(a.t)-new Date(b.t)).map(s=>({t:s.t,log:s.log.filter(Boolean)})).map(x=>({...x,total:compute(foldBuild(x.log),{drawbackCap:12}).total}));
    let li=-1; L.forEach((x,i)=>{ if(x.total<=lim) li=i; });
    if (li<0) cross='older than kept backups';
    else if (L[li+1]) { const a=lab(L[li].log), b=lab(L[li+1].log); const add=Object.keys(b).filter(k=>(b[k]||0)>(a[k]||0)); cross=`${add.join(', ')||'slot change'} (${fmt(L[li+1].t)}) ${L[li].total} → ${L[li+1].total}`; }
  }
  console.log(JSON.stringify({name:c.name, dmAp:c.ap, lock:lim, spent:r.total, drawbackAp:r.drawbackAp, unspentVsDmAp:c.ap-r.total, overLock:r.total-lim, crossNoDrawbacks:cross}));
}
