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
  if (!(await cg.evaluate(READY(`window.DATA&&typeof repriceDraft==='function'&&LOG.length>0`))))
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
  await cg.close();
} catch (e) {
  fail++; console.log(`  FAIL harness — ${e.message}`);
} finally {
  proc.kill(); server.close();
}

console.log(`\n${fail ? '✗' : '✓'} ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
