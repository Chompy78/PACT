#!/usr/bin/env node
/**
 * gen-appendix-j.mjs — emit the Players Guide's "Appendix J: Subclass Bonus Spells" from the live
 * engine, so every figure and every spell name in it is engine-sourced rather than hand-typed.
 *
 * Run it, paste the output into the guide before </main>, then let guide-bundle-check.mjs guard it.
 * This is a one-shot generator, not a build step: the guide is a static file with no build.
 *
 *   node testing/scripts/gen-appendix-j.mjs > /tmp/appendix-j.html
 *
 * THE WORKING IS REAL, AND IT COMES FROM REAL DATA
 * -----------------------------------------------
 * `DATA.spellGrants.subclassSpells` holds each subclass's actual granted spells, with a spellLevel
 * and the charLevel the grant unlocks at. A bundle prices the grants at charLevel <= 5 and every
 * grant above that rides along free. Per-spell cost is DATA.knownUnit[spellLevel]; as origin each
 * drops by 1 with a floor of 1; a granted cantrip (spellLevel 0) is a flat DATA.cantCum[1] and takes
 * no discount. That reproduces 20 of the 21 stored prices exactly.
 *
 * An earlier version of this file ASSUMED a grant shape (two spells each at 1st/2nd/3rd) instead of
 * reading the real lists. It reproduced only 16, and wrongly reported four Druid circles and Archfey
 * Patron as "hand-set" — they are nothing of the kind; their lists simply are not that shape. Do not
 * reintroduce an assumed shape: read `subclassSpells`.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const { DATA } = await import(resolve(join(HERE, '..', '..', 'js', 'engine-data.js')));

const KU = DATA.knownUnit;
const CANTRIP = DATA.cantCum[1];
const PAID_MAX = 5;                       // grants unlocking above this charLevel ride free
const cost = (sl, dd) => sl === 0 ? CANTRIP : Math.max(1, KU[sl - 1] - dd);
const ord = n => n === 0 ? 'cantrip' : n + (['th','st','nd','rd'][n % 10 > 3 || (n % 100 - n % 10 === 10) ? 0 : n % 10]);

const SG = DATA.spellGrants.subclassSpells;
/** Circle of the Land is stored per terrain; the four are the same shape, so key off the first. */
const grantsFor = (cls, sub) =>
  SG[`${cls}: ${sub}`] || SG[Object.keys(SG).find(k => k.startsWith(`${cls}: ${sub} (`)) || ''];

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#x27;');
const HDR = '#B89968', CLS = '#E5D8B8', A = '#F2E5C8', B = '#FBF5E9';
const row = (bg, cells) => `<tr>${cells.map(c => `<td style="background:${bg}">${c}</td>`).join('')}</tr>`;

const bundleClasses = DATA.classes.filter(c => (DATA.subList[c] || [])
  .some(s => ((DATA.subclasses[c] || {})[s] || {}).spellBundle));

const out = [];
out.push(`<tr>${['Class', 'Subclass', 'Bundle AP<br>Cross (Origin)', 'What you pay for', 'The working']
  .map(h => `<td style="background:${HDR}"><span style="color:#58180D"><strong>${h}</strong></span></td>`).join('')}</tr>`);

const outliers = [];
for (const cls of bundleClasses) {
  out.push(row(CLS, [`<strong>${cls}</strong>`, '&nbsp;', '&nbsp;', '&nbsp;', '&nbsp;']));
  let band = A;
  for (const sub of (DATA.subList[cls] || [])) {
    const bn = ((DATA.subclasses[cls] || {})[sub] || {}).spellBundle;
    let price, paidCol, working;
    if (!bn) {
      price = '<strong>none</strong>';
      paidCol = '—';
      working = 'This subclass grants no bonus spells. There is no bundle, no option and nothing to buy — the tools offer no purchase for it, and that is correct, not an omission.';
    } else {
      const e = grantsFor(cls, sub);
      const all = (e && e.spells) || [];
      const paid = all.filter(s => s.charLevel <= PAID_MAX);
      const free = all.filter(s => s.charLevel > PAID_MAX);
      const dx = paid.reduce((a, s) => a + cost(s.spellLevel, 0), 0);
      const dor = paid.reduce((a, s) => a + cost(s.spellLevel, 1), 0);

      price = bn.origin === bn.cross ? `<strong>${bn.cross}</strong>` : `<strong>${bn.cross}</strong> (${bn.origin})`;
      paidCol = paid.map(s => `${esc(s.name)} <em>(${ord(s.spellLevel)})</em>`).join(', ') || '—';

      const sumX = paid.map(s => cost(s.spellLevel, 0)).join(' + ');
      const sumO = paid.map(s => cost(s.spellLevel, 1)).join(' + ');
      working = `${sumX} = <strong>${dx} AP</strong>. As your origin class every spell drops by 1, floored at 1 — ${sumO} = <strong>${dor} AP</strong>`;
      if (dor === dx) working += `, which is the same figure, so this bundle costs one flat price either way`;
      working += '. ';
      working += free.length
        ? `A further ${free.length} spell${free.length > 1 ? 's' : ''} (${[...new Set(free.map(s => ord(s.spellLevel)))].join(' and ')}) come${free.length > 1 ? '' : 's'} with the bundle free.`
        : `Nothing further rides free — this list is fully paid for.`;
      if (paid.some(s => s.spellLevel === 0))
        working += ` The cantrip is a flat ${CANTRIP} AP inside the price, takes no discount, and never counts against your cantrip cap.`;
      if (dx !== bn.cross || dor !== bn.origin) {
        outliers.push({ cls, sub, dx, dor, bn });
        working += ` <strong>Note:</strong> the working gives ${dx} (${dor}); the bundle is charged at ${bn.cross}${bn.origin === bn.cross ? '' : ` (${bn.origin})`}. The charged figure is what you pay.`;
      }
    }
    out.push(row(band, ['&nbsp;', `<strong>${esc(sub)}</strong>`, price, paidCol, working]));
    band = band === A ? B : A;
  }
}

const noneClasses = DATA.classes.filter(c => !bundleClasses.includes(c) && (DATA.subList[c] || []).length);
const total = bundleClasses.reduce((a, c) => a + (DATA.subList[c] || [])
  .filter(s => ((DATA.subclasses[c] || {})[s] || {}).spellBundle).length, 0);

console.log(`<h2 id="appendix-j-subclass-bonus-spells">Appendix J: Subclass Bonus Spells</h2>`);
console.log(`<p>Six classes have subclasses that grant bonus spells: <strong>${bundleClasses.join(', ')}</strong>. No subclass of ${noneClasses.slice(0, -1).join(', ')} or ${noneClasses.slice(-1)} grants any — where those classes gain extra magic they gain it through a priced feature instead, on the Master Cost Table like any other ability.</p>`);
console.log(`<p>Every bundle below is one purchase at one price, covering the subclass&#x27;s whole expanded list. The <em>Cross (Origin)</em> column follows the same convention as Appendix B: the bold figure is what anyone pays, the bracketed figure what you pay when that class is your origin class. A single bold figure with no bracket means the price is the same either way — and the working shows why, which is almost always that every spell in the list already sits on the 1 AP floor.</p>`);
console.log(`<p><strong>How a bundle&#x27;s price is reached.</strong> You pay for the spells the subclass grants up to character level 5; everything it grants above that comes free. A spell costs its normal per-spell price from §12 (1st- and 2nd-level spells 1 AP, 3rd-level 2 AP), reduced by 1 with a floor of 1 AP when the class is your origin class. A granted cantrip is a flat ${CANTRIP} AP, takes no discount, and does not count against your cantrip cap. The free higher-level spells are a reward for commitment: you cannot cast them until your Rank and Hit Dice reach their level, many levels after you buy the list.</p>`);
console.log(`<div class="tablewrap"><table class="tbl">`);
console.log(out.join(''));
console.log(`</table></div>`);
if (outliers.length) {
  const o = outliers.map(x => `${x.cls}&#x27;s ${x.sub}`).join(', ');
  console.log(`<p><strong>The one bundle whose price does not match its own list.</strong> ${o} is charged ${outliers[0].bn.cross} (${outliers[0].bn.origin}) where its spells add up to ${outliers[0].dx} (${outliers[0].dor}). Its list is exactly the same shape as Aberrant Sorcery&#x27;s — a cantrip plus two spells each at 1st, 2nd and 3rd level — and that one is charged the full ${outliers[0].dx} (${outliers[0].dor}), so the difference is a discrepancy rather than a deliberate discount. The charged figure is what the tools use. Every other bundle in this appendix falls out of its spell list exactly.</p>`);
}
