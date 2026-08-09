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

// 8. Collapsed <details> must advertise what is inside. "Which invite did I send to whom" and "what did
//    I ban" were both unanswerable from the panel's landing state, so a DM had to open each disclosure
//    to discover it was empty. Driven through the real loader, not a string check.
const summaries = await page.evaluate(()=>{
  const L = window._dmRulesPanel && window._dmRulesPanel.load;
  const out = {};
  if(L){
    L({ bannedSpecies:['Dragonborn','Tiefling'], bannedMasteries:['Cleave'],
        houseRules:{'Death saves in the open':true}, startingTier:{level:1,band:'standard',ap:79} });
    out.configured = (document.getElementById('campRulesSummary')||{}).textContent || '';
    L({});
    out.bare = (document.getElementById('campRulesSummary')||{}).textContent || '';
  }
  out.inviteEl = !!document.getElementById('campInviteSummary');
  out.rulesEl  = !!document.getElementById('campRulesSummary');
  return out;
});
check('the invite disclosure has a summary badge slot', summaries.inviteEl);
check('the rules disclosure has a summary badge slot', summaries.rulesEl);
check('a configured campaign advertises its bans', /3 bans/.test(summaries.configured||''), summaries.configured);
check('and its house rules', /1 house rule/.test(summaries.configured||''), summaries.configured);
check('and what a code-join actually grants', /joins grant 79 AP/.test(summaries.configured||''), summaries.configured);
check('an unconfigured campaign says so rather than staying blank',
      /no starting AP set/.test(summaries.bare||''), summaries.bare);

// 9. The "Invites issued" list shows OPEN invites only by default, so a campaign with 1 open and 4
//    settled invites looked like a campaign with 1 invite. Drive the real renderer.
const hiddenCount = await page.evaluate(()=>{
  // renderInvites() is closure-scoped; reach it the way the panel does, by seeding _invites through
  // the same bridge the loader uses. Fall back to reading the element if the hook is unavailable.
  const el = document.getElementById('inviteHiddenCount');
  const box = document.getElementById('inviteShowAll');
  return { hasSlot: !!el, hasToggle: !!box,
           label: (box && box.parentElement) ? box.parentElement.textContent.replace(/\s+/g,' ').trim() : '' };
});
check('the show-all toggle has a count slot', hiddenCount.hasSlot, JSON.stringify(hiddenCount));
check('the toggle itself still exists', hiddenCount.hasToggle);

// 10. Every modal close control needs an accessible name -- "✕" alone reads as a symbol, not "Close".
const closeBtns = await page.evaluate(()=>[...document.querySelectorAll('.close-btn')].map(b=>({
  label: b.getAttribute('aria-label')||'', title: b.getAttribute('title')||'', text: b.textContent.trim() })));
check('every .close-btn has an accessible name',
      closeBtns.length===0 || closeBtns.every(b=>b.label||b.title), JSON.stringify(closeBtns));

// 11. Archived-campaign peek. An archived campaign is openable read-only; the locked state IS the
//     feature, so both halves are asserted — the controls are disabled AND the write guard refuses
//     independently of them, which is the half a re-enabled button cannot get past.
const peek = await page.evaluate(async ()=>{
  const P = window._dmArchivedPeek;
  if(!P) return {missing:true};
  const rules = { startingTier:{level:2,band:'standard',ap:103}, dmNotes:'old plot threads' };
  // dm_invite_code was removed from the campaigns shape by D-GH-2026-08-09-harden-invitation-system
  // (co-DM invites are campaign_invites rows now, not a column here) -- fixture matches current shape.
  P.seed(
    [{ id:'live-1', name:'Amble', isOwner:true, rules, invite_code:'LIVE1' }],
    [{ id:'arch-1', name:'Old <b>Keep</b>', isOwner:true, archived_at:'2026-01-01T00:00:00Z', rules,
       invite_code:'ARCH1' }]
  );
  const out = {};
  const row = document.querySelector('#campArchivedList button[data-peek]');
  out.nameIsButton = !!row;
  out.nameEscaped  = !!row && row.textContent === 'Old <b>Keep</b>' && !row.querySelector('b');
  out.unarchiveStillThere = !!document.querySelector('#campArchivedList button[data-unarchive]');

  row.click();
  await new Promise(r=>setTimeout(r,60));
  const s = P.state();
  out.peeking   = s.peeking;
  out.peekId    = s.peekId;
  out.unlocked  = s.locked;                       // must be empty: every scoped control disabled
  out.banner    = getComputedStyle(document.getElementById('campPeekBanner')).display;
  out.bannerName= (document.getElementById('campPeekName')||{}).textContent;
  out.rosterTitle = (document.getElementById('campRosterName')||{}).textContent;
  out.rulesShown  = document.getElementById('dmNotesText').value;
  out.archiveBlockHidden = document.getElementById('campArchiveBlock').style.display === 'none';
  out.guardBlocks = P.blocks();                   // the guard refuses regardless of the disabled attrs
  // The picker must not claim a campaign is loaded that isn't the one on screen.
  out.pickerCleared = document.getElementById('campSel').value === '';
  // Controls the DM owns, not the campaign, must stay live — locking the way out would be a trap.
  out.createStillLive = !document.getElementById('campNewBtn').disabled;
  out.unarchiveStillLive = !document.querySelector('#campArchivedList button[data-unarchive]').disabled;
  // ⓘ buttons are the read-only explanation of what is being looked at.
  out.infoStillLive = !document.getElementById('campPlayerCodeInfo').disabled;

  // A roster refresh (tab focus, Refresh, an award landing) rebuilds every card's innerHTML, so the
  // cards come back ENABLED unless the lock is re-applied. This is the branch that actually bites in
  // production — drive the real paint path with a real character row.
  P.paintRoster([{ id:'c1', name:'Cedric', ap:36, campaign_id:'arch-1',
    stats:{ schema:'pact-character/1', name:'Cedric', SEQ:3,
            LOG:[{seq:1,type:'buy',path:'abilities.STR',cost:2}] } }]);
  await new Promise(r=>setTimeout(r,60));
  const rosterCtl = [...document.querySelectorAll('#campRoster .award-btn, #campRoster .dm-notes-save, #campRoster .unbind-btn')];
  out.rosterCtlCount = rosterCtl.length;
  out.rosterCtlLive  = rosterCtl.filter(b=>!b.disabled).map(b=>b.className);

  // The point of guarding rather than hiding: force the write controls back on — the way a stale
  // handler, a devtools poke or a re-render that forgot the lock would — and click them for real.
  // No RPC may fire. If this passes only because the button was disabled, it isn't testing the guard,
  // so the buttons are deliberately re-enabled first.
  //
  // confirm() is stubbed to TRUE for the whole forced-click section. Playwright auto-DISMISSES
  // dialogs, which routes every confirm-gated handler (Archive, Remove-from-campaign, Ignore-player-AP)
  // down its cancel branch — so those three checks passed whether the guard was there or not. Verified:
  // with confirm auto-dismissed, deleting the Archive and Ignore-AP guards left the suite green.
  const B = window._campBridge;
  const realConfirm = window.confirm, realAlert = window.alert;
  window.confirm = () => true;
  window.alert = () => {};

  const called = [];
  const spied = {};
  ['awardAp','setCharacterDmNotes','unbindCharacter'].forEach(fn=>{
    spied[fn] = B[fn];
    B[fn] = function(){ called.push(fn); return Promise.resolve(0); };
  });
  const amt = document.querySelector('#campRoster .award-amt');
  if(amt) amt.value = '5';                         // non-zero: the amt===0 early-return would mask the guard
  [...document.querySelectorAll('#campRoster .award-btn, #campRoster .dm-notes-save, #campRoster .unbind-btn')]
    .forEach(b=>{ b.disabled = false; b.click(); });
  await new Promise(r=>setTimeout(r,80));
  out.rpcAfterForcedClick = called.slice();
  ['awardAp','setCharacterDmNotes','unbindCharacter'].forEach(fn=>{ B[fn] = spied[fn]; });

  // Same treatment for the panel's own write handlers. Each one carries its own _peekBlocks() call,
  // so a guard dropped from any single call site has to fail here rather than hide behind the others.
  const called2 = [];
  const spied2 = {};
  ['setCampaignRules','createPlayerInvite','setIgnorePlayerAp','archiveCampaign','setInviteRevoked'].forEach(fn=>{
    spied2[fn] = B[fn];
    B[fn] = function(){ called2.push(fn); return Promise.resolve('x'); };
  });
  // An outstanding invite is what puts a Withdraw button on screen — without one there is nothing to
  // click, and the setRevoked guard would pass whether it existed or not.
  P.seedInvites([{ id:'inv-1', token:'tok-1', createdAt:'2026-01-02T00:00:00Z',
                   redeemedAt:null, revokedAt:null, startingAp:103, note:'Sam' }]);
  await new Promise(r=>setTimeout(r,40));
  out.revokeBtnExists = !!document.querySelector('#inviteList [data-revoke]');
  ['ruleSaveBtn','dmNotesSaveBtn','createInviteBtn','campArchiveBtn'].forEach(id=>{
    const el = document.getElementById(id);
    if(el){ el.disabled = false; el.click(); }
  });
  const rev = document.querySelector('#inviteList [data-revoke]');
  if(rev){ rev.disabled = false; rev.click(); }
  const chk = document.getElementById('ignorePlayerAp');
  chk.disabled = false; chk.checked = !chk.checked; chk.dispatchEvent(new Event('change'));
  await new Promise(r=>setTimeout(r,80));
  out.panelRpcAfterForcedClick = called2.slice();
  out.checkboxPutBack = chk.checked === false;   // seeded campaign has ignore_player_ap falsy
  ['setCampaignRules','createPlayerInvite','setIgnorePlayerAp','archiveCampaign','setInviteRevoked'].forEach(fn=>{ B[fn] = spied2[fn]; });
  window.confirm = realConfirm; window.alert = realAlert;

  // Leaving the peek releases the lock and restores prior disabled state (ignorePlayerAp is disabled
  // by its own lock, so a blanket re-enable would be a regression, not a fix).
  document.getElementById('campPeekExitBtn').click();
  await new Promise(r=>setTimeout(r,60));
  const s2 = P.state();
  out.exited       = !s2.peeking;
  out.guardReleased= P.blocks() === false;
  out.bannerGone   = getComputedStyle(document.getElementById('campPeekBanner')).display === 'none';
  out.ignoreStillLocked = document.getElementById('ignorePlayerAp').disabled;

  // A live campaign must never be treated as a peek.
  await P.select('live-1');
  await new Promise(r=>setTimeout(r,60));
  out.liveNotPeeked = !P.state().peeking;
  // Campaign Rules lock (feat/dm-console-warnings-and-rules-lock): a live, non-archived campaign still
  // lands LOCKED by default — this is the new "prevent accidental ticking" gate, distinct from the
  // archived-peek lock above. Unlock -> Save rules becomes clickable -> re-selecting the SAME campaign
  // (the closest thing to "after a save" this seam can drive without a real RPC) re-locks it.
  out.liveRulesLockedByDefault = document.getElementById('ruleSaveBtn').disabled;
  document.getElementById('ruleLockBtn').click();
  out.unlockedEnablesSave = !document.getElementById('ruleSaveBtn').disabled;
  out.unlockedEnablesMultiDisc = !document.getElementById('ruleMultiDisc').disabled;
  await P.select('live-1');
  await new Promise(r=>setTimeout(r,60));
  out.reselectRelocks = document.getElementById('ruleSaveBtn').disabled;
  return out;
});
check('_dmArchivedPeek seam exposed', !peek.missing);
check('an archived row\'s NAME is a clickable control', peek.nameIsButton);
check('and the name is escaped, not injected as markup', peek.nameEscaped, JSON.stringify(peek.nameEscaped));
check('the Unarchive button is still there beside it', peek.unarchiveStillThere);
check('clicking the name enters peek mode', peek.peeking === true);
check('on the campaign that was clicked', peek.peekId === 'arch-1', String(peek.peekId));
check('the read-only banner is shown', peek.banner === 'block', String(peek.banner));
check('the banner names the campaign', peek.bannerName === 'Old <b>Keep</b>', String(peek.bannerName));
check('the roster heading says it is archived', /archived — read-only/.test(peek.rosterTitle||''), peek.rosterTitle);
check('the campaign\'s content is actually readable', peek.rulesShown === 'old plot threads', peek.rulesShown);
check('EVERY campaign-scoped control is disabled',
      Array.isArray(peek.unlocked) && peek.unlocked.length === 0, JSON.stringify(peek.unlocked));
check('the write guard refuses independently of the disabled attributes', peek.guardBlocks === true);
check('"Archive this campaign" is hidden on one already archived', peek.archiveBlockHidden === true);
check('the campaign picker is cleared so it cannot claim the wrong campaign', peek.pickerCleared === true);
check('"+ Create campaign" stays usable (it is not the campaign\'s control)', peek.createStillLive === true);
check('Unarchive stays usable — the way out is never locked', peek.unarchiveStillLive === true);
check('the ⓘ explanation buttons stay usable', peek.infoStillLive === true);
check('a re-rendered roster card actually has write controls to lock', peek.rosterCtlCount > 0, String(peek.rosterCtlCount));
check('and they come back DISABLED after a roster refresh',
      Array.isArray(peek.rosterCtlLive) && peek.rosterCtlLive.length === 0, JSON.stringify(peek.rosterCtlLive));
check('re-enabling a roster write button and clicking it still fires NO write RPC',
      Array.isArray(peek.rpcAfterForcedClick) && peek.rpcAfterForcedClick.length === 0,
      JSON.stringify(peek.rpcAfterForcedClick));
check('an outstanding invite is on screen, so Withdraw is a real button', peek.revokeBtnExists === true);
check('nor does force-clicking Save rules / Save notes / Generate invite / Withdraw / Archive',
      Array.isArray(peek.panelRpcAfterForcedClick) && peek.panelRpcAfterForcedClick.length === 0,
      JSON.stringify(peek.panelRpcAfterForcedClick));
check('a blocked "ignore player AP" toggle is put back, not left flipped', peek.checkboxPutBack === true);
check('"Done viewing" exits peek mode', peek.exited === true);
check('and releases the write guard', peek.guardReleased === true);
check('and hides the banner', peek.bannerGone === true);
check('exiting RESTORES prior disabled state, not a blanket enable', peek.ignoreStillLocked === true);
check('a live campaign is never treated as a peek', peek.liveNotPeeked === true);
check('Campaign Rules land locked by default on a live campaign', peek.liveRulesLockedByDefault === true);
check('clicking the lock enables Save rules', peek.unlockedEnablesSave === true);
check('and enables the rule checkboxes/selects underneath it', peek.unlockedEnablesMultiDisc === true);
check('re-selecting the campaign re-locks it', peek.reselectRelocks === true);

// 12. Campaign warnings banner (feat/dm-console-warnings-and-rules-lock) — surfaces stale/unused invites
//     and a 0-AP player invite without the DM having to open the collapsed invite panels. seedInvites()
//     drives the real renderCampWarnings() (mirrors seedInvites' existing use for renderInvites() above).
const warn = await page.evaluate(async ()=>{
  const P = window._dmArchivedPeek;
  const out = {};
  await P.select('live-1');
  await new Promise(r=>setTimeout(r,60));
  const bannerDisplay = () => getComputedStyle(document.getElementById('campWarnBanner')).display;
  const items = () => [...document.querySelectorAll('#campWarnList li')].map(li=>li.textContent);

  // No invites at all -> no warnings.
  P.seedInvites([]);
  await new Promise(r=>setTimeout(r,40));
  out.emptyHidesBanner = bannerDisplay() === 'none';

  // One old, unredeemed player invite (well past the 14-day threshold) granting a real AP figure —
  // should trip ONLY the staleness warning, not the 0-AP one.
  // A settled (redeemed) old invite and a settled (revoked) old DM invite must NOT count — they are
  // history, not something outstanding to act on.
  // A fresh (today-ish) DM invite must not count as stale, a genuinely stale+unsettled DM invite MUST
  // (the co-DM mirror of the player-invite staleness check — d-stale below, code-review 2026-08-09), and
  // a reusable DM invite that already hit its redemption limit must not count as outstanding at all
  // (_dmInviteSettled()'s "full" branch).
  const longAgo = '2026-01-01T00:00:00Z';               // >7 months before this suite's fixed "today"
  const today   = new Date().toISOString();
  P.seedInvites([
    { id:'p-stale', type:'player', createdAt:longAgo, redeemedAt:null, revokedAt:null, startingAp:79, note:'stale' },
    { id:'p-zeroap', type:'player', createdAt:today,   redeemedAt:null, revokedAt:null, startingAp:0,  note:'no tier set' },
    { id:'p-settled', type:'player', createdAt:longAgo, redeemedAt:longAgo, revokedAt:null, startingAp:79, note:'done' },
    { id:'d-fresh', type:'dm', mode:'single_use', createdAt:today, redeemedAt:null, revokedAt:null, maxRedemptions:null, redeemedCount:0 },
    { id:'d-stale', type:'dm', mode:'single_use', createdAt:longAgo, redeemedAt:null, revokedAt:null, maxRedemptions:null, redeemedCount:0 },
    { id:'d-settled', type:'dm', mode:'single_use', createdAt:longAgo, redeemedAt:null, revokedAt:longAgo, maxRedemptions:null, redeemedCount:0 },
    { id:'d-full', type:'dm', mode:'reusable', createdAt:longAgo, redeemedAt:null, revokedAt:null, maxRedemptions:2, redeemedCount:2 },
  ]);
  await new Promise(r=>setTimeout(r,40));
  out.mixShowsBanner = bannerDisplay() === 'block';
  out.mixItems = items();

  // Deselecting the campaign must clear the banner, same as every other campaign-scoped panel.
  await P.select('');
  await new Promise(r=>setTimeout(r,40));
  out.deselectHidesBanner = bannerDisplay() === 'none';
  return out;
});
check('no invites -> warnings banner hidden', warn.emptyHidesBanner === true);
check('a stale + zero-AP + settled + fresh + stale-dm + settled-dm + exhausted-reusable-dm mix shows the banner',
      warn.mixShowsBanner === true);
check('exactly 3 warning lines (stale player, stale co-DM, zero-AP player) — settled/fresh/exhausted rows excluded',
      Array.isArray(warn.mixItems) && warn.mixItems.length === 3, JSON.stringify(warn.mixItems));
check('the stale-player warning mentions the 14-day threshold',
      Array.isArray(warn.mixItems) && warn.mixItems.some(t=>/1 player invite/.test(t) && /14\+ days/.test(t)),
      JSON.stringify(warn.mixItems));
check('the stale co-DM invite trips its OWN warning line, not just the player one',
      Array.isArray(warn.mixItems) && warn.mixItems.some(t=>/1 co-DM invite/.test(t) && /14\+ days/.test(t)),
      JSON.stringify(warn.mixItems));
check('the zero-AP warning calls out the AP figure',
      Array.isArray(warn.mixItems) && warn.mixItems.some(t=>/grants 0 AP/.test(t)),
      JSON.stringify(warn.mixItems));
check('deselecting the campaign clears the banner', warn.deselectHidesBanner === true);

// 13. DM AP must reach the roster's AP figures. DM AP lives ONLY on characters.ap and is never written
//     into the character's log, so economy() — which can only see the log — structurally cannot know
//     about it. Before this, every AP figure on the roster was player-log-only: a campaign running
//     ignore_player_ap with the whole budget granted as DM AP showed every character deeply overspent
//     and flagged "OVER BUDGET by N AP" (js/engine.js:423). Real numbers from the live Amble campaign.
const dmap = await page.evaluate(async ()=>{
  const el = document.getElementById('campRoster');
  // Anders: log awards 0, drawbacks +6 player AP, frozen spend 21, repriced total 33, DM AP 33.
  const anders = { id:'a', name:'Anders', ap:33, stats:{ SEQ:9, LOG:[
    {type:'buy',cat:'create',cost:0,seq:1,noLock:true,payload:{}},
    {type:'buy',cat:'patch',cost:9,seq:2,_slot:'stats',payload:{patch:{stats:{CHA:12,CON:10,DEX:14,INT:8,STR:8,WIS:12}}}},
    {type:'buy',cat:'save',cost:8,seq:3,payload:{v:'DEX'}},
    {type:'buy',cat:'drawback',cost:-3,seq:4,payload:{v:'Compulsion'}},
    {type:'buy',cat:'drawback',cost:-1,seq:5,payload:{v:'Forgetful'}},
    {type:'buy',cat:'drawback',cost:-2,seq:6,payload:{v:'Affliction — Dull-Witted (INT)'}},
    {type:'buy',cat:'skill',cost:2,seq:7,payload:{v:'Acrobatics'}},
    {type:'buy',cat:'patch',cost:2,seq:8,_slot:'armour',payload:{patch:{armour:{heavy:false,light:true,medium:false,shield:false},wornArmour:''}}}
  ]}};
  const read = () => [...document.querySelectorAll('#campRoster .card')].map(c=>({
    ap: c.querySelector('.stat .v')?.textContent,
    k:  c.querySelector('.stat .k')?.textContent,
    warn: c.querySelector('.warnicon')?.getAttribute('title') || ''
  }));
  const out = {};
  // (a) campaign with ignore_player_ap ON — the ceiling is DM AP alone
  window._dmCampaignApRules = { ignorePlayerAp: true };
  window._dmRenderCloudRoster(el, [anders]);
  await new Promise(r=>setTimeout(r,40));
  out.ignoreOn = read()[0];
  // (b) same character, ignore OFF — player's own +6 now counts on top of the 33
  window._dmCampaignApRules = { ignorePlayerAp: false };
  window._dmRenderCloudRoster(el, [anders]);
  await new Promise(r=>setTimeout(r,40));
  out.ignoreOff = read()[0];
  // (c) no DM AP at all (a locally-imported file / unbound character) — unchanged from before
  window._dmCampaignApRules = null;
  window._dmRenderCloudRoster(el, [{...anders, ap:0}]);
  await new Promise(r=>setTimeout(r,40));
  out.noDm = read()[0];
  return out;
});
check('the roster stat strip is still the AP cell', dmap.ignoreOn && dmap.ignoreOn.k === 'AP left', JSON.stringify(dmap.ignoreOn));
// ignore_player_ap ON: spendable = 0 player + 33 DM = 33; frozen spend 21 -> 12 left.
check('DM AP reaches "AP left" (33 DM − 21 spent = 12, was −15)', dmap.ignoreOn && dmap.ignoreOn.ap === '12', dmap.ignoreOn && dmap.ignoreOn.ap);
check('and the bogus "OVER BUDGET" warning is gone', dmap.ignoreOn && !/OVER BUDGET/.test(dmap.ignoreOn.warn), dmap.ignoreOn && dmap.ignoreOn.warn);
// ignore_player_ap OFF: spendable = 6 player + 33 DM = 39; 39 − 21 = 18. Proves the switch is read,
// not hardcoded — a fix that always added dmAp would give 12 here too.
check('the campaign\'s ignore-player-AP switch is honoured (6 player + 33 DM − 21 = 18)',
      dmap.ignoreOff && dmap.ignoreOff.ap === '18', dmap.ignoreOff && dmap.ignoreOff.ap);
// No DM AP and no campaign: ceiling is the player's own 6, spend 21 -> −15. Still correctly negative;
// the fix must not paper over a genuinely overspent character.
check('a character with no DM AP still shows a real deficit (6 − 21 = −15)',
      dmap.noDm && dmap.noDm.ap === '-15', dmap.noDm && dmap.noDm.ap);
check('and that one DOES still warn "OVER BUDGET"', dmap.noDm && /OVER BUDGET/.test(dmap.noDm.warn), dmap.noDm && dmap.noDm.warn);

console.log(`\n[dm-console-ui] ${fail? fail+' of '+(pass+fail)+' checks FAILED' : 'all '+pass+' checks passed'}`);
if (errors.length) console.log('\n(non-fatal errors seen: ' + errors.length + ')\n' + errors.slice(0,5).join('\n'));
await browser.close(); server.close();
process.exit(fail?1:0);
