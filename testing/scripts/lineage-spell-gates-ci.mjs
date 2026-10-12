#!/usr/bin/env node
/**
 * PACT — lineage spell-likes are gated by the PHB 2024 character level, and CharGen enforces it
 * (fix/lineage-spell-gates, D-GH-2026-10-11-lineage-spell-gates, rules v0.373).
 *
 * WHY THIS EXISTS. Two defects, reported by the owner on 2026-10-11:
 *   1. CharGen labelled a Tiefling's Darkness "L3". The number was an internal gate index, not a spell level
 *      (Darkness is 2nd-level) — it had been stored as a "3rd-level" spell only so DATA.hdGate would give it 5 HD.
 *   2. CharGen let any character buy every lineage spell at 1 Hit Die; only the engine warned. And the six
 *      1st-level lineage spells (Hellish Rebuke, Faerie Fire, …) had no gate at all, although the PHB grants
 *      them at character level 3.
 * Each lineage spell now states its own Hit Dice (DATA.lineageSpells entries are [name, AP, level, HD]); the
 * engine's lineageSpellHD()/lineageSpellLabel() are the only readers, and CharGen greys a spell below its gate
 * the same way it greys a tiered racial trait.
 *
 * USAGE:  node testing/scripts/lineage-spell-gates-ci.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const E = await import(path.join(REPO, 'js/engine.js'));
const { DATA, compute, baseBuild, lineageSpellHD, lineageSpellLabel } = E;

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

console.log('\n[lineage-spell-gates] == engine ==');
// The PHB 2024 table, written out independently of the data: the cantrip at level 1, the 1st-level spell at 3,
// the 2nd-level spell at 5. Forest gnomes get Speak with Animals at level 1; Rock gnomes have only cantrips.
const PHB = {
  Drow: [['Dancing Lights', 0, 1], ['Faerie Fire', 1, 3], ['Darkness', 2, 5]],
  High: [['Prestidigitation', 0, 1], ['Detect Magic', 1, 3], ['Misty Step', 2, 5]],
  Wood: [['Druidcraft', 0, 1], ['Longstrider', 1, 3], ['Pass without Trace', 2, 5]],
  Forest: [['Minor Illusion', 0, 1], ['Speak with Animals', 1, 1]],
  Rock: [['Mending', 0, 1], ['Prestidigitation', 0, 1]],
  Infernal: [['Fire Bolt', 0, 1], ['Hellish Rebuke', 1, 3], ['Darkness', 2, 5]],
  Abyssal: [['Poison Spray', 0, 1], ['Ray of Sickness', 1, 3], ['Hold Person', 2, 5]],
  Chthonic: [['Chill Touch', 0, 1], ['False Life', 1, 3], ['Ray of Enfeeblement', 2, 5]],
};
check('every lineage in the data is covered by this table (a new one must be added here)',
  Object.keys(DATA.lineageSpells).sort().join() === Object.keys(PHB).sort().join(), Object.keys(DATA.lineageSpells).join());
for (const [lin, rows] of Object.entries(PHB)) {
  const data = DATA.lineageSpells[lin] || [];
  const got = data.map(sp => [sp[0], sp[2], lineageSpellHD(sp)]);
  check(`${lin}: spell levels and Hit Dice match the PHB`, JSON.stringify(got) === JSON.stringify(rows), JSON.stringify(got));
}
const dark = DATA.lineageSpells.Infernal.find(sp => sp[0] === 'Darkness');
check('Darkness is labelled as the 2nd-level spell it is, with its real gate — never "L3"',
  lineageSpellLabel(dark) === '2nd-level · 1/long rest · needs 5 HD' && !/\bL\d/.test(lineageSpellLabel(dark)), lineageSpellLabel(dark));
check('a cantrip is labelled cap-exempt with no gate', lineageSpellLabel(DATA.lineageSpells.Infernal[0]) === 'cantrip · cap-exempt');
check('prices are unchanged (Fire Bolt 4, Hellish Rebuke 6, Darkness 12)',
  DATA.lineageSpells.Infernal.map(sp => sp[1]).join() === '4,6,12');
check('the pre-v0.373 three-element shape still resolves through hdGate (old data cannot silently drop its gate)',
  lineageSpellHD(['X', 12, 3]) === 5 && lineageSpellHD(['X', 4, 0]) === 1);

const tiefling = (hd, spells) => Object.assign(baseBuild(), { species: 'Tiefling', lineage: 'Infernal', hd, racialSpells: spells });
const warn = (b) => compute(b).warnings.filter(w => /^Lineage spell /.test(w));
check('Hellish Rebuke at 2 HD warns that it needs 3 Hit Dice', warn(tiefling(2, ['Hellish Rebuke'])).join() === 'Lineage spell Hellish Rebuke needs 3 Hit Dice', warn(tiefling(2, ['Hellish Rebuke'])).join());
check('...and not at 3 HD', warn(tiefling(3, ['Hellish Rebuke'])).length === 0);
check('Darkness at 4 HD warns that it needs 5 Hit Dice', warn(tiefling(4, ['Darkness'])).join() === 'Lineage spell Darkness needs 5 Hit Dice');
check('...and not at 5 HD', warn(tiefling(5, ['Darkness'])).length === 0);
check('Fire Bolt (cantrip) never warns, even at 1 HD', warn(tiefling(1, ['Fire Bolt'])).length === 0);
check('the gate is a HARD refusal for purchaseLegality (not a soft advisory)',
  E.purchaseLegality(tiefling(1, []), 'racialspell', { v: 'Hellish Rebuke' }).hard.some(w => /needs 3 Hit Dice/.test(w)));

console.log('\n[lineage-spell-gates] == CharGen greys a lineage spell below its Hit Dice ==');
const { launchChromium } = await import('./lib/launch-chromium.mjs');
const PORT = Number(process.env.PACT_E2E_PORT) || 7981;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/PACT\/?/, '') || 'index.html';
  fs.readFile(path.join(REPO, rel), (e, d) => {
    if (e) { r.writeHead(404); return r.end('not found'); }
    r.writeHead(200, { 'Content-Type': MIME[path.extname(rel)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    r.end(d);
  });
});
await new Promise(r => server.listen(PORT, r));
const browser = await launchChromium();
try {
  const p = await (await browser.newContext()).newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(`http://localhost:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.DATA && window.lineageSpellHD && document.querySelector('.linspellck'), null, { timeout: 30000 });
  const set = async (id, v) => { await p.evaluate(([id, v]) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]); await p.waitForTimeout(300); };
  const state = () => p.evaluate(() => {
    const row = n => { const cb = [...document.querySelectorAll('.linspellck')].find(c => c.dataset.lin === 'Infernal' && c.value === n);
      return cb ? { disabled: cb.disabled, faded: cb.parentElement.style.opacity === '0.55', dsc: (cb.parentElement.querySelector('.dsc') || {}).textContent } : null; };
    return { fire: row('Fire Bolt'), rebuke: row('Hellish Rebuke'), dark: row('Darkness') };
  });
  await set('spec', 'Tiefling'); await set('lineage', 'Infernal'); await set('hd', '1');
  let s = await state();
  check('the picker shows the engine wording, not "L3"', s.dark && s.dark.dsc === '2nd-level · 1/long rest · needs 5 HD', JSON.stringify(s.dark));
  check('at 1 HD the cantrip is buyable', s.fire && !s.fire.disabled, JSON.stringify(s.fire));
  check('at 1 HD Hellish Rebuke (needs 3) is greyed and faded', s.rebuke && s.rebuke.disabled && s.rebuke.faded, JSON.stringify(s.rebuke));
  check('at 1 HD Darkness (needs 5) is greyed and faded', s.dark && s.dark.disabled && s.dark.faded, JSON.stringify(s.dark));
  await set('hd', '3'); s = await state();
  check('at 3 HD Hellish Rebuke opens; Darkness stays greyed', !s.rebuke.disabled && s.dark.disabled, JSON.stringify(s));
  await set('hd', '5'); s = await state();
  check('at 5 HD Darkness opens', !s.dark.disabled, JSON.stringify(s.dark));
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
} finally {
  await browser.close(); server.close();
}

console.log(`\n${fail ? '✗' : '✓'} ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
