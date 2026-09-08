#!/usr/bin/env node
/**
 * PACT — branch preview server.
 *
 * A local, click-to-load way to check out ANY branch (local or remote) and see it running as a real
 * static site in your own browser — the same server pattern testing/scripts/*-ci.mjs already use
 * (extension-aware Content-Type headers; getting that wrong is what silently breaks every module
 * script, learned the hard way debugging those gates the same day this was written).
 *
 * WHY A SEPARATE WORKTREE, NOT THIS REPO'S OWN WORKING DIRECTORY.
 * Checking out a branch here would mean `git checkout <branch>` on whatever directory a Claude Code
 * session (or you, in another terminal) might currently be mid-task in — silently discarding
 * uncommitted work or yanking a checkout out from under a running task. Instead this tool owns a
 * SEPARATE worktree (./worktree, gitignored) that only it ever touches, and always checks out
 * DETACHED at a specific commit — never a branch name — so it can never collide with a branch
 * checked out elsewhere (git refuses to check out the same branch into two worktrees at once; a
 * detached commit checkout has no such restriction) and never accidentally commits into a shared
 * branch pointer.
 *
 * USAGE:  node dev/branch-preview/server.mjs
 *         then open http://localhost:8420
 *
 * No new dependencies — only Node's own http/fs/child_process, matching this project's "no npm
 * install needed for the app itself" ethos (this is dev-only tooling, same class as testing/scripts/).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');            // the real PACT checkout — READ from, never written to
const WORKTREE = path.join(HERE, 'worktree');         // this tool's own scratch checkout
const PORT = process.env.PORT ? Number(process.env.PORT) : 8737;   // arbitrary, unlikely to collide — override with PORT=xxxx if it ever does
const BASELINE = 'preview';                            // ahead/behind is measured against this

async function git(args, cwd = REPO) {
  const { stdout } = await execFileP('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}

// Ensure the dedicated worktree exists, detached at whatever HEAD currently resolves to (fine — the
// first real /api/load call moves it to the actually-requested ref immediately).
async function ensureWorktree() {
  if (fs.existsSync(path.join(WORKTREE, '.git'))) return;
  fs.mkdirSync(path.dirname(WORKTREE), { recursive: true });
  await git(['worktree', 'add', '--detach', WORKTREE]);
}

// The full list of loadable refs: every local branch, every remote branch (deduplicated — a local
// branch with the same name as its remote tracking branch is shown once, resolved to the remote's
// tip so "load preview" always means "what's actually on GitHub", not a possibly-stale local copy).
async function listBranches() {
  await git(['fetch', 'origin', '--prune']).catch(() => {});   // best-effort — offline still works off cached refs
  const currentReal = await git(['-C', REPO, 'branch', '--show-current']).catch(() => '');

  const remoteRaw = await git(['for-each-ref', '--format=%(refname:short)|%(objectname:short)|%(committerdate:relative)|%(authorname)|%(subject)', 'refs/remotes/origin']);
  const localRaw = await git(['for-each-ref', '--format=%(refname:short)|%(objectname:short)|%(committerdate:relative)|%(authorname)|%(subject)', 'refs/heads']);

  const parse = raw => raw.split('\n').filter(Boolean).map(line => {
    const [name, sha, when, author, ...rest] = line.split('|');
    return { name, sha, when, author, subject: rest.join('|') };
  });

  const remotes = parse(remoteRaw).filter(b => b.name !== 'origin/HEAD');
  const remoteNames = new Set(remotes.map(b => b.name.replace(/^origin\//, '')));
  const locals = parse(localRaw).filter(b => !remoteNames.has(b.name));   // avoid double-listing

  const all = [
    ...remotes.map(b => ({ ...b, display: b.name.replace(/^origin\//, ''), ref: b.name, hasRemote: true })),
    ...locals.map(b => ({ ...b, display: b.name, ref: b.name, hasRemote: false })),
  ];

  // Ahead/behind vs the baseline (skip computing it FOR the baseline itself).
  for (const b of all) {
    b.isCurrent = b.display === currentReal;
    b.isBaseline = b.display === BASELINE;
    if (b.isBaseline) { b.ahead = 0; b.behind = 0; continue; }
    try {
      const out = await git(['rev-list', '--left-right', '--count', `origin/${BASELINE}...${b.ref}`]);
      const [behind, ahead] = out.split(/\s+/).map(Number);
      b.ahead = ahead; b.behind = behind;
    } catch { b.ahead = null; b.behind = null; }
  }

  all.sort((a, b) => (a.isBaseline ? -1 : b.isBaseline ? 1 : a.display.localeCompare(b.display)));
  return all;
}

async function prStatus(branch) {
  try {
    const { stdout } = await execFileP('gh', ['pr', 'view', branch, '--json', 'number,state,url'], { cwd: REPO, timeout: 5000 });
    return JSON.parse(stdout);
  } catch { return null; }   // no gh, no PR, offline — any of these is fine, just means "no info"
}

async function currentWorktreeState() {
  await ensureWorktree();
  try {
    const sha = await git(['rev-parse', 'HEAD'], WORKTREE);
    const subject = await git(['log', '-1', '--format=%s'], WORKTREE);
    const when = await git(['log', '-1', '--format=%cr'], WORKTREE);
    return { sha: sha.slice(0, 7), subject, when };
  } catch { return null; }
}

async function loadRef(ref) {
  await ensureWorktree();
  // Resolve to an exact commit BEFORE checkout — refuse anything git itself can't resolve, so an
  // unrecognised value from the client can never reach the checkout as a shell-meaningful string.
  const sha = await git(['rev-parse', '--verify', `${ref}^{commit}`]);
  await git(['checkout', '--detach', sha, '--'], WORKTREE);
  return currentWorktreeState();
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.webp': 'image/webp',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
};

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// Read ONCE at startup, not per request. This directory (dev/branch-preview/) lives inside the
// repo whose branches this tool switches — if someone separately checks the MAIN repo's own working
// directory over to a branch that doesn't have this tool committed (entirely possible mid-session,
// and it happened for real while building this), a per-request readFileSync would start 500ing with
// ENOENT the moment that file disappears from disk, even though the server process itself is still
// perfectly healthy. Caching it means the control page keeps working regardless of what the main
// repo's checkout does afterward — the one real cost is that editing index.html needs a restart to
// take effect, which is a fine trade for a page that changes rarely.
const CONTROL_HTML = fs.readFileSync(path.join(HERE, 'index.html'));

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = CONTROL_HTML;
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      return res.end(html);
    }

    if (url.pathname === '/api/branches' && req.method === 'GET') {
      const branches = await listBranches();
      return sendJSON(res, 200, { baseline: BASELINE, branches });
    }

    if (url.pathname === '/api/pr' && req.method === 'GET') {
      const branch = url.searchParams.get('branch') || '';
      return sendJSON(res, 200, { pr: await prStatus(branch) });
    }

    if (url.pathname === '/api/current' && req.method === 'GET') {
      return sendJSON(res, 200, { current: await currentWorktreeState() });
    }

    if (url.pathname === '/api/load' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const ref = String(body.ref || '').trim();
      if (!ref) return sendJSON(res, 400, { error: 'ref required' });
      const state = await loadRef(ref);
      return sendJSON(res, 200, { ok: true, current: state });
    }

    // Everything else: static files out of the WORKTREE, mirroring the app's own expected base path
    // (/PACT/...) exactly like testing/scripts/*-ci.mjs already do, so relative links, the manifest's
    // declared scope, and the service worker's precache list all resolve the same way they do in
    // production.
    const rel = decodeURIComponent(url.pathname).replace(/^\/PACT\/?/, '') || 'index.html';
    const filePath = path.join(WORKTREE, rel);
    if (!filePath.startsWith(WORKTREE)) { res.writeHead(403); return res.end('forbidden'); }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found: ' + rel); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  } catch (err) {
    sendJSON(res, 500, { error: String(err && err.message || err) });
  }
});

// Bound to all interfaces, not just localhost, so a link on the home dashboard actually works from
// any device on the LAN — the whole point of putting it there. No auth on this tool itself (matches
// most of this home server's other LAN-only services), so it's trusted-network-only by design: never
// put a link to it anywhere reachable from outside this network. The only actions it exposes are
// `git checkout` of already-public GitHub branch content into a disposable worktree, and reading
// branch metadata — nothing secret, nothing destructive to anything that matters.
import os from 'node:os';
function lanAddress() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === 'IPv4' && !i.internal && i.address.startsWith('192.168.')) return i.address;
    }
  }
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return null;
}

server.listen(PORT, '0.0.0.0', () => {
  const lan = lanAddress();
  console.log(`\n  PACT branch preview\n  ------------------\n  Control panel:  http://localhost:${PORT}${lan ? `  (or http://${lan}:${PORT} from another device on your LAN)` : ''}\n  App (once loaded): http://localhost:${PORT}/PACT/index.html\n`);
});
