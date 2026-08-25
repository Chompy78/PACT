/**
 * PACT — one-off manual verification for fix/esc-gap-chargen-livesheet.
 * ----------------------------------------------------------------------
 * Not a permanent CI gate (no meta.NN id, not wired into a workflow) — a throwaway script proving the
 * five esc()/_csEsc() sites fixed in that task actually block the XSS payloads the audit described,
 * reusing the same zero-dependency CDP harness as tool-pricing-ci.mjs. Safe to delete after the PR
 * lands; kept in testing/scripts/ only so the verification is reproducible, not just asserted in a PR
 * description.
 *
 * USAGE   node testing/scripts/esc-gap-verify.mjs
 *         CHROME_BIN=/path/to/chrome node testing/scripts/esc-gap-verify.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 8732, CDP_PORT = 9334; // distinct ports from tool-pricing-ci.mjs so both can run concurrently

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
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable']) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const MIME = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json', '.css':'text/css' };
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
    send, close: async () => { ws.close(); await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${t.id}`); },
    async evaluate(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      const ex = r.result?.exceptionDetails;
      if (ex) throw new Error('page threw: ' + (ex.exception?.description || ex.text || 'unknown') + `\n    while evaluating: ${expr.slice(0, 200)}`);
      return r.result?.result?.value;
    }
  };
}
const READY = (probe) => `(async()=>{for(let i=0;i<300;i++){if(${probe})return true;await new Promise(r=>setTimeout(r,100));}return false;})()`;

let pass = 0, fail = 0;
function check(name, ok, detail) {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  — ${detail}`}`);
}

const chrome = findChrome();
if (!chrome) { console.error('No Chromium found.'); process.exit(2); }
const server = await serve();
const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${fs.mkdtempSync('/tmp/pact-esc-cdp-')}`, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore'] });

let cdpUp = false;
for (let i = 0; i < 300; i++) {
  try { await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`); cdpUp = true; break; }
  catch { await new Promise(r => setTimeout(r, 100)); }
}
if (!cdpUp) { console.error('Chromium never opened its DevTools port.'); try { proc.kill(); } catch {} server.close(); process.exit(3); }

// The payloads named in the audit: a script-executing tag, and a bare double-quote to test attribute injection.
const XSS_TAG = `<img src=x onerror="window.__xss=(window.__xss||0)+1">`;
const ATTR_BREAK = `x" onmouseover="window.__xss=(window.__xss||0)+1`;

try {
  // ============================ CharGen ============================
  {
    const cg = await connect(`http://127.0.0.1:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`);
    if (!(await cg.evaluate(READY(`window.DATA&&typeof renderCharSheet==='function'&&typeof baseBuild==='function'&&typeof compute==='function'`))))
      throw new Error('CharGen never became ready');
    const result = await cg.evaluate(`(function(){
      window.__xss = 0;
      var b = baseBuild();
      b.languageNames = [${JSON.stringify(XSS_TAG)}];
      b.masteries = [${JSON.stringify(XSS_TAG)}];
      b.drawbacks = [${JSON.stringify(XSS_TAG)}];
      var r = compute(b);
      var html = renderCharSheet(b, r, {apText:''});
      var div = document.createElement('div');
      document.body.appendChild(div);
      div.innerHTML = html;
      var fired = window.__xss;
      var containsRawTag = html.indexOf(${JSON.stringify(XSS_TAG)}) !== -1;
      document.body.removeChild(div);
      return {fired: fired, containsRawTag: containsRawTag, htmlHasEscaped: html.indexOf('&lt;img') !== -1};
    })()`);
    check('CharGen renderCharSheet: languageNames/masteries/drawbacks XSS payload does not execute', result.fired === 0, `window.__xss=${result.fired}`);
    check('CharGen renderCharSheet: raw <img> tag never reaches the HTML string', !result.containsRawTag, 'raw tag found in output');
    check('CharGen renderCharSheet: payload appears HTML-entity-escaped in output', result.htmlHasEscaped, 'no &lt;img found — payload missing or unescaped differently');
    await cg.close();
  }

  // ============================ Live Sheet ============================
  {
    const ls = await connect(`http://127.0.0.1:${PORT}/PACT/tools/PACT-Live-Char-Sheet.html`);
    if (!(await ls.evaluate(READY(`window._engineFold&&window.DATA&&typeof renderCharSheet==='function'&&typeof validate==='function'`))))
      throw new Error('Live Sheet never became ready');

    // 1) renderCharSheet duplicate — same three fields as CharGen
    const r1 = await ls.evaluate(`(function(){
      window.__xss = 0;
      var b = baseBuild();
      b.languageNames = [${JSON.stringify(XSS_TAG)}];
      b.masteries = [${JSON.stringify(XSS_TAG)}];
      b.drawbacks = [${JSON.stringify(XSS_TAG)}];
      b.saves = [${JSON.stringify(XSS_TAG)}];
      b.skills = [${JSON.stringify(XSS_TAG)}];
      b.tools = [${JSON.stringify(XSS_TAG)}];
      var r = compute(b);
      var html = renderCharSheet(b, r, {apText:''});
      var div = document.createElement('div');
      document.body.appendChild(div);
      div.innerHTML = html;
      var fired = window.__xss;
      var containsRawTag = html.indexOf(${JSON.stringify(XSS_TAG)}) !== -1;
      document.body.removeChild(div);
      return {fired: fired, containsRawTag: containsRawTag};
    })()`);
    check('Live Sheet renderCharSheet: languageNames/masteries/drawbacks/saves/skills/tools payload does not execute', r1.fired === 0, `window.__xss=${r1.fired}`);
    check('Live Sheet renderCharSheet: raw <img> tag never reaches the HTML string', !r1.containsRawTag, 'raw tag found in output');

    // 2) validate() issue text -> #tray.innerHTML (the LOG-driven path: a buy event referencing a
    //    feature/boon/drawback no longer in DATA — exactly how a tampered/imported LOG reaches this).
    const r2 = await ls.evaluate(`(function(){
      window.__xss = 0;
      var payload = ${JSON.stringify(XSS_TAG)};
      LOG.length = 0; SEQ = 0;
      LOG.push({seq:1, type:'buy', cat:'feature', payload:{v: payload}, cost:0});
      var issues = validate();
      var hit = issues.filter(function(i){ return i.indexOf('no longer in rules') !== -1; });
      if (!hit.length) return {noFixtureHit: true};
      var div = document.createElement('div');
      document.body.appendChild(div);
      div.innerHTML = '<ul>' + hit.map(function(i){return '<li>'+i+'</li>';}).join('') + '</ul>';
      var fired = window.__xss;
      var containsRawTag = hit.join('').indexOf(payload) !== -1;
      document.body.removeChild(div);
      LOG.length = 0; SEQ = 0;
      return {fired: fired, containsRawTag: containsRawTag, issueText: hit[0]};
    })()`);
    if (r2.noFixtureHit) {
      check('Live Sheet validate(): a buy event for an unknown feature produces a "no longer in rules" issue', false, 'fixture did not trigger the expected validate() branch — check DATA.features/LOG shape assumptions');
    } else {
      check('Live Sheet validate(): unknown-feature payload.v does not execute when rendered into #tray', r2.fired === 0, `window.__xss=${r2.fired}`);
      check('Live Sheet validate(): raw <img> tag never reaches the issue text', !r2.containsRawTag, 'raw tag found in: ' + r2.issueText);
    }

    // 3) buy-off button's onclick/data-v attribute — the attribute-injection payload (a bare double quote)
    const r3 = await ls.evaluate(`(function(){
      var payload = ${JSON.stringify(ATTR_BREAK)};
      var esc = window.esc;
      var html = '<button class="x" data-v="'+esc(payload||'')+'" onclick="buyoffDrawback(this.dataset.v)">buy off</button>';
      var div = document.createElement('div');
      document.body.appendChild(div);
      div.innerHTML = html;
      var btn = div.querySelector('button');
      var attrCount = btn.attributes.length; // must stay 3: class, data-v, onclick — a break-out adds a 4th
      var recoveredValue = btn.dataset.v;     // must equal the ORIGINAL payload, not a truncated/mangled one
      document.body.removeChild(div);
      return {attrCount: attrCount, recoveredValue: recoveredValue, expected: payload};
    })()`);
    check('Live Sheet buy-off button: a double-quote payload cannot inject a 4th attribute', r3.attrCount === 3, `button ended up with ${r3.attrCount} attributes (expected 3: class, data-v, onclick)`);
    check('Live Sheet buy-off button: dataset.v round-trips the original value unmangled', r3.recoveredValue === r3.expected, `got ${JSON.stringify(r3.recoveredValue)}, expected ${JSON.stringify(r3.expected)}`);

    await ls.close();
  }

  console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} passed / ${fail} failed`);
} catch (e) {
  console.error('\n✗ harness error:', e.message);
  fail++;
} finally {
  try { proc.kill(); } catch {}
  server.close();
}
process.exit(fail === 0 ? 0 : 1);
