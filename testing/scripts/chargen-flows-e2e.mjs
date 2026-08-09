#!/usr/bin/env node
/**
 * PACT — CharGen flow gate: tool handoff identity, and invite-decline recovery.
 *
 * WHY THIS EXISTS. Both scenarios below were reported by the 2026-08-04 usability review, and both
 * turned on behaviour no gate could see:
 *
 *   1. TOOL HANDOFF IDENTITY. A character moved CharGen -> Live Sheet -> CharGen must remain ONE
 *      character. If its id changes on any leg, the next cloud save inserts a second row and the
 *      original stops receiving updates -- a silently orphaned duplicate, invisible to the DM. The
 *      local half of that chain is fully testable without a stack, and is what this asserts.
 *
 *   2. INVITE-DECLINE RECOVERY. Declining the invite prompt used to clear the token and hide the
 *      banner, so a player who clicked Cancel lost the invite with no explanation and no way back.
 *      Worth a permanent check because it is invisible on the happy path -- and because Playwright
 *      auto-dismisses confirm() by default, which is precisely how the review walked into it while
 *      believing it had found a broken sign-in redirect.
 *
 * Needs no Supabase stack: supabase-js is vendored, so the module bridges load offline and fire their
 * events. The signed-in half is covered by cloud-e2e.
 *
 * USAGE:  node testing/scripts/chargen-flows-e2e.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = 7979;   // distinct from cloud-e2e 7970 / seed 7971 / dm-console-ui 7973
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json',
               '.css':'text/css','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml' };
const server = http.createServer((q,r)=>{
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/PACT\/?/,'') || 'index.html';
  fs.readFile(path.join(REPO, rel), (e,d)=>{
    if(e){ r.writeHead(404); return r.end('not found'); }
    r.writeHead(200,{'Content-Type':MIME[path.extname(rel)]||'application/octet-stream','Cache-Control':'no-store'});
    r.end(d);
  });
});
await new Promise(r=>server.listen(PORT,r));

let pass=0, fail=0;
const check=(n,ok,d='')=>{ ok?pass++:fail++; console.log(`  ${ok?'PASS':'FAIL'}  ${n}${d?' — '+d:''}`); };
const section=t=>console.log(`\n[chargen-flows] == ${t} ==`);

/* Fall back to whatever chromium is on disk when the pinned client and the pre-provisioned browser
   builds disagree; CI installs a matching one and never reaches this. */
async function launchChromium(){
  try { return await chromium.launch(); }
  catch (e) {
    const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
    const cands = [path.join(root,'chromium')];
    try { for (const d of fs.readdirSync(root).filter(n=>/^chromium-\d+$/.test(n)).sort().reverse())
            cands.push(path.join(root,d,'chrome-linux','chrome')); } catch {}
    for (const exe of cands) { try { if (fs.existsSync(exe)) return await chromium.launch({executablePath:exe}); } catch {} }
    throw e;
  }
}
const browser = await launchChromium();
const base = `http://localhost:${PORT}/PACT`;
const PROBE = `window.__pactProbeId = function(){ try { return currentCharId(); } catch(e){ return 'ERR:'+e.message; } };`;

// -------------------------------------------------------------------------------------------------
section('a character keeps ONE id across CharGen <-> Live Sheet');
{
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e)));

  await p.goto(`${base}/tools/PACT-CharGen-Webtool.html`, {waitUntil:'load'});
  await p.waitForTimeout(2500);
  await p.evaluate(PROBE);
  await p.evaluate(()=>{ const e=document.getElementById('cname'); if(e){ e.value='Handoff Probe'; e.dispatchEvent(new Event('change')); } });
  await p.waitForTimeout(400);
  const idStart = await p.evaluate(()=>window.__pactProbeId());

  await p.evaluate(()=>switchToLiveSheet());
  await p.waitForTimeout(3000);
  await p.evaluate(PROBE);
  const idLS = await p.evaluate(()=>window.__pactProbeId());

  await p.evaluate(()=>switchToCharGen());
  await p.waitForTimeout(3000);
  await p.evaluate(PROBE);
  const idBack = await p.evaluate(()=>window.__pactProbeId());

  check('CharGen mints a UUID id', /^[0-9a-f-]{36}$/.test(String(idStart)), String(idStart));
  check('Live Sheet adopts the SAME id on handoff', idLS===idStart, `${idStart} -> ${idLS}`);
  check('CharGen adopts the SAME id on the return leg', idBack===idStart, `${idStart} -> ${idBack}`);
  check('round trip is one character, not two', idStart===idLS && idLS===idBack);
  const fatal = errs.filter(e=>!/Failed to load|net::|supabase|fetch/i.test(e));
  check('no fatal page errors across the round trip', fatal.length===0, fatal.slice(0,2).join(' | '));
  await ctx.close();
}

// -------------------------------------------------------------------------------------------------
section('declining an invite is recoverable, not a one-way door');
{
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  let dialogs = 0;
  p.on('dialog', d => { dialogs++; d.dismiss(); });        // the player clicks Cancel

  await p.goto(`${base}/tools/PACT-CharGen-Webtool.html?invite=TOK123`, {waitUntil:'load'});
  await p.waitForTimeout(2500);

  const out = await p.evaluate(async ()=>{
    // Stub a session and re-fire sync-ready so tryRedeem takes the signed-in path. The listener body
    // builds fresh closures per dispatch, so this is a clean second run rather than a resumed one.
    window._authBridge.currentSession = async()=>({user:{id:'test-session'}});
    document.dispatchEvent(new Event('sync-ready'));
    await new Promise(r=>setTimeout(r,600));
    const bn = document.getElementById('cgInviteBanner');
    let tok=null; try{ tok = sessionStorage.getItem(window.PENDING_INVITE_KEY); }catch(e){}
    return { visible: bn.style.display!=='none', text: bn.textContent.slice(0,80),
             btns: [...bn.querySelectorAll('button')].map(x=>x.textContent), tokenKept: tok };
  });

  check('the confirm prompt was shown and declined', dialogs===1, `dialogs=${dialogs}`);
  check('the banner stays visible after a decline', out.visible, String(out.visible));
  check('it says the invite was not accepted', /not accepted/i.test(out.text), out.text);
  check('an "Accept invite" way back is offered', out.btns.includes('Accept invite'), JSON.stringify(out.btns));
  check('an explicit "Discard invite" is offered', out.btns.includes('Discard invite'), JSON.stringify(out.btns));
  check('the token is KEPT, not silently wiped', out.tokenKept==='TOK123', String(out.tokenKept));
  await ctx.close();
}

// -------------------------------------------------------------------------------------------------
section('the info dialog traps keyboard focus');
{
  // Without a trap, Tab walked straight out of the overlay and onto the builder controls hidden behind
  // the scrim -- a keyboard user could be "in" a modal while editing the form underneath it, with no
  // visible focus. Verified RED: focus escaped after ONE Tab before the fix.
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(`${base}/tools/PACT-CharGen-Webtool.html`, {waitUntil:'load'});
  await p.waitForTimeout(2500);

  await p.evaluate(()=>{ const e=document.getElementById('cname'); if(e) e.focus(); });
  const before = await p.evaluate(()=>document.activeElement.id||document.activeElement.tagName);
  await p.evaluate(()=>showInfo());
  await p.waitForTimeout(250);

  const inside = await p.evaluate(()=>document.getElementById('infoBox').contains(document.activeElement));
  check('focus moves into the dialog on open', inside, String(inside));

  const escapes = async (key) => {
    for (let i=0;i<25;i++){
      await p.keyboard.press(key);
      const out = await p.evaluate(()=>{
        const box=document.getElementById('infoBox');
        return box.contains(document.activeElement) ? null : (document.activeElement.id||document.activeElement.tagName);
      });
      if (out) return `after ${i+1} ${key} -> ${out}`;
    }
    return null;
  };
  const fwd = await escapes('Tab');
  check('Tab x25 never leaves the dialog', !fwd, fwd || 'stayed inside');
  const back = await escapes('Shift+Tab');
  check('Shift+Tab x25 never leaves it either', !back, back || 'stayed inside');


  // "✕" alone has no accessible name -- a screen reader announces a symbol, not "Close". The focus
  // trap shipped; this half of the same original finding did not.
  const closeName = await p.evaluate(()=>{
    const b=document.querySelector('#infoBox .close-btn, .close-btn');
    return b ? { label:b.getAttribute('aria-label')||'', title:b.getAttribute('title')||'' } : null;
  });
  check('the dialog close button has an accessible name',
        !!closeName && !!(closeName.label || closeName.title), JSON.stringify(closeName));

  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);
  const closed = await p.evaluate(()=>!document.getElementById('infoModal').classList.contains('open'));
  const after  = await p.evaluate(()=>document.activeElement.id||document.activeElement.tagName);
  check('Escape closes it', closed, String(closed));
  check('focus returns to whatever opened it', after===before, `${before} -> ${after}`);
  await ctx.close();
}

// -------------------------------------------------------------------------------------------------
section('nothing is clipped off a 390px phone viewport');
{
  const ctx = await browser.newContext({ viewport:{width:390,height:844} });
  const p = await ctx.newPage();
  await p.goto(`${base}/tools/PACT-CharGen-Webtool.html`, {waitUntil:'load'});
  await p.waitForTimeout(3000);

  // Every section must be measured EXPANDED. A collapsed fieldset reports width 0 and every overflow
  // assertion below passes vacuously -- which is exactly what the first version of this check did.
  const wide = await p.evaluate(()=>{
    document.querySelectorAll('fieldset').forEach(f=>f.classList.remove('collapsed'));
    const out=[];
    document.querySelectorAll('fieldset').forEach(f=>{
      const r=f.getBoundingClientRect();
      if(r.width < 50) return;                       // still hidden -> not a real measurement
      if(f.scrollWidth > Math.ceil(r.width)+1 || r.right > 391)
        out.push({id:f.id||'(none)', w:Math.round(r.width), scrollW:f.scrollWidth, right:Math.round(r.right)});
    });
    return { over: out, measured: [...document.querySelectorAll('fieldset')].filter(f=>f.getBoundingClientRect().width>=50).length };
  });
  check('sections were expanded and actually measured', wide.measured >= 8, `${wide.measured} fieldsets measured`);
  check('no fieldset overflows the phone viewport', wide.over.length===0, JSON.stringify(wide.over).slice(0,180));

  const body = await p.evaluate(()=>({ sw:document.documentElement.scrollWidth, cw:document.documentElement.clientWidth }));
  check('the page does not scroll sideways', body.sw <= body.cw+1, `scrollW=${body.sw} clientW=${body.cw}`);

  // The feedback pill must clear whatever fixed bottom bar the tool shows at this width.
  const fb = await p.evaluate(()=>{
    const b=document.querySelector('.pact-fb-btn'); if(!b) return {missing:true};
    const f=b.getBoundingClientRect();
    let worst=null;
    document.querySelectorAll('*').forEach(el=>{
      if(el===b || el.classList.contains('pact-fb-dismiss') || el.classList.contains('pact-fb-panel')) return;
      const cs=getComputedStyle(el); if(cs.position!=='fixed'||cs.display==='none'||cs.visibility==='hidden') return;
      const r=el.getBoundingClientRect(); if(!r.width||!r.height) return;
      if(Math.abs(r.bottom-innerHeight)>4) return; if(r.height>innerHeight*0.5) return;
      if(!(f.bottom<=r.top || f.top>=r.bottom || f.right<=r.left || f.left>=r.right))
        worst = {id:el.id||el.className||el.tagName};
    });
    return { overlapping: worst };
  });
  check('feedback button clears every fixed bottom bar', !fb.missing && !fb.overlapping,
        JSON.stringify(fb.overlapping||{}));
  await ctx.close();
}

// -------------------------------------------------------------------------------------------------
section('mobile header: Local/Cloud on the first row, Random + collapse on the last (feat/chargen-mobile-header-layout)');
{
  const ctx = await browser.newContext({ viewport:{width:390,height:844} });
  const p = await ctx.newPage();
  await p.goto(`${base}/tools/PACT-CharGen-Webtool.html`, {waitUntil:'load'});
  await p.waitForTimeout(3000);

  const rows = await p.evaluate(()=>{
    const inRow = (rowSel, id) => { const r=document.querySelector(rowSel); return !!(r && r.querySelector('#'+id)); };
    return {
      localInFirstRow: inRow('.hd-mobnav', 'cgLocalBtnM'),
      cloudInFirstRow: inRow('.hd-mobnav', 'cgCloudBtnM'),
      localInLastRow: inRow('.mobile-action-bar', 'cgLocalBtnM'),
      cloudInLastRow: inRow('.mobile-action-bar', 'cgCloudBtnM'),
      randomInFirstRow: !!document.querySelector('.hd-mobnav [onclick*="randomizeBuild"]'),
      randomInLastRow: !!document.querySelector('.mobile-action-bar [onclick*="randomizeBuild"]'),
      undoRedoThemeStillFirstRow: !!(document.getElementById('undoBtnM') && document.getElementById('redoBtnM') && document.getElementById('themeselMobile')
        && document.querySelector('.hd-mobnav').contains(document.getElementById('undoBtnM'))
        && document.querySelector('.hd-mobnav').contains(document.getElementById('redoBtnM'))
        && document.querySelector('.hd-mobnav').contains(document.getElementById('themeselMobile'))),
    };
  });
  check('📁 Local moved to the first row', rows.localInFirstRow, JSON.stringify(rows));
  check('☁ Cloud moved to the first row', rows.cloudInFirstRow, JSON.stringify(rows));
  check('📁 Local no longer on the last row', !rows.localInLastRow, JSON.stringify(rows));
  check('☁ Cloud no longer on the last row', !rows.cloudInLastRow, JSON.stringify(rows));
  check('🎲 Random moved OFF the first row', !rows.randomInFirstRow, JSON.stringify(rows));
  check('🎲 Random is now on the last row', rows.randomInLastRow, JSON.stringify(rows));
  check('Undo/Redo/Theme are still on the first row', rows.undoRedoThemeStillFirstRow, JSON.stringify(rows));

  // Moving the Local/Cloud trigger buttons must not break their popup menus — both are a single
  // reparented #cgLocalMenu/#cgCloudMenu element keyed off btn.parentElement (see _cgWireLocalMenu()),
  // so this is a real regression risk from the move, not incidental coverage.
  const menu = await p.evaluate(async ()=>{
    document.getElementById('cgLocalBtnM').click();
    await new Promise(r=>setTimeout(r,50));
    const opened = document.getElementById('cgLocalMenu').classList.contains('open');
    const parentIsFirstRow = document.querySelector('.hd-mobnav').contains(document.getElementById('cgLocalMenu'));
    document.getElementById('cgLocalBtnM').click();
    await new Promise(r=>setTimeout(r,50));
    const closed = !document.getElementById('cgLocalMenu').classList.contains('open');
    return { opened, parentIsFirstRow, closed };
  });
  check('the Local menu still opens from its new location', menu.opened, JSON.stringify(menu));
  check('and reparents into the first row (not left behind in the last row)', menu.parentIsFirstRow, JSON.stringify(menu));
  check('and still closes on a second tap', menu.closed, JSON.stringify(menu));

  // Collapsible last row (feat/chargen-mobile-header-layout): defaults to expanded, a tap collapses it
  // (hiding the seven action buttons, keeping only the toggle), and the choice survives a reload.
  const collapse = await p.evaluate(async ()=>{
    const bar = document.getElementById('mobActionBar'), items = document.getElementById('mobActionItems'),
          btn = document.getElementById('mobActionsToggle');
    const beforeVisible = getComputedStyle(items).display !== 'none';
    const beforeExpanded = btn.getAttribute('aria-expanded');
    btn.click();
    const afterVisible = getComputedStyle(items).display !== 'none';
    const afterExpanded = btn.getAttribute('aria-expanded');
    const persisted = localStorage.getItem('pactCgMobActionsCollapsed');
    return { beforeVisible, beforeExpanded, afterVisible, afterExpanded, persisted };
  });
  check('the last row starts expanded (unchanged default behavior)', collapse.beforeVisible === true, JSON.stringify(collapse));
  check('aria-expanded starts true', collapse.beforeExpanded === 'true', JSON.stringify(collapse));
  check('tapping the toggle collapses it', collapse.afterVisible === false, JSON.stringify(collapse));
  check('aria-expanded flips to false', collapse.afterExpanded === 'false', JSON.stringify(collapse));
  check('the collapsed choice is persisted to localStorage', collapse.persisted === '1', JSON.stringify(collapse));

  await p.reload({waitUntil:'load'});
  await p.waitForTimeout(1500);
  const afterReload = await p.evaluate(()=>({
    visible: getComputedStyle(document.getElementById('mobActionItems')).display !== 'none',
    expanded: document.getElementById('mobActionsToggle').getAttribute('aria-expanded'),
  }));
  check('the collapsed state survives a reload', afterReload.visible === false, JSON.stringify(afterReload));
  check('and aria-expanded reflects it on reload too', afterReload.expanded === 'false', JSON.stringify(afterReload));

  await ctx.close();
}

// -------------------------------------------------------------------------------------------------
section('info modal is usable at 390px: scrolls, and the close button stays reachable (feat/chargen-mobile-header-layout)');
{
  const ctx = await browser.newContext({ viewport:{width:390,height:600} });   // short viewport: forces the overflow this bug needs to reproduce
  const p = await ctx.newPage();
  await p.goto(`${base}/tools/PACT-CharGen-Webtool.html`, {waitUntil:'load'});
  await p.waitForTimeout(3000);

  const info = await p.evaluate(async ()=>{
    showInfo();
    await new Promise(r=>setTimeout(r,80));
    const box = document.getElementById('infoBox');
    const boxRect = box.getBoundingClientRect();
    const closeBtn = box.querySelector('.close-btn');
    const closeRectBefore = closeBtn.getBoundingClientRect();
    const scrollableAndCapped = box.scrollHeight > box.clientHeight + 4 && boxRect.height <= innerHeight;
    // Scroll the box itself to the bottom — the close button must still be on-screen afterward.
    box.scrollTop = box.scrollHeight;
    await new Promise(r=>setTimeout(r,30));
    const closeRectAfter = closeBtn.getBoundingClientRect();
    const stillOnScreenAfterScroll = closeRectAfter.top >= 0 && closeRectAfter.bottom <= innerHeight
      && closeRectAfter.left >= 0 && closeRectAfter.right <= innerWidth;
    const barelyMoved = Math.abs(closeRectAfter.top - closeRectBefore.top) < 2;   // sticky, not scrolled away
    return { scrollableAndCapped, stillOnScreenAfterScroll, barelyMoved,
              boxHeight: Math.round(boxRect.height), viewportHeight: innerHeight,
              scrollHeight: box.scrollHeight, clientHeight: box.clientHeight };
  });
  check('the box is capped to the viewport, not left to grow past it', info.scrollableAndCapped, JSON.stringify(info));
  check('the close button stays on-screen after scrolling the box to the bottom', info.stillOnScreenAfterScroll, JSON.stringify(info));
  check('the close button barely moves (sticky), it does not scroll away with the content', info.barelyMoved, JSON.stringify(info));

  const closed = await p.evaluate(async ()=>{
    document.getElementById('infoBox').querySelector('.close-btn').click();
    await new Promise(r=>setTimeout(r,80));
    return !document.getElementById('infoModal').classList.contains('open');
  });
  check('clicking the (still-reachable) close button actually closes the modal', closed, String(closed));

  await ctx.close();
}

// -------------------------------------------------------------------------------------------------
section('the feedback pill clears Live Sheet\'s fixed bottom bar at 390px');
{
  // Deliberately Live Sheet, not CharGen: CharGen has no fixed BOTTOM bar, so the same assertion there
  // passes whether the fix is present or not. #lmobar carries Undo/Redo during play, and the pill sat
  // directly on top of it -- the two controls most needed to correct a mis-tap.
  const ctx = await browser.newContext({ viewport:{width:390,height:844} });
  const p = await ctx.newPage();
  await p.goto(`${base}/tools/PACT-Live-Char-Sheet.html`, {waitUntil:'load'});
  await p.waitForTimeout(3500);
  const o = await p.evaluate(()=>{
    const fb=document.querySelector('.pact-fb-btn'), bar=document.getElementById('lmobar');
    if(!fb) return {noFb:true};
    const f=fb.getBoundingClientRect();
    const barVisible = bar && getComputedStyle(bar).display!=='none';
    const r = barVisible ? bar.getBoundingClientRect() : null;
    return { barVisible: !!barVisible,
             overlap: r ? !(f.bottom<=r.top || f.top>=r.bottom || f.right<=r.left || f.left>=r.right) : null,
             fbBottom: Math.round(f.bottom), barTop: r?Math.round(r.top):null,
             clearance: getComputedStyle(document.documentElement).getPropertyValue('--pact-fb-bottom').trim(),
             dismiss: !!document.querySelector('.pact-fb-dismiss') };
  });
  check('Live Sheet shows its fixed bottom bar at this width', o.barVisible, String(o.barVisible));
  check('the feedback pill does NOT overlap it', o.barVisible && o.overlap===false,
        `pill bottom=${o.fbBottom}, bar top=${o.barTop}`);
  check('clearance was measured at runtime, not left at the default',
        !!o.clearance && o.clearance !== '16px', o.clearance || '(unset)');
  check('a dismiss control is offered', o.dismiss, String(o.dismiss));
  await ctx.close();
}

// -------------------------------------------------------------------------------------------------
section('the mobile fixes do not regress desktop');
{
  const ctx = await browser.newContext({ viewport:{width:1280,height:1000} });
  const p = await ctx.newPage();
  await p.goto(`${base}/tools/PACT-CharGen-Webtool.html`, {waitUntil:'load'});
  await p.waitForTimeout(3000);
  const d = await p.evaluate(()=>{
    const el=document.getElementById('classpickgrid');
    const f=el&&el.closest('fieldset'); if(f) f.classList.remove('collapsed');
    const cs=el?getComputedStyle(el):null;
    return { cols: cs?cs.gridTemplateColumns.split(' ').length:0,
             sw:document.documentElement.scrollWidth, cw:document.documentElement.clientWidth };
  });
  check('class grid keeps TWO columns on desktop', d.cols===2, `${d.cols} column(s)`);
  check('desktop does not scroll sideways', d.sw <= d.cw+1, `scrollW=${d.sw} clientW=${d.cw}`);
  await ctx.close();
}

console.log(`\n[chargen-flows] ${fail ? fail+' of '+(pass+fail)+' checks FAILED' : 'all '+pass+' checks passed'}`);
await browser.close(); server.close();
process.exit(fail?1:0);
