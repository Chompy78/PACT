// PACT — character images (feat/character-images, D-GH-2026-10-15-character-images).
//
// Up to TWO pictures per cloud character, kept in a PRIVATE Supabase Storage bucket — never in
// characters.stats / the LOG (a picture would bloat every save, sync and backup). Nothing about the
// pictures is stored on the character at all: the object path is derived from the character id and the
// slot, `<character_id>/<slot>` with slot 1 or 2, so there is no second copy that could drift.
//
// Who can do what is decided by the storage policies in sql/migrations/2026-10-15-character-images.sql,
// not here: the character's OWNER reads and writes; the DMs of its campaign and the other players of that
// campaign read (an NPC's pictures are DM-only); nobody else. The server also refuses any name other than
// `<uuid>/1` and `<uuid>/2`, so a third picture is impossible, not just hidden. This module only makes the
// friendly path pleasant: it shrinks the picture in the browser first (≤1600 px, WebP — JPEG where the
// browser cannot encode WebP — under the bucket's 2 MB cap; re-encoding also drops EXIF/GPS metadata),
// and it shows pictures only through short-lived SIGNED urls, set as an <img> src via the DOM property after
// checking the url really points at this project's storage. No user-controlled string reaches innerHTML.
//
// The UI is placeholder-driven so each tool needs only a one-line hook: a tool renders
//   <div data-charimg="<character id>" data-charimg-edit="1"></div>    (omit -edit for read-only)
// and calls hydrateAll(root) after it paints; this module fills every placeholder (one signed-url request
// for all of them — the DM Console roster batches its whole campaign) and re-fills them on sign-in/out.
// Signed out, a local-only (non-uuid) id, or a read-only view with no pictures: the placeholder renders
// a hint or nothing. If the bucket has not been created yet (migration not applied) the first upload says
// so in plain words and the add buttons give way to that message.
import { supabase, SUPABASE_URL } from './supabase-client.js';
import { isCloudCharId } from './character-store.js';

export const CHAR_IMAGE_BUCKET = 'character-images';
export const MAX_CHAR_IMAGES = 2;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;      // the bucket's file_size_limit
export const MAX_IMAGE_EDGE = 1600;
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_INPUT_BYTES = 25 * 1024 * 1024;            // before shrinking — a phone photo is fine, a 200 MB TIFF is not
const SIGN_SECONDS = 600;                             // signed url lifetime
const CACHE_MS = 8 * 60 * 1000;                       // re-sign well before the url expires
const SLOTS = [1, 2];

export const UNAVAILABLE_MESSAGE = 'Character pictures aren’t switched on for this server yet — the site owner still needs to enable picture storage.';
export const OWNER_ONLY_MESSAGE = 'Only the character’s owner can change its pictures, and only once it has been saved to the cloud.';
export const FULL_MESSAGE = 'A character can have at most ' + MAX_CHAR_IMAGES + ' pictures — remove or replace one first.';

export const imagePath = (charId, slot) => String(charId).toLowerCase() + '/' + slot;

let _unavailable = false;           // the bucket answered "not found" this session
let _userId;                        // undefined = not checked yet; null = signed out
const _cache = new Map();           // charId -> { at, urls: {1: url|null, 2: url|null} }
const _inflight = new Map();        // charId -> Promise

export function imagesUnavailable() { return _unavailable; }

function _isBucketMissing(err) {
  const m = String((err && (err.message || err.error)) || '');
  return /bucket not found/i.test(m) || (/not.?found/i.test(m) && /bucket/i.test(m));
}

/** Turn a storage error into a sentence a player can act on. */
export function friendlyImageError(err) {
  if (!err) return 'Something went wrong.';
  if (_isBucketMissing(err)) { _unavailable = true; return UNAVAILABLE_MESSAGE; }
  const m = String(err.message || err.error || err);
  const code = String(err.statusCode || err.status || '');
  if (/row-level security|unauthori[sz]ed|permission|not allowed|403/i.test(m) || code === '403') return OWNER_ONLY_MESSAGE;
  if (/maximum allowed size|too large|payload/i.test(m) || code === '413') return 'That picture is still over 2 MB after shrinking — try a smaller one.';
  if (/mime/i.test(m) || code === '415') return 'Use a JPG, PNG or WebP picture.';
  return m || 'Something went wrong.';
}

/** A signed url we are willing to put in an <img src>: absolute, this project, this bucket's sign route. */
export function isSafeSignedUrl(u) {
  return typeof u === 'string' && u.indexOf(SUPABASE_URL + '/storage/v1/object/sign/' + CHAR_IMAGE_BUCKET + '/') === 0
    && !/["'<>\s\\]/.test(u);
}

async function _currentUserId() {
  if (_userId !== undefined) return _userId;
  try {
    const { data } = await supabase.auth.getSession();
    _userId = (data && data.session && data.session.user && data.session.user.id) || null;
  } catch { _userId = null; }
  return _userId;
}

// ---------------------------------------------------------------------------------------------------
// Shrinking (browser-side, before upload)
// ---------------------------------------------------------------------------------------------------
async function _decode(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file); } catch { /* fall through to <img> */ }
  }
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file isn’t a picture this browser can read.')); };
    img.src = url;
  });
}

function _toBlob(canvas, type, q) {
  return new Promise(resolve => canvas.toBlob(b => resolve(b), type, q));
}

/** Validate and shrink a picture. Resolves {blob, type, width, height}; rejects with a plain-English Error. */
export async function prepareImage(file) {
  if (!file) throw new Error('No picture chosen.');
  const type = String(file.type || '').toLowerCase();
  if (ACCEPTED_IMAGE_TYPES.indexOf(type) < 0) throw new Error('Use a JPG, PNG or WebP picture.');
  if (file.size > MAX_INPUT_BYTES) throw new Error('That file is too big to shrink (25 MB at most).');
  let img;
  try { img = await _decode(file); } catch { throw new Error('That file isn’t a picture this browser can read.'); }
  const w0 = img.width || img.naturalWidth, h0 = img.height || img.naturalHeight;
  if (!w0 || !h0) throw new Error('That file isn’t a picture this browser can read.');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  for (const edge of [MAX_IMAGE_EDGE, 1280, 1024, 800]) {
    const s = Math.min(1, edge / Math.max(w0, h0));
    canvas.width = Math.max(1, Math.round(w0 * s));
    canvas.height = Math.max(1, Math.round(h0 * s));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const q of [0.85, 0.72, 0.6]) {
      let blob = await _toBlob(canvas, 'image/webp', q);
      // A browser that cannot ENCODE WebP hands back a PNG instead — use JPEG there (a PNG photo is huge).
      if (!blob || blob.type !== 'image/webp') blob = await _toBlob(canvas, 'image/jpeg', q);
      if (blob && blob.size <= MAX_IMAGE_BYTES) {
        if (img.close) try { img.close(); } catch { /* ImageBitmap only */ }
        return { blob, type: blob.type, width: canvas.width, height: canvas.height };
      }
    }
  }
  throw new Error('Could not shrink that picture under 2 MB — try a smaller one.');
}

// ---------------------------------------------------------------------------------------------------
// Storage calls
// ---------------------------------------------------------------------------------------------------
function _bucket() { return supabase.storage.from(CHAR_IMAGE_BUCKET); }

/** Signed urls for several characters in ONE request. Resolves Map(charId -> {1: url|null, 2: url|null}).
 *  A slot with no object (or one this user may not read) is null — the server answers both the same way. */
export async function signedImageUrls(charIds, { force = false } = {}) {
  const out = new Map();
  const now = Date.now();
  const need = [];
  for (const id of new Set((charIds || []).filter(isCloudCharId).map(s => String(s).toLowerCase()))) {
    const c = _cache.get(id);
    if (!force && c && now - c.at < CACHE_MS) out.set(id, c.urls);
    else need.push(id);
  }
  if (!need.length) return out;
  const key = need.join(',');
  let p = _inflight.get(key);
  if (!p) {
    p = (async () => {
      const paths = [];
      need.forEach(id => SLOTS.forEach(s => paths.push(imagePath(id, s))));
      const { data, error } = await _bucket().createSignedUrls(paths, SIGN_SECONDS);
      if (error) { if (_isBucketMissing(error)) _unavailable = true; throw error; }
      const res = new Map(need.map(id => [id, { 1: null, 2: null }]));
      (data || []).forEach(row => {
        if (!row || row.error || !row.path) return;
        const [id, slot] = String(row.path).split('/');
        const url = row.signedUrl || row.signedURL;
        if (res.has(id) && (slot === '1' || slot === '2') && isSafeSignedUrl(url)) res.get(id)[slot] = url;
      });
      const at = Date.now();
      res.forEach((urls, id) => _cache.set(id, { at, urls }));
      return res;
    })().finally(() => _inflight.delete(key));
    _inflight.set(key, p);
  }
  const got = await p;
  got.forEach((urls, id) => out.set(id, urls));
  return out;
}

function _forget(charId) { _cache.delete(String(charId).toLowerCase()); }

/** Upload (or replace) the picture in one slot. `file` is the raw File; it is shrunk first. */
export async function uploadCharacterImage(charId, slot, file) {
  if (!isCloudCharId(charId)) throw new Error('Save this character to the cloud before adding pictures.');
  if (SLOTS.indexOf(Number(slot)) < 0) throw new Error(FULL_MESSAGE);
  if (_unavailable) throw new Error(UNAVAILABLE_MESSAGE);
  const { blob, type } = await prepareImage(file);
  const { error } = await _bucket().upload(imagePath(charId, Number(slot)), blob, { upsert: true, contentType: type, cacheControl: '60' });
  _forget(charId);
  if (error) throw new Error(friendlyImageError(error));
}

/** Add a picture in the first empty slot; refuses a third. `current` = {1: url|null, 2: url|null}. */
export async function addCharacterImage(charId, file, current) {
  const free = SLOTS.find(s => !(current && current[s]));
  if (!free) throw new Error(FULL_MESSAGE);
  return uploadCharacterImage(charId, free, file);
}

export async function removeCharacterImage(charId, slot) {
  if (!isCloudCharId(charId)) return;
  const { error } = await _bucket().remove([imagePath(charId, Number(slot))]);
  _forget(charId);
  if (error) throw new Error(friendlyImageError(error));
}

/** Best-effort: delete both pictures (used when the owner permanently deletes the character). Never throws. */
export async function removeAllCharacterImages(charId) {
  if (!isCloudCharId(charId) || _unavailable) return;
  try { await _bucket().remove(SLOTS.map(s => imagePath(charId, s))); } catch { /* best effort */ }
  _forget(charId);
}

// ---------------------------------------------------------------------------------------------------
// Placeholder UI
// ---------------------------------------------------------------------------------------------------
const STYLE_ID = 'pact-charimg-style';
function _style() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent =
    '.pci{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start;margin:6px 0}' +
    '.pci:empty{display:none;margin:0}' +
    '.pci-fig{margin:0;display:flex;flex-direction:column;gap:4px;align-items:flex-start}' +
    '.pci-fig a{display:block;line-height:0}' +
    '.pci-fig img{max-width:180px;max-height:180px;border-radius:6px;border:1px solid rgba(127,127,127,.4);object-fit:cover}' +
    '.pci.sm .pci-fig img{max-width:72px;max-height:72px}' +
    '.pci-btns{display:flex;gap:4px;flex-wrap:wrap}' +
    '.pci button{font:inherit;font-size:12px;padding:2px 8px;border-radius:4px;border:1px solid rgba(127,127,127,.5);background:transparent;color:inherit;cursor:pointer}' +
    '.pci button:disabled{opacity:.5;cursor:default}' +
    '.pci-msg{flex-basis:100%;font-size:12px;opacity:.85}' +
    '.pci-msg.bad{color:#b3261e;opacity:1}' +
    '.pci-hd{flex-basis:100%;font-size:12px;font-weight:600}' +
    '@media print{.pci button,.pci-msg,.pci-hd{display:none}}';
  document.head.appendChild(st);
}

const _mounted = new Set();   // hosts we have filled, for re-fill on sign-in/out
const _msg = new Map();       // charId -> {text, bad} — survives a tool re-render that throws the host away

function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function _paint(host, st) {
  // st: {id, edit, signedIn, urls|null, loading, busy}
  host.textContent = '';
  host.classList.add('pci');
  const { id, edit } = st;
  const m = _msg.get(id);
  if (!st.signedIn || !isCloudCharId(id)) {
    if (edit) host.appendChild(_el('div', 'pci-msg', (st.signedIn ? 'Save this character to the cloud' : 'Sign in and save this character to the cloud')
      + ' to add up to ' + MAX_CHAR_IMAGES + ' pictures.'));
    return;
  }
  const urls = st.urls || { 1: null, 2: null };
  const filled = SLOTS.filter(s => urls[s]);
  if (!edit && !filled.length) return;   // read-only and nothing to show: stay invisible
  if (edit) host.appendChild(_el('div', 'pci-hd', '🖼 Pictures (' + filled.length + '/' + MAX_CHAR_IMAGES + ')'));
  if (st.loading && !st.urls) { host.appendChild(_el('div', 'pci-msg', 'Loading pictures…')); return; }
  filled.forEach(slot => {
    const fig = _el('figure', 'pci-fig');
    const a = document.createElement('a');
    a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.href = urls[slot];   // already checked by isSafeSignedUrl
    a.title = 'Open full size';
    const img = document.createElement('img');
    img.alt = 'Character picture ' + slot;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.setAttribute('data-slot', String(slot));
    img.src = urls[slot];
    a.appendChild(img);
    fig.appendChild(a);
    if (edit) {
      const btns = _el('div', 'pci-btns');
      const rep = _el('button', null, 'Replace'); rep.type = 'button'; rep.setAttribute('data-act', 'replace'); rep.setAttribute('data-slot', String(slot));
      const rm = _el('button', null, 'Remove'); rm.type = 'button'; rm.setAttribute('data-act', 'remove'); rm.setAttribute('data-slot', String(slot));
      rep.disabled = rm.disabled = !!st.busy || _unavailable;
      rep.onclick = () => _pick(host, st, slot);
      rm.onclick = () => _remove(host, st, slot);
      btns.appendChild(rep); btns.appendChild(rm);
      fig.appendChild(btns);
    }
    host.appendChild(fig);
  });
  if (edit && !_unavailable && filled.length < MAX_CHAR_IMAGES) {
    const add = _el('button', null, '+ Add picture'); add.type = 'button'; add.setAttribute('data-act', 'add');
    add.disabled = !!st.busy;
    add.title = 'JPG, PNG or WebP. It is shrunk to at most ' + MAX_IMAGE_EDGE + ' px and 2 MB before upload. Your DM and the other players in this character’s campaign can see it.';
    add.onclick = () => _pick(host, st, null);
    host.appendChild(add);
  }
  if (_unavailable) host.appendChild(_el('div', 'pci-msg bad', UNAVAILABLE_MESSAGE));
  else if (st.busy) host.appendChild(_el('div', 'pci-msg', st.busy));
  else if (m) host.appendChild(_el('div', 'pci-msg' + (m.bad ? ' bad' : ''), m.text));
}

function _pick(host, st, slot) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = ACCEPTED_IMAGE_TYPES.join(',');
  inp.style.display = 'none';
  inp.setAttribute('data-charimg-input', st.id);
  inp.onchange = async () => {
    const f = inp.files && inp.files[0];
    inp.remove();
    if (!f) return;
    await _act(host, st, 'Shrinking and uploading…', 'Picture saved.',
      () => slot ? uploadCharacterImage(st.id, slot, f) : addCharacterImage(st.id, f, (_cache.get(st.id) || {}).urls || st.urls));
  };
  document.body.appendChild(inp);
  inp.click();
}

function _remove(host, st, slot) {
  if (typeof confirm === 'function' && !confirm('Remove this picture? This cannot be undone.')) return;
  return _act(host, st, 'Removing…', 'Picture removed.', () => removeCharacterImage(st.id, slot));
}

async function _act(host, st, busy, done, fn) {
  _msg.delete(st.id);
  _refill(st.id, { busy });
  try { await fn(); _msg.set(st.id, { text: done, bad: false }); }
  catch (e) { _msg.set(st.id, { text: (e && e.message) || String(e), bad: true }); }
  await _load(st.id, true);
}

function _state(host) {
  return {
    id: String(host.getAttribute('data-charimg') || '').toLowerCase(),
    edit: host.getAttribute('data-charimg-edit') === '1',
  };
}

/** Repaint every live placeholder for one character (a tool may have several, e.g. panel + 📋 Sheet). */
function _refill(id, extra) {
  for (const h of Array.from(_mounted)) {
    if (!h.isConnected) { _mounted.delete(h); continue; }
    const s = _state(h);
    if (s.id !== id) continue;
    const c = _cache.get(id);
    _paint(h, Object.assign(s, { signedIn: !!_userId, urls: c ? c.urls : null, loading: !c }, extra || {}));
  }
}

async function _load(id, force) {
  try { await signedImageUrls([id], { force }); }
  catch (e) { if (!_isBucketMissing(e)) _msg.set(id, { text: 'Could not load pictures: ' + friendlyImageError(e), bad: true }); }
  _refill(id);
}

/** Fill every [data-charimg] placeholder under `root` (or `root` itself). Safe to call on every render:
 *  a cached answer paints synchronously, so a re-rendered panel does not flicker or refetch. */
export async function hydrateAll(root) {
  if (typeof document === 'undefined') return;
  _style();
  root = root || document;
  const hosts = [];
  if (root.matches && root.matches('[data-charimg]')) hosts.push(root);
  if (root.querySelectorAll) root.querySelectorAll('[data-charimg]').forEach(h => hosts.push(h));
  if (!hosts.length) return;
  _mounted.forEach(h => { if (!h.isConnected) _mounted.delete(h); });
  hosts.forEach(h => _mounted.add(h));
  const uid = await _currentUserId();
  const need = [];
  hosts.forEach(h => {
    const s = _state(h);
    const c = _cache.get(s.id);
    const fresh = c && Date.now() - c.at < CACHE_MS;
    _paint(h, Object.assign(s, { signedIn: !!uid, urls: c ? c.urls : null, loading: !fresh }));
    if (uid && isCloudCharId(s.id) && !fresh) need.push(s.id);
  });
  if (!need.length) return;
  try { await signedImageUrls(need); }
  catch (e) { if (!_isBucketMissing(e)) need.forEach(id => _msg.set(id, { text: 'Could not load pictures: ' + friendlyImageError(e), bad: true })); }
  new Set(need).forEach(id => _refill(id));
}

// Sign-in/out changes who may see what: drop every cached url and repaint.
try {
  supabase.auth.onAuthStateChange((_event, session) => {
    const uid = (session && session.user && session.user.id) || null;
    if (uid === _userId) return;
    _userId = uid;
    _cache.clear(); _msg.clear();
    const live = Array.from(_mounted).filter(h => h.isConnected);
    _mounted.clear();
    live.forEach(h => hydrateAll(h));
  });
} catch { /* a stubbed client without auth events: fine, hydrateAll checks the session itself */ }
