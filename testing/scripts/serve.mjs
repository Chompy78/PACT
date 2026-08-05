/**
 * PACT — one-command local preview of whatever branch is checked out.
 * -------------------------------------------------------------------
 *     node testing/scripts/serve.mjs              # serve + open the menu
 *     node testing/scripts/serve.mjs live         # …and jump straight to the Live Sheet
 *     node testing/scripts/serve.mjs chargen|dm|test
 *     node testing/scripts/serve.mjs --no-open    # just serve, don't launch a browser
 *     node testing/scripts/serve.mjs --port 9000
 *
 * WHY THIS EXISTS. A branch has no URL — GitHub Pages serves `main` only, and `preview` isn't deployed
 * — so the only way to look at unmerged work is to run it locally. docs/HOW-TO-WORK.md documents doing
 * that with `python3 -m http.server` from the PARENT directory, which is easy to get subtly wrong (serve
 * the repo root instead and the absolute /PACT/... paths in service-worker.js and manifest.json break).
 * This does the same thing with the Node that's already required for the test gates, mounts the repo at
 * /PACT/ regardless of where you run it from, and prints which branch you are actually looking at.
 *
 * It also sends `Cache-Control: no-store`. The service worker caching /PACT/ is the single biggest
 * time-waster when checking a branch: you switch branches, reload, and are served the OLD files, then
 * conclude the change didn't work. no-store plus the reminder below removes most of that. For anything
 * touching the service worker itself, still use a private window.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const arg = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const PORT = Number(arg('--port')) || 8000;
const OPEN = !argv.includes('--no-open');

const TOOLS = {
  menu:    'index.html',
  live:    'tools/PACT-Live-Char-Sheet.html',
  chargen: 'tools/PACT-CharGen-Webtool.html',
  dm:      'tools/DM-Console.html',
  test:    'testing/tests/engine-parity.html',
};
const wanted = argv.find(a => TOOLS[a]) || 'menu';

const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.mjs':'text/javascript',
  '.json':'application/json', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png',
  '.webp':'image/webp', '.ico':'image/x-icon', '.woff2':'font/woff2', '.webmanifest':'application/manifest+json' };

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  // Mount the repo at /PACT/ so absolute paths resolve exactly as they do on GitHub Pages. A bare "/"
  // redirects rather than 404s, because typing localhost:8000 and getting nothing is the obvious trap.
  if (rel === '/' || rel === '') { res.writeHead(302, { Location: '/PACT/' }); return res.end(); }
  rel = rel.replace(/^\/PACT\/?/, '') || 'index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(REPO, rel);
  if (!file.startsWith(REPO) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end(`404  ${rel}\n\nServing ${REPO} at /PACT/.\nTry one of:\n` +
      Object.entries(TOOLS).map(([k, v]) => `  http://localhost:${PORT}/PACT/${v}   (${k})`).join('\n') + '\n');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
                       'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(file));
});

function git(cmd) { try { return execSync(`git ${cmd}`, { cwd: REPO, stdio: ['ignore','pipe','ignore'] }).toString().trim(); } catch { return '?'; } }

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}/PACT/${TOOLS[wanted] === 'index.html' ? '' : TOOLS[wanted]}`;
  const dirty = git('status --porcelain') ? '  (uncommitted changes present)' : '';
  console.log(`
  PACT dev server
  ───────────────────────────────────────────────────────────────
  branch   ${git('branch --show-current') || '(detached)'}   ${git('rev-parse --short HEAD')}${dirty}
  serving  ${REPO}

  menu     http://localhost:${PORT}/PACT/
  live     http://localhost:${PORT}/PACT/${TOOLS.live}
  chargen  http://localhost:${PORT}/PACT/${TOOLS.chargen}
  dm       http://localhost:${PORT}/PACT/${TOOLS.dm}
  test     http://localhost:${PORT}/PACT/${TOOLS.test}

  Seeing stale content after switching branches? That's the service worker.
  Use a private window, or DevTools → Application → Service Workers → Update on reload.
  Ctrl+C to stop.
  ───────────────────────────────────────────────────────────────
`);
  if (OPEN) {
    const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
              : process.platform === 'darwin' ? ['open', [url]]
              : ['xdg-open', [url]];
    try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref(); }
    catch { console.log(`  (couldn't open a browser automatically — paste the URL above)`); }
  }
});
