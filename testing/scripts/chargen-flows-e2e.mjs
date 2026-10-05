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
import { launchChromium } from './lib/launch-chromium.mjs';

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
    // fix/invite-peek-timeout: tryRedeem() now races peekPlayerInvite() against a 3000ms bound (a real
    // network call that used to be able to hang the accept/decline prompt forever -- see that fix's own
    // comment in PACT-CharGen-Webtool.html). This offline test environment never resolves the peek at
    // all, so the wait here has to clear that bound with margin, not the old near-instant 600ms.
    await new Promise(r=>setTimeout(r,3400));
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
      // fix/chargen-mobile-theme-right: 🎨 Theme must be the LAST child of .hd-mobnav (so it hugs the
      // right edge — margin-left:auto in the CSS relies on it being last), not just "somewhere in the
      // row" (the check above already covers that weaker claim).
      themeIsLastInFirstRow: (function(){
        var row = document.querySelector('.hd-mobnav'), theme = document.getElementById('themeselMobile');
        return !!(row && theme && row.lastElementChild === theme);
      })(),
    };
  });
  check('📁 Local moved to the first row', rows.localInFirstRow, JSON.stringify(rows));
  check('☁ Cloud moved to the first row', rows.cloudInFirstRow, JSON.stringify(rows));
  check('📁 Local no longer on the last row', !rows.localInLastRow, JSON.stringify(rows));
  check('☁ Cloud no longer on the last row', !rows.cloudInLastRow, JSON.stringify(rows));
  check('🎲 Random moved OFF the first row', !rows.randomInFirstRow, JSON.stringify(rows));
  check('🎲 Random is now on the last row', rows.randomInLastRow, JSON.stringify(rows));
  check('Undo/Redo/Theme are still on the first row', rows.undoRedoThemeStillFirstRow, JSON.stringify(rows));
  check('🎨 Theme is the last item in the first row (right side)', rows.themeIsLastInFirstRow, JSON.stringify(rows));

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

  // feat/chargen-mobile-header-layout's collapse toggle was reverted in fix/chargen-mobile-theme-right
  // — the row already scrolls horizontally to reach anything off-screen, so a toggle just added a tap
  // without saving anything a scroll didn't already handle. Assert the toggle is gone and the row is
  // a flat, horizontally-scrollable strip instead.
  const bar = await p.evaluate(()=>{
    const el = document.getElementById('mobActionBar');
    const cs = el ? getComputedStyle(el) : null;
    return {
      noToggle: !document.getElementById('mobActionsToggle'),
      noItemsWrapper: !document.getElementById('mobActionItems'),
      scrollsHorizontally: !!cs && cs.overflowX === 'auto',
      buttonCount: el ? el.querySelectorAll('button').length : 0,
    };
  });
  check('the collapse toggle is gone', bar.noToggle, JSON.stringify(bar));
  check('the intermediate .mob-action-items wrapper is gone', bar.noItemsWrapper, JSON.stringify(bar));
  check('the last row is a flat horizontally-scrolling strip', bar.scrollsHorizontally, JSON.stringify(bar));
  check('all 7 action buttons are directly in the row', bar.buttonCount === 7, JSON.stringify(bar));

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

// -------------------------------------------------------------------------------------------------
// Every class-gated purchase has THREE prices (origin / unlocked-sticker / cross-class) and
// compute() charges all three. The picker rows used to know only two, so an unlocked class showed
// the CROSS price on the row while the ledger charged the sticker — a bundle read "11 AP" and cost
// 8. The invariant is not "the number is 8", it is "the number on the row equals the number in the
// ledger", so this asserts them against each other rather than against a hardcoded table.
section('row prices agree with the ledger at all three price tiers');
{
  const ctx = await browser.newContext({ viewport:{width:1280,height:1000} });
  const p = await ctx.newPage();
  await p.goto(`${base}/tools/PACT-CharGen-Webtool.html`, {waitUntil:'load'});
  await p.waitForTimeout(3000);
  await p.selectOption('#oclass', 'Cleric');
  await p.waitForTimeout(200);
  // A REAL click, not a synthetic change event: the bug this section exists for lived in the event
  // plumbing, and a dispatched event would have papered straight over it. Leave Warlock alone so it
  // stays a genuine cross-class purchase.
  await p.click('.classunlock[data-cls="Druid"]');
  await p.waitForTimeout(200);
  // All three individual subclass abilities checked below are T3 ("Per-Rest"), so requiredHD() gates
  // them at 3 Hit Dice — a fresh 1 HD build (CharGen's default) would have them hard-blocked, dropped
  // out of the "Subclass abilities" ledger line entirely and into "Blocked purchases" instead, which is
  // exactly what made this section's ledger lookups come back undefined before this line existed.
  await p.selectOption('#hd', '3');
  await p.waitForTimeout(200);
  const r = await p.evaluate(() => {
    for (const k of ['Cleric|Life Domain','Druid|Circle of the Moon','Warlock|Archfey Patron']) addRow('subbundle', k);
    for (const k of ['Cleric|Life Domain|Preserve Life (Channel Divinity)',
                     "Druid|Circle of the Land|Land's Aid",
                     'Warlock|Archfey Patron|Steps of the Fey']) addRow('subabil', k);
    render();
    const num = el => { const m = (el.textContent||'').match(/(-?\d+)\s*AP/); return m ? +m[1] : null; };
    const rows = {};
    document.querySelectorAll('.line').forEach(line => {
      const sb = line.querySelector('.subbundlerow'), sa = line.querySelector('.subabilrow');
      const pr = line.querySelector('.price');
      if (sb && pr) rows['bundle:' + sb.value] = num(pr);
      if (sa && pr) rows['abil:' + sa.value] = num(pr);
    });
    const c = compute(readBuild());
    const ledger = {};
    for (const [lab, ap] of c.lines) if (lab.startsWith('Spell list — ')) ledger['bundle:' + lab.slice('Spell list — '.length)] = ap;
    for (const [lab, ap] of (c.itemize['Subclass abilities'] || [])) ledger['abil:' + lab] = ap;
    return { rows, ledger, unlocked: readBuild().unlockedClasses };
  });
  const pairs = [
    ['origin (Cleric)',        'bundle:Cleric|Life Domain',        'bundle:Life Domain'],
    ['unlocked (Druid)',       'bundle:Druid|Circle of the Moon',  'bundle:Circle of the Moon'],
    ['cross-class (Warlock)',  'bundle:Warlock|Archfey Patron',    'bundle:Archfey Patron'],
    ['origin ability',         'abil:Cleric|Life Domain|Preserve Life (Channel Divinity)', 'abil:Cleric › Life Domain: Preserve Life (Channel Divinity)'],
    ['unlocked ability',       "abil:Druid|Circle of the Land|Land's Aid",                 "abil:Druid › Circle of the Land: Land's Aid"],
    ['cross-class ability',    'abil:Warlock|Archfey Patron|Steps of the Fey',             'abil:Warlock › Archfey Patron: Steps of the Fey'],
  ];
  check('Druid registers as an unlocked class', (r.unlocked||[]).includes('Druid'), JSON.stringify(r.unlocked));
  for (const [name, rowKey, ledgerKey] of pairs) {
    const shown = r.rows[rowKey], charged = r.ledger[ledgerKey];
    check(`row price = ledger price — ${name}`, shown != null && shown === charged, `row ${shown} vs ledger ${charged}`);
  }
  // The three tiers must actually differ, or the check above would pass on a collapsed ladder.
  const tiers = ['bundle:Cleric|Life Domain','bundle:Druid|Circle of the Moon','bundle:Warlock|Archfey Patron'].map(k => r.rows[k]);
  check('and the three bundle tiers are genuinely distinct', new Set(tiers).size === 3, tiers.join(' / '));
  // The unlock must be reversible too — a control that only latches on is half-dead.
  await p.click('.classunlock[data-cls="Druid"]');
  await p.waitForTimeout(200);
  const back = await p.evaluate(() => {
    const line = [...document.querySelectorAll('.line')].find(l => (l.querySelector('.subbundlerow')||{}).value === 'Druid|Circle of the Moon');
    const m = (line.querySelector('.price').textContent||'').match(/(-?\d+)\s*AP/);
    return { unlocked: readBuild().unlockedClasses, row: m ? +m[1] : null,
             ledger: compute(readBuild()).lines.find(([lab]) => lab === 'Spell list — Circle of the Moon')[1] };
  });
  check('un-ticking the unlock retracts it', !(back.unlocked||[]).includes('Druid'), JSON.stringify(back.unlocked));
  check('and the row falls back to the cross-class price, still matching the ledger',
        back.row === back.ledger && back.row === 11, `row ${back.row} vs ledger ${back.ledger}`);
  await ctx.close();
}

// -------------------------------------------------------------------------------------------------
section('a drawback raises the budget in the REAL tool, and is counted exactly once');
{
  // WHY THIS IS HERE AND NOT IN engine-parity. This exact path shipped broken for a few hours on
  // `preview`. v0.354 fixed the drawback double-count by making the grant ride in on `b.budget`, and
  // documented that as a contract every caller must satisfy. Every FOLDING caller did. CharGen does not
  // fold — readBuild() reads the form, where `budget` is the award field alone — so in the tool people
  // actually build characters in, drawbacks silently granted nothing at all.
  //
  // Nothing caught it. engine-parity asserts `total` and the SIGN of `remaining`, never the VALUE of
  // `budget`, so all 38 fixtures passed whether a drawback was worth double, single, or zero. The whole
  // gate suite folds; the one tool that doesn't fold had no coverage of this at all. v0.355 moved the
  // grant inside compute() so no caller can get it wrong, and this section pins the tool-side result so
  // the next model change has to survive a real click in a real CharGen.
  const p = await (await browser.newContext()).newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto(`${base}/tools/PACT-CharGen-Webtool.html`, {waitUntil:'load'});
  await p.waitForTimeout(3000);

  const read = () => p.evaluate(() => {
    const c = compute(readBuild());
    return { budget:c.budget, total:c.total, remaining:c.remaining,
             status:(document.getElementById('status')||{}).textContent||'',
             line:(c.lines.find(([l])=>l==='Drawbacks (refund)')||[null,null])[1],
             items:c.itemize['Drawbacks (refund)']||[],
             held:readBuild().drawbacks||[] };
  });

  const before = await read();
  // Two real clicks, not a synthetic change event — same reasoning as the class-unlock section above.
  // Frail (4 AP) + Asthmatic (2 AP) = 6, small enough to stay under every cap so this section tests the
  // grant and nothing else.
  await p.evaluate(() => { for (const v of ['Frail','Asthmatic']) {
    const el = [...document.querySelectorAll('.drawck')].find(e => e.value === v);
    if (el && !el.checked) el.click();
  }});
  await p.waitForTimeout(400);
  const after = await read();

  check('both drawbacks register on the build', after.held.includes('Frail') && after.held.includes('Asthmatic'), JSON.stringify(after.held));
  check('the budget RISES by exactly the drawback AP', after.budget === before.budget + 6, `${before.budget} -> ${after.budget}`);
  check('and the spend total is untouched — a drawback is income, not negative spending',
        after.total === before.total, `${before.total} -> ${after.total}`);
  check('so AP left rises by exactly the grant, once', after.remaining === before.remaining + 6, `${before.remaining} -> ${after.remaining}`);
  check('the on-screen status line agrees with compute()', after.status.trim() === `${after.remaining} AP under budget`, after.status.trim());
  // The ledger must still SHOW the drawbacks even though they no longer move the total — the heading is
  // a display-only row (engine.js addDisplay()), and its itemised rows must still sum to it.
  check('the ledger still shows the Drawbacks (refund) heading', after.line === -6, String(after.line));
  check('with its itemised rows, summing to the heading',
        after.items.length === 2 && after.items.reduce((s,[,ap])=>s+ap,0) === after.line,
        JSON.stringify(after.items));

  // Un-ticking must give the AP straight back — a grant that only latches on is the same class of
  // half-dead control the class-unlock section exists for.
  await p.evaluate(() => { for (const v of ['Frail','Asthmatic']) {
    const el = [...document.querySelectorAll('.drawck')].find(e => e.value === v);
    if (el && el.checked) el.click();
  }});
  await p.waitForTimeout(400);
  const back = await read();
  check('un-ticking both returns the budget to where it started', back.budget === before.budget, `${after.budget} -> ${back.budget}`);
  check('and no drawback row is left behind', back.line === null && back.held.length === 0, `line ${back.line}, held ${JSON.stringify(back.held)}`);
  check('no page errors across the drawback flow', errs.length === 0, errs.join(' | '));
}

console.log(`\n[chargen-flows] ${fail ? fail+' of '+(pass+fail)+' checks FAILED' : 'all '+pass+' checks passed'}`);
// -------------------------------------------------------------------------------------------------
// fix/creation-lock-integrity (docs/plans/2026-10-01-creation-lock-integrity.md). A plain CharGen reload
// restored the autosave verbatim and then the boot seed re-derived the whole LOG from the form, which
// cannot represent creationLocked / creationLockConfig — so every reload silently un-finished creation
// and dropped the DM's creation limit. Four live campaign characters lost their locks this way.
section('a finished character stays finished across CharGen reloads');
{
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  p.on('dialog', d=>d.accept());
  const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  const snap = () => p.evaluate(()=>({ log: JSON.parse(JSON.stringify(LOG)), id: currentCharId() }));
  const lockEvents = l => l.filter(e=>/^creation(Locked|Unlocked|LockConfig)$/.test(e.type)).map(e=>e.seq+':'+e.type);
  const buySeqs = l => l.filter(e=>e.type==='buy').map(e=>e.seq+':'+(e.label||'')).join('|');

  await p.goto(`${base}/tools/PACT-CharGen-Webtool.html`, {waitUntil:'load'});
  await p.waitForTimeout(2500);
  await p.evaluate(()=>{ cgFinishCreating(); _cgAutosave(); });
  const before = await snap();
  check('Finish creating records the lock', before.log.some(e=>e.type==='creationLocked'));

  for (const n of [1,2]) {
    await p.reload({waitUntil:'load'});
    await p.waitForTimeout(2500);
    const after = await snap();
    check(`reload ${n}: same character`, after.id===before.id, `${before.id} -> ${after.id}`);
    check(`reload ${n}: still locked`, after.log.some(e=>e.type==='creationLocked'));
    check(`reload ${n}: lock/limit events kept, same seq`,
      JSON.stringify(lockEvents(after.log))===JSON.stringify(lockEvents(before.log)),
      `${lockEvents(before.log)} -> ${lockEvents(after.log)}`);
    check(`reload ${n}: purchases keep their seq and order`, buySeqs(after.log)===buySeqs(before.log));
  }
  const fatal = errs.filter(e=>!/Failed to load|net::|supabase|fetch/i.test(e));
  check('no fatal page errors across reloads', fatal.length===0, fatal.slice(0,2).join(' | '));
  await ctx.close();
}

// fix/chargen-creation-ceiling (owner decisions W1 + W2 + B, 2026-10-04): CharGen refuses an edit that INCREASES spend
// and ends past the DM's creation limit (unlocked + limit stamped only), prompts once when an edit lands exactly on
// the limit, and caps the random roll at the limit. Hit Dice is the lever: it prices 2, 3, 3, 4 ... AP per die, so the
// limit can be placed to be reached exactly or crossed. See docs/plans/2026-10-04-chargen-creation-ceiling.md.
section('CharGen refuses an over-limit edit (W1), prompts at the limit (W2), caps the roll (B)');
{
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  let dialogs = [], confirmAnswer = true;
  p.on('dialog', async d => { dialogs.push({ type: d.type(), msg: d.message() }); if (d.type() === 'confirm' && !confirmAnswer) await d.dismiss(); else await d.accept(); });
  const state = () => p.evaluate(() => { const c = creationCeiling(LOG, _cgCeilOpts());
    return { spent: c.spent, ceiling: c.ceiling, enforced: c.enforced, locked: c.locked, hd: readBuild().hd, hist: HIST.length, log: LOG.length }; });
  const setHD = async v => { await p.evaluate(v => { const el = document.getElementById('hd'); el.value = String(v); el.dispatchEvent(new Event('change', { bubbles: true })); }, v); await p.waitForTimeout(300); };
  const stampLimit = async thr => { await p.evaluate(t => { LOG.push({ seq: SEQ++, ts: Date.now(), type: 'creationLockConfig', payload: { threshold: t }, rules: DATA.version, label: 'test limit' }); render(); }, thr); };
  const fresh = async () => { await p.goto(`${base}/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' }); await p.waitForTimeout(2500); await p.evaluate(() => { try { localStorage.clear(); } catch (e) {} }); await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(2500); dialogs = []; confirmAnswer = true; };

  await fresh();
  const s0 = await state();
  await setHD(3);                                   // 5 AP
  const s1 = await state();
  await stampLimit(s1.spent + 3);                   // ceiling = spent + 3  → HD 4 (+3) lands exactly on it; HD 5 (+4 more) crosses
  const sLim = await state();
  check('no limit stamped: nothing is refused (HD 1 → 3 accepted, no dialog)', s1.hd === 3 && dialogs.length === 0, JSON.stringify({ s0, s1 }));
  check('with a limit stamped the character reads enforced + unlocked', sLim.enforced === true && sLim.locked === false, JSON.stringify(sLim));

  // W2: an edit that lands exactly on the limit prompts once; Cancel keeps building
  confirmAnswer = false;
  await setHD(4);
  const s2 = await state();
  const prompts = dialogs.filter(d => d.type === 'confirm' && /Finish creating this character now/.test(d.msg));
  check('landing exactly on the limit is accepted (HD 4, 0 left)', s2.hd === 4 && s2.spent === s2.ceiling, JSON.stringify(s2));
  check('...and prompts once to finish creating', prompts.length === 1, JSON.stringify(dialogs.map(d => d.type)));
  check('...Cancel ("not yet") leaves the character unlocked', s2.locked === false);

  // W1: past the limit → refused, restored, no undo step, message names the composition
  dialogs = [];
  const histBefore = (await state()).hist;
  await setHD(5);
  const s3 = await state();
  const refusal = dialogs.find(d => d.type === 'alert' && /past your creation limit/.test(d.msg));
  check('an edit past the limit is refused (HD stays 4, spend unchanged)', s3.hd === 4 && s3.spent === s2.spent, JSON.stringify(s3));
  check('...the refusal message names the budget, the accepted spend, the change and both exits',
    !!refusal && refusal.msg.includes('Creation budget: ' + s2.ceiling) && refusal.msg.includes('Already spent: ' + s2.spent + ' AP')
      && /This change: \+\d+ AP/.test(refusal.msg) && /Finish creating/.test(refusal.msg) && /ask your DM/.test(refusal.msg), refusal && refusal.msg.slice(0, 160));
  check('...and the refused edit leaves NO undo step', s3.hist === histBefore, histBefore + ' → ' + s3.hist);
  check('...the form control was repainted to the accepted value', await p.evaluate(() => document.getElementById('hd').value === '4'));
  await setHD(4);
  check('...no second prompt while still sitting on the limit', dialogs.filter(d => d.type === 'confirm').length === 0, JSON.stringify(dialogs.map(d => d.type)));

  // lowering spend is never refused, even when the character is over its ceiling
  await stampLimit(2);                              // DM lowers the limit below current spend
  const sOver = await state();
  dialogs = [];
  await setHD(3);
  const sLow = await state();
  check('a character already over its limit may still LOWER spend (HD 4 → 3 accepted)', sOver.spent > sOver.ceiling && sLow.hd === 3 && dialogs.length === 0, JSON.stringify({ sOver, sLow }));
  dialogs = [];
  await setHD(4);
  check('...but may not raise it again (HD 3 → 4 refused)', (await state()).hd === 3 && dialogs.some(d => /past your creation limit/.test(d.msg)));

  // a load over the limit is not blocked
  dialogs = [];
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(2500);
  check('reloading an over-limit character raises no refusal', !dialogs.some(d => /past your creation limit/.test(d.msg)), JSON.stringify(dialogs.map(d => d.msg.slice(0, 40))));

  // locked: never refused or prompted
  await fresh();
  await setHD(3); const sA = await state();
  await p.evaluate(() => cgFinishCreating(true)); await p.waitForTimeout(200);
  await stampLimit(sA.spent + 1);
  dialogs = [];
  await setHD(6);
  const sLocked = await state();
  check('a locked character is never refused (HD 3 → 6)', sLocked.locked === true && sLocked.hd === 6 && dialogs.length === 0, JSON.stringify({ sLocked, d: dialogs.map(d => d.type) }));

  // Cancel path then OK path of the prompt, and "finish" really locks
  await fresh();
  await setHD(3); const sB = await state();
  await stampLimit(sB.spent + 3);
  confirmAnswer = true;
  await setHD(4);
  const sOk = await state();
  check('answering OK to the prompt finishes creation (locked)', sOk.locked === true && dialogs.filter(d => d.type === 'confirm').length === 1, JSON.stringify(sOk));

  // B: the random roll is capped at the limit and never refused mid-roll
  await fresh();
  await p.evaluate(() => { const b = document.getElementById('budget'); b.value = '79'; b.dispatchEvent(new Event('input', { bubbles: true })); b.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(300);
  await stampLimit(30);
  dialogs = [];
  await p.evaluate(() => randomizeRoll('', 0)); await p.waitForTimeout(800);
  const sRoll = await state();
  check('a roll on a limited character is capped at the limit (spent ≤ ceiling)', sRoll.enforced && sRoll.spent <= sRoll.ceiling && sRoll.spent > 0, JSON.stringify(sRoll));
  check('...is not refused part-way and does not lock the character', !dialogs.some(d => /past your creation limit/.test(d.msg)) && sRoll.locked === false, JSON.stringify(dialogs.map(d => d.msg.slice(0, 50))));

  const fatal = errs.filter(e => !/Failed to load|net::|supabase|fetch/i.test(e));
  check('no fatal page errors', fatal.length === 0, fatal.slice(0, 2).join(' | '));
  await ctx.close();
}

// fix/chargen-post-lock-purchases, phase 1 (owner decisions B2/C1/C2, 2026-10-04): after "Finish creating", raising Hit Dice,
// proficiency or an ability score in CharGen APPENDS the same in-play purchase the Live Sheet records (it used to rewrite the
// creation-era slot event in place: HD 3 -> 4 became that event at 8 AP, still before the lock). Decreases are refused.
// A head-to-head against the Live Sheet proves the two tools record the same event. See
// docs/plans/2026-10-04-chargen-post-lock-purchases.md.
section('CharGen records a post-lock purchase as an appended in-play event (B2, phase 1)');
{
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  let dialogs = [];
  p.on('dialog', async d => { dialogs.push({ type: d.type(), msg: d.message() }); await d.accept(); });
  const fresh = async () => { await p.goto(`${base}/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' }); await p.waitForTimeout(2500);
    await p.evaluate(() => { try { localStorage.clear(); } catch (e) {} }); await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(2500); dialogs = []; };
  const setCtl = async (id, v) => { await p.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = String(v); el.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]); await p.waitForTimeout(300); };
  const snap = () => p.evaluate(() => ({ log: JSON.parse(JSON.stringify(LOG)), hd: readBuild().hd, str: readBuild().stats.STR, hist: HIST.length,
    total: compute(foldBuild(LOG), _cgDmOpts()).total, spent: economy(LOG).spent }));
  const lockIdx = l => l.findIndex(e => e.type === 'creationLocked');

  // ---- pre-lock behaviour is unchanged: the slot event is still rewritten in place ----
  await fresh();
  await setCtl('hd', 3); await setCtl('hd', 4);
  const pre = await snap();
  const preSlots = pre.log.filter(e => e.cat === 'patch' && e._slot === 'hdProf');
  check('before the lock: raising Hit Dice still rewrites the one hdProf slot event in place (no appended hd event)',
    preSlots.length === 1 && preSlots[0].payload.patch.hd === 4 && !pre.log.some(e => e.cat === 'hd'), JSON.stringify(preSlots.map(e => e.payload)));

  // ---- after the lock ----
  await fresh();
  await setCtl('hd', 3);
  await p.evaluate(() => cgFinishCreating(true)); await p.waitForTimeout(200);
  const a0 = await snap(); const li0 = lockIdx(a0.log);
  const slotBefore = JSON.stringify(a0.log.find(e => e.cat === 'patch' && e._slot === 'hdProf'));
  await setCtl('hd', 4);
  const a1 = await snap(); const li1 = lockIdx(a1.log);
  const hdEv = a1.log.find(e => e.cat === 'hd');
  check('after the lock: raising Hit Dice appends an in-play "hd" purchase after the lock', !!hdEv && a1.log.indexOf(hdEv) > li1 && hdEv.payload.to === 4, JSON.stringify(hdEv));
  check('...priced as the ladder step (3 AP), not the whole slot re-priced to 8', hdEv && hdEv.cost === 3 && a1.spent === a0.spent + 3, JSON.stringify({ cost: hdEv && hdEv.cost, spent0: a0.spent, spent1: a1.spent }));
  check('...the creation-era Hit Dice slot event is untouched', JSON.stringify(a1.log.find(e => e.cat === 'patch' && e._slot === 'hdProf')) === slotBefore);
  check('...Hit Dice now read 4 and the control agrees', a1.hd === 4 && await p.evaluate(() => document.getElementById('hd').value === '4'));

  // a jump of several dice appends one purchase per die, as the Live Sheet would, as ONE undo step
  const histBefore = (await snap()).hist;
  await setCtl('hd', 6);
  const a2 = await snap();
  const hdEvs = a2.log.filter(e => e.cat === 'hd').map(e => e.payload.to);
  check('...HD 4 -> 6 appends one purchase per die (5, 6)', JSON.stringify(hdEvs) === JSON.stringify([4, 5, 6]), JSON.stringify(hdEvs));
  check('...as ONE undo step', a2.hist === histBefore + 1, histBefore + ' -> ' + a2.hist);
  await p.evaluate(() => undo()); await p.waitForTimeout(300);
  const a3 = await snap();
  check('...undo takes back that edit and stops at the lock (never the creation purchases)', a3.hd === 4 && lockIdx(a3.log) >= 0 && a3.log.filter(e => e.cat === 'hd').length === 1, JSON.stringify({ hd: a3.hd, hds: a3.log.filter(e => e.cat === 'hd').length }));

  // decreases are refused, and nothing changes
  dialogs = [];
  const before = await snap();
  await setCtl('hd', 2);
  const aD = await snap();
  check('lowering Hit Dice after the lock is refused with a message', dialogs.some(d => d.type === 'alert' && /Hit Dice can only go up/.test(d.msg)), JSON.stringify(dialogs.map(d => d.msg.slice(0, 60))));
  check('...history and Hit Dice are unchanged, and the control is put back', aD.hd === before.hd && aD.log.length === before.log.length && await p.evaluate(() => document.getElementById('hd').value === String(readBuild().hd)));

  // ability scores: raise appends abil purchases (+2 at a time); lowering is refused
  await setCtl('st_STR', 14);
  const s1 = await snap();
  const abil = s1.log.filter(e => e.cat === 'abil');
  check('raising STR 10 -> 14 after the lock appends abil purchases 12 then 14', JSON.stringify(abil.map(e => e.payload)) === JSON.stringify([{ ab: 'STR', to: 12 }, { ab: 'STR', to: 14 }]), JSON.stringify(abil.map(e => e.payload)));
  check('...priced as the ability ladder (4 + 5 = 9 AP) and STR reads 14', abil.reduce((s, e) => s + e.cost, 0) === 9 && s1.str === 14, JSON.stringify(abil.map(e => e.cost)));
  dialogs = [];
  await setCtl('st_STR', 10);
  const s2 = await snap();
  check('lowering STR after the lock is refused and STR stays 14', s2.str === 14 && dialogs.some(d => /STR can only go up/.test(d.msg)), JSON.stringify(dialogs.map(d => d.msg.slice(0, 50))));

  // not enough AP: refused, nothing half-applied
  const n0 = (await snap()).log.length;
  await setCtl('hd', 20);
  const s3 = await snap();
  check('an edit the character cannot afford is refused and leaves nothing half-applied', s3.log.length === n0 && s3.hd === s2.hd, JSON.stringify({ n0, n1: s3.log.length }));

  // ---- head to head with the Live Sheet: the SAME purchase made in each tool records the SAME event ----
  await fresh();
  await setCtl('hd', 3);
  // switch the coin-and-calendar economy ON (the same event openEconomyCG() writes), so gold/downtime are stamped by both tools
  await p.evaluate(() => { LOG.push({ type: 'econSetting', payload: { band: 'standard' }, cost: 0, noLock: true, seq: SEQ++, ts: Date.now(), label: 'Coin & calendar \u2014 Standard' }); render(); });
  await p.evaluate(() => cgFinishCreating(true)); await p.waitForTimeout(200);
  const env = await p.evaluate(() => JSON.stringify(_cgEnvelope(false)));
  await setCtl('hd', 4); await setCtl('st_STR', 12);
  const cg = await snap();
  const cgEvs = cg.log.slice(lockIdx(cg.log) + 1).map(e => ({ cat: e.cat, payload: e.payload, cost: e.cost, label: e.label, level: e.level, gp: e.gp, days: e.days }));
  const lp = await ctx.newPage(); lp.on('dialog', d => d.accept());
  await lp.addInitScript(e => { try { localStorage.setItem('pactLiveSheet', e); } catch (x) {} }, env);
  await lp.goto(`${base}/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' }); await lp.waitForTimeout(2500);
  await lp.evaluate(() => { buy('hd', { to: 4 }, 'Level up \u2192 Hit Die 4'); buy('abil', { ab: 'STR', to: 12 }, 'STR 10\u2192' + 12); });
  const ls = await lp.evaluate(() => ({ log: JSON.parse(JSON.stringify(LOG)), total: compute(foldBuild(null), _dmOpts()).total, spent: economy(null).spent }));
  const lsLock = lockIdx(ls.log);
  const lsEvs = ls.log.slice(lsLock + 1).filter(e => e.type === 'buy').map(e => ({ cat: e.cat, payload: e.payload, cost: e.cost, label: e.label, level: e.level, gp: e.gp, days: e.days }));
  check('...with the economy on, the post-lock purchases carry a frozen gold and downtime charge', cgEvs.length === 2 && cgEvs.every(e => typeof e.gp === 'number' && typeof e.days === 'number' && (e.gp > 0 || e.days > 0)), JSON.stringify(cgEvs.map(e => [e.gp, e.days])));
  check('head to head: CharGen and Live Sheet record the same post-lock events (cat, payload, cost, label, level, gold, downtime)',
    JSON.stringify(cgEvs) === JSON.stringify(lsEvs), JSON.stringify({ cg: cgEvs, ls: lsEvs }));
  check('...and the two logs fold to the same total and the same spent', cg.total === ls.total && cg.spent === ls.spent, JSON.stringify({ cg: [cg.total, cg.spent], ls: [ls.total, ls.spent] }));
  await lp.close();

  const fatal = errs.filter(e => !/Failed to load|net::|supabase|fetch/i.test(e));
  check('no fatal page errors', fatal.length === 0, fatal.slice(0, 2).join(' | '));
  await ctx.close();
}

// fix/chargen-flat-purchases-after-lock (S1; owner P1, 2026-10-04). Skills, boons, tools, arts, features, drawbacks... are flat
// checklist purchases, not patch slots. Found by a real-browser probe: after "Finish creating" (and before any DM award or seal) unticking
// a purchase made during creation DELETED the event and gave the AP back (a 6 AP boon -> spent fell by 6), because the retraction floor
// followed awards and seals, not the lock. A post-lock tick was also priced by a plain compute() delta with no gold/downtime stamp, and a
// player could tick a drawback (which GIVES AP) after creation. Rules now: nothing bought can be removed once locked (post-lock purchases
// included), a new drawback is refused, and a post-lock tick is an in-play purchase priced by priceOf and stamped like the Live Sheet's.
section('CharGen: flat purchases after the lock — no refunds, no new drawbacks, priced and charged in play (S1)');
{
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  let dialogs = [];
  p.on('dialog', async d => { dialogs.push({ type: d.type(), msg: d.message() }); await d.accept(); });
  const fresh = async () => { await p.goto(`${base}/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' }); await p.waitForTimeout(2500);
    await p.evaluate(() => { try { localStorage.clear(); } catch (e) {} }); await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(2500); dialogs = []; };
  const tick = async (cls, val, on) => { await p.evaluate(([cls, val, on]) => { const el = [...document.querySelectorAll('.' + cls)].find(e => e.value === val);
    if (!el) throw new Error('no .' + cls + ' ' + val); el.checked = on; el.dispatchEvent(new Event('change', { bubbles: true })); }, [cls, val, on]); await p.waitForTimeout(300); };
  const isTicked = (cls, val) => p.evaluate(([c, v]) => [...document.querySelectorAll('.' + c)].find(e => e.value === v).checked, [cls, val]);
  const snap = () => p.evaluate(() => ({ log: JSON.parse(JSON.stringify(LOG)), spent: economy(LOG).spent }));
  const lockIdx = l => l.findIndex(e => e.type === 'creationLocked');
  const boonEv = (l, v) => l.filter(e => e.type === 'buy' && e.cat === 'boon' && e.payload && e.payload.v === v);
  const [B1, B2] = await (async () => { await fresh(); return p.evaluate(() => [...document.querySelectorAll('.boonck')].slice(0, 2).map(e => e.value)); })();
  const [D1] = await p.evaluate(() => [...document.querySelectorAll('.drawck')].slice(0, 1).map(e => e.value));

  // ---- before the lock: unchanged — a ticked boon can still be unticked (it is a draft) ----
  await tick('boonck', B1, true);
  const pre1 = await snap();
  check('before the lock: ticking a boon records a purchase', boonEv(pre1.log, B1).length === 1 && boonEv(pre1.log, B1)[0].cost > 0, JSON.stringify(boonEv(pre1.log, B1).map(e => e.cost)));
  await tick('boonck', B1, false);
  check('before the lock: unticking it removes the purchase (drafts are free to change)', boonEv((await snap()).log, B1).length === 0);
  await tick('boonck', B1, true);

  // ---- after the lock ----
  await p.evaluate(() => cgFinishCreating(true)); await p.waitForTimeout(200);
  const l0 = await snap(); const li = lockIdx(l0.log);
  check('Finish creating records the lock', li >= 0);
  dialogs = [];
  await tick('boonck', B1, false);
  const l1 = await snap();
  check('after the lock: unticking a boon bought DURING CREATION is refused — the purchase stays and no AP comes back',
    boonEv(l1.log, B1).length === 1 && l1.spent === l0.spent, JSON.stringify({ n: boonEv(l1.log, B1).length, spent0: l0.spent, spent1: l1.spent }));
  check('...and the tick is put back so the form agrees with the character', await isTicked('boonck', B1));

  const priceBefore = await p.evaluate(v => priceOf(foldBuild(LOG), 'boon', { v }), B2);
  await tick('boonck', B2, true);
  const l2 = await snap(); const e2 = boonEv(l2.log, B2)[0];
  check('after the lock: ticking a new boon appends an in-play purchase AFTER the lock', !!e2 && l2.log.indexOf(e2) > lockIdx(l2.log), JSON.stringify(e2));
  check('...priced by the engine\'s priceOf (the Live Sheet\'s pricer), and spent rises by exactly that', !!e2 && e2.cost === priceBefore && l2.spent === l1.spent + priceBefore, JSON.stringify({ cost: e2 && e2.cost, priceBefore, s1: l1.spent, s2: l2.spent }));
  await tick('boonck', B2, false);
  const l3 = await snap();
  check('after the lock: a purchase made AFTER the lock cannot be unticked either', boonEv(l3.log, B2).length === 1 && l3.spent === l2.spent && await isTicked('boonck', B2));

  dialogs = [];
  const nBeforeDraw = (await snap()).log.length;
  await tick('drawck', D1, true);
  const l4 = await snap();
  check('after the lock: ticking a NEW drawback is refused (it would hand out AP) — nothing appended', l4.log.length === nBeforeDraw && l4.spent === l3.spent, JSON.stringify({ n0: nBeforeDraw, n1: l4.log.length }));
  check('...the player is told why, and the drawback tick is cleared', dialogs.some(d => /Drawbacks can.t be taken once creation is finished/.test(d.msg)) && !(await isTicked('drawck', D1)), JSON.stringify(dialogs.map(d => d.msg.slice(0, 60))));

  // ---- the Live Sheet's own legality rule applies after the lock (refactor/engine-purchase-legality) ----
  // "Hard March: boon requires CON 12+" carries no stop-sign marker, so CharGen's old guard (⛔-prefixed warnings only) let it through while
  // the Live Sheet's buy() refuses it. Both now ask the engine's purchaseLegality().
  dialogs = [];
  const nBeforeHM = (await snap()).log.length;
  await tick('boonck', 'Hard March', true);
  const lh = await snap();
  check('after the lock: a boon whose prerequisite is unmet ("requires CON 12+") is refused, as the Live Sheet refuses it — nothing appended',
    lh.log.length === nBeforeHM && !(await isTicked('boonck', 'Hard March')) && dialogs.some(d => /Purchase blocked/.test(d.msg) && /CON 12/.test(d.msg)), JSON.stringify({ n0: nBeforeHM, n1: lh.log.length, d: dialogs.map(d => d.msg.slice(0, 80)) }));

  // ---- head to head with the Live Sheet, economy on: the same purchase records the same event ----
  await fresh();
  await tick('boonck', B1, true);
  await p.evaluate(() => { LOG.push({ type: 'econSetting', payload: { band: 'standard' }, cost: 0, noLock: true, seq: SEQ++, ts: Date.now(), label: 'Coin & calendar \u2014 Standard' }); render(); });
  await p.evaluate(() => cgFinishCreating(true)); await p.waitForTimeout(200);
  const env = await p.evaluate(() => JSON.stringify(_cgEnvelope(false)));
  await tick('boonck', B2, true);
  const cg = await snap();
  const pick = e => ({ cat: e.cat, payload: e.payload, cost: e.cost, level: e.level, gp: e.gp, days: e.days });
  const cgEvs = cg.log.slice(lockIdx(cg.log) + 1).filter(e => e.type === 'buy').map(pick);
  const lp = await ctx.newPage(); lp.on('dialog', d => d.accept());
  await lp.addInitScript(e => { try { localStorage.setItem('pactLiveSheet', e); } catch (x) {} }, env);
  await lp.goto(`${base}/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' }); await lp.waitForTimeout(2500);
  await lp.evaluate(v => { buy('boon', { v }, 'Boon \u2014 ' + v); }, B2);
  const ls = await lp.evaluate(() => ({ log: JSON.parse(JSON.stringify(LOG)), spent: economy(null).spent }));
  const lsEvs = ls.log.slice(lockIdx(ls.log) + 1).filter(e => e.type === 'buy').map(pick);
  check('with the economy on, the post-lock boon carries a frozen gold and downtime charge', cgEvs.length === 1 && typeof cgEvs[0].gp === 'number' && typeof cgEvs[0].days === 'number' && (cgEvs[0].gp > 0 || cgEvs[0].days > 0), JSON.stringify(cgEvs));
  check('head to head: CharGen and Live Sheet record the same post-lock event (cat, payload, cost, level, gold, downtime) and the same spent',
    JSON.stringify(cgEvs) === JSON.stringify(lsEvs) && cg.spent === ls.spent, JSON.stringify({ cg: cgEvs, ls: lsEvs, spent: [cg.spent, ls.spent] }));
  await lp.close();

  const fatal = errs.filter(e => !/Failed to load|net::|supabase|fetch/i.test(e));
  check('no fatal page errors', fatal.length === 0, fatal.slice(0, 2).join(' | '));
  await ctx.close();
}

// fix/chargen-post-lock-purchases, phase 2a (owner R1, 2026-10-04): after "Finish creating", the flat patch slots — languages, vigor & grit, ki,
// sorcery, attunement, armour (+ what you wear), weapon proficiency, free subclass — record an increase as an appended in-play purchase through the
// same helper as phase 1, lowering/swapping is refused, and customProfs (free text, no Live Sheet equivalent) is refused. Plan §9.
section('CharGen records post-lock raises of the flat slots as in-play purchases (B2, phase 2a)');
{
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  let dialogs = [];
  p.on('dialog', async d => { dialogs.push({ type: d.type(), msg: d.message() }); await d.accept(); });
  const fresh = async () => { await p.goto(`${base}/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' }); await p.waitForTimeout(2500);
    await p.evaluate(() => { try { localStorage.clear(); } catch (e) {} }); await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(2500); dialogs = []; };
  const setSel = async (id, v) => { await p.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = String(v); el.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]); await p.waitForTimeout(300); };
  const setChk = async (id, on) => { await p.evaluate(([id, on]) => { const el = document.getElementById(id); el.checked = on; el.dispatchEvent(new Event('change', { bubbles: true })); }, [id, on]); await p.waitForTimeout(300); };
  const val = id => p.evaluate(id => { const el = document.getElementById(id); return el.type === 'checkbox' ? el.checked : el.value; }, id);
  const snap = () => p.evaluate(() => ({ log: JSON.parse(JSON.stringify(LOG)), spent: economy(LOG).spent, total: compute(foldBuild(LOG), _cgDmOpts()).total }));
  const lockIdx = l => l.findIndex(e => e.type === 'creationLocked');
  const pick = e => ({ cat: e.cat, payload: e.payload, cost: e.cost, label: e.label, level: e.level, gp: e.gp, days: e.days });
  const econOn = () => p.evaluate(() => { LOG.push({ type: 'econSetting', payload: { band: 'standard' }, cost: 0, noLock: true, seq: SEQ++, ts: Date.now(), label: 'Coin & calendar \u2014 Standard' }); render(); });

  // ---- before the lock: unchanged — one slot event, rewritten in place, nothing appended ----
  await fresh();
  await setSel('languages', 3);
  const pre = await snap();
  check('before the lock: raising Languages still rewrites the one languages slot event (no appended "language" purchase)',
    pre.log.filter(e => e.cat === 'patch' && e._slot === 'languages').length === 1 && !pre.log.some(e => e.cat === 'language'), JSON.stringify(pre.log.filter(e => e.cat === 'language')));

  // ---- head to head with the Live Sheet, economy on ----
  await fresh();
  await setSel('st_CON', 12);   // Vigor is capped at the CON modifier — CON 12 makes Vigor 1 legal (at CON 10 BOTH tools refuse it; see the refusal check below)
  await econOn();
  await p.evaluate(() => cgFinishCreating(true)); await p.waitForTimeout(200);
  const env = await p.evaluate(() => JSON.stringify(_cgEnvelope(false)));
  const freeSelId = await p.evaluate(() => { const o = readBuild().originClass; const el = [...document.querySelectorAll('.freesub')].find(e => e.dataset.cls === o) || document.querySelector('.freesub'); return el ? [el.dataset.cls, [...el.options].map(x => x.value).filter(Boolean)[0]] : null; });
  await setSel('languages', 3);
  await setSel('hardy', 1); await setSel('tough', 1);
  await setSel('ki', 1); await setSel('attune', 1);
  await setChk('a_light', true);
  await setChk('wp_simple', true);
  await setSel('wornArmour', 'Padded');
  if (freeSelId) await p.evaluate(([cls, sub]) => { const el = [...document.querySelectorAll('.freesub')].find(e => e.dataset.cls === cls); el.value = sub; el.dispatchEvent(new Event('change', { bubbles: true })); }, freeSelId);
  await p.waitForTimeout(300);
  const cg = await snap();
  const cgEvs = cg.log.slice(lockIdx(cg.log) + 1).filter(e => e.type === 'buy').map(pick);
  const lp = await ctx.newPage(); lp.on('dialog', d => d.accept());
  await lp.addInitScript(e => { try { localStorage.setItem('pactLiveSheet', e); } catch (x) {} }, env);
  await lp.goto(`${base}/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' }); await lp.waitForTimeout(2500);
  await lp.evaluate(fs => {
    buy('language', { to: 2 }, '+1 Language (2)'); buy('language', { to: 3 }, '+1 Language (3)');
    buy('vigor', { to: 1 }, 'Vigor rank 1'); buy('grit', { to: 1 }, 'Grit +4 HP (1)');
    buy('ki', { to: 1 }, 'Ki / Focus point 1'); buy('attune', { to: 1 }, 'Attunement slot 1');
    buy('armour', { v: 'light' }, 'Light armour');
    const wp = foldBuild(null).weaponProf || {}; buy('wprof', { wp: { ...wp, simple: true } }, 'Simple weapons');
    setWornArmour('Padded');
    if (fs) buy('freesub', { cls: fs[0], sub: fs[1] }, 'Free subclass \u2192 ' + fs[1]);
  }, freeSelId);
  const ls = await lp.evaluate(() => ({ log: JSON.parse(JSON.stringify(LOG)), total: compute(foldBuild(null), _dmOpts()).total, spent: economy(null).spent }));
  const lsEvs = ls.log.slice(lockIdx(ls.log) + 1).filter(e => e.type === 'buy').map(pick);
  const cats = cgEvs.map(e => e.cat).join(',');
  check('after the lock each raise is an appended in-play purchase of the right category, one per step', cats.startsWith('language,language,vigor,grit,ki,attune,armour,wprof,wornArmour'), cats);
  check('...with the economy on, each priced purchase carries a frozen gold and downtime charge (worn armour is free and unstamped)',
    cgEvs.filter(e => e.cat !== 'wornArmour' && e.cost > 0).every(e => typeof e.gp === 'number' && typeof e.days === 'number'), JSON.stringify(cgEvs.map(e => [e.cat, e.cost, e.gp, e.days])));
  check('head to head: CharGen and the Live Sheet record the same events (cat, payload, cost, label, level, gold, downtime)',
    JSON.stringify(cgEvs) === JSON.stringify(lsEvs), JSON.stringify({ cg: cgEvs, ls: lsEvs }));
  check('...and the two logs fold to the same total and the same spent', cg.total === ls.total && cg.spent === ls.spent, JSON.stringify({ cg: [cg.total, cg.spent], ls: [ls.total, ls.spent] }));
  await lp.close();

  // ---- lowering / giving up is refused: nothing appended, the control goes back ----
  const refuse = async (what, act, ctl, expectVal, re) => {
    dialogs = []; const before = await snap(); await act(); const after = await snap();
    check(`after the lock: ${what} is refused — nothing appended and spent unchanged`, after.log.length === before.log.length && after.spent === before.spent, JSON.stringify({ n0: before.log.length, n1: after.log.length }));
    check(`...the player is told why and the control goes back`, dialogs.some(d => re.test(d.msg)) && (await val(ctl)) === expectVal, JSON.stringify({ dialogs: dialogs.map(d => d.msg.slice(0, 40)), now: await val(ctl) }));
  };
  await refuse('lowering Languages', () => setSel('languages', 2), 'languages', '3', /Languages can only go up/);
  await refuse('lowering Vigor', () => setSel('hardy', 0), 'hardy', '1', /Vigor can only go up/);
  await refuse('raising Vigor past the CON modifier (cap 1) — the Live Sheet\'s legality rule', () => setSel('hardy', 3), 'hardy', '1', /Purchase blocked[\s\S]*Vigor \d exceeds cap/);
  await refuse('unticking Light armour', () => setChk('a_light', false), 'a_light', true, /Light armour training can.t be given up/);
  await refuse('unticking Simple weapons', () => setChk('wp_simple', false), 'wp_simple', true, /Weapon proficiencies can.t be given up/);

  // ---- customProfs (free text): refused after the lock ----
  dialogs = [];
  const nCp = (await snap()).log.length;
  await p.evaluate(() => { addRow('cprof', 'Smith\'s tools'); const row = [...document.querySelectorAll('.cprofrow')].pop(); if (row) row.dispatchEvent(new Event('change', { bubbles: true })); });   // the refusal can fire inside addRow itself and repaint the row away
  await p.waitForTimeout(400);
  const cp = await snap();
  check('after the lock: adding a custom (free-text) proficiency is refused — nothing appended, and the player is pointed at the DM',
    cp.log.length === nCp && dialogs.some(d => /Custom proficiencies are chosen during creation/.test(d.msg) && /ask your DM/i.test(d.msg)), JSON.stringify({ n0: nCp, n1: cp.log.length, d: dialogs.map(d => d.msg.slice(0, 50)) }));

  const fatal = errs.filter(e => !/Failed to load|net::|supabase|fetch/i.test(e));
  check('no fatal page errors', fatal.length === 0, fatal.slice(0, 2).join(' | '));
  await ctx.close();
}

// fix/chargen-post-lock-2b1-refusals (phase 2b-1; plan docs/plans/2026-10-04-chargen-post-lock-2b-spellcasting.md, cold-reviewed 2026-10-04): after the lock
// the spellcasting, innate, misc (martial binding / out-of-tradition cantrips) and identity (species, origin class, size, lineage) slots no longer rewrite
// their creation-era patch event in place. A write that changes nothing is a no-op; anything else is refused with a plain message and the control goes back.
section('CharGen refuses post-lock edits to spellcasting, innate, misc and identity (B2, phase 2b-1)');
{
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  let dialogs = [];
  p.on('dialog', async d => { dialogs.push({ type: d.type(), msg: d.message() }); await d.accept(); });
  const fresh = async () => { await p.goto(`${base}/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' }); await p.waitForTimeout(2500);
    await p.evaluate(() => { try { localStorage.clear(); } catch (e) {} }); await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(2500); dialogs = []; };
  const setSel = async (id, v) => { await p.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = String(v); el.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]); await p.waitForTimeout(300); };
  const snap = () => p.evaluate(() => ({ log: JSON.parse(JSON.stringify(LOG)), spent: economy(LOG).spent, b: (() => { const b = foldBuild(LOG); return { trad: b.traditions, innate: b.innate, mb: b.martiallyBound, dab: b.dabblerCantrips, species: b.species, size: b.size, lineage: b.lineage }; })() }));
  const TRAD = [{ name: 'Primal', rank: 1, disciplines: [{ name: 'Druid', bound: false, known: [0,0,0,0,0,0,0,0,0], slots: [1,0,0,0,0,0,0,0,0], arcanum: [0,0,0,0], cantrips: 1, pactSlots: 0 }] }];
  const TRAD2 = JSON.parse(JSON.stringify(TRAD)); TRAD2[0].disciplines[0].cantrips = 2; TRAD2[0].rank = 2;

  // ---- before the lock: unchanged — the spellcasting slot is still one patch event rewritten in place ----
  await fresh();
  await p.evaluate(t => replacePatchSlot(PATCH_SLOTS.TRADITIONS, { traditions: t }), TRAD);
  await p.evaluate(t => replacePatchSlot(PATCH_SLOTS.TRADITIONS, { traditions: t }), TRAD2);
  const pre = await snap();
  check('before the lock: spellcasting edits still rewrite the one traditions slot event in place',
    pre.log.filter(e => e.cat === 'patch' && e._slot === 'traditions').length === 1 && JSON.stringify(pre.b.trad) === JSON.stringify(TRAD2), JSON.stringify(pre.b.trad).slice(0, 120));

  // ---- after the lock ----
  await p.evaluate(() => cgFinishCreating(true)); await p.waitForTimeout(300);
  const a0 = await snap(); dialogs = [];
  const refused = async (what, act, re) => { dialogs = []; const before = await snap(); await act(); const after = await snap();
    check(`after the lock: ${what} is refused — nothing written and spent unchanged`, after.log.length === before.log.length && JSON.stringify(after.b) === JSON.stringify(before.b) && after.spent === before.spent, JSON.stringify({ n0: before.log.length, n1: after.log.length }));
    check('...the player is told why', dialogs.some(d => re.test(d.msg)), JSON.stringify(dialogs.map(d => d.msg.slice(0, 60)))); };
  await refused('lowering spellcasting (rank 2 -> 1, cantrips 2 -> 1)', () => p.evaluate(t => replacePatchSlot(PATCH_SLOTS.TRADITIONS, { traditions: t }), TRAD), /can only go up once creation is finished/);
  await refused('changing innate spells', () => p.evaluate(() => replacePatchSlot(PATCH_SLOTS.INNATE, { innate: [1, 0, 0, 0, 0, 0, 0, 0, 0] })), /Innate spells are chosen during creation/);
  await refused('taking martial binding (it grants AP)', () => setSel('martiallyBound', 'Fighter'), /binding give you AP/);
  await refused('adding out-of-tradition cantrips', () => setSel('dabblerCantrips', 2), /Out-of-Tradition cantrips are chosen during creation/);
  const otherSpecies = await p.evaluate(() => { const cur = document.getElementById('spec').value; return [...document.getElementById('spec').options].map(o => o.value).find(v => v && v !== cur); });
  await refused('changing species', () => setSel('spec', otherSpecies), /origin .*is chosen during creation/);
  check('...and each control goes back to what the character is', (await p.evaluate(() => [document.getElementById('martiallyBound').value, document.getElementById('dabblerCantrips').value, document.getElementById('spec').value])).join('|') !== '', '');

  // a write that changes nothing is a no-op: no dialog, nothing appended
  dialogs = []; const nB = (await snap()).log.length;
  await p.evaluate(t => replacePatchSlot(PATCH_SLOTS.TRADITIONS, { traditions: t }), TRAD2);
  check('after the lock: writing the spellcasting the character already has is a silent no-op', dialogs.length === 0 && (await snap()).log.length === nB, JSON.stringify(dialogs));

  // a reload of a locked character that has spells raises no refusal (the form re-sync must not look like an edit)
  await p.evaluate(() => _cgAutosave()); dialogs = [];
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(3000);
  const rl = await snap();
  check('reloading a locked spellcaster raises no refusal and keeps the spell slot as it was', dialogs.length === 0 && JSON.stringify(rl.b.trad) === JSON.stringify(TRAD2), JSON.stringify({ d: dialogs.map(d => d.msg.slice(0, 60)) }));

  // A CAMPAIGN character that is locked is frozen by the server up to the lock (D2), so opening it must not rewrite the history before the lock — the
  // Live Sheet's "Imported budget" award at index 0 used to be re-emitted at the END as "Budget" on every load (round-trip audit, 2026-10-04).
  await fresh();
  await p.evaluate(t => replacePatchSlot(PATCH_SLOTS.TRADITIONS, { traditions: t }), TRAD2);
  await p.evaluate(() => cgFinishCreating(true)); await p.waitForTimeout(300);
  await p.evaluate(() => { window._cgCampaignId = '00000000-0000-0000-0000-00000000c001'; });
  const env = await p.evaluate(() => JSON.stringify(_cgEnvelope(false)));
  const protectedSig = log => JSON.stringify(log.filter(e => e.type === 'award' || (e.type === 'buy' && e.cat !== 'patch')).map(e => { const x = { ...e }; delete x.seq; delete x.ts; delete x.rules; return x; }));
  const c0 = await snap(); dialogs = [];
  await p.evaluate(e => { _cgApplyEnvelope(JSON.parse(e), {}); }, env); await p.waitForTimeout(600);
  const c1 = await snap();
  check('opening a locked CAMPAIGN character leaves its award and purchases exactly where they were (no rewrite, no warning)',
    protectedSig(c0.log) === protectedSig(c1.log) && c1.log.findIndex(e => e.type === 'award') === c0.log.findIndex(e => e.type === 'award') && dialogs.length === 0,
    JSON.stringify({ awardAt0: c0.log.findIndex(e => e.type === 'award'), awardAt1: c1.log.findIndex(e => e.type === 'award'), d: dialogs.map(d => d.msg.slice(0, 50)) }));

  const fatal = errs.filter(e => !/Failed to load|net::|supabase|fetch/i.test(e));
  check('no fatal page errors', fatal.length === 0, fatal.slice(0, 2).join(' | '));
  await ctx.close();
}

// feat/chargen-wallet-warning (Q2; plan docs/plans/2026-10-04-chargen-wallet-warning-q2.md, cold-reviewed 2026-10-04): after the lock, with the campaign economy on, CharGen shows the Live Sheet's
// soft wallet-shortfall warning and the §16 coin-for-time trade offer. WHETHER to offer a trade and how short a purchase is come from the engine's walletCheck() (shared with the Live Sheet);
// a multi-step edit gets its trade offers step by step against a running wallet and ONE aggregated shortfall confirm, all-or-nothing.
section('CharGen shows the wallet shortfall warning and the §16 trade offer after the lock (Q2)');
{
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  let dialogs = [], answers = [];   // answers: what to do with each confirm, in order (default: accept)
  p.on('dialog', async d => { dialogs.push({ type: d.type(), msg: d.message() }); const a = d.type() === 'confirm' && answers.length ? answers.shift() : true; await (a ? d.accept() : d.dismiss()); });
  const fresh = async () => { await p.goto(`${base}/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' }); await p.waitForTimeout(2500);
    await p.evaluate(() => { try { localStorage.clear(); } catch (e) {} }); await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(2500); dialogs = []; answers = []; };
  const tick = async (cls, val, on) => { await p.evaluate(([cls, val, on]) => { const el = [...document.querySelectorAll('.' + cls)].find(e => e.value === val); el.checked = on; el.dispatchEvent(new Event('change', { bubbles: true })); }, [cls, val, on]); await p.waitForTimeout(300); };
  const setSel = async (id, v) => { await p.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = String(v); el.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]); await p.waitForTimeout(300); };
  const snap = () => p.evaluate(() => ({ log: JSON.parse(JSON.stringify(LOG)), spent: economy(LOG).spent }));
  const lockIdx = l => l.findIndex(e => e.type === 'creationLocked');
  const after = (s) => s.log.slice(lockIdx(s.log) + 1).filter(e => e.type === 'buy').map(e => ({ cat: e.cat, payload: e.payload, cost: e.cost, gp: e.gp, days: e.days }));
  const econOn = () => p.evaluate(() => { LOG.push({ type: 'econSetting', payload: { band: 'standard' }, cost: 0, noLock: true, seq: SEQ++, ts: Date.now(), label: 'Coin & calendar \u2014 Standard' }); render(); });
  // a campaign-bound character whose campaign is CONFIRMED, with the server-held gold and the party window the tool would have fetched
  const campaign = (o) => p.evaluate(o => { window._cgCampaignId = '00000000-0000-0000-0000-00000000c001'; window._cgCampaignBound = true; window._cloudCampaign = { name: 't', rules: { economy: { band: 'standard' } } };
    window._dmApStatus = o.status || 'active'; window._cgDmGold = o.gold; window._cgDmWindow = o.window; window._cgWalletConfirmed = o.confirmed !== false; }, o);
  const [B] = await (async () => { await fresh(); return p.evaluate(() => [...document.querySelectorAll('.boonck')].map(e => e.value).filter(v => v === 'Crippling Strike')); })();   // a 4 AP boon: 25 gp / 7 days in play
  const lock = async () => { await econOn(); await p.evaluate(() => cgFinishCreating(true)); await p.waitForTimeout(300); };

  // 1. a locked campaign character with NO gold and a big window: short of gold only, the trade would not close -> shortfall confirm, no trade offer
  await fresh(); await lock(); await campaign({ gold: 0, window: { days: 60, startTs: 0 } });
  answers = [false]; await tick('boonck', B, true);
  let s1 = await snap();
  check('short of gold with downtime to spare, and no trade could close: ONE shortfall confirm and no trade offer', dialogs.filter(d => d.type === 'confirm').length === 1 && /short 25 gp/.test(dialogs[0].msg) && !/Take the trade/.test(dialogs[0].msg), JSON.stringify(dialogs.map(d => d.msg.slice(0, 90))));
  check('...declining it abandons the purchase: nothing appended and the tick is cleared', after(s1).length === 0 && !(await p.evaluate(v => [...document.querySelectorAll('.boonck')].find(e => e.value === v).checked, B)));
  dialogs = []; answers = [true]; await tick('boonck', B, true); s1 = await snap();
  check('...accepting it records the purchase at the list price (25 gp, 7 days) — a DM can waive or defer', JSON.stringify(after(s1)) === JSON.stringify([{ cat: 'boon', payload: { v: B }, cost: 4, gp: 25, days: 7 }]), JSON.stringify(after(s1)));

  // 2. DM-held gold but only 3 days of window: short of downtime only, rich in gold -> the §16 trade offer; accepting freezes the TRADED price
  await fresh(); await lock(); await campaign({ gold: 5000, window: { days: 3, startTs: 0 } });
  answers = [true]; await tick('boonck', B, true);
  const s2 = await snap();
  check('short of downtime but rich in DM-held gold: the §16 trade offer is shown (and no shortfall confirm follows it once the trade covers it)',
    dialogs.filter(d => d.type === 'confirm').length === 1 && /short of downtime/.test(dialogs[0].msg) && /Traded:/.test(dialogs[0].msg), JSON.stringify(dialogs.map(d => d.msg.slice(0, 80))));
  check('...accepting freezes the TRADED price on the purchase (75 gp, 3 days)', JSON.stringify(after(s2)) === JSON.stringify([{ cat: 'boon', payload: { v: B }, cost: 4, gp: 75, days: 3 }]), JSON.stringify(after(s2)));
  const envTrade = await p.evaluate(() => JSON.stringify(_cgEnvelope(false)));   // for the head-to-head below (state AFTER; rebuilt below instead)

  // 2b. cancelling the trade offer abandons the purchase (the Live Sheet's rule: "Cancel = leave the purchase alone")
  await fresh(); await lock(); await campaign({ gold: 5000, window: { days: 3, startTs: 0 } });
  answers = [false]; await tick('boonck', B, true); const s2b = await snap();
  check('cancelling the trade offer abandons the purchase: nothing appended, the tick is cleared, and no second prompt follows', after(s2b).length === 0 && dialogs.filter(d => d.type === 'confirm').length === 1 && !(await p.evaluate(v => [...document.querySelectorAll('.boonck')].find(e => e.value === v).checked, B)), JSON.stringify({ n: after(s2b).length, d: dialogs.length }));

  // 3. the DM-held gold and window cover it: silence (the false-shortfall case)
  await fresh(); await lock(); await campaign({ gold: 5000, window: { days: 60, startTs: 0 } });
  await tick('boonck', B, true); const s3 = await snap();
  check('DM-held gold and a big window cover the price: no prompt at all, charged at list price', dialogs.length === 0 && after(s3)[0] && after(s3)[0].gp === 25 && after(s3)[0].days === 7, JSON.stringify(dialogs.map(d => d.msg.slice(0, 60))));

  // 4. an UNCONFIRMED campaign (status 'unavailable'): the server inputs are NOT composed — no phantom gold — and the prompt says the figures are unconfirmed
  await fresh(); await lock(); await campaign({ gold: 5000, window: { days: 60, startTs: 0 }, status: 'unavailable', confirmed: false });
  answers = [false]; await tick('boonck', B, true);
  check('an unconfirmed campaign does not count the DM-held gold (shortfall shown from the own log) and the prompt says it could not be confirmed',
    dialogs.filter(d => d.type === 'confirm').length === 1 && /short 25 gp/.test(dialogs[0].msg) && /could not be confirmed/.test(dialogs[0].msg), JSON.stringify(dialogs.map(d => d.msg.slice(0, 120))));

  // 5. a two-step edit (Hit Dice 3 -> 5, 25 gp + 7 days each) against a wallet that covers ONE step: a single aggregated confirm, all-or-nothing
  await fresh(); await setSel('hd', 3); await lock(); await campaign({ gold: 25, window: { days: 60, startTs: 0 } });
  answers = [false]; await setSel('hd', 5);
  const s5a = await snap();
  check('a two-step edit short of gold gets ONE shortfall confirm for the whole edit (not one per step)', dialogs.filter(d => d.type === 'confirm').length === 1 && /This edit costs 50 gp/.test(dialogs[0].msg) && /short 25 gp/.test(dialogs[0].msg), JSON.stringify(dialogs.map(d => d.msg.slice(0, 100))));
  check('...cancelling appends nothing and Hit Dice go back', after(s5a).length === 0 && (await p.evaluate(() => document.getElementById('hd').value)) === '3', JSON.stringify(after(s5a)));
  dialogs = []; answers = [true]; await setSel('hd', 5); const s5b = await snap();
  check('...accepting appends both steps, each stamped with its own charge (25 gp / 7 days)', after(s5b).length === 2 && after(s5b).every(e => e.cat === 'hd' && e.gp === 25 && e.days === 7), JSON.stringify(after(s5b)));

  // 6. economy off: silent, no charge stamped
  await fresh(); await p.evaluate(() => cgFinishCreating(true)); await p.waitForTimeout(300); await tick('boonck', B, true); const s6 = await snap();
  check('economy off: no prompts and no gold/downtime stamped', dialogs.length === 0 && after(s6)[0] && after(s6)[0].gp === undefined, JSON.stringify(dialogs.length));

  // 7. head to head with the Live Sheet: the same wallet, the same answer, the same frozen charge (list price after declining the trade; traded price after accepting it)
  const headToHead = async (label, gold, window_, answersCg, answersLs) => {
    await fresh(); await lock(); await campaign({ gold, window: window_ });
    const env = await p.evaluate(() => JSON.stringify(_cgEnvelope(false)));
    answers = answersCg.slice(); await tick('boonck', B, true); const cg = after(await snap());
    const lp = await ctx.newPage(); const lpd = []; let la = answersLs.slice();
    lp.on('dialog', async d => { lpd.push(d.message()); const a = d.type() === 'confirm' && la.length ? la.shift() : true; await (a ? d.accept() : d.dismiss()); });
    await lp.addInitScript(e => { try { localStorage.setItem('pactLiveSheet', e); } catch (x) {} }, env);
    await lp.goto(`${base}/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' }); await lp.waitForTimeout(2500);
    await lp.evaluate(o => { window._rulesStatus = 'active'; window._dmGold = o.gold; window._dmWindow = o.window; window._cloudCampaignRules = { economy: { band: 'standard' } }; }, { gold, window: window_ });
    await lp.evaluate(v => { buy('boon', { v }, 'Boon \u2014 ' + v); }, B);
    const lsLog = await lp.evaluate(() => JSON.parse(JSON.stringify(LOG)));
    const ls = lsLog.slice(lockIdx(lsLog) + 1).filter(e => e.type === 'buy').map(e => ({ cat: e.cat, payload: e.payload, cost: e.cost, gp: e.gp, days: e.days }));
    check(`head to head (${label}): CharGen and the Live Sheet freeze the same charge`, JSON.stringify(cg) === JSON.stringify(ls), JSON.stringify({ cg, ls }));
    await lp.close();
  };
  await headToHead('trade accepted', 5000, { days: 3, startTs: 0 }, [true], [true]);
  await headToHead('trade cancelled (abandons the purchase in both)', 5000, { days: 3, startTs: 0 }, [false], [false]);
  await headToHead('shortfall declined (abandons the purchase in both)', 0, { days: 60, startTs: 0 }, [false], [false]);
  await headToHead('short of gold, accepted', 0, { days: 60, startTs: 0 }, [true], [true]);

  const fatal = errs.filter(e => !/Failed to load|net::|supabase|fetch/i.test(e));
  check('no fatal page errors', fatal.length === 0, fatal.slice(0, 2).join(' | '));
  await ctx.close();
}

// feat/chargen-2b2-traditions-diff (owner, 2026-10-05: "just don't allow a decrease — adding disciplines etc. too"). After the lock CharGen turns the spell form's nested list into the Live
// Sheet's own found / rank / cantrip / slot / known purchases: everything may go UP (including a new discipline or tradition), nothing may go DOWN or change identity.
section('CharGen records post-lock spellcasting increases as in-play purchases; only decreases are refused (phase 2b-2)');
{
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  let dialogs = [];
  p.on('dialog', async d => { dialogs.push({ type: d.type(), msg: d.message() }); await d.accept(); });
  const fresh = async () => { await p.goto(`${base}/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' }); await p.waitForTimeout(2500);
    await p.evaluate(() => { try { localStorage.clear(); } catch (e) {} }); await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(2500); dialogs = []; };
  const setSel = async (id, v) => { await p.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = String(v); el.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]); await p.waitForTimeout(300); };
  const snap = () => p.evaluate(() => ({ log: JSON.parse(JSON.stringify(LOG)), spent: economy(LOG).spent, total: compute(foldBuild(LOG), _cgDmOpts()).total, trad: foldBuild(LOG).traditions }));
  const lockIdx = l => l.findIndex(e => e.type === 'creationLocked');
  const pick = e => ({ cat: e.cat, payload: e.payload, cost: e.cost, label: e.label, level: e.level, gp: e.gp, days: e.days });
  const post = s => s.log.slice(lockIdx(s.log) + 1).filter(e => e.type === 'buy').map(pick);
  const econOn = () => p.evaluate(() => { LOG.push({ type: 'econSetting', payload: { band: 'standard' }, cost: 0, noLock: true, seq: SEQ++, ts: Date.now(), label: 'Coin & calendar — Standard' }); render(); });
  const edit = (fn, ...args) => p.evaluate(([src, a]) => { const f = eval('(' + src + ')'); const cur = JSON.parse(JSON.stringify(foldBuild(LOG).traditions || [])); const next = f(cur, ...a); replacePatchSlot(PATCH_SLOTS.TRADITIONS, { traditions: next }); }, [fn.toString(), args]);
  const D = await (async () => { await fresh(); return p.evaluate(() => ({ arcane: DATA.disc.Arcane.filter(x => (DATA.prepared || []).indexOf(x) < 0)[0], arcane2: DATA.disc.Arcane.filter(x => (DATA.prepared || []).indexOf(x) < 0)[1], primalPrep: DATA.disc.Primal.filter(x => (DATA.prepared || []).indexOf(x) >= 0)[0], divine: DATA.disc.Divine[0], hdGate: DATA.hdGate })); })();
  const mk = (trad, rank, discs) => ({ name: trad, rank, disciplines: discs.map(d => ({ name: d[0], bound: false, cantrips: d[1] || 0, slots: d[2] || [0,0,0,0,0,0,0,0,0], known: d[3] || [0,0,0,0,0,0,0,0,0], pactSlots: 0, arcanum: [0,0,0,0] })) });
  const START = [mk('Arcane', 2, [[D.arcane, 1, [1,0,0,0,0,0,0,0,0], [1,0,0,0,0,0,0,0,0]]])];

  // ---- the head-to-head: raise things, add a discipline, add a tradition — CharGen vs the Live Sheet's own buy() ----
  await fresh(); await setSel('hd', 5); await setSel('st_INT', 18); await setSel('budget', 400);   // slots are capped at the casting modifier, cantrips at proficiency + modifier; the budget pays for 12 purchases
  await p.evaluate(t => replacePatchSlot(PATCH_SLOTS.TRADITIONS, { traditions: t }), START);
  await econOn(); await p.evaluate(() => cgFinishCreating(true)); await p.waitForTimeout(300);
  const env = await p.evaluate(() => JSON.stringify(_cgEnvelope(false)));
  const NEXT = JSON.parse(JSON.stringify(START));
  NEXT[0].rank = 4; NEXT[0].disciplines[0].cantrips = 2; NEXT[0].disciplines[0].slots[0] = 3; NEXT[0].disciplines[0].slots[1] = 1; NEXT[0].disciplines[0].known[0] = 2;   // rank +2, a cantrip (capped at proficiency + INT mod = 2), L1 slots +2, an L2 slot, an L1 known spell
  NEXT[0].disciplines.push(mk('x', 0, [[D.arcane2, 1]]).disciplines[0]);                                                                              // a second discipline in the same tradition
  NEXT.push(mk('Divine', 1, [[D.divine, 1]]));                                                                                                          // a whole new tradition
  await p.evaluate(t => replacePatchSlot(PATCH_SLOTS.TRADITIONS, { traditions: t }), NEXT);
  const cg = await snap();
  const cgEvs = post(cg);
  check('after the lock: raising rank, cantrips, slots and known spells, adding a discipline and a tradition is accepted as in-play purchases (no refusal)', cgEvs.length >= 10 && dialogs.filter(d => /🔒/.test(d.msg)).length === 0, JSON.stringify({ n: cgEvs.length, d: dialogs.map(d => d.msg.slice(0, 80)) }));
  check('...found first, then ranks, then the powers (so each step\'s gate is met)', cgEvs.map(e => e.cat).join(',').replace(/(rank,)+/, 'rank,').replace(/(cantrip,)+/g, 'cantrip,').startsWith('found,found,rank'), cgEvs.map(e => e.cat).join(','));
  const lp = await ctx.newPage(); lp.on('dialog', d => d.accept());
  await lp.addInitScript(e => { try { localStorage.setItem('pactLiveSheet', e); } catch (x) {} }, env);
  await lp.goto(`${base}/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' }); await lp.waitForTimeout(2500);
  await lp.evaluate(D => {   // the SAME purchases, written by hand as the Live Sheet's buy tiles make them (payloads and labels from its Spellcasting panel)
    buy('found', { ti: 0, trad: 'Arcane', disc: D.arcane2 }, 'Add discipline: ' + D.arcane2);
    buy('found', { ti: 1, trad: 'Divine', disc: D.divine }, 'Open Divine / ' + D.divine);
    buy('rank', { ti: 0, to: 3 }, 'Arcane Rank 3'); buy('rank', { ti: 0, to: 4 }, 'Arcane Rank 4'); buy('rank', { ti: 1, to: 1 }, 'Divine Rank 1');
    buy('cantrip', { ti: 0, di: 0, to: 2 }, 'Cantrip (2)');
    buy('slot', { ti: 0, di: 0, L: 1, to: 2 }, 'L1 slot (2)'); buy('slot', { ti: 0, di: 0, L: 1, to: 3 }, 'L1 slot (3)'); buy('slot', { ti: 0, di: 0, L: 2, to: 1 }, 'L2 slot (1)');
    buy('known', { ti: 0, di: 0, L: 1, to: 2 }, 'L1 known (2)');
    buy('cantrip', { ti: 0, di: 1, to: 1 }, 'Cantrip (1)'); buy('cantrip', { ti: 1, di: 0, to: 1 }, 'Cantrip (1)');
  }, D);
  const ls = await lp.evaluate(() => ({ log: JSON.parse(JSON.stringify(LOG)), total: compute(foldBuild(null), _dmOpts()).total, spent: economy(null).spent }));
  const lsEvs = post(ls);
  const norm = a => a.map(e => JSON.stringify([e.cat, e.payload, e.cost, e.gp, e.days])).sort();
  check('head to head: CharGen records the same purchases as the Live Sheet (category, payload, price, gold, downtime — order aside), the same total and the same spent',
    JSON.stringify(norm(cgEvs)) === JSON.stringify(norm(lsEvs)) && cg.total === ls.total && cg.spent === ls.spent, JSON.stringify({ cgN: cgEvs.length, lsN: lsEvs.length, totals: [cg.total, ls.total], spent: [cg.spent, ls.spent] }));
  check('...every purchase carries a frozen gold and downtime charge when the economy is on', cgEvs.every(e => typeof e.gp === 'number' && typeof e.days === 'number'), JSON.stringify(cgEvs.slice(0, 3)));
  await lp.close();

  // ---- decreases and everything else the Live Sheet cannot do are refused: nothing appended, nothing changed, the player told why ----
  const base0 = async () => { await fresh(); await setSel('hd', 5); await setSel('st_INT', 18); await setSel('budget', 400);
    await p.evaluate(t => replacePatchSlot(PATCH_SLOTS.TRADITIONS, { traditions: t }), START); await p.evaluate(() => cgFinishCreating(true)); await p.waitForTimeout(300); dialogs = []; };
  const refuseCase = async (what, fn, re, setup) => { await base0(); if (setup) await setup(); dialogs = []; const before = await snap(); await edit(fn, D); const after = await snap();
    check(`after the lock: ${what} is refused — nothing written`, after.log.length === before.log.length && after.spent === before.spent && JSON.stringify(after.trad) === JSON.stringify(before.trad), JSON.stringify({ n0: before.log.length, n1: after.log.length }));
    check('...and the player is told why', dialogs.some(d => re.test(d.msg)), JSON.stringify(dialogs.map(d => d.msg.slice(0, 70)))); };
  await refuseCase('lowering rank', c => { c[0].rank = 1; return c; }, /rank can only go up/);
  await refuseCase('lowering cantrips', c => { c[0].disciplines[0].cantrips = 0; return c; }, /Cantrips can only go up/);
  await refuseCase('lowering a slot', c => { c[0].disciplines[0].slots[0] = 0; return c; }, /Level 1 slots can only go up/);
  await refuseCase('lowering a known spell', c => { c[0].disciplines[0].known[0] = 0; return c; }, /known spells can only go up/);
  await refuseCase('removing a tradition', c => [], /can.t be removed or changed/);
  await refuseCase('renaming a tradition', c => { c[0].name = 'Divine'; return c; }, /can.t be removed or changed/);
  await refuseCase('removing a discipline', c => { c[0].disciplines = []; return c; }, /can.t be removed or changed/);
  await refuseCase('a level-3 slot without rank 3', c => { c[0].disciplines[0].slots[2] = 1; return c; }, /Level 3 spells need Arcane rank 3/);
  await refuseCase('a level-4 slot before the Hit Dice for it (rank 4 needs 7 Hit Dice; this character has 5)', c => { c[0].rank = 4; c[0].disciplines[0].slots[3] = 1; return c; }, /Level 4 spells need Arcane rank 4 and 7 Hit Dice/);
  await refuseCase('a known spell for a prepared caster', (c, D) => { c.push({ name: 'Primal', rank: 1, disciplines: [{ name: D.primalPrep, bound: false, cantrips: 0, slots: [0,0,0,0,0,0,0,0,0], known: [1,0,0,0,0,0,0,0,0], pactSlots: 0, arcanum: [0,0,0,0] }] }); return c; }, /prepares its spells/);
  await refuseCase('Magically Bound (it grants AP)', c => { c[0].disciplines[0].bound = true; return c; }, /gives you AP/);
  await refuseCase('Warlock pact slots (no purchase exists)', c => { c[0].disciplines[0].pactSlots = 1; return c; }, /pact slots and arcanum can.t be raised/);
  await refuseCase('a second discipline when the campaign allows only one', (c, D) => { c[0].disciplines.push({ name: D.arcane2, bound: false, cantrips: 0, slots: [0,0,0,0,0,0,0,0,0], known: [0,0,0,0,0,0,0,0,0], pactSlots: 0, arcanum: [0,0,0,0] }); return c; },
    /only allows a single discipline/, () => p.evaluate(() => { window._cloudCampaign = { name: 't', rules: { multiDisciplineAllowed: false } }; }));

  // a no-op is silent, and a reload of a locked spellcaster raises nothing
  await base0(); const n0 = (await snap()).log.length; await edit(c => c); check('writing the spellcasting the character already has is a silent no-op', dialogs.length === 0 && (await snap()).log.length === n0);

  // ---- campaign settings: drawbacks and the two bindings after the lock (owner decision X1, 2026-10-05) — refused by default, allowed per campaign, each by its own tickbox ----
  const withRules = r => p.evaluate(r => { window._cloudCampaign = { name: 't', rules: r }; }, r);
  const boundEdit = c => { c[0].disciplines[0].bound = true; return c; };
  const bindEv = s => post(s).filter(e => e.cat === 'dbound' || e.cat === 'mbound');
  await base0(); await withRules({ postLockBindings: true }); dialogs = [];
  await edit(boundEdit, D); const gb = await snap();
  check('postLockBindings on: Magically Bound is accepted as one +2 AP purchase, no refusal', bindEv(gb).length === 1 && bindEv(gb)[0].cat === 'dbound' && bindEv(gb)[0].cost === -2 && dialogs.length === 0, JSON.stringify({ ev: bindEv(gb), dialogs }));
  await base0(); await withRules({ postLockDrawbacks: true }); dialogs = [];
  await edit(boundEdit, D); const gb2 = await snap();
  check('only postLockDrawbacks on: Magically Bound is still refused (the tickboxes are separate)', bindEv(gb2).length === 0 && dialogs.some(d => /Magically Bound gives you AP/.test(d.msg)), JSON.stringify({ ev: bindEv(gb2), dialogs }));
  const martial = () => p.evaluate(() => { const el = document.getElementById('martiallyBound'); const oc = foldBuild(LOG).originClass; el.value = oc; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await base0(); await withRules({}); dialogs = []; await martial(); const gm0 = await snap();
  check('default: Martially Bound after the lock is refused', bindEv(gm0).length === 0 && dialogs.some(d => /give you AP/.test(d.msg)), JSON.stringify({ ev: bindEv(gm0), dialogs }));
  await base0(); await withRules({ postLockBindings: true }); dialogs = []; await martial(); const gm1 = await snap();
  check('postLockBindings on: Martially Bound is accepted as one +2 AP purchase', bindEv(gm1).length === 1 && bindEv(gm1)[0].cat === 'mbound' && bindEv(gm1)[0].cost === -2, JSON.stringify({ ev: bindEv(gm1), dialogs }));
  const drawTick = () => p.evaluate(() => { const v = Object.keys(DATA.drawbacks)[0]; const el = [...document.querySelectorAll('.drawck')].find(e => e.value === v); el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); return v; });
  const drawEv = s => post(s).filter(e => e.cat === 'drawback');
  await base0(); await withRules({ postLockBindings: true }); dialogs = []; await drawTick(); const gd0 = await snap();
  check('default (only bindings on): a new drawback after the lock is refused', drawEv(gd0).length === 0 && dialogs.some(d => /Drawbacks can.t be taken/.test(d.msg)), JSON.stringify({ ev: drawEv(gd0), dialogs }));
  await base0(); await withRules({ postLockDrawbacks: true }); dialogs = []; await drawTick(); const gd1 = await snap();
  check('postLockDrawbacks on: a new drawback is accepted and grants its AP', drawEv(gd1).length === 1 && drawEv(gd1)[0].cost < 0 && dialogs.length === 0, JSON.stringify({ ev: drawEv(gd1), dialogs }));
  // the Live Sheet, same locked character: refused by default, allowed by the same two settings
  await base0(); const lenv = await p.evaluate(() => JSON.stringify(_cgEnvelope(false)));
  const lp2 = await ctx.newPage(); const lsd = []; lp2.on('dialog', d => { lsd.push(d.message().slice(0, 90)); d.accept(); });
  await lp2.addInitScript(e => { try { localStorage.setItem('pactLiveSheet', e); } catch (x) {} }, lenv);
  await lp2.goto(`${base}/tools/PACT-Live-Char-Sheet.html`, { waitUntil: 'load' }); await lp2.waitForTimeout(2500);
  const lsPost = () => lp2.evaluate(() => JSON.parse(JSON.stringify(LOG)).filter(e => e.type === 'buy' && ['dbound', 'mbound', 'drawback'].indexOf(e.cat) >= 0).map(e => e.cat));
  const lsBuy = () => lp2.evaluate(D => { buy('dbound', { ti: 0, di: 0, v: true }, 'Magically Bound'); buy('mbound', { v: foldBuild(null).originClass }, 'Martially Bound'); buy('drawback', { v: Object.keys(DATA.drawbacks)[0] }, 'Drawback'); }, D);
  await lsBuy();
  check('Live Sheet, default: Magically Bound, Martially Bound and a drawback are all refused after the lock', (await lsPost()).length === 0 && lsd.length === 3, JSON.stringify({ ev: await lsPost(), lsd }));
  await lp2.evaluate(() => { window._rulesStatus = 'active'; window._cloudCampaignRules = { postLockBindings: true }; }); lsd.length = 0; await lsBuy();
  check('Live Sheet, postLockBindings only: both bindings go through, the drawback is still refused', JSON.stringify(await lsPost()) === JSON.stringify(['dbound', 'mbound']) && lsd.length === 1, JSON.stringify({ ev: await lsPost(), lsd }));
  await lp2.evaluate(() => { window._cloudCampaignRules = { postLockDrawbacks: true }; }); lsd.length = 0; await lsBuy();
  check('Live Sheet, postLockDrawbacks on: the drawback goes through', (await lsPost()).indexOf('drawback') >= 0, JSON.stringify({ ev: await lsPost(), lsd }));
  await lp2.close();

  // ---- property test: 300 random increase-only edits — the steps, applied to the current list, must reproduce the target exactly ----
  const prop = await p.evaluate(() => {
    let seed = 20261005; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; const ri = n => Math.floor(rnd() * (n + 1));
    const arcane = DATA.disc.Arcane, divine = DATA.disc.Divine, prepared = DATA.prepared || [], noC = DATA.noCantrip || [];
    const mkD = (name, rank) => ({ name, bound: false, cantrips: noC.indexOf(name) >= 0 ? 0 : ri(3), slots: Array.from({ length: 9 }, (_, i) => i + 1 <= rank ? ri(2) : 0), known: Array.from({ length: 9 }, (_, i) => (i + 1 <= rank && prepared.indexOf(name) < 0) ? ri(2) : 0), pactSlots: 0, arcanum: [0,0,0,0] });
    const mkT = (name, pool) => { const rank = ri(5); const n = 1 + ri(1); const names = pool.slice().sort(() => rnd() - 0.5).slice(0, n); return { name, rank, disciplines: names.map(d => mkD(d, rank)) }; };
    const grow = (t) => { const x = JSON.parse(JSON.stringify(t)); x.forEach(tr => { tr.rank = Math.min(9, tr.rank + ri(3)); tr.disciplines.forEach(d => { if (noC.indexOf(d.name) < 0) d.cantrips += ri(2); for (let L = 1; L <= 9; L++) { if (L <= tr.rank) { d.slots[L - 1] += ri(2); if (prepared.indexOf(d.name) < 0) d.known[L - 1] += ri(2); } } }); });
      if (rnd() < 0.4) { const pool = divine.filter(n => !x.some(tr => tr.disciplines.some(d => d.name === n))); if (pool.length && !x.some(tr => tr.name === 'Divine')) x.push({ name: 'Divine', rank: ri(3), disciplines: [mkD(pool[0], 3)] }); }
      if (rnd() < 0.4 && x[0]) { const have = x[0].disciplines.map(d => d.name); const more = (DATA.disc[x[0].name] || []).filter(n => have.indexOf(n) < 0); if (more.length) x[0].disciplines.push(mkD(more[0], x[0].rank)); }
      x.forEach(tr => tr.disciplines.forEach(d => { for (let L = 1; L <= 9; L++) { if (L > tr.rank) { d.slots[L - 1] = Math.min(d.slots[L - 1], 0); d.known[L - 1] = Math.min(d.known[L - 1], 0); } } })); return x; };
    let accepted = 0, refused = 0, bad = [];
    for (let n = 0; n < 300; n++) {
      const cur = [mkT('Arcane', arcane)]; if (rnd() < 0.3) cur.push(mkT('Divine', divine));
      const nxt = grow(cur);
      const r = _cgTraditionSteps(cur, nxt, 20, true);
      if (r.refuse) { refused++; if (!/need|only go up|doesn.t|already open|prepares/.test(r.refuse)) bad.push('unexpected refusal: ' + r.refuse); continue; }
      accepted++;
      const b = baseBuild(); b.traditions = JSON.parse(JSON.stringify(cur));
      r.steps.forEach(st => MUT[st.cat](b, st.payload));
      const norm = L => JSON.stringify(L.map(t => [t.name, t.rank, t.disciplines.map(d => [d.name, d.cantrips || 0, (d.slots || []).slice(0, 9), (d.known || []).slice(0, 9)])]));
      if (norm(b.traditions) !== norm(nxt)) bad.push('mismatch at ' + n + ': ' + norm(b.traditions).slice(0, 120) + ' vs ' + norm(nxt).slice(0, 120));
    }
    return { accepted, refused, bad: bad.slice(0, 3) };
  });
  check('property test: 300 random increase-only edits — every accepted edit\'s steps reproduce the target spell list exactly, and every refusal is a rule refusal', prop.bad.length === 0 && prop.accepted > 100, JSON.stringify(prop));

  const fatal = errs.filter(e => !/Failed to load|net::|supabase|fetch/i.test(e));
  check('no fatal page errors', fatal.length === 0, fatal.slice(0, 2).join(' | '));
  await ctx.close();
}

// fix/chargen-load-over-locked (found by the post-lock parity fuzz, 2026-10-05): loading a character into a tab that still holds a LOCKED one rebuilt the form's feature rows, each row tried to
// "buy" itself into the locked log, a refusal repainted the form, and the repaint rebuilt the rows again — a stack overflow (a regression from #573, live in v1.577). Painting a form must never
// buy or refuse anything.
section('CharGen: loading a character over a locked one neither overflows nor pops up a refusal');
{
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 120)));
  const dialogs = []; p.on('dialog', async d => { dialogs.push(d.message().slice(0, 100)); await d.accept(); });
  const fxDir = path.join(REPO, 'testing/fixtures/builds');
  const rd = f => { const raw = JSON.parse(fs.readFileSync(path.join(fxDir, f), 'utf8')); const b = raw.build || raw; b.budget = (b.budget || 79) + 60; return b; };
  const A = rd('CG-015-renamed-feature-aliases.json'), B = rd('CG-031-warlock-invocation-transitive-block.json');
  await p.goto(`${base}/tools/PACT-CharGen-Webtool.html`, { waitUntil: 'load' }); await p.waitForTimeout(2500);
  await p.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  const r = await p.evaluate(async ([a, b]) => { applyBuild(a); cgFinishCreating(true); try { applyBuild(b); return { ok: true, locked: _cgIsLocked(), feat: (foldBuild(LOG).features || []).slice(0, 6) }; } catch (e) { return { ok: false, err: String(e.message).slice(0, 80) }; } }, [A, B]);
  check('loading CG-031 over a locked CG-015 completes (it used to overflow the stack)', r.ok === true, JSON.stringify(r));
  check('...with no refusal popup and no page error', dialogs.length === 0 && errs.length === 0, JSON.stringify({ d: dialogs, e: errs }));
  check('...and the loaded character is the new one (a fresh, unlocked draft), not the old locked one', r.ok && r.locked === false, JSON.stringify(r));
  await ctx.close();
}

// fix/stale-autosave-guard (L2/L3): both tools' local autosave must record the cloud version it descends from
// (cloudBase; null = never synced), so a reload can prove a restored copy is current. Logic is covered in
// sync-concurrency-ci.mjs; this checks the tools actually write and survive restoring it.
section('local autosave records its cloud base (CharGen + Live Sheet)');
{
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  p.on('dialog', d=>d.accept());
  const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto(`${base}/tools/PACT-CharGen-Webtool.html`, {waitUntil:'load'});
  await p.waitForTimeout(2500);
  await p.evaluate(()=>{ _cgAutosave(); });
  const cg = await p.evaluate(()=>JSON.parse(localStorage.getItem('pactCharGenAutosaveV2')||'null'));
  check('CharGen autosave carries cloudBase (null = never synced)', !!cg && 'cloudBase' in cg && cg.cloudBase===null, JSON.stringify(cg&&cg.cloudBase));
  await p.reload({waitUntil:'load'}); await p.waitForTimeout(2500);
  const ok1 = await p.evaluate(()=>Array.isArray(LOG)&&LOG.length>0);
  check('CharGen restores that autosave and keeps working', ok1);
  await p.goto(`${base}/tools/PACT-Live-Char-Sheet.html`, {waitUntil:'load'});
  await p.waitForTimeout(2500);
  await p.evaluate(()=>{ save(); });
  const ls = await p.evaluate(()=>JSON.parse(localStorage.getItem('pactLiveSheet')||'null'));
  check('Live Sheet local copy carries cloudBase (null = never synced)', !!ls && 'cloudBase' in ls && ls.cloudBase===null, JSON.stringify(ls&&ls.cloudBase));
  await p.reload({waitUntil:'load'}); await p.waitForTimeout(2500);
  check('Live Sheet restores that copy and keeps working', await p.evaluate(()=>Array.isArray(LOG)));
  const fatal = errs.filter(e=>!/Failed to load|net::|supabase|fetch/i.test(e));
  check('no fatal page errors', fatal.length===0, fatal.slice(0,2).join(' | '));
  await ctx.close();
}

await browser.close(); server.close();
process.exit(fail?1:0);
