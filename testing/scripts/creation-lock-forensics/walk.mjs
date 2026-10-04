import { readFileSync } from 'node:fs';
import { economy, compute, foldBuild } from '../../../js/engine.js';
const chars = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const LIMIT = { 'Anders Pipeleaf':72, 'Caspian':74, 'Fenwick Copperkettle':74, 'Skylar':76, 'Character':68, 'Moss Stormspud':79 };
const only = process.argv[3];
for (const c of chars) {
  if (only && c.name !== only) continue;
  const log = c.stats.LOG.filter(Boolean);
  console.log(`\n=== ${c.name} (${c.kind}) — DM limit ${LIMIT[c.name]} + drawbacks`);
  let prevSpent = 0, crossed = null;
  for (let i = 0; i < log.length; i++) {
    const e = log[i], pre = log.slice(0, i + 1);
    const spent = economy(pre).spent;
    const dAp = compute(foldBuild(pre), { drawbackCap: 12 }).drawbackAp || 0;
    const ceil = LIMIT[c.name] + dAp;
    const d = spent - prevSpent; prevSpent = spent;
    const ts = e.ts ? new Date(e.ts).toLocaleString('en-AU',{timeZone:'Australia/Perth',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}) : '';
    const mark = (crossed === null && spent > ceil) ? '  <<< CROSSES LIMIT' : '';
    if (mark) crossed = i + 1;
    if (e.type === 'buy' || e.type === 'buyoff' || /creation|award/.test(e.type) || mark)
      console.log(`${String(i+1).padStart(3)} ${ts.padEnd(18)} ${e.type.padEnd(18)} ${(e.label||'').slice(0,48).padEnd(48)} ${String(d).padStart(4)} → spent ${String(spent).padStart(3)} / limit ${ceil}${mark}`);
  }
}
