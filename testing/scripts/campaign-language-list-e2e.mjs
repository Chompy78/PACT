/* PACT — campaign language list e2e (feat/campaign-language-list, D-GH-2026-10-12-campaign-language-list).
 *
 * A campaign's rules.languages = {list, strict} replaces the language-name suggestions in the Live Sheet
 * and CharGen names dialogs, marks off-list names, and (strict) refuses a NEWLY named off-list language —
 * never one already locked into the character. DM Console's rules panel loads the setting.
 * No Supabase: the campaign rules are set on window directly, as each tool's cloud path would.
 *
 * Run: node testing/scripts/campaign-language-list-e2e.mjs   (expect 0 failed)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = 7991;
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css' };
const server = http.createServer((req,res)=>{
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/PACT\/?/,'') || 'index.html';
  fs.readFile(path.join(REPO, rel), (e,d)=>{ if(e){res.writeHead(404);return res.end('nf');}
    res.writeHead(200,{'Content-Type':MIME[path.extname(rel)]||'application/octet-stream'}); res.end(d); });
});
await new Promise(r=>server.listen(PORT,r));
let pass=0, fail=0;
const check=(n,ok,d='')=>{ ok?pass++:fail++; console.log(`  ${ok?'PASS':'FAIL'}  ${n}${d?' — '+d:''}`); };
const LIST = ['Haldeni','Orcish (Kaldrunic)','Elven (Aelvish)','Albric','Aurelani'];
const browser = await launchChromium();

async function open(tool){
  const page = await browser.newPage(); const errors=[];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://localhost:${PORT}/PACT/tools/${tool}`, { waitUntil:'load' });
  await page.waitForFunction(() => typeof window.campaignLanguages === 'function', null, { timeout: 20000 });
  await page.waitForTimeout(800);
  return { page, errors };
}
const flashText = p => p.evaluate(() => (document.getElementById('flashmsg')||{}).textContent || '');
const dlOpts = p => p.evaluate(() => [...document.querySelectorAll('#dl_lang option')].map(o => o.value));
const namesOpen = p => p.evaluate(() => { const b=document.getElementById('namesBox'); return !!(b && b.offsetParent); });

// ---------- DM Console ----------
{
  const { page, errors } = await open('DM-Console.html');
  await page.evaluate(L => window._dmRulesPanel.load({ languages:{ list:L, strict:true } }), LIST);
  check('DM: textarea shows the campaign list', (await page.inputValue('#ruleLanguages')) === LIST.join('\n'));
  check('DM: strict box ticked', await page.isChecked('#ruleLanguagesStrict'));
  check('DM: count line', /5 languages/.test(await page.textContent('#ruleLanguagesCount')));
  check('DM: controls start locked', await page.isDisabled('#ruleLanguages'));
  await page.evaluate(() => window._dmRulesPanel.load({}));
  check('DM: untouched campaign = empty box + standard note', (await page.inputValue('#ruleLanguages')) === '' &&
        /standard list/.test(await page.textContent('#ruleLanguagesCount')) && !(await page.isChecked('#ruleLanguagesStrict')));
  check('DM: no page errors', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ---------- Live Sheet ----------
{
  const { page, errors } = await open('PACT-Live-Char-Sheet.html');
  await page.evaluate(L => { window._rulesStatus='active'; window._cloudCampaignRules={ languages:{ list:L, strict:true } }; }, LIST);
  await page.evaluate(() => openNames());
  check('LS: suggestions are the campaign list', JSON.stringify(await dlOpts(page)) === JSON.stringify(LIST), JSON.stringify(await dlOpts(page)));
  check('LS: campaign list line shown', /only these are allowed/.test(await page.textContent('#namesBox')));
  await page.fill('#namesBox .nmf[data-k="lang::0"]', 'Common');
  await page.evaluate(() => saveNames());
  check('LS: strict refuses new off-list "Common"', /isn.t on your campaign/.test(await flashText(page)) && await namesOpen(page), await flashText(page));
  await page.fill('#namesBox .nmf[data-k="lang::0"]', 'haldeni');
  await page.evaluate(() => saveNames());
  const names = await page.evaluate(() => foldBuild(null).languageNames);
  check('LS: listed name (any case) saves', JSON.stringify(names) === '["haldeni"]', JSON.stringify(names));
  // Switching strict off on reopen: the saved name is now locked (readonly), so it can't be changed either way.
  await page.evaluate(L => { window._cloudCampaignRules={ languages:{ list:L } }; }, LIST);
  await page.evaluate(() => openNames());
  check('LS: locked row is readonly', await page.evaluate(() => document.querySelector('#namesBox .nmf[data-k="lang::0"]').readOnly));
  await page.evaluate(() => closeNames && closeNames());
  check('LS: no page errors', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ---------- Live Sheet: grandfathered locked off-list name under strict ----------
{
  const { page, errors } = await open('PACT-Live-Char-Sheet.html');
  await page.evaluate(() => openNames());
  await page.fill('#namesBox .nmf[data-k="lang::0"]', 'Common');
  await page.evaluate(() => saveNames());          // no campaign: standard list, saves freely
  await page.evaluate(L => { window._rulesStatus='active'; window._cloudCampaignRules={ languages:{ list:L, strict:true } }; }, LIST);
  await page.evaluate(() => openNames());
  check('LS: old locked "Common" is flagged', /Not on this campaign/.test(await page.textContent('#namesBox')));
  await page.evaluate(() => saveNames());
  check('LS: old locked "Common" does not block saving', !/isn.t on your campaign/.test(await flashText(page)), await flashText(page));
  check('LS2: no page errors', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ---------- CharGen ----------
{
  const { page, errors } = await open('PACT-CharGen-Webtool.html');
  await page.evaluate(() => openNames());
  check('CG: no campaign = standard list', (await dlOpts(page))[0] === 'Common');
  await page.fill('#namesBox .nmf[data-k="lang::0"]', 'Common');
  await page.evaluate(() => saveNames());
  await page.evaluate(L => { window._cloudCampaign={ id:'x', name:'T', rules:{ languages:{ list:L, strict:true } } }; }, LIST);
  await page.evaluate(() => openNames());
  check('CG: suggestions are the campaign list', JSON.stringify(await dlOpts(page)) === JSON.stringify(LIST));
  check('CG: existing "Common" flagged', /Not on this campaign/.test(await page.textContent('#namesBox')));
  await page.evaluate(() => saveNames());
  check('CG: unchanged "Common" does not block save', !/isn.t on your campaign/.test(await flashText(page)), await flashText(page));
  await page.evaluate(() => openNames());
  await page.fill('#namesBox .nmf[data-k="lang::0"]', 'Draconic');
  await page.evaluate(() => saveNames());
  check('CG: strict refuses new off-list "Draconic"', /isn.t on your campaign/.test(await flashText(page)), await flashText(page));
  await page.fill('#namesBox .nmf[data-k="lang::0"]', 'Albric');
  await page.evaluate(() => saveNames());
  check('CG: listed name saves', await page.evaluate(() => CG_NAMES.lang[0]) === 'Albric');
  check('CG: no page errors', errors.length === 0, errors.join(' | '));
  await page.close();
}

await browser.close(); server.close();
console.log(`\n${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
