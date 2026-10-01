/* Shared "who's signed in / change password / sign out" popover for the three PACT tools.
   Plain classic script (like ui-helpers.js) — attaches one global, renderAccountPopover(anchor,
   bridge), that each tool's own sign-in chip click handler calls with its own module bridge's
   currentSession/logout/updatePassword/myProfile. Self-contained: injects its own CSS/DOM on first
   use so it never depends on a tool's local .moremenu styling (DM Console has none). */

(function () {
  var STYLE_ID = 'acctPopoverStyle';
  var ROOT_ID = 'acctPopoverRoot';

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      '.acct-pop{position:absolute;z-index:4000;min-width:230px;max-width:300px;background:#fff;' +
      'color:#1b2430;border:1px solid rgba(0,0,0,.15);border-radius:10px;' +
      'box-shadow:0 10px 32px rgba(0,0,0,.3);padding:10px;font:13px/1.4 system-ui,sans-serif;' +
      'text-align:left}' +
      '.acct-pop .acct-name{font-weight:700}' +
      '.acct-pop .acct-email{color:#5b6472;font-size:12px;margin-bottom:8px;word-break:break-all}' +
      '.acct-pop button{display:block;width:100%;text-align:left;background:none;border:0;' +
      'padding:7px 8px;border-radius:6px;font:inherit;cursor:pointer;color:inherit}' +
      '.acct-pop button:hover{background:rgba(0,0,0,.06)}' +
      '.acct-pop hr{border:0;border-top:1px solid rgba(0,0,0,.1);margin:6px 0}' +
      '.acct-pop input{width:100%;box-sizing:border-box;padding:6px 8px;margin:4px 0;' +
      'border:1px solid rgba(0,0,0,.2);border-radius:6px;font:inherit}' +
      '.acct-pop .acct-err{color:#a30000;font-size:12px;margin-top:4px}' +
      '.acct-pop .acct-ok{color:#146c2e;font-size:12px;margin-top:4px}';
    document.head.appendChild(s);
  }

  function closePopover() {
    var p = document.getElementById(ROOT_ID);
    if (p) p.remove();
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
  }
  function onDocClick(e) {
    var p = document.getElementById(ROOT_ID);
    if (p && !p.contains(e.target)) closePopover();
  }
  function onKeyDown(e) {
    if (e.key === 'Escape') closePopover();
  }

  function place(root, anchorEl) {
    var rect = anchorEl.getBoundingClientRect();
    root.style.top = (rect.bottom + window.scrollY + 6) + 'px';
    // Keep it on-screen for a chip near the right edge (every current caller's chip lives top-right).
    var left = rect.right + window.scrollX - root.offsetWidth;
    root.style.left = Math.max(8, left) + 'px';
  }

  /** bridge: {currentSession, logout?, updatePassword?, myProfile?} — only currentSession is
   *  required; the others degrade to "not available" rather than throwing, since not every caller
   *  wires every function (DM Console's bridge, for one, didn't carry myProfile before this). */
  function renderAccountPopover(anchorEl, bridge) {
    ensureStyle();
    closePopover(); // only one open at a time, regardless of which tool/chip opened the last one
    if (!bridge || typeof bridge.currentSession !== 'function') return;

    bridge.currentSession().then(function (session) {
      var root = document.createElement('div');
      root.id = ROOT_ID;
      root.className = 'acct-pop';

      if (!session) {
        root.innerHTML =
          '<div style="margin-bottom:6px">Not signed in.</div>' +
          '<a href="../login.html" style="display:block;padding:7px 8px">🔑 Sign in</a>';
        document.body.appendChild(root);
        place(root, anchorEl);
        setTimeout(function () { document.addEventListener('click', onDocClick, true); document.addEventListener('keydown', onKeyDown, true); }, 0);
        return;
      }

      var email = (session.user && session.user.email) || '';
      Promise.resolve(bridge.myProfile ? bridge.myProfile().catch(function () { return null; }) : null)
        .then(function (profile) {
          var name = (profile && profile.display_name) || '';

          if (name) {
            var nameDiv = document.createElement('div');
            nameDiv.className = 'acct-name';
            nameDiv.textContent = name; // textContent — never innerHTML with a player-set display name
            root.appendChild(nameDiv);
          }
          var emailDiv = document.createElement('div');
          emailDiv.className = 'acct-email';
          emailDiv.textContent = email; // textContent — never innerHTML with the account's email
          root.appendChild(emailDiv);

          if (bridge.updatePassword) {
            var pwBtn = document.createElement('button');
            pwBtn.type = 'button';
            pwBtn.textContent = '🔑 Change password';
            root.appendChild(pwBtn);

            var pwForm = document.createElement('div');
            pwForm.style.display = 'none';
            pwForm.innerHTML =
              '<input type="password" class="acctNewPw" placeholder="New password" autocomplete="new-password">' +
              '<input type="password" class="acctNewPw2" placeholder="Confirm new password" autocomplete="new-password">' +
              '<button type="button" class="acctPwSave">Save password</button>' +
              '<div class="acctPwMsg"></div>';
            root.appendChild(pwForm);

            pwBtn.onclick = function () {
              pwForm.style.display = (pwForm.style.display === 'none') ? 'block' : 'none';
            };
            pwForm.querySelector('.acctPwSave').onclick = function () {
              var msg = pwForm.querySelector('.acctPwMsg');
              var p1 = pwForm.querySelector('.acctNewPw').value;
              var p2 = pwForm.querySelector('.acctNewPw2').value;
              msg.className = 'acctPwMsg'; msg.textContent = '';
              if (!p1 || p1.length < 6) { msg.className = 'acctPwMsg acct-err'; msg.textContent = 'Password must be at least 6 characters.'; return; }
              if (p1 !== p2) { msg.className = 'acctPwMsg acct-err'; msg.textContent = 'Passwords do not match.'; return; }
              bridge.updatePassword(p1).then(function () {
                msg.className = 'acctPwMsg acct-ok'; msg.textContent = 'Password updated.';
                pwForm.querySelector('.acctNewPw').value = '';
                pwForm.querySelector('.acctNewPw2').value = '';
                if (typeof flash === 'function') flash('✔ Password updated', 'ok');
              }).catch(function (err) {
                msg.className = 'acctPwMsg acct-err';
                msg.textContent = (err && err.message) || 'Could not update password.';
              });
            };
          }

          if (bridge.logout) {
            var hr = document.createElement('hr');
            root.appendChild(hr);
            var outBtn = document.createElement('button');
            outBtn.type = 'button';
            outBtn.textContent = '🚪 Log out';
            var outMsg = document.createElement('div');
            outMsg.className = 'acctPwMsg';
            // fix/account-details-and-password-change: this used to close the popover and call
            // logout() with no result handling — a failed sign-out (offline, a dropped connection)
            // left the UI still showing signed-in with zero indication anything went wrong. Now the
            // popover stays open on failure, with the real error, instead of silently doing nothing.
            outBtn.onclick = function () {
              outBtn.disabled = true;
              outMsg.className = 'acctPwMsg'; outMsg.textContent = '';
              bridge.logout().then(function () {
                closePopover();
              }).catch(function (err) {
                outBtn.disabled = false;
                outMsg.className = 'acctPwMsg acct-err';
                outMsg.textContent = (err && err.message) || 'Could not sign out — check your connection.';
              });
            };
            root.appendChild(outBtn);
            root.appendChild(outMsg);
          }

          document.body.appendChild(root);
          place(root, anchorEl);
          setTimeout(function () { document.addEventListener('click', onDocClick, true); document.addEventListener('keydown', onKeyDown, true); }, 0);
        });
    }).catch(function () { /* best-effort — never break a tool's chip click over this */ });
  }

  window.renderAccountPopover = renderAccountPopover;
})();
