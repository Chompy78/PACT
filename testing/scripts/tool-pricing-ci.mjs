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
 * The DM Console section below is a deliberate, narrow exception to the "pricing" scope in this file's
 * name: `dm-console-ui-e2e.mjs` needs Playwright for its real UI-interaction coverage, but a handful of
 * DM Console checks (fix/unnamed-character-default) only need a pure DOM-render entry point
 * (`window._dmRenderCloudRoster`) over synthetic data, no sign-in, no interaction — reachable with this
 * same zero-dependency CDP harness. Added here rather than growing a fourth CI script for two checks.
 *
 * USAGE   node testing/scripts/tool-pricing-ci.mjs
 *         CHROME_BIN=/path/to/chrome node testing/scripts/tool-pricing-ci.mjs
 * Exits non-zero on any failure, same contract as engine-parity-ci.mjs.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DATA } from '../../js/engine.js';   // v0.352: expected unlock price is read from the dataset, not hardcoded
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
// 30s, not 10. A readiness POLL returns the instant its probe passes, so a longer ceiling costs nothing
// on a fast page and only decides how much contention it survives. This gate now opens ~10 tabs across
// three tools, and CharGen alone is 376 KB plus a deferred module bridge — at 10s it failed roughly one
// run in five with "CharGen never became ready", intermittently and only under that load. Same budget and
// same fix as the CDP connect loop above; the two were written 10s apart for no reason but habit.
const READY = (probe) => `(async()=>{for(let i=0;i<300;i++){if(${probe})return true;await new Promise(r=>setTimeout(r,100));}return false;})()`;

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
// Chrome's stderr is CAPTURED, not discarded. It used to be `stdio: 'ignore'`, which meant a Chromium
// that refused to start looked exactly like one that was merely slow — and the only symptom either way
// was `FAIL harness — fetch failed` from the first real CDP call, naming nothing.
const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${fs.mkdtempSync('/tmp/pact-cdp-')}`, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeErr = '', chromeExit = null;
proc.stderr.on('data', d => { chromeErr += d.toString().slice(0, 4000); });
proc.on('exit', c => { chromeExit = c; });
proc.on('error', e => { chromeErr += `spawn error: ${e.message}\n`; });

// Wait for the debugging endpoint rather than sleeping a fixed amount.
//
// WHY THIS BLOCK IS SO LOUD. The old version polled 100 x 100ms and then fell through WITHOUT checking
// whether it had ever connected, so a Chromium that never bound the port produced a bare "fetch failed"
// ten seconds later, from a line that looks nothing like a browser-startup problem. That cost a real
// debugging session on 2026-08-19: the gate went red on a commit containing only version strings, which
// made it look like a code regression when the runner image was the variable. A gate that cannot say why
// it failed is worth less than its runtime.
//
// The budget is 30s, not 10s: the GitHub-hosted image does not guarantee a working Chrome, and 10s is
// under the cold-start time on a contended runner even when one is present.
const CDP_WAIT_MS = 30000, CDP_POLL_MS = 100;
let cdpUp = false;
const t0 = Date.now();
for (let i = 0; i < CDP_WAIT_MS / CDP_POLL_MS; i++) {
  try { await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`); cdpUp = true; break; }
  catch { await new Promise(r => setTimeout(r, CDP_POLL_MS)); }
}
if (!cdpUp) {
  console.error(`\n✗ Chromium never opened its DevTools port ${CDP_PORT} within ${CDP_WAIT_MS / 1000}s.`);
  console.error(`  binary       : ${chrome}`);
  console.error(`  waited       : ${Date.now() - t0} ms`);
  console.error(`  chrome exited: ${chromeExit === null ? 'no — still running, so it started but never bound the port' : chromeExit}`);
  console.error(`  chrome stderr: ${chromeErr.trim() || '(nothing)'}`);
  console.error(`\n  This is an ENVIRONMENT failure, not a pricing regression — no assertion ran.`);
  console.error(`  Set CHROME_BIN to a known-good Chromium, or PLAYWRIGHT_BROWSERS_PATH to a cache holding one.`);
  try { proc.kill(); } catch {}
  server.close();
  process.exit(3);          // distinct from 1 (a real pricing failure) and 2 (no browser found at all)
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
  // v0.352: flat, so the two checks below assert the SAME number by design — the second is no longer
  // an independence check against a ladder rung but a guard that flatness actually holds. Read from
  // DATA rather than hardcoded, so a future price change cannot leave this test asserting a stale figure.
  const UNLOCK = DATA.unlockCum[1] - DATA.unlockCum[0];
  check(`unlock Wizard == flat ${UNLOCK} AP, owning 4 Wizard features`,
    await ls.evaluate(`priceOf('unlockclass',{v:'Wizard'},${withWiz})`), UNLOCK);
  check('unlock Wizard == the same owning none (flatness holds)',
    await ls.evaluate(`priceOf('unlockclass',{v:'Wizard'},foldBuild(null))`), UNLOCK);
  // Regression guard: the buy list filters only originClass, so originClass2 is offered. The engine
  // excludes it from the unlock count, and the pricer must agree — otherwise we charge for a no-op.
  check('unlock a class that is already the 2nd origin == 0',
    await ls.evaluate(`priceOf('unlockclass',{v:'Rogue'},(()=>{const b=foldBuild(null);b.originClass2='Rogue';return b;})())`), 0);

  // Reported by the owner: a racial trait gated only by its TIER (no explicit minHD) could be bought at
  // any level here, while CharGen correctly refused it. Draconic flight is T4, so it needs 5 Hit Dice.
  console.log('\nLive Sheet — a racial trait is gated by its tier, as CharGen already gates it');
  check('Draconic flight (T4) is refused at 1 HD',
    await ls.evaluate(`(()=>{const r=DATA.racial['Dragonborn: Draconic flight'];
      const need=DATA.tierHD[r.tier];
      return [r.tier, need, r.minHD===undefined];})()`), [4, 5, true]);
  // Drives the real buy panel (#buy) for a Dragonborn, so it proves the gate is WIRED, not just that
  // the numbers exist in DATA. At 1 HD the row must carry the reason; at 5 HD it must not.
  // Drives the real buy panel for a Dragonborn, so this proves the gate is WIRED, not merely that the
  // numbers exist in DATA. setBuyQuery() forces every collapsed section to render (buy panel line ~1148).
  // At 1 HD the row must carry the reason; at 5 HD it must not.
  check('the buy panel gates Draconic flight at 1 HD and releases it at 5 HD',
    await ls.evaluate(`(()=>{const saved=LOG.map(e=>JSON.parse(JSON.stringify(e)));
      const at=(hd)=>{LOG.length=0;saved.forEach(e=>LOG.push(e));
        LOG.push({seq:9e6,type:'buy',cat:'patch',payload:{patch:{species:'Dragonborn'}},cost:0});
        LOG.push({seq:9e6+1,type:'buy',cat:'hd',payload:{to:hd},cost:0});
        setBuyQuery('Draconic'); render();
        const el=[...document.querySelectorAll('#buy *')].find(n=>/Draconic flight/i.test(n.textContent||''));
        return el ? /needs 5 Hit Dice/.test(el.textContent) : 'ROW NOT FOUND';};
      const r=[at(1), at(5)];
      LOG.length=0;saved.forEach(e=>LOG.push(e));setBuyQuery(''); render();
      return r;})()`), [true, false]);

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
  // Regression guard: `#tray li{color:var(--bad)}` is a blanket rule that painted every advisory the
  // same red as a rules violation, overriding the grey on the containing <ul>. Advisories now carry
  // .adv and must stay amber, matching CharGen.
  check('advisories in the tray are amber, not red',
    await ls.evaluate(`getComputedStyle(document.querySelector('#tray li.adv')).color`), 'rgb(178, 106, 0)');
  // The footer's rules version was a hardcoded literal and had fallen 30 versions behind (v0.309 while
  // DATA.version was v0.339) — missed by the promotion checklist because VERSION-SYNC.md doesn't name
  // it. Assert it EQUALS DATA.version rather than a fixed string, so the check never needs a rules bump.
  check('the Live Sheet footer shows the live DATA.version, not a hardcoded literal',
    await ls.evaluate(`(()=>{const el=document.getElementById('lsRulesVer');
      return [el?el.textContent:'(missing)', el?el.textContent===DATA.version:false];})()`),
    [await ls.evaluate(`DATA.version`), true]);

  // Every buy below drives the REAL buy()/buyManeuver() path with the modals captured, so a check
  // fails if the guard is deleted rather than merely if a constant moves. Each rebuilds LOG first.
  const LS_SETUP = `window.__a=[];window.__c=[];window.__f=[];
    window.alert=m=>window.__a.push(String(m));window.confirm=m=>{window.__c.push(String(m));return true;};
    window.flash=m=>window.__f.push(String(m));
    LOG.length=0;SEQ=1;REDO.length=0;`;

  // The campaign binding is written into the autosave envelope but load() used to drop it, so every
  // page refresh detached a campaign-bound character until an async cloud round-trip re-resolved it —
  // and that round-trip minted a fresh id when none was set, queried a character that had never
  // existed, and nulled the binding again. The local half needs no sign-in, so it is coverable here.
  console.log('\nLive Sheet — a campaign binding survives the autosave round-trip');
  check('save() writes campaignId and load() restores it, with a stable character id',
    await ls.evaluate(`(()=>{${LS_SETUP}
      LOG.push({type:'award',amount:50,label:'AP award',seq:SEQ++,ts:Date.now()});
      window._lsCampaignId='camp-test-1'; const idBefore=currentCharId(); save();
      const stored=JSON.parse(localStorage.getItem(KEY));
      window._lsCampaignId=null; LOG.length=0; SEQ=1; __charId=null;   // as a fresh boot would
      load();
      return [stored.campaignId||null, window._lsCampaignId||null, peekCharId()===idBefore];})()`),
    ['camp-test-1', 'camp-test-1', true]);
  // currentCharId() mints on read — right for a genuinely new character, a hazard in a lookup.
  check('peekCharId() answers "have we an id" without minting one',
    await ls.evaluate(`(()=>{const keep=__charId; __charId=null;
      const peeked=peekCharId(); const stillNone=(__charId===null);
      __charId=keep; return [peeked, stillNone];})()`), [null, true]);

  // An epic boon's "choose an ability to raise" prompt is a follow-up, not a rules violation. Before
  // the fix buy() classified it as hard and all 12 epic:true boons were unbuyable.
  console.log('\nLive Sheet — an expected follow-up neither blocks a purchase nor asks to confirm it');
  check('all 12 epic boons buy on a HD-17 character, with no alert and no confirm',
    await ls.evaluate(`(()=>{${LS_SETUP}
      LOG.push({type:'award',amount:900,label:'AP award',seq:SEQ++,ts:Date.now()});
      for(let h=2;h<=17;h++){const b=foldBuild(null);
        LOG.push({type:'buy',cat:'hd',payload:{to:h},cost:priceOf('hd',{to:h},b),label:'Level up',seq:SEQ++,ts:Date.now(),level:b.hd});}
      const epics=DATA.boonList.filter(x=>DATA.boons[x].epic);
      epics.forEach(n=>buy('boon',{v:n},n));
      const got=(foldBuild(null).boons||[]).filter(x=>DATA.boons[x].epic).length;
      return [epics.length,got,window.__a.length,window.__c.length];})()`), [12, 12, 0, 0]);
  check('a genuinely illegal purchase is still hard-blocked',
    await ls.evaluate(`(()=>{window.__a=[];const n=LOG.length;
      buy('art',{v:'Crossbow Expert'},'Crossbow Expert');
      return [LOG.length===n, /Purchase blocked/.test(window.__a[0]||'')];})()`), [true, true]);
  // The event's `warns` array is the record of what was flagged and clicked through, and the history
  // ledger paints any row carrying one red (.warnrow). A follow-up is a to-do, not a violation, so it
  // must NOT be frozen into the LOG — it would mark the boon a rules breach forever, including after
  // the ability is chosen, and `warns` travels inside the saved envelope.
  check('the follow-up is not frozen into the event, and its history row is not a warn row',
    await ls.evaluate(`(()=>{const ev=LOG.filter(e=>e.cat==='boon').pop(); render();
      const row=[...document.querySelectorAll('.led tr')].find(tr=>/Boon of Fate/.test(tr.innerText||''));
      return [ev.warns, row?row.className:'(row not found)'];})()`), [[], '']);
  // …but a REAL soft warning must still be stored, or "always emit []" would pass the check above.
  check('a genuinely soft-warned purchase still records its warning on the event',
    await ls.evaluate(`(()=>{const names=Object.keys(DATA.features).filter(k=>/: Extra Attack$/.test(k));
      buy('feature',{v:names[0]},names[0]); buy('feature',{v:names[1]},names[1]);
      const ev=LOG[LOG.length-1];
      return [ev.cat, (ev.warns||[]).length, /add no benefit/.test((ev.warns||[])[0]||'')];})()`),
    ['feature', 1, true]);
  // The buy panel builds its own classification in ib(); before the fix it had no knowledge of
  // EXPECTED_FOLLOWUP, so all 12 epic boons were the only permanently amber-warned tiles in the panel
  // while clicking them bought cleanly — the panel and buy() disagreeing about the same string.
  // Rebuild the character first: the block above already bought all 12 epic boons, and an owned item
  // renders through ibOwned() as "ib dis" with the boon's effect text — which would pass a laxer
  // assertion for entirely the wrong reason. The tile under test must be an UNOWNED, affordable one.
  check('the epic-boon tile keeps its guidance text but drops the amber warning styling',
    await ls.evaluate(`(()=>{${LS_SETUP}
      LOG.push({type:'award',amount:900,label:'AP award',seq:SEQ++,ts:Date.now()});
      for(let h=2;h<=17;h++){const b=foldBuild(null);
        LOG.push({type:'buy',cat:'hd',payload:{to:h},cost:priceOf('hd',{to:h},b),label:'Level up',seq:SEQ++,ts:Date.now(),level:b.hd});}
      render(); setBuyQuery('boon of truesight');
      const t=[...document.querySelectorAll('#buy button.ib')].find(x=>/Boon of Truesight/.test(x.innerText||''));
      const r=t?[t.className,(t.querySelector('.why')||{}).innerText||'']:['(tile not found)',''];
      setBuyQuery(''); return r;})()`),
    ['ib', 'Boon of Truesight: choose an ability to raise (+2)']);

  // buyManeuver() used to emit() straight past buy()'s affordability gate — the one unguarded buy
  // path in the tool. Measured before the fix: 0 AP -> -22 over four clicks at 4/5/6/7.
  console.log('\nLive Sheet — the extra-maneuver purchase goes through the affordability gate');
  const MV = `${LS_SETUP}
    LOG.push({type:'buy',cat:'feature',payload:{v:'Fighter: Combat Superiority (maneuvers)'},cost:0,label:'CS',seq:SEQ++,ts:Date.now(),level:1});
    const avail=()=>_apRemaining(compute(foldBuild(null),_dmOpts()).spendable,economy(null).spent);
    const drain=avail();if(drain)LOG.push({type:'award',amount:-drain,label:'AP award',disc:true,seq:SEQ++,ts:Date.now()});`;
  check('at 0 AP four clicks buy nothing and AP never goes negative',
    await ls.evaluate(`(()=>{${MV}
      for(let i=0;i<4;i++)buyManeuver();
      return [foldBuild(null).maneuverBuys||0, avail(), window.__f[0]||''];})()`),
    [0, 0, 'Not enough AP: needs 4, have 0']);
  // The rung must come from DATA, not a literal in the tool — D1's finding is that the pricing escapes
  // exist precisely where the price was never in DATA. Perturbing DATA.maneuverBuy and watching the
  // quote move is what distinguishes "reads the dataset" from "happens to agree with it today".
  check('the maneuver rung is read from DATA, not hardcoded in the tool',
    await ls.evaluate(`(()=>{${MV}
      const q=n=>{const b=foldBuild(null);b.maneuverBuys=n;return priceOf('mvbuy',{},b);};
      const real=[q(0),q(1),q(2)];
      const keep=JSON.parse(JSON.stringify(DATA.maneuverBuy));
      DATA.maneuverBuy={base:10,step:3};
      const moved=[q(0),q(1),q(2)];
      DATA.maneuverBuy=keep;
      const restored=[q(0),q(1),q(2)];
      return [real,moved,restored];})()`),
    [[4, 5, 6], [10, 13, 16], [4, 5, 6]]);
  check('with 15 AP the rungs still charge 4, 5, 6 and then refuse the 7',
    await ls.evaluate(`(()=>{${MV}
      LOG.push({type:'award',amount:15,label:'AP award',disc:true,seq:SEQ++,ts:Date.now()});
      const costs=[];for(let i=0;i<4;i++){const n=LOG.length;buyManeuver();if(LOG.length>n)costs.push(LOG[LOG.length-1].cost);}
      return [costs, avail(), window.__f[window.__f.length-1]||''];})()`),
    [[4, 5, 6], 0, 'Not enough AP: needs 7, have 0']);

  // activeEvents() used to key its boughtOff map by drawback VALUE, so any buyoff for a drawback
  // suppressed EVERY buy of that value forever — including a retake AFTER the buyoff. The retake was
  // silently dropped from the build, its AP never counted, and the UI made it structurally
  // unreachable: the buy panel showed a permanently-disabled "Bought off" tile (ibOwned never fires
  // takeDrawback), and every history row for that value — including the retake's — rendered "dead".
  console.log('\nLive Sheet — a bought-off drawback can be taken again');
  // buyoffDrawback() has its own affordability gate (cost=refund*3 > available -> refuse). A drawback
  // buy alone only earns its own refund (2 AP), well under the 6 AP a buy-off costs, so an award is
  // required here or buyoffDrawback() silently no-ops and the whole scenario never happens.
  const DB_SETUP = `${LS_SETUP} const v='Asthmatic';
    LOG.push({type:'award',amount:60,label:'AP award',seq:SEQ++,ts:Date.now()});`;
  check('the retake is on the build, earns its AP, and only the FIRST row is dead in the ledger',
    await ls.evaluate(`(()=>{${DB_SETUP}
      takeDrawback(v); buyoffDrawback(v); takeDrawback(v);
      render();
      const rows=[...document.querySelectorAll('.led tr')].filter(tr=>/Drawback . Asthmatic/.test(tr.innerText||''));
      return [foldBuild(null).drawbacks.includes(v), economy(null).drawbackEarned,
              rows.length, rows.map(tr=>/\\bdead\\b/.test(tr.className))];})()`),
    [true, 2, 2, [true, false]]);
  check('the buy panel offers a normal, clickable buy — not a permanently-disabled "Bought off" tile',
    await ls.evaluate(`(()=>{${DB_SETUP}
      takeDrawback(v); buyoffDrawback(v);   // bought off, NOT retaken — build must not hold it
      render();
      setBuyQuery('asthmatic');
      const t=[...document.querySelectorAll('#buy button.ib')].find(x=>/Asthmatic/.test(x.innerText||''));
      const before=foldBuild(null).drawbacks.includes(v);
      const clickable=t?!t.className.includes(' dis'):false;
      if(t)t.click();
      const after=foldBuild(null).drawbacks.includes(v);
      setBuyQuery('');
      return [before, clickable, after];})()`),
    [false, true, true]);

  // code-review finding (this session): the ledger's "dead" styling only ever checked
  // boughtOff (drawbacks) — a DM-removed boon's original buy row rendered as a normal, fully-priced,
  // still-active purchase, with the only sign anything happened a separate, uncorrelated dmRemoveBoon
  // row further down. Mirrors the drawback check just above (retake stays live, only the cancelled
  // purchase goes dead) but for the boon/boonRemoved side.
  check('a DM-removed boon\'s original purchase row goes dead in the ledger; a retake afterward stays live',
    await ls.evaluate(`(()=>{${LS_SETUP}
      LOG.push({type:'award',amount:900,label:'AP award',seq:SEQ++,ts:Date.now()});
      for(let h=2;h<=17;h++){const b=foldBuild(null);
        LOG.push({type:'buy',cat:'hd',payload:{to:h},cost:priceOf('hd',{to:h},b),label:'Level up',seq:SEQ++,ts:Date.now(),level:b.hd});}
      const v='Boon of Combat Prowess';
      buy('boon',{v},v);
      LOG.push({type:'dmRemoveBoon',refVal:v,cost:0,dmEdit:true,label:'DM removed boon — '+v,seq:SEQ++,ts:Date.now()});
      buy('boon',{v},v);   // retaken afterward — must stay live, not swept up by the same removal
      render();
      const rows=[...document.querySelectorAll('.led tr')].filter(tr=>/Boon of Combat Prowess/.test(tr.innerText||'')&&!/DM removed/.test(tr.innerText||''));
      return [foldBuild(null).boons.filter(x=>x===v).length, rows.length, rows.map(tr=>/\\bdead\\b/.test(tr.className))];})()`),
    [1, 2, [true, false]]);

  // fix/sheet-tab-appearance-not-persisted: the Sheet tab's Appearance/Background fields (Description,
  // hometown, faith, etc.) used to go through csSave() only — a local, per-tool, per-character-id
  // scratchpad that never touched the LOG, so an edit here silently never reached a cloud save and
  // "disappeared" the moment the character was reopened in the other tool (a different, empty
  // scratchpad namespace — see _sheetStoreKey()). _shCommitAppearanceField now writes the real LOG.
  console.log('\nLive Sheet — Sheet-tab appearance/background fields write into the real LOG');
  check('a field committed via the Sheet writes into b.appearance, not just local scratch',
    await ls.evaluate(`(()=>{${LS_SETUP}
      _shCommitAppearanceField('hometown','Testville');
      return [foldBuild(null).appearance.hometown, csLoad(currentCharId()).ap_hometown||null];})()`),
    ['Testville', null]);
  check('a second field commits in place — one appearance patch event, not two, and both fields merge',
    await ls.evaluate(`(()=>{${LS_SETUP}
      _shCommitAppearanceField('hometown','Testville');
      _shCommitAppearanceField('faith','Old Gods');
      const matches=LOG.filter(e=>e.type==='buy'&&e.cat==='patch'&&e.payload&&e.payload.patch&&e.payload.patch.appearance);
      return [matches.length, foldBuild(null).appearance.hometown, foldBuild(null).appearance.faith];})()`),
    [1, 'Testville', 'Old Gods']);
  check('editing appearance after a later purchase replaces in place, not at the end (so undo stays on the real last action)',
    await ls.evaluate(`(()=>{${LS_SETUP}
      _shCommitAppearanceField('hometown','Testville');
      const apIdxBefore=LOG.findIndex(e=>e.type==='buy'&&e.cat==='patch'&&e.payload&&e.payload.patch&&e.payload.patch.appearance);
      LOG.push({type:'award',amount:10,label:'AP award',seq:SEQ++,ts:Date.now()});
      _shCommitAppearanceField('faith','Old Gods');
      const apIdxAfter=LOG.findIndex(e=>e.type==='buy'&&e.cat==='patch'&&e.payload&&e.payload.patch&&e.payload.patch.appearance);
      return [apIdxBefore, apIdxAfter, LOG[LOG.length-1].type];})()`),
    [0, 0, 'award']);
  check('a pre-existing imported appearance (age, hair) survives an unrelated field edit',
    await ls.evaluate(`(()=>{${LS_SETUP}
      LOG.push({type:'buy',cat:'patch',payload:{patch:{appearance:{age:'32',hair:'silver'}}},cost:0,label:'Appearance & description (0 AP)',seq:SEQ++,ts:Date.now()});
      _shCommitAppearanceField('overall','A grizzled veteran.');
      const ap=foldBuild(null).appearance;
      return [ap.age, ap.hair, ap.overall];})()`),
    ['32', 'silver', 'A grizzled veteran.']);

  // feat/campaign-ap-budget-enforce: a campaign-bound character's CLOUD save (manual + autosave) is
  // refused once the FROZEN LEDGER reads over budget, when the campaign's rules.enforceApBudget is
  // true-or-absent. fix/livesheet-budget-gate-frozen-ledger (2026-08-22): _lsOverApBudget() used to
  // read compute().remaining (a re-price against TODAY's rules, which can diverge from what was
  // actually paid) — now reads apAvailable(null) (economy()'s frozen spent vs compute()'s spendable
  // ceiling), so these build a REAL over/under-budget LOG rather than stubbing compute() — stubbing it
  // would no longer exercise the code path this test means to cover, since compute() is not what
  // _lsOverApBudget() consults for the remaining figure any more.
  console.log('\nLive Sheet — cloud save is blocked while over AP budget, enforced by the campaign');
  check('_lsOverApBudget gates on campaign-bound + enforcement + frozen-ledger-over, independently',
    await ls.evaluate(`(()=>{${LS_SETUP}
      // 10 AP awarded, 50 AP spent — genuinely over budget on the frozen ledger.
      LOG.push({type:'award',amount:10,label:'AP award',seq:SEQ++,ts:Date.now()});
      LOG.push({type:'buy',cat:'feature',payload:{v:'Test Feature'},cost:50,label:'Test (50 AP)',seq:SEQ++,ts:Date.now()});
      window._lsCampaignId=null; window._cloudCampaignRules={enforceApBudget:true};
      const r1=_lsOverApBudget();   // not bound -> false regardless of being over budget
      window._lsCampaignId='camp-1'; window._cloudCampaignRules={enforceApBudget:false};
      const r2=_lsOverApBudget();   // bound but enforcement explicitly off -> false
      window._cloudCampaignRules={};   // absent key -> default true
      const r3=_lsOverApBudget();   // bound + default-enforced + over -> true
      LOG.length=0;SEQ=1;
      // 50 AP awarded, 10 AP spent — genuinely under budget.
      LOG.push({type:'award',amount:50,label:'AP award',seq:SEQ++,ts:Date.now()});
      LOG.push({type:'buy',cat:'feature',payload:{v:'Test Feature'},cost:10,label:'Test (10 AP)',seq:SEQ++,ts:Date.now()});
      const r4=_lsOverApBudget();   // bound + enforced + UNDER -> false
      window._lsCampaignId=null;
      return [r1, r2, r3, r4];})()`),
    [false, false, true, false]);
  check('autosave push skips silently while over budget, warning once per session not every cycle',
    await ls.evaluate(`(()=>{${LS_SETUP}
      LOG.push({type:'award',amount:10,label:'AP award',seq:SEQ++,ts:Date.now()});
      LOG.push({type:'buy',cat:'feature',payload:{v:'Test Feature'},cost:50,label:'Test (50 AP)',seq:SEQ++,ts:Date.now()});
      window._lsCampaignId='camp-1'; window._cloudCampaignRules={};
      window.flash=m=>window.__f.push(String(m));
      let calls=0; const realBridge=window._syncBridge;
      window._syncBridge={saveCharacter:async()=>{calls++;return{};}};
      _lsBudgetWarned=false;
      return _lsCloudPushOnce().then(()=>_lsCloudPushOnce()).then(()=>{
        window._syncBridge=realBridge; window._lsCampaignId=null;
        return [calls, window.__f.length];});})()`),
    [0, 1]);
  check('autosave push proceeds normally when enforcement is off, even over budget',
    await ls.evaluate(`(()=>{${LS_SETUP}
      const real=compute; window.compute=()=>({remaining:-7});
      window._lsCampaignId='camp-1'; window._cloudCampaignRules={enforceApBudget:false};
      let calls=0; const realBridge=window._syncBridge;
      window._syncBridge={saveCharacter:async()=>{calls++;return{synced:true};}};
      return _lsCloudPushOnce().then(()=>{
        window.compute=real; window._syncBridge=realBridge; window._lsCampaignId=null;
        return calls;});})()`),
    1);
  check('autosave push proceeds normally for a non-campaign character, however negative remaining is',
    await ls.evaluate(`(()=>{${LS_SETUP}
      const real=compute; window.compute=()=>({remaining:-999});
      window._lsCampaignId=null;
      let calls=0; const realBridge=window._syncBridge;
      window._syncBridge={saveCharacter:async()=>{calls++;return{synced:true};}};
      return _lsCloudPushOnce().then(()=>{
        window.compute=real; window._syncBridge=realBridge;
        return calls;});})()`),
    1);

  // fix/history-shows-derived-lines: the printable sheet's AP Ledger (renderCharSheet) always priced
  // Heritage pack / 2nd origin species pack correctly from compute() — but History & ledger (the `led`
  // table, driven purely off LOG) showed only the 4 individual 0-cost racial-trait buy events with no
  // sign of the AP the pack actually cost, because there is no LOG event for a derived line. Reproduces
  // the exact Anders Tealeaf shape: Halfling primary + Gnome 2nd origin, 2 pack traits each.
  console.log('\nLive Sheet — history surfaces the same derived pack costs the AP Ledger already prices');
  const PACK_SETUP = `${LS_SETUP}
    LOG.push({seq:SEQ++,type:'buy',cat:'patch',payload:{patch:{species:'Halfling',species2:'Gnome'}},cost:0,label:'Species — Halfling / Gnome'});
    ['Halfling: Halfling Nimbleness','Halfling: Luck','Gnome: Darkvision 60 ft','Gnome: Gnomish Cunning']
      .forEach(v=>LOG.push({seq:SEQ++,type:'buy',cat:'racial',payload:{v:v},cost:0,label:'Species trait — '+v}));
    render();`;
  check('the AP Ledger prices both packs (Heritage 5 + 2nd origin x2 pack 10 = 15), for the fixture to be worth anything',
    await ls.evaluate(`(()=>{${PACK_SETUP}
      const r=compute(foldBuild(null),_dmOpts());
      return r.lines.filter(l=>l[0]==='Heritage pack'||l[0]==='2nd origin species (x2 pack)').map(l=>l[1]);})()`),
    [5, 10]);
  check('history renders a derived row per pack line, summing to the same 15 AP the AP Ledger charges',
    await ls.evaluate(`(()=>{${PACK_SETUP}
      const rows=[...document.querySelectorAll('#ledger tr.derived')];
      return [rows.length, rows.reduce((s,tr)=>s+Number(tr.children[2].textContent),0)];})()`),
    [2, 15]);
  check('each pack-included trait row is marked "· pack" and costs 0, not left looking free with no explanation',
    await ls.evaluate(`(()=>{${PACK_SETUP}
      const rows=[...document.querySelectorAll('#ledger tr')].filter(tr=>/Species trait/.test(tr.innerText||''));
      return [rows.length, rows.every(tr=>/· pack/.test(tr.innerText)), rows.every(tr=>/−0/.test(tr.innerText))];})()`),
    [4, true, true]);
  // Regression guard: a non-pack racial trait (bought post-creation, at a real ladder cost) must NOT
  // get the "· pack" note — only compute()'s own DATA.racial(...).pack flag decides that, never cost===0.
  check('a genuinely-bought, non-pack racial trait is not mislabelled "· pack"',
    await ls.evaluate(`(()=>{${LS_SETUP}
      LOG.push({seq:SEQ++,type:'buy',cat:'patch',payload:{patch:{species:'Dragonborn'}},cost:0});
      LOG.push({seq:SEQ++,type:'buy',cat:'hd',payload:{to:5},cost:0});
      LOG.push({seq:SEQ++,type:'award',amount:20,label:'AP award'});
      const b=foldBuild(null); const cost=priceOf('racial',{v:'Dragonborn: Draconic flight'},b);
      LOG.push({seq:SEQ++,type:'buy',cat:'racial',payload:{v:'Dragonborn: Draconic flight'},cost:cost,label:'Trait: Draconic flight'});
      render();
      const row=[...document.querySelectorAll('#ledger tr')].find(tr=>/Draconic flight/.test(tr.innerText||''));
      return [cost>0, row?/· pack/.test(row.innerText):'(row not found)'];})()`),
    [true, false]);

  // feat/dm-edit-events: buyoffDrawback() must consult the matched purchase's dmEdit/dmLocked/
  // dmRemovalCost flags — a DM-imposed drawback carries its own removal rules, distinct from the
  // unconditional 3x every ordinary player-taken drawback still charges (regression guard below).
  console.log('\nLive Sheet — buyoffDrawback() honours a DM-imposed drawback\'s own removal rules');
  check('a normal, player-taken drawback still buys off at the unconditional 3x (regression guard)',
    await ls.evaluate(`(()=>{${LS_SETUP}
      LOG.push({seq:SEQ++,type:'award',amount:60,label:'AP award'});
      takeDrawback('Asthmatic');
      buyoffDrawback('Asthmatic');
      const ev=LOG[LOG.length-1];
      return [ev.type, ev.cost];})()`),
    ['buyoff', 6]);
  check('a DM-imposed drawback with dmRemovalCost:"flat" buys off at 1x, not 3x',
    await ls.evaluate(`(()=>{${LS_SETUP}
      LOG.push({seq:SEQ++,type:'award',amount:60,label:'AP award'});
      LOG.push({seq:SEQ++,type:'buy',cat:'drawback',payload:{v:'Asthmatic'},cost:0,dmEdit:true,dmLocked:false,dmRemovalCost:'flat',label:'Drawback — Asthmatic (DM imposed)'});
      buyoffDrawback('Asthmatic');
      const ev=LOG[LOG.length-1];
      return [ev.type, ev.cost];})()`),
    ['buyoff', 2]);
  check('a DM-imposed drawback with dmRemovalCost:"expensive" still buys off at 3x',
    await ls.evaluate(`(()=>{${LS_SETUP}
      LOG.push({seq:SEQ++,type:'award',amount:60,label:'AP award'});
      LOG.push({seq:SEQ++,type:'buy',cat:'drawback',payload:{v:'Asthmatic'},cost:0,dmEdit:true,dmLocked:false,dmRemovalCost:'expensive',label:'Drawback — Asthmatic (DM imposed)'});
      buyoffDrawback('Asthmatic');
      const ev=LOG[LOG.length-1];
      return [ev.type, ev.cost];})()`),
    ['buyoff', 6]);
  check('a DM-imposed drawback with dmLocked:true refuses buy-off with a stated reason, not silently',
    await ls.evaluate(`(()=>{${LS_SETUP}
      LOG.push({seq:SEQ++,type:'award',amount:60,label:'AP award'});
      LOG.push({seq:SEQ++,type:'buy',cat:'drawback',payload:{v:'Asthmatic'},cost:0,dmEdit:true,dmLocked:true,dmRemovalCost:'flat',label:'Drawback — Asthmatic (DM imposed)'});
      const n=LOG.length;
      window.__f=[]; window.flash=m=>window.__f.push(String(m));
      buyoffDrawback('Asthmatic');
      return [LOG.length===n, /locked/i.test(window.__f[0]||'')];})()`),
    [true, true]);

  // Ledger rendering: a DM-marked event must render distinctly (the whole point of feat/dm-edit-events)
  // and a locked drawback's row must show the lock, not an active buy-off button.
  console.log('\nLive Sheet — history renders DM-marked events distinctly');
  check('a DM-granted boon\'s buy+award pair both carry the DM badge in history',
    await ls.evaluate(`(()=>{${LS_SETUP}
      LOG.push({seq:SEQ++,type:'buy',cat:'boon',payload:{v:'Boon of Combat Prowess'},cost:25,dmEdit:true,dmId:'dm-1',label:'Boon — Boon of Combat Prowess (DM granted)'});
      LOG.push({seq:SEQ++,type:'award',amount:25,dmEdit:true,dmId:'dm-1',label:'Award — DM boon grant (25 AP)'});
      render();
      const rows=[...document.querySelectorAll('#ledger tr.dmedit')];
      return [rows.length, rows.every(tr=>/DM/.test(tr.innerText))];})()`),
    [2, true]);
  check('a locked DM-imposed drawback shows a lock, not a clickable buy-off button',
    await ls.evaluate(`(()=>{${LS_SETUP}
      LOG.push({seq:SEQ++,type:'buy',cat:'drawback',payload:{v:'Asthmatic'},cost:0,dmEdit:true,dmLocked:true,dmRemovalCost:'flat',label:'Drawback — Asthmatic (DM imposed)'});
      render();
      const row=[...document.querySelectorAll('#ledger tr')].find(tr=>/Asthmatic/.test(tr.innerText||''));
      return [!!row.querySelector('button.x'), /locked/i.test(row.innerText)];})()`),
    [false, true]);
  check('a dmRemoveBoon event itself renders in history, marked as a DM edit',
    await ls.evaluate(`(()=>{${LS_SETUP}
      LOG.push({seq:SEQ++,type:'buy',cat:'boon',payload:{v:'Boon of Combat Prowess'},cost:25,label:'Boon — Boon of Combat Prowess'});
      LOG.push({seq:SEQ++,type:'award',amount:25,label:'AP award'});
      LOG.push({seq:SEQ++,type:'dmRemoveBoon',refVal:'Boon of Combat Prowess',cost:0,dmEdit:true,dmId:'dm-1',label:'DM removed boon — Boon of Combat Prowess'});
      render();
      const row=[...document.querySelectorAll('#ledger tr')].find(tr=>/DM removed boon/.test(tr.innerText||''));
      return [!!row, row?row.className.indexOf('dmedit')>=0:false];})()`),
    [true, true]);

  // Undo barrier: mirrors the existing AP-award check exactly.
  console.log('\nLive Sheet — a DM edit locks history the same way an AP award does');
  check('undo refuses when the last event is a DM edit, with a stated reason',
    await ls.evaluate(`(()=>{${LS_SETUP}
      LOG.push({seq:SEQ++,type:'award',amount:60,label:'AP award'});
      LOG.push({seq:SEQ++,type:'buy',cat:'drawback',payload:{v:'Asthmatic'},cost:0,dmEdit:true,dmLocked:false,dmRemovalCost:'flat',label:'Drawback — Asthmatic (DM imposed)'});
      const n=LOG.length;
      window.__f=[]; window.flash=m=>window.__f.push(String(m));
      undo();
      return [LOG.length===n, /DM edit/i.test(window.__f[window.__f.length-1]||'')];})()`),
    [true, true]);
  check('undo still works normally for an ordinary (non-DM) purchase',
    await ls.evaluate(`(()=>{${LS_SETUP}
      LOG.push({seq:SEQ++,type:'award',amount:60,label:'AP award'});
      takeDrawback('Frail');
      const n=LOG.length;
      undo();
      return LOG.length===n-1;})()`), true);

  // feat/ap-model-reconcile (D-GH-2026-08-10-ap-model-reconcile): a fully DM-funded character used to
  // read "Earned Lv 0" with "0 earned" because trackLevel(eco.earned) can only see the character's own
  // log — DM AP lives only on characters.ap. earnedWithDm() composes it in, mirroring compute()'s own
  // spendable formula exactly.
  console.log('\nLive Sheet — Earned Lv accounts for DM AP (was "Earned Lv 0" even when the DM granted real AP)');
  check('earnedWithDm composes DM AP correctly for all three campaign shapes',
    await ls.evaluate(`[
      earnedWithDm({earned:100},{dmAp:36,ignorePlayerAp:true}),
      earnedWithDm({earned:20},{dmAp:36,ignorePlayerAp:false}),
      earnedWithDm({earned:20},{})
    ]`), [36, 56, 20]);
  // 80 AP (above the Standard curve's L1=79), not 36 — 36 is genuinely below even L0 on the default
  // curve (Amble's real-world shape, per the task doc's own note: intended, not a bug, per the owner's
  // decision — Track-Level reads the curve literally). A dmAp below the curve's floor would show 0
  // both before AND after this fix, for two different reasons, and prove nothing about which is fixed.
  check('a fully DM-funded character (0 in their own log, 80 DM AP, ignore_player_ap on) shows a real Earned Lv, not "Earned Lv 0"',
    await ls.evaluate(`(()=>{${LS_SETUP}
      window._rulesStatus='active'; window._dmAp=80; window._ignorePlayerAp=true;
      render();
      const expectedL = trackLevel(earnedWithDm(economy(null), {dmAp:80, ignorePlayerAp:true}), _levelCurve());
      const text = document.getElementById('eco').innerText;
      window._rulesStatus='none'; window._dmAp=0; window._ignorePlayerAp=false;
      return [expectedL>0, text.indexOf('Earned Lv '+expectedL)>=0, text.indexOf('Earned Lv 0')<0];
    })()`), [true, true, true]);

  await ls.close();

  // ============================ CharGen ============================
  const cg = await connect(`http://127.0.0.1:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`);
  if (!(await cg.evaluate(READY(`window.DATA&&typeof _creationLockState==='function'&&LOG.length>0`))))
    throw new Error('CharGen never became ready');

  // fix/chargen-rules-label-live: the #cgPactver chip and the <title>'s "Rules" half used to hardcode
  // a literal rules version (found 2 versions stale at v0.339 while DATA.version was ahead) — assert
  // both EQUAL DATA.version itself, never a fixed string, so this check never needs a rules bump.
  console.log('\nCharGen — the rules label reads the live DATA.version, not a hardcoded literal');
  check('the #cgPactver chip shows the live DATA.version',
    await cg.evaluate(`(()=>{const el=document.getElementById('cgPactver');
      return [el?el.textContent:'(missing)', el?el.textContent===('PACT rules · '+DATA.version):false];})()`),
    [await cg.evaluate(`'PACT rules · '+DATA.version`), true]);
  check('the <title> "Rules" half shows the live DATA.version',
    await cg.evaluate(`document.title.includes('Rules '+DATA.version)`), true);

  console.log('\nCharGen — armed at boot, notice shown until confirmed');
  // Regression guard for b3b4271: replaceWholeLogFromBuild() reassigns LOG wholesale and bypasses the
  // mutation-API hooks, so a fresh boot used to land here unarmed and un-lockable.
  check('armed at boot, before any user edit', await cg.evaluate(`_creationLockState().armed`), true);
  check('unconfirmed, defaulting to DATA.level1AP',
    await cg.evaluate(`_creationLockState().confirmed===false&&_creationLockState().threshold===DATA.level1AP`), true);
  // Read the real container: document.body.innerHTML also matches the inline <script> SOURCE that
  // contains this same string, which produced a false positive during development. The notice lives in
  // the warnings list ABOVE the Guide, alongside the other advisories — not in the Guide's tips.
  check('notice rendered in the warnings list, not the Guide',
    await cg.evaluate(`/Creation AP not confirmed/.test(document.getElementById('warns').innerText)
      && !/Creation AP not confirmed/.test(document.getElementById('guide').innerText)`), true);
  check('the orange Warnings heading is visible while it shows',
    await cg.evaluate(`getComputedStyle(document.getElementById('warnsHead')).display!=='none'`), true);
  // The notice is not in r.warnings, so the banner has to count it explicitly — it silently didn't at
  // first. Assert the count AND the amber state, so a regression to the old blue `info` banner fails.
  check('top banner counts the notice, in the amber caution state',
    await cg.evaluate(`(()=>{const wb=document.getElementById('warnbanner');
      return wb.className==='warnbanner warn' && /1 note to check/.test(wb.innerText)
        && getComputedStyle(wb).display!=='none';})()`), true);
  check('advisories are amber, not the red used for rules violations',
    await cg.evaluate(`getComputedStyle(document.querySelector('#warns li.adv')).color`), 'rgb(178, 106, 0)');
  check('confirming appends a config event and clears the notice',
    await cg.evaluate(`(()=>{const n=LOG.length;
      emit({type:'creationLockConfig',payload:{threshold:75},label:'test'});render();
      const s=_creationLockState();
      return LOG.length===n+1 && s.threshold===75 && s.confirmed===true
        && !/Creation AP not confirmed/.test(document.getElementById('warns').innerText);})()`), true);

  // ---- draft reconciliation (fix/species-pack-not-charged) ----------------------------------
  // While the character is a draft there is ONE pricing context, so "what was paid" must equal "what
  // it costs to build today". It stopped doing so as soon as a context change left an earlier
  // purchase's frozen cost stale. Driven through the real controls, because the two pricers involved
  // read different sources — onChecklistToggle() quotes against _domReadBuild(), replacePatchSlot()
  // against foldBuild(LOG) — and only the live page exercises both.
  console.log('\nCharGen — a draft ledger reconciles to compute() through a species change');
  const setSpec = (v) => `(()=>{const s=document.getElementById('spec');s.value=${JSON.stringify(v)};
    s.dispatchEvent(new Event('change',{bubbles:true}));})()`;
  const tick = (v) => `(()=>{const e=[...document.querySelectorAll('.racck')].find(x=>x.value===${JSON.stringify(v)});
    if(!e)throw new Error('no trait checkbox for '+${JSON.stringify(v)});
    if(!e.checked){e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}));}})()`;
  const drift = `(economy(LOG).spent - compute(foldBuild(LOG)).total)`;
  const identityCost = `LOG.filter(e=>e.type==='buy'&&e.cat==='patch'&&e._slot==='identity').map(e=>e.cost)`;

  await cg.evaluate(`(()=>{try{localStorage.clear()}catch(e){}})()`);
  await cg.evaluate(`location.reload()`);
  // Pre-existing CI-only flake (not reproduced locally, seen on a PR unrelated to species/traits):
  // engine-readiness (window.DATA/repriceDraft/LOG.length) can land a tick before the Setup panel's
  // own DOM form finishes painting, especially right after a hard reload restarts the whole
  // engine-ready/campaign-ready module boot sequence. setSpec() immediately below needs #spec to
  // exist, so the probe must wait for the form too, not just the engine bridge.
  if (!(await cg.evaluate(READY(`window.DATA&&typeof repriceDraft==='function'&&LOG.length>0&&document.getElementById('spec')`))))
    throw new Error('CharGen never became ready after reload');

  await cg.evaluate(setSpec('Halfling'));
  for (const t of ['Halfling: Brave', 'Halfling: Luck', 'Halfling: Naturally Stealthy',
                   'Halfling: Halfling Nimbleness']) await cg.evaluate(tick(t));
  check('Halfling + 4 traits: ledger == compute', await cg.evaluate(drift), 0);
  // Before the fix this was 13 vs 24: the traits became cross-race purchases and the ledger kept
  // charging own-species prices for them.
  await cg.evaluate(setSpec('Dwarf'));
  check('after switching species to Dwarf: ledger == compute', await cg.evaluate(drift), 0);
  // ...and back. Before the fix the ledger read 2 against a compute() of 13.
  await cg.evaluate(setSpec('Halfling'));
  check('after switching back to Halfling: ledger == compute', await cg.evaluate(drift), 0);
  // The sum being right is not enough — the per-line breakdown has to be readable too. The identity
  // line quoted -4 here until replacePatchSlot() stopped filter-and-appending, which moved the line
  // to the end of the log on every edit and left it pricing traits that came BEFORE it. That negative
  // identity line is the visible symptom the bug was reported as (Anders Tealeaf's -5).
  check('the identity line is the pack price, not a negative correction',
    await cg.evaluate(identityCost), [7]);
  check('editing a slot does not move its ledger line to the end',
    await cg.evaluate(`(()=>{const i=LOG.findIndex(e=>e.type==='buy'&&e.cat==='patch'&&e._slot==='identity');
      return i>-1 && i<LOG.findIndex(e=>e.type==='buy'&&e.cat==='racial');})()`), true);
  // The freeze-at-purchase guarantee is the other half of the model: re-pricing must stop at the lock.
  check('a purchase made while locked keeps its frozen price',
    await cg.evaluate(`(()=>{const l=[{seq:1,type:'creationLockConfig',payload:{auto:true,threshold:5}},
      {seq:2,type:'buy',cat:'patch',payload:{patch:{species:'Halfling'}},cost:7,_slot:'identity'},
      {seq:3,type:'buy',cat:'racial',payload:{v:'Halfling: Brave'},cost:999}];
      const r=repriceDraft(l);return [r[1].cost,r[2].cost];})()`), [7, 999]);
  check('repriceDraft does not mutate the log it is given',
    await cg.evaluate(`(()=>{const l=[{seq:1,type:'buy',cat:'racial',payload:{v:'Halfling: Brave'},cost:123}];
      const r=repriceDraft(l);return l[0].cost===123 && r[0]!==l[0];})()`), true);

  // ---- regressions found by code review of the first version of this fix ----------------------
  // Re-pricing is all-or-nothing per log, because the auto-lock's POSITION is a function of the very
  // costs it rewrites. The first version decided per event and broke both ways: the numbers kept
  // moving on repeated calls, and a locked character's frozen prices got re-derived.
  console.log('\nCharGen — re-pricing stops dead once the lock has fired');
  const lockedLog = `[{seq:1,type:'creationLockConfig',payload:{auto:true,threshold:6}},
    {seq:2,type:'buy',cat:'patch',payload:{patch:{species:'Dwarf'}},cost:7,_slot:'identity'},
    {seq:3,type:'buy',cat:'racial',payload:{v:'Halfling: Brave'},cost:6},
    {seq:4,type:'buy',cat:'racial',payload:{v:'Halfling: Luck'},cost:6},
    {seq:5,type:'buy',cat:'racial',payload:{v:'Halfling: Naturally Stealthy'},cost:6},
    {seq:6,type:'buy',cat:'racial',payload:{v:'Halfling: Halfling Nimbleness'},cost:6}]`;
  // Four traits, not two, and that matters: the edit below drops the identity cost to -4, so cumulative
  // spend only passes the threshold partway through the traits. With two, the lock fires on the LAST
  // event, nothing is flagged locked, and the log is correctly still a draft — which is a true result
  // but not the case this assertion is about.
  check('isCreationDraft: armed but under threshold is still a draft',
    await cg.evaluate(`isCreationDraft([{seq:1,type:'creationLockConfig',payload:{auto:true}},
      {seq:2,type:'buy',cat:'racial',payload:{v:'Halfling: Brave'},cost:2}])`), true);
  check('isCreationDraft: spend past the threshold is not',
    await cg.evaluate(`isCreationDraft(${lockedLog})`), false);
  // The exact regression: editing species on a locked character wrote the new quote at the old index,
  // which sits BEFORE the lock — so the pass treated it as draft state and re-derived purchases made
  // while locked. `Halfling: Brave`, frozen at 6, silently became 2.
  check('a locked log is returned untouched, even after a species edit',
    await cg.evaluate(`(()=>{const l=${lockedLog};
      l[1]={...l[1],payload:{patch:{species:'Halfling'}},cost:-4};
      const r=repriceDraft(l);
      return r.filter(e=>e.type==='buy').map(e=>e.cost);})()`), [-4, 6, 6, 6, 6]);
  check('re-pricing a draft is a fixed point after ONE pass',
    await cg.evaluate(`(()=>{const l=[{seq:1,type:'creationLockConfig',payload:{auto:true}},
      {seq:2,type:'buy',cat:'patch',payload:{patch:{species:'Halfling'}},cost:0,_slot:'identity'},
      {seq:3,type:'buy',cat:'racial',payload:{v:'Halfling: Brave'},cost:0},
      {seq:4,type:'buy',cat:'racial',payload:{v:'Halfling: Naturally Stealthy'},cost:0}];
      const a=repriceDraft(l), b=repriceDraft(a);
      return JSON.stringify(a.map(e=>e.cost))===JSON.stringify(b.map(e=>e.cost));})()`), true);

  // Loading a saved character is the path a pre-existing under-recorded ledger actually arrives by.
  // _cgApplyEnvelope reinstates the saved LOG verbatim AFTER applyBuild(), discarding the reprice that
  // replaceWholeLogFromBuild had just done — so a loaded file kept its stale ledger until some later,
  // unrelated edit made it jump.
  // H2 (owner, 2026-08-06): creation ends by RECORDING it. Both lock paths were dead in CharGen — the
  // automatic one is suppressed by the burst's blanket noLock (which fixes D-GH34 and must stay), and
  // no tool had ever emitted the explicit creationLocked the engine calls "the primary intended
  // trigger". So the lock never fired, and being derived state it was gone again after every reload.
  console.log('\nCharGen — the creation lock is recorded, so it survives a reload');
  const OVER_THRESHOLD = `LOG.length=0;SEQ=1;_cgEnsureLockArmed();
    LOG.push({type:'award',amount:600,note:'Budget',label:'Award',seq:SEQ++,ts:1});
    ['STR','DEX','CON','INT','WIS','CHA'].forEach(a=>LOG.push(
      {type:'buy',cat:'abil',payload:{ab:a,to:18},cost:0,label:a+' 18',seq:SEQ++,ts:1,level:1}));
    _cgRepriceDraft();`;
  check('spending past the threshold appends creationLocked, once, and ends the draft',
    await cg.evaluate(`(()=>{${OVER_THRESHOLD}
      const n=()=>LOG.filter(e=>e&&e.type==='creationLocked').length;
      const first=n(); _cgRepriceDraft(); _cgRepriceDraft();
      return [_creationLockState().spent>_creationLockState().threshold, first, n(), isCreationDraft(LOG)];})()`),
    [true, 1, 1, false]);
  // The whole point: replaying the SAVED log still sees it. Before this the lock was re-derived from
  // noLock-tagged spend, so it evaluated to false on every fresh boot.
  check('a fresh replay of the saved log is still locked',
    await cg.evaluate(`(()=>{const saved=JSON.parse(JSON.stringify(LOG));
      return [isCreationDraft(saved), saved.some(e=>e.type==='creationLocked')];})()`), [false, true]);
  // D-GH32: a character that opted out must never auto-lock, however much it spends.
  check('a disarmed character never auto-locks',
    await cg.evaluate(`(()=>{LOG.length=0;SEQ=1;
      LOG.push({type:'creationLockConfig',payload:{auto:false},label:'disarmed',seq:SEQ++,ts:1});
      LOG.push({type:'award',amount:600,note:'Budget',label:'Award',seq:SEQ++,ts:1});
      ['STR','DEX','CON','INT','WIS','CHA'].forEach(a=>LOG.push(
        {type:'buy',cat:'abil',payload:{ab:a,to:18},cost:0,label:a+' 18',seq:SEQ++,ts:1,level:1}));
      _cgRepriceDraft();
      return [_creationLockState().armed, LOG.some(e=>e.type==='creationLocked'), isCreationDraft(LOG)];})()`),
    [false, false, true]);
  // A DM's explicit unlock must not be undone on the next keystroke by a character already sitting over
  // the threshold — that is exactly why _explicitUnlocked exists in the engine. Measured without the
  // guard: [creationLocked, creationUnlocked, creationLocked].
  check('an explicit unlock is not immediately re-locked',
    await cg.evaluate(`(()=>{${OVER_THRESHOLD}
      LOG.push({type:'creationUnlocked',label:'DM unlocked',seq:SEQ++,ts:1});
      _cgRepriceDraft(); _cgRepriceDraft();
      return LOG.filter(e=>e&&/^creation(Locked|Unlocked)$/.test(e.type)).map(e=>e.type);})()`),
    ['creationLocked', 'creationUnlocked']);
  // D-GH34 must stay fixed: the burst's events keep noLock, so the lock lands AFTER the whole burst
  // rather than at an arbitrary point in its synthetic serialization order.
  check('an imported over-budget character locks after the burst, not inside it',
    await cg.evaluate(`(()=>{const b=_domReadBuild();
      b.budget=600; b.species='Dwarf'; b.hd=5;
      b.stats={STR:18,DEX:18,CON:18,INT:16,WIS:16,CHA:14};
      replaceWholeLogFromBuild(b);
      const i=LOG.findIndex(e=>e&&e.type==='creationLocked');
      const buys=LOG.filter(e=>e&&e.type==='buy');
      return [i>=0, i===LOG.length-1, buys.every(e=>e.noLock===true),
              LOG.slice(i+1).filter(e=>e&&e.type==='buy').length];})()`),
    [true, true, true, 0]);

  console.log('\nCharGen — loading a saved character reconciles its ledger');
  check('a stale under-recorded ledger reconciles on load, not on the next edit',
    await cg.evaluate(`(()=>{
      const LOGIN=[{seq:1,type:'creationLockConfig',payload:{auto:true}},
        {seq:2,type:'buy',cat:'racial',payload:{v:'Halfling: Brave'},cost:0},
        {seq:3,type:'buy',cat:'racial',payload:{v:'Halfling: Naturally Stealthy'},cost:0},
        {seq:4,type:'buy',cat:'patch',payload:{patch:{species:'Halfling'}},cost:0,_slot:'identity'}];
      _cgApplyEnvelope({schema:'pact-character/1',rules:DATA.version,name:'Stale',LOG:LOGIN,SEQ:5});
      return economy(LOG).spent - compute(foldBuild(LOG)).total;})()`), 0);

  // ---- building level + budget track (feat/creation-vs-awarded-ap) ---------------------------
  // The old control was a 751-option AP dropdown. Level + track now derives all three numbers:
  // total AP from the curve, creation AP (the level-1 figure, which is what the lock measures),
  // and the remainder, which behaves as awarded AP bought at post-creation prices.
  console.log('\nCharGen — level + track derives budget, creation AP and the lock threshold');
  const pick = (lvl, curve) => `(()=>{const c=document.getElementById('buildCurve');
    c.value=${JSON.stringify('')}||c.value;c.value=${JSON.stringify(curve)};
    c.dispatchEvent(new Event('change',{bubbles:true}));
    const l=document.getElementById('buildLevel');l.value=${JSON.stringify(String(lvl))};
    l.dispatchEvent(new Event('change',{bubbles:true}));
    return [Number(document.getElementById('budget').value), _creationLockState().threshold];})()`;
  check('level 1 standard = 79 total, 79 creation', await cg.evaluate(pick(1, 'standard')), [79, 79]);
  check('level 5 standard = 175 total, 79 creation (96 awarded)', await cg.evaluate(pick(5, 'standard')), [175, 79]);
  check('level 5 lean = 155 total, 75 creation', await cg.evaluate(pick(5, 'lean')), [155, 75]);
  check('level 5 generous = 195 total, 83 creation', await cg.evaluate(pick(5, 'generous')), [195, 83]);
  // Level 0 is the case the formula has to get right on its own: the prelude total (55) is BELOW the
  // curve's level-1 figure, so creation AP clamps to the total and the whole budget is creation spending.
  check('level 0 prelude = 55 total, 55 creation (nothing awarded)', await cg.evaluate(pick(0, 'standard')), [55, 55]);
  check('level 20 standard = 535 total, 79 creation', await cg.evaluate(pick(20, 'standard')), [535, 79]);
  // The threshold is a creationLockConfig event, so it must survive being written to the LOG and read
  // back — this is the half that the old flat DATA.level1AP could never express.
  check('the threshold is carried by an appended config event, not a DOM value',
    await cg.evaluate(`(()=>{const cfg=LOG.filter(e=>e.type==='creationLockConfig'&&e.payload&&e.payload.threshold!=null);
      return cfg.length>0 && cfg[cfg.length-1].payload.threshold===_creationLockState().threshold;})()`), true);
  check('the budget control is a number input, not a 751-option dropdown',
    await cg.evaluate(`(()=>{const b=document.getElementById('budget');
      return [b.tagName, b.options?b.options.length:0];})()`), ['INPUT', 0]);

  // The ledger renders (r.itemize||{})[lineLabel] generically, so the whole fix is engine-side —
  // and it fails SILENTLY if the addItems() key ever stops matching the ledger line's label exactly.
  // Assert on the rendered DOM rather than on compute() so a label drift is caught here.
  // epicBoonAbil is set only by the Live Sheet's Names dialog and has no CharGen control, so a build
  // read from the DOM never carries it. The whole-log rewrite used to drop it silently, leaving the
  // character with a permanent "choose an ability to raise" warning and no way to clear it.
  console.log('\nCharGen — an epic boon\'s ability choice survives a whole-log rewrite');
  check('epicBoonAbil survives load -> DOM rebuild, and the warning clears',
    await cg.evaluate(`(()=>{
      const L=[{type:'award',amount:900,label:'AP award',seq:1,ts:1}]; let s=2;
      for(let h=2;h<=17;h++)L.push({type:'buy',cat:'hd',payload:{to:h},cost:0,label:'lvl',seq:s++,ts:1,level:h-1});
      L.push({type:'buy',cat:'boon',payload:{v:'Boon of Fate'},cost:25,label:'Boon of Fate',seq:s++,ts:1,level:17});
      L.push({type:'names',eb:{'Boon of Fate':'STR'},label:'Named spells & languages',seq:s++,ts:1});
      _cgApplyEnvelope({schema:'pact-character/1',rules:DATA.version,name:'EB',LOG:L,SEQ:s},{clearHistory:true});
      replaceWholeLogFromBuild(_domReadBuild());
      const b=foldBuild(LOG);
      return [(b.epicBoonAbil||{})['Boon of Fate']||null,
              compute(b).warnings.filter(w=>/choose an ability to raise/.test(w)).length];})()`),
    ['STR', 0]);

  // A house-rule name and description are user-typed and ride inside the saved envelope and the cloud
  // `stats` column, so they render in ANOTHER user's browser — this is stored XSS, not a display bug.
  // AGENTS.md makes esc() on every player-controlled value reaching innerHTML a hard invariant.
  console.log('\nCharGen — a house-rule name cannot inject markup, and its controls still work');
  check('an HTML payload in a house-rule name renders as text and executes nothing',
    await cg.evaluate(`(()=>{window.__pwned=0;
      const PAY='<img src=x onerror="window.__pwned=1">', NAME='Cursed '+PAY;
      HOUSE.draws[NAME]={ap:2,fx:'desc '+PAY}; HOUSE.boons[NAME]={hd:1,ap:2,fx:'desc '+PAY};
      buildDrawGrid(); buildBoonGrid(); buildDmList();
      return [window.__pwned,
              document.querySelectorAll('#drawgrid img,#boongrid img,#dmlist img').length,
              (document.getElementById('drawgrid').innerText||'').includes(PAY)];})()`),
    [0, 0, true]);
  // esc() alone would stop the XSS but leave onclick="fn("a"b")" — a syntax error that silently breaks
  // the control. The handler needs JSON.stringify() underneath it, so assert the button actually works.
  check('the DM-list controls still parse and fire for a quote-bearing name',
    await cg.evaluate(`(()=>{const dl=document.getElementById('dmlist');
      const btn=dl.querySelector('button.dmctl'); let parses=false;
      try{ new Function(btn.getAttribute('onclick').replace(/dmToggleDisable/,'window.__got=')); parses=true; }catch(e){}
      const before=/\\boff\\b/.test(dl.querySelector('.dmrow').className);
      btn.click(); buildDmList();
      const after=/\\boff\\b/.test(document.querySelector('#dmlist .dmrow').className);
      return [parses, before!==after];})()`),
    [true, true]);

  // fix/campaign-binding-survives-reload: _cgAdoptEnvelopeBinding() runs from _cgBoot(), which fires
  // synchronously off 'engine-ready' — dispatched by the FIRST of two <script type="module"> blocks,
  // strictly before the SECOND (auth/campaign/sync bridge, kept deliberately separate) has executed and
  // set window._campaignBridge/_syncBridge. Simulate that exact ordering directly rather than requiring
  // a signed-in session: with the bridge undefined, the adopt call must WAIT for 'campaign-ready' before
  // resolving, not silently short-circuit and never retry.
  console.log("\nCharGen — a campaign-bound handoff/autosave resolves after campaign-ready, not before");
  check('_cgAdoptEnvelopeBinding waits for window._campaignBridge instead of resolving with it unset',
    await cg.evaluate(`(async()=>{
      window._campaignBridge = undefined; window._syncBridge = undefined;
      window._dmApStatus = 'none'; window._cgCampaignBound = false; window._cgCampaignId = null;
      let settled = false;
      const p = _cgAdoptEnvelopeBinding({campaignId: 'fake-test-campaign', id: null});
      p.then(() => { settled = true; });
      await new Promise(r => setTimeout(r, 50));
      const pendingBeforeReady = !settled;   // true only if the fix's await-gate is actually in place
      window._campaignBridge = { getCampaign: async () => null };
      window._syncBridge = window._syncBridge || {};
      document.dispatchEvent(new Event('campaign-ready'));
      await p;
      return [pendingBeforeReady, window._cgCampaignBound, window._cgCampaignId];
    })()`), [true, true, 'fake-test-campaign']);

  // fix/dm-ap-lost-on-handoff (found live in a real Amble campaign, 2026-08-10): window._cloudSignedIn
  // is synchronously reset to false by the 'campaign-ready' listener itself, the instant it fires, and
  // only asynchronously flipped true again once that listener's OWN separate auth check resolves —
  // waiting for 'campaign-ready' (the check just above) does not wait for THAT second resolution. Before
  // the fix, _cgAdoptEnvelopeBinding() gated its DM-AP refresh on that stale flag, so a genuinely
  // signed-in user's DM AP silently read as 0 on a fresh handoff/reload even though _dmApStatus still
  // resolved to 'active' (a separate check that doesn't depend on the flag) — exactly the "🛡 0 AP — DM
  // only" label. Reproduce the race directly: bridges already exist (so the campaign-ready wait above is
  // a no-op here), but _cloudSignedIn is still stale-false, while a direct currentSession() call (what
  // the fix uses instead) would report a real session.
  check('DM AP still resolves correctly when window._cloudSignedIn is stale-false but the user really is signed in',
    await cg.evaluate(`(async()=>{
      const realAuth=window._authBridge, realCamp=window._campaignBridge, realSync=window._syncBridge;
      window._cloudSignedIn = false;   // the exact stale state the race produces
      window._authBridge = { currentSession: async()=>({user:{id:'test-user'}}) };
      window._campaignBridge = { getCampaign: async()=>({id:'test-camp',ignore_player_ap:true,rules:{}}) };
      window._syncBridge = { refreshServerAp: async(id)=> id==='test-char-id' ? 53 : null };
      window._dmApStatus='none'; window._dmAp=0; window._cgCampaignBound=false; window._cgCampaignId=null;
      await _cgAdoptEnvelopeBinding({campaignId:'test-camp', id:'test-char-id'});
      const result=[window._dmApStatus, window._dmAp];
      window._authBridge=realAuth; window._campaignBridge=realCamp; window._syncBridge=realSync;
      return result;
    })()`), ['active', 53]);

  console.log('\nCharGen — the drawbacks ledger line itemises what was taken');
  const LEDGER_ROWS = `(sel)=>{const rows=[...document.getElementById('ledger').querySelectorAll('tr')].map(tr=>
      ({cls:tr.className,label:(tr.cells[0]||{}).innerText||'',val:Number((tr.cells[1]||{}).innerText)}));
    // the LINE row only — group headers are .lgh and item rows are .lrow.litem
    const i=rows.findIndex(r=>r.cls==='lrow'&&r.label.indexOf(sel)===0);
    if(i<0)return null;const items=[];
    for(let k=i+1;k<rows.length&&/litem/.test(rows[k].cls);k++)items.push([rows[k].label,rows[k].val]);
    return {line:rows[i].val,items,sum:items.reduce((s,x)=>s+x[1],0)};}`;
  check('three drawbacks render as three named rows summing to the line total',
    await cg.evaluate(`(()=>{const sect=${LEDGER_ROWS};
      const b=readBuild();b.drawbacks=Object.keys(DATA.drawbacks).slice(0,3);
      renderLedger(compute(b),b);const d=sect('Drawbacks (refund)');
      return [d.items.length,d.sum,d.line,d.sum===d.line];})()`), [3, -11, -11, true]);
  check('a house-ruled drawback itemises at the value actually charged, not the printed one',
    await cg.evaluate(`(()=>{const sect=${LEDGER_ROWS};
      const n=Object.keys(DATA.drawbacks).slice(0,3);
      const b=readBuild();b.drawbacks=n.slice();b.houseRules={draws:{[n[0]]:{ap:99}}};
      renderLedger(compute(b),b);const d=sect('Drawbacks (refund)');
      return [d.items[0],d.sum,d.line];})()`), [['Asthmatic', -99], -108, -108]);
  // Step 6 of the task: the same failure mode would silently empty the Boons rows too.
  // A drawback retired from the rules scores 0, so before the unknown-guard it rendered a phantom
  // "<name> 0" row that no sibling itemised line would produce — and an all-unknown list produced an
  // itemize key with no matching ledger line, since add() suppresses a zero total.
  check('a drawback no longer in the rules renders no row and leaves no orphan itemize key',
    await cg.evaluate(`(()=>{const sect=${LEDGER_ROWS};
      const b=readBuild();b.drawbacks=['Asthmatic','Retired Drawback From v0.1'];
      const r=compute(b);renderLedger(r,b);const d=sect('Drawbacks (refund)');
      const b2=readBuild();b2.drawbacks=['Retired Drawback From v0.1'];
      const r2=compute(b2);
      return [d.items.length,d.sum,d.line,
              r2.lines.some(l=>l[0]==='Drawbacks (refund)'),
              (r2.itemize||{})['Drawbacks (refund)']===undefined];})()`),
    [1, -2, -2, false, true]);
  check('the Boons line still itemises, and its rows sum to it',
    await cg.evaluate(`(()=>{const sect=${LEDGER_ROWS};
      const b=readBuild();b.hd=17;b.boons=DATA.boonList.filter(x=>!DATA.boons[x].epic).slice(0,2);
      renderLedger(compute(b),b);const o=sect('Boons');
      return [o.items.length,o.sum===o.line];})()`), [2, true]);

  // feat/drawbacks-phobias-expansion (v0.357): Mana Leak's penalty (disadvantage on concentration) can
  // only land on a character who casts. Priced for a caster it is free AP for a Fighter, and one number
  // cannot serve both — so DATA.drawbackReq gates it rather than the price trying to. These fail against
  // the ungated engine: without the check, the non-caster case produces no warning at all.
  console.log('\nCharGen — a caster-only drawback is gated, not merely priced');
  check('a non-caster taking Mana Leak trips the HARD (⛔) violation marker',
    await cg.evaluate(`(()=>{const b=readBuild();b.drawbacks=['Mana Leak'];b.traditions=[];
      return compute(b).warnings.filter(w=>w.indexOf('Mana Leak')>=0);})()`),
    ['⛔ Mana Leak: requires at least one spellcasting discipline']);
  check('a character with a spellcasting discipline takes it cleanly',
    await cg.evaluate(`(()=>{const b=readBuild();b.drawbacks=['Mana Leak'];
      b.traditions=[{disciplines:[{name:'Warlock'}]}];
      return compute(b).warnings.filter(w=>w.indexOf('Mana Leak')>=0).length;})()`), 0);
  check('the gate is data-driven — an ungated drawback is untouched for the same non-caster',
    await cg.evaluate(`(()=>{const b=readBuild();b.drawbacks=['Crawling Things'];b.traditions=[];
      return compute(b).warnings.filter(w=>w.indexOf('Crawling Things')>=0).length;})()`), 0);
  check('it still pays its 2 AP once the requirement is met',
    await cg.evaluate(`(()=>{const b=readBuild();b.traditions=[{disciplines:[{name:'Warlock'}]}];
      b.drawbacks=[];const before=compute(b).spendable;b.drawbacks=['Mana Leak'];
      return compute(b).spendable-before;})()`), 2);

  // feat/ledger-show-lost-purchases (D-GH-2026-08-10): the reconciliation gate the task itself asks
  // for — a bought-off drawback (or a DM-removed boon) drops OUT of the fold entirely, so compute()'s
  // OWN lines can't show it; before this feature the AP it cost was invisible to compute().total while
  // economy().spent still counted it. Mirrors EV-010's exact measured example (drawback for 2, bought
  // off for 6) plus EV-018's DM-removed-boon shape (25), independently, then combined.
  console.log('\nCharGen — the Lost purchases ledger line reconciles with economy().spent');
  check('a drawback taken then bought off (EV-010\'s shape: +2, then 3x = 6) shows a 6 AP lost-purchase line, total===economy().spent',
    await cg.evaluate(`(()=>{const sect=${LEDGER_ROWS};
      const evs=[{type:'award',amount:20},
        {type:'buy',cat:'drawback',payload:{v:'Superstitious'},cost:-2},
        {type:'buyoff',refVal:'Superstitious',cost:6}];
      const b=foldBuild(evs);const r=compute(b);renderLedger(r,b);const lp=sect('Lost purchases');
      const eco=economy(evs);
      return [lp.items, lp.line, r.total, eco.spent, r.total===eco.spent];})()`),
    [[['Bought off — Superstitious', 6]], 6, 6, 6, true]);
  check('a DM-removed boon (EV-018\'s shape: cost 25) shows a 25 AP lost-purchase line, total===economy().spent',
    await cg.evaluate(`(()=>{const sect=${LEDGER_ROWS};
      const evs=[{type:'award',amount:25},
        {type:'buy',cat:'boon',payload:{v:'Boon of Combat Prowess'},cost:25},
        {type:'dmRemoveBoon',refVal:'Boon of Combat Prowess',cost:0}];
      const b=foldBuild(evs);const r=compute(b);renderLedger(r,b);const lp=sect('Lost purchases');
      const eco=economy(evs);
      return [lp.items, lp.line, r.total, eco.spent, r.total===eco.spent];})()`),
    [[['Removed by DM — Boon of Combat Prowess', 25]], 25, 25, 25, true]);
  check('both a bought-off drawback AND a DM-removed boon on the same build itemise separately and still reconcile',
    await cg.evaluate(`(()=>{const sect=${LEDGER_ROWS};
      const evs=[{type:'award',amount:50},
        {type:'buy',cat:'drawback',payload:{v:'Superstitious'},cost:-2},
        {type:'buyoff',refVal:'Superstitious',cost:6},
        {type:'buy',cat:'boon',payload:{v:'Boon of Combat Prowess'},cost:25},
        {type:'dmRemoveBoon',refVal:'Boon of Combat Prowess',cost:0}];
      const b=foldBuild(evs);const r=compute(b);renderLedger(r,b);const lp=sect('Lost purchases');
      const eco=economy(evs);
      return [lp.items.length, lp.sum, lp.line, r.total, eco.spent, r.total===eco.spent];})()`),
    [2, 31, 31, 31, 31, true]);
  check('a bought-off-then-retaken drawback (EV-017\'s shape) shows BOTH the active retake AND the lost buyoff, never silently dropping either',
    await cg.evaluate(`(()=>{const sect=${LEDGER_ROWS};
      const evs=[{type:'award',amount:200},
        {type:'buy',cat:'drawback',payload:{v:'Asthmatic'},cost:-2},
        {type:'buyoff',refVal:'Asthmatic',cost:6},
        {type:'buy',cat:'drawback',payload:{v:'Asthmatic'},cost:-2}];
      const b=foldBuild(evs);const r=compute(b);renderLedger(r,b);
      const draw=sect('Drawbacks (refund)'),lp=sect('Lost purchases');
      return [draw.line, lp.line, r.total];})()`),
    // v0.354: total is 6, not 4. The Drawbacks line still DISPLAYS -2 (its rows must sum to it), but a
    // drawback is income now and no longer nets out of `total` — that double-count is the whole bug
    // model (b) fixed. The 6 is the bought-off purchase's Lost-purchases line, which is a real cost.
    [-2, 6, 6]);

  // fix/sheet-tab-appearance-not-persisted: the Sheet tab's Appearance/Background fields (Description,
  // hometown, faith, etc.) used to go through csSave() only — a local, per-tool, per-character-id
  // scratchpad that never touched the LOG, so an edit here silently never reached a cloud save and
  // "disappeared" the moment the character was reopened in the other tool (a different, empty
  // scratchpad namespace — see _sheetStoreKey()). _shCommitAppearanceField now routes through the same
  // PATCH_SLOTS.APPEARANCE mechanism the Setup panel's own ap_* fields already use.
  console.log('\nCharGen — Sheet-tab appearance/background fields write into the real LOG');
  check('opening the Sheet then committing a field writes into b.appearance via PATCH_SLOTS.APPEARANCE, not just local scratch',
    await cg.evaluate(`(()=>{
      toggleSheet();
      _shCommitAppearanceField('hometown','Testville');
      const matches=LOG.filter(e=>e.type==='buy'&&e.cat==='patch'&&e._slot===PATCH_SLOTS.APPEARANCE);
      return [readBuild().appearance.hometown, matches.length, csLoad(currentCharId()).ap_hometown||null];})()`),
    ['Testville', 1, null]);
  check('a second commit coalesces in place (still one APPEARANCE patch event) and merges with the first',
    await cg.evaluate(`(()=>{
      _shCommitAppearanceField('faith','Old Gods');
      const matches=LOG.filter(e=>e.type==='buy'&&e.cat==='patch'&&e._slot===PATCH_SLOTS.APPEARANCE);
      return [matches.length, readBuild().appearance.hometown, readBuild().appearance.faith];})()`),
    [1, 'Testville', 'Old Gods']);
  check('a stale local-scratch value for an appearance field is ignored on re-render — the Sheet always shows the live LOG value',
    await cg.evaluate(`(()=>{
      csSave(currentCharId(),'ap_hometown','STALE-SCRATCH');
      toggleSheet();toggleSheet();   // close+reopen to force a fresh hydrateSheet() pass
      const el=document.querySelector('#sheetbody [data-mf="ap_hometown"]');
      return el?el.value:null;})()`),
    'Testville');
  check('a genuinely scratch field (Player Name) still round-trips via the local store, unaffected',
    await cg.evaluate(`(()=>{
      const el=document.querySelector('#sheetbody [data-mf="playerName"]');
      el.value='Jamie'; onSheetField(el);
      return csLoad(currentCharId()).playerName;})()`),
    'Jamie');

  // fix/randomise-appearance-not-persisted: found live (a real Amble character's randomised description
  // vanished after a Live Sheet <-> CharGen round trip). _rollField()/genDescription() set DOM .value
  // directly with no 'input' event and no LOG write — looked committed on screen, was never actually
  // saved anywhere. Assert the fix: after 🎲 Randomise all, the LOG carries exactly ONE coalesced
  // appearance patch event (same coalescing behaviour as manual typing, PR #364's pattern) with the
  // fields actually populated, and it survives a fold — not just a DOM read.
  console.log('\nCharGen — 🎲 Randomise all / 🪶 Auto-write actually commit to the LOG, not just the DOM');
  check('randomiseAppearance() writes to the LOG (not just the DOM), still coalesced into ONE patch event',
    await cg.evaluate(`(()=>{
      randomiseAppearance();
      const matches=LOG.filter(e=>e.type==='buy'&&e.cat==='patch'&&e.payload&&e.payload.patch&&e.payload.patch.appearance);
      const domOverall=document.getElementById('ap_overall')?document.getElementById('ap_overall').value:'';
      const b=foldBuild(LOG);
      return [matches.length, domOverall.length>0, domOverall===b.appearance.overall, b.appearance.hometown.length>0];})()`),
    [1, true, true, true]);
  check('🪶 Auto-write (genDescription alone) also commits, coalescing into the same single patch event',
    await cg.evaluate(`(()=>{
      const n=LOG.filter(e=>e.type==='buy'&&e.cat==='patch'&&e.payload&&e.payload.patch&&e.payload.patch.appearance).length;
      _shCommitAppearanceField('hometown','Rewritten-by-hand');   // updates both LOG and the DOM field genDescription() reads
      genDescription();
      const matches=LOG.filter(e=>e.type==='buy'&&e.cat==='patch'&&e.payload&&e.payload.patch&&e.payload.patch.appearance);
      const b=foldBuild(LOG);
      return [n, matches.length, b.appearance.hometown, /Rewritten-by-hand/.test(b.appearance.overall)];})()`),
    [1, 1, 'Rewritten-by-hand', true]);
  // code-review finding (this session): randomizeRoll() (the full "🎲 Random" button) calls
  // randomiseAppearance() while _histSuspended, then unconditionally rebuilds the WHOLE LOG from the DOM
  // a few lines later (replaceWholeLogFromBuild) — committing appearance mid-roll would be ~20 wasted
  // fold+compute passes per click for state that resync immediately discards. Assert both halves: the
  // commit is skipped while suspended (spy on _shCommitAppearanceField's call count), AND the final
  // result still ends up with real appearance data (the resync captures the DOM values either way).
  check('randomizeRoll() skips the per-field LOG commit (suspended — a full resync follows) but the final build still has real appearance data',
    await cg.evaluate(`(()=>{
      const real=_shCommitAppearanceField; let calls=0;
      // _rollField/genDescription call the bare identifier — reassigning window.X redirects it too,
      // since a top-level "function name(){}" declaration in a classic script IS a window property
      // (unlike let/const), the same mechanism the existing "compute gates" test above already relies on.
      window._shCommitAppearanceField=function(){calls++;return real.apply(this,arguments);};
      randomizeRoll();
      window._shCommitAppearanceField=real;
      const b=foldBuild(LOG);
      return [calls, b.appearance.overall.length>0, b.appearance.hometown.length>0];})()`),
    [0, true, true]);

  // feat/expand-random-names (owner request, 2026-08-10 — "i keep getting the same name"): each of the
  // 6 styles roughly tripled/quadrupled from its original ~12-16 first / ~8-10 last names. Floor checks
  // (not exact counts, so future additions don't need this test touched) guard against an accidental
  // shrink back toward the old, repeat-prone size; every original name is still present (additive, not
  // a rewrite) and pool contents are unique within each list (a literal typo'd duplicate reduces real
  // variety without showing up as a count regression).
  console.log('\nCharGen — the random name pools were genuinely expanded, not just re-labelled');
  check('every style has at least 40 first names and 25 last names, each style internally duplicate-free',
    await cg.evaluate(`(()=>{
      const styles=Object.keys(NAMEDATA);
      const sizesOk=styles.every(k=>NAMEDATA[k].first.length>=40&&NAMEDATA[k].last.length>=25);
      const noDupes=styles.every(k=>new Set(NAMEDATA[k].first).size===NAMEDATA[k].first.length&&new Set(NAMEDATA[k].last).size===NAMEDATA[k].last.length);
      return [styles.length, sizesOk, noDupes];})()`),
    [6, true, true]);
  check('the original heroic names are still present (additive expansion, not a replacement)',
    await cg.evaluate(`(()=>{
      const orig=['Aldric','Roland','Garrick','Bryn','Brightblade','Stormholt'];
      return orig.every(n=>NAMEDATA.heroic.first.includes(n)||NAMEDATA.heroic.last.includes(n));})()`),
    true);

  // feat/custom-appearance-fields (owner request, 2026-08-10): two free-form, player-labeled detail
  // fields — unlike every other appearance field, no fixed prompt, no random table, so no 🎲/🔒. Their
  // 'ap_'-prefixed ids ride the EXISTING generic patch delegation (_cgPatchSlotForId's prefix match), so
  // manual typing needs zero new wiring — assert that directly. Also assert the DOM-restore direction
  // (applyBuild's explicit field list), which is easy to silently miss when adding a new appearance key —
  // exactly the gap this test would have caught (found by re-reading applyBuild's own list by hand before
  // this test existed, not by the test itself, but locked in here so it can't silently regress).
  console.log('\nCharGen — the two custom-labeled appearance fields commit and reload correctly');
  check('typing into a custom field commits to the LOG via the existing ap_* patch delegation, no new wiring',
    await cg.evaluate(`(()=>{
      const lab=document.getElementById('ap_custom1Label'), txt=document.getElementById('ap_custom1Text');
      lab.value='Catchphrase'; lab.dispatchEvent(new Event('input',{bubbles:true}));
      txt.value='Never met a lock I couldn\\'t pick.'; txt.dispatchEvent(new Event('input',{bubbles:true}));
      const b=foldBuild(LOG);
      return [b.appearance.custom1Label, b.appearance.custom1Text];})()`),
    ['Catchphrase', "Never met a lock I couldn't pick."]);
  check('a loaded build repopulates both custom fields\' DOM inputs (the reverse, applyBuild direction)',
    await cg.evaluate(`(()=>{
      const b=readBuild();
      b.appearance=Object.assign({},b.appearance,{custom2Label:'Motto',custom2Text:'Slow is smooth, smooth is fast.'});
      applyBuild(b);
      return [document.getElementById('ap_custom2Label').value, document.getElementById('ap_custom2Text').value];})()`),
    ['Motto', 'Slow is smooth, smooth is fast.']);
  check('custom fields are never touched by 🎲 Randomise all (no random table backs a player-invented label)',
    await cg.evaluate(`(()=>{
      const before=[document.getElementById('ap_custom1Label').value,document.getElementById('ap_custom2Label').value];
      randomiseAppearance();
      const after=[document.getElementById('ap_custom1Label').value,document.getElementById('ap_custom2Label').value];
      return [before[0]===after[0], before[1]===after[1]];})()`),
    [true, true]);

  // feat/campaign-ap-budget-enforce: a campaign-bound character's CLOUD save (manual + autosave) is
  // refused once the FROZEN LEDGER reads over budget, when the campaign's rules.enforceApBudget is
  // true-or-absent. fix/tool-mechanical-fixes (2026-08-22, /code-review catch on that PR):
  // _cgOverApBudget() used to read compute().remaining — the same re-price-against-today's-rules bug
  // already fixed in Live Sheet's _lsOverApBudget() — now reads (compute().spendable - economy(LOG).spent)
  // instead, so these build a REAL over/under-budget LOG rather than stubbing compute(), matching the
  // Live Sheet fixture rewrite above (a compute() stub no longer exercises the code path this gate
  // consults).
  console.log('\nCharGen — cloud save is blocked while over AP budget, enforced by the campaign');
  check('_cgOverApBudget gates on campaign-bound + enforcement + frozen-ledger-over, independently',
    await cg.evaluate(`(()=>{
      LOG.length=0;SEQ=1;
      // Neutral DM-AP context — _cgDmOpts() must return {dmAp:0,...} so spendable is driven purely by
      // this test's own award events, not whatever DM-context globals an earlier check in this same
      // page session left set (window._dmApStatus/_dmAp/_ignorePlayerAp/_cgCopySourceAp).
      window._dmApStatus=null; window._dmAp=0; window._ignorePlayerAp=false; window._cgCopySourceAp=0;
      // 10 AP awarded, 50 AP spent — genuinely over budget on the frozen ledger.
      LOG.push({type:'award',amount:10,label:'AP award',seq:SEQ++,ts:Date.now()});
      LOG.push({type:'buy',cat:'feature',payload:{v:'Test Feature'},cost:50,label:'Test (50 AP)',seq:SEQ++,ts:Date.now()});
      window._cgCampaignBound=false; window._cgEnforceApBudget=true;
      const r1=_cgOverApBudget();   // not bound -> false regardless of being over budget
      window._cgCampaignBound=true; window._cgEnforceApBudget=false;
      const r2=_cgOverApBudget();   // bound but enforcement explicitly off -> false
      window._cgEnforceApBudget=true;
      const r3=_cgOverApBudget();   // bound + enforced + over -> true
      LOG.length=0;SEQ=1;
      // 50 AP awarded, 10 AP spent — genuinely under budget.
      LOG.push({type:'award',amount:50,label:'AP award',seq:SEQ++,ts:Date.now()});
      LOG.push({type:'buy',cat:'feature',payload:{v:'Test Feature'},cost:10,label:'Test (10 AP)',seq:SEQ++,ts:Date.now()});
      const r4=_cgOverApBudget();   // bound + enforced + UNDER -> false
      window._cgCampaignBound=false;
      return [r1, r2, r3, r4];})()`),
    [false, false, true, false]);
  // onSaveClick() itself is NOT directly testable here: its "☁ Save to cloud" button only exists in
  // the DOM once the Cloud menu is rendered, which requires a signed-in _session (a closure-local
  // variable this unauthenticated CDP harness can never set — that's the separate "Cloud (signed-in)
  // e2e" CI check's job, not this dependency-free one). onSaveClick's block is a single `if
  // (_cgOverApBudget()) { alert(...); return; }` at its very top, before anything else runs — the gate
  // above proves the condition it depends on is correct, and the autosave checks below exercise the
  // exact same gate end-to-end through a path that doesn't need sign-in.
  check('autosave push skips silently while over budget, warning once per session not every cycle',
    await cg.evaluate(`(()=>{
      LOG.length=0;SEQ=1;
      window._dmApStatus=null; window._dmAp=0; window._ignorePlayerAp=false; window._cgCopySourceAp=0;
      LOG.push({type:'award',amount:10,label:'AP award',seq:SEQ++,ts:Date.now()});
      LOG.push({type:'buy',cat:'feature',payload:{v:'Test Feature'},cost:50,label:'Test (50 AP)',seq:SEQ++,ts:Date.now()});
      window._cgCampaignBound=true; window._cgEnforceApBudget=true;
      window.__f=[]; window.flash=m=>window.__f.push(String(m));
      let calls=0; const realBridge=window._syncBridge;
      window._syncBridge={saveCharacter:async()=>{calls++;return{};}};
      _cgBudgetWarned=false;
      return _cgCloudPushOnce().then(()=>_cgCloudPushOnce()).then(()=>{
        window._syncBridge=realBridge; window._cgCampaignBound=false;
        return [calls, window.__f.length];});})()`),
    [0, 1]);
  check('autosave push proceeds normally for a non-campaign character, however negative remaining is',
    await cg.evaluate(`(()=>{
      const real=compute; window.compute=()=>({remaining:-999});
      window._cgCampaignBound=false;
      let calls=0; const realBridge=window._syncBridge;
      window._syncBridge={saveCharacter:async()=>{calls++;return{synced:true};}};
      return _cgCloudPushOnce().then(()=>{
        window.compute=real; window._syncBridge=realBridge;
        return calls;});})()`),
    1);

  // fix/chargen-dm-view: the copy-id derivation is THE hazard this task calls out explicitly — a copy
  // that ever collides with its source id would let a DM's browser silently overwrite a player's
  // character on its next autosave. Assert it directly: deterministic per (source, dm) pair, distinct
  // across different sources AND across different DMs viewing the same source, and never equal to the
  // source id itself.
  console.log('\nCharGen — the DM-view copy id can never collide with its source character');
  if (!(await cg.evaluate(READY(`typeof window._cgDeriveCopyId==='function'`))))
    throw new Error('window._cgDeriveCopyId never appeared (campaign-ready did not fire?)');
  check('deterministic: the same (source, dm) pair derives the same copy id twice',
    await cg.evaluate(`Promise.all([window._cgDeriveCopyId('char-A','dm-1'),window._cgDeriveCopyId('char-A','dm-1')]).then(r=>r[0]===r[1])`), true);
  check('two different source characters (same DM) derive different copy ids',
    await cg.evaluate(`Promise.all([window._cgDeriveCopyId('char-A','dm-1'),window._cgDeriveCopyId('char-B','dm-1')]).then(r=>r[0]!==r[1])`), true);
  check('two different DMs copying the SAME source character get independent copies',
    await cg.evaluate(`Promise.all([window._cgDeriveCopyId('char-A','dm-1'),window._cgDeriveCopyId('char-A','dm-2')]).then(r=>r[0]!==r[1])`), true);
  check('the copy id is never the source id itself, even adversarially (dm id == char id)',
    await cg.evaluate(`window._cgDeriveCopyId('char-A','char-A').then(r=>r!=='char-A')`), true);
  check('the derived id is UUID-shaped (what characters.id, a uuid column, requires)',
    await cg.evaluate(`window._cgDeriveCopyId('char-A','dm-1').then(r=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(r))`), true);

  // feat/chargen-dm-view follow-up (this session): the one-time "you're viewing a copy" flash is easy
  // to miss/dismiss, so a persistent header banner was added — driven by the SAME " (DM copy)" name
  // suffix _cgConsumeViewChar() already stamps into both the DB row and the saved envelope, so it
  // reappears correctly on a later reload too, not just the moment the copy is first opened.
  console.log('\nCharGen — a persistent header banner marks a DM-copy character, not just a one-time toast');
  check('an ordinary character (no "(DM copy)" suffix) shows no banner',
    await cg.evaluate(`(()=>{document.getElementById('cname').value='Doran Quickstep';render();
      const b=document.getElementById('cgDmCopyBanner');return [b.style.display, b.textContent.length>0];})()`),
    ['none', true]);
  check('a character named with the "(DM copy)" suffix shows the persistent banner, styled distinctly purple (not the red/orange issue palette)',
    await cg.evaluate(`(()=>{document.getElementById('cname').value='Doran Quickstep (DM copy)';render();
      const b=document.getElementById('cgDmCopyBanner');
      return [b.style.display, /warn(?!banner)/.test(b.className), getComputedStyle(b).backgroundColor, /DM copy/.test(b.textContent)];})()`),
    ['flex', false, 'rgb(90, 61, 153)', true]);
  check('the banner clears again once the name no longer carries the suffix',
    await cg.evaluate(`(()=>{document.getElementById('cname').value='Doran Quickstep (DM copy)';render();
      document.getElementById('cname').value='Doran Quickstep';render();
      return document.getElementById('cgDmCopyBanner').style.display;})()`),
    'none');

  // feat/dm-edit-events: CharGen's undo is snapshot-based (HIST), not LIFO-over-events like the Live
  // Sheet's — so its barrier has to be its own guard checked against the tail of the live LOG, not a
  // HIST frame. Assert it directly rather than trusting the Live Sheet's coverage to generalise.
  console.log('\nCharGen — a DM edit locks history the same way it does in the Live Sheet');
  check('undo refuses when the last LOG event is a DM edit, with a stated reason',
    await cg.evaluate(`(()=>{
      LOG.push({seq:(SEQ=SEQ||1)+1,type:'buy',cat:'drawback',payload:{v:'Asthmatic'},cost:0,dmEdit:true,dmLocked:false,dmRemovalCost:'flat',label:'Drawback — Asthmatic (DM imposed)'});
      const n=LOG.length;
      window.__f=[]; const realFlash=window.flash; window.flash=m=>window.__f.push(String(m));
      undo();
      const refused = LOG.length===n;
      window.flash=realFlash;
      if(!refused) LOG.pop();   // clean up if the guard failed, so it doesn't bleed into later checks
      return [refused, /DM edit/i.test(window.__f[window.__f.length-1]||'')];})()`),
    [true, true]);

  await cg.close();

  // ============================ DM Console ============================
  // No sign-in required: the module bridge loads offline (D-GH-2026-08-03-vendor-supabase-js), and
  // window._dmRenderCloudRoster() is a pure DOM-render entry point over synthetic rows — the same
  // technique dm-console-ui-e2e.mjs (Playwright, cannot run in a CLI session per AGENTS.md's no-npm
  // rule) uses for its own coverage, but reachable here with zero dependencies.
  const dm = await connect(`http://127.0.0.1:${PORT}/PACT/tools/DM-Console.html`);
  if (!(await dm.evaluate(READY(`window.DATA&&document.readyState==='complete'&&typeof window._dmRenderCloudRoster==='function'`))))
    throw new Error('DM Console never became ready');

  // fix/unnamed-character-default: cloudAnalyze() used to special-case the DB's own 'New Character'
  // default (sql/schema.sql's column default and redeem_player_invite's v_name fallback) back to
  // blank, then cloudCardHTML() substituted a DIFFERENT literal ('Unnamed character') — so a
  // freshly-redeemed, never-named invite showed one string in the DB/CharGen/Live Sheet and another in
  // the DM's own roster. All surfaces now render the same stored default as-is.
  console.log('\nDM Console — the unnamed-character default matches CharGen and the Live Sheet');
  await dm.evaluate(`(()=>{const el=document.createElement('div');el.id='__testRoster';document.body.appendChild(el);})()`);
  check('a roster row holding the DB default name (no LOG data yet) renders it as-is, not a divergent fallback',
    await dm.evaluate(`(()=>{
      window._dmRenderCloudRoster(document.getElementById('__testRoster'),
        [{id:'test-1',name:'New Character',stats:{LOG:[{type:'award',amount:36}]},ap:80,player:'',playerLabel:'',dmNotes:''}]);
      const card=document.getElementById('__testRoster').querySelector('.cname');
      return card?card.textContent:'(no card)';})()`), 'New Character');
  check('a roster row with a real player-given name still shows it, unaffected',
    await dm.evaluate(`(()=>{
      window._dmRenderCloudRoster(document.getElementById('__testRoster'),
        [{id:'test-2',name:'Anders Tealeaf',stats:{LOG:[{type:'award',amount:36}]},ap:80,player:'',playerLabel:'',dmNotes:''}]);
      const card=document.getElementById('__testRoster').querySelector('.cname');
      return card?card.textContent:'(no card)';})()`), 'Anders Tealeaf');

  // fix/chargen-dm-view: "Copy to CharGen" must appear beside the existing read-only "View" button, be
  // labelled distinctly (never "View" — it's a copy, not a lock), and route to CharGen's ?viewChar=
  // handler with the SAME roster character's id, same convention the Live Sheet's own View button uses.
  console.log('\nDM Console — "Copy to CharGen" sits beside the read-only View button');
  check('both buttons render, with distinct labels, for a roster row with no build data yet',
    await dm.evaluate(`(()=>{
      window._dmRenderCloudRoster(document.getElementById('__testRoster'),
        [{id:'test-3',name:'Fenwick',stats:{LOG:[{type:'award',amount:36}]},ap:80,player:'',playerLabel:'',dmNotes:''}]);
      const card=[...document.querySelectorAll('#__testRoster .card')].find(c=>c.dataset.id==='test-3');
      const v=card&&card.querySelector('.view-btn'), c=card&&card.querySelector('.cgcopy-btn');
      return [!!v, !!c, v?v.textContent:'', c?c.textContent:'', c?c.getAttribute('data-cid'):''];})()`),
    [true, true, '👁 View', '📋 Copy to CharGen', 'test-3']);
  // The click delegation (wireCloudRosterDelegation) is scoped to the real #campRoster element, not a
  // synthetic test container — render into it directly so this check exercises the actual click path.
  check('the click handler opens CharGen with ?viewChar= for the same roster row id, not the Live Sheet',
    await dm.evaluate(`(()=>{
      window._dmRenderCloudRoster(document.getElementById('campRoster'),
        [{id:'test-3',name:'Fenwick',stats:{LOG:[{type:'award',amount:36}]},ap:80,player:'',playerLabel:'',dmNotes:''}]);
      let opened=null; const realOpen=window.open;
      window.open=(url)=>{opened=url;return {};};
      try{
        const card=[...document.querySelectorAll('#campRoster .card')].find(c=>c.dataset.id==='test-3');
        card.querySelector('.cgcopy-btn').click();
      } finally { window.open=realOpen; }
      return opened;})()`),
    'PACT-CharGen-Webtool.html?viewChar=test-3');

  // feat/dm-edit-events: DM Console's grant-boon/remove-boon/impose-drawback controls. A row needs a
  // real 'buy' event to reach hasData:true (cloudAnalyze) and therefore the full cardHTML→
  // buildSections→dmToolsBody render path the remove-boon dropdown depends on.
  console.log('\nDM Console — grant/remove/impose controls call dm_edit_character_log with the right shape');
  const DM_EDIT_ROW = `[{id:'test-4',name:'Anders',
    stats:{LOG:[{type:'award',amount:60},{type:'buy',cat:'boon',payload:{v:'Boon of Combat Prowess'},cost:25}]},
    ap:60,player:'',playerLabel:'',dmNotes:''}]`;
  check('all three controls render for a roster row with real build data',
    await dm.evaluate(`(()=>{
      window._dmRenderCloudRoster(document.getElementById('campRoster'), ${DM_EDIT_ROW});
      const card=[...document.querySelectorAll('#campRoster .card')].find(c=>c.dataset.id==='test-4');
      const g=card.querySelector('.dm-grant-boon-sel[data-cid="test-4"]');
      const r=card.querySelector('.dm-remove-boon-sel[data-cid="test-4"]');
      const i=card.querySelector('.dm-impose-draw-sel[data-cid="test-4"]');
      return [!!g, !!r, !!i, r?[...r.options].map(o=>o.value):[]];})()`),
    [true, true, true, ['Boon of Combat Prowess']]);
  check('grant boon calls dm_edit_character_log with a matched [buy,award] pair at the SAME cost',
    await dm.evaluate(`(()=>{
      window._dmRenderCloudRoster(document.getElementById('campRoster'), ${DM_EDIT_ROW});
      let captured=null; const realFn=window._campBridge.dmEditCharacterLog;
      window._campBridge.dmEditCharacterLog=(id,events)=>{captured=[id,events];return Promise.resolve(events);};
      const realReload=window._dmReloadRoster; window._dmReloadRoster=()=>{};
      const card=[...document.querySelectorAll('#campRoster .card')].find(c=>c.dataset.id==='test-4');
      card.querySelector('.dm-grant-boon-sel[data-cid="test-4"]').value='Boon of Irresistible Offense';
      card.querySelector('.dm-grant-boon-btn[data-cid="test-4"]').click();
      window._campBridge.dmEditCharacterLog=realFn; window._dmReloadRoster=realReload;
      if(!captured) return 'not called';
      const [id,events]=captured;
      return [id, events.length, events[0].type, events[0].cat, events[1].type, events[0].cost===events[1].amount];})()`),
    ['test-4', 2, 'buy', 'boon', 'award', true]);
  check('remove boon asks for confirmation, then calls dm_edit_character_log with a dmRemoveBoon event',
    await dm.evaluate(`(()=>{
      window._dmRenderCloudRoster(document.getElementById('campRoster'), ${DM_EDIT_ROW});
      let captured=null, confirmed=null; const realFn=window._campBridge.dmEditCharacterLog;
      window._campBridge.dmEditCharacterLog=(id,events)=>{captured=[id,events];return Promise.resolve(events);};
      const realReload=window._dmReloadRoster; window._dmReloadRoster=()=>{};
      const realConfirm=window.confirm; window.confirm=(m)=>{confirmed=m;return true;};
      const card=[...document.querySelectorAll('#campRoster .card')].find(c=>c.dataset.id==='test-4');
      card.querySelector('.dm-remove-boon-sel[data-cid="test-4"]').value='Boon of Combat Prowess';
      card.querySelector('.dm-remove-boon-btn[data-cid="test-4"]').click();
      window._campBridge.dmEditCharacterLog=realFn; window._dmReloadRoster=realReload; window.confirm=realConfirm;
      if(!captured) return 'not called';
      const [id,events]=captured;
      return [id, !!confirmed, events.length, events[0].type, events[0].refVal];})()`),
    ['test-4', true, 1, 'dmRemoveBoon', 'Boon of Combat Prowess']);
  check('impose drawback sends cost:0 plus the chosen locked/removal-cost flags',
    await dm.evaluate(`(()=>{
      window._dmRenderCloudRoster(document.getElementById('campRoster'), ${DM_EDIT_ROW});
      let captured=null; const realFn=window._campBridge.dmEditCharacterLog;
      window._campBridge.dmEditCharacterLog=(id,events)=>{captured=[id,events];return Promise.resolve(events);};
      const realReload=window._dmReloadRoster; window._dmReloadRoster=()=>{};
      const card=[...document.querySelectorAll('#campRoster .card')].find(c=>c.dataset.id==='test-4');
      card.querySelector('.dm-impose-draw-sel[data-cid="test-4"]').value='Asthmatic';
      card.querySelector('.dm-impose-draw-locked[data-cid="test-4"]').checked=true;
      card.querySelector('.dm-impose-draw-rate[data-cid="test-4"]').value='expensive';
      card.querySelector('.dm-impose-draw-btn[data-cid="test-4"]').click();
      window._campBridge.dmEditCharacterLog=realFn; window._dmReloadRoster=realReload;
      if(!captured) return 'not called';
      const [id,events]=captured;
      return [id, events.length, events[0].type, events[0].cat, events[0].cost, events[0].dmLocked, events[0].dmRemovalCost];})()`),
    ['test-4', 1, 'buy', 'drawback', 0, true, 'expensive']);
  // Archived-campaign peek must block these exactly like Award AP/notes/unbind already are — same
  // handler, same guard, same class of write action.
  check('archived-campaign peek blocks all three DM-edit buttons, same as Award AP',
    await dm.evaluate(`(()=>{
      window._dmRenderCloudRoster(document.getElementById('campRoster'), ${DM_EDIT_ROW});
      let calls=0; const realFn=window._campBridge.dmEditCharacterLog;
      window._campBridge.dmEditCharacterLog=()=>{calls++;return Promise.resolve([]);};
      let blocked=0; const realBlocks=window._dmPeekBlocks; window._dmPeekBlocks=()=>{blocked++;};
      window._dmPeekActive=true;
      const card=[...document.querySelectorAll('#campRoster .card')].find(c=>c.dataset.id==='test-4');
      card.querySelector('.dm-grant-boon-sel[data-cid="test-4"]').value='Boon of Irresistible Offense';
      card.querySelector('.dm-grant-boon-btn[data-cid="test-4"]').click();
      card.querySelector('.dm-remove-boon-sel[data-cid="test-4"]').value='Boon of Combat Prowess';
      card.querySelector('.dm-remove-boon-btn[data-cid="test-4"]').click();
      card.querySelector('.dm-impose-draw-sel[data-cid="test-4"]').value='Asthmatic';
      card.querySelector('.dm-impose-draw-btn[data-cid="test-4"]').click();
      window._dmPeekActive=false; window._campBridge.dmEditCharacterLog=realFn; window._dmPeekBlocks=realBlocks;
      return [calls, blocked];})()`),
    [0, 3]);

  // feat/dm-console-codm-revoke-ui (2026-08-22): the "Current co-DMs" list, driven by
  // window._dmCoDmsTest (same synthetic-data test-seam shape as window._dmPartyDowntimeTest above) —
  // no live Supabase backend or sign-in needed, since renderCoDms()/the remove-button click handler
  // are pure DOM given synthetic rows plus a stubbed window._campBridge.removeDm.
  console.log('\nDM Console — the "Current co-DMs" list renders escaped and wires the Remove button correctly');
  check('renders one row per co-DM, escaped, with a name and a Remove button',
    await dm.evaluate(`(()=>{
      window._dmCoDmsTest.setRows([
        {dm_id:'dm-1', name:'<img src=x onerror=window.__xss=1>', added_by:'owner-1', created_at:'2026-08-01T00:00:00Z'},
        {dm_id:'dm-2', name:'Sam', added_by:'owner-1', created_at:'2026-08-05T00:00:00Z'}
      ]);
      window.__xss = 0;
      window._dmCoDmsTest.render();
      const list = document.getElementById('campCoDmsList');
      const rows = list.querySelectorAll('.codmrow');
      const btns = list.querySelectorAll('.codm-remove-btn');
      const containsRawTag = list.innerHTML.indexOf('<img src=x') !== -1;
      return [rows.length, btns.length, containsRawTag, window.__xss,
              btns[0].getAttribute('data-cid'), btns[1].getAttribute('data-cid')];})()`),
    [2, 2, false, 0, 'dm-1', 'dm-2']);
  check('an empty co-DM list shows a placeholder, not a blank panel',
    await dm.evaluate(`(()=>{
      window._dmCoDmsTest.setRows([]);
      window._dmCoDmsTest.render();
      const list = document.getElementById('campCoDmsList');
      return [list.querySelectorAll('.codmrow').length, list.textContent.length > 0];})()`),
    [0, true]);
  check('clicking Remove confirms, then calls removeDm(campaignId, dm_id) and reloads the list',
    await dm.evaluate(`(()=>{
      window._dmSetCampIdTest('camp-codm-test');
      window._dmCoDmsTest.setRows([{dm_id:'dm-9', name:'Riva', added_by:'owner-1', created_at:'2026-08-10T00:00:00Z'}]);
      window._dmCoDmsTest.render();
      let captured = null, confirmed = null, reloadCalls = 0;
      const realRemove = window._campBridge.removeDm;
      window._campBridge.removeDm = (campId, dmId) => { captured = [campId, dmId]; return Promise.resolve(); };
      const realConfirm = window.confirm; window.confirm = (m) => { confirmed = m; return true; };
      const realGet = window._campBridge.getCampaignDms;
      window._campBridge.getCampaignDms = () => { reloadCalls++; return Promise.resolve([]); };
      const btn = document.querySelector('#campCoDmsList .codm-remove-btn[data-cid="dm-9"]');
      btn.click();
      return Promise.resolve().then(() => new Promise(r => setTimeout(r, 50))).then(() => {
        window._campBridge.removeDm = realRemove; window.confirm = realConfirm;
        window._campBridge.getCampaignDms = realGet; window._dmSetCampIdTest(null);
        if (!captured) return 'not called';
        return [captured[0], captured[1], !!confirmed, reloadCalls];
      });})()`),
    ['camp-codm-test', 'dm-9', true, 1]);
  check('declining the confirmation does not call removeDm',
    await dm.evaluate(`(()=>{
      window._dmSetCampIdTest('camp-codm-test-2');
      window._dmCoDmsTest.setRows([{dm_id:'dm-8', name:'Nox', added_by:'owner-1', created_at:'2026-08-11T00:00:00Z'}]);
      window._dmCoDmsTest.render();
      let calls = 0;
      const realRemove = window._campBridge.removeDm;
      window._campBridge.removeDm = () => { calls++; return Promise.resolve(); };
      const realConfirm = window.confirm; window.confirm = () => false;
      const btn = document.querySelector('#campCoDmsList .codm-remove-btn[data-cid="dm-8"]');
      btn.click();
      return Promise.resolve().then(() => new Promise(r => setTimeout(r, 20))).then(() => {
        window._campBridge.removeDm = realRemove; window.confirm = realConfirm; window._dmSetCampIdTest(null);
        return calls;
      });})()`),
    0);

  // feat/ap-model-reconcile: a fully DM-funded character (0 in their own log, ignore_player_ap on)
  // used to show apLevel 0 (trackLevel(eco.earned) alone). earnedWithDm() fixes it identically to the
  // Live Sheet, reusing the same engine export — not a second, independently-drifting fix.
  console.log('\nDM Console — apLevel/earnedTotal account for DM AP the same way the Live Sheet does');
  // 80 AP (above the Standard curve's L1=79), not 36 — see the matching Live Sheet comment above for why.
  check('a fully DM-funded roster character (0 in their own log, 80 DM AP, ignore_player_ap on) gets a real apLevel/earnedTotal, not 0',
    await dm.evaluate(`(()=>{
      window._dmCampaignApRules={ignorePlayerAp:true};
      const row={id:'test-5',name:'Fully DM-Funded',ap:80,player:'',playerLabel:'',dmNotes:'',
        stats:{LOG:[{type:'buy',cat:'boon',payload:{v:'Boon of Combat Prowess'},cost:25}]}};
      const rec=window._dmAnalyzeTest(row);
      window._dmCampaignApRules=null;
      return [rec.hasData, rec.summary.apLevel>0, rec.summary.earnedTotal, rec.summary.earned];})()`),
    [true, true, 80, 0]);
  // code-review finding (this session): renderCards() — the ≤700px fallback layout for the SAME shared
  // roster table, not the "Card view" toggle's own #campRoster cards — still read raw a.earned directly,
  // missing the earnedTotal switch the table's own COLS definition got a few lines above. Confirmed via
  // the exact fully-DM-funded shape as the check above, driven through the real renderCards() function.
  check('the narrow-viewport card fallback (renderCards) shows earnedTotal, not the raw log-only earned figure',
    await dm.evaluate(`(()=>{
      window._dmCampaignApRules={ignorePlayerAp:true};
      const row={id:'test-6',name:'Fully DM-Funded (cards)',ap:80,player:'',playerLabel:'',dmNotes:'',
        stats:{LOG:[{type:'buy',cat:'boon',payload:{v:'Boon of Combat Prowess'},cost:25}]}};
      window._dmRenderCardsTest([row],0);
      window._dmCampaignApRules=null;
      const html=document.getElementById('cards').innerHTML;
      window._dmRenderCardsTest([]);
      return [/AP Earned[\\s\\S]*?<span class="v">80<\\/span>/.test(html), /AP Earned[\\s\\S]*?<span class="v">0<\\/span>/.test(html)];})()`),
    [true, false]);

  // ================= the campaign drawback cap reaches ALL THREE tools =================
  // fix/drawback-cap-player-tools. `drawbackCap` was built inline in DM-Console.html and nowhere else,
  // so compute() got it on the DM's side only: a player in a capped campaign saw the FULL grant in
  // CharGen and the Live Sheet while their DM saw the capped figure — two people reading one character
  // and getting different AP, with nothing on either screen saying which was right.
  //
  // Asserted through each tool's OWN opts builder (_cgDmOpts / _dmOpts) rather than by calling the
  // shared helper directly, because the helper was never the broken part — the wiring was. A version of
  // this check that only exercised drawbackCapFromRules() would have passed against the bug.
  console.log('\nCampaign drawback cap — the DM and the player must see the same number');
  const CAPPED = `{drawbackCap:{enabled:true,ap:12}}`;
  // 79 awarded + two drawbacks worth 14. Capped at 12 -> 91. Uncapped -> 93. The two differ, so a cap
  // that silently fails to arrive is visible rather than coincidentally equal.
  const CAPBUILD = `(()=>{const b=baseBuild();b.budget=79;b.drawbacks=['Hexed Luck','Leaden Reflexes'];return b;})()`;

  const capIn = async (tab, optsFn, activate) => tab.evaluate(`(()=>{
    ${activate}
    const o = ${optsFn}();
    return [o.drawbackCap === undefined ? 'undefined' : o.drawbackCap, compute(${CAPBUILD}, o).budget];
  })()`);

  const cg2 = await connect(`http://127.0.0.1:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`);
  if (!(await cg2.evaluate(READY(`window.DATA&&typeof _cgDmOpts==='function'`))))
    throw new Error('CharGen never became ready for the drawback-cap check');
  const ls2 = await connect(`http://127.0.0.1:${PORT}/PACT/tools/PACT-Live-Char-Sheet.html`);
  if (!(await ls2.evaluate(READY(`window.DATA&&typeof _dmOpts==='function'`))))
    throw new Error('Live Sheet never became ready for the drawback-cap check');

  const cgCapped = await capIn(cg2, '_cgDmOpts',
    `window._dmApStatus='active'; window._cloudCampaign={rules:${CAPPED}};`);
  const lsCapped = await capIn(ls2, '_dmOpts',
    `window._rulesStatus='active'; window._cloudCampaignRules=${CAPPED};`);
  check('CharGen passes the campaign cap to compute()', cgCapped, [12, 91]);
  check('the Live Sheet passes the campaign cap to compute()', lsCapped, [12, 91]);
  check('DM Console reads the cap from the SAME shared helper, not its own copy',
    await dm.evaluate(`(()=>{const b=window._campBridge; return [typeof b.drawbackCapFromRules, b.drawbackCapFromRules(${CAPPED})];})()`),
    ['function', 12]);
  check('so all three agree on one number for one character',
    [cgCapped[1], lsCapped[1], 91].every(v => v === 91), true);

  // ...and the cap must NOT apply without a resolved campaign: compute() stays advisory (full 14 AP
  // granted, plus its warning), which is the deliberate rule for a character with no DM to adjudicate.
  const cgLocal = await capIn(cg2, '_cgDmOpts',
    `window._dmApStatus='none'; window._cloudCampaign={rules:${CAPPED}};`);
  const lsLocal = await capIn(ls2, '_dmOpts',
    `window._rulesStatus='none'; window._cloudCampaignRules=${CAPPED};`);
  check('CharGen leaves a local character uncapped and advisory', cgLocal, ['undefined', 93]);
  check('the Live Sheet leaves a local character uncapped and advisory', lsLocal, ['undefined', 93]);
  // A campaign that switched the cap OFF is also uncapped — the flag is read, not just the presence
  // of the key. Without this, `drawbackCap: {enabled:false}` would cap at whatever `ap` still held.
  check('and a campaign with the cap switched OFF does not cap',
    await cg2.evaluate(`(()=>{
      window._dmApStatus='active'; window._cloudCampaign={rules:{drawbackCap:{enabled:false,ap:12}}};
      const o=_cgDmOpts();
      return [o.drawbackCap===undefined?'undefined':o.drawbackCap, compute(${CAPBUILD},o).budget];
    })()`), ['undefined', 93]);

  // ================== DM-granted AP is visible in both player tools ==================
  // Reported 2026-08-19: "i cannot see how many DM AP's there are in the chargen or livesheet".
  // Both tools DID have a display; two states rendered nothing useful. The Live Sheet's chip was
  // `_dmAp ? ... : ''`, so a campaign character with 0 DM AP showed no DM component at all —
  // indistinguishable from the feature not existing. And a CharGen DM copy is deliberately unbound, so
  // since the grant became a campaign character's ENTIRE budget it opened reading "0 AP — player only",
  // which looks like lost AP rather than an unbound snapshot.
  // Addendum, reported 2026-08-22: fixing the DISPLAY line above (D-GH-2026-08-10-chargen-dm-view) wasn't
  // enough on its own — the copy's own BUDGET math still fed compute() a hardcoded 0, so it still read as
  // falsely over budget. _cgDmOpts() now feeds the same frozen snapshot (window._cgCopySourceAp) into the
  // budget, so the two checks below flipped: the label no longer says "not campaign-bound" (it now states
  // the frozen total instead), and the copy's dmAp is the snapshot value, not 0.
  console.log('\nDM-granted AP must be visible in both player tools');
  {
    const cgd = await connect(`http://127.0.0.1:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`);
    if (!(await cgd.evaluate(READY(`window.DATA&&typeof render==='function'&&document.getElementById('apSourceLine')`))))
      throw new Error('CharGen never became ready for the DM-AP check');
    const apLine = setup => cgd.evaluate(`(()=>{${'$'}{S}render();
      return (document.getElementById('apSourceLine')||{}).innerText.replace(/\\s+/g,' ').trim();})()`.replace('${S}', setup));
    // Shape, not a fixed player figure: the claim is that BOTH pools are named and the DM half is the
    // real number. Pinning "79 player" would be asserting whatever the budget field happens to hold.
    check('CharGen names both pools when a campaign grants AP',
      /\d+ player \+ 54 DM/.test(await apLine(`window._dmApStatus='active';window._dmAp=54;window._ignorePlayerAp=false;`)), true);
    check('...and names the DM total when player AP is ignored (every Amble character)',
      /54 AP — DM only/.test(await apLine(`window._dmApStatus='active';window._dmAp=54;window._ignorePlayerAp=true;`)), true);
    check('...and a DM copy shows its frozen DM AP total, not a silent 0',
      /DM copy \(\d+ player \+ 54 DM, frozen\)/.test(await apLine(`window._dmApStatus='none';window._dmAp=0;window._cgCopySourceAp=54;window._cgCopySourceName='Moss';`)), true);
    // The copy's budget now counts that frozen snapshot (2026-08-22 addendum) -- it's a point-in-time
    // number the copy can freely "spend" in its own sandboxed compute(), but nothing here writes back to
    // the source campaign or the source character's real, live AP either way.
    check('...and the copy\'s budget math counts that same frozen total',
      await cgd.evaluate(`(()=>{window._dmApStatus='none';window._dmAp=0;window._cgCopySourceAp=54;
        return _cgDmOpts().dmAp;})()`), 54);
    // fix/chargen-dm-copy-ap-stale (2026-08-22): now that the frozen snapshot is budget-relevant, it must
    // not survive past the copy it belongs to. _cgResolveDmApStatus() is the single function every OTHER
    // character load (cloud load, campaign join) funnels through, so simulate exactly that: a copy is
    // open (_cgCopySourceAp=54), then an unrelated, non-campaign character loads (campaignId=null) —
    // the stale snapshot must be cleared, not silently inflate that unrelated character's budget.
    check('...and that frozen total does NOT bleed into the next, unrelated character loaded afterward',
      await cgd.evaluate(`(async()=>{window._cgCopySourceAp=54;
        await _cgResolveDmApStatus(0,null);
        return _cgDmOpts().dmAp;})()`), 0);
    await cgd.close();

    const lsd = await connect(`http://127.0.0.1:${PORT}/PACT/tools/PACT-Live-Char-Sheet.html`);
    if (!(await lsd.evaluate(READY(`window._engineFold&&typeof render==='function'`))))
      throw new Error('Live Sheet never became ready for the DM-AP check');
    const ecoLine = setup => lsd.evaluate(`(()=>{${'$'}{S}render();
      const e=document.querySelector('.ecoline'); return e?e.innerText.replace(/\\s+/g,' ').trim():'';})()`.replace('${S}', setup));
    check('the Live Sheet shows the DM figure for a campaign character',
      /54 from DM/.test(await ecoLine(`window._rulesStatus='active';window._dmAp=54;window._ignorePlayerAp=false;`)), true);
    check('...and still shows it at ZERO rather than omitting the chip entirely',
      /0 from DM/.test(await ecoLine(`window._rulesStatus='active';window._dmAp=0;window._ignorePlayerAp=false;`)), true);
    check('...but stays quiet for a character with no campaign at all',
      /from DM/.test(await ecoLine(`window._rulesStatus='none';window._dmAp=0;`)), false);
    await lsd.close();
  }

  // ============ the DM Console shows subclass purchases and pack traits ============
  // Reported from real use, 2026-08-19: "on the dm console i can see class abilities, but not subclass
  // abilities. moss i cannot see 'Ranger › Beast Master: Primal Companion'". buildSections() rendered
  // s.features and had no subclass section at all, in either the cloud card or detailHTML.
  //
  // Both read compute()'s own itemize/lines — which the summary already carried — so the labels are the
  // engine's rather than a second formatting of the stored key. The same card's Traits list had the
  // heritage-pack blindness fixed in the player tools, so it is asserted here too.
  console.log('\nDM Console — subclass purchases and heritage-pack traits must be visible');
  {
    const dms = await connect(`http://127.0.0.1:${PORT}/PACT/tools/DM-Console.html`);
    if (!(await dms.evaluate(READY(`window.DATA&&typeof window._dmRenderCloudRoster==='function'&&typeof packTraitsFor==='function'`))))
      throw new Error('DM Console never became ready for the subclass check');
    check('a Dwarf Ranger\'s subclass ability and both pack traits all appear',
      await dms.evaluate(`(()=>{
        const el=document.getElementById('campRoster'); el.innerHTML='';
        window._dmRenderCloudRoster(el, [{id:'m',name:'Moss',ap:0,player:'',playerLabel:'',dmNotes:'',stats:{SEQ:6,LOG:[
          {type:'award',amount:200,seq:1},
          {type:'buy',cat:'oclass',payload:{v:'Ranger'},cost:0,seq:2},
          {type:'buy',cat:'species',payload:{v:'Dwarf'},cost:0,seq:3},
          {type:'buy',cat:'feature',payload:{v:'Ranger: Favored Enemy'},cost:3,seq:4},
          {type:'buy',cat:'subabil',payload:{v:'Ranger|Beast Master|Primal Companion'},cost:9,seq:5}]}}]);
        const c=el.querySelector('.chead'); if(c) c.click();
        const t=el.innerText||'';
        return [/Ranger › Beast Master: Primal Companion/.test(t),   // the reported one
                /Ranger: Favored Enemy/.test(t),                      // class feature, was already fine
                /Dwarf: Dwarven Resilience/.test(t)];                 // pack trait, same blindness
      })()`),
      [true, true, true]);
    await dms.close();
  }

  // ========== opening a character repeatedly must not change it (award idempotence) ==========
  // Reported from real use, 2026-08-19: "each time i open moss stormspud from the DM screen in chargen
  // or refresh, the AP budget decreases by 4." Moss has exactly 4 AP of drawbacks. Reproduced 79 -> 75
  // -> 71 -> 67 -> 63, unbounded, compounding once per open — a character silently losing AP forever.
  //
  // Cause: TWO sites subtracted the drawback total out of the award. Both were right under D-GH41, when
  // b.budget was awards + drawbackEarned combined. v0.355 moved that split into the engine (foldBuild
  // now sets b.budget to awards only) and left both subtractions in place, so each became a SECOND
  // subtraction. This is the gate that turns "opening a character is safe" from an assumption into an
  // assertion — nothing else here exercises the load -> regenerate -> reconcile cycle more than once.
  console.log('\nOpening a character N times must leave it identical (award idempotence)');
  {
    const cgi = await connect(`http://127.0.0.1:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`);
    if (!(await cgi.evaluate(READY(`window.DATA&&typeof applyBuild==='function'&&typeof buildToEventLog==='function'`))))
      throw new Error('CharGen never became ready for the idempotence check');
    // A Moss-shaped character: one award, and drawbacks worth a non-zero total. The drawbacks are what
    // make the two figures differ, so a re-introduced subtraction cannot hide behind them being equal.
    const seed = JSON.stringify([
      {type:'award',amount:79,note:'Budget',noLock:true,label:'Award — budget (79 AP)'},
      {type:'buy',cat:'drawback',payload:{v:'Forgetful'},cost:-1,level:1,label:'Drawback — Forgetful'},
      {type:'buy',cat:'drawback',payload:{v:'Heavy Sleeper'},cost:-1,level:1,label:'Drawback — Heavy Sleeper'},
    ]);
    const cycle = await cgi.evaluate(`(()=>{
      const seen=[]; let src=${seed};
      for (let i=0;i<5;i++){
        applyBuild(foldBuild(src));
        LOG = buildToEventLog(readBuild());
        _cgSyncAward();
        seen.push(LOG.filter(e=>e.type==='award').map(e=>e.amount).join('+'));
        src = LOG;
      }
      return [seen.join(' '), compute(readBuild(),_cgDmOpts()).budget];
    })()`);
    check('five opens leave the award event untouched at 79',
      cycle[0], '79 79 79 79 79');
    check('and spendable stays 79 award + 2 drawback = 81 throughout',
      cycle[1], 81);
    await cgi.close();
  }

  // ============ every version label a player can see reads the LIVE engine version ============
  // Reported from real use, 2026-08-19: CharGen's header said v0.356 while its own info popup said
  // v0.339, and the DM Console footer said "rules engine v0.176". Both were the same shape — a label
  // painted at PARSE time from a hardcoded fallback, before the deferred module fires `engine-ready`,
  // and never repainted. Nothing caught it because every existing check reads DATA.version directly
  // rather than what the page actually renders, which is the only thing a player sees.
  console.log('\nVersion labels — what the page SHOWS must equal DATA.version');
  {
    const cgv = await connect(`http://127.0.0.1:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`);
    if (!(await cgv.evaluate(READY(`window.DATA&&document.readyState==='complete'`))))
      throw new Error('CharGen never became ready for the version check');
    check('CharGen: header chip, <title> and the info popup all show the live rules version',
      await cgv.evaluate(`(()=>{const v=DATA.version;
        const has=s=>String(s||'').indexOf(v)>=0;
        return [has((document.getElementById('cgPactver')||{}).textContent),
                has(document.title),
                has((document.getElementById('infoVersions')||{}).textContent)];})()`),
      [true, true, true]);
    await cgv.close();

    const dmv = await connect(`http://127.0.0.1:${PORT}/PACT/tools/DM-Console.html`);
    if (!(await dmv.evaluate(READY(`window.DATA&&typeof window._dmRenderCloudRoster==='function'`))))
      throw new Error('DM Console never became ready for the version check');
    check('DM Console: the footer\'s "rules engine" reads the live version, not its fallback',
      await dmv.evaluate(`(()=>{const t=(document.getElementById('rulesVer')||{}).textContent;
        return [t===DATA.version, t];})()`),
      [true, DATA.version]);
    await dmv.close();
  }

  // ================== heritage-pack traits are VISIBLE, and never stored ==================
  // Reported from real use, 2026-08-19: "when i species pack it does not tick the items included in the
  // heritage pack, and they do not show in livesheet." A pack is charged as one line and its member
  // traits are then owned implicitly — compute()'s _ownsR treats them as held so prerequisites resolve —
  // but that ownership was derived and NEVER EXPORTED, so no UI could render it.
  //
  // The obvious fix, ticking them into b.racialTraits, is a trap and this gate pins that too: in-pack
  // traits price at 0 only while the pack is yours, so a stored one followed by a species change
  // re-prices at the CROSS rate. They must stay derived.
  console.log('\nHeritage pack — the traits it grants must be visible, and must not be stored');
  {
    const cg3 = await connect(`http://127.0.0.1:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`);
    if (!(await cg3.evaluate(READY(`window.DATA&&typeof packTraitsFor==='function'&&typeof readBuild==='function'`))))
      throw new Error('CharGen never became ready for the heritage-pack check');
    const inspect = sp => cg3.evaluate(`(()=>{
      const el=document.getElementById('spec'); el.value=${'$'}{sp}; el.dispatchEvent(new Event('change',{bubbles:true})); render();
      const pack=new Set(packTraitsFor(el.value,''));
      const rows=[...document.querySelectorAll('.racck')].filter(e=>pack.has(e.value));
      return [rows.length, rows.every(e=>e.checked), rows.every(e=>e.disabled), ckVals('racck').length, readBuild().racialTraits.length];
    })()`.replace('${sp}', JSON.stringify(sp)));
    check('CharGen ticks every trait the Dwarf pack grants, and disables it',
      await inspect('Dwarf'), [2, true, true, 2, 0]);
    // The 4th value is the load-bearing one: only the CURRENT pack may be ticked. Ticking without
    // un-ticking left the previous species' boxes set, and those survive readBuild()'s strip and enter
    // the build as cross-race purchases. This check read [.., 4, 2] before the packTick marker landed.
    check('...and un-ticks the old pack on a species change, storing none of them',
      await inspect('Elf'), [2, true, true, 2, 0]);
    await cg3.close();

    const ls3 = await connect(`http://127.0.0.1:${PORT}/PACT/tools/PACT-Live-Char-Sheet.html`);
    if (!(await ls3.evaluate(READY(`window._engineFold&&typeof renderCharSheet==='function'&&typeof packTraitsFor==='function'`))))
      throw new Error('Live Sheet never became ready for the heritage-pack check');
    check('the Live Sheet character sheet lists both pack traits',
      await ls3.evaluate(`(()=>{
        window.confirm=()=>true; buy('species',{v:'Dwarf'});
        const b=foldBuild(null); const html=String(renderCharSheet(b,compute(b,_dmOpts()),{}));
        return [/Dwarven Resilience/.test(html), /Darkvision 60 ft/.test(html), (b.racialTraits||[]).length];})()`),
      [true, true, 0]);
    await ls3.close();
  }

  // ============ a PRE-LOCK character's ledger must equal compute(), across level-ups ============
  // fix/livesheet-draft-reconcile. TASK_BOARD_NEXT recorded a live divergence measured on 2026-08-05 —
  // a fresh Live Sheet character under the 79 AP threshold whose ledger read 34 against compute()'s 46
  // after one level-up, and 44 against 83 by HD 5 — and said it needed an owner RULES ruling before any
  // code, because D-GH-2026-08-05-pricing-model's D1 ("a context change takes its listed price") and D2
  // ("a draft reconciles") each covered it and disagreed.
  //
  // It does not reproduce on v0.356: drift is 0 at every step, in both purchase orders. Something in the
  // pricing work that landed after 5 Aug closed it — the Live Sheet still does NOT call repriceDraft()
  // (checked), so the two rules stopped disagreeing rather than one being chosen. This gate exists so
  // that agreement is asserted rather than assumed, since nothing else covers it and the original report
  // was a real measurement, not a misreading.
  console.log('\nA pre-lock character: the frozen ledger and compute() must agree across level-ups');
  const preLock = async (label, steps) => {
    const t = await connect(`http://127.0.0.1:${PORT}/PACT/tools/PACT-Live-Char-Sheet.html`);
    if (!(await t.evaluate(READY(`window._engineFold&&window.DATA&&typeof buy==='function'`))))
      throw new Error('Live Sheet never became ready for the pre-lock check');
    await t.evaluate(`window.confirm=()=>true;`);
    for (const [cat, payload] of steps) await t.evaluate('buy(' + JSON.stringify(cat) + ',' + JSON.stringify(payload) + ')');
    const r = await t.evaluate(`(()=>{const bb=foldBuild(null);const c=compute(bb,_dmOpts());const e=economy(null);
      return [e.spent, c.total, bb.hd];})()`);
    await t.close();
    check(label, [r[0] === r[1], r[2]], [true, 5]);
    return r;
  };
  // Buy first, then level: the case the board measured. If a level-up ever re-prices an earlier purchase
  // without the ledger following, this is where it shows.
  await preLock('buy at HD 1, then level to 5 — ledger === compute()',
    [['grit',{to:1}],['hd',{to:2}],['hd',{to:3}],['hd',{to:4}],['hd',{to:5}]]);
  // And the reverse, so the check cannot pass merely because the two prices happen to coincide at HD 1.
  await preLock('level to 5 first, then buy — ledger === compute()',
    [['hd',{to:2}],['hd',{to:3}],['hd',{to:4}],['hd',{to:5}],['grit',{to:1}]]);

  await cg2.close(); await ls2.close();

  await dm.close();
} catch (e) {
  fail++; console.log(`  FAIL harness — ${e.message}`);
} finally {
  proc.kill(); server.close();
}

console.log(`\n${fail ? '✗' : '✓'} ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
