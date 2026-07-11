// PACT — cloud save + offline sync.
//
// Supabase is the source of truth; localStorage is the offline fallback and the
// retry buffer. Rules (see docs/PWA-BUILD-PLAN.md Task 3):
//   * Only RAW character data is stored: characters.stats holds the CharGen build
//     JSON or the Live Sheet { LOG, SEQ, rules } event log. Never derived stats.
//   * ap is ALWAYS server-authoritative. We never send ap on a push, and a pull
//     always overwrites the local ap with the server's value.
//   * Last-write-wins by updated_at; we only push local when it's newer AND dirty.
//   * A failed write keeps the local copy (dirty) and retries on the next "online"
//     event or syncAll(); local is never deleted until a server write is confirmed.
//   * Deletes are tombstoned: an offline (or failed) delete is recorded in a local
//     pending-deletes list so the row can't be resurrected by a later pull; the
//     tombstone is replayed against the server on reconnect/syncAll and cleared
//     only once the server delete actually succeeds.

import { supabase } from './supabase-client.js';
import { currentUser } from './auth.js';

const LS_PREFIX  = 'pact-char-';   // one key per character
const LS_INDEX   = 'pact-chars';   // JSON array of known character ids
const LS_DELETES = 'pact-deletes'; // JSON array of ids pending server deletion

const nowIso = () => new Date().toISOString();
export const newCharacterId = () => crypto.randomUUID();

// Compares two ISO-8601 instants regardless of format (`Z` vs `+00:00`, differing
// sub-second precision) — a plain string `>` breaks across those variations.
export const isNewerInstant = (a, b) => Date.parse(a) > Date.parse(b);

// --- localStorage helpers ---------------------------------------------------
function lsGet(id) {
  try { return JSON.parse(localStorage.getItem(LS_PREFIX + id)); }
  catch { return null; }
}
function lsSet(rec) {
  localStorage.setItem(LS_PREFIX + rec.id, JSON.stringify(rec));
  const idx = lsIndex();
  if (!idx.includes(rec.id)) { idx.push(rec.id); localStorage.setItem(LS_INDEX, JSON.stringify(idx)); }
}
function lsIndex() {
  try { return JSON.parse(localStorage.getItem(LS_INDEX)) || []; }
  catch { return []; }
}
function lsRemove(id) {
  localStorage.removeItem(LS_PREFIX + id);
  localStorage.setItem(LS_INDEX, JSON.stringify(lsIndex().filter(x => x !== id)));
}
function lsDeletes() {
  try { return JSON.parse(localStorage.getItem(LS_DELETES)) || []; }
  catch { return []; }
}
function lsDeletesAdd(id) {
  const pending = lsDeletes();
  if (!pending.includes(id)) { pending.push(id); localStorage.setItem(LS_DELETES, JSON.stringify(pending)); }
}
function lsDeletesRemove(id) {
  localStorage.setItem(LS_DELETES, JSON.stringify(lsDeletes().filter(x => x !== id)));
}

// --- core read/write --------------------------------------------------------

/**
 * Save a character. Writes localStorage immediately (offline-safe), then tries
 * to push to Supabase. ap is never sent — it stays whatever the server holds.
 * @returns {Promise<{id:string, synced:boolean, error?:Error}>}
 */
export async function saveCharacter({ id, name, kind, stats }) {
  id = id || newCharacterId();
  const prev = lsGet(id);
  const rec = {
    id,
    name: name ?? prev?.name ?? 'New Character',
    kind: kind ?? prev?.kind ?? 'livesheet',
    stats: stats ?? prev?.stats ?? {},
    ap: prev?.ap ?? 0,            // display-only mirror of the server value
    updated_at: nowIso(),
    dirty: true,
  };
  lsSet(rec);

  if (!navigator.onLine) return { id, synced: false };
  try { await pushCharacter(rec); return { id, synced: true }; }
  catch (error) { return { id, synced: false, error }; }   // stays dirty, will retry
}

/** Push one local record to Supabase. Insert if new, else update the writable
 *  columns only (owner_id/ap are intentionally never sent on update). */
async function pushCharacter(rec) {
  const { data: upd, error: updErr } = await supabase
    .from('characters')
    .update({ name: rec.name, kind: rec.kind, stats: rec.stats })
    .eq('id', rec.id)
    .select('id, updated_at, ap');
  if (updErr) throw updErr;

  if (upd && upd.length) {
    applyServerMeta(rec, upd[0]);
    return;
  }

  // No row updated -> it doesn't exist yet; insert it.
  const user = await currentUser();
  if (!user) throw new Error('Not signed in');
  const { data: ins, error: insErr } = await supabase
    .from('characters')
    .insert({ id: rec.id, owner_id: user.id, name: rec.name, kind: rec.kind, stats: rec.stats })
    .select('id, updated_at, ap');
  if (insErr) throw insErr;
  applyServerMeta(rec, ins[0]);
}

function applyServerMeta(rec, server) {
  rec.updated_at = server.updated_at;
  rec.ap = server.ap;     // server is authoritative for ap
  rec.dirty = false;
  lsSet(rec);
}

/** Load a character: reconciles server vs local, returns the winning record. */
export async function loadCharacter(id) {
  if (navigator.onLine && await currentUser()) {
    await reconcile(id);
  }
  return lsGet(id);
}

/** Read-only fetch: returns the freshest known copy of a character without ever
 *  writing back to the server or localStorage — unlike loadCharacter(), this never
 *  calls reconcile()/pushCharacter(), so it's safe to use when the caller must not
 *  risk mutating the record as a side effect (e.g. reading a character purely to
 *  clone its data elsewhere). Prefers the local copy (it reflects this device's
 *  latest edits, synced or not); falls back to a direct server read only when
 *  nothing is cached locally yet. */
export async function peekCharacter(id) {
  const local = lsGet(id);
  if (local) return local;
  if (navigator.onLine && await currentUser()) {
    const { data, error } = await supabase
      .from('characters')
      .select('id, name, kind, stats, ap, campaign_id, updated_at')
      .eq('id', id)
      .maybeSingle();
    if (!error) return data;
  }
  return null;
}

/** Reconcile a single id between local and server (last-write-wins; ap = server). */
async function reconcile(id) {
  if (lsDeletes().includes(id)) { await replayDelete(id); return; }
  const local = lsGet(id);
  const { data: server, error } = await supabase
    .from('characters')
    .select('id, name, kind, stats, ap, campaign_id, updated_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;

  if (!server) {
    // Server has no copy. Push if we have a local one to save.
    if (local) { try { await pushCharacter(local); } catch { /* retry later */ } }
    return;
  }
  if (!local) { lsSet({ ...server, dirty: false }); return; }

  const localNewer = local.dirty && isNewerInstant(local.updated_at, server.updated_at);
  if (localNewer) {
    try { await pushCharacter(local); } catch { /* retry later */ }
  } else {
    // Server wins: take its stats AND its ap.
    lsSet({ ...server, dirty: false });
  }
}

/** List characters. Online: server list merged with not-yet-pushed local ones.
 *  Offline: whatever is in localStorage. */
export async function listCharacters() {
  const tombstoned = new Set(lsDeletes());
  if (navigator.onLine && await currentUser()) {
    const { data, error } = await supabase
      .from('characters')
      .select('id, name, kind, ap, campaign_id, updated_at')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    const serverIds = new Set(data.map(c => c.id));
    const localOnly = lsIndex().map(lsGet).filter(r => r && !serverIds.has(r.id));
    return [...data, ...localOnly].filter(c => !tombstoned.has(c.id));
  }
  return lsIndex().map(lsGet).filter(Boolean).filter(c => !tombstoned.has(c.id));
}

/** Delete a character: local is removed immediately and tombstoned so a later
 *  pull can't resurrect it; the server delete is attempted right away if
 *  online, and retried via the tombstone on reconnect/syncAll otherwise. */
export async function deleteCharacter(id) {
  lsRemove(id);
  lsDeletesAdd(id);
  if (navigator.onLine && await currentUser()) await replayDelete(id);
}

/** Replay one pending delete against the server; clears its tombstone on success. */
async function replayDelete(id) {
  try {
    const { error } = await supabase.from('characters').delete().eq('id', id);
    if (error) throw error;
    lsDeletesRemove(id);
  } catch { /* stays tombstoned, retry later */ }
}

/** Reconcile every known character (local index ∪ server rows), and replay any
 *  pending deletes first so tombstoned ids aren't resurrected by reconcile. */
export async function syncAll() {
  if (!navigator.onLine || !(await currentUser())) return { synced: 0 };
  for (const id of lsDeletes()) await replayDelete(id);

  const { data, error } = await supabase.from('characters').select('id');
  if (error) throw error;
  const tombstoned = new Set(lsDeletes());
  const ids = new Set([...lsIndex(), ...data.map(c => c.id)].filter(id => !tombstoned.has(id)));
  let n = 0;
  for (const id of ids) { try { await reconcile(id); n++; } catch { /* skip, retry later */ } }
  return { synced: n };
}

/** Wire up auto-sync: reconnect + on load (when signed in & online). */
export function initSync() {
  window.addEventListener('online', () => { syncAll().catch(() => {}); });
  (async () => {
    if (navigator.onLine && await currentUser()) syncAll().catch(() => {});
  })();
}
