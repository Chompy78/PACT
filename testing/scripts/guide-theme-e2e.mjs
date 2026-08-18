#!/usr/bin/env node
/**
 * PACT — Players Guide theme-switcher gate.
 *
 * WHY THIS EXISTS. The guide is now ONE file shared by three homes: this repo's docs/, the
 * pact-guide authoring master on the home server, and the public pact-guide-public repo. Only
 * this repo has an index.html that writes localStorage['pact-theme'], so the guide carries its
 * own switcher — otherwise a reader in either of the other two homes is stuck on whatever their
 * OS dark-mode setting implies, with no way to change it.
 *
 * verify-guide.mjs checks the theme CSS is PRESENT (blocks, variables, no dangling var()). It
 * cannot tell whether clicking anything does something. This drives a real browser: every theme
 * applies, repaints, persists, marks its button, and survives a reload — plus the no-choice
 * defaults in both light and dark OS modes.
 *
 * Note the Parchment asymmetry: Parchment is the bare :root, so it is expressed by REMOVING
 * data-theme, not by setting data-theme="parchment". A switcher that set it would silently do
 * nothing, which is exactly the class of bug this asserts against.
 *
 * USAGE:  node testing/scripts/guide-theme-e2e.mjs
 */
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = 7987;   // distinct from the other gates' ports
const srv=http.createServer((q,r)=>{const rel=decodeURIComponent(q.url.split('?')[0]).replace(/^\/PACT\/?/,'')||'index.html';
  fs.readFile(path.join(REPO,rel),(e,d)=>{if(e){r.writeHead(404);return r.end('nf');}
    r.writeHead(200,{'Content-Type':rel.endsWith('.html')?'text/html':'text/plain','Cache-Control':'no-store'});r.end(d);});});
await new Promise(r=>srv.listen(PORT,r));
let pass=0,fail=0; const ck=(n,ok,d='')=>{ok?pass++:fail++;console.log(`  ${ok?'PASS':'FAIL'}  ${n}${d?' — '+d:''}`);};
const b=await launchChromium(); 
const url=`http://127.0.0.1:${PORT}/docs/PACT-Players-Guide.html`;

// 1. default (no saved choice, light OS)
let ctx=await b.newContext({colorScheme:'light'}); let p=await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto(url,{waitUntil:'load'});
ck('no page errors', errs.length===0, errs.slice(0,2).join(' | '));
ck('switcher renders 4 buttons', await p.locator('#themePick [data-theme-set]').count()===4);
ck('defaults to Parchment (no data-theme)', await p.evaluate(()=>!document.documentElement.getAttribute('data-theme')));
ck('Parchment shows as the active button', await p.getAttribute('[data-theme-set="parchment"]','aria-pressed')==='true');

// 2. each theme applies, persists, and actually repaints
for (const t of ['midnight','dragonfire','contrast','parchment']) {
  await p.click(`[data-theme-set="${t}"]`);
  const r = await p.evaluate(()=>({
    attr: document.documentElement.getAttribute('data-theme'),
    saved: localStorage.getItem('pact-theme'),
    bg: getComputedStyle(document.body).backgroundColor }));
  const expectAttr = t==='parchment' ? null : t;
  ck(`${t}: applies`, r.attr===expectAttr, `data-theme=${r.attr}`);
  ck(`${t}: persists to pact-theme`, r.saved===t, r.saved);
  ck(`${t}: body actually repaints`, !!r.bg, r.bg);
  ck(`${t}: button marked active`, await p.getAttribute(`[data-theme-set="${t}"]`,'aria-pressed')==='true');
}
// 3. the saved choice survives a reload (the pre-paint script reads it)
await p.click('[data-theme-set="dragonfire"]');
await p.reload({waitUntil:'load'});
ck('choice survives reload', await p.evaluate(()=>document.documentElement.getAttribute('data-theme'))==='dragonfire');
ck('and the button is still marked active after reload', await p.getAttribute('[data-theme-set="dragonfire"]','aria-pressed')==='true');
await ctx.close();

// 4. dark OS with no saved choice -> midnight (the head script's fallback, unchanged)
ctx=await b.newContext({colorScheme:'dark'}); p=await ctx.newPage();
await p.goto(url,{waitUntil:'load'});
ck('dark OS + no saved choice -> Midnight', await p.evaluate(()=>document.documentElement.getAttribute('data-theme'))==='midnight');
ck('and Midnight is the marked button', await p.getAttribute('[data-theme-set="midnight"]','aria-pressed')==='true');
await ctx.close();

console.log(`\n[guide-theme] ${fail?fail+' FAILED':'all '+pass+' checks passed'}`);
await b.close(); srv.close(); process.exit(fail?1:0);
