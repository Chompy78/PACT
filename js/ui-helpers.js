/* Shared UI-only helpers for the PACT tools (CharGen, Live Sheet, DM Console).
   Plain classic script (no ES module) — loaded via <script src> before each tool's own
   inline scripts, so these attach as ordinary globals the same way the tools' own
   esc()/flash()/_csCopy() used to. Never re-implement these locally in a tool file. */

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* Shared level-lookup scan: the highest level L in 1..20 whose per-level threshold
   (thresholdAt(L)) is <= value; 0 = below level 1. The threshold SOURCE is passed in, so the
   one scan serves both the fixed creation-budget ladder (CharGen's apLevel, thresholdAt = the
   DATA.levelAP entry) and the DM-tunable advancement curve (Live Sheet + DM Console's trackLevel,
   thresholdAt = l1 + inc*(L-1)). The tools keep their own thin apLevel()/trackLevel() wrappers and
   their own curve resolution — only this loop is shared (chore/unify-level-lookup-helper).
   thresholdAt MUST be non-decreasing in L: the "<=" scan takes the LAST satisfying L, so a
   decreasing source would return a spuriously high level — the tuned-curve callers floor inc at 1
   for exactly this reason. */
function levelForThreshold(value, thresholdAt) {
  var lv = 0, v = (+value || 0);
  for (var L = 1; L <= 20; L++) { if (thresholdAt(L) <= v) lv = L; }
  return lv;
}

/* One toast for every message the tools raise, so its default tone has to suit the common case. That
   default used to be #7a0000 — danger red — which meant "Saved to cloud" and "Loaded: Aldric" were
   announced in the same colour as a failure. Tone is now inferred from the leading glyph the callers
   already use (⚠ warn, ✕/✗ error, everything else neutral), with an explicit `kind` override for a
   caller that wants to be sure.

   role=status + aria-live=polite: the toast was previously invisible to screen readers, so a
   non-sighted player got no confirmation that a save had happened at all.

   The bottom offset shares --pact-fb-bottom with the feedback widget (js/feedback.js measures it), so
   the toast clears the same fixed bottom bars — Live Sheet's #lmobar sits exactly where this appears. */
const _FLASH_TONES = {
  ok:    '#14532d',   // deep green
  warn:  '#7c4a03',   // amber-brown
  error: '#7a0000',   // the old default, now reserved for actual failures
};
function _flashTone(msg, kind) {
  if (kind && _FLASH_TONES[kind]) return _FLASH_TONES[kind];
  const m = String(msg || '');
  if (/^\s*[✕✗×]/.test(m) || /\bfailed\b|\berror\b/i.test(m)) return _FLASH_TONES.error;
  if (/^\s*⚠/.test(m)) return _FLASH_TONES.warn;
  return _FLASH_TONES.ok;
}
function flash(msg, kind) {
  let f = document.getElementById('flashmsg');
  if (!f) {
    f = document.createElement('div');
    f.id = 'flashmsg';
    f.setAttribute('role', 'status');
    f.setAttribute('aria-live', 'polite');
    f.style.cssText = 'display:none;position:fixed;left:50%;transform:translateX(-50%);' +
      'bottom:calc(var(--pact-fb-bottom,14px) + env(safe-area-inset-bottom,0px));' +
      'color:#fff;padding:8px 14px;border-radius:8px;font-weight:700;' +
      'z-index:10001;box-shadow:0 2px 8px rgba(0,0,0,.3);max-width:calc(100vw - 28px)';
    document.body.appendChild(f);
  }
  f.style.background = _flashTone(msg, kind);
  f.textContent = msg;
  f.style.display = 'block';
  clearTimeout(flash._t);
  flash._t = setTimeout(() => { f.style.display = 'none'; }, 2600);
}

function _csCopy(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      // writeText() fails ASYNCHRONOUSLY (permission denied, document not focused), long after this function has returned
      // true and the caller has flashed "copied". Without this catch the failure was an unhandled rejection and nothing was
      // copied. Fall back to the same manual-copy prompt the last branch below uses (fix/copy-fallback).
      navigator.clipboard.writeText(text).catch(function () {
        try { window.prompt('Copy this prompt (Ctrl/Cmd-C):', text); } catch (e) {}
      });
      return true;
    }
  } catch (e) {}
  try {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    var okc = document.execCommand('copy');
    document.body.removeChild(ta);
    if (okc) return true;
  } catch (e) {}
  try { window.prompt('Copy this prompt (Ctrl/Cmd-C):', text); } catch (e) {}
  return false;
}

// Why an undo (or redo) stopped, in the player's terms.
//
// Lived as a byte-equivalent copy in BOTH tools, each carrying a "keep them in step" comment — the exact
// hand-written-mirror shape the feat/undo-barrier-shared refactor existed to delete, re-created one layer
// down at the moment the RULE was centralised into js/engine.js. A fourth barrier type would have needed
// the wording changed in two files with nothing asserting they matched, and a drifted copy is silent:
// the player just gets the wrong reason for a refusal. Moved here (a classic script both tools already
// load, alongside esc/flash/levelForThreshold) rather than into engine.js, because engine.js is the rules
// source of truth and this is presentation.
//
// Checked in isUndoBarrier()'s own precedence order, so an event that is several kinds of barrier at once
// names the most specific one.
function _undoBarrierMsg(ev){
  if(ev&&ev.dmEdit)return 'DM edits lock your history — buys made before one can\'t be undone.';
  if(ev&&ev.type==='creationLocked')return '🔒 Creation is finished — what you bought during creation can\'t be undone. Only your DM can reopen it.';
  if(ev&&ev.type==='sessionSeal')return '🔒 Your DM locked this character\'s history up to here — buys made before the lock can\'t be undone.';
  return 'AP awards lock your history — buys made before an award can\'t be undone.';
}

/* fix/chargen-creation-ceiling: the refusal text for "this would take you past your creation limit", shared by the
   Live Sheet (purchase-by-purchase) and CharGen (whole-build edits) so the two cannot drift. `c` is
   creationCeiling()'s result; `amount` is what the purchase/change adds; `noun` labels that line. Static text plus
   numbers only. */
function creationLimitRefusalText(c, amount, noun) {
  return '\u26D4 That would take you past your creation limit.\n\n'
    + 'Creation budget: ' + c.ceiling + ' AP'
    + (c.drawbackBonus ? ('  (' + c.base + ' set by your DM + ' + c.drawbackBonus + ' from your drawbacks)') : '')
    + '\nAlready spent: ' + c.spent + ' AP'
    + '\n' + (noun || 'This purchase') + ': ' + amount + ' AP\n\n'
    + 'Two ways forward:\n'
    + '  \u2022 If you have FINISHED building this character, use "Finish creating" \u2014 after that you\n'
    + '    spend at in-play prices and this limit no longer applies.\n'
    + '  \u2022 If you are still building and need more budget, ask your DM to raise your limit.';
}

/* ---- fix/livesheet-name-description-notes (D-GH-2026-10-12-livesheet-name-description-notes) ----
   The five free-text Sheet fields that used to be device-only scratch (csSave() into
   localStorage 'pactCharSheetManual:<tool>') now live in the character's LOG as sub-keys of
   b.appearance, so they travel with Save/Load, Switch tool and the cloud. data-mf id -> appearance key.
   They MUST be sub-keys of `appearance`: the server freeze exempts the whole top-level `appearance`
   field (pact_patch_exempt_keys()), whereas a new top-level patch key would be protected and refused
   after a lock. `backstory`, not `notes`, so it can't be confused with appearance.playerSheet.notes.
   The old device-local copies are KEPT in localStorage (rollback / manual recovery) but no longer read
   by these fields — after the one-time copy-in below they are inert. */
var PACT_SHEET_LOG_FIELDS = { playerName: 'playerName', alignment: 'alignment', bg: 'background', allies: 'allies', notes: 'backstory' };
var PACT_SHEET_LOG_LONG = { allies: 1, backstory: 1 };   // textareas: a two-device merge gets a paragraph separator, not " / "

/* The LAST buy/patch event whose patch carries an `appearance` key — the one foldBuild() reads (MUT.patch
   replaces `appearance` wholesale, last writer wins). -1 when there is none. */
function pactAppearanceIndex(log) {
  for (var i = (log || []).length - 1; i >= 0; i--) {
    var e = log[i];
    if (e && e.type === 'buy' && e.cat === 'patch' && e.payload && e.payload.patch && typeof e.payload.patch === 'object'
        && Object.prototype.hasOwnProperty.call(e.payload.patch, 'appearance')) return i;
  }
  return -1;
}

/* The ONE writer of the character's appearance object, shared by both tools. Returns a NEW log; never mutates `log`.
   - An appearance event exists: rewrite ONLY payload.patch.appearance of the last one, in place. seq, cost, label,
     _slot and every other patch key are kept, so a legacy multi-field bundle keeps its server-protected projection
     byte-identical (accepted even inside sealed/locked history) and the event never moves.
   - None exists: INSERT a new appearance-only event at index 0, tagged _slot:'appearance' (CharGen's slot finder).
     Index 0 rather than the tail so it is never Live Sheet's undo target while anything else exists (an appended
     cost-0 event would be popped by the next Undo, wiping every appearance field). Server-neutral: an
     appearance-only event has no protected projection, and the locked-history / creation-lock triggers compare
     FILTERED lists, not absolute indices — proved in testing/scripts/creation-lock-guard-test/freeze-cases.sql.
   opts: { seq (only used for a new event), ts, rules }. */
function pactWithAppearance(log, merged, opts) {
  opts = opts || {};
  var src = log || [];
  var app = JSON.parse(JSON.stringify(merged || {}));
  var at = pactAppearanceIndex(src);
  var out = src.slice();
  if (at >= 0) {
    var e = src[at];
    var patch = Object.assign({}, e.payload.patch, { appearance: app });
    var ev = Object.assign({}, e, { payload: Object.assign({}, e.payload, { patch: patch }) });
    if (opts.ts != null) ev.ts = opts.ts;
    out[at] = ev;
  } else {
    var nev = { type: 'buy', cat: 'patch', payload: { patch: { appearance: app } }, cost: 0,
                label: 'Appearance & description (0 AP)', _slot: 'appearance', seq: opts.seq, ts: opts.ts };
    if (opts.rules != null) nev.rules = opts.rules;
    out.unshift(nev);
  }
  return out;
}

/* One tool's device-local scratch record for a character id (the pre-fix store), or null. Read-only. */
function pactSheetScratch(tool, id) {
  try {
    var all = JSON.parse(localStorage.getItem('pactCharSheetManual:' + tool) || '{}');
    var k = (id && String(id).trim()) || '(none)';
    return (all && typeof all[k] === 'object' && all[k]) || null;
  } catch (e) { return null; }
}

/* One-time copy-in plan: which of the five keys to add to `appearance` from the device-local scratch of the two tools.
   A key already present in `appearance` — even '' (the player cleared it) — is never touched, so this is idempotent by
   construction and needs no "migrated" marker. Two different non-empty local values are BOTH kept (never pick one):
   current tool's value first. The joined value is display text — nothing ever splits it again.
   Returns {key: value} or null when there is nothing to copy. */
function pactNotesCopyInPlan(appearance, localCurrent, localOther, otherToolName) {
  var ap = appearance || {}, out = {}, n = 0;
  Object.keys(PACT_SHEET_LOG_FIELDS).forEach(function (mf) {
    var key = PACT_SHEET_LOG_FIELDS[mf];
    if (Object.prototype.hasOwnProperty.call(ap, key)) return;
    var vals = [localCurrent, localOther].map(function (o) {
      var v = o && o[mf];
      return (typeof v === 'string' && v.trim()) ? v.trim() : '';
    });
    var a = vals[0], b = vals[1], v;
    if (a && b && a !== b) {
      v = PACT_SHEET_LOG_LONG[key]
        ? a + '\n\n— also saved in the ' + (otherToolName || 'other tool') + ' on this device —\n' + b
        : a + ' / ' + b;
    } else v = a || b;
    if (v) { out[key] = v; n++; }
  });
  return n ? out : null;
}
