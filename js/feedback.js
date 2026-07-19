// PACT — in-app user feedback widget (feat/feedback-widget).
//
// A fully SELF-CONTAINED ES module: it injects its own floating button, form,
// and styles, and depends only on the shared Supabase client. It deliberately
// does NOT rely on js/engine.js's `engine-ready` gate or on js/ui-helpers.js, so
// it works identically on all four player-facing pages — including
// docs/PACT-Players-Guide.html, which has no other module/JS wiring at all.
//
// Data model: inserts one row into public.feedback (see sql/schema.sql +
// sql/rls-policies.sql). The table is INSERT-ONLY from the client for both
// signed-in and anonymous users; there is no read/update/delete grant, so
// feedback is visible only via the Supabase dashboard (no in-app admin view in
// v1). See DECISIONS.md D-GH-2026-07-15-feedback-widget and
// docs/plans/2026-07-15-feedback-widget.md for the full design + the
// anon-write trust-boundary decision.

import { supabase } from './supabase-client.js';

// Message length must match the DB CHECK (char_length(message) between 1 and 2000).
const MSG_MAX = 2000;
const CONTACT_MAX = 200;           // matches the contact column CHECK
const COOLDOWN_MS = 60 * 1000;     // client-side throttle between submissions
const COOLDOWN_KEY = 'pact-feedback-last';
const VALID_PAGES = ['chargen', 'livesheet', 'dmconsole', 'guide'];

let _initialised = false;

/**
 * Mount the feedback widget on the current page.
 * @param {'chargen'|'livesheet'|'dmconsole'|'guide'} page  which surface this is,
 *   stored on each row for attribution. Must be one of the four the DB CHECK allows.
 */
export function initFeedbackWidget(page) {
  if (_initialised) return;                 // never mount twice
  if (!VALID_PAGES.includes(page)) {
    console.warn('[feedback] unknown page name:', page, '— widget not mounted');
    return;
  }
  _initialised = true;

  injectStyles();

  // ---- Floating button ----------------------------------------------------
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pact-fb-btn';
  btn.textContent = 'Feedback';
  btn.setAttribute('aria-label', 'Send feedback');
  btn.setAttribute('aria-haspopup', 'dialog');

  // ---- Panel (dialog) -----------------------------------------------------
  const panel = document.createElement('div');
  panel.className = 'pact-fb-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-label', 'Send feedback');
  panel.hidden = true;

  const title = document.createElement('div');
  title.className = 'pact-fb-title';
  title.textContent = 'Send feedback';

  const msg = document.createElement('textarea');
  msg.className = 'pact-fb-msg';
  msg.rows = 5;
  msg.maxLength = MSG_MAX;
  msg.placeholder = 'What’s working, what isn’t, or an idea…';
  msg.setAttribute('aria-label', 'Your feedback');

  const contact = document.createElement('input');
  contact.type = 'text';
  contact.className = 'pact-fb-contact';
  contact.maxLength = CONTACT_MAX;
  contact.placeholder = 'Contact (optional)';
  contact.setAttribute('aria-label', 'Contact, optional');

  const contactNote = document.createElement('div');
  contactNote.className = 'pact-fb-note';
  contactNote.textContent = 'Optional — only if you’d like a reply. Don’t include sensitive info.';

  // "Submit anonymously" — only shown to signed-in users (a signed-out user is
  // always anonymous). Populated in refreshIdentity() each time the panel opens.
  const anonWrap = document.createElement('label');
  anonWrap.className = 'pact-fb-anon';
  anonWrap.hidden = true;
  const anonBox = document.createElement('input');
  anonBox.type = 'checkbox';
  anonBox.className = 'pact-fb-anon-box';
  const anonText = document.createElement('span');
  anonWrap.append(anonBox, anonText);

  // Same row as contactNote: the checkbox (when shown) sits in front of the
  // note text instead of on its own line below it.
  const contactRow = document.createElement('div');
  contactRow.className = 'pact-fb-note-row';
  contactRow.append(anonWrap, contactNote);

  const status = document.createElement('div');
  status.className = 'pact-fb-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const actions = document.createElement('div');
  actions.className = 'pact-fb-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'pact-fb-cancel';
  cancel.textContent = 'Close';
  const send = document.createElement('button');
  send.type = 'button';
  send.className = 'pact-fb-send';
  send.textContent = 'Send';
  actions.append(cancel, send);

  panel.append(title, msg, contact, contactRow, status, actions);
  document.body.append(btn, panel);

  // ---- Identity: signed-in users can opt out of attribution ---------------
  // Read the session from local storage (no network round-trip). If signed in,
  // offer the anonymous checkbox; otherwise the submission is anonymous anyway.
  let currentUserId = null;
  async function refreshIdentity() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      currentUserId = session?.user?.id ?? null;
    } catch {
      currentUserId = null;                 // treat any failure as signed-out
    }
    if (currentUserId) {
      anonBox.checked = false;
      anonText.textContent = 'Submit anonymously (don’t attach my account)';
      anonWrap.hidden = false;
    } else {
      anonWrap.hidden = true;
    }
  }

  // ---- Open / close -------------------------------------------------------
  function open() {
    panel.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    setStatus('');
    refreshIdentity();
    msg.focus();
  }
  function close() {
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    btn.focus();
  }
  function toggle() { panel.hidden ? open() : close(); }

  function setStatus(text, kind) {
    status.textContent = text;
    status.className = 'pact-fb-status' + (kind ? ' pact-fb-' + kind : '');
  }

  // ---- Submit -------------------------------------------------------------
  async function submit() {
    const message = msg.value.trim();
    if (!message) { setStatus('Please enter a message.', 'err'); msg.focus(); return; }
    if (message.length > MSG_MAX) { setStatus('Message is too long (max ' + MSG_MAX + ').', 'err'); return; }

    // Client-side cooldown: a cheap throttle against accidental repeat / naive
    // scripts. Not a real rate limit (out of scope) — a determined abuser can
    // clear localStorage — just a deterrent for the common case.
    const last = Number(localStorage.getItem(COOLDOWN_KEY) || 0);
    const waited = Date.now() - last;
    if (last && waited < COOLDOWN_MS) {
      const secs = Math.ceil((COOLDOWN_MS - waited) / 1000);
      setStatus('Thanks — please wait ' + secs + 's before sending more.', 'err');
      return;
    }

    if (!navigator.onLine) {
      setStatus('You’re offline — feedback needs a connection. Try again later.', 'err');
      return;
    }

    send.disabled = true;
    const sendLabel = send.textContent;
    send.textContent = 'Sending…';
    setStatus('');

    const row = {
      page,
      message,
      contact: contact.value.trim() || null,
      // Attribute to the signed-in user unless they ticked "anonymous".
      user_id: currentUserId && !anonBox.checked ? currentUserId : null,
    };

    try {
      // No .select() chained: the feedback table has no client read grant, so a
      // RETURNING clause would fail with "permission denied". Insert-only.
      const { error } = await supabase.from('feedback').insert(row);
      if (error) throw error;
      localStorage.setItem(COOLDOWN_KEY, String(Date.now()));
      msg.value = '';
      contact.value = '';
      setStatus('Thanks for the feedback!', 'ok');
      send.disabled = false;
      send.textContent = sendLabel;
      // Auto-close shortly after a successful send.
      setTimeout(() => { if (status.textContent === 'Thanks for the feedback!') close(); }, 1400);
    } catch (err) {
      console.warn('[feedback] insert failed:', err);
      setStatus('Couldn’t send — please try again in a moment.', 'err');
      send.disabled = false;
      send.textContent = sendLabel;
    }
  }

  // ---- Events -------------------------------------------------------------
  btn.addEventListener('click', toggle);
  cancel.addEventListener('click', close);
  send.addEventListener('click', submit);
  // Escape closes the panel from anywhere on the page — a document-level listener
  // (guarded by panel-open state) so it works even if focus has left the panel,
  // not just while a field inside it is focused.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) { e.stopPropagation(); close(); }
  });
  // Ctrl/Cmd+Enter from the textarea submits (a common convenience).
  msg.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submit(); });
}

// ---------------------------------------------------------------------------
// Styles — injected once, scoped by the .pact-fb- prefix. Self-contained and
// theme-neutral so it looks the same on all four pages regardless of each
// tool's own theme. High z-index so the button/panel stay clickable above tool
// UI; fixed to the bottom-right corner.
// ---------------------------------------------------------------------------
function injectStyles() {
  if (document.getElementById('pact-fb-styles')) return;
  const css = `
.pact-fb-btn{position:fixed;right:16px;bottom:16px;z-index:2147483000;
  font:600 13px/1 system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff;
  background:#4f46e5;border:none;border-radius:999px;padding:10px 16px;
  box-shadow:0 2px 10px rgba(0,0,0,.35);cursor:pointer}
.pact-fb-btn:hover{background:#4338ca}
.pact-fb-btn:focus-visible{outline:2px solid #fff;outline-offset:2px}
.pact-fb-panel{position:fixed;right:16px;bottom:64px;z-index:2147483000;
  width:min(340px,calc(100vw - 32px));box-sizing:border-box;
  background:#1f2937;color:#f9fafb;border:1px solid #374151;border-radius:12px;
  padding:14px;box-shadow:0 8px 30px rgba(0,0,0,.5);
  font:14px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif}
.pact-fb-title{font-weight:700;margin-bottom:8px;font-size:15px}
.pact-fb-panel textarea,.pact-fb-panel input[type=text]{width:100%;box-sizing:border-box;
  background:#111827;color:#f9fafb;border:1px solid #4b5563;border-radius:8px;
  padding:8px;font:inherit;margin-bottom:6px}
.pact-fb-panel textarea{resize:vertical;min-height:80px}
.pact-fb-panel textarea:focus,.pact-fb-panel input[type=text]:focus{outline:none;border-color:#6366f1}
.pact-fb-note-row{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.pact-fb-note{font-size:12px;color:#9ca3af}
.pact-fb-anon{display:flex;align-items:center;gap:8px;font-size:13px;color:#d1d5db;cursor:pointer}
.pact-fb-anon-box{width:16px;height:16px;flex:none}
.pact-fb-status{min-height:18px;font-size:13px;margin-bottom:8px}
.pact-fb-ok{color:#6ee7b7}
.pact-fb-err{color:#fca5a5}
.pact-fb-actions{display:flex;justify-content:flex-end;gap:8px}
.pact-fb-panel button{font:600 13px/1 system-ui,-apple-system,"Segoe UI",sans-serif;
  border-radius:8px;padding:8px 14px;cursor:pointer;border:1px solid transparent}
.pact-fb-cancel{background:transparent;color:#d1d5db;border-color:#4b5563}
.pact-fb-cancel:hover{background:#374151}
.pact-fb-send{background:#4f46e5;color:#fff}
.pact-fb-send:hover{background:#4338ca}
.pact-fb-send:disabled{background:#4b5563;cursor:default}
.pact-fb-panel button:focus-visible,.pact-fb-anon-box:focus-visible{outline:2px solid #818cf8;outline-offset:2px}
@media (max-width:420px){.pact-fb-panel{right:8px;left:8px;width:auto;bottom:60px}}
`;
  const style = document.createElement('style');
  style.id = 'pact-fb-styles';
  style.textContent = css;
  document.head.append(style);
}
