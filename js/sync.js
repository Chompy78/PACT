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

import { supabase, withKeepalive } from './supabase-client.js';
import { currentUser } from './auth.js';
import { isCloudCharId } from './character-store.js';

// Re-exported so callers that only import js/sync.js (the tools' module bridges do this, not
// supabase-client.js directly) can still reach it for a page-lifecycle flush. See
// docs/plans/2026-08-08-header-simplification-universal-autosave.md, Part A.
export { withKeepalive };

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

// --- sync-state machine (feat/sync-state-machine, Part B step B1 of
// docs/plans/2026-08-08-shared-sync-chip-part-b.md) ---------------------------------------------
//
// Six states a status chip can show for a character, highest-precedence first. `signedOut` is
// independent of any per-character record; the rest read off the local cache record below.
export const SIGNED_OUT = 'signedOut';
export const SAVING     = 'saving';
export const CONFLICT   = 'conflict';   // = dirty AND behind
export const BEHIND     = 'behind';
export const DIRTY      = 'dirty';
export const IDLE       = 'idle';

// Characters with a saveCharacter() push currently in flight — in-memory, page-lifetime, same class
// as _pageBase. Read by getSyncState() to report SAVING; not persisted (there is nothing to resume —
// a push interrupted by a reload just leaves the record dirty, same as any other failed push).
const _pushInFlight = new Set();

// checkFreshness()'s throttle + failure bookkeeping. Both in-memory/page-lifetime, same class as
// _pageBase — there is nothing to persist across a reload, since reconcile() re-establishes ground
// truth at boot anyway. _lastFreshnessCheckAt bounds request volume regardless of success/failure;
// _lastCheckFailed is a separate, narrower signal (only set on an actual failure while online/signed
// in) surfaced to callers as `lastCheckFailed` so a status chip can show "last check didn't complete"
// without inventing a 7th chip state for it.
const BEHIND_CHECK_THROTTLE_MS = 30000;   // starting value, not yet measured against real usage — see
                                           // docs/plans/2026-08-08-shared-sync-chip-part-b.md B1 step 6
const _lastFreshnessCheckAt = new Map();
const _lastCheckFailed = new Map();

/** Local record now provably matches the server's row: used wherever local content is being fully
 *  synchronized TO (or replaced BY) the server's — a successful push (applyServerMeta), an explicit
 *  "reload the cloud version" action (B2, not yet wired), or reconcile()'s own silent adopt-at-boot.
 *  Sets base_updated_at (see applyServerMeta's original comment on why this differs from updated_at —
 *  it is the last value the SERVER confirmed, kept apart from the locally-stamped updated_at so the
 *  concurrency guard in pushCharacter() has something stable to compare against), clears dirty (local
 *  content now matches what's being adopted, so any prior unsaved-edit state is moot), and clears
 *  behind (this device is no longer behind by definition once it holds the server's own copy).
 *
 *  Deliberately NOT used by checkFreshness()'s "server unchanged" result — that confirms freshness
 *  without adopting or replacing anything, so clearing `dirty` there would silently discard the
 *  record's evidence of real unpushed edits. See checkFreshness()'s own comment.
 *
 *  Distinct from reconcile()'s transient `{behind:true}` RETURN VALUE (a one-time signal used by
 *  loadCharacter()'s onBehind prompt for the dirty+conflict case) — this function's `behind` is the
 *  PERSISTED flag on the cache record, read by getSyncState(). Don't conflate the two. */
function markInSyncWithServer(rec, serverUpdatedAt) {
  rec.base_updated_at = serverUpdatedAt;
  rec.dirty = false;
  rec.behind = false;
  return rec;
}

/** Called by a tool the instant an edit happens — NOT at debounce-fire time. Bumps a monotonic
 *  per-character edit counter (editSeq) so getSyncState() can tell "there are unsaved edits" apart
 *  from this module's own `dirty` flag, which only becomes meaningful once a save is actually
 *  ATTEMPTED (i.e. after a debounce fires) — closing the multi-second blind window between an edit
 *  and that attempt. Synchronous, no I/O; safe to call on every keystroke.
 *
 *  Paired with `savedSeq`, stamped by applyServerMeta() with whatever editSeq a specific push
 *  captured AT PUSH-START — advanced only via Math.max, never overwritten — so a later edit that
 *  arrives while an earlier push is still in flight can never be silently marked saved by that
 *  earlier push's completion. See saveCharacter()/applyServerMeta() and getSyncState(). */
export function noteEdit(id) {
  if (!id) return 0;
  const rec = lsGet(id) || { id };
  rec.editSeq = (rec.editSeq || 0) + 1;
  lsSet(rec);
  return rec.editSeq;
}

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
    // Carried forward like ap: this save never sets it, only mirrors what's already cached (or the DB
    // default, true, for a never-reconciled character) — the only writer is setAutosaveEnabled().
    autosave_enabled: prev?.autosave_enabled ?? true,
    updated_at: nowIso(),
    // Carried forward, never re-stamped locally: it is the server's word, not ours. Absent on records
    // written before this existed — treated as "unknown" below, which falls back to today's behaviour.
    base_updated_at: base,
    dirty: true,
    // editSeq/behind: carried forward unchanged. editSeq is bumped only by noteEdit() (at edit time,
    // not here); behind is a server-freshness fact this save doesn't affect either way. savedSeq is
    // NOT carried forward blind — it's snapshotted below, at push-start, as capturedSeq.
    editSeq: prev?.editSeq ?? 0,
    savedSeq: prev?.savedSeq ?? 0,
    behind: prev?.behind ?? false,
  };
  // Snapshot editSeq HERE — at push-start, before the network await below — so a later edit that
  // lands while this push is in flight bumps editSeq again and is correctly still "unsaved" once this
  // push confirms. See applyServerMeta()/getSyncState().
  const capturedSeq = rec.editSeq;
  lsSet(rec);
  if (migratedFrom) _pageBase.set(id, base);   // follow the id across a legacy-id migration
  // Drop the old key only after the new one is written, so a crash mid-migration loses nothing.
  if (migratedFrom) lsRemove(migratedFrom);

  if (!navigator.onLine) return { id, synced: false, migratedFrom };
  // A seal rejection is PERMANENT for this copy of the character, unlike every other failure here.
  // Retrying it cannot ever succeed — the server is refusing this history, not this attempt — so the
  // ordinary "stays dirty, will retry" path would spin on every autosave and leave the sync chip
  // showing unsaved for ever. Stop until the page reloads the authoritative copy, which is the only
  // thing that can fix it (feat/session-seal Phase 2, owner decision L1).
  if (_sealBlocked.has(id)) return { id, synced: false, sealed: true, migratedFrom };
  _pushInFlight.add(id);
  try { await pushCharacter(rec, capturedSeq); return { id, synced: true, migratedFrom }; }
  catch (error) {
    if (isSealRejection(error)) {
      _sealBlocked.add(id);
      return { id, synced: false, sealed: true, error, migratedFrom };
    }
    return { id, synced: false, conflict: !!error.conflict, error, migratedFrom };   // stays dirty, will retry
  }
  finally { _pushInFlight.delete(id); }
}

// Characters this PAGE has been refused on because their history is sealed. Deliberately in-memory
// and page-lifetime, never persisted: the remedy is to reload the authoritative copy, and a reload
// clears this by construction. Persisting it could strand a character whose seal was later rolled
// back, which is the failure mode the 2026-08-10 `base_updated_at` guard already learned the hard way.
const _sealBlocked = new Set();

/** True once this page has been refused a save on `id` because the server's history is sealed.
 *  The tools' autosave gates check it so they stop hammering a write that can never land. */
export function isSealBlocked(id) { return _sealBlocked.has(id); }

/** Recognises the sealed/locked-history rejection raised by pact_enforce_locked_history(). Matched on
 *  the message because PostgREST surfaces a plpgsql RAISE as a generic error, not a typed code — the
 *  trigger's own text is the only signal that crosses the wire. Both wordings it can raise ("cannot
 *  shrink", "cannot be rewritten") share the "locked character history" phrase, which is what this
 *  keys on rather than either full sentence. */
export function isSealRejection(error) {
  const m = String((error && (error.message || error.hint || error.details)) || '');
  return /locked character history/i.test(m);
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

async function pushCharacter(rec, capturedSeq) {
  // Optimistic concurrency. The whole event log lives in `stats`, so an unguarded update lets the later
  // writer replace the earlier writer's ENTIRE history — two devices on one character silently destroy
  // each other. characters.updated_at is maintained by a BEFORE UPDATE trigger, so matching on the last
  // value the server confirmed is enough; nothing needs writing client-side.
  //
  // A record written before base_updated_at existed has none. It used to save COMPLETELY UNGUARDED
  // in that case — deliberately, so such a record was not refused forever — which left a permanent
  // hole: an unguarded update replaces the whole log, so any legacy record could still silently
  // destroy a concurrent writer's history. Three cold reviews of feat/session-seal flagged the same
  // shape of gap, and it is not hypothetical: 2026-08-07, a character went 43 AP spent -> 47 -> back
  // to 43 across two browser profiles (docs/HOW-TO-WORK.md).
  //
  // Adopt the server's CURRENT value instead of skipping the guard. That narrows the window from
  // "forever, for every legacy record" to the milliseconds between this read and the update below,
  // and only on that record's first save — after which base_updated_at is set and this branch never
  // runs for it again. Refusing outright was the alternative and is worse: it strands records their
  // owner cannot fix.
  //
  // This is defence in depth, not the load-bearing part. A sealed prefix is enforced unconditionally
  // by a database trigger (sql/migrations/2026-09-01-session-seal.sql), which no client can opt out
  // of — this predicate lives in the client's own query and therefore protects only what goes
  // through it.
  let base = rec.base_updated_at;
  if (base == null) {
    const { data: cur, error: curErr } = await supabase
      .from('characters').select('updated_at').eq('id', rec.id).maybeSingle();
    if (curErr) throw curErr;
    if (cur) base = cur.updated_at;   // row absent => a genuine insert below, nothing to clobber
  }
  const guarded = base != null;
  let q = supabase
    .from('characters')
    .update({ name: rec.name, kind: rec.kind, stats: rec.stats })
    .eq('id', rec.id);
  if (guarded) q = q.eq('updated_at', base);
  const { data: upd, error: updErr } = await q.select('id, updated_at, ap, gold, autosave_enabled');
  if (updErr) throw updErr;

  if (upd && upd.length) {
    applyServerMeta(rec, upd[0], capturedSeq);
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
    // autosave_enabled carried forward, not left to the column default: a toggle preference set
    // locally before this character's first-ever cloud save must survive that first insert, not be
    // silently reset to `true` (D-GH-2026-08-08-universal-autosave-toggle).
    .insert({ id: rec.id, owner_id: user.id, name: rec.name, kind: rec.kind, stats: rec.stats,
              autosave_enabled: rec.autosave_enabled })
    .select('id, updated_at, ap, gold, autosave_enabled');
  if (insErr) throw insErr;
  applyServerMeta(rec, ins[0], capturedSeq);
}

function applyServerMeta(rec, server, capturedSeq) {
  rec.updated_at = server.updated_at;
  // base_updated_at/dirty/behind: see markInSyncWithServer()'s doc comment for why these three travel
  // together. base_updated_at in particular is the last value the SERVER confirmed, kept apart from
  // `updated_at` because saveCharacter() stamps that with the local clock on every edit — a
  // concurrency guard written against `updated_at` would therefore never match and every save would
  // look like a conflict; base_updated_at is the field the guard actually uses.
  markInSyncWithServer(rec, server.updated_at);
  // This page's own push just succeeded, so the copy it holds IS the server's copy — pin the new base
  // for this page too, or the very next save would present the now-stale pin and be refused forever.
  _pageBase.set(rec.id, server.updated_at);
  rec.ap = server.ap;     // server is authoritative for ap
  // Same two-pool, server-authoritative story as `ap` immediately above, for gold (Players Guide
  // §16): pushCharacter() never names this column (award_gold() is its only writer, and a player
  // has no grant on it at all), so this only picks up what the DM has granted since this page last
  // looked. `?? 0` because a character row written before the column existed comes back without it
  // on a cached/older read path, and the tools' wallet arithmetic must not turn undefined into NaN.
  //
  // Downtime carries NO column here — it is a party-wide window, not a per-character total (see
  // sql/migrations/2026-08-19-downtime-window-revision.sql), so it is fetched separately via
  // getDowntimeWindow() wherever a tool needs it, not synced alongside the character row.
  rec.gold = server.gold ?? 0;
  // Same reasoning as ap: pushCharacter()'s update never writes this column (see setAutosaveEnabled,
  // the only writer), so this just picks up whatever the toggle currently is — including a flip made
  // from another device or tab since this page last knew — without any risk of clobbering it.
  rec.autosave_enabled = server.autosave_enabled;
  // `rec` is the IN-MEMORY snapshot captured at this push's start — a sibling write for the same
  // character (a bare noteEdit(), or another overlapping saveCharacter() call that resolved first)
  // may have advanced editSeq/savedSeq in localStorage while this push was still in flight. The final
  // lsSet(rec) below writes the WHOLE record, so merging must compare against what's CURRENTLY
  // persisted, not just against rec's own (possibly stale) copies of these two fields — otherwise a
  // late-resolving push can silently regress a counter a more recent sibling already advanced, which
  // is exactly the failure class editSeq/savedSeq exists to prevent, reintroduced one layer down.
  const current = lsGet(rec.id);
  rec.editSeq = Math.max(rec.editSeq || 0, current?.editSeq || 0);
  rec.savedSeq = Math.max(rec.savedSeq || 0, current?.savedSeq || 0, capturedSeq || 0);
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
        .select('id, owner_id, name, kind, stats, ap, gold, campaign_id, updated_at, autosave_enabled')
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
      .select('id, name, kind, stats, ap, gold, campaign_id, updated_at, autosave_enabled')
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
    .select('id, owner_id, name, kind, stats, ap, gold, campaign_id, updated_at, autosave_enabled')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;

  if (!server) {
    // Server has no copy. Push if we have a local one to save.
    if (local) { try { await pushCharacter(local, local.editSeq || 0); } catch { /* retry later */ } }
    return {};
  }
  // base_updated_at must be stamped whenever we ADOPT a server row, not only after a successful push.
  // Without it the first save after a fresh load runs unguarded — which is exactly the two-device
  // case this guard exists for: load on the second device, edit, push, clobber the first.
  //
  // Routed through markInSyncWithServer() (not a hand-written literal) so `behind` is cleared here
  // too — this is the adopt branch that a checkFreshness()-set `behind:true` must not outlive: without
  // this, a stale "cloud moved on" warning could survive past the exact moment reconcile() silently
  // resolved it by adopting the server's row at boot/reconnect.
  if (!local) { lsSet(markInSyncWithServer({ ...server }, server.updated_at)); return {}; }

  const localNewer = local.dirty && isNewerInstant(local.updated_at, server.updated_at);
  if (localNewer) {
    // A refused push is NOT "retry later" — retrying can never succeed, because the server has moved
    // and this copy's base never will. Report it so an explicit Load can offer the only real way out.
    // _pushInFlight tracked here too, same as saveCharacter()'s own push above — without it,
    // getSyncState() has no way to see this recovery push as SAVING and falls through to a stale
    // dirty/conflict/idle read for its whole duration (found by /code-review ultra on the B3 branch;
    // pre-existing since this branch was written, freshly noticed once B3 leaned on getSyncState() more).
    _pushInFlight.add(id);
    try { await pushCharacter(local, local.editSeq || 0); }
    catch (err) { if (err && err.conflict) return { behind: true }; /* transient: retry later */ }
    finally { _pushInFlight.delete(id); }
  } else {
    // Server wins: take its stats AND its ap. Same markInSyncWithServer() reasoning as the !local
    // branch above.
    lsSet(markInSyncWithServer({ ...server }, server.updated_at));
  }
  return {};
}

/**
 * Read-only freshness check: does the SERVER have a newer row than the `base_updated_at` this device
 * last confirmed? Unlike reconcile() (push-or-adopt, mutates), this never pushes and never replaces
 * local content — it only ever touches the persisted `behind` flag, and only on a successful
 * comparison. A failed check (offline mid-flight, network error, auth hiccup) leaves `behind` exactly
 * as it was: "last known truth stands" is the only default that can't actively mislead — treating a
 * failed check as "confirmed unchanged" could hide a real conflict, and treating it as "confirmed
 * behind" would false-alarm on a transient blip. Failures surface separately via the returned
 * `lastCheckFailed` timestamp (page-lifetime only, not persisted, not folded into a chip's 6-state
 * vocabulary as a 7th value).
 *
 * Throttled to at most once per BEHIND_CHECK_THROTTLE_MS per id, success or failure either way, so a
 * caller (e.g. a visibilitychange/focus listener, wired up in a later branch) can call this freely
 * without worrying about request volume.
 *
 * Deliberately does NOT touch `dirty`: "server unchanged" says nothing about whether THIS device has
 * its own unpushed edits, and clearing dirty here would silently discard the record's evidence of real
 * unsaved work — see markInSyncWithServer()'s doc comment for why that helper is not used here.
 * @returns {Promise<{behind:boolean, lastCheckFailed:number|null, throttled?:boolean}>}
 */
export async function checkFreshness(id) {
  if (!id) return { behind: false, lastCheckFailed: null };
  const now = Date.now();
  const lastAt = _lastFreshnessCheckAt.get(id);
  const rec0 = lsGet(id);
  if (lastAt != null && (now - lastAt) < BEHIND_CHECK_THROTTLE_MS) {
    return { behind: !!(rec0 && rec0.behind), lastCheckFailed: _lastCheckFailed.get(id) || null, throttled: true };
  }
  // Expected offline/signed-out case: no attempt, no state change, not treated as a failure — mirrors
  // the guard reconcile()/loadCharacter() already use elsewhere in this file.
  if (!navigator.onLine || !(await currentUser())) {
    return { behind: !!(rec0 && rec0.behind), lastCheckFailed: _lastCheckFailed.get(id) || null };
  }
  if (!rec0 || rec0.base_updated_at == null) {
    // Nothing local to compare against yet — this device has never confirmed a server baseline for
    // this id, so "behind" isn't a meaningful question. Don't spend the throttle window or report a
    // failure for a case that was never actually attempted.
    return { behind: false, lastCheckFailed: null };
  }
  _lastFreshnessCheckAt.set(id, now);
  try {
    const { data: server, error } = await supabase
      .from('characters').select('id, updated_at').eq('id', id).maybeSingle();
    if (error) throw error;
    _lastCheckFailed.delete(id);
    if (!server) return { behind: !!rec0.behind, lastCheckFailed: null };   // row gone server-side — a different concern, not this function's job
    // Re-read rather than reuse rec0: an edit or another save could have landed while this request
    // was in flight, and this must act on the record as it stands now, not as it stood at call time.
    const rec = lsGet(id) || rec0;
    if (isNewerInstant(server.updated_at, rec.base_updated_at)) {
      rec.behind = true;
      lsSet(rec);
      return { behind: true, lastCheckFailed: null };
    }
    if (rec.behind) { rec.behind = false; lsSet(rec); }   // confirmed unchanged — clears ONLY behind, never dirty/base_updated_at
    return { behind: false, lastCheckFailed: null };
  } catch (e) {
    _lastCheckFailed.set(id, now);
    return { behind: !!rec0.behind, lastCheckFailed: now };
  }
}

/** Combined sync-status read for a status chip: one of the 6 states exported above, plus
 *  `lastCheckFailed` (see checkFreshness()) as a separate decoration rather than a 7th state.
 *  `dirty` (this module's own post-attempt flag, cleared by applyServerMeta()) is OR'd with the
 *  editSeq/savedSeq comparison (see noteEdit()) so an edit made in the last few seconds — before its
 *  debounce has even fired — is not missed; either signal alone can indicate real unsaved work. */
export async function getSyncState(id) {
  if (!(await currentUser())) return { state: SIGNED_OUT, lastCheckFailed: null };
  const rec = id ? lsGet(id) : null;
  const lastCheckFailed = id ? (_lastCheckFailed.get(id) || null) : null;
  if (!rec) return { state: IDLE, lastCheckFailed };
  if (_pushInFlight.has(id)) return { state: SAVING, lastCheckFailed };
  const hasUnsavedEdits = !!rec.dirty || (rec.editSeq || 0) > (rec.savedSeq || 0);
  const isBehind = !!rec.behind;
  if (hasUnsavedEdits && isBehind) return { state: CONFLICT, lastCheckFailed };
  if (isBehind) return { state: BEHIND, lastCheckFailed };
  if (hasUnsavedEdits) return { state: DIRTY, lastCheckFailed };
  return { state: IDLE, lastCheckFailed };
}

// One canonical table for the six display states, matching the naming in
// docs/plans/2026-08-08-shared-sync-chip-part-b.md ("Standing scope" table) — the internal enum values
// above (signedOut/idle/dirty/behind/conflict/saving) are what code branches on; PRESENTATION is the
// single place their user-facing icon/label/tone is decided, so three separately-maintained copies in
// three tools' HTML can't drift from each other.
const PRESENTATION = {
  [SIGNED_OUT]: { icon: '🔒', label: 'Signed out',        ariaLabel: 'Not signed in',                                  tone: 'muted' },
  [SAVING]:     { icon: '⋯',  label: 'Saving…',            ariaLabel: 'Saving to the cloud',                            tone: 'info'  },
  [CONFLICT]:   { icon: '⚠',  label: 'Cloud conflict',     ariaLabel: 'Unsaved changes and a newer version on the cloud', tone: 'bad' },
  [BEHIND]:     { icon: '☁',  label: 'Newer on cloud',     ariaLabel: 'A newer version exists on the cloud',            tone: 'warn'  },
  [DIRTY]:      { icon: '●',  label: 'Unsaved changes',    ariaLabel: 'Unsaved changes not yet on the cloud',           tone: 'warn'  },
  [IDLE]:       { icon: '☁',  label: 'Signed in',          ariaLabel: 'Signed in — up to date',                        tone: 'good'  },
};

/**
 * Pure state → `{icon, label, ariaLabel, tone, stale}` mapping for a shared cloud-sync status chip —
 * the ONE place all three tools read the chip's icon/text/aria/color from, so their otherwise-duplicated
 * markup can't drift on wording (each tool still owns its own DOM/CSS; only this decision is shared).
 *
 * Takes ONLY the fixed enum values getSyncState()/checkFreshness() return (`{state, lastCheckFailed}`)
 * — DELIBERATELY NEVER a raw character or campaign name. A tool that wants to show a name near the chip
 * composes it itself, via `textContent`/DOM property assignment (never `innerHTML` string
 * concatenation) — this function has no dynamic-string surface for that risk to live on.
 *
 * `lastCheckFailed` (see checkFreshness()) decorates the result as `stale:true` plus an amended
 * `ariaLabel` rather than becoming a distinct chip state — the fixed 6-state vocabulary doesn't grow a
 * 7th value for "a background freshness check didn't complete," which is connectivity noise, not a
 * change in what's actually known about the character.
 */
export function chipPresentation({ state, lastCheckFailed } = {}) {
  const p = { ...(PRESENTATION[state] || PRESENTATION[SIGNED_OUT]) };
  if (lastCheckFailed) {
    p.stale = true;
    p.ariaLabel += ' (last freshness check did not complete)';
  }
  return p;
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
      .select('id, name, kind, ap, gold, campaign_id, archived_at, updated_at, autosave_enabled, log:stats->LOG')
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

// --- universal cloud-autosave toggle (D-GH-2026-08-08-universal-autosave-toggle, B3) -------------
//
// One owner-reversible boolean, applying uniformly to every character (campaign-bound or not — see
// the decision record for why campaign-bound characters are NOT special-cased here). Same
// owner-only-column-grant pattern as archived_at just above (no SECURITY DEFINER RPC needed: unlike
// award_ap(), the writer here is always the row's own owner).

/** Synchronous, no-network read of a character's cached autosave-enabled flag — for use in a hot
 *  per-edit gate (see the tools' own autosave-scheduling code), where an async round-trip would be
 *  the wrong shape. A character with no cached record yet (never reconciled/loaded/saved this device)
 *  reads as `true`, matching the DB column's own default — unlike a consent flag, this is a freely
 *  reversible preference with nothing to protect by failing closed, so "unknown" safely reads the
 *  same as "on". */
export function getAutosaveEnabled(id) {
  if (!id) return true;
  const rec = lsGet(id);
  return rec?.autosave_enabled !== false;
}

/** Flip a character's autosave-enabled flag. Updates the local cache optimistically first (so
 *  getAutosaveEnabled() reflects the new value immediately, before the network round-trip resolves —
 *  the same reason applyServerMeta() exists for `dirty`), then confirms against the server; on failure
 *  the optimistic write is rolled back so a background autosave never acts on a flag the server never
 *  actually confirmed.
 *
 *  Two bugs a code review caught before this shipped, both fixed here:
 *
 *  1. The optimistic write used to be skipped entirely when no local cache record existed yet (a
 *     brand-new character, never edited/saved/loaded this device) — `if (before) lsSet(...)` silently
 *     discarded the user's choice, and getAutosaveEnabled() kept reading the DB default forever. Now a
 *     minimal placeholder record is written even with no prior cache, so the preference survives until
 *     the character's real first save fills the rest in. This mirrors an already-existing tolerance in
 *     this codebase, not a new risk: listMyCharacters() already treats a record with no `stats.LOG` as
 *     `hasData:false` (its doc comment covers "exists but never actually saved" for a different cause —
 *     an auto-bound invite redemption — and every consumer of a cached record already falls back via
 *     `??` on missing name/kind/stats/ap, since saveCharacter()'s real callers always pass those
 *     explicitly and never actually rely on `prev`'s copies).
 *  2. `characters.updated_at` is bumped by an unconditional BEFORE UPDATE trigger (schema.sql
 *     trg_characters_updated_at, no column filter) even though this update only touches
 *     autosave_enabled — so without re-pinning base_updated_at/_pageBase to the trigger's new value,
 *     THIS PAGE'S very next real save would present the now-stale old base, get refused by
 *     pushCharacter()'s optimistic-concurrency guard, and surface as a false "changed on another
 *     device" conflict caused by nothing but flipping a checkbox. Fixed the same way applyServerMeta()
 *     already handles a real push: adopt the server-confirmed updated_at as the new base immediately.
 *
 *  A zero-rows UPDATE is deliberately NOT treated the same as _setArchived()'s identical case: for
 *  archived_at, zero rows always means something is wrong (that toggle only ever applies to an
 *  already-cloud-saved character). Here it commonly means the character has simply never been pushed
 *  yet — a brand-new build, toggled before its first save — which is expected, not an error: nothing
 *  needs writing server-side, and the value is carried into the row by its eventual first insert (see
 *  pushCharacter()'s autosave_enabled field). Only a row that DOES exist but still didn't update
 *  (deleted mid-session, access revoked) is treated as a real failure. */
export async function setAutosaveEnabled(id, enabled) {
  const before = lsGet(id);
  // Always write a local record, even with nothing cached yet — see fix (1) above.
  lsSet({ ...(before || { id, dirty: false, editSeq: 0, savedSeq: 0, behind: false }), autosave_enabled: enabled });
  if (isCloudCharId(id)) {
    try {
      const { data, error } = await supabase
        .from('characters').update({ autosave_enabled: enabled }).eq('id', id).select('id, updated_at');
      if (error) throw error;
      if (!data || !data.length) {
        const { data: exists, error: exErr } = await supabase
          .from('characters').select('id').eq('id', id).maybeSingle();
        if (exErr) throw exErr;
        if (exists) {
          throw new Error('That character could not be updated — it may have been deleted, or you may no '
                        + 'longer have access to it. Reload and try again.');
        }
        // else: no row yet — not an error, see the doc comment above.
      } else {
        // Fix (2) above: re-pin to the trigger-bumped updated_at so this page's next real save isn't
        // guarded against a base the server has already moved past.
        const newUpdatedAt = data[0].updated_at;
        const current = lsGet(id) || {};
        lsSet({ ...current, autosave_enabled: enabled, updated_at: newUpdatedAt, base_updated_at: newUpdatedAt });
        _pageBase.set(id, newUpdatedAt);
      }
    } catch (err) {
      // Roll back the optimistic write — the server never confirmed it. `before` null means there was
      // truly nothing cached before this call (not even the placeholder from fix (1) above, which this
      // function itself just wrote) — remove it rather than leave a phantom record carrying the failed
      // value, which the earlier version of this rollback would have done once fix (1) started writing
      // a placeholder for the no-prior-cache case.
      if (before) lsSet(before); else lsRemove(id);
      throw err;
    }
  }
}

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
