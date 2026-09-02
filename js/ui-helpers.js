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
      navigator.clipboard.writeText(text);
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
