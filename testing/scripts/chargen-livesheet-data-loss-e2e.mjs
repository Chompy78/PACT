#!/usr/bin/env node
/**
 * PACT — CharGen data-loss gate (fix/chargen-livesheet-data-loss, audit 2026-10-12).
 *
 * Six ways CharGen silently lost saved work, or wrote it to the wrong character. One section each:
 *   1. names      — "Name spells & languages" lived only in a page global: lost on reload, and leaked into
 *                   the NEXT character (New Character / load / #b= / Randomize), epic-boon choices included.
 *   2. file save  — Local Save wrote back to the previously opened file after a cloud load / handoff /
 *                   refused load, overwriting a different character's file.
 *   3. awards     — opening a Live Sheet character merged every award into one "Budget" line (notes lost).
 *   4. ✕ refused  — after the lock, ✕ deleted a feature row while the LOG kept (and charged) it; a retyped
 *                   row was then charged as a second purchase.
 *   5. Elf + Elf  — a second species equal to the first was cleared on screen but kept (and charged) in the LOG.
 *   6. house rules— DM custom boons/drawbacks lived only in a page global: lost on reload, unpriced by compute().
 *
 * No Supabase stack needed. Run: node testing/scripts/chargen-livesheet-data-loss-e2e.mjs   (expect 0 failed)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = 7993;
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
const section=t=>console.log(`\n[data-loss] == ${t} ==`);
const browser = await launchChromium();
const CG = `http://localhost:${PORT}/PACT/tools/PACT-CharGen-Webtool.html`;

async function fresh(){
  const ctx = await browser.newContext();
  const p = await ctx.newPage(); const errs=[];
  p.on('pageerror', e=>errs.push(String(e)));
  p.on('dialog', d=>d.accept());
  await p.goto(CG, {waitUntil:'load'});
  await p.waitForFunction(()=>typeof foldBuild==='function' && typeof LOG!=='undefined' && LOG.length>0, null, {timeout:20000});
  await p.waitForTimeout(800);
  return { ctx, p, errs };
}
const setSel = (p,id,v)=>p.evaluate(([id,v])=>{ const e=document.getElementById(id); e.value=String(v); e.dispatchEvent(new Event('change',{bubbles:true})); }, [id,v]).then(()=>p.waitForTimeout(250));
const reload = async p=>{ await p.evaluate(()=>_cgAutosave()); await p.reload({waitUntil:'load'});
  await p.waitForFunction(()=>typeof foldBuild==='function' && LOG.length>0, null, {timeout:20000}); await p.waitForTimeout(800); };

// -------------------------------------------------------------------------------------------------
section('1. spell & language names');
{
  const { ctx, p, errs } = await fresh();
  await p.evaluate(()=>openNames());
  await p.fill('#namesBox .nmf[data-k="lang::0"]', 'Elvish');
  await p.evaluate(()=>saveNames());
  check('saved name is a `names` event in the LOG', await p.evaluate(()=>LOG.some(e=>e.type==='names' && (e.lang||[])[0]==='Elvish')));
  await reload(p);
  check('name survives a reload', await p.evaluate(()=>(readBuild().languageNames||[])[0]) === 'Elvish');
  await p.evaluate(()=>openNames());
  check('dialog re-opens seeded from the LOG', await p.inputValue('#namesBox .nmf[data-k="lang::0"]') === 'Elvish');
  await p.evaluate(()=>closeNames());
  // An epic-boon ability choice (set by the Live Sheet) must not leak into the next character either.
  await p.evaluate(()=>emit({type:'names',eb:{'Boon of Combat Prowess':'STR'},cost:0,label:'eb'}));
  await p.evaluate(()=>resetBuild());
  await p.waitForTimeout(400);
  const nb = await p.evaluate(()=>{ const b=readBuild(); return {lang:b.languageNames||[], eb:b.epicBoonAbil||{}, ev:LOG.filter(e=>e.type==='names').length}; });
  check('New Character carries no names from the previous one', nb.lang.filter(Boolean).length===0 && nb.ev===0, JSON.stringify(nb));
  check('New Character carries no epic-boon choice from the previous one', Object.keys(nb.eb).length===0, JSON.stringify(nb.eb));
  await p.evaluate(()=>openNames());
  check('New Character dialog starts blank', await p.inputValue('#namesBox .nmf[data-k="lang::0"]') === '');
  await p.evaluate(()=>closeNames());
  check('no page errors', errs.length===0, errs.join(' | '));
  await ctx.close();
}

// -------------------------------------------------------------------------------------------------
section('2. Local Save never writes another character\'s file');
{
  const { ctx, p, errs } = await fresh();
  // A fake File System Access handle that records every write.
  await p.evaluate(()=>{
    window.__writes = {};
    window.__mkHandle = (name, text) => ({ name,
      getFile: async () => new File([text], name, {type:'application/json'}),
      createWritable: async () => ({ write: async d => { (window.__writes[name]=window.__writes[name]||[]).push(String(d)); }, close: async()=>{} }) });
    window.showSaveFilePicker = async () => window.__mkHandle('picked-new.json','');
  });
  // Open file A through the picker (character A).
  await setSel(p,'cname','Alpha');
  const envA = await p.evaluate(()=>JSON.stringify(_cgEnvelope(false)));
  await p.evaluate(t=>{ window.showOpenFilePicker = async () => [window.__mkHandle('alpha.json', t)]; }, envA);
  await p.evaluate(()=>loadViaPicker());
  await p.waitForTimeout(800);
  await p.evaluate(()=>saveBuild()); await p.waitForTimeout(300);
  check('control: Save after opening alpha.json writes back to it', ((await p.evaluate(()=>window.__writes['alpha.json']))||[]).length===1);
  // Now switch to a different character the way a cloud load / handoff does (a different id).
  await p.evaluate(()=>{ const env=JSON.parse(JSON.stringify(_cgEnvelope(false))); env.id='other-'+Date.now(); env.name='Bravo';
    env.LOG=env.LOG.map(e=>e.type==='name'?Object.assign({},e,{name:'Bravo'}):e); _cgApplyEnvelope(env,{clearHistory:true}); });
  await p.waitForTimeout(400);
  await p.evaluate(()=>saveBuild()); await p.waitForTimeout(300);
  const wA = (await p.evaluate(()=>window.__writes['alpha.json']))||[];
  check('Save after switching character does not touch alpha.json', wA.length===1, wA.length+' writes');
  check('…it asks for a new file instead', ((await p.evaluate(()=>window.__writes['picked-new.json']))||[]).length===1);
  // A refused load must not adopt the file it refused.
  await p.evaluate(()=>{ window.showOpenFilePicker = async () => [window.__mkHandle('broken.json', JSON.stringify({schema:'pact-character/1'}))]; });
  await p.evaluate(()=>loadViaPicker()); await p.waitForTimeout(600);
  await p.evaluate(()=>{ window.showSaveFilePicker = async () => window.__mkHandle('picked-2.json',''); });
  await p.evaluate(()=>saveBuild()); await p.waitForTimeout(300);
  check('a refused load does not become the Save target', ((await p.evaluate(()=>window.__writes['broken.json']))||[]).length===0);
  check('no page errors', errs.length===0, errs.join(' | '));
  await ctx.close();
}

// -------------------------------------------------------------------------------------------------
section('3. awards keep their notes through a Live Sheet -> CharGen handoff');
{
  const { ctx, p, errs } = await fresh();
  const uid = await p.evaluate(()=>{
    const L=JSON.parse(JSON.stringify(LOG)).filter(e=>e.type!=='award');
    let s=nextSeq(L);
    L.unshift({type:'award',amount:79,note:'Starting AP',label:'Award',seq:s++,ts:1});
    L.push({type:'award',amount:6,note:'Session 3 — dragon hoard',label:'Award',seq:s++,ts:2});
    return writeHandoff({source:'livesheet',LOG:L,SEQ:s,rules:DATA.version,id:'ls-award-test'});
  });
  await p.goto(CG+'?handoff='+encodeURIComponent(uid), {waitUntil:'load'});
  await p.waitForFunction(()=>typeof foldBuild==='function' && LOG.length>0, null, {timeout:20000}); await p.waitForTimeout(1000);
  const aw = await p.evaluate(()=>LOG.filter(e=>e.type==='award').map(e=>e.note));
  check('both awards survive the handoff', aw.length===2, JSON.stringify(aw));
  check('award notes kept', aw.includes('Session 3 — dragon hoard') && aw.includes('Starting AP'), JSON.stringify(aw));
  check('budget field shows their sum', +(await p.inputValue('#budget')) === 85, await p.inputValue('#budget'));
  await setSel(p,'budget','90');
  const aw2 = await p.evaluate(()=>LOG.filter(e=>e.type==='award').length);
  check('editing the budget does not merge the awards', aw2===2, aw2+' awards');
  check('…and the field goes back to their sum', +(await p.inputValue('#budget')) === 85, await p.inputValue('#budget'));
  check('no page errors', errs.length===0, errs.join(' | '));
  await ctx.close();
}

// -------------------------------------------------------------------------------------------------
section('4. a refused ✕ after the lock puts the row back');
{
  const { ctx, p, errs } = await fresh();
  await setSel(p,'oclass','Fighter');
  const F1='Fighter: Second Wind', F2='Fighter: Fighting Style';
  await p.evaluate(f=>{ addRow('feat2',f); const r=[...document.querySelectorAll('.feat2row')].pop(); r.dispatchEvent(new Event('input',{bubbles:true})); }, F1);
  await p.waitForTimeout(300);
  const featEvents = ()=>p.evaluate(()=>LOG.filter(e=>e.type==='buy'&&e.cat==='feature').map(e=>e.payload.v));
  check('control: feature bought', (await featEvents()).includes(F1));
  await p.evaluate(()=>cgFinishCreating(true)); await p.waitForTimeout(400);
  const spent0 = await p.evaluate(()=>economy(LOG).spent);
  const rowVals = ()=>p.evaluate(()=>[...document.querySelectorAll('.feat2row')].map(x=>x.value));
  // Retype the row to another feature: the old one cannot be removed, so the new one must not be bought on top.
  await p.evaluate(([a,b])=>{ const r=[...document.querySelectorAll('.feat2row')].find(x=>x.value===a); if(!r) return; r.value=b; r.dispatchEvent(new Event('input',{bubbles:true})); }, [F1,F2]);
  await p.waitForTimeout(500);
  let fe = await featEvents();
  check('retyped row is not charged a second time', fe.length===1 && fe[0]===F1, JSON.stringify(fe));
  check('…the row shows the kept purchase again', JSON.stringify(await rowVals())===JSON.stringify([F1]), JSON.stringify(await rowVals()));
  check('spent unchanged after retype', (await p.evaluate(()=>economy(LOG).spent))===spent0);
  // ✕ on the kept row.
  await p.evaluate(f=>{ const r=[...document.querySelectorAll('.feat2row')].find(x=>x.value===f); if(r) r.closest('.line').querySelector('.btn.x').click(); }, F1);
  await p.waitForTimeout(500);
  const rows = await rowVals();
  check('refused ✕: row is back on the form', rows.includes(F1), JSON.stringify(rows));
  fe = await featEvents();
  check('refused ✕: LOG still holds it once', fe.filter(v=>v===F1).length===1, JSON.stringify(fe));
  check('spent unchanged after ✕', (await p.evaluate(()=>economy(LOG).spent))===spent0);
  check('no page errors', errs.length===0, errs.join(' | '));
  await ctx.close();
}

// -------------------------------------------------------------------------------------------------
section('5. Elf + Elf clears to (none) in the LOG, not only on screen');
{
  const { ctx, p, errs } = await fresh();
  await setSel(p,'spec','Human');
  await setSel(p,'spec2','Elf');
  const withElf2 = await p.evaluate(()=>compute(readBuild()).total);
  await setSel(p,'spec','Elf');
  const st = await p.evaluate(()=>{ const b=readBuild(); return {s:b.species,s2:b.species2,dom:document.getElementById('spec2').value}; });
  check('screen shows (none) for the 2nd species', st.dom==='(none)', JSON.stringify(st));
  check('LOG agrees: 2nd species (none)', st.s==='Elf' && (st.s2==='(none)'||!st.s2), JSON.stringify(st));
  const elfOnly = await p.evaluate(()=>{ const b=JSON.parse(JSON.stringify(readBuild())); b.species2='(none)'; return compute(b).total; });
  check('charged as one Elf', (await p.evaluate(()=>compute(readBuild()).total))===elfOnly, `${withElf2} / ${elfOnly}`);
  check('no page errors', errs.length===0, errs.join(' | '));
  await ctx.close();
}

// -------------------------------------------------------------------------------------------------
section('6. a DM custom boon survives reload and prices in compute()');
{
  const { ctx, p, errs } = await fresh();
  await p.evaluate(()=>{ document.getElementById('dmkind').value='boon'; document.getElementById('dmname').value='Test Favour';
    document.getElementById('dmap').value='3'; const h=document.getElementById('dmhd'); if(h) h.value='1'; document.getElementById('dmdesc').value='x'; dmAdd(); });
  await p.waitForTimeout(300);
  check('custom boon is in the LOG\'s house rules', await p.evaluate(()=>!!((readBuild().houseRules||{}).boons||{})['Test Favour']));
  const t0 = await p.evaluate(()=>compute(readBuild()).total);
  await p.evaluate(()=>{ const e=[...document.querySelectorAll('.boonck')].find(x=>x.value==='Test Favour'); e.checked=true; e.dispatchEvent(new Event('change',{bubbles:true})); });
  await p.waitForTimeout(300);
  await reload(p);
  const r = await p.evaluate(()=>{ const b=readBuild(); return { def:!!((b.houseRules||{}).boons||{})['Test Favour'], owned:(b.boons||[]).includes('Test Favour'), total:compute(b).total }; });
  check('custom boon definition survives a reload', r.def, JSON.stringify(r));
  check('…and is still owned', r.owned, JSON.stringify(r));
  check('compute(foldBuild(LOG)) prices it at 3 AP', r.total - t0 === 3, `${t0} -> ${r.total}`);
  // Disabling a built-in persists too.
  await p.evaluate(()=>dmToggleDisable('boon','Boon of Combat Prowess'));
  await reload(p);
  check('a disabled built-in survives a reload', await p.evaluate(()=>(((readBuild().houseRules||{}).disabled||{}).boons||[]).includes('Boon of Combat Prowess')));
  // Undo takes a house-rule edit back.
  await p.evaluate(()=>dmToggleDisable('boon','Boon of Combat Prowess'));
  await p.evaluate(()=>undo()); await p.waitForTimeout(300);
  check('undo restores the house rule', await p.evaluate(()=>(HOUSE.disabled.boons||[]).includes('Boon of Combat Prowess') && (((readBuild().houseRules||{}).disabled||{}).boons||[]).includes('Boon of Combat Prowess')));
  check('no page errors', errs.length===0, errs.join(' | '));
  await ctx.close();
}

await browser.close(); server.close();
console.log(`\n${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
