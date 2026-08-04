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
import { isCloudCharId } from './character-store.js';

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
export async function saveCharacter({ id, name, kind, stats, campaignId }) {
  id = id || newCharacterId();
  // Legacy pre-UUID id (genCharId's old 'c…' format — see js/character-store.js): Postgres rejects it
  // as `invalid input syntax for type uuid`, so the push could never succeed and every attempt left
  // another orphaned local record behind. Migrate it here, once, carrying the local record over.
  // The caller MUST adopt the returned id — every save-to-cloud call site does.
  //
  // `campaignId` is what stops the migration making things WORSE. Minting a fresh UUID unconditionally
  // inserts a NEW row, so a campaign-bound character whose id had drifted onto the legacy format got
  // saved as a brand-new, campaign-less duplicate while its real bound row kept only the seed log —
  // which is exactly what happened to the first character through this path. When the caller knows the
  // character's campaign, adopt the server's existing row for it instead of minting: the DB already
  // enforces one character per player per campaign, so that row is unambiguous.
  let migratedFrom = null;
  if (!isCloudCharId(id)) {
    migratedFrom = id;
    id = (campaignId && await _existingIdInCampaign(campaignId)) || newCharacterId();
  }
  const prev = lsGet(migratedFrom || id);
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
  // Drop the old key only after the new one is written, so a crash mid-migration loses nothing.
  if (migratedFrom) lsRemove(migratedFrom);

  if (!navigator.onLine) return { id, synced: false, migratedFrom };
  try { await pushCharacter(rec); return { id, synced: true, migratedFrom }; }
  catch (error) { return { id, synced: false, error, migratedFrom }; }   // stays dirty, will retry
}

/** The signed-in user's existing character id in this campaign, or null. Best-effort: any failure
 *  returns null and the caller falls back to minting a new id, which is the pre-existing behaviour
 *  rather than a broken state. */
async function _existingIdInCampaign(campaignId) {
  try {
    const user = await currentUser();
    if (!user || !navigator.onLine) return null;
    const { data, error } = await supabase
      .from('characters')
      .select('id')
      .eq('owner_id', user.id)
      .eq('campaign_id', campaignId)
      .limit(1)
      .maybeSingle();
    return (!error && data) ? data.id : null;
  } catch { return null; }
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

/** List the current user's own characters (owner-only — explicitly filtered by
 *  owner_id rather than relying on RLS alone, since characters_select also grants
 *  DMs read access to every character in campaigns they run; this must never widen
 *  into a DM's-eye view). Each entry carries `hasData` — false for a character row
 *  that exists (e.g. a redeemed player invite, or a stray manual insert) but was
 *  never actually saved from CharGen/Live Sheet, so it has no `stats.LOG` to load —
 *  callers should show these as non-loadable rather than let a click resolve to the
 *  generic "No character data found" error after the fact — and `campaign_id` for
 *  campaign-name grouping by the caller. Requires sign-in; throws if called while
 *  signed out. */
export async function listMyCharacters() {
  const user = await currentUser();
  if (!user) throw new Error('Not signed in');
  const tombstoned = new Set(lsDeletes());
  if (navigator.onLine) {
    const { data, error } = await supabase
      .from('characters')
      .select('id, name, kind, ap, campaign_id, archived_at, updated_at, log:stats->LOG')
      .eq('owner_id', user.id)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    // `cloud` tells the UI whether this row actually exists on the server. A server row is cloud-saved
    // by definition; a local-only row is not, and `pendingSync` distinguishes "waiting to upload" from
    // "this device is offline" for the caller's wording. Without this the My Characters page rendered
    // both kinds identically, so a character that had never reached the cloud looked saved.
    const withFlag = data.map(({ log, ...c }) => ({ ...c, hasData: Array.isArray(log), cloud: true, pendingSync: false }));
    const serverIds = new Set(withFlag.map(c => c.id));
    // dirty:true means "created/edited here, not yet pushed" (set only by this device's own
    // saveCharacter() calls) — the only local-storage state that's actually evidence of
    // ownership. dirty:false means a read-only cache of whatever loadCharacter()/reconcile()
    // last fetched by id, with NO owner check at all (by design — DM Console and campaign-role
    // reads legitimately fetch characters this device doesn't own); trusting it here as "mine"
    // is exactly how a character viewed once (e.g. while D-GH-2026-08-01-dm-console-
    // listcharacters-leak was still live server-side) keeps reappearing on this device's own
    // "My Characters" forever, even after the server-side owner_id filter was fixed.
    const localOnly = lsIndex().map(lsGet).filter(r => r && r.dirty && !serverIds.has(r.id))
      .map(r => ({ ...r, hasData: Array.isArray(r.stats && r.stats.LOG), cloud: false, pendingSync: true }));
    return [...withFlag, ...localOnly].filter(c => !tombstoned.has(c.id));
  }
  // Offline: the server can't be consulted, so `cloud` reports what this device last knew — a record
  // is treated as cloud-saved once a push confirmed it (dirty cleared by applyServerMeta). Anything
  // still dirty has unpushed work, which is exactly what the caller needs to show.
  return lsIndex().map(lsGet).filter(Boolean).filter(c => !tombstoned.has(c.id))
    .map(r => ({ ...r, hasData: Array.isArray(r.stats && r.stats.LOG), cloud: !r.dirty, pendingSync: !!r.dirty }));
}

/** Archive/unarchive: reversible soft-delete, owner-only (see rls-policies.sql).
 *  Archived characters stay in listMyCharacters() output (tagged
 *  via archived_at) — callers filter/group by it, it doesn't hide the row. */
// A legacy pre-UUID id (see js/character-store.js) has no server row by definition — it could never
// have been inserted — so sending it to Postgres only earns an `invalid input syntax for type uuid`
// and leaves the record unmanageable: archiving threw, and Delete is only offered once archived, so
// these orphans could not be removed at all. Local-only ids are handled entirely in localStorage.
async function _setArchived(id, when) {
  if (isCloudCharId(id)) {
    // .select() + a length check, not just `error`: a Supabase UPDATE that matches ZERO rows returns
    // error:null, so a stale tab acting on a character that has since been deleted (or that RLS no
    // longer exposes) reported "Archived" success while nothing changed. Same pattern pushCharacter()
    // already uses in this file.
    const { data, error } = await supabase
      .from('characters').update({ archived_at: when }).eq('id', id).select('id');
    if (error) throw error;
    if (!data || !data.length) {
      throw new Error('That character could not be updated — it may have been deleted, or you may no '
                    + 'longer have access to it. Reload and try again.');
    }
  }
  const local = lsGet(id);
  if (local) lsSet({ ...local, archived_at: when });
}
export async function archiveCharacter(id)   { return _setArchived(id, nowIso()); }
export async function unarchiveCharacter(id) { return _setArchived(id, null); }

/** Delete a character: local is removed immediately and tombstoned so a later
 *  pull can't resurrect it; the server delete is attempted right away if
 *  online, and retried via the tombstone on reconnect/syncAll otherwise. */
export async function deleteCharacter(id) {
  lsRemove(id);
  // No tombstone for a local-only id: the tombstone exists to stop a later pull resurrecting a row
  // that still exists server-side, and there is no such row here. Recording one would also leave a
  // permanent un-clearable entry in the pending-deletes list, since replayDelete() can never succeed
  // against a non-UUID id.
  if (!isCloudCharId(id)) return;
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

/** Reconcile every character this device knows about (local index ∪ this user's own server
 *  rows), and replay any pending deletes first so tombstoned ids aren't resurrected by reconcile.
 *  Explicitly owner-scoped (`.eq('owner_id', ...)`) rather than relying on RLS alone, same reason as
 *  listMyCharacters() (D-GH-2026-08-01-dm-console-listcharacters-leak): characters_select also grants
 *  a DM read access to every character in campaigns they run, and this job's purpose is "keep MY
 *  characters in sync," not "cache everything I have read access to." Without this filter, syncAll()
 *  — which runs automatically on every signed-in page load via initSync(), not on user action — would
 *  fetch and cache every player's character in every campaign a DM runs as a matter of routine. That
 *  was previously harmless only because listMyCharacters()'s dirty:true check (D-GH-2026-08-02-
 *  listmycharacters-local-cache-leak) happens to filter out the dirty:false entries this creates —
 *  i.e. the fetch itself was still wrong, just caught by an unrelated downstream check. */
export async function syncAll() {
  const user = await currentUser();
  if (!navigator.onLine || !user) return { synced: 0 };
  for (const id of lsDeletes()) await replayDelete(id);

  const { data, error } = await supabase.from('characters').select('id').eq('owner_id', user.id);
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
