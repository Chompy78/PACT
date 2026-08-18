#!/usr/bin/env node
/**
 * PACT — service-worker staleness regression test.
 *
 * WHY THIS EXISTS. On 2026-08-03 every cloud path in the app broke for returning users, and all five CI
 * checks were green. js/sync.js (network-first) began importing a symbol from js/character-store.js
 * (then cache-first); returning browsers ran the new sync.js against the cached old character-store.js,
 * and a named ES import the target doesn't export is a LINK-TIME failure that aborts the whole module
 * graph. Nothing caught it because every other gate runs in a clean browser with no service worker and
 * no second visit — the only conditions under which the bug exists.
 *
 * audit.py's "service-worker import freshness" check now catches that specific shape statically. This is
 * the behavioural counterpart: it actually installs the service worker, changes a module on disk, and
 * reloads WITHOUT a hard refresh — the exact thing a returning user does.
 *
 * Needs no backend. Run: node testing/scripts/sw-cache-e2e.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './lib/launch-chromium.mjs';

// CJS require honours NODE_PATH (unlike ESM's `import`), so this resolves a globally-installed
// playwright without needing node_modules/ in the repo — same idiom as random-manual-e2e.mjs.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 7962;
const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
               '.json':'application/json', '.css':'text/css', '.png':'image/png', '.webp':'image/webp' };

const log = m => console.log(`[sw-e2e] ${m}`);
let failures = 0;
function check(name, ok, detail='') {
  console.log(`[sw-e2e]   ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

// Overrides let a test replace a file's bytes without touching the working tree.
const overrides = new Map();

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const rel = urlPath.replace(/^\/PACT\/?/, '') || 'index.html';
  if (overrides.has(rel)) {
    res.writeHead(200, { 'Content-Type': MIME[path.extname(rel)] || 'text/plain',
                         'Cache-Control': 'no-cache' });
    return res.end(overrides.get(rel));
  }
  const file = path.join(REPO, rel);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
                         'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

async function main() {
  await new Promise(r => server.listen(PORT, r));
  const base = `http://localhost:${PORT}/PACT`;
  const browser = await launchChromium();
  // One persistent context for the whole run: the service worker and its caches must survive between
  // "visits", which is the entire point. A fresh context per visit would silently test nothing.
  const ctx = await browser.newContext();

  try {
    // ---- visit 1: install the service worker and let it cache the module graph ----
    const p1 = await ctx.newPage();
    await p1.goto(`${base}/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' });
    // `navigator.serviceWorker.ready` resolves only once a worker is ACTIVE and controlling. Waiting on
    // `controller !== undefined` instead is useless: controller is null before activation, and
    // `null !== undefined` is immediately true — an earlier version of this test did exactly that and
    // reported three vacuous passes against a browser with no service worker at all.
    const swReady = await p1.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return { registered: false, why: 'no serviceWorker API' };
      try {
        const reg = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((_, rej) => setTimeout(() => rej(new Error('timed out waiting for activation')), 20000)),
        ]);
        // Activation alone isn't enough — the install handler's cache.addAll() may still be settling.
        for (let i = 0; i < 40; i++) {
          const names = await caches.keys();
          if (names.length) {
            const keys = (await (await caches.open(names[0])).keys()).map(r => r.url);
            if (keys.length) return { registered: true, scope: reg.scope, caches: names,
                                      cached: keys.length,
                                      hasStore: keys.some(u => u.includes('character-store')) };
          }
          await new Promise(r => setTimeout(r, 250));
        }
        return { registered: true, scope: reg.scope, cached: 0, why: 'activated but cache stayed empty' };
      } catch (e) { return { registered: false, why: e.message }; }
    });
    check('service worker registers and activates on first visit', swReady.registered === true,
          swReady.why || swReady.scope || '');
    check('it populates a cache', (swReady.cached || 0) > 0, `${swReady.cached} entries in ${swReady.caches}`);
    check('character-store.js is in the cache', swReady.hasStore === true);
    await p1.close();

    // ---- deploy a change: a network-first module starts importing a NEW symbol from another module ----
    // This is the 2026-08-03 shape exactly. If the importee is served stale, the graph fails to link.
    const storeSrc = fs.readFileSync(path.join(REPO, 'js/character-store.js'), 'utf8');
    const clientSrc = fs.readFileSync(path.join(REPO, 'js/sync.js'), 'utf8');
    overrides.set('js/character-store.js', storeSrc + '\nexport const __swProbe = "fresh";\n');
    overrides.set('js/sync.js', clientSrc.replace(
      "import { isCloudCharId } from './character-store.js';",
      "import { isCloudCharId, __swProbe } from './character-store.js';\nwindow.__swProbe = __swProbe;"));
    log('deployed a change: sync.js now imports a symbol that only the NEW character-store.js exports');

    // ---- visit 2: an ordinary reload. No hard refresh, no cache clear. ----
    const p2 = await ctx.newPage();
    const errs = [];
    p2.on('pageerror', e => errs.push(e.message.split('\n')[0].slice(0, 140)));
    await p2.addInitScript(() => { window.__ev = [];
      ['engine-ready','sync-ready','campaign-ready'].forEach(n =>
        document.addEventListener(n, () => window.__ev.push(n))); });
    await p2.goto(`${base}/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' });
    await p2.waitForTimeout(3000);
    const st = await p2.evaluate(() => ({
      ev: window.__ev, data: typeof window.DATA, probe: window.__swProbe || null,
      chars: document.body.innerText.trim().length,
    }));

    check('returning visit still boots the engine', st.ev.includes('engine-ready'),
          `events=${JSON.stringify(st.ev)}`);
    check('the tool still renders', st.chars > 5000, `${st.chars} chars of body text`);
    check('no link-time module failure', !errs.some(e => /does not provide an export|Importing a module script failed/i.test(e)),
          errs.length ? errs[0] : 'no page errors');
    check('the cloud module graph linked against the FRESH dependency', st.probe === 'fresh',
          st.probe === null ? 'probe symbol absent — sync.js failed to link (the 2026-08-03 bug)' : `probe=${st.probe}`);
    await p2.close();
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`[sw-e2e] ${failures ? failures + ' check(s) FAILED' : 'all checks passed'}`);
  process.exit(failures ? 1 : 0);
}

main().catch(e => { console.error('[sw-e2e] harness error:', e); server.close(); process.exit(2); });
