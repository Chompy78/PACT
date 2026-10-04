import { readFileSync } from 'node:fs';
import { economy, compute, foldBuild } from '../../../js/engine.js';
const chars = JSON.parse(readFileSync(process.argv[2],'utf8'));
const LIMIT = { 'Anders Pipeleaf':72, 'Caspian':74, 'Fenwick Copperkettle':74, 'Skylar':76, 'Character':68, 'Moss Stormspud':79 };
for (const c of chars) {
  const log=c.stats.LOG.filter(Boolean); const r=compute(foldBuild(log),{drawbackCap:12});
  const awards = c.ap; const ceil = LIMIT[c.name]+(r.drawbackAp||0);
  console.log(c.name.padEnd(22), 'ledger', String(economy(log).spent).padStart(4), '| engine total', String(r.total).padStart(4), '| limit', ceil, '| DM AP', awards, '+ drawbacks', r.drawbackAp);
}
