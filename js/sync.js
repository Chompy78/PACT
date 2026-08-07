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

/**
 * The server timestamp THIS PAGE last observed for a character, keyed by id. In-memory, so it dies
 * with the page — that is the point.
 *
 * The concurrency guard compares against the last value the server confirmed. Reading that from
 * localStorage is not safe, because localStorage is not the thing being saved: the content comes from
 * the open tool's IN-MEMORY build, and initSync() runs syncAll() on every page load and reconnect, so
 * reconcile() can adopt a newer server row — refreshing the stored base — while the page still holds an
 * older build it has no way to update. The next save then presents a fresh base with stale content, the
 * guard matches, and the newer version is silently overwritten. Observed in production on 2026-08-07:
 * a character went 43 AP spent -> 47 -> back to 43, across two separate browser profiles, with the
 * guard active the whole time.
 *
 * So the base must travel with the COPY THE PAGE IS HOLDING, not with whatever storage happens to say
 * now. Written only by operations this page performed — loadCharacter() (the page took this copy) and
 * applyServerMeta() (this page's own push succeeded) — and deliberately NOT by reconcile()'s adopt
 * branch, which is exactly the background write that must never re-arm a stale page.
 *
 * Consequence worth knowing: after a refused save, the pin stays put, so every further save from that
 * page is refused until it loads the character again. That is correct — the page's content is behind,
 * and reloading is the only honest way forward.
 */
const _pageBase = new Map();

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
 * @returns {Promise<{id:string, synced:boolean, conflict?:boolean, error?:Error}>}
 * `conflict:true` means the server row moved on since this copy was loaded — the local edit is kept
 * and the record stays dirty; the caller must tell the user rather than retrying blindly.
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
  const prevKey = migratedFrom || id;
  const prev = lsGet(prevKey);
  // Prefer the base THIS PAGE pinned over whatever storage says now — see _pageBase. Storage can have
  // been refreshed by a background reconcile() since this page took its copy, and saving against that
  // refreshed value is the silent-overwrite bug the pin exists to stop.
  //
  // No pin means this page never loaded the character through loadCharacter() (e.g. CharGen booting
  // from its own local autosave). Fall back to the stored value — today's behaviour — and pin it now,
  // so that from this point on a background adopt cannot move the base under this page.
  let base;
  if (_pageBase.has(prevKey)) {
    base = _pageBase.get(prevKey);
  } else {
    base = prev?.base_updated_at;
    _pageBase.set(prevKey, base);
  }
  const rec = {
    id,
    name: name ?? prev?.name ?? 'New Character',
    kind: kind ?? prev?.kind ?? 'livesheet',
    stats: stats ?? prev?.stats ?? {},
    ap: prev?.ap ?? 0,            // display-only mirror of the server value
    updated_at: nowIso(),
    // Carried forward, never re-stamped locally: it is the server's word, not ours. Absent on records
    // written before this existed — treated as "unknown" below, which falls back to today's behaviour.
    base_updated_at: base,
    dirty: true,
  };
  lsSet(rec);
  if (migratedFrom) _pageBase.set(id, base);   // follow the id across a legacy-id migration
  // Drop the old key only after the new one is written, so a crash mid-migration loses nothing.
  if (migratedFrom) lsRemove(migratedFrom);

  if (!navigator.onLine) return { id, synced: false, migratedFrom };
  try { await pushCharacter(rec); return { id, synced: true, migratedFrom }; }
  catch (error) { return { id, synced: false, conflict: !!error.conflict, error, migratedFrom }; }   // stays dirty, will retry
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
export class ConflictError extends Error {
  constructor(id) {
    super('This character was changed elsewhere since you last loaded it.');
    this.name = 'ConflictError'; this.conflict = true; this.id = id;
  }
}

async function pushCharacter(rec) {
  // Optimistic concurrency. The whole event log lives in `stats`, so an unguarded update lets the later
  // writer replace the earlier writer's ENTIRE history — two devices on one character silently destroy
  // each other. characters.updated_at is maintained by a BEFORE UPDATE trigger, so matching on the last
  // value the server confirmed is enough; nothing needs writing client-side.
  //
  // Only guard when we actually know that value. A record written before base_updated_at existed has
  // none, and must keep saving exactly as it does today rather than being refused forever.
  const guarded = rec.base_updated_at != null;
  let q = supabase
    .from('characters')
    .update({ name: rec.name, kind: rec.kind, stats: rec.stats })
    .eq('id', rec.id);
  if (guarded) q = q.eq('updated_at', rec.base_updated_at);
  const { data: upd, error: updErr } = await q.select('id, updated_at, ap');
  if (updErr) throw updErr;

  if (upd && upd.length) {
    applyServerMeta(rec, upd[0]);
    return;
  }

  // Zero rows now means one of TWO things, and they must not be conflated: the row does not exist yet
  // (insert), or it exists and someone else wrote first (conflict). Inserting in the second case would
  // collide on the primary key. Ask before deciding.
  if (guarded) {
    const { data: exists, error: exErr } = await supabase
      .from('characters').select('id').eq('id', rec.id).maybeSingle();
    if (exErr) throw exErr;
    // Leave the record dirty — the local edit is NOT discarded, same as an offline failure.
    if (exists) throw new ConflictError(rec.id);
  }

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
  // The last value the SERVER confirmed, kept apart from `updated_at` because saveCharacter() stamps
  // that with the local clock on every edit. A concurrency guard written against `updated_at` would
  // therefore never match and every save would look like a conflict — this is the field the guard uses.
  rec.base_updated_at = server.updated_at;
  // This page's own push just succeeded, so the copy it holds IS the server's copy — pin the new base
  // for this page too, or the very next save would present the now-stale pin and be refused forever.
  _pageBase.set(rec.id, server.updated_at);
  rec.ap = server.ap;     // server is authoritative for ap
  rec.dirty = false;
  lsSet(rec);
}

/** Load a character: reconciles server vs local, returns the winning record.
 *  @param {{onBehind?: () => (boolean|Promise<boolean>)}} [opts] Asked when this copy is dirty AND the
 *  server has moved on, so it can never be pushed. Return true to discard the local copy and take the
 *  server's — the only route out of that state. Omit it and behaviour is unchanged. */
export async function loadCharacter(id, opts = {}) {
  let behind = false;
  if (navigator.onLine && await currentUser()) {
    const r = await reconcile(id);
    behind = !!(r && r.behind);
  }
  // The local copy is dirty and the server has moved on, so it can never be pushed. Without a way out,
  // an explicit "Load" returns this same stale copy every time — the page can neither save nor recover,
  // and the conflict message sends the user to a control that cannot help them.
  //
  // opts.onBehind lets the CALLER decide, because only it knows whether this was a deliberate user
  // action. It is asked, and only on an explicit yes is the local copy replaced by the server's. No
  // callback means unchanged behaviour, so background callers can never discard work silently.
  if (behind && typeof opts.onBehind === 'function') {
    let replace = false;
    try { replace = await opts.onBehind(); } catch { replace = false; }
    if (replace) {
      const { data: server, error } = await supabase
        .from('characters')
        .select('id, owner_id, name, kind, stats, ap, campaign_id, updated_at')
        .eq('id', id)
        .maybeSingle();
      if (!error && server) lsSet({ ...server, base_updated_at: server.updated_at, dirty: false });
    }
  }
  const rec = lsGet(id);
  // The page is about to hold THIS copy, so this is the base its saves must be judged against. Pinned
  // here rather than inside reconcile() on purpose: reconcile also runs from syncAll() in the
  // background, and a base adopted there belongs to storage, not to whatever build the page is showing.
  if (rec) _pageBase.set(id, rec.base_updated_at);
  return rec;
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

/**
 * Re-read the SERVER's `ap` for a character and fold it into the local record.
 *
 * Distinct from peekCharacter(), which prefers the local copy — correct for stats (this device's
 * edits are the freshest) but wrong for `ap`, which is DM/server-authoritative and changes without
 * this device doing anything (a DM award, or the starting-AP grant that bind_character_to_campaign
 * pays on a successful join). After any such server-side event the local `ap` is stale by
 * definition, so a caller that must show the true spendable total has to go to the server.
 *
 * Reads ONLY `ap` back into the record — never stats — so this can never clobber unsaved local
 * work, and it does not push, so it's safe on a dirty record.
 * @returns {Promise<number|null>} the server's ap, or null if it couldn't be read.
 */
export async function refreshServerAp(id) {
  if (!id || !navigator.onLine || !(await currentUser())) return null;
  const { data, error } = await supabase
    .from('characters').select('ap').eq('id', id).maybeSingle();
  if (error || !data || typeof data.ap !== 'number') return null;
  const rec = lsGet(id);
  if (rec) { rec.ap = data.ap; lsSet(rec); }
  return data.ap;
}

/** Reconcile a single id between local and server (last-write-wins; ap = server). */
/** @returns {Promise<{behind?:boolean}>} `behind:true` means the local copy is dirty AND the server has
 *  moved on since, so the push was refused. Previously this was swallowed by `catch { }` and the caller
 *  got the stale local record back with no indication anything was wrong — which made "Cloud -> Load"
 *  hand the user their own copy forever, the one action a conflict tells them to take. */
async function reconcile(id) {
  if (lsDeletes().includes(id)) { await replayDelete(id); return {}; }
  const local = lsGet(id);
  // owner_id is selected purely so the cached record carries proof of who owns it. reconcile() is
  // reachable for characters this device does NOT own (a DM opening a player's sheet), and without
  // this the cached copy is indistinguishable from the user's own — which is precisely the check
  // listMyCharacters()'s offline branch had no way to make.
  const { data: server, error } = await supabase
    .from('characters')
    .select('id, owner_id, name, kind, stats, ap, campaign_id, updated_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;

  if (!server) {
    // Server has no copy. Push if we have a local one to save.
    if (local) { try { await pushCharacter(local); } catch { /* retry later */ } }
    return {};
  }
  // base_updated_at must be stamped whenever we ADOPT a server row, not only after a successful push.
  // Without it the first save after a fresh load runs unguarded — which is exactly the two-device
  // case this guard exists for: load on the second device, edit, push, clobber the first.
  if (!local) { lsSet({ ...server, base_updated_at: server.updated_at, dirty: false }); return {}; }

  const localNewer = local.dirty && isNewerInstant(local.updated_at, server.updated_at);
  if (localNewer) {
    // A refused push is NOT "retry later" — retrying can never succeed, because the server has moved
    // and this copy's base never will. Report it so an explicit Load can offer the only real way out.
    try { await pushCharacter(local); }
    catch (err) { if (err && err.conflict) return { behind: true }; /* transient: retry later */ }
  } else {
    // Server wins: take its stats AND its ap.
    lsSet({ ...server, base_updated_at: server.updated_at, dirty: false });
  }
  return {};
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
  //
  // The ownership test the online branch makes with `.eq('owner_id', ...)` has to be made here too,
  // or "My Characters" means something different depending on connectivity. It canNOT be the online
  // branch's `dirty` test: offline, dirty:false is the normal resting state of the user's OWN synced
  // characters, so filtering on it would empty the list of everything except unpushed work. Instead
  // it's the owner_id reconcile() now caches. A record with NO owner_id is kept: that's either a
  // local-only character (created here, therefore this user's) or one cached before owner_id was
  // stored, and dropping those would blank the offline list for existing users. Those self-heal on
  // the next reconcile; a record positively known to belong to someone else is dropped now.
  return lsIndex().map(lsGet).filter(Boolean)
    .filter(c => !tombstoned.has(c.id))
    .filter(c => !c.owner_id || c.owner_id === user.id)
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
