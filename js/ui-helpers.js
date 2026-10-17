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

/* feat/appearance-copy-paste (owner decision AF1): copy every TEXT appearance field of one character and paste it onto
   another, in either tool. Only string values travel — the appearance object also carries the Live Sheet's own
   `playerSheet` (coins, weapons; an object), which is never copied and never overwritten. The character's name is not
   part of appearance, so it never travels either. Paste REPLACES every text field: a field empty or absent in the copy
   is cleared on the target. The clipboard text is untrusted (another app, another person): it is parsed, not run;
   keys and values are shape-checked; and the preview is a plain-text confirm(), never HTML. */
var PACT_APPEARANCE_SCHEMA = 'pact-appearance/1';
function _pactApTextFields(app) {
  var out = {};
  if (app && typeof app === 'object') Object.keys(app).forEach(function (k) { if (typeof app[k] === 'string') out[k] = app[k]; });
  return out;
}
function pactAppearanceCopyText(app) {
  return JSON.stringify({ schema: PACT_APPEARANCE_SCHEMA, appearance: _pactApTextFields(app) });
}
/* -> {ok:true, appearance} | {ok:false, error} */
function pactAppearanceParse(text) {
  var d;
  try { d = JSON.parse(String(text == null ? '' : text)); } catch (e) { return { ok: false, error: 'That is not a copied appearance (press 📋 Copy appearance on the other character first).' }; }
  if (!d || typeof d !== 'object' || d.schema !== PACT_APPEARANCE_SCHEMA || !d.appearance || typeof d.appearance !== 'object' || Array.isArray(d.appearance))
    return { ok: false, error: 'That is not a copied appearance (press 📋 Copy appearance on the other character first).' };
  var keys = Object.keys(d.appearance), app = {};
  if (keys.length > 200) return { ok: false, error: 'That copied appearance has too many fields.' };
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i], v = d.appearance[k];
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(k) || k === 'playerSheet') continue;   // skip odd keys; never the Live Sheet's own panel
    if (typeof v !== 'string') continue;
    if (v.length > 20000) return { ok: false, error: 'A field in that copied appearance is too long.' };
    app[k] = v;
  }
  return { ok: true, appearance: app };
}
/* The target's appearance with every text field replaced by the copy's (absent = cleared); non-text keys kept.
   -> {merged, changed:[{key, from, to}]} */
function pactAppearanceMerge(cur, pasted) {
  var merged = JSON.parse(JSON.stringify(cur && typeof cur === 'object' ? cur : {})), changed = [];
  var curText = _pactApTextFields(merged);
  Object.keys(curText).forEach(function (k) {
    if (!Object.prototype.hasOwnProperty.call(pasted, k) && curText[k] !== '') { changed.push({ key: k, from: curText[k], to: '' }); merged[k] = ''; }
  });
  Object.keys(pasted).forEach(function (k) {
    var was = typeof merged[k] === 'string' ? merged[k] : '';
    if (was !== pasted[k]) changed.push({ key: k, from: was, to: pasted[k] });
    merged[k] = pasted[k];
  });
  return { merged: merged, changed: changed };
}
function pactAppearanceCopy(app) {
  var ok = _csCopy(pactAppearanceCopyText(app));
  if (typeof flash === 'function') flash(ok ? 'Appearance copied — open the other character and press 📥 Paste appearance.' : 'Copy the text shown, then paste it on the other character.');
}
/* Reads the clipboard (or asks for the text), previews the change as plain text, and calls apply(merged) on OK. */
function pactAppearancePaste(cur, apply) {
  function go(text) {
    var p = pactAppearanceParse(text);
    if (!p.ok) { if (typeof flash === 'function') flash(p.error, 'warn'); return; }
    var m = pactAppearanceMerge(cur, p.appearance);
    if (!m.changed.length) { if (typeof flash === 'function') flash('Nothing to change — this character already has that appearance.'); return; }
    var cut = function (s) { s = String(s).replace(/\s+/g, ' '); return s.length > 40 ? s.slice(0, 39) + '…' : (s || '(empty)'); };
    var lines = m.changed.slice(0, 15).map(function (c) { return '• ' + c.key + ': ' + cut(c.from) + ' → ' + cut(c.to); });
    if (m.changed.length > 15) lines.push('…and ' + (m.changed.length - 15) + ' more');
    if (!window.confirm('Replace this character\'s appearance with the copied one?\n' + m.changed.length + ' field(s) change:\n\n' + lines.join('\n') +
        '\n\nThe name, coins and weapons are not touched.')) return;
    apply(m.merged);
    if (typeof flash === 'function') flash('Appearance pasted — ' + m.changed.length + ' field(s) changed.');
  }
  function ask() { var t = window.prompt('Paste the copied appearance here (Ctrl/Cmd-V):', ''); if (t != null) go(t); }
  try {
    if (navigator.clipboard && navigator.clipboard.readText && window.isSecureContext) {
      navigator.clipboard.readText().then(go, ask); return;
    }
  } catch (e) {}
  ask();
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

/* The one-paragraph description writer, shared by both tools (feat/livesheet-centre-columns — moved out of CharGen's
   genDescription(), which read its form fields directly, so Live Sheet's "Regenerate paragraph" writes the exact same
   text). Pure: `ap` is an appearance object (b.appearance, or CharGen's form values in the same keys), `who` is
   {name, species, originClass}. Returns the paragraph; writes nothing. */
function _pactArtyc(s){s=(s||'').trim();
  // numbers that READ with a leading vowel sound take "an": 8/80s/800s (eight…), 11 (eleven), 18 (eighteen)
  if(/^[0-9]/.test(s)){var d=String(parseInt(s,10));return (/^8/.test(d)||d==='11'||d==='18')?'an':'a';}
  return /^[aeiou]/i.test(s)?'an':'a';}  // a / an
function _pactJoinList(a){a=a.filter(Boolean);if(a.length<=1)return a.join('');if(a.length===2)return a[0]+' and '+a[1];return a.slice(0,-1).join(', ')+', and '+a[a.length-1];}
function pactComposeDescription(ap, who){
  ap=ap||{}; who=who||{};
  var v=function(k){var x=ap[k];return x==null?'':String(x);};
  var name=who.name||'This character';
  var pcs=[];
  // sentence 1 — identity; gender (female/male/non-binary) reads as an adjective, a/an correct
  var core=[v('age')?(v('age')+'-year-old'):'',v('gender'),who.species,who.originClass].filter(Boolean).join(' ');
  pcs.push(name+' is '+_pactArtyc(core)+' '+core+(v('hometown')?(' from '+v('hometown')):'')+'.');
  // physique — "are"; colouring/features — "have"
  var are=[v('build'),v('height')&&('about '+v('height')+' tall')].filter(Boolean);
  if(are.length)pcs.push('They are '+_pactJoinList(are)+'.');
  var have=[v('hair')&&v('hair').indexOf('none')<0&&(v('hair')+' hair'),v('eyes')&&(v('eyes')+' eyes'),v('skin'),v('nose')&&(_pactArtyc(v('nose'))+' '+v('nose')+' nose'),v('marks')&&v('marks').indexOf('no distinguishing')<0&&v('marks')].filter(Boolean);
  if(have.length)pcs.push('They have '+_pactJoinList(have)+'.');
  // manner: demeanour (are) · voice (speak) · quirk (own clause, avoids subject-verb clash)
  if(v('demeanour'))pcs.push('By temperament they are '+v('demeanour')+'.');
  if(v('voice'))pcs.push('They speak with '+_pactArtyc(v('voice'))+' '+v('voice')+' voice.');
  if(v('quirk'))pcs.push('A characteristic habit: '+v('quirk')+'.');
  // past — fix "They was" -> "They were"
  var past=[v('profession')&&('They '+v('profession').replace(/^was /,'were ')),v('famevent')].filter(Boolean);
  if(past.length)pcs.push(past.join('. ')+'.');
  // family
  var parents=[v('father'),v('mother')].filter(Boolean).join(' and ');
  var fam=[parents&&('Born to '+parents),v('familyfor')&&('a family known for '+v('familyfor'))].filter(Boolean);
  if(fam.length)pcs.push(fam.join(', ')+(v('secret')?('. The family secret: '+v('secret')):'')+'.');
  // tastes — likes / dislikes / drink
  var tastes=[v('likes')&&('they favour '+v('likes')),v('dislikes')&&('cannot abide '+v('dislikes')),v('drink')&&('always take '+v('drink'))].filter(Boolean);
  if(tastes.length)pcs.push('Given the choice, '+_pactJoinList(tastes)+'.');
  // drive
  var drive=[v('ambition')&&('driven '+v('ambition')),v('fear')&&('haunted by a fear of '+v('fear')),v('faith')&&('keeping faith with '+v('faith'))].filter(Boolean);
  if(drive.length)pcs.push('They are '+_pactJoinList(drive)+'.');
  // belongings / companion
  var misc=[v('prized')&&('carry '+v('prized')),v('companion')&&v('companion').indexOf('no companion')<0&&('are accompanied by '+v('companion'))].filter(Boolean);
  if(misc.length)pcs.push('They '+_pactJoinList(misc)+'.');
  return pcs.join(' ');
}

/* ---- feat/boon-drawback-notes (D-GH-2026-10-15-boon-drawback-notes) --------------------------------------------------
   Some boons and drawbacks need a player-written description (DATA.notePrompts — "Code of Honour": what is the code?).
   Shared by CharGen, the Live Sheet and DM Console so the three read a note's state the same way. Display/UX only: no
   rule reads a note, so nothing here touches compute() or the AP economy.

   THE EVENTS (all three live in the character's LOG, keyed by category + NAME, never by seq — CharGen renumbers a draft's
   purchases when it rebuilds the log, and a character holds at most one copy of a boon or drawback name):
     {type:'itemNote',      cat:'boon'|'drawback', refVal:<name>, text}  player-written; the LATEST one is the note
     {type:'dmApproveNote', cat, refVal, text, campaignId}  written ONLY by dm_edit_character_log (DM-stamped
                                                dmEdit:true); `text` is the note as the server read it at approval
     {type:'dmUnlockNote',  cat, refVal, note?, campaignId}  same path; re-opens an approved note for editing
   A note's state is read in log order: a note makes it 'pending', an approval of exactly that text makes it 'approved', an unlock or a NEWER
   note makes it 'pending' again. An approval or unlock counts only when it is DM-stamped AND was made in the campaign the
   character is in now (`campaignId`, stamped by the server) — a character that moves campaign needs its new DM's
   approval, and a solo character (no campaign) has no DM, so its note is required but never locked. The server applies
   the same reading (pact_enforce_item_note_lock). */
var PACT_NOTE_MAX = 500;
function pactNoteKey(cat, name){ return String(cat) + '|' + String(name); }
// The question to ask for a boon/drawback, or '' when it needs no note.
function pactNotePrompt(data, cat, name){
  var m = data && data.notePrompts && data.notePrompts[cat];
  return (m && Object.prototype.hasOwnProperty.call(m, name)) ? String(m[name] || '') : '';
}
// key -> {cat, name, text, status:'none'|'pending'|'approved', approved:{text,ts,dmId}|null, unlocked:{note,ts}|null}
function pactNoteStates(log, campaignId){
  var out = {};
  (log || []).forEach(function(e){
    if(!e || (e.type !== 'itemNote' && e.type !== 'dmApproveNote' && e.type !== 'dmUnlockNote')) return;
    if((e.cat !== 'boon' && e.cat !== 'drawback') || typeof e.refVal !== 'string' || !e.refVal) return;
    var k = pactNoteKey(e.cat, e.refVal);
    var st = out[k] || (out[k] = { cat: e.cat, name: e.refVal, text: '', status: 'none', approved: null, unlocked: null });
    if(e.type === 'itemNote'){
      if(typeof e.text !== 'string') return;
      st.text = e.text; st.status = e.text.trim() ? 'pending' : 'none';
    } else if(e.dmEdit !== true || !campaignId || String(e.campaignId) !== String(campaignId)){
      return;   // an approval or unlock counts only when the server stamped it, in the character's current campaign
    } else if(e.type === 'dmApproveNote'){
      // Only an approval OF THIS TEXT counts: the server copies the approved text into the event, so a note rewritten in
      // place afterwards (possible while the character was solo, where nothing is frozen) no longer matches and stays
      // pending. (#673 review, finding A.)
      if(st.status === 'none' || typeof e.text !== 'string' || e.text !== st.text) return;
      st.status = 'approved'; st.approved = { text: e.text, ts: e.ts || 0, dmId: e.dmId || null };
    } else if(st.status === 'approved'){
      st.status = 'pending'; st.unlocked = { note: typeof e.note === 'string' ? e.note : '', ts: e.ts || 0 }; st.approved = null;
    }
  });
  return out;
}
// The held boons/drawbacks that need a note, one row per name: {cat, name, prompt, text, status, approved}. `build` is
// the folded build (foldBuild), whose boons/drawbacks are what the character holds right now; `campaignId` the campaign
// it is in (null when solo).
function pactNoteItems(build, log, data, campaignId){
  var states = pactNoteStates(log, campaignId), rows = [], seen = {};
  [['boon', (build && build.boons) || []], ['drawback', (build && build.drawbacks) || []]].forEach(function(p){
    p[1].forEach(function(name){
      var k = pactNoteKey(p[0], name), q = pactNotePrompt(data, p[0], name);
      if(!q || seen[k]) return; seen[k] = 1;
      var st = states[k] || { text: '', status: 'none', approved: null, unlocked: null };
      rows.push({ cat: p[0], name: name, prompt: q, text: st.text, status: st.status, approved: st.approved, unlocked: st.unlocked });
    });
  });
  return rows;
}
// Approved notes are frozen while the character is in a campaign (the server refuses a change there too).
function pactNoteLocked(row, campaignBound){ return !!(row && row.status === 'approved' && campaignBound); }
// {ok:true, text} or {ok:false, error}. Trimmed; required; capped at PACT_NOTE_MAX (the server caps it too).
function pactCheckNoteText(t){
  var s = String(t == null ? '' : t).trim();
  if(!s) return { ok: false, error: 'A description is required for this one.' };
  if(s.length > PACT_NOTE_MAX) return { ok: false, error: 'Keep it to ' + PACT_NOTE_MAX + ' characters or fewer (this is ' + s.length + ').' };
  return { ok: true, text: s };
}
function pactNoteEvent(cat, name, text){
  return { type: 'itemNote', cat: cat, refVal: name, text: text, label: 'Note — ' + name };
}
// Ask for a note in a small modal with a multi-line box (owner decision AU1, 2026-10-17): the item's question, a <textarea>
// capped at PACT_NOTE_MAX with a live counter, OK / Cancel. Keyboard: the box has focus on open, Tab moves between it and
// the buttons, Esc = Cancel, Ctrl/Cmd+Enter = OK (Enter alone is a new line). OK re-checks the text (required, capped) and
// shows the problem in the dialog instead of closing. done(text) on OK with the trimmed text, done(null) on Cancel/Esc.
// ASYNCHRONOUS: callers continue in `done`. Tests may replace window.pactAskNote with a stub that calls done() directly.
function pactAskNote(name, question, current, done){
  if(typeof done !== 'function') done = function(){};
  // One at a time: a second request while one is open is answered "cancelled" (so its caller puts the tick back), never
  // left hanging. The open one keeps focus.
  if(document.getElementById('pactNoteDlg')){ done(null); return; }
  var prev = document.activeElement;
  var ov = document.createElement('div');
  ov.id = 'pactNoteDlg';
  ov.setAttribute('style', 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px');
  var box = document.createElement('div');
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'pactNoteDlgT');
  box.setAttribute('style', 'background:var(--panel,var(--card,var(--bg,#fff)));color:var(--ink,var(--text,inherit));border:1px solid var(--line,#888);border-radius:8px;max-width:520px;width:100%;padding:14px 16px;box-shadow:0 8px 30px rgba(0,0,0,.35);font:inherit');
  box.innerHTML = '<div id="pactNoteDlgT" style="font-weight:700;margin-bottom:4px"></div>'
    + '<label for="pactNoteDlgTa" id="pactNoteDlgQ" style="display:block;font-size:13px;margin-bottom:6px"></label>'
    + '<textarea id="pactNoteDlgTa" rows="5" maxlength="' + PACT_NOTE_MAX + '" aria-describedby="pactNoteDlgN pactNoteDlgE" style="width:100%;box-sizing:border-box;font:inherit;resize:vertical"></textarea>'
    + '<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;margin:4px 0 10px;gap:8px">'
    + '<span>Required. Your DM sees it and approves it. <span style="opacity:.75">Ctrl+Enter = OK, Esc = Cancel</span></span><span id="pactNoteDlgN" aria-live="polite"></span></div>'
    + '<div id="pactNoteDlgE" role="alert" style="color:var(--bad,#b00);font-size:12px;min-height:1em;margin-bottom:6px"></div>'
    + '<div style="display:flex;justify-content:flex-end;gap:8px"><button type="button" class="btn ghost" id="pactNoteDlgCancel">Cancel</button><button type="button" class="btn" id="pactNoteDlgOk">OK</button></div>';
  ov.appendChild(box); document.body.appendChild(ov);
  box.querySelector('#pactNoteDlgT').textContent = name;      // textContent: never markup
  box.querySelector('#pactNoteDlgQ').textContent = question;
  var ta = box.querySelector('#pactNoteDlgTa'), cnt = box.querySelector('#pactNoteDlgN'), err = box.querySelector('#pactNoteDlgE');
  ta.value = current || '';
  var upd = function(){ cnt.textContent = ta.value.length + ' / ' + PACT_NOTE_MAX; };
  upd();
  // Focus is trapped at DOCUMENT level: anything that moves focus outside the dialog (a click on the page behind, a
  // script) sends it back to the box, so the overlay can't lose it.
  var trap = function(e){ if(!box.contains(e.target)) ta.focus(); };
  document.addEventListener('focusin', trap, true);
  var fin = function(v){ document.removeEventListener('focusin', trap, true); ov.remove(); try { if(prev && prev.focus) prev.focus(); } catch(e){} done(v); };
  var ok = function(){ var c = pactCheckNoteText(ta.value); if(!c.ok){ err.textContent = c.error; ta.focus(); return; } fin(c.text); };
  ta.addEventListener('input', function(){ upd(); err.textContent = ''; });
  box.querySelector('#pactNoteDlgOk').addEventListener('click', ok);
  box.querySelector('#pactNoteDlgCancel').addEventListener('click', function(){ fin(null); });
  // Every key pressed in the dialog stays in the dialog: the tools' document-level shortcuts (CharGen's Ctrl+Z / Ctrl+Y undo
  // and redo, the Live Sheet's Esc handler) must never act on the character while the player is typing (#673 re-review 1).
  ['keypress', 'keyup'].forEach(function(t){ ov.addEventListener(t, function(e){ e.stopPropagation(); }); });
  ov.addEventListener('keydown', function(e){
    e.stopPropagation();
    if(e.key === 'Escape'){ e.preventDefault(); fin(null); }
    else if(e.key === 'Enter' && (e.ctrlKey || e.metaKey)){ e.preventDefault(); ok(); }
    else if(e.key === 'Tab'){   // keep focus inside the dialog
      var f = [ta, box.querySelector('#pactNoteDlgCancel'), box.querySelector('#pactNoteDlgOk')], k = f.indexOf(document.activeElement);
      e.preventDefault(); f[(k + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus();
    }
  });
  ta.focus();
}
