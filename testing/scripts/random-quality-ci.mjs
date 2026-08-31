/**
 * PACT — headless QUALITY gate for the 🎲 random character generator.
 * -------------------------------------------------------------------
 * WHY THIS EXISTS. Nothing checked what `randomizeBuild()` actually produces. `random-manual-e2e.mjs`
 * says so in its own header — it deliberately never calls the built-in roll, because its job is to drive
 * the UI the way a human would. `tool-pricing-ci.mjs` calls `randomizeRoll()` exactly once, and only to
 * assert that appearance data survives the LOG resync. So the generator could (and did) regress in ways
 * no gate would notice: before feat/random-char-generator-optimize it capped Hit Dice at 9 for every
 * budget on earth, and at 600 AP produced characters where 100% owned light armour + shield + simple
 * weapons and ~96% owned heavy armour + all martial weapons regardless of class.
 *
 * WHAT IT CHECKS. Statistical properties of many real rolls, not one golden output — a random generator
 * has no fixed expected value, so the assertions are all "over N rolls, this must hold" invariants:
 *   · legality      — every roll stays within budget and adds no hard (⚠) warning
 *   · level         — Hit Dice track the level the AP budget actually pays for (the old bug)
 *   · coherence     — armour and weapon proficiency never exceed the rolled theme's declared ceiling
 *   · theme signal  — the theme's favoured boon/art categories really do dominate its picks
 *   · diversity     — two rolls of the SAME theme still differ (a theme must not collapse to one build)
 *
 * WHY IT DRIVES THE REAL TOOL. The generator lives inside tools/PACT-CharGen-Webtool.html and depends on
 * the DOM (readBuild/applyBuild/the LOG resync). A Node re-implementation of its search loop would be a
 * second copy of the logic that drifts from the first — the exact failure mode AGENTS.md warns about for
 * rules code. So this loads the actual page and calls the actual function.
 *
 * WHY NOT PLAYWRIGHT. AGENTS.md forbids npm in this repo, so the Playwright-based e2e scripts cannot run
 * in a CLI session. This uses the same zero-dependency Chrome DevTools Protocol harness as
 * tool-pricing-ci.mjs — Node built-ins only, plus a Chromium binary that already exists.
 *
 * USAGE   node testing/scripts/random-quality-ci.mjs
 *         CHROME_BIN=/path/to/chrome node testing/scripts/random-quality-ci.mjs
 *         ROLLS=12 node testing/scripts/random-quality-ci.mjs      # rolls per theme (default 8)
 * Exits 0 clean · 1 on a quality failure · 2 no browser · 3 browser found but never started.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 8733, CDP_PORT = 9335;          // distinct from tool-pricing-ci's 8731/9333 so both can run at once
const ROLLS = Math.max(3, +(process.env.ROLLS || 8));

function findChrome() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (fs.existsSync(root)) {
    for (const d of fs.readdirSync(root).filter(x => x.startsWith('chromium')).sort().reverse()) {
      for (const rel of ['chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
        const p = path.join(root, d, rel);
        if (fs.existsSync(p)) return p;
      }
    }
    const flat = path.join(root, 'chromium');
    if (fs.existsSync(flat) && fs.statSync(flat).isFile()) return flat;
  }
  for (const q of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
                   '/usr/bin/google-chrome-stable',
                   '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']) {
    if (fs.existsSync(q)) return q;
  }
  return null;
}

const MIME = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json',
               '.css':'text/css', '.webp':'image/webp', '.png':'image/png', '.svg':'image/svg+xml' };
function serve() {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/PACT\//, '');
      const f = path.join(REPO, rel);
      if (!f.startsWith(REPO) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      res.end(fs.readFileSync(f));
    });
    s.listen(PORT, () => resolve(s));
  });
}

async function connect(url) {
  const t = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise(r => (ws.onopen = r));
  const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise(r => pending.set(i, r)); };
  await send('Page.enable'); await send('Runtime.enable');
  return {
    close: async () => { ws.close(); await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${t.id}`); },
    async evaluate(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      const ex = r.result?.exceptionDetails;
      if (ex) throw new Error('page threw: ' + (ex.exception?.description || ex.text || 'unknown') + `\n    while evaluating: ${expr.slice(0, 200)}`);
      return r.result?.result?.value;
    }
  };
}
// Same readiness contract as the other CDP gate: the tools boot on `engine-ready` from a deferred module,
// so classic-script globals exist well before the engine ones do. Poll a bridged symbol, never sleep.
const READY = (probe) => `(async()=>{for(let i=0;i<300;i++){if(${probe})return true;await new Promise(r=>setTimeout(r,100));}return false;})()`;

let pass = 0, fail = 0;
function check(name, ok, detail) {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${ok || detail === undefined ? '' : `  — ${detail}`}`);
}

const chrome = findChrome();
if (!chrome) {
  console.error('No Chromium found. Set CHROME_BIN, or install one where PLAYWRIGHT_BROWSERS_PATH points.');
  process.exit(2);
}
const server = await serve();
const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${fs.mkdtempSync('/tmp/pact-roll-')}`, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeErr = '', chromeExit = null;
proc.stderr.on('data', d => { chromeErr += d.toString().slice(0, 4000); });
proc.on('exit', c => { chromeExit = c; });
proc.on('error', e => { chromeErr += `spawn error: ${e.message}\n`; });

let cdpUp = false; const t0 = Date.now();
for (let i = 0; i < 300; i++) {
  try { await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`); cdpUp = true; break; }
  catch { await new Promise(r => setTimeout(r, 100)); }
}
if (!cdpUp) {
  console.error(`\n✗ Chromium never opened its DevTools port ${CDP_PORT} within 30s.`);
  console.error(`  binary       : ${chrome}`);
  console.error(`  waited       : ${Date.now() - t0} ms`);
  console.error(`  chrome exited: ${chromeExit === null ? 'no — started but never bound the port' : chromeExit}`);
  console.error(`  chrome stderr: ${chromeErr.trim() || '(nothing)'}`);
  console.error(`\n  This is an ENVIRONMENT failure, not a generator regression — no assertion ran.`);
  try { proc.kill(); } catch {}
  server.close();
  process.exit(3);
}

// Roll once in the page and return everything the assertions need. Runs entirely page-side so each roll
// costs one CDP round trip rather than a dozen. `_qaRoll` is defined here, not in the tool — the tool
// gets no test-only entry point.
const ROLL_FN = `
window._qaRoll=function(themeKey,budget,forceClass){
  // Reset to a clean sheet, then set the AP budget through the tool's own award path so the LOG carries
  // a real award event (the same thing typing in the AP box does).
  // resetBuild(), not newCharacter(): the latter is async and awaits a cloud-save flush, which this
  // signed-out harness neither needs nor can complete.
  if(typeof resetBuild==='function'){try{resetBuild();}catch(e){}}
  var bi=document.getElementById('budget'); bi.value=String(budget);
  if(typeof _cgSyncAward==='function')_cgSyncAward();
  // A forced class exercises theme/class pairings the theme's own preference list would never produce
  // (a Fighter rolled as a Zealot, say) — which is exactly where the ability-priming bug lived.
  if(forceClass){var oc=document.getElementById('oclass'); if(oc){oc.value=forceClass; oc.dispatchEvent(new Event('change',{bubbles:true}));}}
  randomizeRoll(themeKey,0);
  var b=readBuild(), r=compute(b,(typeof _cgDmOpts==='function')?_cgDmOpts():{dmAp:0,ignorePlayerAp:false});
  var hard=(r.warnings||[]).filter(function(w){return (typeof isAdvisory==='function')?!isAdvisory(w):true;});
  var catsOf=function(list,src){var o={};(list||[]).forEach(function(k){var c=(src[k]||{}).cat||'(none)';o[c]=(o[c]||0)+1;});return o;};
  return {
    hd:b.hd, spent:r.total, spendable:r.spendable, hard:hard.length, hardText:hard.slice(0,3),
    species:b.species, cls:b.originClass,
    armour:{light:!!b.armour.light,medium:!!b.armour.medium,heavy:!!b.armour.heavy,shield:!!b.armour.shield},
    wpn:{simple:!!b.weaponProf.simple,martial:!!b.weaponProf.allMartial},
    nSkills:(b.skills||[]).length, nBoons:(b.boons||[]).length, nArts:(b.arts||[]).length,
    stats:b.stats, rank:((b.traditions||[])[0]||{}).rank||0,
    slots:(((((b.traditions||[])[0]||{}).disciplines||[])[0])||{}).slots||[],
    pactSlots:(((((b.traditions||[])[0]||{}).disciplines||[])[0])||{}).pactSlots||0,
    nRacial:(b.racialTraits||[]).length, nDraw:(b.drawbacks||[]).length,
    boonCats:catsOf(b.boons,DATA.boons), artCats:catsOf(b.arts,DATA.arts),
    kit:[].concat((b.skills||[]).map(function(x){return 's:'+x;}),
                  (b.boons||[]).map(function(x){return 'b:'+x;}),
                  (b.arts||[]).map(function(x){return 'a:'+x;}),
                  (b.tools||[]).map(function(x){return 't:'+x;}))
  };
};true`;

const jac = (A, B) => { const a = new Set(A), b = new Set(B); let i = 0; for (const x of a) if (b.has(x)) i++;
  const u = a.size + b.size - i; return u ? i / u : 1; };

try {
  const cg = await connect(`http://127.0.0.1:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`);
  if (!(await cg.evaluate(READY(`window.DATA&&typeof compute==='function'&&typeof randomizeRoll==='function'&&typeof readBuild==='function'`))))
    throw new Error('CharGen never became ready (engine-ready did not fire?)');
  await cg.evaluate(ROLL_FN);

  const themes = await cg.evaluate(`RTHEMES.map(function(t){return {key:t.key,label:t.label,armour:t.armour,shield:t.shield,weapons:t.weapons,cats:t.cats};})`);
  const ARM_RANK = { none: 0, light: 1, medium: 2, heavy: 3 };
  // Three budgets spanning the range the old code got wrong: level 1, mid, and the top of the curve.
  const BUDGETS = await cg.evaluate(`[DATA.levelAP[1],DATA.levelAP[10],DATA.levelAP[20]]`);
  const lvlOf = {};
  for (const B of BUDGETS) lvlOf[B] = await cg.evaluate(`apLevel(${B})`);

  console.log(`\nRandom generator quality — ${themes.length} themes x ${BUDGETS.length} budgets x ${ROLLS} rolls`);
  console.log(`budgets: ${BUDGETS.map(b => `${b} AP (Lv ${lvlOf[b]})`).join(' · ')}\n`);

  const all = [];
  for (const th of themes) {
    const rows = [];
    for (const B of BUDGETS) {
      for (let i = 0; i < ROLLS; i++) {
        rows.push({ B, ...(await cg.evaluate(`_qaRoll(${JSON.stringify(th.key)},${B})`)) });
      }
    }
    all.push({ th, rows });

    // ---- legality: the roll must never overspend or introduce a hard warning ----
    const over = rows.filter(r => r.spent > r.spendable);
    check(`${th.label} — never overspends`, over.length === 0,
      over.length ? `${over.length}/${rows.length} rolls over budget (worst ${Math.max(...over.map(r => r.spent - r.spendable))} AP)` : '');
    const warned = rows.filter(r => r.hard > 0);
    check(`${th.label} — no hard warnings`, warned.length === 0,
      warned.length ? `${warned.length}/${rows.length} rolls warned, e.g. ${JSON.stringify(warned[0].hardText)}` : '');

    // ---- level: HD must track the budget's level (this is the bug the change exists to fix) ----
    const short = rows.filter(r => r.hd < lvlOf[r.B]);
    check(`${th.label} — HD reaches the level the budget pays for`, short.length === 0,
      short.length ? `${short.length}/${rows.length} short, e.g. ${short[0].B} AP (Lv ${lvlOf[short[0].B]}) rolled HD ${short[0].hd}` : '');

    // ---- coherence: armour and weapons must respect the theme's ceiling ----
    const ceil = ARM_RANK[th.armour] ?? 3;
    const badArm = rows.filter(r => (r.armour.heavy ? 3 : r.armour.medium ? 2 : r.armour.light ? 1 : 0) > ceil);
    check(`${th.label} — armour never exceeds "${th.armour}"`, badArm.length === 0,
      badArm.length ? `${badArm.length}/${rows.length} broke the ceiling, e.g. ${JSON.stringify(badArm[0].armour)}` : '');
    const badW = rows.filter(r => (th.weapons === 'none' && (r.wpn.simple || r.wpn.martial)) ||
                                  (th.weapons === 'simple' && r.wpn.martial));
    check(`${th.label} — weapons never exceed "${th.weapons}"`, badW.length === 0,
      badW.length ? `${badW.length}/${rows.length} broke the ceiling` : '');
    const badShield = th.shield ? [] : rows.filter(r => r.armour.shield);
    check(`${th.label} — ${th.shield ? 'may take a shield' : 'takes no shield'}`, badShield.length === 0,
      badShield.length ? `${badShield.length}/${rows.length} took one anyway` : '');

    // ---- theme signal: the categories this theme favours must actually dominate its picks ----
    // Measured against the theme's OWN declared weights: sum the picks landing in its top-weighted
    // categories and require they beat the ones it weights at zero. THEME_SLIP guarantees the zero-weight
    // categories are never empty, so this is a "leads", not a "monopolises" — a strict check here would
    // be asserting the slip away, which is the behaviour we deliberately want.
    const tot = {};
    for (const r of rows) for (const src of [r.boonCats, r.artCats]) for (const k in src) tot[k] = (tot[k] || 0) + src[k];
    const wOf = c => (th.cats && th.cats[c] != null) ? th.cats[c] : 1;
    const favN = Object.keys(tot).filter(c => wOf(c) >= 4).reduce((s, c) => s + tot[c], 0);
    const zeroN = Object.keys(tot).filter(c => wOf(c) === 0).reduce((s, c) => s + tot[c], 0);
    check(`${th.label} — favoured categories lead the picks`, favN > zeroN,
      `favoured ${favN} vs zero-weighted ${zeroN} (of ${Object.values(tot).reduce((a, b) => a + b, 0)} picks)`);

    // ---- diversity: same theme, different characters ----
    const hi = rows.filter(r => r.B === BUDGETS[BUDGETS.length - 1]);
    let sum = 0, n = 0;
    for (let i = 0; i < hi.length; i++) for (let j = i + 1; j < hi.length; j++) { sum += jac(hi[i].kit, hi[j].kit); n++; }
    const mean = n ? sum / n : 0;
    check(`${th.label} — two rolls still differ (mean overlap ${mean.toFixed(2)} < 0.70)`, mean < 0.70,
      `mean Jaccard ${mean.toFixed(2)}`);
  }

  // ---- cross-theme: themes must be distinguishable from EACH OTHER, not just internally varied ----
  // The pre-change generator would have sailed through every per-theme check above and still produced
  // one character shape, because it had no themes to tell apart. This is the assertion that catches that.
  const topBudget = BUDGETS[BUDGETS.length - 1];
  let within = 0, wn = 0, between = 0, bn = 0;
  for (const A of all) for (const B of all) {
    const ra = A.rows.filter(r => r.B === topBudget), rb = B.rows.filter(r => r.B === topBudget);
    for (const x of ra) for (const y of rb) {
      if (x === y) continue;
      const v = jac(x.kit, y.kit);
      if (A === B) { within += v; wn++; } else { between += v; bn++; }
    }
  }
  const wAvg = wn ? within / wn : 0, bAvg = bn ? between / bn : 0;
  check(`themes are distinguishable (same-theme overlap ${wAvg.toFixed(3)} > cross-theme ${bAvg.toFixed(3)})`,
    wAvg > bAvg, `same ${wAvg.toFixed(3)} vs cross ${bAvg.toFixed(3)} — a theme must resemble itself more than it resembles other themes`);

  // ---- theme data must actually resolve against DATA ----
  // Every skill/tool/drawback/class/species/name-style/category a theme names has to exist, or the
  // preference is silently inert and nobody finds out. A review caught Scholar listing 'Clumsy' when the
  // real key is 'Affliction — Clumsy (DEX)'; this makes that class of typo a failing test instead.
  const dead = await cg.evaluate(`(function(){
    var bad=[];
    var skills=DATA.skillList.map(function(x){return x[0];});
    var boonCats={},artCats={};
    Object.keys(DATA.boons).forEach(function(k){boonCats[(DATA.boons[k]||{}).cat]=1;});
    Object.keys(DATA.arts).forEach(function(k){artCats[(DATA.arts[k]||{}).cat]=1;});
    RTHEMES.forEach(function(t){
      (t.skills||[]).forEach(function(v){if(skills.indexOf(v)<0)bad.push(t.key+'.skills: '+v);});
      (t.tools||[]).forEach(function(v){if((DATA.toolList||[]).indexOf(v)<0)bad.push(t.key+'.tools: '+v);});
      (t.draws||[]).forEach(function(v){if((DATA.drawbackList||[]).indexOf(v)<0)bad.push(t.key+'.draws: '+v);});
      (t.classes||[]).forEach(function(v){if(DATA.classes.indexOf(v)<0)bad.push(t.key+'.classes: '+v);});
      (t.species||[]).forEach(function(v){if(DATA.species.indexOf(v)<0)bad.push(t.key+'.species: '+v);});
      (t.name||[]).forEach(function(v){if(!NAMEDATA[v])bad.push(t.key+'.name: '+v);});
      Object.keys(t.cats||{}).forEach(function(c){if(!boonCats[c]&&!artCats[c])bad.push(t.key+'.cats: '+c);});
      if(!t.shape)bad.push(t.key+': no shape');
      if(t.abil)t.abil.forEach(function(a){if(['STR','DEX','CON','INT','WIS','CHA'].indexOf(a)<0)bad.push(t.key+'.abil: '+a);});
    });
    return bad;
  })()`);
  check('every theme names only things that exist in DATA', dead.length === 0, dead.join(' · '));

  // ---- casters must end up with usable magic, not just an expensive Rank ----
  // compute() requires spell slots to be non-increasing by level, so a roll that picks slot levels at
  // random gets nearly all of them rejected and finishes with a high Rank and no slots. Assert the
  // magic-leaning themes actually come away able to cast.
  const casterRows = [];
  for (const cls of ['Wizard', 'Cleric', 'Sorcerer']) {
    for (let i = 0; i < Math.max(3, Math.ceil(ROLLS / 2)); i++) {
      casterRows.push({ cls, ...(await cg.evaluate(`_qaRoll('battlecaster',${BUDGETS[2]},${JSON.stringify(cls)})`)) });
    }
  }
  const noSlots = casterRows.filter(r => r.slots.reduce((a, b) => a + b, 0) + r.pactSlots === 0);
  check('Battle-Caster casters finish with real spell slots', noSlots.length === 0,
    noSlots.length ? `${noSlots.length}/${casterRows.length} had Rank>0 but no slots, e.g. rank ${noSlots[0].rank} slots ${JSON.stringify(noSlots[0].slots)}` : '');
  const pyramid = casterRows.filter(r => r.slots.some((n, i) => i > 0 && n > r.slots[i - 1]));
  check('slot pyramid is never inverted', pyramid.length === 0,
    pyramid.length ? `e.g. ${JSON.stringify(pyramid[0].slots)}` : '');

  // ---- a non-caster must not have a casting stat primed over its own ----
  // DATA.castAbility has an entry for every class, non-casters included, so using it as a "is this a
  // caster" test primed Fighter's INT to 16-20 while leaving STR at 10.
  const fighters = [];
  for (const tk of ['zealot', 'battlecaster'])
    for (let i = 0; i < Math.max(3, Math.ceil(ROLLS / 2)); i++)
      fighters.push({ tk, ...(await cg.evaluate(`_qaRoll(${JSON.stringify(tk)},${BUDGETS[1]},"Fighter")`)) });
  const misprimed = fighters.filter(r => r.stats.INT > Math.max(r.stats.STR, r.stats.DEX, r.stats.CON));
  check('a Fighter on a caster theme still primes a Fighter stat, not INT', misprimed.length === 0,
    misprimed.length ? `${misprimed.length}/${fighters.length}, e.g. INT ${misprimed[0].stats.INT} vs STR ${misprimed[0].stats.STR}/DEX ${misprimed[0].stats.DEX}/CON ${misprimed[0].stats.CON}` : '');

  // ---- a compact per-theme table, so a human reading CI output can see what it built ----
  console.log('\n  theme                  Lv1 HD/skills/boons   Lv10 HD/sk/bn   Lv20 HD/sk/bn   armour  wpn');
  for (const { th, rows } of all) {
    const at = B => { const r = rows.filter(x => x.B === B);
      const avg = f => (r.reduce((s, x) => s + f(x), 0) / r.length).toFixed(1);
      return `${avg(x => x.hd)}/${avg(x => x.nSkills)}/${avg(x => x.nBoons)}`; };
    console.log(`  ${th.label.padEnd(22)} ${at(BUDGETS[0]).padEnd(21)} ${at(BUDGETS[1]).padEnd(15)} ${at(BUDGETS[2]).padEnd(15)} ${String(th.armour).padEnd(7)} ${th.weapons}`);
  }

  await cg.close();
} catch (e) {
  fail++;
  console.error('\n✗ harness error: ' + (e && e.message || e));
} finally {
  try { proc.kill(); } catch {}
  server.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
