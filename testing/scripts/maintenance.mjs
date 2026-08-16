#!/usr/bin/env node
/**
 * maintenance.mjs — put the PACT tools into (or out of) maintenance mode with one command.
 *
 *   node testing/scripts/maintenance.mjs status
 *   node testing/scripts/maintenance.mjs on
 *   node testing/scripts/maintenance.mjs off
 *
 * WHAT IT DOES
 *   `on`  writes maintenance.html at the repo root and injects a one-line gate at the top of
 *         <head> in each tool page. The gate redirects to /PACT/maintenance.html before any other
 *         script or asset loads.
 *   `off` removes every gate line and deletes maintenance.html.
 *   Both are idempotent — running `on` twice, or `off` when it's already off, is a no-op.
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH
 *   - docs/PACT-Players-Guide.html — players keep the rules reference during maintenance.
 *   - index.html — the landing page stays up and still links to the guide.
 *   - service-worker.js CACHE_NAME — HTML is network-first, so returning users get the maintenance
 *     page on their next load and get the real tools back just as fast on `off`. Bumping the cache
 *     would precache the maintenance pages and need a second bump to undo. Don't.
 *   - git. Commit and push yourself; see docs/HOW-TO-WORK.md for the exact sequence.
 *
 * BYPASS: append ?maint=off to any tool URL to use it normally while maintenance is up.
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOLS = [
  'tools/PACT-CharGen-Webtool.html',
  'tools/PACT-Live-Char-Sheet.html',
  'tools/DM-Console.html',
  'tools/characters.html',
];
const PAGE = 'maintenance.html';
const MARK = 'PACT-MAINT';
const GATE =
  `<script>/*${MARK}*/(function(){try{if(/[?&]maint=off/.test(location.search))return;` +
  `sessionStorage.setItem('pact-maint-from',location.pathname);}catch(e){}` +
  `location.replace('/PACT/maintenance.html');})();/*/${MARK}*/</script>`;

// Matches the injected gate exactly, wherever it sits on a line. Removing whole LINES would be a
// data-loss bug: CharGen's <head> shares its line with <meta charset="utf-8">.
const GATE_RE = /<script>\/\*PACT-MAINT\*\/[\s\S]*?\/\*\/PACT-MAINT\*\/<\/script>/g;

const p = f => join(ROOT, f);
const read = f => readFileSync(p(f), 'utf-8');
const write = (f, s) => writeFileSync(p(f), s);
const gated = f => read(f).includes(MARK);

const MAINTENANCE_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>PACT — Down for maintenance</title>
<link rel="icon" type="image/png" href="/PACT/assets/icons/PACT_favicon.png">
<style>
  :root{ --bg:#EFE6D2; --page:#FBF5E9; --border:#B89968; --ink:#2b2620; --muted:#6b6155; --accent:#58180D; }
  @media (prefers-color-scheme: dark){
    :root{ --bg:#17151a; --page:#211d24; --border:#4a4150; --ink:#ece6f2; --muted:#a79db4; --accent:#e0b0a0; }
  }
  *{box-sizing:border-box}
  body{ margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px;
    background:var(--bg); color:var(--ink); font:16px/1.6 "Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif; }
  .card{ max-width:34rem; width:100%; background:var(--page); border:1px solid var(--border);
    border-radius:10px; padding:2.25rem 2rem; box-shadow:0 2px 14px rgba(0,0,0,.10); }
  h1{ margin:0 0 .25rem; font-size:1.6rem; color:var(--accent); letter-spacing:.01em }
  .sub{ margin:0 0 1.5rem; color:var(--muted); font-size:.95rem }
  p{ margin:0 0 1rem } ul{ margin:0 0 1rem 1.1rem; padding:0 } li{ margin:.3rem 0 }
  a{ color:var(--accent) }
  .foot{ margin-top:1.5rem; padding-top:1rem; border-top:1px solid var(--border); color:var(--muted); font-size:.85rem }
</style>
</head>
<body>
  <main class="card">
    <h1>PACT is down for maintenance</h1>
    <p class="sub">The character tools are temporarily unavailable.</p>
    <p>The Character Generator, Live Character Sheet and DM Console are offline while
       maintenance is carried out. They'll be back shortly — please check again a little later.</p>
    <p><strong>Your characters are safe.</strong> Nothing has been deleted. Characters saved to the
       cloud are stored in the database and untouched by this work; characters saved locally remain in
       your browser and in any JSON files you exported.</p>
    <p>Still available in the meantime:</p>
    <ul>
      <li><a href="/PACT/docs/PACT-Players-Guide.html">The PACT Player's Guide</a> — the full rules reference</li>
    </ul>
    <p class="foot">If you had unsaved changes open in a tab, leave that tab alone — don't reload it —
       and export to JSON once the tools are back.</p>
  </main>
</body>
</html>
`;

const cmd = (process.argv[2] || 'status').toLowerCase();

function status() {
  const on = TOOLS.filter(gated);
  const page = existsSync(p(PAGE));
  console.log(`maintenance page : ${page ? 'present' : 'absent'}  (${PAGE})`);
  for (const f of TOOLS) console.log(`  ${gated(f) ? 'GATED  ' : 'live   '} ${f}`);
  const state = on.length === TOOLS.length && page ? 'ON'
              : on.length === 0 && !page ? 'OFF' : 'INCONSISTENT';
  console.log(`\nmaintenance mode: ${state}`);
  if (state === 'INCONSISTENT') {
    console.log('  ! some pages are gated and others are not — run `on` or `off` to make it uniform');
    process.exitCode = 2;
  }
  return state;
}

if (cmd === 'status') { status(); }

else if (cmd === 'on') {
  if (!existsSync(p(PAGE))) { write(PAGE, MAINTENANCE_PAGE); console.log(`created ${PAGE}`); }
  else console.log(`${PAGE} already present — left as-is (edit it by hand if the wording needs changing)`);
  for (const f of TOOLS) {
    if (gated(f)) { console.log(`  already gated  ${f}`); continue; }
    const s = read(f);
    const i = s.toLowerCase().indexOf('<head>');
    if (i === -1) { console.error(`  ! no <head> in ${f} — SKIPPED`); process.exitCode = 1; continue; }
    write(f, s.slice(0, i + 6) + GATE + s.slice(i + 6));
    console.log(`  gated          ${f}`);
  }
  console.log('\nmaintenance mode ON. Commit and push to `main` to make it live.');
}

else if (cmd === 'off') {
  for (const f of TOOLS) {
    if (!gated(f)) { console.log(`  already live   ${f}`); continue; }
    write(f, read(f).replace(GATE_RE, ''));
    console.log(`  un-gated       ${f}`);
  }
  if (existsSync(p(PAGE))) { unlinkSync(p(PAGE)); console.log(`deleted ${PAGE}`); }
  console.log('\nmaintenance mode OFF. Commit and push to `main` to lift it for users.');
}

else {
  console.error('usage: node testing/scripts/maintenance.mjs status|on|off');
  process.exit(2);
}
