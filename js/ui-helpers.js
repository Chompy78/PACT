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

function flash(msg) {
  let f = document.getElementById('flashmsg');
  if (!f) {
    f = document.createElement('div');
    f.id = 'flashmsg';
    f.style.cssText = 'display:none;position:fixed;bottom:14px;left:50%;transform:translateX(-50%);' +
      'background:#7a0000;color:#fff;padding:8px 14px;border-radius:8px;font-weight:700;' +
      'z-index:10001;box-shadow:0 2px 8px rgba(0,0,0,.3)';
    document.body.appendChild(f);
  }
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
