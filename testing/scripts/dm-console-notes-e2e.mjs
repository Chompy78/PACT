#!/usr/bin/env node
/**
 * PACT — DM Console "Appearance & backstory" gate (feat/dm-console-character-notes).
 *
 * WHY THIS EXISTS. A player's description and backstory live in the LOG as foldBuild(LOG).appearance, and
 * DM Console now shows them read-only on the character card (a collapsible .sec) and in the table-view
 * detail (a <details>). That text is written by ANOTHER user and rendered in the DM's browser, so it is a
 * stored-XSS path unless every value is escaped (AGENTS.md esc() rule). This gate loads:
 *   - a character whose backstory (and a custom label) is an <img onerror> payload,
 *   - a character with an ordinary two-line backstory and a few description fields,
 *   - a character with no appearance at all,
 * through the cloud roster card, the local file-import card and the table-view detail, and asserts the
 * payload shows as literal text with window.__xss unset, the normal backstory is visible with its line
 * break kept, and the block is absent when nothing is filled. No Supabase needed (same seams as
 * ledger-xss-e2e.mjs).
 *
 * USAGE:  node testing/scripts/dm-console-notes-e2e.mjs        (PORT env var overrides 7991)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = Number(process.env.PORT) || 7991;
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
const URL_DM = `http://localhost:${PORT}/PACT/tools/DM-Console.html`;

let pass=0, fail=0;
const check=(n,ok,d='')=>{ ok?pass++:fail++; console.log(`  ${ok?'PASS':'FAIL'}  ${n}${ok||!d?'':' — '+d}`); };

const P = '<img src=x onerror=window.__xss=1>';
const NORMAL_1 = 'Grew up on the Saltmarsh docks.', NORMAL_2 = 'Joined the watch after the fire.';
const env = (id, name, appearance) => {
  const LOG = [
    { seq:1, type:'award', amount:100, label:'Award — budget', rules:'v0.350', ts:1782635065907 },
    { seq:2, type:'name', name, label:'Name — '+name, rules:'v0.350' },
    { seq:3, type:'buy', cat:'stat', cost:1, label:'STR +1', rules:'v0.350', payload:{ stat:'STR', delta:1 } },
  ];
  if (appearance) LOG.push({ seq:4, type:'buy', cat:'patch', cost:0, label:'Appearance & description (0 AP)', _slot:'appearance',
                             rules:'v0.350', payload:{ patch:{ appearance } } });
  return { schema:'pact-character/1', rules:'v0.350', name, id, SEQ:LOG.length+1, LOG };
};
const ENV_XSS  = env('xss-notes', 'Xss Notes', { backstory: P + '\nsecond line', playerName: P, custom1Label: P, custom1Text: 'x', hair: '' });
const ENV_OK   = env('ok-notes', 'Ok Notes', { backstory: NORMAL_1 + '\n' + NORMAL_2, playerName: 'Alice', alignment: 'NG', hair: 'Red', eyes: '  ' });
const ENV_NONE = env('none-notes', 'None Notes', null);
const ROWS = [ENV_XSS, ENV_OK, ENV_NONE].map(e => ({ id:e.id, name:e.name, stats:e, ap:0, player:'', playerLabel:'', dmNotes:'' }));
const file = (n,o) => ({ name:n+'.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(o)) });

const browser = await launchChromium();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('dialog', d => d.accept().catch(()=>{}));
const settle = () => page.evaluate(() => new Promise(r => setTimeout(r, 250)));

// The Appearance & backstory section of the card for character `nm` inside `root`: {found, text, html, open}.
const cardSec = (root, nm) => page.evaluate(([root, nm]) => {
  const cards = [...document.querySelectorAll(root+' .card')].filter(c => (c.querySelector('.cname')||{}).textContent?.indexOf(nm) === 0);
  const card = cards[0]; if (!card) return { card:false };
  const sec = [...card.querySelectorAll('.sec')].find(s => (s.querySelector('.sectitle')||{}).textContent === 'Appearance & backstory');
  if (!sec) return { card:true, found:false };
  const body = sec.querySelector('.secbody');
  return { card:true, found:true, text: body.textContent, html: body.innerHTML, imgs: body.querySelectorAll('img').length, brs: body.querySelectorAll('br').length };
}, [root, nm]);

try {
  await page.goto(URL_DM, { waitUntil:'load' });
  await page.waitForFunction(() => !!window._campBridge && typeof window._dmRenderCloudRoster === 'function', { timeout:20000 });

  // ============== cloud roster card (the path a real DM hits) ==============
  console.log('\n[dm-notes] cloud roster card');
  await page.evaluate(rows => {
    const d=document.createElement('div'); d.id='__roster'; document.body.appendChild(d);
    window._dmRenderCloudRoster(d, rows);
  }, ROWS);
  await settle();
  let x = await cardSec('#__roster', 'Xss Notes');
  check('XSS character: card rendered', x.card);
  check('XSS character: Appearance & backstory section present', x.found);
  check('XSS character: backstory payload shown as literal text', !!x.text && x.text.indexOf(P) !== -1, x.text);
  check('XSS character: player-name and custom-label payloads shown as text', !!x.text && x.text.split(P).length - 1 >= 3, x.text);
  check('XSS character: no <img> element created', x.imgs === 0);
  let o = await cardSec('#__roster', 'Ok Notes');
  check('normal character: section present', o.found);
  check('normal character: both backstory lines visible', !!o.text && o.text.indexOf(NORMAL_1) !== -1 && o.text.indexOf(NORMAL_2) !== -1, o.text);
  check('normal character: the newline is kept as a <br>', !!o.html && o.html.indexOf(NORMAL_1 + '<br>' + NORMAL_2) !== -1, o.html);
  check('normal character: description fields labelled like Live Sheet', !!o.text && /Player name:\s*Alice/.test(o.text) && /Alignment:\s*NG/.test(o.text) && /Hair:\s*Red/.test(o.text), o.text);
  check('normal character: blank / whitespace-only keys skipped', !!o.text && o.text.indexOf('Eyes') === -1 && o.text.indexOf('Gender') === -1, o.text);
  check('normal character: no edit control in the section', await page.evaluate(() => {
    const c=[...document.querySelectorAll('#__roster .card')].find(c => /^Ok Notes/.test(c.querySelector('.cname').textContent)); if(!c) return false;
    const s=[...c.querySelectorAll('.sec')].find(s => s.querySelector('.sectitle').textContent==='Appearance & backstory');
    return !!s && !s.querySelector('input, textarea, button, [contenteditable]');
  }));
  let n = await cardSec('#__roster', 'None Notes');
  check('empty character: card rendered', n.card);
  check('empty character: section hidden when nothing is filled', n.card && !n.found);
  // collapsible: closed by default, opens on its header click (the delegated .secrow toggle)
  check('section starts collapsed', await page.evaluate(() => {
    const s=[...document.querySelectorAll('#__roster .sec')].find(s => s.querySelector('.sectitle').textContent==='Appearance & backstory');
    return !!s && !s.classList.contains('open');
  }));

  // ============== table-view detail (renderCards → detailHTML) ==============
  console.log('\n[dm-notes] table-view detail');
  for (const [idx, nm] of [[0,'Xss Notes'],[1,'Ok Notes'],[2,'None Notes']]) {
    await page.evaluate(([rows, i]) => window._dmRenderCardsTest(rows, i), [ROWS, idx]);
    await settle();
    const d = await page.evaluate(() => {
      const det = document.querySelector('#cards details.appdetails');
      return det ? { found:true, open: det.open, text: det.textContent, imgs: det.querySelectorAll('img').length } : { found:false };
    });
    if (nm === 'None Notes') { check('table detail: hidden for the empty character', !d.found); continue; }
    check(`table detail (${nm}): <details> present and collapsed`, d.found && d.open === false);
    if (nm === 'Xss Notes') check('table detail: payload shown as text, no <img>', d.found && d.text.indexOf(P) !== -1 && d.imgs === 0, d.text);
    else check('table detail: normal backstory visible', d.found && d.text.indexOf(NORMAL_1) !== -1 && d.text.indexOf(NORMAL_2) !== -1, d.text);
  }

  // ============== local file import card ==============
  console.log('\n[dm-notes] local file import');
  await page.setInputFiles('#fileInput', [file('xss', ENV_XSS), file('ok', ENV_OK)]);
  await page.waitForFunction(() => document.querySelectorAll('#grid .card').length >= 2, { timeout:8000 }).catch(()=>{});
  await settle();
  x = await cardSec('#grid', 'Xss Notes');
  check('imported XSS card: payload shown as text, no <img>', x.found && x.text.indexOf(P) !== -1 && x.imgs === 0, JSON.stringify(x).slice(0,200));
  o = await cardSec('#grid', 'Ok Notes');
  check('imported normal card: backstory visible', o.found && o.text.indexOf(NORMAL_2) !== -1);

  check('window.__xss never set', (await page.evaluate(() => window.__xss)) === undefined, 'payload executed');
  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  console.error('\n✗ harness error:', e && e.stack || e);
  fail++;
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${fail===0?'✓':'✗'} ${pass} passed / ${fail} failed`);
process.exit(fail===0?0:1);
