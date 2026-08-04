'use strict';
/**
 * PACT — a loopback TLS-terminating relay that lets Playwright's Chromium reach the public
 * internet from environments where Chromium's TLS ClientHello (BoringSSL's mandatory GREASE
 * values in the cipher/extension/group lists) gets reset by a strict TLS-inspecting egress proxy,
 * even though the same host is reachable fine via curl/Node's fetch through that same proxy.
 *
 * Confirmed root cause (2026-08-04, PACT usability review session): in a Claude Code sandboxed
 * environment with a policy-enforcing HTTPS_PROXY at 127.0.0.1:<port>, Chromium got
 * net::ERR_CONNECTION_RESET on EVERY external HTTPS host tried (including https://example.com,
 * not just the Supabase project), immediately after sending its ClientHello — no TLS alert, no
 * HTTP response, just a TCP RST. curl and Node's fetch (NODE_USE_ENV_PROXY=1) reached the exact
 * same hosts through the exact same proxy address without issue. Net-log capture showed the
 * CONNECT tunnel itself succeeds (200 Connection Established); the reset happens on the TLS leg.
 * Disabling Chromium's EncryptedClientHello/PostQuantumKyber features (verified via `ps` that the
 * flags actually reached the network-service subprocess) did not fix it — GREASE itself is not
 * behind any feature flag and cannot be turned off. This is a known class of "Chrome GREASE
 * breaks strict TLS middleboxes" bug, not fixable from the Chromium side.
 *
 * WHAT THIS DOES. Runs a tiny local forward proxy that Chromium is pointed at instead of the real
 * egress proxy:
 *   1. Accepts Chromium's HTTP CONNECT for the target host and answers 200 immediately.
 *   2. Terminates TLS on that raw socket ITSELF (a locally generated, throwaway self-signed cert —
 *      Chromium is launched with --ignore-certificate-errors so it doesn't care that the cert
 *      doesn't match). Node's TLS stack (unlike the strict proxy) tolerates Chromium's GREASE
 *      values fine, so this handshake succeeds where the direct one didn't.
 *   3. Re-issues the now-decrypted HTTP request as a normal `fetch()` from Node, which — run with
 *      NODE_USE_ENV_PROXY=1 — goes through the REAL sanctioned egress proxy with full certificate
 *      validation against the real target. Nothing here disables TLS verification for the actual
 *      destination or bypasses the org's egress policy; it only accommodates Chromium's ClientHello
 *      shape on the local, loopback-only leg.
 *   4. Streams the response back to Chromium over the terminated connection.
 *
 * USAGE. Don't call chromium.launch() with a `proxy` option yourself when using this relay — instead
 * preload the shim, which patches playwright's chromium.launch() to route through the relay
 * automatically for the lifetime of the process:
 *
 *   node --require ./testing/scripts/lib/chromium-relay-shim.cjs your-script.mjs
 *
 * or from your own driver script:
 *   const { startRelay } = require('./testing/scripts/lib/chromium-relay.cjs');
 *   const { port } = await startRelay();
 *   const browser = await chromium.launch({ proxy: { server: `http://127.0.0.1:${port}` },
 *                                            args: ['--ignore-certificate-errors'] });
 *
 * Requires: `openssl` on PATH (cert generation, one-time per relay start), Node >= 22.21 for
 * NODE_USE_ENV_PROXY (set it in the environment before running — this file does not set it for
 * you, since it must be visible to the whole process, not just this module).
 *
 * Only ever needed in a sandboxed session with this exact proxy-vs-Chromium incompatibility. On a
 * normal machine or CI runner with direct internet access, skip this entirely.
 */
const http = require('http');
const tls = require('tls');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let relayPromise = null;

function generateSelfSignedCert() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pact-chromium-relay-'));
  const keyPath = path.join(dir, 'key.pem');
  const certPath = path.join(dir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650',
    '-keyout', keyPath, '-out', certPath, '-subj', '/CN=pact-review-relay'], { stdio: 'ignore' });
  return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
}

/** Re-issue a decoded request as `fetch(targetUrl)` and stream the response back. Shared by the
 *  TLS-terminated HTTPS path and the plain-HTTP forward-proxy path — same logic either way once
 *  the target URL is known. NODE_USE_ENV_PROXY=1 (set by the caller, see file header) is what
 *  sends this fetch() through the real sanctioned egress proxy for external hosts, while a local
 *  target like http://localhost:7971 goes direct (127.0.0.1/localhost are already in NO_PROXY). */
async function forward(req, res, targetUrl) {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = { ...req.headers };
    delete headers.host; delete headers.connection; delete headers['content-length'];
    const upstream = await fetch(targetUrl, { method: req.method, headers, body, redirect: 'manual' });
    const outHeaders = {};
    upstream.headers.forEach((v, k) => {
      if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(k.toLowerCase())) {
        outHeaders[k] = v;
      }
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    outHeaders['content-length'] = String(buf.length);
    res.writeHead(upstream.status, outHeaders);
    res.end(buf);
  } catch (e) {
    try { res.writeHead(502, { 'content-type': 'text/plain' }); res.end('relay error: ' + (e && e.message)); }
    catch { /* response already started; nothing more we can do */ }
  }
}

/** Idempotent: repeated calls return the same running relay. */
function startRelay() {
  if (relayPromise) return relayPromise;
  relayPromise = new Promise((resolve, reject) => {
    const { key, cert } = generateSelfSignedCert();

    // "Inner" server: a PLAIN http.createServer (not https!) whose request handler we drive by
    // manually feeding it already-TLS-terminated sockets (emit('connection', ...)) rather than
    // having it listen on a real port itself. By the time a socket reaches here the TLS handshake
    // is already done (see outer.on('connect') below) and reads/writes on it are plaintext, so an
    // http.Server — which treats whatever socket it's given as already-plaintext HTTP — is what we
    // want; an https.Server would try to TLS-wrap the socket a second time and hang. This is what
    // lets us reuse Node's own HTTP/1.1 framing (keep-alive, content-length/chunked) instead of
    // hand-rolling it.
    const inner = http.createServer((req, res) => forward(req, res, `https://${req.headers.host}${req.url}`));

    // "Outer" server: a plain-HTTP forward proxy. Handles two shapes of request Chromium sends
    // here, both because Playwright always appends `<-loopback>` to the Chromium proxy-bypass
    // list (so its own request-interception use cases work) — there is no supported way to make
    // Chromium skip the proxy for local addresses once a `proxy` launch option is set:
    //   1. CONNECT — for HTTPS targets, tunneled through to TLS termination (see below).
    //   2. A normal absolute-URI HTTP request (`GET http://host/path HTTP/1.1`) — for plain-HTTP
    //      targets, e.g. a locally-served review app (http://localhost:7971/...). Forwarded as-is.
    const outer = http.createServer((req, res) => {
      if (/^https?:\/\//i.test(req.url)) return forward(req, res, req.url);
      res.writeHead(400); res.end('use CONNECT for https, or an absolute-URI request for http');
    });
    outer.on('connect', (_req, clientSocket) => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      const tlsSocket = new tls.TLSSocket(clientSocket, { isServer: true, key, cert, ALPNProtocols: ['http/1.1'] });
      tlsSocket.on('error', () => clientSocket.destroy());
      inner.emit('connection', tlsSocket);
    });
    outer.on('error', reject);
    outer.listen(0, '127.0.0.1', () => resolve({ port: outer.address().port, server: outer }));
  });
  return relayPromise;
}

/** Stop the relay if one is running. Only needed by one-shot scripts that want a clean exit
 *  without an explicit process.exit(0) — the relay's listening socket otherwise keeps Node's
 *  event loop alive indefinitely, which is the point for a driver script issuing many
 *  chromium.launch() calls in one process. */
async function stopRelay() {
  if (!relayPromise) return;
  const { server } = await relayPromise;
  relayPromise = null;
  await new Promise((resolve) => server.close(resolve));
}

module.exports = { startRelay, stopRelay };
