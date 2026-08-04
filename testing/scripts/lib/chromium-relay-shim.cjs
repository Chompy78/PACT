'use strict';
/**
 * Preload shim: patches playwright's chromium.launch() so any script that later does
 * `require('playwright')` (any script under testing/scripts/, including ones that resolve
 * `playwright` via NODE_PATH) transparently gets routed through chromium-relay.cjs, with no edits
 * to the target script itself. See chromium-relay.cjs for why this exists.
 *
 * USAGE:
 *   NODE_USE_ENV_PROXY=1 node --require ./testing/scripts/lib/chromium-relay-shim.cjs <target.mjs> [args...]
 *
 * Relies on Node's module cache being process-global and keyed by resolved file path: this
 * require('playwright') call and the target script's later require('playwright') resolve to the
 * same file (given the same NODE_PATH/cwd), so they get the same exports object — patch it once
 * here and every later require sees the patched version.
 */
const { startRelay } = require('./chromium-relay.cjs');
const playwright = require('playwright');

const origLaunch = playwright.chromium.launch.bind(playwright.chromium);
playwright.chromium.launch = async (opts = {}) => {
  const { port } = await startRelay();
  return origLaunch({
    ...opts,
    // No `bypass` option: Playwright always appends `<-loopback>` to whatever bypass list is
    // given (so its own request-interception use cases work against local servers), which
    // overrides any attempt to exempt localhost — so the relay itself has to handle plain-HTTP
    // forward-proxy requests too (see chromium-relay.cjs's `outer` server), not just CONNECT.
    proxy: { server: `http://127.0.0.1:${port}` },
    args: [...(opts.args || []), '--ignore-certificate-errors'],
  });
};
