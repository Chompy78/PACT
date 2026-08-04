#!/usr/bin/env node
/**
 * PACT — DM Console UI gate (no Supabase required).
 *
 * WHY THIS EXISTS. DM Console had NO automated UI coverage at all: cloud-e2e drives js/campaign.js and
 * js/dm.js directly and never opens the console, and every other gate runs without a signed-in session.
 * So the rules panel — the screen a DM configures a campaign from — could break on any change and every
 * check would stay green.
 *
 * No stack needed: supabase-js is vendored (D-GH-2026-08-03-vendor-supabase-js), so the module bridge
 * loads offline and fires campaign-ready. Only network calls fail, which is irrelevant to wiring and
 * arithmetic. That is the whole point — this gate is cheap enough to run on every PR.
 *
 * Covers the starting-tier model (level x band), its override semantics, and the three startingTier
 * shapes loadRulesIntoPanel has to cope with. Verified to go RED: perturbing TIER_BANDS.heroic failed
 * 2 of 16 checks before this was committed.
 *
 * USAGE:  node testing/scripts/dm-console-ui-e2e.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = 7973;   // not cloud-e2e's 7970 or the seed stack's 7971
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json',
               '.css':'text/css','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml' };
const server = http.createServer((req,res)=>{
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/PACT\/?/,'') || 'index.html';
  fs.readFile(path.join(REPO, rel), (e,d)=>{
    if(e){ res.writeHead(404); return res.end('nf'); }
    res.writeHead(200,{'Content-Type':MIME[path.extname(rel)]||'application/octet-stream','Cache-Control':'no-store'});
    res.end(d);
  });
});
await new Promise(r=>server.listen(PORT,r));

let pass=0, fail=0;
const check=(n,ok,d='')=>{ ok?pass++:fail++; console.log(`  ${ok?'PASS':'FAIL'}  ${n}${d?' — '+d:''}`); };

/* Launch the browser Playwright expects; if the pinned client and the installed browser builds don't
   line up (common on a machine where the browsers are pre-provisioned rather than downloaded per
   version), fall back to whatever chromium IS on disk instead of failing the gate over a build number.
   CI installs a matching browser and never reaches the fallback. */
async function launchChromium() {
  try { return await chromium.launch(); }
  catch (e) {
    const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
    const candidates = [path.join(root, 'chromium')];
    try {
      for (const d of fs.readdirSync(root).filter(n => /^chromium-\d+$/.test(n)).sort().reverse()) {
        candidates.push(path.join(root, d, 'chrome-linux', 'chrome'));
      }
    } catch { /* no browsers dir — the original error is the useful one */ }
    for (const exe of candidates) {
      try { if (fs.existsSync(exe)) return await chromium.launch({ executablePath: exe }); } catch { /* next */ }
    }
    throw e;
  }
}
const browser = await launchChromium();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type()==='error') errors.push('console: '+m.text()); });

await page.goto(`http://localhost:${PORT}/PACT/tools/DM-Console.html`, { waitUntil:'load' });
await page.waitForTimeout(2500);

// 1. no JS errors that would kill the panel wiring
const fatal = errors.filter(e => !/Failed to load resource|net::|supabase|fetch|NetworkError|Load failed/i.test(e));
check('no fatal page errors', fatal.length===0, fatal.slice(0,3).join(' | '));

// 2. the level dropdown got rebuilt with 0..20 plus "none"
const lvl = await page.evaluate(()=>{
  const s=document.getElementById('ruleStartingTierLevel');
  if(!s) return null;
  return { count:s.options.length, first:s.options[0]&&s.options[0].textContent,
           l1:[...s.options].find(o=>o.value==='1')?.textContent,
           l3:[...s.options].find(o=>o.value==='3')?.textContent,
           l20:[...s.options].find(o=>o.value==='20')?.textContent };
});
check('level select exists', !!lvl);
check('has 22 options (— none — plus 0..20)', lvl && lvl.count===22, lvl && String(lvl.count));
check('level 1 priced at 79 AP on the standard curve', lvl && /79 AP/.test(lvl.l1||''), lvl&&lvl.l1);
check('level 3 priced at 127 AP', lvl && /127 AP/.test(lvl.l3||''), lvl&&lvl.l3);
check('level 20 priced at 535 AP', lvl && /535 AP/.test(lvl.l20||''), lvl&&lvl.l20);

// 3. the tier state bridge exists and round-trips
const st = await page.evaluate(()=>{
  if(!window._dmTierState) return {missing:true};
  window._dmTierState.set(3,'standard',null,false);
  const a = window._dmTierState.read();
  window._dmTierState.set(null,'standard',0,false);
  const b = window._dmTierState.read();
  window._dmTierState.set(5,'heroic',null,false);
  const c = window._dmTierState.read();
  window._dmTierState.set(1,'gritty',null,false);
  const d = window._dmTierState.read();
  return {a,b,c,d, ap:document.getElementById('ruleStartingTierAp').value};
});
check('_dmTierState bridge exposed', !st.missing);
check('level 3 / standard -> 127 AP', st.a && st.a.ap===127, JSON.stringify(st.a));
check('"— none —" -> level null, 0 AP', st.b && st.b.level===null && st.b.ap===0, JSON.stringify(st.b));
check('level 5 / heroic -> round(175*1.15)=201', st.c && st.c.ap===201, JSON.stringify(st.c));
check('level 1 / gritty -> round(79*0.85)=67', st.d && st.d.ap===67, JSON.stringify(st.d));

// 4. band change recomputes, and a manual override sticks until a dropdown moves
const ov = await page.evaluate(async ()=>{
  const lvl=document.getElementById('ruleStartingTierLevel'),
        band=document.getElementById('ruleStartingTierBand'),
        ap=document.getElementById('ruleStartingTierAp');
  window._dmTierState.set(1,'standard',null,false);
  band.value='heroic'; band.dispatchEvent(new Event('change'));
  const afterBand = ap.value;
  ap.value='250'; ap.dispatchEvent(new Event('input'));
  const flagged = window._dmTierState.read().custom;
  // curve change must NOT overwrite an override
  const l1=document.getElementById('ruleBudgetL1');
  l1.value='83'; l1.dispatchEvent(new Event('input'));
  const afterCurve = ap.value;
  // ...but moving a dropdown is an explicit re-derive and clears it
  lvl.value='2'; lvl.dispatchEvent(new Event('change'));
  return { afterBand, flagged, afterCurve, afterLevel: ap.value,
           clearedFlag: window._dmTierState.read().custom };
});
check('band change recomputes (79 -> 91)', ov.afterBand==='91', ov.afterBand);
check('typing an AP flags it as an override', ov.flagged===true, String(ov.flagged));
check('curve change does NOT clobber the override', ov.afterCurve==='250', ov.afterCurve);
check('moving a dropdown clears the override', ov.clearedFlag===false, String(ov.clearedFlag));

// 5. loadRulesIntoPanel must survive all three startingTier shapes. This is the branch that runs for
//    every DM opening every campaign; if it throws, the whole rules panel is dead.
const loaded = await page.evaluate(()=>{
  const L = window._dmRulesPanel && window._dmRulesPanel.load;
  if(!L) return {missing:true};
  const out = {};
  const run = (key, rules) => {
    try { L(rules); out[key] = window._dmTierState.read(); }
    catch (e) { out[key] = {threw:String(e && e.message || e)}; }
  };
  run('current',  { startingTier:{ level:4, band:'gritty', ap:130, custom:false } });
  run('override', { startingTier:{ level:2, band:'standard', ap:250, custom:true } });
  run('prelude',  { startingTier:{ preset:'prelude',   ap:55  } });
  run('standard', { startingTier:{ preset:'standard',  ap:79  } });
  run('veteran',  { startingTier:{ preset:'veteran',   ap:103 } });
  run('legendary',{ startingTier:{ preset:'legendary', ap:126 } });
  run('oldCustom',{ startingTier:{ preset:'custom',    ap:222 } });
  run('absent',   {});
  run('empty',    null);
  return out;
});
check('_dmRulesPanel.load exposed', !loaded.missing);
check('current shape round-trips', loaded.current && loaded.current.level===4 &&
      loaded.current.band==='gritty' && loaded.current.ap===130, JSON.stringify(loaded.current));
check('a saved override stays flagged on load', loaded.override && loaded.override.custom===true &&
      loaded.override.ap===250, JSON.stringify(loaded.override));
// The old presets were levels in disguise off a Standard L1 of 79 — that is why they map EXACTLY.
check('legacy prelude -> level 0 (55 AP)',   loaded.prelude   && loaded.prelude.level===0   && loaded.prelude.ap===55,   JSON.stringify(loaded.prelude));
check('legacy standard -> level 1 (79 AP)',  loaded.standard  && loaded.standard.level===1  && loaded.standard.ap===79,  JSON.stringify(loaded.standard));
check('legacy veteran -> level 2 (103 AP)',  loaded.veteran   && loaded.veteran.level===2   && loaded.veteran.ap===103,  JSON.stringify(loaded.veteran));
// legendary was 1.6 x 79 = 126, while level 3 on the same curve is 127 — the ONE legacy preset that
// doesn't land exactly on a level. The DM's saved 126 must survive (it is what their campaign grants),
// and the mismatch must show as an override rather than "Level 3" sitting beside a non-level-3 number.
check('legacy legendary -> level 3, keeps its saved 126, flagged as an override',
      loaded.legendary && loaded.legendary.level===3 && loaded.legendary.ap===126 &&
      loaded.legendary.custom===true, JSON.stringify(loaded.legendary));
check('legacy veteran is NOT flagged (103 is exactly level 2)',
      loaded.veteran && loaded.veteran.custom===false, JSON.stringify(loaded.veteran));
check("legacy 'custom' keeps the DM's number as an override",
      loaded.oldCustom && loaded.oldCustom.ap===222 && loaded.oldCustom.custom===true, JSON.stringify(loaded.oldCustom));
// The whole point of the absent-means-zero decision: an unconfigured campaign must present 0, never 79.
check('absent startingTier -> level none, 0 AP',
      loaded.absent && loaded.absent.level===null && loaded.absent.ap===0, JSON.stringify(loaded.absent));
check('null rules object -> level none, 0 AP',
      loaded.empty && loaded.empty.level===null && loaded.empty.ap===0, JSON.stringify(loaded.empty));

// 6. the players-code grant line renders
const grant = await page.evaluate(()=>{
  const el=document.getElementById('campPlayerCodeGrant');
  return el ? {exists:true, html:el.innerHTML} : {exists:false};
});
check('players-code grant line element exists', grant.exists);

// 7. The roster card must answer "how much AP does this character have" WITHOUT drilling in, and the
//    DM-granted pool must not be labelled like a spendable total. Both are string/structure checks on
//    the card builders, which is all that is reachable without a signed-in roster.
const apUi = await page.evaluate(()=>{
  const src = [...document.querySelectorAll('script')].map(s=>s.textContent).join('\n');
  return {
    stripHasAp:      /statCells\s*=\s*\[\s*\n?\s*\['AP left'/.test(src),
    usesAvailable:   /\['AP left',\s*avail\]/.test(src),
    oldLabelGone:    !/>Bonus DM AP</.test(src),
    newLabelPresent: />DM-granted AP/.test(src),
    labelExplained:  /PART OF their spendable total/.test(src),
    autoRefresh:     /visibilitychange['"]?\s*,\s*refreshCampaignPanels/.test(src),
    focusRefresh:    /['"]focus['"]\s*,\s*refreshCampaignPanels/.test(src),
    debounced:       /_lastAutoRefresh/.test(src),
  };
});
check('roster stat strip carries an AP figure', apUi.stripHasAp, JSON.stringify(apUi.stripHasAp));
check('it uses the same s.available the player sees as "AP left"', apUi.usesAvailable);
check('the misleading "Bonus DM AP" label is gone', apUi.oldLabelGone);
check('replaced with "DM-granted AP"', apUi.newLabelPresent);
check('and it explains it is part of, not extra to, the spendable total', apUi.labelExplained);
check('roster auto-refreshes on tab visibility change', apUi.autoRefresh);
check('and on window focus', apUi.focusRefresh);
check('the auto-refresh is debounced (focus + visibilitychange both fire)', apUi.debounced);

console.log(`\n[dm-console-ui] ${fail? fail+' of '+(pass+fail)+' checks FAILED' : 'all '+pass+' checks passed'}`);
if (errors.length) console.log('\n(non-fatal errors seen: ' + errors.length + ')\n' + errors.slice(0,5).join('\n'));
await browser.close(); server.close();
process.exit(fail?1:0);
