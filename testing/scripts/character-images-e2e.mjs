/* PACT — character pictures in the real tools (feat/character-images, D-GH-2026-10-15-character-images).
 *
 * WHAT IT PROVES, in a real browser against the real tool files and the real js/character-images.js:
 *   Live Sheet — a signed-in owner adds a picture (it is shrunk to ≤1600 px WebP, ≤2 MB, before upload), adds a
 *     second, cannot add a third (the button goes, and the module refuses one even when asked directly), replaces
 *     one (an upsert on the same slot), removes one (after a confirm), and is told plainly when the file type is
 *     wrong. The 📋 Sheet shows the same pictures. The character's LOG is byte-identical before and after — pictures
 *     never enter the save. The DM's read-only view shows the pictures with no edit buttons. Signed out: a hint, no
 *     upload control. A server without the storage migration gets a plain "not switched on yet" message.
 *   Safety — a signed url that is not this project's storage sign route is never rendered; a hostile character id
 *     in the placeholder attribute is escaped (no injected element).
 *   CharGen — the Setup panel's appearance area shows an existing picture with Replace/Remove/Add controls.
 *   DM Console — every cloud card gets read-only thumbnails, and a whole roster is ONE signed-url request.
 *
 * The cloud is stubbed (no network): the vendored supabase-js is replaced by a fake client with a signed-in
 * session and an in-memory Storage bucket; signed urls are answered with a tiny PNG. WHO may read or write is
 * the database's job and is tested against real Postgres in testing/scripts/creation-lock-guard-test/run-images.sh.
 * Run:  node testing/scripts/character-images-e2e.mjs     (expect 0 failed; exits non-zero otherwise)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './lib/launch-chromium.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = Number(process.env.PACT_E2E_PORT) || 7998;
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json',
               '.css':'text/css','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml' };
const server = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/PACT\/?/, '') || 'index.html';
  fs.readFile(path.join(REPO, rel), (e, d) => {
    if (e) { r.writeHead(404); return r.end('not found'); }
    r.writeHead(200, { 'Content-Type': MIME[path.extname(rel)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    r.end(d);
  });
});
await new Promise(r => server.listen(PORT, r));

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

const SUPA = 'https://piuprrrnaotrtxucrtsb.supabase.co';
const UID = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'aaaaaaaa-0000-4000-8000-000000000002';
const C = 'aaaaaaaa-0000-4000-8000-000000000003';
const D = 'aaaaaaaa-0000-4000-8000-000000000004';
const E = 'aaaaaaaa-0000-4000-8000-000000000005';   // someone else's character (the DM / a fellow player sees it)
const F = 'aaaaaaaa-0000-4000-8000-000000000006';   // a uuid never saved to the cloud (no row)
const OTHER = '22222222-2222-4222-8222-222222222222';

// A fake supabase-js: signed-in (unless window.__sbSignedOut is set before load), an in-memory Storage bucket
// (window.__sb.store: path -> {type,size,width,height,n}), and every other call a harmless empty answer.
const STUB = `
const SUPA = ${JSON.stringify(SUPA)};
const sb = window.__sb = window.__sb || { store: {}, uploads: [], signCalls: [], removes: [] };
// characters rows the signed-in user can see: id -> owner_id (F has no row)
sb.owners = sb.owners || ${JSON.stringify({ [A]: UID, [B]: UID, [C]: UID, [D]: UID, [E]: OTHER })};
function from(table) {
  let ids = null;
  const h = { get(_t, p) {
      if (p === 'then') { const r = (table === 'characters' && ids) ? { data: ids.filter(i => sb.owners[i]).map(i => ({ id: i, owner_id: sb.owners[i] })), error: null } : { data: [], error: null };
        return (res, rej) => Promise.resolve(r).then(res, rej); }
      if (p === 'catch' || p === 'finally') return (cb) => Promise.resolve({ data: [], error: null })[p](cb);
      return (...a) => { if (p === 'in' && a[0] === 'id') ids = a[1]; return px; }; } };
  const px = new Proxy({}, h);
  return px;
}
function chain(result) {
  const h = { get(_t, p) {
      if (p === 'then') return (res, rej) => Promise.resolve(result).then(res, rej);
      if (p === 'catch' || p === 'finally') return (cb) => Promise.resolve(result)[p](cb);
      return chain(result); },
    apply() { return chain(result); } };
  return new Proxy(function () {}, h);
}
const session = () => window.__sbSignedOut ? null : { access_token: 't', user: { id: ${JSON.stringify(UID)}, email: 'p@example.test' } };
const err = (message, statusCode) => ({ data: null, error: { message, statusCode } });
const bucketApi = (bucket) => ({
  async upload(path, blob, opts) {
    if (window.__sbBucketMissing) return err('Bucket not found', '404');
    if (!/^[0-9a-f-]{36}\\/[12]$/.test(path) || window.__sbDenyWrites) return err('new row violates row-level security policy', '403');
    (sb.attempts = sb.attempts || []).push({ path, upsert: !!(opts && opts.upsert) });
    if (sb.store[path] && !(opts && opts.upsert)) return err('The resource already exists', '409');
    let width = 0, height = 0;
    try { const bm = await createImageBitmap(blob); width = bm.width; height = bm.height; } catch (e) {}
    sb.uploads.push({ path, type: blob.type, size: blob.size, upsert: !!(opts && opts.upsert), contentType: opts && opts.contentType });
    sb.store[path] = { type: blob.type, size: blob.size, width, height, n: sb.uploads.length };
    return { data: { path }, error: null };
  },
  async createSignedUrls(paths, secs) {
    sb.signCalls.push(paths.slice());
    return { data: paths.map(p => sb.store[p]
      ? { path: p, error: null, signedUrl: window.__sbEvilUrl ? 'javascript:window.__xss=1' : SUPA + '/storage/v1/object/sign/' + bucket + '/' + p + '?token=t' + sb.store[p].n }
      : { path: p, error: 'Either the object does not exist or you do not have access to it', signedUrl: null }), error: null };
  },
  async remove(paths) {
    sb.removes.push(paths.slice());
    const gone = paths.filter(p => sb.store[p]); gone.forEach(p => { delete sb.store[p]; });
    return { data: gone.map(name => ({ name })), error: null };
  },
});
export function createClient() {
  const auth = {
    getSession: async () => ({ data: { session: session() }, error: null }),
    getUser: async () => ({ data: { user: session() && session().user }, error: null }),
    onAuthStateChange: (cb) => { setTimeout(() => cb(session() ? 'SIGNED_IN' : 'SIGNED_OUT', session()), 0); return { data: { subscription: { unsubscribe() {} } } }; },
  };
  const client = { auth, storage: { from: bucketApi }, from };
  return new Proxy(client, { get(t, p) { return p in t ? t[p] : chain({ data: [], error: null }); } });
}
`;
// 1x1 PNG for every signed url
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const browser = await launchChromium();
async function open(tool, { signedOut = false } = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route(/js\/vendor\/supabase-js-[\d.]+\.js$/, route => route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));
  await page.route(SUPA + '/storage/v1/object/sign/**', route => route.fulfill({ status: 200, contentType: 'image/png', body: PNG1 }));
  if (signedOut) await page.addInitScript(() => { window.__sbSignedOut = true; });
  await page.addInitScript(() => { window.confirm = () => true; });
  await page.goto(`http://localhost:${PORT}/PACT/tools/${tool}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window._charImg, { timeout: 20000 });
  return { page, errors };
}
// A big photo-like PNG made in the page (3000x2000 noise — too big to pass through un-shrunk).
async function bigPng(page) {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 3000; c.height = 2000;
    const x = c.getContext('2d'); const d = x.createImageData(3000, 2000);
    for (let i = 0; i < d.data.length; i += 4) { d.data[i] = (i * 7) & 255; d.data[i + 1] = (i * 13) & 255; d.data[i + 2] = Math.random() * 255; d.data[i + 3] = 255; }
    x.putImageData(d, 0, 0);
    return c.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(b64, 'base64');
}
async function choose(page, clickSel, file) {
  const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 5000 }), page.click(clickSel)]);
  await fc.setFiles(file);
}
const waitMsg = (page, host, re) => page.waitForFunction(([h, src]) => {
  const m = document.querySelector(h + ' .pci-msg'); return m && new RegExp(src).test(m.textContent);
}, [host, re.source], { timeout: 15000 });

// ===================================================================================================== Live Sheet
{
  const { page, errors } = await open('PACT-Live-Char-Sheet.html');
  const H = '#sheet [data-charimg]';
  console.log('Live Sheet — add, a second, no third');
  await page.evaluate((id) => { __charId = id; render(); }, A);
  await page.waitForSelector(H + ' button[data-act=add]', { timeout: 10000 });
  const log0 = await page.evaluate(() => JSON.stringify(LOG));
  check('the Character panel shows "Pictures (0/2)" and an Add button', await page.evaluate((h) => /\(0\/2\)/.test(document.querySelector(h).textContent), H));
  const png = await bigPng(page);
  check('the test photo really is over the 2 MB / 1600 px limits', png.length > 2 * 1024 * 1024, png.length + ' bytes');
  await choose(page, H + ' button[data-act=add]', { name: 'hero.png', mimeType: 'image/png', buffer: png });
  await waitMsg(page, H, /Picture saved/);
  let st = await page.evaluate((a) => window.__sb.store[a + '/1'], A);
  check('it lands in slot 1 of this character', !!st, JSON.stringify(st));
  check('...shrunk to WebP, ≤ 2 MB', st && st.type === 'image/webp' && st.size <= 2 * 1024 * 1024, st && (st.type + ' ' + st.size));
  check('...at most 1600 px on the long edge, aspect kept', st && st.width === 1600 && st.height === 1067, st && (st.width + 'x' + st.height));
  check('...Add uploads WITHOUT upsert (never overwrites), with its content type', await page.evaluate(() => { const u = window.__sb.uploads[0]; return !u.upsert && u.contentType === 'image/webp'; }));
  check('the picture shows from a signed url', await page.evaluate(([h, s]) => { const i = document.querySelector(h + ' img'); return !!i && i.src.indexOf(s + '/storage/v1/object/sign/character-images/') === 0; }, [H, SUPA]));
  await page.waitForFunction((h) => { const i = document.querySelector(h + ' img'); return i && i.complete && i.naturalWidth > 0; }, H, { timeout: 10000 });
  check('...and actually loads (no CSP or referrer rule blocks it)', true);
  await choose(page, H + ' button[data-act=add]', { name: 'two.jpg', mimeType: 'image/jpeg', buffer: png });
  await page.waitForFunction((a) => !!window.__sb.store[a + '/2'], A, { timeout: 15000 });
  await page.waitForFunction((h) => document.querySelectorAll(h + ' img').length === 2, H, { timeout: 10000 });
  check('a second picture goes to slot 2, both show', true);
  check('with two, the Add button is gone ("2/2")', await page.evaluate((h) => !document.querySelector(h + ' button[data-act=add]') && /\(2\/2\)/.test(document.querySelector(h).textContent), H));
  const third = await page.evaluate(async (a) => {
    const f = new File([new Uint8Array([1])], 'x.png', { type: 'image/png' });
    const r = [];
    try { await window._charImg.addCharacterImage(a, f, { 1: 'x', 2: 'y' }); r.push('added'); } catch (e) { r.push(e.message); }
    try { await window._charImg.uploadCharacterImage(a, 3, f); r.push('added'); } catch (e) { r.push(e.message); }
    return r;
  }, A);
  check('a third is refused when asked directly (no free slot; slot 3 does not exist)', third.every(m => /at most 2 pictures/.test(m)), JSON.stringify(third));
  check('...and nothing was stored for it', await page.evaluate(() => Object.keys(window.__sb.store).length === 2));

  console.log('Live Sheet — replace, remove, wrong type');
  const n1 = await page.evaluate((a) => window.__sb.store[a + '/1'].n, A);
  await choose(page, H + ' button[data-act=replace][data-slot="1"]', { name: 'new.webp', mimeType: 'image/png', buffer: png });
  await page.waitForFunction(([a, n]) => window.__sb.store[a + '/1'].n !== n, [A, n1], { timeout: 15000 });
  check('Replace overwrites slot 1 (an upsert), still two pictures', await page.evaluate(() => Object.keys(window.__sb.store).length === 2 && window.__sb.uploads.slice(-1)[0].upsert === true));
  await page.waitForFunction(([h, a]) => { const i = document.querySelector(h + ' img[data-slot="1"]'); return i && /token=t3$/.test(i.src); }, [H, A], { timeout: 10000 });
  check('...and the panel re-signs it (a new url, so no stale cached picture)', true);
  await page.click(H + ' button[data-act=remove][data-slot="2"]');
  await waitMsg(page, H, /Picture removed/);
  check('Remove deletes slot 2 after the confirm', await page.evaluate((a) => !window.__sb.store[a + '/2'], A));
  check('...and the Add button is back ("1/2")', await page.evaluate((h) => !!document.querySelector(h + ' button[data-act=add]') && /\(1\/2\)/.test(document.querySelector(h).textContent), H));
  await choose(page, H + ' button[data-act=add]', { name: 'evil.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="window.__xss=1"/>') });
  await waitMsg(page, H, /Use a JPG, PNG or WebP/);
  check('an SVG is refused in plain words and never uploaded', await page.evaluate(() => window.__sb.uploads.every(u => u.type !== 'image/svg+xml') && !window.__xss));
  check('the LOG is byte-identical after all of it — pictures never enter the save', await page.evaluate((l) => JSON.stringify(LOG) === l, log0));

  console.log('Live Sheet — Add never overwrites (stale cache), pixel bombs refused');
  await page.evaluate((a) => { window.__sb.store[a + '/2'] = { type: 'image/webp', size: 1, n: 500 }; }, A);   // filled elsewhere; our cache says empty
  await choose(page, H + ' button[data-act=add]', { name: 'late.png', mimeType: 'image/png', buffer: png });
  await waitMsg(page, H, /filled from another tab/);
  check('Add into a slot filled elsewhere is refused (no upsert), not overwritten', await page.evaluate((a) => window.__sb.store[a + '/2'].n === 500 && window.__sb.attempts.slice(-1)[0].upsert === false, A));
  await page.waitForFunction((h) => document.querySelectorAll(h + ' img').length === 2, H, { timeout: 10000 });
  check('...and the panel is refreshed: both pictures, no Add button', await page.evaluate((h) => !document.querySelector(h + ' button[data-act=add]'), H));
  await page.evaluate((a) => { delete window.__sb.store[a + '/2']; window._charImg.signedImageUrls([a], { force: true }).then(() => render()); }, A);
  await page.waitForSelector(H + ' button[data-act=add]', { timeout: 10000 });
  // A 30 000 x 30 000 PNG header (decodes to 3.6 GB) — must be refused from the header, before any decode.
  const bomb = Buffer.alloc(64); Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(bomb, 0); bomb.writeUInt32BE(30000, 16); bomb.writeUInt32BE(30000, 20);
  const nUp = await page.evaluate(() => window.__sb.uploads.length);
  await choose(page, H + ' button[data-act=add]', { name: 'bomb.png', mimeType: 'image/png', buffer: bomb });
  await waitMsg(page, H, /too large to process/);
  check('a 30 000 × 30 000 px header is refused before decoding, nothing uploaded', await page.evaluate((n) => window.__sb.uploads.length === n, nUp));
  const sizes = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const out = {};
    out.png = await window._charImg.readImageSize(new File([bytes], 'p.png', { type: 'image/png' }));
    const c = document.createElement('canvas'); c.width = 321; c.height = 123;
    for (const t of ['image/jpeg', 'image/webp']) { const bl = await new Promise(r => c.toBlob(r, t, 0.8)); out[t] = await window._charImg.readImageSize(bl); }
    return out;
  }, png.toString('base64'));
  check('the header reader gets PNG, JPEG and WebP sizes right', sizes.png.width === 3000 && sizes.png.height === 2000
    && sizes['image/jpeg'].width === 321 && sizes['image/jpeg'].height === 123 && sizes['image/webp'].width === 321 && sizes['image/webp'].height === 123, JSON.stringify(sizes));

  console.log('Live Sheet — not the owner, or never saved');
  await page.evaluate((e) => { window.__sb.store[e + '/1'] = { type: 'image/webp', size: 1, n: 600 }; __charId = e; render(); }, E);
  await page.waitForFunction((h) => document.querySelectorAll(h + ' img').length === 1, H, { timeout: 10000 });
  check('someone else\'s character (a DM editing it): the picture shows, but no Add/Replace/Remove', await page.evaluate((h) => !document.querySelector(h + ' button'), H));
  await page.evaluate((f) => { __charId = f; render(); }, F);
  await page.waitForFunction((h) => /Save this character to the cloud/.test(document.querySelector(h).textContent), H, { timeout: 10000 });
  check('a uuid never saved to the cloud: a "save to the cloud" hint and no Add button', await page.evaluate((h) => !document.querySelector(h + ' button'), H));
  await page.evaluate((a) => { __charId = a; render(); }, A);
  await page.waitForFunction((h) => document.querySelectorAll(h + ' img').length === 1, H, { timeout: 10000 });

  console.log('Live Sheet — 📋 Sheet, the DM view');
  await page.evaluate(() => toggleSheet());
  await page.waitForFunction(() => document.querySelectorAll('#sheetbody [data-charimg] img').length === 1, null, { timeout: 10000 });
  check('the 📋 Sheet shows the same picture, with its controls', await page.evaluate(() => !!document.querySelector('#sheetbody [data-charimg] button[data-act=replace]')));
  await page.evaluate(() => toggleSheet());
  await page.evaluate(() => { VIEW_ONLY = true; render(); });
  await page.waitForFunction((h) => document.querySelectorAll(h + ' img').length === 1, H, { timeout: 10000 });
  check('the DM read-only view shows the picture with no edit buttons', await page.evaluate((h) => !document.querySelector(h + ' button'), H));
  await page.evaluate(() => { VIEW_ONLY = false; render(); });

  console.log('Live Sheet — safety');
  await page.evaluate(async (b) => { window.__sb.store[b + '/1'] = { type: 'image/webp', size: 1, n: 99 }; window.__sbEvilUrl = true; __charId = b; render(); }, B);
  await page.waitForFunction((h) => !/Loading/.test(document.querySelector(h).textContent), H, { timeout: 10000 });
  check('a signed url that is not this project\'s storage route is never rendered', await page.evaluate((h) => !document.querySelector(h + ' img') && !window.__xss, H));
  await page.evaluate(() => { window.__sbEvilUrl = false; __charId = '"><img id=pwn src=x onerror="window.__xss=1">'; render(); });
  await page.waitForTimeout(200);
  check('a hostile id in the placeholder is escaped (no injected element)', await page.evaluate(() => !document.getElementById('pwn') && !window.__xss));

  console.log('Live Sheet — server without the storage migration');
  await page.evaluate((c) => { window.__sbBucketMissing = true; __charId = c; render(); }, C);
  await page.waitForSelector(H + ' button[data-act=add]', { timeout: 10000 });
  await choose(page, H + ' button[data-act=add]', { name: 'a.png', mimeType: 'image/png', buffer: png });
  await waitMsg(page, H, /switched on/);
  check('the upload says plainly that picture storage is not switched on yet', true);
  check('...and the Add button gives way to that message', await page.evaluate((h) => !document.querySelector(h + ' button[data-act=add]'), H));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await page.close();
}
{
  const { page, errors } = await open('PACT-Live-Char-Sheet.html', { signedOut: true });
  console.log('Live Sheet — signed out');
  await page.evaluate((id) => { __charId = id; render(); }, A);
  await page.waitForFunction(() => /Sign in/.test((document.querySelector('#sheet [data-charimg]') || {}).textContent || ''), null, { timeout: 10000 });
  check('signed out: a "sign in" hint and no upload control', await page.evaluate(() => !document.querySelector('#sheet [data-charimg] button')));
  check('...and no storage request at all', await page.evaluate(() => !window.__sb || window.__sb.signCalls.length === 0));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ===================================================================================================== CharGen
{
  const { page, errors } = await open('PACT-CharGen-Webtool.html');
  console.log('CharGen — the appearance area');
  await page.evaluate((d) => { window.__sb.store[d + '/1'] = { type: 'image/webp', size: 10, n: 1 }; __charId = d; render(); }, D);
  await page.waitForFunction(() => document.querySelectorAll('#cgCharImgs img').length === 1, null, { timeout: 10000 });
  check('the Setup panel shows the character\'s picture', true);
  check('...with Replace / Remove and an Add button (1/2)', await page.evaluate(() =>
    !!document.querySelector('#cgCharImgs button[data-act=replace]') && !!document.querySelector('#cgCharImgs button[data-act=remove]') && !!document.querySelector('#cgCharImgs button[data-act=add]')));
  const calls = await page.evaluate(() => window.__sb.signCalls.length);
  await page.evaluate(() => { render(); render(); });
  check('repainting does not refetch (cached signed urls)', await page.evaluate((n) => window.__sb.signCalls.length === n, calls));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ===================================================================================================== DM Console
{
  const { page, errors } = await open('DM-Console.html');
  console.log('DM Console — roster thumbnails');
  await page.waitForFunction(() => typeof window._dmRenderCloudRoster === 'function', null, { timeout: 20000 });
  await page.evaluate(([a, b, c]) => {
    window._campBridge.listCampaignInvites = () => Promise.resolve([]);
    window.__sb.store[a + '/1'] = { type: 'image/webp', size: 1, n: 1 };
    window.__sb.store[a + '/2'] = { type: 'image/webp', size: 1, n: 2 };
    window.__sb.store[b + '/2'] = { type: 'image/webp', size: 1, n: 3 };
    window.__sb.signCalls.length = 0;
    const LOG = [{ type: 'award', amount: 79, seq: 1, label: 'Award' }, { type: 'buy', cat: 'oclass', payload: { v: 'Fighter' }, cost: 0, level: 1, seq: 2, label: 'Origin class — Fighter' }];
    const row = (id) => ({ id, name: 'P ' + id.slice(-1), ap: 0, player: 'Player', playerLabel: '', dmNotes: '', stats: { LOG } });
    window._dmRenderCloudRoster(document.getElementById('campRoster'), [row(a), row(b), row(c)]);
  }, [A, B, C]);
  await page.waitForFunction(() => document.querySelectorAll('#campRoster [data-charimg] img').length === 3, null, { timeout: 10000 });
  const info = await page.evaluate(([a, b, c]) => ({
    perCard: [a, b, c].map(id => document.querySelectorAll('#campRoster .card[data-id="' + id + '"] [data-charimg] img').length),
    buttons: document.querySelectorAll('#campRoster [data-charimg] button').length,
    calls: window.__sb.signCalls.map(p => p.length),
  }), [A, B, C]);
  check('each card shows its own pictures (2, 1, none)', info.perCard.join(',') === '2,1,0', info.perCard.join(','));
  check('...read-only: no buttons on the DM\'s cards', info.buttons === 0);
  check('...and the whole roster is ONE signed-url request (6 paths)', info.calls.length === 1 && info.calls[0] === 6, JSON.stringify(info.calls));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await page.close();
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
