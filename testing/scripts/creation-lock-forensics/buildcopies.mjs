import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { compute, foldBuild, economy, creationCeiling, DATA } from '../../../js/engine.js';
const live = JSON.parse(readFileSync(process.argv[2],'utf8'));
const snaps = JSON.parse(readFileSync(process.argv[3],'utf8'));
const OPTS = { drawbackCap: 12 };
const PLAN = {
  'Anders Pipeleaf':      { limit:72, mode:'live',  crossLabel:'Forgery kit' },
  'Caspian':              { limit:74, mode:'none' },
  'Fenwick Copperkettle': { limit:74, mode:'snap',  at:'2026-09-10T12:58' },
  'Skylar':               { limit:76, mode:'snap',  at:'2026-09-03T10:42' },
  'Moss Stormspud':       { limit:79, mode:'snap',  at:'2026-09-08T12:03' },
  'Character':            { limit:68, mode:'end',   rename:'Archer' },
};
const isLockEv = e => e.type==='creationLocked'||e.type==='creationUnlocked'||e.type==='creationLockConfig';
const clean = l => l.filter(Boolean).filter(e => !isLockEv(e) && e.type!=='award').map(e=>JSON.parse(JSON.stringify(e)));
const pkey = e => e.cat==='patch' ? 'P:'+Object.keys(e.payload?.patch||{}).sort().join(',') : null;
const out = [];
for (const c of live) {
  const p = PLAN[c.name]; const cur = clean(c.stats.LOG);
  let pre, post = [];
  if (p.mode==='live') { const k = cur.findIndex(e=>e.label===p.crossLabel); pre = cur.slice(0,k+1); post = cur.slice(k+1); }
  else if (p.mode==='snap') {
    const snap = snaps.find(s=>s.cur===c.name && s.t.startsWith(p.at)); pre = clean(snap.log);
    const used = {}; for (const e of pre) if (!pkey(e)) used[e.label]=(used[e.label]||0)+1;
    const preP = {}; for (const e of pre) if (pkey(e)) preP[pkey(e)] = JSON.stringify(e.payload);
    for (const e of cur) {
      if (pkey(e)) { if (preP[pkey(e)] !== JSON.stringify(e.payload)) post.push(e); }
      else if (e.type==='buy'||e.type==='buyoff') { if (used[e.label]>0) used[e.label]--; else post.push(e); }
      else if (!pre.some(x=>x.type===e.type && x.type!=='buy')) post.push(e);
    }
  } else { pre = cur; }
  const lockTs = (pre[pre.length-1]?.ts||Date.now())+1;
  const name = (p.rename||c.name) + ' lock check (DM copy)';
  let log = [
    { type:'award', amount:c.ap, noLock:true, note:'DM AP', label:`DM AP total at copy time (${c.ap} AP)`, ts: pre[0]?.ts||Date.now() },
    { type:'name', name, label:'Name — '+name, ts: pre[0]?.ts||Date.now() },
    { type:'creationLockConfig', payload:{ threshold:p.limit }, label:`Creation limit set by DM — ${p.limit} AP (+ drawbacks)`, ts: pre[0]?.ts||Date.now() },
    ...pre.filter(e=>e.type!=='name'),
    ...(p.mode==='none' ? [] : [{ type:'creationLocked', label:'Creation locked — backdated by DM (lock-check copy, 2026-10-04)', ts: lockTs }]),
    ...post.filter(e=>e.type!=='name').map(e=>{ const x={...e}; delete x.noLock; return x; }),
  ];
  // re-price every purchase under current rules (Q1), drawbacks keep their own grant
  for (let i=0;i<log.length;i++) { const e=log[i]; if ((e.type==='buy'||e.type==='buyoff') && e.cat!=='drawback') {
    e.cost = compute(foldBuild(log.slice(0,i+1)),OPTS).total - compute(foldBuild(log.slice(0,i)),OPTS).total; } }
  log = log.map((e,i)=>({ ...e, seq:i+1, rules:DATA.version }));
  const id = randomUUID();
  const stats = { schema:'pact-character/1', rules:DATA.version, name, LOG:log, SEQ:log.length+1, id };
  const b = foldBuild(log), r = compute(b,OPTS), sp = economy(log).spent;
  const li = log.findIndex(e=>e.type==='creationLocked');
  const at = li<0 ? null : compute(foldBuild(log.slice(0,li)),OPTS).total;
  const ceil = creationCeiling(log,{drawbackAp:r.drawbackAp||0, spent:sp});
  out.push({ id, name, kind:c.kind, source:c.name, stats,
    check:{ ledger:sp, engine:r.total, match:sp===r.total, ceiling:ceil.ceiling, locked:ceil.locked, spentAtLock:at,
            afterLock: li<0?[]:log.slice(li+1).filter(e=>e.type==='buy'||e.type==='buyoff').map(e=>`${e.label} (${e.cost})`) } });
}
writeFileSync(process.argv[4], JSON.stringify(out));
for (const o of out) console.log(o.source.padEnd(22), JSON.stringify(o.check));
