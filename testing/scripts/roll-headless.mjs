/**
 * PACT — headless 🎲 roller for OTHER projects (campaign analysis, party-spread tooling, etc).
 * ---------------------------------------------------------------------------------------------
 * WHY THIS EXISTS. `cm-pact-campaign`'s `analysis/2026-09-07-real-party/gen_random_spread.mjs` drove
 * the real `randomizeRoll()` by regex-extracting its source out of the tool file and `eval`-ing it in a
 * bare vm — which is exactly how the Hit-Dice bug (D-GH-2026-09-05-roller-build-shapes) went unnoticed:
 * lifting the function out of the file it's declared in put `apLevel` out of scope, and the old code
 * silently built a level-9 character rather than failing. Source-extraction measures a DECONTEXTUALIZED
 * COPY of the roller, not the roller — the same class of drift AGENTS.md warns about for rules code, just
 * applied to a UI function instead of `engine.js`.
 *
 * This script instead drives the REAL tool in a REAL (headless) browser — the same
 * zero-dependency Chrome DevTools Protocol technique `random-quality-ci.mjs` and `tool-pricing-ci.mjs`
 * already use for CI — so every roll goes through the actual `randomizeRoll()`, in its own scope, with
 * every global it expects (`apLevel`, `DATA`, `compute`, `tryAct`, …) present exactly as a browser
 * provides them. If `randomizeRoll()` changes shape, this script sees the new behaviour automatically;
 * it never drifts, because it never re-implements anything.
 *
 * SELF-CONTAINED ON PURPOSE. No imports from this repo's other testing/scripts files, no npm packages —
 * Node built-ins only, plus a Chromium binary that already exists (this project's own, or any other).
 * That makes this ONE FILE copy-paste-portable into a sibling project (`cm-pact-campaign` or similar)
 * that wants headless rolls but doesn't want to check out all of PACT. If PACT *is* checked out as a
 * sibling/submodule there instead, point --repo at it and skip the copy.
 *
 * USAGE
 *   node testing/scripts/roll-headless.mjs --theme=bruiser --budget=295 --count=50
 *   node testing/scripts/roll-headless.mjs --theme=bruiser,scholar --budget=79,295,535 --count=20
 *   node testing/scripts/roll-headless.mjs --theme=bruiser --budget=295 --count=10 --class=Fighter
 *   node testing/scripts/roll-headless.mjs --list-themes            # theme metadata, no rolling
 *   node testing/scripts/roll-headless.mjs --theme=scholar --budget=295 --count=200 --out=rolls.json
 *
 *   --repo=/path/to/PACT   Repo root to serve the tool from (default: this script's own repo).
 *                          Point this at a sibling PACT checkout if this file has been copied elsewhere.
 *   CHROME_BIN=/path/to/chrome   Override Chromium discovery.
 *
 * OUTPUT   A JSON array on stdout (or written to --out), one entry per roll:
 *   { themeKey, budget, forcedClass, build, result }
 *   `build` is the tool's own readBuild() object (species, class, stats, hd, skills, boons, arts,
 *   racialTraits, drawbacks, armour, weaponProf, traditions, tools, hardy, tough, …) — everything a
 *   character sheet has. `result` is the matching compute() output (hp, ac, spent, spendable, warnings,
 *   init, speed, saveDC, …) — everything a character sheet DERIVES. Nothing here is invented or
 *   summarized; it's exactly what the real tool would show if a person clicked 🎲 in a browser.
 *
 * Exits 0 on success · 1 on a page-side error · 2 no Chromium found · 3 Chromium found but never started.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const REPO = path.resolve(args.repo || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'));
const PORT = 8737, CDP_PORT = 9339;   // distinct from the CI gates' ports so this can run alongside them
const csv = v => (v == null ? [] : String(v).split(',').map(s => s.trim()).filter(Boolean));

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

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
               '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
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
const READY = (probe) => `(async()=>{for(let i=0;i<300;i++){if(${probe})return true;await new Promise(r=>setTimeout(r,100));}return false;})()`;

const chrome = findChrome();
if (!chrome) {
  console.error('No Chromium found. Set CHROME_BIN, or install one where PLAYWRIGHT_BROWSERS_PATH points.');
  process.exit(2);
}
const server = await serve();
const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${fs.mkdtempSync('/tmp/pact-roll-headless-')}`, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeErr = '', chromeExit = null;
proc.stderr.on('data', d => { chromeErr += d.toString().slice(0, 4000); });
proc.on('exit', c => { chromeExit = c; });
proc.on('error', e => { chromeErr += `spawn error: ${e.message}\n`; });

let cdpUp = false;
for (let i = 0; i < 300; i++) {
  try { await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`); cdpUp = true; break; }
  catch { await new Promise(r => setTimeout(r, 100)); }
}
if (!cdpUp) {
  console.error(`No Chromium DevTools port after 30s. binary=${chrome} exit=${chromeExit} stderr=${chromeErr.trim() || '(nothing)'}`);
  try { proc.kill(); } catch {}
  server.close();
  process.exit(3);
}

// Page-side roll function. Test-only, defined here rather than in the tool — same contract as
// random-quality-ci.mjs's `_qaRoll`, but returning the FULL build + compute() result rather than a
// summary, since a consuming project (party-spread analysis, say) needs the actual character, not a gate.
const ROLL_FN = `
window._headlessRoll=function(themeKey,budget,forceClass){
  if(typeof resetBuild==='function'){try{resetBuild();}catch(e){}}
  var bi=document.getElementById('budget'); bi.value=String(budget);
  if(typeof _cgSyncAward==='function')_cgSyncAward();
  if(forceClass){var oc=document.getElementById('oclass'); if(oc){oc.value=forceClass; oc.dispatchEvent(new Event('change',{bubbles:true}));}}
  randomizeRoll(themeKey,0);
  var b=readBuild(), r=compute(b,(typeof _cgDmOpts==='function')?_cgDmOpts():{dmAp:0,ignorePlayerAp:false});
  return {themeKey:themeKey,budget:budget,forcedClass:forceClass||null,build:b,result:r};
};true`;

let exitCode = 0;
try {
  const cg = await connect(`http://127.0.0.1:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`);
  if (!(await cg.evaluate(READY(`window.DATA&&typeof compute==='function'&&typeof randomizeRoll==='function'&&typeof readBuild==='function'`))))
    throw new Error('CharGen never became ready (engine-ready did not fire?)');

  if (args['list-themes']) {
    const themes = await cg.evaluate(`RTHEMES.map(function(t){return {key:t.key,label:t.label,hint:t.hint,armour:t.armour,shield:!!t.shield,weapons:t.weapons,cats:t.cats,shape:t.shape};})`);
    const budgets = await cg.evaluate(`Object.keys(DATA.levelAP||{}).map(function(l){return {level:+l,ap:DATA.levelAP[l]};})`);
    process.stdout.write(JSON.stringify({ themes, budgets }, null, 2) + '\n');
  } else {
    await cg.evaluate(ROLL_FN);
    const themeKeys = csv(args.theme).length ? csv(args.theme)
      : await cg.evaluate(`RTHEMES.map(function(t){return t.key;})`);
    const budgets = csv(args.budget).map(Number).filter(Number.isFinite);
    const count = Math.max(1, +(args.count || 1));
    const forceClass = typeof args.class === 'string' ? args.class : null;
    if (!budgets.length) throw new Error('--budget=<AP[,AP...]> is required (see --list-themes for DATA.levelAP)');

    const rows = [];
    for (const themeKey of themeKeys) for (const budget of budgets) for (let i = 0; i < count; i++) {
      rows.push(await cg.evaluate(`_headlessRoll(${JSON.stringify(themeKey)},${budget},${JSON.stringify(forceClass)})`));
    }
    const json = JSON.stringify(rows, null, 2);
    if (args.out) { fs.writeFileSync(args.out, json); console.error(`wrote ${rows.length} rolls to ${args.out}`); }
    else process.stdout.write(json + '\n');
  }
  await cg.close();
} catch (e) {
  console.error('roll-headless failed: ' + (e && e.message || e));
  exitCode = 1;
} finally {
  try { proc.kill(); } catch {}
  server.close();
}
process.exit(exitCode);
