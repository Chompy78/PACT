// PACT — shared character-store helpers (transport / storage / validation).
//
// Pure logic, no UI, no rules. The single home for cross-tool character glue that
// would otherwise be hand-copied into each tool's HTML — starting the correction of
// the "js/ holds shared logic, tools/ are UI-only" rule for persistence (see AGENTS.md).
//
// OWNERSHIP BOUNDARY (deliberate — see docs/plans/2026-07-09-chargen-livesheet-switch-button.md):
// this module owns the tool-AGNOSTIC handoff transport — writing/reading/validating/sweeping
// the localStorage payload that carries a character between CharGen and the Live Sheet.
// It does NOT apply a consumed payload to a tool's runtime: that stays tool-local
// (CharGen's _cgApplyEnvelope, the Live Sheet's importJSON-style assignment), because it
// touches each tool's own LOG/SEQ/DOM. Same split as engine.js (shared) vs emit/undo (local).
//
// Imported by each tool's <script type="module"> engine bridge and copied onto window,
// so the classic scripts can call these; UI boot is already gated on engine-ready, so the
// functions are guaranteed present before boot runs.

import { signPayload, verifyPayload } from './engine.js';   // tamper-evident save signing (D-GH48, Feature B)

// Stable per-character id. Migrated verbatim from the byte-identical copies previously
// duplicated in both tools — the first shared primitive, establishing the pattern.
export function genCharId() {
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---- unified save/export file format (D-GH40) ----
// Before this, CharGen's native save, CharGen's "export to Live Sheet", and the Live Sheet's native
// save/export were three different shapes (one of them re-synthesizing a fake LOG instead of the real
// one, one of them dropping `id` entirely) — exactly the kind of divergence that made a file saved from
// one tool fail to load correctly in the other. Both tools now fold the identical LOG through the
// identical engine, so there is no reason left for more than one shape. Both tools' native Save/Export
// write CHAR_SCHEMA; both tools' native Load/Import accept it (plus their own legacy shapes, so no
// previously-saved file is stranded).

export const CHAR_SCHEMA = 'pact-character/1';

// Build the canonical envelope. `budget` is deliberately NOT included — Phase 2 Step 5 already made it
// fully derivable from the LOG's own `award` event (`economy(LOG).earned`), so it's redundant state that
// can drift; the Live Sheet's native save already omits it today with no ill effect.
//
// The envelope is SIGNED BY DEFAULT (D-GH48): signPayload() stamps a `sig` field so a hand-edited or
// corrupted save/export is detectable on load (tamper-evident, not tamper-proof — see engine.js). Signing
// is the default because a file that *leaves* the tool must be signed, and defaulting-on means a future
// export path is covered without anyone remembering to opt in. Pass `{ sign: false }` for the throwaway
// localStorage copies (CharGen autosave, Live Sheet local save) — those are never signature-checked on the
// way back in (the local load reads LOG directly), so signing them on every keystroke/buy is wasted work.
// `sig` is metadata the engine never reads, so a signed envelope prices and rebuilds identically to an
// unsigned one; older/unsigned files still load (verify → 'unsigned').
export function buildCharacterEnvelope({ name, rules, LOG, SEQ, id }, { sign = true } = {}) {
  const envelope = { schema: CHAR_SCHEMA, rules, name: name || '', LOG, SEQ, id };
  return sign ? signPayload(envelope) : envelope;
}

// Parse + validate a would-be character file/envelope. Returns the parsed object on success (schema
// matches, LOG is an array) or null otherwise. Tool-agnostic recognition only — applying it to a tool's
// runtime stays tool-local, same ownership split as the handoff functions above.
export function readCharacterEnvelope(json) {
  let d;
  try { d = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return null; }
  if (!d || d.schema !== CHAR_SCHEMA || !Array.isArray(d.LOG)) return null;
  return d;
}

// Tamper-evidence verdict for a would-be character file (D-GH48) — the read-side mirror of
// buildCharacterEnvelope's signing. Every tool's file-read path routes through this ONE function instead
// of poking at verifyPayload().status itself, so the "is this file tampered?" predicate is defined once
// and a new reader is covered by calling it. Never throws. Returns:
//   { status, tampered, envelope }
// where status is verifyPayload()'s ('unsigned'|'ok'|'tampered'|'unknown-alg', or 'unparseable' for bad
// JSON), `tampered` is the single boolean tools branch on, and `envelope` is the parsed object (or null).
// Deliberately NON-blocking and schema-agnostic: it reports, it does not reject — an unsigned or
// legacy-shaped file still returns its verdict and is loaded by the caller. (The cloud/sync load path is
// out of scope: those rows are server-authoritative under Supabase RLS, a different trust boundary.)
export function verifyCharacterEnvelope(json) {
  let d;
  try { d = typeof json === 'string' ? JSON.parse(json) : json; }
  catch (e) { return { status: 'unparseable', tampered: false, envelope: null }; }
  const v = verifyPayload(d);
  return { status: v.status, tampered: v.status === 'tampered', envelope: d };
}

// ---- tool-to-tool handoff (the "Open in the other tool" switch) ----
// A handoff is a one-shot, same-origin baton: the source tool writes a character payload
// under a unique key and navigates to the other tool with ?handoff=<id>; the destination
// reads that ONE key, applies it, and deletes it. Per-transfer keys (not one fixed key)
// avoid a two-tab race where simultaneous switches would clobber a shared key.

const HANDOFF_PREFIX = 'pact:handoff:';
const HANDOFF_SCHEMA = 'pact-handoff/1';
const HANDOFF_TTL_MS = 2 * 60 * 1000;   // 2 minutes — long enough for a slow mobile navigation,
                                        // short enough to keep the stale/orphan surface small.

function _handoffId() {
  try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
  // Fallback for any context without crypto.randomUUID — uniqueness, not cryptographic strength, is all we need.
  return 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// Write a character payload for handoff; returns the id to put in the destination URL (?handoff=<id>).
// `data` carries the character: { source, LOG, SEQ, rules, id }. The caller saves its own local state
// first (order is immaterial — both already reflect current state); this only stages the baton.
export function writeHandoff(data) {
  const id = _handoffId();
  const payload = {
    schema: HANDOFF_SCHEMA,
    source: data.source || null,
    created: Date.now(),
    LOG: data.LOG,
    SEQ: data.SEQ,
    rules: data.rules,
    id: data.id,
  };
  try { localStorage.setItem(HANDOFF_PREFIX + id, JSON.stringify(payload)); } catch (e) {
    console.error('PACT character-store: handoff write failed', e);
    return null;
  }
  return id;
}

// Read + validate + consume the one handoff named by the URL's ?handoff=<id>.
// Returns the payload { LOG, SEQ, rules, id, source, created } on success, or null on any failure
// (missing key, bad JSON, wrong schema, non-array LOG, expired). The key is ALWAYS deleted (consume-once),
// so a reload never re-triggers the same handoff.
export function takeHandoff(id) {
  if (!id) return null;
  const key = HANDOFF_PREFIX + id;
  let raw = null;
  try { raw = localStorage.getItem(key); } catch (e) { return null; }
  try { localStorage.removeItem(key); } catch (e) {}   // consume-once, even if it turns out invalid
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    if (!p || p.schema !== HANDOFF_SCHEMA) return null;
    if (!Array.isArray(p.LOG)) return null;
    if (typeof p.created !== 'number' || (Date.now() - p.created) > HANDOFF_TTL_MS) return null;
    return p;
  } catch (e) {
    return null;
  }
}

// Delete every handoff key past its TTL (plus any unparseable one). A per-transfer-key design means an
// interrupted navigation (popup blocker, offline fallback, killed tab) leaves an orphan that nothing
// consumes — so each tool sweeps on boot to keep them from accumulating. Cheap: one pass over the keys.
export function sweepExpiredHandoffs() {
  let keys;
  try { keys = Object.keys(localStorage); } catch (e) { return; }
  const now = Date.now();
  for (const k of keys) {
    if (k.indexOf(HANDOFF_PREFIX) !== 0) continue;
    let stale = true;   // default: an unreadable/unparseable handoff key is treated as junk and removed
    try {
      const p = JSON.parse(localStorage.getItem(k));
      stale = !p || typeof p.created !== 'number' || (now - p.created) > HANDOFF_TTL_MS;
    } catch (e) { stale = true; }
    if (stale) { try { localStorage.removeItem(k); } catch (e) {} }
  }
}

// ---- recent characters + autosave history (feat/continue-recent-chars) ----
// Each tool's own single-slot autosave still restores the CURRENT character on boot; this ADDITIONAL,
// shared store powers the landing page's "Continue where you left off" section. It keeps two lightweight
// lists inside ONE key:
//   • chars — the last MAX_RECENT_CHARS *distinct* characters (latest state of each), keyed by id (falling
//             back to name), so you can resume whichever character you last touched — in whichever tool you
//             last used for it (the latest snapshot carries the tool).
//   • saves — a rolling ring of the last MAX_RECENT_SAVES autosave *snapshots* (a recovery timeline that
//             can hold several points of the same character).
// Purely additive: it never touches a tool's own restore slot, and every write is wrapped so a failure
// here can never break a real autosave.
//
// CAPTURE POLICY (recordAutosave) deliberately uses BOTH time AND difference, so a burst of keystrokes
// doesn't fill the ring with near-identical entries: a snapshot identical to the newest is skipped; rapid
// edits to the SAME character within RECENT_COALESCE_MS coalesce into the newest ring slot (kept current,
// no slot spent); a new ring slot is cut only when enough time has passed, the character/tool changed, or
// the change is large (>= RECENT_BIG_DELTA log events).

const RECENT_KEY         = 'pactRecentV1';
const MAX_RECENT_CHARS   = 3;
const MAX_RECENT_SAVES   = 10;
const RECENT_COALESCE_MS = 2 * 60 * 1000;   // rapid same-character edits inside this window share one ring slot
const RECENT_BIG_DELTA   = 5;               // a jump of >= this many LOG events earns its own ring slot regardless

function _recentRead() {
  let s;
  try { s = JSON.parse(localStorage.getItem(RECENT_KEY)); } catch (e) { s = null; }
  if (!s || typeof s !== 'object') s = {};
  return { chars: Array.isArray(s.chars) ? s.chars : [], saves: Array.isArray(s.saves) ? s.saves : [] };
}
function _recentWrite(store) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(store)); }
  catch (e) {
    // Quota: shed the oldest half of the (larger) ring and retry once, then give up silently — the recent
    // store must never be the thing that makes a real autosave fail.
    try {
      store.saves = store.saves.slice(0, Math.max(2, Math.floor(store.saves.length / 2)));
      localStorage.setItem(RECENT_KEY, JSON.stringify(store));
    } catch (e2) {}
  }
}
function _charKeyOf(s) { return s.id || ('name:' + (s.name || '')); }

// Record one autosave snapshot into the shared recent store. Best-effort; never throws.
// `entry`: { tool:'chargen'|'livesheet', id, name, rules, LOG, SEQ }.
export function recordAutosave(entry) {
  try {
    if (!entry || !Array.isArray(entry.LOG)) return;
    const LOG = entry.LOG;
    const last = LOG.length ? LOG[LOG.length - 1] : null;
    const snap = {
      tool: entry.tool || null,
      id: entry.id || null,
      name: entry.name || '',
      rules: entry.rules || null,
      ts: (last && typeof last.ts === 'number') ? last.ts : Date.now(),
      logLen: LOG.length,
      LOG: LOG,
      SEQ: entry.SEQ,
    };
    if (!snap.logLen && !snap.name) return;   // nothing worth continuing

    const store = _recentRead();
    const prev = store.saves[0] || null;
    const identical = !!prev && prev.logLen === snap.logLen && prev.ts === snap.ts
                      && prev.name === snap.name && prev.id === snap.id && prev.tool === snap.tool;
    if (identical) return;   // newest ring slot already holds this exact state → nothing to do

    // --- saves ring (recovery timeline): time + difference decide coalesce vs. new slot ---
    const sameContext  = !!prev && prev.id === snap.id && prev.tool === snap.tool;
    const withinWindow = !!prev && (snap.ts - prev.ts) >= 0 && (snap.ts - prev.ts) < RECENT_COALESCE_MS;
    const bigChange    = !prev || Math.abs(snap.logLen - prev.logLen) >= RECENT_BIG_DELTA;
    if (sameContext && withinWindow && !bigChange) {
      store.saves[0] = snap;                                   // coalesce rapid same-character edits
    } else {
      store.saves.unshift(snap);                               // cut a new checkpoint
      store.saves = store.saves.slice(0, MAX_RECENT_SAVES);
    }

    // --- chars list (last distinct characters, always the current state) ---
    const ck = _charKeyOf(snap);
    store.chars = store.chars.filter(c => _charKeyOf(c) !== ck);
    store.chars.unshift(snap);
    store.chars = store.chars.slice(0, MAX_RECENT_CHARS);

    _recentWrite(store);
  } catch (e) { /* recent store is best-effort; never disturb the caller's autosave */ }
}

// Read the recent store for the landing page. Returns { chars, saves } — each a list of validated,
// resumable snapshots ({ tool, id, name, rules, ts, logLen, LOG, SEQ }), newest-first. Never throws.
export function readRecent() {
  try {
    const store = _recentRead();
    const clean = a => a.filter(s => s && Array.isArray(s.LOG) && (s.LOG.length || s.name))
                        .map(s => ({ tool: s.tool || null, id: s.id || null, name: s.name || '',
                                     rules: s.rules || null, ts: typeof s.ts === 'number' ? s.ts : 0,
                                     logLen: s.logLen || (Array.isArray(s.LOG) ? s.LOG.length : 0),
                                     LOG: s.LOG, SEQ: s.SEQ }));
    return { chars: clean(store.chars), saves: clean(store.saves) };
  } catch (e) { return { chars: [], saves: [] }; }
}
