/* PACT — shared Playwright launcher for the browser-driven gates.
 *
 * Launch the browser Playwright expects; if the pinned client and the installed browser builds
 * don't line up (common on a machine where the browsers are pre-provisioned rather than downloaded
 * per version), fall back to whatever chromium IS on disk instead of failing the gate over a build
 * number. CI installs a matching browser and never reaches the fallback.
 *
 * This lived as two byte-similar copies in chargen-flows-e2e.mjs and dm-console-ui-e2e.mjs while
 * sw-cache-e2e.mjs had none — so that gate was simply unrunnable on a pre-provisioned machine, and
 * "it passes locally" quietly meant "all but one of them passes locally". One copy, used by all
 * three.
 *
 * Usage:  import { launchChromium } from './lib/launch-chromium.mjs';
 *         const browser = await launchChromium();          // or launchChromium({headless:false})
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

export async function launchChromium(opts = {}) {
  try { return await chromium.launch(opts); }
  catch (e) {
    const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
    const candidates = [path.join(root, 'chromium')];
    try {
      for (const d of fs.readdirSync(root).filter(n => /^chromium-\d+$/.test(n)).sort().reverse()) {
        candidates.push(path.join(root, d, 'chrome-linux', 'chrome'));
      }
    } catch { /* no browsers dir — the original error is the useful one */ }
    for (const exe of candidates) {
      try { if (fs.existsSync(exe)) return await chromium.launch({ ...opts, executablePath: exe }); }
      catch { /* next candidate */ }
    }
    throw e;
  }
}
