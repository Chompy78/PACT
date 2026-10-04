import { readFileSync } from 'node:fs';
import { compute, foldBuild, economy, creationCeiling, chargesGoldAndTime } from '../../../js/engine.js';
const rows = JSON.parse(readFileSync(process.argv[2],'utf8'));
for (const r of rows) {
  const log = r.log.filter(Boolean); const res = compute(foldBuild(log),{drawbackCap:12});
  const li = log.findIndex(e=>e.type==='creationLocked');
  const before = li<0?null:compute(foldBuild(log.slice(0,li)),{drawbackCap:12}).total;
  const cross = li<0?'-':log[li-1].label;
  const after = li<0?[]:log.slice(li+1).filter(e=>e.type==='buy').map(e=>e.label);
  // gold/downtime liability: purchases after the lock, per engine rule
  const goldItems = log.map((e,i)=>({e,i})).filter(({e,i})=>e.type==='buy' && i>li && li>=0 && chargesGoldAndTime(log.slice(0,i)));
  const ceil = creationCeiling(log,{drawbackAp:res.drawbackAp||0,spent:economy(log).spent});
  console.log(JSON.stringify({ name:r.name, inCampaign:!!r.campaign, spent:res.total, ledger:economy(log).spent, limit:ceil.ceiling, locked:ceil.locked, spentAtLock:before, crossing:cross, inPlayCount:after.length, goldDowntimeItems:goldItems.length }));
}
