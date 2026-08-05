/**
 * PACT — headless gate for pricing that lives INSIDE the tools (not in js/engine.js).
 * ---------------------------------------------------------------------------------
 * WHY THIS EXISTS. `engine-parity-ci.mjs` gates `js/engine.js` — 24 fixtures, run in CI on every PR.
 * But `priceOf()` lives in `tools/PACT-Live-Char-Sheet.html`, and it decides **what a player is
 * charged**, which is then frozen into their log. Until this file, nothing guarded those numbers.
 * D-GH-2026-08-05-pricing-model's verification section asks for a price-independence gate; this is it.
 *
 * WHY NOT PLAYWRIGHT. The other e2e scripts here (`chargen-flows-e2e.mjs` etc.) `require('playwright')`,
 * an npm package — and AGENTS.md forbids npm in this repo, so those scripts cannot run in a CLI session
 * at all. This one drives Chromium over the **Chrome DevTools Protocol** using only Node built-ins
 * (`fetch`, `WebSocket`, `http`), so it has zero dependencies and needs nothing installed but a Chromium
 * binary. It is deliberately a narrow lane — load a page, evaluate expressions, assert numbers — not a
 * replacement for the Playwright flows, which do real UI interaction that CDP would make painful.
 *
 * USAGE   node testing/scripts/tool-pricing-ci.mjs
 *         CHROME_BIN=/path/to/chrome node testing/scripts/tool-pricing-ci.mjs
 * Exits non-zero on any failure, same contract as engine-parity-ci.mjs.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 8731, CDP_PORT = 9333;   // uncommon ports: don't collide with a dev server on 8000/9222

// ---- locate a Chromium ------------------------------------------------------------------------
// Honour CHROME_BIN, else probe the Playwright browser cache (PLAYWRIGHT_BROWSERS_PATH, default
// /opt/pw-browsers) and the usual Linux/macOS install paths. No download is ever attempted.
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
  }
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
                   '/usr/bin/google-chrome-stable',   // the GitHub-hosted ubuntu runner's Chrome
                   '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ---- static server ----------------------------------------------------------------------------
// Serves the repo at /PACT/ so the tools' relative `../js/engine.js` imports resolve exactly as they
// do on GitHub Pages. ES modules need a real origin — file:// will not work (see docs/HOW-TO-WORK.md).
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

// ---- minimal CDP client -----------------------------------------------------------------------
async function connect(url) {
  const t = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise(r => (ws.onopen = r));
  const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise(r => pending.set(i, r)); };
  await send('Page.enable'); await send('Runtime.enable');
  return {
    send, close: async () => { ws.close(); await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${t.id}`); },
    // Evaluate in the page and return the value. Throws on a page-side exception so a broken tool
    // fails the gate loudly rather than silently returning undefined.
    async evaluate(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      const ex = r.result?.exceptionDetails;
      if (ex) throw new Error('page threw: ' + (ex.exception?.description || ex.text || 'unknown') + `\n    while evaluating: ${expr.slice(0, 160)}`);
      return r.result?.result?.value;
    }
  };
}
// The tools boot on an `engine-ready` event fired by a deferred module script, so the classic-script
// globals (priceOf, LOG, economy…) are not present at DOMContentLoaded. Poll rather than sleep.
const READY = (probe) => `(async()=>{for(let i=0;i<100;i++){if(${probe})return true;await new Promise(r=>setTimeout(r,100));}return false;})()`;

// ---- assertions -------------------------------------------------------------------------------
let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

const chrome = findChrome();
if (!chrome) {
  console.error('No Chromium found. Set CHROME_BIN, or install one where PLAYWRIGHT_BROWSERS_PATH points.');
  process.exit(2);
}
const server = await serve();
const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${fs.mkdtempSync('/tmp/pact-cdp-')}`, 'about:blank'],
  { stdio: 'ignore' });
// Wait for the debugging endpoint rather than sleeping a fixed amount.
for (let i = 0; i < 100; i++) {
  try { await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`); break; } catch { await new Promise(r => setTimeout(r, 100)); }
}

try {
  // ============================ Live Sheet ============================
  const ls = await connect(`http://127.0.0.1:${PORT}/PACT/tools/PACT-Live-Char-Sheet.html`);
  // Poll a BRIDGED symbol, not a classic-script one. priceOf/foldBuild are defined the moment the
  // classic script parses, so probing those returns true before the deferred module has run and the
  // very next evaluate() dies on `window._engineFold` being undefined.
  if (!(await ls.evaluate(READY(`window._engineFold&&window.DATA&&typeof priceOf==='function'`))))
    throw new Error('Live Sheet never became ready (engine-ready did not fire?)');

  console.log('\nLive Sheet — a new character seeds from the budget curve, with the lock armed');
  check('starting AP == DATA.defaultAp', await ls.evaluate(`economy(null).earned===DATA.defaultAp`), true);
  check('first event arms the creation lock',
    await ls.evaluate(`LOG[0].type==='creationLockConfig'&&LOG[0].payload.auto===true`), true);
  check('no threshold stamped (falls back to DATA.level1AP)',
    await ls.evaluate(`_creationLockState().threshold===DATA.level1AP&&_creationLockState().confirmed===false`), true);

  // The core of this gate. A context change must be priced from its own rules table, so its quote
  // cannot depend on what the character already owns. Before the fix these were 14, 19 and -6.
  console.log('\nLive Sheet — a context change is priced independently of what is already owned');
  const withStack = `(()=>{const b=foldBuild(null);b.stats.CON=16;b.hardy=2;b.tough=3;return b;})()`;
  check('level up 1->2 == Hit Dice step, with a Vigor/Grit stack',
    await ls.evaluate(`priceOf('hd',{to:2},${withStack})`), 2);
  check('level up 1->2 == the same on a bare character (independence)',
    await ls.evaluate(`priceOf('hd',{to:2},foldBuild(null))`), 2);
  check('level up 4->5 == Hit Dice step, with a Vigor/Grit stack',
    await ls.evaluate(`priceOf('hd',{to:5},(()=>{const b=${withStack};b.hd=4;return b;})())`), 4);

  const withWiz = `(()=>{const b=foldBuild(null);b.features=Object.keys(DATA.features)
    .filter(l=>DATA.features[l].cls==='Wizard'&&!DATA.features[l].inv&&!DATA.features[l].hidden).slice(0,4);return b;})()`;
  check('unlock Wizard == ladder rung, owning 4 Wizard features',
    await ls.evaluate(`priceOf('unlockclass',{v:'Wizard'},${withWiz})`), 7);
  check('unlock Wizard == the same owning none (independence)',
    await ls.evaluate(`priceOf('unlockclass',{v:'Wizard'},foldBuild(null))`), 7);
  // Regression guard: the buy list filters only originClass, so originClass2 is offered. The engine
  // excludes it from the unlock count, and the pricer must agree — otherwise we charge for a no-op.
  check('unlock a class that is already the 2nd origin == 0',
    await ls.evaluate(`priceOf('unlockclass',{v:'Rogue'},(()=>{const b=foldBuild(null);b.originClass2='Rogue';return b;})())`), 0);

  console.log('\nLive Sheet — categories that were already correct must not move');
  check('ability raise still prices off the ABIL ladder',
    await ls.evaluate(`priceOf('abil',{ab:'CON',to:17},(()=>{const b=foldBuild(null);b.stats.CON=16;b.tough=3;return b;})())`), 5);
  check('the two bonds still return the flat gain',
    await ls.evaluate(`[priceOf('mbound',{v:'Fighter'}),priceOf('dbound',{})]`), [-2, -2]);
  // `prof` is deliberately NOT in _CTX_PRICERS: it moves caps that raise warnings, never a price. If
  // that ever stops being true this assertion fails and the category needs adding to the table.
  check('prof is genuinely non-contaminating (diff == ladder step)',
    await ls.evaluate(`(()=>{const b=foldBuild(null);b.hd=5;b.tough=3;const d=priceOf('prof',{to:3},b);
      return d===(DATA.profCum[3]-DATA.profCum[2]);})()`), true);
  await ls.close();

  // ============================ CharGen ============================
  const cg = await connect(`http://127.0.0.1:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`);
  if (!(await cg.evaluate(READY(`window.DATA&&typeof _creationLockState==='function'&&LOG.length>0`))))
    throw new Error('CharGen never became ready');

  console.log('\nCharGen — armed at boot, notice shown until confirmed');
  // Regression guard for b3b4271: replaceWholeLogFromBuild() reassigns LOG wholesale and bypasses the
  // mutation-API hooks, so a fresh boot used to land here unarmed and un-lockable.
  check('armed at boot, before any user edit', await cg.evaluate(`_creationLockState().armed`), true);
  check('unconfirmed, defaulting to DATA.level1AP',
    await cg.evaluate(`_creationLockState().confirmed===false&&_creationLockState().threshold===DATA.level1AP`), true);
  // Read the real tips container: document.body.innerHTML also matches the inline <script> SOURCE that
  // contains this same string, which produced a false positive during development.
  check('notice rendered in the tips panel',
    await cg.evaluate(`/Creation AP not confirmed/.test(document.getElementById('guide').innerText)`), true);
  check('confirming appends a config event and clears the notice',
    await cg.evaluate(`(()=>{const n=LOG.length;
      emit({type:'creationLockConfig',payload:{threshold:75},label:'test'});render();
      const s=_creationLockState();
      return LOG.length===n+1 && s.threshold===75 && s.confirmed===true
        && !/Creation AP not confirmed/.test(document.getElementById('guide').innerText);})()`), true);
  await cg.close();
} catch (e) {
  fail++; console.log(`  FAIL harness — ${e.message}`);
} finally {
  proc.kill(); server.close();
}

console.log(`\n${fail ? '✗' : '✓'} ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
