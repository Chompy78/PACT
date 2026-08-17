#!/usr/bin/env node
/**
 * gen-appendix-j.mjs — emit the Players Guide's "Appendix J: Subclass Bonus Spells" table from the
 * live engine, so every figure in it is engine-sourced rather than hand-typed.
 *
 * Run it, paste the output into the guide before </main>, then let guide-bundle-check.mjs guard it.
 * This is a one-shot generator, not a build step: the guide is a static file with no build, and
 * guide-bundle-check.mjs is what keeps the pasted table honest afterwards.
 *
 *   node testing/scripts/gen-appendix-j.mjs > /tmp/appendix-j.html
 */
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const { DATA } = await import(resolve(join(HERE, '..', '..', 'js', 'engine-data.js')));

// The derivation, straight out of the spell economy: a bundle prices the spells the subclass grants
// at its first two or three grant levels, and every spell above that rides along free.
const ku = DATA.knownUnit;
const spend = (levels, dd) => levels.reduce((a, L) => a + Math.max(1, ku[L - 1] - dd), 0);
const CANTRIP = DATA.cantCum[1];                       // a subclass cantrip is a flat 4 AP
const SHAPE = {
  full:   { levels: [1, 1, 2, 2, 3, 3], say: 'two spells each at 1st, 2nd and 3rd level' },
  half:   { levels: [1, 1, 2, 2],       say: 'two spells each at 1st and 2nd level' },
  ranger: { levels: [1, 2],             say: 'one spell each at 1st and 2nd level' },
};
const shapeOf = cls => cls === 'Ranger' ? SHAPE.ranger : cls === 'Paladin' ? SHAPE.half : SHAPE.full;

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#x27;');
const HDR = '#B89968', CLS = '#E5D8B8', A = '#F2E5C8', B = '#FBF5E9';
const row = (bg, cells) => `<tr>${cells.map(c => `<td style="background:${bg}">${c}</td>`).join('')}</tr>`;

const bundleClasses = DATA.classes.filter(c => (DATA.subList[c] || [])
  .some(s => ((DATA.subclasses[c] || {})[s] || {}).spellBundle));

const out = [];
out.push(`<tr>${['Class', 'Subclass', 'Bundle AP<br>Cross (Origin)', 'Cantrips', 'The working']
  .map(h => `<td style="background:${HDR}"><span style="color:#58180D"><strong>${h}</strong></span></td>`).join('')}</tr>`);

let outliers = [];
for (const cls of bundleClasses) {
  out.push(row(CLS, [`<strong>${cls}</strong>`, '&nbsp;', '&nbsp;', '&nbsp;', '&nbsp;']));
  let band = A;
  for (const sub of (DATA.subList[cls] || [])) {
    const bn = ((DATA.subclasses[cls] || {})[sub] || {}).spellBundle;
    let price, cant, working;
    if (!bn) {
      price = '<strong>none</strong>';
      cant = '—';
      working = `This subclass grants no bonus spells. There is no bundle, no option and nothing to buy — the tools show no purchase for it, and that is correct, not an omission.`;
    } else {
      const sh = shapeOf(cls);
      const c = bn.cantrips || 0;
      const baseX = spend(sh.levels, 0), baseO = spend(sh.levels, 1);
      const derX = baseX + c * CANTRIP, derO = baseO + c * CANTRIP;
      price = bn.origin === bn.cross ? `<strong>${bn.cross}</strong>` : `<strong>${bn.cross}</strong> (${bn.origin})`;
      cant = c ? String(c) : '—';
      const spellsPart = `${sh.say} — ${sh.levels.map(L => Math.max(1, ku[L - 1])).join(' + ')} = ${baseX} AP`;
      const originPart = baseO === baseX
        ? `every spell is already at the 1 AP floor, so the origin discount cannot bite — the price is flat either way`
        : `as your origin class each drops by 1 (floored at 1) = ${baseO} AP`;
      const cantPart = c ? `; plus ${c} cantrip${c > 1 ? 's' : ''} at ${CANTRIP} AP each` : '';
      working = `${spellsPart}; ${originPart}${cantPart}.`;
      if (derX !== bn.cross || derO !== bn.origin) {
        outliers.push(`${cls} · ${sub}`);
        working += ` <strong>Set by hand:</strong> the working above gives ${derX} (${derO}), but this bundle is charged at ${bn.cross}${bn.origin === bn.cross ? '' : ` (${bn.origin})`}.`;
      }
    }
    out.push(row(band, [`&nbsp;`, `<strong>${esc(sub)}</strong>`, price, cant, working]));
    band = band === A ? B : A;
  }
}

const noneClasses = DATA.classes.filter(c => !bundleClasses.includes(c) && (DATA.subList[c] || []).length);

console.log(`<h2 id="appendix-j-subclass-bonus-spells">Appendix J: Subclass Bonus Spells</h2>`);
console.log(`<p>Six classes have subclasses that grant bonus spells: <strong>${bundleClasses.join(', ')}</strong>. No subclass of ${noneClasses.slice(0, -1).join(', ')} or ${noneClasses.slice(-1)} grants any — where those classes gain extra magic they gain it through a priced feature instead, on the Master Cost Table like any other ability.</p>`);
console.log(`<p>Every bundle below is one purchase at one price, covering the subclass&#x27;s whole expanded list. The <em>Cross (Origin)</em> column follows the same convention as Appendix B: the bold figure is what anyone pays, the bracketed figure what you pay when that class is your origin class. A single bold figure with no bracket means the price is the same either way. The <em>working</em> column shows where the number comes from, so you can see that a flat price is a floor effect rather than an oversight — and so that a subclass with <strong>none</strong> reads as a rule rather than a missing row.</p>`);
console.log(`<p>Two details the working relies on. A bundle&#x27;s cantrips are charged a flat ${CANTRIP} AP each, not on the escalating cantrip ladder in §12 — they sit outside your cantrip count entirely, which is also why they never eat into your cap. And the origin discount is a straight −1 per spell with a floor of 1 AP, so a bundle made only of 1st- and 2nd-level spells is already at the floor and costs the same whether the class is your origin or not.</p>`);
console.log(`<div class="tablewrap"><table class="tbl">`);
console.log(out.join(''));
console.log(`</table></div>`);
if (outliers.length) {
  console.log(`<p><strong>The ${outliers.length} hand-set bundles.</strong> ${outliers.join(', ')} are charged a price the working does not produce — each figure was set directly rather than derived, and the tools charge the figure. Where the two disagree the printed price is what you pay. The other ${21 - outliers.length} bundles fall out of the per-spell costs exactly.</p>`);
}
